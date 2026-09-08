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

export type CustomChat = {
  code: string;
  subject: string;
  title: string;
  createdAt: string;
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
  return readKeys(PINS_KEY)
    .map(parseRefKey)
    .filter((r): r is ChatRef => r != null);
}

export function isArchived(ref: ChatRef): boolean {
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
  return readKeys(ARCHIVE_KEY)
    .map(parseRefKey)
    .filter((r): r is ChatRef => r != null);
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
