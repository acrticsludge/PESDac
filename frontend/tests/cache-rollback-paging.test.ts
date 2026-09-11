// Per-row rollback + complete hydration regression tests (caching Phase 3).
// (a) rename failure restores ONLY the renamed row (concurrent confirmed ops
// on other chats survive); (b) hydrate pages past limit=50, requests archived
// rows explicitly, and never paints a truncated list as `ready`; (c) thread
// load shows the tail window (newest turns) via the existing *Page helpers.
// Style mirrors cache-identity-reset / cache-resolve-guards tests.

import test from "node:test";
import assert from "node:assert/strict";

if (typeof (globalThis as Record<string, unknown>).window === "undefined") {
  (globalThis as Record<string, unknown>).window = {
    dispatchEvent() {},
    addEventListener() {},
    removeEventListener() {},
  };
}

import {
  __resetAuthCachesForTesting,
  __setApiRootForTesting,
  __setAuthBaseForTesting,
  __setFetchForTesting,
} from "../src/lib/auth.ts";
import {
  __resetChatBackingForTesting,
  getChatMessagesStatus,
  getHydrateSyncError,
  hydrateChats,
  listCustomChats,
  loadChatMessages,
  renameChatBacked,
  setPinBacked,
  type ChatAuth,
  type CustomChat,
} from "../src/lib/session.ts";
import type { Block } from "../src/content/threads/types.ts";

__setAuthBaseForTesting("https://auth.test");
__setApiRootForTesting("https://api.test");

const AUTH: ChatAuth = { userId: "u-ph3-1", identityKey: "u-ph3-1:7" };

function tokenOk(token: string): Response {
  return new Response(JSON.stringify({ token }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function apiJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function failJson(status = 500): Response {
  return new Response(JSON.stringify({ error: { code: "boom", message: "boom" } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function tokens(n: number): Array<() => Response> {
  return Array.from({ length: n }, (_, i) => () => tokenOk(`t-ph3-${i}`));
}

function serverChat(code: string, overrides: Partial<CustomChat> = {}) {
  return {
    code,
    subject: "CN",
    title: `Chat ${code}`,
    isPinned: false,
    isArchived: false,
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
    ...overrides,
  };
}

function userBlock(text: string): Block {
  return {
    from: "user",
    bubbles: [{ type: "text", text }],
    time: "2026-09-09T00:00:00.000Z",
  };
}

function serverMessage(id: string, seq: number, block: Block) {
  return {
    id,
    seq,
    role: block.from,
    content: block,
    createdAt: "2026-09-09T00:00:00.000Z",
  };
}

function blockText(b: Block): string {
  if (!("bubbles" in b)) return "";
  const bubble = (b.bubbles as Array<{ text?: string; md?: string }>)[0];
  return bubble?.text ?? bubble?.md ?? "";
}

type ApiCall = { method: string; url: string; body: unknown };

function makeQueueRouter(
  tokenQueue: Array<() => Response | Promise<Response>>,
  apiQueue: Array<() => Response | Promise<Response>>,
  apiLog: ApiCall[],
): typeof fetch {
  return (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/auth/token")) {
      const next = tokenQueue.shift();
      if (!next) throw new Error(`token fetch with empty queue: ${url}`);
      return next();
    }
    const raw = init?.body;
    let body: unknown;
    try {
      body = typeof raw === "string" && raw ? JSON.parse(raw) : undefined;
    } catch {
      body = raw;
    }
    apiLog.push({ method: init?.method ?? "GET", url, body });
    const next = apiQueue.shift();
    if (!next) throw new Error(`api fetch with empty queue: ${url}`);
    return next();
  }) as typeof fetch;
}

function setup() {
  __resetAuthCachesForTesting();
  __resetChatBackingForTesting();
}

async function hydrateCodes(apiLog: ApiCall[], codes: string[]): Promise<void> {
  const rows = codes.map((c) => serverChat(c));
  const restore = __setFetchForTesting(
    makeQueueRouter(
      tokens(10),
      [
        () => apiJson(chatEnvelope(rows, rows.length)),
        () => apiJson(chatEnvelope([], 0)),
      ],
      apiLog,
    ),
  );
  try {
    const result = await hydrateChats(AUTH);
    assert.deepEqual(result, { status: "ready" });
  } finally {
    restore();
  }
}

function chatEnvelope(data: unknown[], total: number, limit = 50, offset = 0) {
  return { data, pagination: { limit, offset, total } };
}

function msgEnvelope(data: unknown[], total: number, limit = 200, offset = 0) {
  return { data, pagination: { limit, offset, total } };
}

// ---- (1) rename per-row rollback --------------------------------------------

test("rename failure preserves a concurrent pin success on another chat", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  await hydrateCodes(apiLog, ["c-ph3-a", "c-ph3-b"]);
  const titleBefore = listCustomChats().find((c) => c.code === "c-ph3-a")?.title;

  let releaseRename!: (res: Response) => void;
  const renameGate = new Promise<Response>((resolve) => {
    releaseRename = resolve;
  });
  const restore = __setFetchForTesting(
    makeQueueRouter(
      tokens(10),
      [
        () => renameGate,
        () =>
          apiJson(
            serverChat("c-ph3-b", { isPinned: true, updatedAt: "2026-09-09T00:00:02.000Z" }),
          ),
      ],
      apiLog,
    ),
  );
  try {
    const pendingRename = renameChatBacked("c-ph3-a", "Renamed A", AUTH);
    // Concurrent confirmed op on ANOTHER chat lands while the rename is in flight.
    assert.equal(await setPinBacked({ kind: "custom", id: "c-ph3-b" }, true, AUTH), true);
    releaseRename(failJson(500));
    assert.equal(await pendingRename, false);

    const afterA = listCustomChats().find((c) => c.code === "c-ph3-a");
    const afterB = listCustomChats().find((c) => c.code === "c-ph3-b");
    assert.equal(afterA?.title, titleBefore, "renamed row restored exactly");
    assert.equal(afterB?.isPinned, true, "concurrent pin success survives the rollback");
  } finally {
    restore();
  }
});

// ---- (2) hydrate paging (incl. archived) ------------------------------------

function pagedChatsRouter(apiLog: ApiCall[], opts?: { failSecondPage?: boolean }) {
  const TOTAL_OPEN = 70;
  const TOTAL_ARCHIVED = 3;
  const openRows = Array.from({ length: TOTAL_OPEN }, (_, i) =>
    serverChat(`c-ph3-p${i}`, { updatedAt: "2026-09-09T00:00:00.000Z" }),
  );
  const archivedRows = Array.from({ length: TOTAL_ARCHIVED }, (_, i) =>
    serverChat(`c-ph3-arch${i}`, { isArchived: true, updatedAt: "2026-09-09T00:00:00.000Z" }),
  );
  return (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/auth/token")) return tokenOk("t-ph3-paged");
    const raw = init?.body;
    let body: unknown;
    try {
      body = typeof raw === "string" && raw ? JSON.parse(raw) : undefined;
    } catch {
      body = raw;
    }
    apiLog.push({ method: init?.method ?? "GET", url, body });
    if ((init?.method ?? "GET") !== "GET") {
      // Migration PATCH echo: apply the patch onto a placeholder row.
      const code = url.split("/").pop()?.split("?")[0] ?? "unknown";
      return apiJson({ ...serverChat(code), ...((body as Record<string, unknown>) ?? {}) });
    }
    const u = new URL(url);
    const archived = u.searchParams.get("archived") === "true";
    const limit = Number(u.searchParams.get("limit") ?? (archived ? 50 : 50));
    const offset = Number(u.searchParams.get("offset") ?? 0);
    const rows = archived ? archivedRows : openRows;
    if (!archived && opts?.failSecondPage === true && offset > 0) return failJson(500);
    const slice = rows.slice(offset, offset + (Number.isFinite(limit) ? limit : rows.length));
    return apiJson(chatEnvelope(slice, rows.length, limit, offset));
  }) as typeof fetch;
}

test("hydrate with total 73 pages fully, archived rows listed", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(pagedChatsRouter(apiLog));
  try {
    const result = await hydrateChats(AUTH);
    assert.deepEqual(result, { status: "ready" });
    const codes = new Set(listCustomChats().map((c) => c.code));
    assert.equal(codes.size, 73, `all 73 chats hydrate (got ${codes.size})`);
    for (const row of listCustomChats().filter((c) => c.code.startsWith("c-ph3-arch"))) {
      assert.equal(row.isArchived, true, `${row.code} keeps its archived flag`);
    }
    const chatCalls = apiLog.filter((c) => c.method === "GET" && c.url.includes("/chats"));
    assert.ok(chatCalls.length > 1, "page loop follows pagination.total past limit=50");
    assert.ok(
      chatCalls.some((c) => c.url.includes("archived=true")),
      "archived rows requested explicitly",
    );
  } finally {
    restore();
  }
});

test("hydrate that cannot complete paging refuses ready with the error affordance", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(pagedChatsRouter(apiLog, { failSecondPage: true }));
  try {
    const result = await hydrateChats(AUTH);
    assert.notEqual(
      (result as { status: string }).status,
      "ready",
      "a truncated list is never painted as truth",
    );
    assert.ok(getHydrateSyncError() != null, "existing error affordance surfaces");
  } finally {
    restore();
  }
});

// ---- (3) message tail window --------------------------------------------------

function pagedMessagesRouter(apiLog: ApiCall[], total: number) {
  const rows = Array.from({ length: total }, (_, i) =>
    serverMessage(`m-ph3-${i}`, i, userBlock(`turn-${i}`)),
  );
  return (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/auth/token")) return tokenOk("t-ph3-msg");
    const raw = init?.body;
    let body: unknown;
    try {
      body = typeof raw === "string" && raw ? JSON.parse(raw) : undefined;
    } catch {
      body = raw;
    }
    apiLog.push({ method: init?.method ?? "GET", url, body });
    if (url.includes("/messages")) {
      const u = new URL(url);
      const limit = Number(u.searchParams.get("limit") ?? 200);
      const offset = Number(u.searchParams.get("offset") ?? 0);
      const slice = rows.slice(offset, offset + (Number.isFinite(limit) ? limit : rows.length));
      return apiJson(msgEnvelope(slice, rows.length, limit, offset));
    }
    // Chat list leg for the hydrate preamble: one chat, one page.
    return apiJson(chatEnvelope([serverChat("c-ph3-tail")], 1));
  }) as typeof fetch;
}

test("250-turn thread shows the newest turns (tail window), ready", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(pagedMessagesRouter(apiLog, 250));
  try {
    const result = await hydrateChats(AUTH);
    assert.deepEqual(result, { status: "ready" });
    const blocks = await loadChatMessages("c-ph3-tail", AUTH);
    const texts = blocks.map(blockText);
    assert.ok(texts.includes("turn-249"), "newest turn visible");
    assert.ok(texts.includes("turn-200"), "tail window covers the newest turns");
    assert.ok(!texts.includes("turn-0"), "oldest turn aged out of the tail window");
    assert.equal(getChatMessagesStatus("c-ph3-tail"), "ready");
    const msgCalls = apiLog.filter((c) => c.method === "GET" && c.url.includes("/messages"));
    assert.ok(
      msgCalls.some((c) => c.url.includes("offset=200")),
      `tail offset requested (got ${msgCalls.map((c) => c.url).join(" | ")})`,
    );
  } finally {
    restore();
  }
});
