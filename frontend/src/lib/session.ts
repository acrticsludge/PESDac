// Client session store (in-memory, 2026-09-07): browser persistence is
// gone ahead of the backend move — nothing survives reload. Same
// signatures the backend will serve later (see send-path spec); a fetch
// adapter slots in without touching components. SSR-safe: empty data on
// server, real data after hydration via useSessionVersion().
//
// One-time hygiene below deletes pre-migration `pesdac-*` keys so stale
// browser data can never resurface. Afterwards nothing in the app uses
// browser storage again.

import { useEffect, useState } from "react";
import type { Block, Thread } from "../content/threads/types";
// Explicit `.ts` suffixes (not extensionless): the node test runner
// (`--experimental-transform-types`, no bundler resolution) requires
// them — extensionless imports fail there with ERR_MODULE_NOT_FOUND.
// Astro/Vite resolves both forms, so keep the suffixed form.
import { CHAT_CODES, dayDividerLabel } from "./chat.ts";
import { isCampus } from "./profile-options.ts";
import {
  apiAppendMessage,
  apiCreateChat,
  apiDeleteChat,
  apiListChats,
  apiListMessages,
  apiPatchChat,
  apiTruncateMessages,
  type ServerChat,
  type ServerMessage,
} from "./chat-sync.ts";

export type CustomChat = {
  code: string;
  subject: string;
  title: string;
  createdAt: string;
  // Server-backed rows (Phase 2): present only on chats hydrated from or
  // created through the server. Guest customs never carry these — their
  // absence is the guest-originated marker (adopt + key-set fallback).
  isPinned?: boolean;
  isArchived?: boolean;
  updatedAt?: string;
};

const CHATS_KEY = "pesdac-custom-chats-v1";
const OVERLAY_KEY = "pesdac-overlays-v1";

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((fn) => fn());
}

// Cross-tab sync died with browser persistence (no shared medium
// anymore). Same-tab reactivity still flows through emit(); real sync
// returns with the backend adapter.

// Purge pre-migration keys once per page load, client only. Afterwards
// the live store is memory and nothing reads browser storage again.
if (typeof window !== "undefined") {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key != null && key.startsWith("pesdac-")) doomed.push(key);
    }
    for (const key of doomed) window.localStorage.removeItem(key);
  } catch {
    // Storage denied (private mode) — nothing to purge and nothing lost:
    // the live store is memory either way.
  }
}

// Global shortcut bus (see chat-power spec §3): Pesdac owns the keydown
// listener; ThreadView and the welcome composer subscribe.
export const CANCEL_EVENT = "pesdac:cancel";
export const FOCUS_COMPOSER_EVENT = "pesdac:focus-composer";

/** Re-render the caller whenever the session store changes (client only). */
export function useSessionVersion() {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const fn = () => setVersion((v) => v + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
}

// In-memory JSON store (key → serialized value). No quota, no private-mode
// failure, no corruption — health hooks below are pinned to healthy so
// existing consumers (composer `status` warnings) keep compiling and simply
// never fire until the backend adapter owns them.

const mem = new Map<string, string>();

export function checkStorageHealth(): boolean {
  return true;
}

/** Always healthy while the store is memory-backed (SSR: true). */
export function useStorageHealth(): boolean {
  useSessionVersion();
  return true;
}

/** Always empty while the store is memory-backed (SSR: empty). */
export function useCorruptKeys(): string[] {
  useSessionVersion();
  return [];
}

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const raw = mem.get(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Unreachable in practice (we only ever write our own JSON), but never
    // let a bad entry wedge the session — drop it and fall back.
    mem.delete(key);
    return fallback;
  }
}

function writeJSON(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  mem.set(key, JSON.stringify(value));
}

/** Snapshot every store key (powers Export-my-data from memory). */
export function dumpStore(): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  const data: Record<string, unknown> = {};
  for (const [key, raw] of mem) {
    try {
      data[key] = JSON.parse(raw);
    } catch {
      data[key] = raw;
    }
  }
  return data;
}

const TAKEN = new Set(Object.values(CHAT_CODES));

function genCode(existing: CustomChat[]): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  for (;;) {
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    if (!TAKEN.has(code) && !existing.some((c) => c.code === code)) return code;
  }
}

export function listCustomChats(): CustomChat[] {
  return readJSON<CustomChat[]>(CHATS_KEY, []);
}

export function createCustomChat(subject: string, title: string): CustomChat {
  const existing = listCustomChats();
  const chat: CustomChat = {
    code: genCode(existing),
    subject,
    title: title.trim().slice(0, 34) || "New chat",
    createdAt: new Date().toISOString(),
  };
  writeJSON(CHATS_KEY, [...existing, chat]);
  emit();
  return chat;
}

export function getOverlay(code: string): Block[] {
  return readJSON<Record<string, Block[]>>(OVERLAY_KEY, {})[code] ?? [];
}

export function appendBlocks(code: string, blocks: Block[]) {
  const all = readJSON<Record<string, Block[]>>(OVERLAY_KEY, {});
  all[code] = [...(all[code] ?? []), ...blocks];
  writeJSON(OVERLAY_KEY, all);
  emit();
}

/** Pop the newest session-added block (for regenerate). Null when none. */
export function removeLastOverlayBlock(code: string): Block | null {
  const all = readJSON<Record<string, Block[]>>(OVERLAY_KEY, {});
  const list = all[code] ?? [];
  if (list.length === 0) return null;
  const removed = list[list.length - 1];
  all[code] = list.slice(0, -1);
  writeJSON(OVERLAY_KEY, all);
  emit();
  return removed;
}

/** Drop overlay blocks from `keep` on (for message edit: the edited user
 * turn and everything after it is replaced by the resend). */
export function truncateOverlay(code: string, keep: number) {
  const all = readJSON<Record<string, Block[]>>(OVERLAY_KEY, {});
  all[code] = (all[code] ?? []).slice(0, Math.max(0, keep));
  writeJSON(OVERLAY_KEY, all);
  emit();
}

export function renameCustomChat(code: string, title: string) {
  const clean = title.trim().slice(0, 34);
  if (!clean) return;
  writeJSON(
    CHATS_KEY,
    listCustomChats().map((c) =>
      c.code === code ? { ...c, title: clean } : c,
    ),
  );
  emit();
}

export function deleteCustomChat(code: string) {
  writeJSON(
    CHATS_KEY,
    listCustomChats().filter((c) => c.code !== code),
  );
  const all = readJSON<Record<string, Block[]>>(OVERLAY_KEY, {});
  delete all[code];
  writeJSON(OVERLAY_KEY, all);
  // Purge stale pin/archive refs.
  const key = `c:${code}`;
  writeJSON(
    PINS_KEY,
    readKeys(PINS_KEY).filter((k) => k !== key),
  );
  writeJSON(
    ARCHIVE_KEY,
    readKeys(ARCHIVE_KEY).filter((k) => k !== key),
  );
  emit();
}

// Demo-thread overrides (mockup stage): static registry stays canonical
// (routes + content untouched); renames/hides live in session only.

type DemoOverrides = {
  renamed: Record<string, string>;
  hidden: string[];
};

const DEMO_KEY = "pesdac-demo-overrides-v1";

function readDemoOverrides(): DemoOverrides {
  const raw = readJSON<Partial<DemoOverrides>>(DEMO_KEY, {});
  return {
    renamed: raw.renamed ?? {},
    hidden: raw.hidden ?? [],
  };
}

export function demoDisplayLabel(label: string): string {
  return readDemoOverrides().renamed[label] ?? label;
}

export function renameDemoChat(label: string, title: string) {
  const clean = title.trim().slice(0, 34);
  if (!clean) return;
  const overrides = readDemoOverrides();
  writeJSON(DEMO_KEY, {
    ...overrides,
    renamed: { ...overrides.renamed, [label]: clean },
  });
  emit();
}

// Pins + archive (custom chats by code, demo threads by label).

export type ChatRef = { kind: "custom" | "demo"; id: string };

const refKey = (ref: ChatRef) =>
  `${ref.kind === "custom" ? "c" : "d"}:${ref.id}`;

function parseRefKey(key: string): ChatRef | null {
  if (key.startsWith("c:")) return { kind: "custom", id: key.slice(2) };
  if (key.startsWith("d:")) return { kind: "demo", id: key.slice(2) };
  return null;
}

const PINS_KEY = "pesdac-pins-v1";
const ARCHIVE_KEY = "pesdac-archived-v1";

function readKeys(key: string): string[] {
  return readJSON<string[]>(key, []);
}

export function isPinned(ref: ChatRef): boolean {
  if (ref.kind === "custom") {
    const chat = listCustomChats().find((c) => c.code === ref.id);
    // Server flags rule once present (post-hydrate); pre-migration guest
    // rows carry no flags and keep today's key-set reads.
    if (chat?.isPinned !== undefined) return chat.isPinned;
  }
  return readKeys(PINS_KEY).includes(refKey(ref));
}

export function togglePin(ref: ChatRef) {
  const key = refKey(ref);
  const keys = readKeys(PINS_KEY);
  writeJSON(
    PINS_KEY,
    keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key],
  );
  emit();
}

export function listPinned(): ChatRef[] {
  const customs = listCustomChats();
  const flaggedIds = new Set(
    customs.filter((c) => c.isPinned !== undefined).map((c) => c.code),
  );
  const fromFlags: ChatRef[] = customs
    .filter((c) => c.isPinned === true)
    .map((c) => ({ kind: "custom" as const, id: c.code }));
  const fromKeys = readKeys(PINS_KEY)
    .map(parseRefKey)
    .filter((r): r is ChatRef => r != null)
    // Retired custom key-sets never resurface: customs carrying server
    // flags read from flags; key-sets cover demos + pre-migration guests.
    .filter((r) => r.kind === "demo" || !flaggedIds.has(r.id));
  return [...fromFlags, ...fromKeys];
}

export function isArchived(ref: ChatRef): boolean {
  if (ref.kind === "custom") {
    const chat = listCustomChats().find((c) => c.code === ref.id);
    // Same flags-rule as isPinned above.
    if (chat?.isArchived !== undefined) return chat.isArchived;
  }
  return readKeys(ARCHIVE_KEY).includes(refKey(ref));
}

export function archiveChat(ref: ChatRef) {
  const key = refKey(ref);
  const archived = readKeys(ARCHIVE_KEY);
  if (!archived.includes(key)) {
    writeJSON(ARCHIVE_KEY, [...archived, key]);
  }
  // Archiving unpins (a chat lives in one place).
  writeJSON(
    PINS_KEY,
    readKeys(PINS_KEY).filter((k) => k !== key),
  );
  emit();
}

export function unarchiveChat(ref: ChatRef) {
  const key = refKey(ref);
  writeJSON(
    ARCHIVE_KEY,
    readKeys(ARCHIVE_KEY).filter((k) => k !== key),
  );
  emit();
}

export function listArchived(): ChatRef[] {
  const customs = listCustomChats();
  const flaggedIds = new Set(
    customs.filter((c) => c.isArchived !== undefined).map((c) => c.code),
  );
  const fromFlags: ChatRef[] = customs
    .filter((c) => c.isArchived === true)
    .map((c) => ({ kind: "custom" as const, id: c.code }));
  const fromKeys = readKeys(ARCHIVE_KEY)
    .map(parseRefKey)
    .filter((r): r is ChatRef => r != null)
    // Same retirement rule as listPinned above.
    .filter((r) => r.kind === "demo" || !flaggedIds.has(r.id));
  return [...fromFlags, ...fromKeys];
}

const DEFAULT_REFERENCES = [
  { label: "Course Slides", description: "PESDac course material" },
  { label: "Textbook", description: "PESDac knowledge source" },
  { label: "Lecture Recordings", description: "PESDac knowledge source" },
];

/** Ephemeral thread shell for a custom chat; all turns live in its overlay. */
export function makeDraftThread(chat: CustomChat): Thread {
  const divider = dayDividerLabel("Today", chat.subject);
  return {
    label: chat.title,
    subject: chat.subject,
    mode: "ask",
    placeholder: `Ask anything about ${chat.subject}...`,
    composerReferenceItems: DEFAULT_REFERENCES,
    divider,
    blocks: [{ from: "system", text: divider, variant: "divider" }],
  };
}

// Per-answer feedback (mockup stage): static demo blocks are immutable, so
// votes live in a side map keyed `${sessionKey}:${blockIndex}` instead of
// on the blocks. Backend later: POST /turns/{id}/feedback.

export type FeedbackVote = "up" | "down";

const FEEDBACK_KEY = "pesdac-feedback-v1";

export function feedbackKey(sessionKey: string, blockIndex: number): string {
  return `${sessionKey}:${blockIndex}`;
}

export function getFeedback(voteKey: string): FeedbackVote | null {
  return readJSON<Record<string, FeedbackVote>>(FEEDBACK_KEY, {})[voteKey] ?? null;
}

export function setFeedback(voteKey: string, vote: FeedbackVote | null) {
  const all = readJSON<Record<string, FeedbackVote>>(FEEDBACK_KEY, {});
  if (vote == null) delete all[voteKey];
  else all[voteKey] = vote;
  writeJSON(FEEDBACK_KEY, all);
  emit();
}

// Unsent composer drafts (thread sessionKey, welcome uses "welcome").
// Local component state reads/writes these; no emit, so another tab never
// clobbers what you're typing.

const DRAFTS_KEY = "pesdac-drafts-v1";

export function readDraft(draftKey: string): string {
  return readJSON<Record<string, string>>(DRAFTS_KEY, {})[draftKey] ?? "";
}

export function writeDraft(draftKey: string, text: string) {
  const all = readJSON<Record<string, string>>(DRAFTS_KEY, {});
  if (text) all[draftKey] = text;
  else delete all[draftKey];
  writeJSON(DRAFTS_KEY, all);
}

// My Profile (mockup stage): identity + study/assistant/privacy prefs.
// Blank identity by user direction; everything merges over defaults so
// older stored payloads stay valid. Backend later binds these to an
// auth identity (see my-profile spec).

const PROFILE_KEY = "pesdac-profile-v1";

export type Profile = {
  displayName: string;
  email: string;
  institution: string;
  semester: string;
  branch: string;
  subjects: string[];
  examMonth: string;
  weeklyGoal: string;
  difficulty: string;
  depth: string;
  verbosity: string;
  proactiveQuiz: boolean;
  followUps: boolean;
  citations: string;
  retention: string;
  language: string;
  region: string;
  timezone: string;
  shortcutNewChat: boolean;
  shortcutCancel: boolean;
  shortcutFocus: boolean;
};

export const DEFAULT_PROFILE: Profile = {
  displayName: "",
  email: "",
  institution: "",
  semester: "",
  branch: "",
  subjects: [],
  examMonth: "",
  weeklyGoal: "5 days",
  difficulty: "medium",
  depth: "auto",
  verbosity: "balanced",
  proactiveQuiz: true,
  followUps: true,
  citations: "on request",
  retention: "forever",
  language: "en-US",
  region: "IN",
  timezone: "IST",
  shortcutNewChat: true,
  shortcutCancel: true,
  shortcutFocus: true,
};

export function getProfile(): Profile {
  const profile = { ...DEFAULT_PROFILE, ...readJSON<Partial<Profile>>(PROFILE_KEY, {}) };
  // D7: the institution key now carries the campus. Any legacy
  // free-text value maps to "" on read — RR/EC/blank are the only
  // legal values downstream.
  if (!isCampus(profile.institution)) profile.institution = "";
  return profile;
}

export function updateProfile(patch: Partial<Profile>) {
  writeJSON(PROFILE_KEY, { ...getProfile(), ...patch });
  emit();
}

// Server→local seed state (logout + Google relogin fix).
//
// Campus/semester/branch/subjects render from the LOCAL store, which is
// seeded from /profiles/me by the Pesdac hydration effect — but the
// IdentitySection skeleton used to watch only /auth/me (useProfile).
// These helpers give the seed its own explicit pending state so the
// section can skeleton the campus rows while the seed is in flight,
// plus an identity key so a stale user-A resolve can never seed user-B.
let profileSeedPending = false;
let seededIdentityKey: string | null = null;

/** True while the server→local profile seed fetch is in flight. */
export function getProfileSeedPending(): boolean {
  return profileSeedPending;
}

/** Publish a seed-flight edge; reactive via useSessionVersion(). */
export function setProfileSeedPending(pending: boolean): void {
  profileSeedPending = pending;
  emit();
}

/** Identity key (user id + auth epoch) that produced the current seed. */
export function getSeededIdentityKey(): string | null {
  return seededIdentityKey;
}

export function setSeededIdentityKey(key: string | null): void {
  seededIdentityKey = key;
  emit();
}

/** Build the identity key for a (user id, auth epoch) pair. */
export function identitySeedKey(userId: string, epoch: number): string {
  return `${userId}:${epoch}`;
}

/**
 * Skeleton predicate for IdentitySection (unit-testable; the component
 * calls it with its live statuses). While the server identity OR the
 * local profile seed is pending, the section skeletons — including the
 * campus/semester/branch rows. Ready-with-empty stays a valid state
 * (new user, blank campus renders the Select placeholder) and MUST be
 * visually distinct from pending: it returns false here.
 */
export function shouldShowIdentitySkeleton(
  authStatus: string,
  serverProfileStatus: string,
  seedPending: boolean,
): boolean {
  return (
    authStatus === "loading" ||
    serverProfileStatus === "loading" ||
    seedPending
  );
}

// ---- Chat skeleton loading state (spec §6 FR1) ---------------------------------

/** True while chat list hydration is in flight for the current identity. */
let chatHydratePending = false;

/** Identity key that produced the current chat hydration pending state. */
let chatHydrateIdentityKey: string | null = null;

/** True while the chat list hydrate is in flight. */
export function getChatHydratePending(): boolean {
  return chatHydratePending;
}

/**
 * Publish a hydrate-flight edge; reactive via useSessionVersion().
 * Identity-guarded: a stale resolve cannot clear a newer identity's pending bit.
 */
export function setChatHydratePending(
  pending: boolean,
  identityKey?: string | null,
): void {
  if (pending) {
    chatHydratePending = true;
    chatHydrateIdentityKey = identityKey ?? null;
  } else {
    // Only clear if identity matches (or no identity guard provided)
    if (identityKey == null || chatHydrateIdentityKey === identityKey) {
      chatHydratePending = false;
      chatHydrateIdentityKey = null;
    }
  }
  emit();
}

/**
 * Skeleton predicate for chat list (sidebar).
 * True iff authenticated && hydratePending && customCount === 0.
 * Pure and unit-testable.
 */
export function shouldShowChatListSkeleton(
  authStatus: string,
  hydratePending: boolean,
  customCount: number,
): boolean {
  return authStatus === "authenticated" && hydratePending && customCount === 0;
}

/**
 * Skeleton predicate for thread (message list).
 * True iff explicitFlag === true || (isBacked && msgStatus === "loading" && overlayLen === 0).
 * Pure and unit-testable.
 */
export function shouldShowThreadSkeleton(
  isBacked: boolean,
  msgStatus: "idle" | "loading" | "ready" | "failed",
  overlayLen: number,
  explicitFlag?: boolean,
): boolean {
  if (explicitFlag === true) return true;
  return isBacked && msgStatus === "loading" && overlayLen === 0;
}

/**
 * App readiness gate predicates (spec §3.2–§3.3, frozen).
 *
 * `userReady`: `loading` blocks on either signal; `error` settles (fail
 * open — the existing profile-error UI owns recovery, the gate must never
 * lock the user out). Guests lift the moment the guest proof lands
 * (`guest`/`guest` + seed never pends → ready in typically one frame).
 *
 * `chatReady`: guests have no server chats (always ready); authenticated
 * identities are ready only for the current identity key — stale keys
 * (post-logout, pre-hydrate) and pre-hydrate null are not ready.
 *
 * Pure and unit-tested (`frontend/tests/app-ready-gate.test.ts`); callers
 * read the live signals render-direct next to the existing
 * `listCustomChats()` reads (reactive via `useSessionVersion()`).
 */
export function userReady(
  authStatus: string,
  profileStatus: string,
  seedPending: boolean,
): boolean {
  return (
    authStatus !== "loading" &&
    profileStatus !== "loading" &&
    !seedPending
  );
}

export function chatReady(
  auth: ChatAuth,
  hydratedKey: string | null,
): boolean {
  if (auth == null) return true;
  return hydratedKey === auth.identityKey;
}

/**
 * Logout hygiene (called from apiLogout): drop the old identity's
 * campus/semester/branch/subjects seed and retag to logged-out so the
 * next login reseeds from scratch. Preference fields (language, weekly
 * goal, …) are device-level and preserved — only identity data clears.
 */
export function clearLocalProfileSeed(): void {
  writeJSON(PROFILE_KEY, {
    ...getProfile(),
    institution: "",
    semester: "",
    branch: "",
    subjects: [],
  });
  profileSeedPending = false;
  seededIdentityKey = null;
  emit();
}

// Delete every chat: customs plus all session-added turns (including live
// turns on demo threads). Votes, drafts, and profile are personal state,
// not chats, and are kept.
export function clearAllChats() {
  writeJSON(CHATS_KEY, []);
  writeJSON(OVERLAY_KEY, {});
  emit();
}

// ---- Server backing (chat persistence Phase 2, spec §5) -------------------
//
// Memory stays the synchronous render cache (reads above are unchanged);
// when authenticated, mutations write through to the server with snapshot
// rollback + one toast (slice-12 contract). Guests stay memory-only:
// every backing entry early-returns before any fetch, so the guest path
// is byte-identical to today's behavior. `unknown`-tag windows never
// hydrate: callers only build a ChatAuth for `authenticated` status —
// `loading`/`guest` never produce one (fail closed to current behavior).

/** Authenticated identity for chat backing; null = guest/unknown (memory-only). */
export type ChatAuth = { userId: string; identityKey: string } | null;

/** Error surfacing (components pass their toast bridge; tests record calls). */
export type ChatNotify = (body: string) => void;

function isAuthFailure(error: unknown): boolean {
  // 401s flow through the existing global envelope handler (apiFetch
  // dispatches AUTH_REQUIRED_EVENT + re-login), so backing adds no error
  // UI beyond it. Detected structurally — importing auth.ts here would
  // close an auth→session→chat-sync→auth cycle at module-eval time
  // (auth already imports this module for clearLocalProfileSeed).
  if (typeof error === "object" && error !== null) {
    const record = error as { name?: unknown; status?: unknown };
    if (record.name === "AuthRequiredError") return true;
    if (record.status === 401) return true;
  }
  return false;
}

function notifyFailure(
  error: unknown,
  notify: ChatNotify | undefined,
  body: string,
): void {
  if (notify == null || isAuthFailure(error)) return;
  notify(body);
}

function fromServerChat(row: ServerChat): CustomChat {
  return {
    code: row.code,
    subject: row.subject,
    title: row.title,
    createdAt: row.createdAt,
    isPinned: row.isPinned,
    isArchived: row.isArchived,
    updatedAt: row.updatedAt,
  };
}

/** True when the code is a server-backed custom row (flags present). */
export function isServerChat(code: string): boolean {
  return listCustomChats().some(
    (c) => c.code === code && c.updatedAt !== undefined,
  );
}

/** Replace a chat's overlay blocks wholesale (rollback + server-load apply). */
export function setOverlay(code: string, blocks: Block[]) {
  const all = readJSON<Record<string, Block[]>>(OVERLAY_KEY, {});
  all[code] = [...blocks];
  writeJSON(OVERLAY_KEY, all);
  emit();
}

// Hydration + message-load state (identity-scoped: entries carry the
// identityKey that produced them, TaggedCache philosophy — a stale
// user-A resolve can never satisfy user-B, same as the profile seed).
let chatHydratedKey: string | null = null;

type MessageLoadState = {
  status: "loading" | "ready" | "failed";
  identityKey: string;
};
const messageStates = new Map<string, MessageLoadState>();

/** Identity key that produced the current hydrated chat list (if any). */
export function getChatHydratedKey(): string | null {
  return chatHydratedKey;
}

/** Load status for one chat's server turns (drives the open-chat skeleton). */
export function getChatMessagesStatus(
  code: string,
): "idle" | "loading" | "ready" | "failed" {
  return messageStates.get(code)?.status ?? "idle";
}

// Block ⇄ message-row serialization. The server stores each turn as a
// serialized Block payload (spec §3.1 content JSONB); role mirrors
// Block.from exactly. `seq` is server-assigned — memory order stays
// append-order and no seq is ever synthesized client-side.
// Wire strip (chat-history-lean-storage FR1, full): drop render-only
// fields before POST so they are never stored in JSONB + TOAST.
// Reload-safe: `time` is re-stamped from the server `createdAt` in
// `messageToBlock`, and ThreadView recomputes `footer ?? PESDac · subject`
// plus `error.retryText` (last-user-text fallback) at render — stripped
// rows paint identically to live turns. Deep-clones: memory never mutates.
export function toWireBlock(block: Block): Block {
  const wire = JSON.parse(JSON.stringify(block)) as Record<string, unknown>;
  delete wire.time;
  delete wire.toolCallsExpanded;
  delete wire.toolCallsAfter;
  delete wire.footer;
  if (Array.isArray(wire.followUps) && wire.followUps.length === 0) {
    delete wire.followUps;
  }
  const error = wire.error;
  if (typeof error === "object" && error !== null) {
    delete (error as Record<string, unknown>).retryText;
  }
  return wire as unknown as Block;
}

function blockToMessage(block: Block): {
  role: "user" | "assistant" | "system";
  content: unknown;
} {
  return { role: block.from, content: toWireBlock(block) };
}

function messageToBlock(m: ServerMessage): Block | null {
  const c = m.content;
  if (typeof c === "object" && c !== null) {
    const b = c as Partial<Block>;
    if (b.from === "user" || b.from === "assistant" || b.from === "system") {
      // Reload recompute (FR1): stripped rows regain `time` from the
      // server `createdAt` — render never sees an undefined Timestamp.
      // System divider blocks carry no `time` by type; leave them alone.
      if ((b.from === "user" || b.from === "assistant") && b.time == null) {
        return {
          ...(c as Record<string, unknown>),
          time: m.createdAt,
        } as Block;
      }
      return c as Block;
    }
  }
  // Never synthesize turns from payloads we don't understand — skip the
  // row and keep the memory paint (fail closed).
  return null;
}

// ---- Container mutations (write-through, snapshot rollback + toast) --------

export async function createChatBacked(
  subject: string,
  title: string,
  auth: ChatAuth,
  opts?: { notify?: ChatNotify },
): Promise<CustomChat | null> {
  if (auth == null) return createCustomChat(subject, title);
  const clean = title.trim().slice(0, 34) || "New chat";
  try {
    const chat = fromServerChat(await apiCreateChat(subject, clean));
    writeJSON(CHATS_KEY, [...listCustomChats(), chat]);
    emit();
    return chat;
  } catch (error) {
    notifyFailure(error, opts?.notify, "Couldn't create that chat. Try again.");
    return null;
  }
}

export async function renameChatBacked(
  code: string,
  title: string,
  auth: ChatAuth,
  opts?: { notify?: ChatNotify },
): Promise<boolean> {
  const clean = title.trim().slice(0, 34);
  if (!clean) return false;
  if (auth == null || !isServerChat(code)) {
    renameCustomChat(code, title);
    return true;
  }
  const before = listCustomChats();
  renameCustomChat(code, clean); // optimistic paint (sync, emits)
  try {
    const row = await apiPatchChat(code, { title: clean });
    writeJSON(
      CHATS_KEY,
      listCustomChats().map((c) =>
        c.code === code
          ? { ...c, title: row.title, updatedAt: row.updatedAt }
          : c,
      ),
    );
    emit();
    return true;
  } catch (error) {
    writeJSON(CHATS_KEY, before); // exact rollback
    emit();
    notifyFailure(error, opts?.notify, "Couldn't rename that chat. Try again.");
    return false;
  }
}

// Delete stays non-optimistic (slice-12): the server leg lands first,
// memory follows; failure keeps the chat + one toast.
export async function deleteChatBacked(
  code: string,
  auth: ChatAuth,
  opts?: { notify?: ChatNotify },
): Promise<boolean> {
  if (auth == null || !isServerChat(code)) {
    deleteCustomChat(code);
    return true;
  }
  try {
    await apiDeleteChat(code);
  } catch (error) {
    notifyFailure(error, opts?.notify, "Couldn't delete that chat. Try again.");
    return false;
  }
  deleteCustomChat(code);
  return true;
}

export async function setPinBacked(
  ref: ChatRef,
  pinned: boolean,
  auth: ChatAuth,
  opts?: { notify?: ChatNotify },
): Promise<boolean> {
  if (ref.kind === "demo" || auth == null || !isServerChat(ref.id)) {
    const now = isPinned(ref);
    if (now !== pinned) togglePin(ref);
    return true;
  }
  const prev = listCustomChats().find((c) => c.code === ref.id);
  if (prev?.isPinned === pinned) return true;
  writeJSON(
    CHATS_KEY,
    listCustomChats().map((c) =>
      c.code === ref.id ? { ...c, isPinned: pinned } : c,
    ),
  );
  emit();
  try {
    const row = await apiPatchChat(ref.id, { isPinned: pinned });
    writeJSON(
      CHATS_KEY,
      listCustomChats().map((c) =>
        c.code === ref.id
          ? { ...c, isPinned: row.isPinned, updatedAt: row.updatedAt }
          : c,
      ),
    );
    emit();
    return true;
  } catch (error) {
    writeJSON(
      CHATS_KEY,
      listCustomChats().map((c) => (c.code === ref.id && prev ? prev : c)),
    );
    emit();
    notifyFailure(
      error,
      opts?.notify,
      pinned ? "Couldn't pin that chat. Try again." : "Couldn't unpin that chat. Try again.",
    );
    return false;
  }
}

export async function setArchivedBacked(
  ref: ChatRef,
  archived: boolean,
  auth: ChatAuth,
  opts?: { notify?: ChatNotify },
): Promise<boolean> {
  if (ref.kind === "demo" || auth == null || !isServerChat(ref.id)) {
    const now = isArchived(ref);
    if (archived && !now) archiveChat(ref);
    else if (!archived && now) unarchiveChat(ref);
    return true;
  }
  const prev = listCustomChats().find((c) => c.code === ref.id);
  if (prev?.isArchived === archived) return true;
  // Archiving unpins (mirrors archiveChat: a chat lives in one place).
  writeJSON(
    CHATS_KEY,
    listCustomChats().map((c) =>
      c.code === ref.id
        ? { ...c, isArchived: archived, isPinned: archived ? false : c.isPinned }
        : c,
    ),
  );
  emit();
  try {
    const row = await apiPatchChat(
      ref.id,
      archived ? { isArchived: true, isPinned: false } : { isArchived: false },
    );
    writeJSON(
      CHATS_KEY,
      listCustomChats().map((c) =>
        c.code === ref.id
          ? {
              ...c,
              isArchived: row.isArchived,
              isPinned: row.isPinned,
              updatedAt: row.updatedAt,
            }
          : c,
      ),
    );
    emit();
    return true;
  } catch (error) {
    writeJSON(
      CHATS_KEY,
      listCustomChats().map((c) => (c.code === ref.id && prev ? prev : c)),
    );
    emit();
    notifyFailure(
      error,
      opts?.notify,
      archived ? "Couldn't archive that chat. Try again." : "Couldn't restore that chat. Try again.",
    );
    return false;
  }
}

// ---- Turn persistence (guests/demos no-op before any fetch) ----------------

export async function persistAppendedBlock(
  code: string,
  block: Block,
  auth: ChatAuth,
  opts?: { notify?: ChatNotify },
): Promise<boolean> {
  if (auth == null || !isServerChat(code)) return true;
  const m = blockToMessage(block);
  try {
    await apiAppendMessage(code, m);
    return true;
  } catch (error) {
    notifyFailure(error, opts?.notify, "Couldn't save that message. Try again.");
    return false;
  }
}

export async function persistTruncate(
  code: string,
  fromSeq: number,
  auth: ChatAuth,
  opts?: { notify?: ChatNotify },
): Promise<boolean> {
  if (auth == null || !isServerChat(code)) return true;
  try {
    await apiTruncateMessages(code, fromSeq);
    return true;
  } catch (error) {
    notifyFailure(error, opts?.notify, "Couldn't update that chat. Try again.");
    return false;
  }
}

// ---- Message load (open-chat loads once; failure keeps memory paint) -------

export async function loadChatMessages(
  code: string,
  auth: ChatAuth,
  opts?: { notify?: ChatNotify },
): Promise<Block[]> {
  if (auth == null || !isServerChat(code)) return getOverlay(code);
  const current = messageStates.get(code);
  if (
    current &&
    current.identityKey === auth.identityKey &&
    current.status !== "failed"
  ) {
    return getOverlay(code); // ready or in-flight: memory paint rules
  }
  messageStates.set(code, { status: "loading", identityKey: auth.identityKey });
  emit();
  try {
    const rows = await apiListMessages(code);
    const blocks = rows
      .map(messageToBlock)
      .filter((b): b is Block => b !== null);
    setOverlay(code, blocks);
    messageStates.set(code, { status: "ready", identityKey: auth.identityKey });
    emit();
    return blocks;
  } catch (error) {
    messageStates.set(code, { status: "failed", identityKey: auth.identityKey });
    emit();
    notifyFailure(
      error,
      opts?.notify,
      "Couldn't load this chat's history. Showing what's on this device.",
    );
    return getOverlay(code);
  }
}

// ---- Hydrate + adopt + pin/archive migration --------------------------------

export type HydrateResult =
  | { status: "guest" }
  | { status: "already" }
  | { status: "ready" }
  | { status: "kept-memory" };

function dropMemoryChat(code: string) {
  writeJSON(
    CHATS_KEY,
    listCustomChats().filter((c) => c.code !== code),
  );
  const all = readJSON<Record<string, Block[]>>(OVERLAY_KEY, {});
  delete all[code];
  writeJSON(OVERLAY_KEY, all);
  const key = `c:${code}`;
  writeJSON(
    PINS_KEY,
    readKeys(PINS_KEY).filter((k) => k !== key),
  );
  writeJSON(
    ARCHIVE_KEY,
    readKeys(ARCHIVE_KEY).filter((k) => k !== key),
  );
}

// Guest→login adopt (best-effort, bounded): memory customs at first
// authenticated hydrate are POSTed — container + overlay blocks in order —
// then dropped from memory. Per-chat all-or-nothing: any failure keeps
// that chat's memory copy untouched for the next login. A partial server
// write (container created, later leg failed) can leave a server row
// whose retry duplicates it — exact-once adopt needs idempotency keys,
// which the frozen §3/§4 contract doesn't offer (reported, not worked
// around here).
async function adoptGuestChats(opts?: { notify?: ChatNotify }): Promise<void> {
  const candidates = listCustomChats().filter((c) => c.updatedAt === undefined);
  for (const chat of candidates) {
    const blocks = getOverlay(chat.code);
    const pinned = readKeys(PINS_KEY).includes(`c:${chat.code}`);
    const archived = readKeys(ARCHIVE_KEY).includes(`c:${chat.code}`);
    try {
      const created = await apiCreateChat(chat.subject, chat.title);
      for (const block of blocks) {
        const m = blockToMessage(block);
        await apiAppendMessage(created.code, m);
      }
      if (pinned || archived) {
        await apiPatchChat(created.code, {
          ...(pinned ? { isPinned: true } : {}),
          ...(archived ? { isArchived: true, isPinned: false } : {}),
        });
      }
      dropMemoryChat(chat.code);
      emit();
    } catch (error) {
      if (isAuthFailure(error)) return; // global flow owns 401s; keep memory
      // Skip the chat — memory stays for the next login (no toast per
      // chat; hydrate reports once if the list leg itself fails).
      void opts;
    }
  }
}

// First-sync pin/archive migration: one PATCH per memory-flagged chat
// present in the server list, once. Afterwards the key-sets retire (the
// `c:` refs are deleted below — flags rule) while demo (`d:`) refs stay,
// since demos never sync and keep key-set reads.
async function migratePinArchiveFlags(
  serverCodes: Set<string>,
  opts?: { notify?: ChatNotify },
): Promise<void> {
  const pins = new Set(
    readKeys(PINS_KEY)
      .filter((k) => k.startsWith("c:"))
      .map((k) => k.slice(2)),
  );
  const archived = new Set(
    readKeys(ARCHIVE_KEY)
      .filter((k) => k.startsWith("c:"))
      .map((k) => k.slice(2)),
  );
  const targets = [...new Set([...pins, ...archived])].filter((id) =>
    serverCodes.has(id),
  );
  if (targets.length > 0) {
    try {
      for (const id of targets) {
        await apiPatchChat(id, {
          isPinned: pins.has(id),
          isArchived: archived.has(id),
        });
      }
    } catch (error) {
      // Keep the sets untouched so the next hydrate retries.
      notifyFailure(
        error,
        opts?.notify,
        "Couldn't sync your pinned chats. They'll retry next login.",
      );
      return;
    }
  }
  // RETIREMENT: server flags are now authoritative for custom chats — the
  // memory `c:` key-sets retire (deleted) here. Demo refs are preserved.
  writeJSON(
    PINS_KEY,
    readKeys(PINS_KEY).filter((k) => !k.startsWith("c:")),
  );
  writeJSON(
    ARCHIVE_KEY,
    readKeys(ARCHIVE_KEY).filter((k) => !k.startsWith("c:")),
  );
}

export async function hydrateChats(
  auth: ChatAuth,
  opts?: { notify?: ChatNotify },
): Promise<HydrateResult> {
  if (auth == null) return { status: "guest" };
  if (chatHydratedKey === auth.identityKey) return { status: "already" };
  // Set hydrate pending after guest/already early-returns (identity-guarded)
  setChatHydratePending(true, auth.identityKey);
  // Order ops: adopt FIRST, then hydrate-replace — an adopted chat is
  // already dropped from memory when the server list lands, so it can
  // never double-list under its old guest code and its new server code.
  await adoptGuestChats(opts);
  let server: ServerChat[];
  try {
    server = await apiListChats();
  } catch (error) {
    // Failed hydrate keeps the memory paint + one toast.
    notifyFailure(
      error,
      opts?.notify,
      "Couldn't load your chats. Showing what's on this device.",
    );
    setChatHydratePending(false, auth.identityKey);
    return { status: "kept-memory" };
  }
  const serverCodes = new Set(server.map((s) => s.code));
  // Failed-adopt memory customs (still pending for the next login) are
  // preserved alongside the server truth — never wiped by the replace.
  const pending = listCustomChats().filter((c) => !serverCodes.has(c.code));
  writeJSON(CHATS_KEY, [...server.map(fromServerChat), ...pending]);
  await migratePinArchiveFlags(serverCodes, opts);
  // Turn caches belong to the previous world — drop them so turns reload
  // against the hydrated list.
  messageStates.clear();
  chatHydratedKey = auth.identityKey;
  setChatHydratePending(false, auth.identityKey);
  emit();
  return { status: "ready" };
}

// ---- Test hooks -------------------------------------------------------------

export function __resetChatBackingForTesting(): void {
  mem.delete(CHATS_KEY);
  mem.delete(OVERLAY_KEY);
  mem.delete(PINS_KEY);
  mem.delete(ARCHIVE_KEY);
  chatHydratedKey = null;
  chatHydratePending = false;
  chatHydrateIdentityKey = null;
  messageStates.clear();
}
