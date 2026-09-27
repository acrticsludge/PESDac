// Retrieval banner dismissal store + copy selection (spec §4.4, §5).
//
// Device-local like drafts — never server state, never cross-identity.
// Cleared on identity transition and on search success (flap = new
// incident). Clock is injectable via nowMs (tests stub it, zero sleeps).

import { useEffect, useState } from "react";
import { apiFetch } from "./auth.ts";
import { shouldForegroundRefetch } from "./cache-revalidation.ts";
import { parseReferenceIds, sourceTarget } from "./references.ts";
import type { RetrievalEvidenceItem } from "../content/threads/types.ts";

export const RETRIEVAL_BANNER_KEY = "pesdac:retrieval-banner";

/** Quiet window after dismissal before the same code may re-show (1 h). */
export const RETRIEVAL_BANNER_QUIET_MS = 3600000;

export type RetrievalIncidentCode =
  | "EMBED_UNREACHABLE"
  | "EMBED_MISCONFIGURED"
  | "EMBED_SPACE_MISMATCH";

export type BannerStatus = "error" | "warning";

export type RetrievalDismissal = {
  code: string;
  dismissedAt: number;
};

export type RetrievalCopy = {
  title: string;
  message: string;
  status: BannerStatus;
};

/** Default bar description (§4.2 example) when the envelope has no copy. */
export const RETRIEVAL_BANNER_DESCRIPTION =
  "Your course material can't be reached right now. Your chats and settings still work — new questions will wait until search is back.";

/** Dismiss control name (§4.2 example). */
export const RETRIEVAL_BANNER_DISMISS_LABEL = "Dismiss search outage notice";

export type RetrievalBannerView = {
  status: BannerStatus;
  container: "section";
  title: string;
  description: string;
  dismissLabel: string;
};

const COPY_TABLE: Record<RetrievalIncidentCode, { title: string; status: BannerStatus }> = {
  EMBED_UNREACHABLE: {
    title: "Search is temporarily unavailable",
    status: "error",
  },
  EMBED_MISCONFIGURED: {
    title: "Search isn't available right now",
    status: "warning",
  },
  EMBED_SPACE_MISMATCH: {
    title: "Search index needs a refresh. Let your instructor know.",
    status: "warning",
  },
};

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Newest dismissal, or null when absent/corrupt/unavailable. */
export function readRetrievalBannerDismissal(): RetrievalDismissal | null {
  const store = storage();
  if (store == null) return null;
  try {
    const raw = store.getItem(RETRIEVAL_BANNER_KEY);
    if (raw == null) return null;
    const parsed = JSON.parse(raw) as Partial<RetrievalDismissal>;
    if (typeof parsed.code !== "string" || typeof parsed.dismissedAt !== "number") {
      return null;
    }
    return { code: parsed.code, dismissedAt: parsed.dismissedAt };
  } catch {
    return null;
  }
}

/** Record a dismissal for the incident class. Never throws. */
export function recordRetrievalBannerDismissal(
  code: RetrievalIncidentCode,
  nowMs: number = Date.now(),
): void {
  const store = storage();
  if (store == null) return;
  try {
    store.setItem(RETRIEVAL_BANNER_KEY, JSON.stringify({ code, dismissedAt: nowMs }));
  } catch {
    // Storage denied (private mode) — the bar simply re-shows.
  }
}

/**
 * Clear the stored dismissal: call on search success (flap = new
 * incident) and on identity transition (never cross-identity).
 */
export function clearRetrievalBannerDismissal(): void {
  const store = storage();
  if (store == null) return;
  try {
    store.removeItem(RETRIEVAL_BANNER_KEY);
  } catch {
    // Storage denied — nothing to clear.
  }
}

/**
 * True when the downtime bar may mount for `code`:
 * - nothing dismissed, or
 * - a different code arrived (502 → 503 or reverse), or
 * - the 1 h quiet window elapsed since dismissal.
 * Same code inside the window stays hidden.
 */
export function shouldShowRetrievalBanner(
  code: RetrievalIncidentCode,
  nowMs: number = Date.now(),
): boolean {
  const stored = readRetrievalBannerDismissal();
  if (stored == null) return true;
  if (stored.code !== code) return true;
  return nowMs - stored.dismissedAt >= RETRIEVAL_BANNER_QUIET_MS;
}

/** 502 is always error; 503 starts warning, error when persistent. */
export function bannerStatusForCode(
  code: RetrievalIncidentCode,
  isPersistent = false,
): BannerStatus {
  if (code === "EMBED_UNREACHABLE") return "error";
  if (isPersistent) return "error";
  return COPY_TABLE[code]?.status ?? "warning";
}

/**
 * Copy rule (§3): the envelope error.message wins when present;
 * §5 titles are fallbacks for unreadable bodies (network failure).
 */
export function selectRetrievalCopy(args: {
  code: RetrievalIncidentCode;
  envelopeMessage?: string | null;
}): RetrievalCopy {
  const fallback = COPY_TABLE[args.code] ?? {
    title: "Search is temporarily unavailable",
    status: "error" as const,
  };
  const envelope = args.envelopeMessage?.trim();
  return {
    title: fallback.title,
    message: envelope ? envelope : fallback.title,
    status: fallback.status,
  };
}

/**
 * Bar view model (§4.2): the exact Banner props the downtime bar
 * renders. Title stays the per-code fallback; the envelope renders
 * as the description when present, else the §4.2 default copy.
 */
export function retrievalBannerView(args: {
  code: RetrievalIncidentCode;
  envelopeMessage?: string | null;
  isPersistent?: boolean;
}): RetrievalBannerView {
  const copy = selectRetrievalCopy(args);
  const envelope = args.envelopeMessage?.trim();
  return {
    status: bannerStatusForCode(args.code, args.isPersistent),
    container: "section",
    title: copy.title,
    description: envelope ? envelope : RETRIEVAL_BANNER_DESCRIPTION,
    dismissLabel: RETRIEVAL_BANNER_DISMISS_LABEL,
  };
}

// ---- Downtime incident slot (§4.2: one bar at a time) ----------------------
//
// Memory-only single slot: the newest incident replaces (never stacked).
// ThreadView sets it on 502/503 search failures (T5) and clears it on
// search success; Pesdac renders the AppShell banner from it. Dismissal
// persistence lives in the localStorage store above — clearing the slot
// never clears the dismissal (the 1 h quiet window still applies).

/** Bus name for bar-Retry: ThreadView replays the last search on it. */
export const RETRIEVAL_RETRY_EVENT = "pesdac:retrieval-retry";

export type RetrievalIncident = {
  code: RetrievalIncidentCode;
  envelopeMessage?: string | null;
};

let currentIncident: RetrievalIncident | null = null;
const incidentListeners = new Set<() => void>();

export function getRetrievalIncident(): RetrievalIncident | null {
  return currentIncident;
}

export function setRetrievalIncident(incident: RetrievalIncident | null): void {
  currentIncident = incident;
  incidentListeners.forEach((notify) => {
    try {
      notify();
    } catch {
      // A stale listener must not break the refresh for the rest.
    }
  });
}

function subscribeRetrievalIncident(fn: () => void): () => void {
  incidentListeners.add(fn);
  return () => {
    incidentListeners.delete(fn);
  };
}

/**
 * Render the slot value, re-rendering on every set. Subscription idiom
 * mirrors `useSessionVersion` (SSR-safe: server and first client paint
 * read the same null, effects never run on the server).
 */
export function useRetrievalIncident(): RetrievalIncident | null {
  const [, setVersion] = useState(0);
  useEffect(() => {
    return subscribeRetrievalIncident(() => setVersion((v) => v + 1));
  }, []);
  return getRetrievalIncident();
}

/** Ask ThreadView to replay the last search (bar Retry). Never throws. */
export function requestRetrievalRetry(): void {
  try {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event(RETRIEVAL_RETRY_EVENT));
  } catch {
    // SSR teardown — the click that asked is already gone.
  }
}

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
