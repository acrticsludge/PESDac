// Evidence search + ambient health (spec §3, §4.5).
//
// Data + derivation for the retrieval chrome; UI-free and unit-tested.
// Split from lib/retrieval-banner.ts (review): a banner-named module
// must not host the search client.

import { useEffect, useState } from "react";
import { ApiError, AuthRequiredError, toUserMessage } from "./api/errors.ts";
import { apiFetch } from "./auth.ts";
import { shouldForegroundRefetch } from "./cache-revalidation.ts";
import { parseReferenceIds, sourceTarget } from "./references.ts";
import type { RetrievalIncidentCode } from "./retrieval-banner.ts";
import type {
  Bubble,
  RetrievalEvidenceItem,
  RetrievalVideoSegment,
  ToolCall,
} from "../content/threads/types.ts";

// ---- Ambient health (§4.5) --------------------------------------------------
//
// No polling infrastructure: reads happen on mount (authenticated only —
// guests stay zero-fetch like every other gate), on foreground return
// (the existing visibility cadence, coalesced on the foreground floor),
// and on manual Retry. Every read is one cheap cached GET; concurrent
// readers share the in-flight promise.

export type RetrievalHealth = {
  ok: boolean;
  provider: string | null;
  dims: number | null;
  sources: number;
  chunks: number;
  neurons_24h_estimate: number;
};

export type RetrievalHealthState = "unknown" | "ok" | "degraded" | "unreachable";

/**
 * Pure state derivation: fetch failures read unreachable (fail open —
 * the dot is ambient, never a gate); `ok: false` reads degraded.
 */
export function deriveRetrievalHealthState(args: {
  health: RetrievalHealth | null;
  fetchFailed: boolean;
}): RetrievalHealthState {
  if (args.fetchFailed) return "unreachable";
  if (args.health == null) return "unknown";
  return args.health.ok ? "ok" : "degraded";
}

/** Dot without bar = "flaky, retries working". Guests get no dot. */
export function shouldShowRetrievalDot(
  authenticated: boolean,
  state: RetrievalHealthState,
): boolean {
  return authenticated && (state === "degraded" || state === "unreachable");
}

export function retrievalDotLabel(state: RetrievalHealthState): string {
  return state === "degraded" ? "Course search degraded" : "Course search unreachable";
}

function formatCheckTime(lastCheckAtMs: number | null): string {
  if (lastCheckAtMs == null) return "unknown time";
  try {
    return new Date(lastCheckAtMs).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "unknown time";
  }
}

/** Tooltip: last-check time + provider + Settings retry affordance. */
export function retrievalDotTooltip(args: {
  state: RetrievalHealthState;
  provider: string | null;
  lastCheckAtMs: number | null;
}): string {
  const when = formatCheckTime(args.lastCheckAtMs);
  const who = args.provider ? ` (${args.provider})` : "";
  if (args.state === "degraded") {
    return `Course search is degraded — checked ${when}${who}. Open Settings to retry.`;
  }
  return `Course search is unreachable — checked ${when}${who}. Open Settings to retry.`;
}

let inflightHealth: Promise<RetrievalHealth> | null = null;
let lastHealthReadAtMs = 0;
let healthVersion = 0;
const healthListeners = new Set<() => void>();

function bumpHealthVersion(): void {
  healthVersion += 1;
  healthListeners.forEach((notify) => {
    try {
      notify();
    } catch {
      // A stale listener must not break the refresh for the rest.
    }
  });
}

/** One cheap cached GET; concurrent readers share the in-flight read. */
export function apiRetrievalHealth(): Promise<RetrievalHealth> {
  if (inflightHealth == null) {
    inflightHealth = apiFetch<RetrievalHealth>("/retrieval/health").finally(() => {
      inflightHealth = null;
    });
  }
  return inflightHealth;
}

/** Re-read health everywhere (Settings open while degraded, tooltip Retry). */
export function refreshRetrievalHealth(): void {
  inflightHealth = null;
  bumpHealthVersion();
}

export function useRetrievalHealth(authenticated: boolean): {
  state: RetrievalHealthState;
  health: RetrievalHealth | null;
  lastCheckAtMs: number | null;
  refresh: () => void;
} {
  const [version, setVersion] = useState(healthVersion);
  const [snapshot, setSnapshot] = useState<{
    state: RetrievalHealthState;
    health: RetrievalHealth | null;
    lastCheckAtMs: number | null;
  }>({ state: "unknown", health: null, lastCheckAtMs: null });

  useEffect(() => {
    const notify = () => setVersion(healthVersion);
    healthListeners.add(notify);
    return () => {
      healthListeners.delete(notify);
    };
  }, []);

  useEffect(() => {
    if (!authenticated) {
      setSnapshot({ state: "unknown", health: null, lastCheckAtMs: null });
      return;
    }
    let cancelled = false;
    const at = Date.now();
    void apiRetrievalHealth().then(
      (health) => {
        if (cancelled) return;
        lastHealthReadAtMs = at;
        setSnapshot({
          state: deriveRetrievalHealthState({ health, fetchFailed: false }),
          health,
          lastCheckAtMs: at,
        });
      },
      () => {
        if (cancelled) return;
        lastHealthReadAtMs = at;
        setSnapshot((prev) => ({
          state: deriveRetrievalHealthState({ health: prev.health, fetchFailed: true }),
          health: prev.health,
          lastCheckAtMs: at,
        }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [authenticated, version]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (!shouldForegroundRefetch(lastHealthReadAtMs, now)) return;
      lastHealthReadAtMs = now;
      refreshRetrievalHealth();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  return { ...snapshot, refresh: refreshRetrievalHealth };
}

// ---- Evidence search (§3 backend contract, verbatim) --------------------------
//
// Thin client over `POST /retrieval/search` plus pure view helpers.
// Errors propagate as thrown ApiError/AuthRequiredError (callers map
// them to §4.1 surfaces); the envelope copy rule lives in
// selectRetrievalCopy. ThreadView fetch wiring lands separately —
// this module stays UI-free and unit-tested.

export type RetrievalScope = "slides" | "textbook" | "lectures";

/** All scopes, the implicit default when the question names none. */
export const RETRIEVAL_SCOPES: RetrievalScope[] = ["slides", "textbook", "lectures"];

/**
 * Scope from @-mention tokens (references.ts is the single home for
 * token parsing — never re-implement the regex here). Unknown tokens
 * are ignored; no tokens means all scopes.
 */
export function retrievalScopeForText(text: string): RetrievalScope[] {
  const ids = parseReferenceIds(text);
  const known = ids.filter(
    (id): id is RetrievalScope =>
      id === "slides" || id === "textbook" || id === "lectures",
  );
  return known.length > 0 ? [...new Set(known)] : [...RETRIEVAL_SCOPES];
}

/** P1 search bundle item (§3, verbatim incl. opaque `bbox`). */
export type RetrievalBundleItem = {
  chunk_id: string;
  kind: string;
  page: number | null;
  bbox: unknown;
  text: string | null;
  latex: string | null;
  table_md: string | null;
  caption: string | null;
  concepts: string[];
  thumb_url: string | null;
  page_url: string | null;
  video: { url: string; start: number; end: number } | null;
  score: number;
};

export type RetrievalBundle = {
  data: RetrievalBundleItem[];
  pagination: { limit: number; offset: number; total: number };
};

export async function apiRetrievalSearch(args: {
  query: string;
  subject: string;
  scope?: RetrievalScope[] | null;
  topK?: number;
}): Promise<RetrievalBundle> {
  return apiFetch<RetrievalBundle>("/retrieval/search", {
    method: "POST",
    body: {
      query: args.query,
      subject: args.subject,
      scope: args.scope ?? null,
      topK: args.topK ?? 10,
    },
  });
}

/** Bundle items stripped to the persisted display shape (drops `bbox`). */
export function toEvidenceItems(bundle: RetrievalBundle): RetrievalEvidenceItem[] {
  return bundle.data.map((item) => ({
    chunk_id: item.chunk_id,
    kind: item.kind,
    page: item.page,
    text: item.text,
    latex: item.latex,
    table_md: item.table_md,
    caption: item.caption,
    concepts: item.concepts,
    thumb_url: item.thumb_url,
    page_url: item.page_url,
    video: item.video,
    score: item.score,
  }));
}

/** Segment seconds → `mm:ss` for the video open button. Never throws. */
export function formatVideoTimestamp(totalSeconds: number): string {
  try {
    const floored = Number.isFinite(totalSeconds)
      ? Math.max(0, Math.floor(totalSeconds))
      : 0;
    return `${Math.floor(floored / 60)}:${String(floored % 60).padStart(2, "0")}`;
  } catch {
    return "0:00";
  }
}

/** Seek URL for the video open button (`mp4#t=`). */
export function videoSeekUrl(url: string, startSeconds: number): string {
  const at = Number.isFinite(startSeconds) ? Math.max(0, Math.floor(startSeconds)) : 0;
  return `${url}#t=${at}`;
}

/** One provenance line: kind + page, or lecture + segment time. */
export function retrievalSourceLabel(
  subject: string,
  item: { kind: string; page: number | null; video: { start: number } | null },
): string {
  if (item.video != null) {
    return `${sourceTarget("lectures", subject)} ${formatVideoTimestamp(item.video.start)}`;
  }
  if (item.page != null) {
    return `${sourceTarget(item.kind, subject)} p.${item.page}`;
  }
  return sourceTarget(item.kind, subject);
}

/** Ordered, deduped provenance lines for the sources banner. */
export function retrievalSources(
  subject: string,
  items: Array<{ kind: string; page: number | null; video: { start: number } | null }>,
): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const item of items) {
    const label = retrievalSourceLabel(subject, item);
    if (!seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }
  return labels;
}

// ---- ThreadView turn bindings (§4.1, §4.3) -----------------------------------
//
// Pure helpers behind the ThreadView wiring (T5). The classifier maps
// every search failure to exactly one surface; the mapper turns bundle
// items into existing bubble parts (video opens via buttons rendered
// from the persisted evidence, never a bubble).

export type RetrievalFailureSurface = "bar" | "composer" | "none";

export type ClassifiedRetrievalFailure = {
  surface: RetrievalFailureSurface;
  incidentCode: RetrievalIncidentCode | null;
};

const INCIDENT_CODES: RetrievalIncidentCode[] = [
  "EMBED_UNREACHABLE",
  "EMBED_MISCONFIGURED",
  "EMBED_SPACE_MISMATCH",
];

function asIncidentCode(code: string | null | undefined): RetrievalIncidentCode | null {
  return code != null && (INCIDENT_CODES as string[]).includes(code)
    ? (code as RetrievalIncidentCode)
    : null;
}

/**
 * Exactly one surface per failure (§4.1):
 * - 401 → none (apiFetch already fired AUTH_REQUIRED_EVENT; the
 *   global re-login flow owns it — no new UI).
 * - 502/503 with a known incident code → the site-wide bar.
 * - everything else (429, 422, unknown 5xx codes, network/auth-service
 *   outages, the unexpected) → composer status + Retry, never the bar.
 */
export function classifyRetrievalFailure(error: unknown): ClassifiedRetrievalFailure {
  if (error instanceof AuthRequiredError) {
    return { surface: "none", incidentCode: null };
  }
  if (error instanceof ApiError) {
    if (error.status === 401) return { surface: "none", incidentCode: null };
    if (error.status === 502 || error.status === 503) {
      const incidentCode = asIncidentCode(error.body?.code);
      if (incidentCode != null) return { surface: "bar", incidentCode };
    }
    return { surface: "composer", incidentCode: null };
  }
  return { surface: "composer", incidentCode: null };
}

/**
 * Failure copy (§3 copy rule): the envelope error.message wins when
 * present — backend 502/503 copy is UI-ready by contract. Only
 * unreadable bodies (network failure, no envelope) fall through to the
 * generic user-safe copy. (toUserMessage's 5xx branch deliberately
 * masks server text on generic paths; the retrieval path opts out.)
 */
export function retrievalFailureMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const envelope = error.body?.message?.trim();
    if (envelope) return envelope;
  }
  return fallback;
}

/**
 * Toast for a search failure (T7, §4.1): 422 and 429 surface one error
 * toast beside the composer copy. 502/503 own the bar (no toast spam —
 * the bar IS the notice); 401 owns the global re-login flow; network
 * and unknown failures stay composer-only.
 *
 * One-toast-max is the vendor's, not a latch: the uniqueID is stable
 * per question episode, so same-question retries hit
 * collisionBehavior "ignore" while a toast stands, and a new question
 * (a new episode) mints a fresh one.
 */
export function retrievalToastForFailure(
  error: unknown,
  question: string,
): { body: string; uniqueID: string } | null {
  const status = error instanceof ApiError ? error.status : null;
  if (status !== 422 && status !== 429) return null;
  const body = retrievalFailureMessage(error, toUserMessage(error, "Search failed. Try again."));
  if (!body.trim()) return null;
  return { body, uniqueID: `retrieval-search:${status}:${question}` };
}

/**
 * Sources-banner description for the citations setting (T7, §4.3 —
 * provenance default ON, no shape change): "always" lists every source,
 * otherwise the banner compacts past three with a +N more tail.
 */
export function sourcesBannerDescription(labels: string[], verbose: boolean): string {
  if (verbose || labels.length <= 3) return labels.join(" · ");
  return `${labels.slice(0, 3).join(" · ")} · +${labels.length - 3} more`;
}

/** Running-chip target for the turn scope (mirrors the mock responder). */
export function chipTargetForScope(subject: string, scope: RetrievalScope[]): string {
  if (scope.length === 1 && scope[0] != null) return sourceTarget(scope[0], subject);
  return `${subject} course material`;
}

/**
 * Live state of the real search for the current turn. Deliberately 1:1
 * with `ToolCall["status"]` so the tool-call row is the loading signal:
 * `running` → vendor Spinner, `complete` → green tick + the real
 * duration, `error` → red ✕ + the failure copy.
 *
 * `idle` is the single "render no search row" outcome and covers both ways
 * to get there: the turn ran no search (guests, or a turn that returned
 * before one was kicked off), and a search whose outcome is owned by
 * another surface (401 → the global re-login flow). It never means
 * "still loading" — a row is never left spinning.
 */
export type SearchPhase =
  | { status: "idle" }
  | { status: "running"; target: string }
  | { status: "complete"; target: string; duration: string }
  | { status: "error"; target: string; message: string };

/**
 * The search row for the tool-call group, or null when the turn runs no
 * search. The chip IS the progress indicator — no separate skeleton.
 */
export function searchToolCall(phase: SearchPhase): ToolCall | null {
  if (phase.status === "idle") return null;
  return {
    name: "search",
    target: phase.target,
    status: phase.status,
    duration: phase.status === "complete" ? phase.duration : "",
    ...(phase.status === "error" ? { errorMessage: phase.message } : {}),
  };
}

/**
 * True for a planned `search` row that is a fabricated SUCCESS — the mock
 * responder seeds its duration off the question length, so it paints a
 * green tick for a request that had not been made (and would survive a
 * search that then failed). The real search owns that row instead.
 *
 * A planned `search` row with status `error` is left alone: responder.ts
 * plans it only for the "simulate a tool error" branch, where the failed
 * call IS the narrative and must survive into persisted history.
 */
function isFabricatedSearchSuccess(tool: ToolCall): boolean {
  return tool.name === "search" && tool.status === "complete";
}

/** The turn's tool calls with any fabricated `search` success removed. */
export function withoutFabricatedSearch(tools: ToolCall[]): ToolCall[] {
  return tools.filter((t) => !isFabricatedSearchSuccess(t));
}

/**
 * Merge the real search row into the turn's tool calls, replacing any
 * fabricated `search` success. A deliberate `search` error (the simulate
 * branch) is preserved and the real row is not appended beside it, so the
 * demo's failed-call story is never papered over by a real result.
 */
export function withSearchToolCall(tools: ToolCall[], phase: SearchPhase): ToolCall[] {
  const kept = withoutFabricatedSearch(tools);
  if (kept.some((t) => t.name === "search")) return kept;
  const real = searchToolCall(phase);
  if (real == null) return kept;
  return [...kept, real];
}

/** Empty-bundle assistant message (§5, verbatim). */
export const RETRIEVAL_EMPTY_MESSAGE = "Nothing in your course material covers this yet.";

/** Empty-bundle recovery pills (§4.3: never a dead end). */
export const RETRIEVAL_EMPTY_PILLS: string[] = [
  "Try rephrasing",
  "Search a different source",
  "Quiz me on what we've covered",
];

function nonBlank(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Bundle items → existing bubble parts. Text-like fields (text, then
 * latex, then table) become one markdown card carrying the
 * "View full page" link when `page_url` is present; thumbnails become
 * image bubbles (caption = alt, Lightbox on click via the existing
 * image path). Video-only items render no bubble — the "Open at mm:ss"
 * button (rendered from the persisted evidence) covers them.
 */
export function evidenceToBubbles(items: RetrievalEvidenceItem[], subject: string): Bubble[] {
  const bubbles: Bubble[] = [];
  for (const item of items) {
    const body = nonBlank(item.text) ?? nonBlank(item.latex) ?? nonBlank(item.table_md);
    const link = item.page_url != null ? `\n\n[View full page](${item.page_url})` : "";
    if (body != null) {
      bubbles.push({ type: "markdown", md: `${body}${link}` });
    } else if (item.page_url != null) {
      bubbles.push({ type: "markdown", md: `[View full page](${item.page_url})` });
    }
    if (item.thumb_url != null) {
      const caption = nonBlank(item.caption);
      bubbles.push({
        type: "image",
        src: item.thumb_url,
        alt: caption ?? "Course material excerpt",
        label: caption ?? retrievalSourceLabel(subject, item),
      });
    }
  }
  return bubbles;
}

/** Video-bearing evidence for the "Open at mm:ss" buttons. */
export function evidenceVideos(
  items: RetrievalEvidenceItem[],
): Array<{ video: RetrievalVideoSegment; text: string | null; caption: string | null }> {
  return items.flatMap((item) =>
    item.video != null ? [{ video: item.video, text: item.text, caption: item.caption }] : [],
  );
}
