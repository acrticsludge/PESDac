// Client session store (mockup stage): custom chats + per-conversation message
// overlays persisted to localStorage. Same signatures the backend will serve
// later (see send-path spec). SSR-safe: empty data on server, real data after
// hydration via useSessionVersion().

import { useEffect, useState } from "react";
import type { Block, Thread } from "../content/threads/types";
import { CHAT_CODES } from "./chat";

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
  } catch {
    // Storage unavailable (private mode, quota) — session stays in memory.
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

export function hideDemoChat(label: string) {
  const overrides = readDemoOverrides();
  if (overrides.hidden.includes(label)) return;
  writeJSON(DEMO_KEY, {
    ...overrides,
    hidden: [...overrides.hidden, label],
  });
  emit();
}

const DEFAULT_REFERENCES = [
  { label: "Course Slides", description: "PESDac course material" },
  { label: "Textbook", description: "PESDac knowledge source" },
  { label: "Lecture Recordings", description: "PESDac knowledge source" },
];

/** Ephemeral thread shell for a custom chat; all turns live in its overlay. */
export function makeDraftThread(chat: CustomChat): Thread {
  return {
    label: chat.title,
    subject: chat.subject,
    mode: "ask",
    placeholder: `Ask anything about ${chat.subject}...`,
    composerReferenceItems: DEFAULT_REFERENCES,
    divider: "Today",
    blocks: [{ from: "system", text: "Today", variant: "divider" }],
  };
}
