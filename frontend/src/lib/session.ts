// Client session store (mockup stage): custom chats + per-conversation message
// overlays persisted to localStorage. Same signatures the backend will serve
// later (see send-path spec). SSR-safe: empty data on server, real data after
// hydration via useSessionVersion().

import { useEffect, useState } from "react";
import type { Block, Thread } from "../content/threads/types";
import { CHAT_CODES, dayDividerLabel } from "./chat";

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

/** True only after client mount. Session reads during render must resolve
 * to empty until mount so SSR HTML and first client paint agree. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return mounted;
}

// localStorage health (quota / private mode). writeJSON flips the flag on
// every write; the probe covers first paint before any write happens.
let storageHealth: boolean | null = null;

export function checkStorageHealth(): boolean {
  if (typeof window === "undefined") return true;
  if (storageHealth != null) return storageHealth;
  try {
    const key = "pesdac-storage-probe";
    window.localStorage.setItem(key, "1");
    window.localStorage.removeItem(key);
    storageHealth = true;
  } catch {
    storageHealth = false;
  }
  return storageHealth;
}

/** Storage health, re-checked on every store change (SSR: true). */
export function useStorageHealth(): boolean {
  useSessionVersion();
  const mounted = useMounted();
  if (!mounted) return true;
  return checkStorageHealth();
}

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    storageHealth = true;
  } catch {
    // Storage unavailable (private mode, quota) — session stays in memory
    // and subscribers re-render into the warning state.
    storageHealth = false;
    emit();
  }
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

export function isDemoHidden(label: string): boolean {
  return readDemoOverrides().hidden.includes(label);
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
