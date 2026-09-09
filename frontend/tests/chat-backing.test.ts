// Chat server-backing tests (spec §5 — Stream C).
// Hydrate-replaces, failed-hydrate-keeps-memory, adopt-once/adopt-retry,
// rollback-on-forced-failure per mutation, guest-untouched (zero fetches),
// pin/archive migration + key-set retirement, message load once/failure,
// and 401s surfacing no extra error UI (the global flow owns them).
// No DOM library, no live backend: fetch is stubbed in the same router
// style as chat-sync.test.ts (token endpoint vs API endpoint from
// queues), `window` is minimally stubbed so the memory store activates,
// and fixtures are synthetic (`c-back-*` / `m-back-*`), never real.

import test from "node:test";
import assert from "node:assert/strict";

// The memory store gates on `window` existing (SSR returns fallbacks).
// Stubbed before any session write; each file runs in its own process
// under `node --test`, so this cannot leak into other suites.
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
  appendBlocks,
  createChatBacked,
  createCustomChat,
  deleteChatBacked,
  getChatMessagesStatus,
  getOverlay,
  hydrateChats,
  isServerChat,
  listCustomChats,
  loadChatMessages,
  persistAppendedBlock,
  persistTruncate,
  renameChatBacked,
  setArchivedBacked,
  setPinBacked,
  isArchived,
  isPinned,
  listArchived,
  listPinned,
  togglePin,
  archiveChat,
  type ChatAuth,
  type CustomChat,
} from "../src/lib/session.ts";
import type { Block } from "../src/content/threads/types.ts";

__setAuthBaseForTesting("https://auth.test");
__setApiRootForTesting("https://api.test");

const AUTH: ChatAuth = { userId: "u-back-1", identityKey: "u-back-1:7" };
const AUTH_NEXT: ChatAuth = { userId: "u-back-1", identityKey: "u-back-1:8" };

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

function nestedError(code: string, message: string): Record<string, unknown> {
  return { error: { code, message } };
}

function serverError(): Response {
  return apiJson(nestedError("SERVER_ERROR", "Boom."), 500);
}

function unauthorized(): Response {
  return apiJson(nestedError("AUTH_REQUIRED", "Sign in to continue."), 401);
}

type ApiCall = { method: string; url: string; body: unknown };

/** Routes token mints and API calls from separate queues; records API calls. */
function makeRouter(
  tokenQueue: Array<() => Response>,
  apiQueue: Array<() => Response | Promise<never>>,
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

function tokens(n: number): Array<() => Response> {
  return Array.from({ length: n }, (_, i) => () => tokenOk(`t-back-${i}`));
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

function listEnvelope(data: unknown[]) {
  return {
    data,
    pagination: { limit: 200, offset: 0, total: data.length },
  };
}

function userBlock(text: string): Block {
  return {
    from: "user",
    bubbles: [{ type: "text", text }],
    time: "2026-09-09T00:00:00.000Z",
  };
}

function assistantBlock(md: string): Block {
  return {
    from: "assistant",
    bubbles: [{ type: "markdown", md }],
    time: "2026-09-09T00:00:00.000Z",
    footer: "PESDac · CN",
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

function setup() {
  __resetAuthCachesForTesting();
  __resetChatBackingForTesting();
}

// ---- Hydrate ---------------------------------------------------------------

test("hydrate adopts guest customs first, then replaces memory with the server list", async () => {
  setup();
  const guest = createCustomChat("CN", "guest notes");
  appendBlocks(guest.code, [userBlock("hello"), assistantBlock("hi there")]);
  const guestEmpty = createCustomChat("OS", "empty guest");

  const apiLog: ApiCall[] = [];
  const createdA = serverChat("c-back-a");
  const createdB = serverChat("c-back-b");
  const restore = __setFetchForTesting(
    makeRouter(
      tokens(10),
      [
        () => apiJson(createdA, 201),
        () => apiJson(serverMessage("m-back-1", 0, userBlock("hello")), 201),
        () => apiJson(serverMessage("m-back-2", 1, assistantBlock("hi there")), 201),
        () => apiJson(createdB, 201),
        () => apiJson(listEnvelope([createdA, createdB])),
      ],
      apiLog,
    ),
  );
  try {
    const notifies: string[] = [];
    const result = await hydrateChats(AUTH, {
      notify: (body) => notifies.push(body),
    });
    assert.deepEqual(result, { status: "ready" });
    assert.deepEqual(notifies, []);
    // Adopt ran BEFORE the list leg (adopt-then-hydrate-replace ordering).
    assert.deepEqual(
      apiLog.map((c) => `${c.method} ${c.url}`),
      [
        "POST https://api.test/api/v1/chats",
        "POST https://api.test/api/v1/chats/c-back-a/messages",
        "POST https://api.test/api/v1/chats/c-back-a/messages",
        "POST https://api.test/api/v1/chats",
        "GET https://api.test/api/v1/chats",
      ],
    );
    // Adopted guest codes are dropped — never double-listed.
    const codes = listCustomChats().map((c) => c.code);
    assert.deepEqual(codes, ["c-back-a", "c-back-b"]);
    assert.ok(!codes.includes(guest.code));
    assert.ok(!codes.includes(guestEmpty.code));
    assert.equal(getOverlay(guest.code).length, 0);
    assert.ok(isServerChat("c-back-a"));
  } finally {
    restore();
  }
});

test("failed hydrate keeps the memory paint and fires exactly one toast", async () => {
  setup();
  const guest = createCustomChat("CN", "keep me");
  appendBlocks(guest.code, [userBlock("saved")]);

  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter(
      tokens(10),
      [
        // Adopt fails (container leg) — the chat stays for the next login.
        () => serverError(),
        // The list leg fails too — memory paint rules.
        () => serverError(),
      ],
      apiLog,
    ),
  );
  try {
    const notifies: string[] = [];
    const result = await hydrateChats(AUTH, {
      notify: (body) => notifies.push(body),
    });
    assert.deepEqual(result, { status: "kept-memory" });
    assert.deepEqual(notifies, [
      "Couldn't load your chats. Showing what's on this device.",
    ]);
    assert.deepEqual(
      listCustomChats().map((c) => c.code),
      [guest.code],
    );
    assert.deepEqual(getOverlay(guest.code), [userBlock("saved")]);
  } finally {
    restore();
  }
});

test("failed adopt retries on the next login, never twice within one identity", async () => {
  setup();
  const guest = createCustomChat("CN", "retry me");
  appendBlocks(guest.code, [userBlock("again")]);

  // Login 1: adopt fails, list succeeds — guest copy is preserved pending.
  const apiLog1: ApiCall[] = [];
  const restore1 = __setFetchForTesting(
    makeRouter(
      tokens(10),
      [() => serverError(), () => apiJson(listEnvelope([serverChat("c-back-s")]))],
      apiLog1,
    ),
  );
  try {
    const result = await hydrateChats(AUTH);
    assert.deepEqual(result, { status: "ready" });
    assert.deepEqual(
      listCustomChats().map((c) => c.code),
      ["c-back-s", guest.code],
    );
  } finally {
    restore1();
  }

  // Same identity: already hydrated — zero refetches, zero duplicate POSTs.
  const apiLog2: ApiCall[] = [];
  const restore2 = __setFetchForTesting(
    makeRouter(tokens(10), [], apiLog2),
  );
  try {
    // Empty API queue: any fetch throws, so silence proves no fetch.
    const result = await hydrateChats(AUTH);
    assert.deepEqual(result, { status: "already" });
    assert.deepEqual(apiLog2, []);
  } finally {
    restore2();
  }

  // Next login (new identity key): adopt retries and succeeds, then the
  // hydrated list replaces memory with no duplicates.
  const apiLog3: ApiCall[] = [];
  const adopted = serverChat("c-back-n");
  const restore3 = __setFetchForTesting(
    makeRouter(
      tokens(10),
      [
        () => apiJson(adopted, 201),
        () => apiJson(serverMessage("m-back-3", 0, userBlock("again")), 201),
        () => apiJson(listEnvelope([serverChat("c-back-s"), adopted])),
      ],
      apiLog3,
    ),
  );
  try {
    const result = await hydrateChats(AUTH_NEXT);
    assert.deepEqual(result, { status: "ready" });
    const codes = listCustomChats().map((c) => c.code);
    assert.deepEqual(codes, ["c-back-s", "c-back-n"]);
    assert.ok(!codes.includes(guest.code));
  } finally {
    restore3();
  }
});

test("guests and unknown-tag windows never hydrate (no fetch, memory untouched)", async () => {
  setup();
  const guest = createCustomChat("CN", "guest only");

  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter(tokens(10), [], apiLog),
  );
  try {
    // Null auth covers guests AND unknown-tag windows (callers only build
    // an identity for `authenticated` status — fail closed).
    assert.deepEqual(await hydrateChats(null), { status: "guest" });
    assert.deepEqual(apiLog, []);
    assert.deepEqual(
      listCustomChats().map((c) => c.code),
      [guest.code],
    );
  } finally {
    restore();
  }
});

// ---- Mutation rollback ------------------------------------------------------

async function hydrateOneServerChat(
  apiLog: ApiCall[],
  code = "c-back-m",
): Promise<CustomChat> {
  const row = serverChat(code);
  const restore = __setFetchForTesting(
    makeRouter(tokens(10), [() => apiJson(listEnvelope([row]))], apiLog),
  );
  try {
    const result = await hydrateChats(AUTH);
    assert.deepEqual(result, { status: "ready" });
  } finally {
    restore();
  }
  const chat = listCustomChats().find((c) => c.code === code);
  assert.ok(chat);
  return chat as CustomChat;
}

test("rename rollback restores the exact prior paint + one toast", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  await hydrateOneServerChat(apiLog);

  const restore = __setFetchForTesting(
    makeRouter(tokens(10), [() => serverError()], apiLog),
  );
  try {
    const notifies: string[] = [];
    const ok = await renameChatBacked("c-back-m", "Renamed!", AUTH, {
      notify: (body) => notifies.push(body),
    });
    assert.equal(ok, false);
    assert.deepEqual(notifies, ["Couldn't rename that chat. Try again."]);
    assert.equal(
      listCustomChats().find((c) => c.code === "c-back-m")?.title,
      "Chat c-back-m",
    );
  } finally {
    restore();
  }
});

test("pin rollback restores the flag + one toast", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  await hydrateOneServerChat(apiLog);
  const ref = { kind: "custom" as const, id: "c-back-m" };
  assert.equal(isPinned(ref), false);

  const restore = __setFetchForTesting(
    makeRouter(tokens(10), [() => serverError()], apiLog),
  );
  try {
    const notifies: string[] = [];
    const ok = await setPinBacked(ref, true, AUTH, {
      notify: (body) => notifies.push(body),
    });
    assert.equal(ok, false);
    assert.deepEqual(notifies, ["Couldn't pin that chat. Try again."]);
    assert.equal(isPinned(ref), false);
    assert.deepEqual(listPinned(), []);
  } finally {
    restore();
  }
});

test("failed server delete keeps the chat + one toast (non-optimistic)", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  await hydrateOneServerChat(apiLog);

  const restore = __setFetchForTesting(
    makeRouter(tokens(10), [() => serverError()], apiLog),
  );
  try {
    const notifies: string[] = [];
    const ok = await deleteChatBacked("c-back-m", AUTH, {
      notify: (body) => notifies.push(body),
    });
    assert.equal(ok, false);
    assert.deepEqual(notifies, ["Couldn't delete that chat. Try again."]);
    assert.deepEqual(
      listCustomChats().map((c) => c.code),
      ["c-back-m"],
    );
  } finally {
    restore();
  }
});

test("failed user-block persist rolls back the optimistic paint + one toast", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  await hydrateOneServerChat(apiLog, "c-back-t");

  const restore = __setFetchForTesting(
    makeRouter(tokens(10), [() => serverError()], apiLog),
  );
  try {
    const notifies: string[] = [];
    const ok = await persistAppendedBlock(
      "c-back-t",
      userBlock("unsaved"),
      AUTH,
      { notify: (body) => notifies.push(body) },
    );
    assert.equal(ok, false);
    assert.deepEqual(notifies, ["Couldn't save that message. Try again."]);
    assert.deepEqual(
      apiLog.map((c) => `${c.method} ${c.url}`).at(-1),
      "POST https://api.test/api/v1/chats/c-back-t/messages",
    );
  } finally {
    restore();
  }
});

test("failed truncate rolls back + one toast", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  await hydrateOneServerChat(apiLog, "c-back-r");

  const restore = __setFetchForTesting(
    makeRouter(tokens(10), [() => serverError()], apiLog),
  );
  try {
    const notifies: string[] = [];
    const ok = await persistTruncate("c-back-r", 1, AUTH, {
      notify: (body) => notifies.push(body),
    });
    assert.equal(ok, false);
    assert.deepEqual(notifies, ["Couldn't update that chat. Try again."]);
    assert.deepEqual(
      apiLog.map((c) => `${c.method} ${c.url}`).at(-1),
      "DELETE https://api.test/api/v1/chats/c-back-r/messages?from_seq=1",
    );
  } finally {
    restore();
  }
});

// ---- Guest-untouched --------------------------------------------------------

test("guest mutations stay memory-only with zero fetches", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter(tokens(10), [], apiLog),
  );
  try {
    // Empty API queue: any fetch throws, so every assertion below also
    // proves no fetch happened.
    const chat = await createChatBacked("CN", "guest chat", null);
    assert.ok(chat);
    assert.equal(isServerChat(chat.code), false);
    assert.equal(
      await renameChatBacked(chat.code, "renamed guest", null),
      true,
    );
    assert.equal(
      listCustomChats().find((c) => c.code === chat.code)?.title,
      "renamed guest",
    );
    const ref = { kind: "custom" as const, id: chat.code };
    assert.equal(await setPinBacked(ref, true, null), true);
    assert.equal(isPinned(ref), true);
    assert.equal(await setArchivedBacked(ref, true, null), true);
    assert.equal(isArchived(ref), true);
    assert.equal(await setArchivedBacked(ref, false, null), true);
    assert.equal(await deleteChatBacked(chat.code, null), true);
    assert.deepEqual(listCustomChats(), []);
    // Turn legs no-op before any fetch.
    assert.equal(await persistAppendedBlock("x", userBlock("hi"), null), true);
    assert.equal(await persistTruncate("x", 0, null), true);
    assert.deepEqual(apiLog, []);
  } finally {
    restore();
  }
});

// ---- Pin/archive migration --------------------------------------------------

test("first sync migrates memory pin/archive flags once, then retires the key-sets", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  // Seed the server row via hydrate, then simulate a logged-out key-set
  // toggle (reconciliation case): the flag lives in the key-set while the
  // memory row already carries (stale) server flags.
  await hydrateOneServerChat(apiLog, "c-back-p");
  togglePin({ kind: "custom", id: "c-back-p" });
  assert.equal(isPinned({ kind: "custom", id: "c-back-p" }), false);

  // A demo pin shares the key-set and must survive retirement.
  archiveChat({ kind: "demo", id: "demo-label" });
  assert.deepEqual(listArchived(), [{ kind: "demo", id: "demo-label" }]);

  const patched = serverChat("c-back-p", { isPinned: true });
  const restore = __setFetchForTesting(
    makeRouter(
      tokens(10),
      [
        () => apiJson(listEnvelope([patched])),
        () => apiJson(patched),
      ],
      apiLog,
    ),
  );
  try {
    const notifies: string[] = [];
    const result = await hydrateChats(AUTH_NEXT, {
      notify: (body) => notifies.push(body),
    });
    assert.deepEqual(result, { status: "ready" });
    assert.deepEqual(notifies, []);
    // One PATCH per flagged chat present server-side.
    const patches = apiLog.filter((c) => c.method === "PATCH");
    assert.equal(patches.length, 1);
    assert.equal(patches[0].url, "https://api.test/api/v1/chats/c-back-p");
    assert.deepEqual(patches[0].body, { isPinned: true, isArchived: false });
    // Flags rule after migration; custom key-sets retired, demo refs stay.
    assert.equal(isPinned({ kind: "custom", id: "c-back-p" }), true);
    assert.deepEqual(
      listPinned().filter((r) => r.kind === "custom"),
      [{ kind: "custom", id: "c-back-p" }],
    );
    assert.deepEqual(listArchived(), [{ kind: "demo", id: "demo-label" }]);
  } finally {
    restore();
  }
});

// ---- Message load -----------------------------------------------------------

test("open-chat loads server turns once; failure keeps memory paint + one toast", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  const rowH = serverChat("c-back-h");
  const rowF = serverChat("c-back-f");
  const seedRestore = __setFetchForTesting(
    makeRouter(tokens(10), [() => apiJson(listEnvelope([rowH, rowF]))], apiLog),
  );
  try {
    assert.deepEqual(await hydrateChats(AUTH), { status: "ready" });
  } finally {
    seedRestore();
  }
  assert.equal(getChatMessagesStatus("c-back-h"), "idle");

  const u = userBlock("loaded question");
  const a = assistantBlock("loaded answer");
  const restore = __setFetchForTesting(
    makeRouter(
      tokens(10),
      [
        // h-1 loads fine.
        () =>
          apiJson(
            listEnvelope([
              serverMessage("m-back-10", 0, u),
              serverMessage("m-back-11", 1, a),
            ]),
          ),
        // h-2 fails — memory paint survives + one toast, retry stays open.
        () => serverError(),
        // h-2 retry succeeds.
        () => apiJson(listEnvelope([serverMessage("m-back-12", 0, u)])),
      ],
      apiLog,
    ),
  );
  try {
    const notifies: string[] = [];
    const notify = (body: string) => notifies.push(body);
    const blocks = await loadChatMessages("c-back-h", AUTH, { notify });
    assert.deepEqual(blocks, [u, a]);
    assert.deepEqual(getOverlay("c-back-h"), [u, a]);
    assert.equal(getChatMessagesStatus("c-back-h"), "ready");
    assert.deepEqual(notifies, []);

    // Ready rows never refetch (same identity, no new message legs).
    const again = await loadChatMessages("c-back-h", AUTH, { notify });
    assert.deepEqual(again, [u, a]);
    assert.equal(
      apiLog.filter((c) => c.url.endsWith("/messages")).length,
      1,
    );

    // Failed load: memory paint stays, one toast, status failed.
    const failed = await loadChatMessages("c-back-f", AUTH, { notify });
    assert.deepEqual(failed, []);
    assert.equal(getChatMessagesStatus("c-back-f"), "failed");
    assert.deepEqual(notifies, [
      "Couldn't load this chat's history. Showing what's on this device.",
    ]);

    // Retry after failure is allowed and lands ready.
    const retried = await loadChatMessages("c-back-f", AUTH, { notify });
    assert.deepEqual(retried, [u]);
    assert.equal(getChatMessagesStatus("c-back-f"), "ready");
    assert.equal(notifies.length, 1);
  } finally {
    restore();
  }
});

test("401s add no error UI beyond the existing global flow", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  await hydrateOneServerChat(apiLog, "c-back-401");

  const restore = __setFetchForTesting(
    makeRouter(tokens(10), [() => unauthorized()], apiLog),
  );
  try {
    const notifies: string[] = [];
    const blocks = await loadChatMessages("c-back-401", AUTH, {
      notify: (body) => notifies.push(body),
    });
    // Memory paint stays, status records the failure, and no toast fires —
    // apiFetch already routed the 401 through AUTH_REQUIRED_EVENT.
    assert.deepEqual(blocks, []);
    assert.equal(getChatMessagesStatus("c-back-401"), "failed");
    assert.deepEqual(notifies, []);
  } finally {
    restore();
  }
});
