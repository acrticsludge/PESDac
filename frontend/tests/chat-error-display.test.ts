// Chat error display tests (chat-error-display spec §4–§5).
// The sync-error signal mirrors the toast copy verbatim: set on hydrate /
// history / persist / create failure, cleared on the matching success,
// silent on 401 (the global re-login flow owns it). Sidebar mutations
// (rename/pin/delete) stay toast-only. Provisional-hydrate-failed keeps the
// spinner off with the error set. No DOM library, no live backend: fetch is
// stubbed in the same router style as chat-backing.test.ts, `window` is
// minimally stubbed so the memory store activates, and fixtures are
// synthetic (`c-err-*`), never real.

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
  createChatBacked,
  getChatHydrateFailed,
  getChatMessagesStatus,
  getChatSyncError,
  getCreateSyncError,
  getHydrateSyncError,
  clearChatSyncError,
  hydrateChats,
  listCustomChats,
  loadChatMessages,
  persistAppendedBlock,
  persistTruncate,
  renameChatBacked,
  shouldShowThreadSkeleton,
  type ChatAuth,
  type CustomChat,
} from "../src/lib/session.ts";
import type { Block } from "../src/content/threads/types.ts";

__setAuthBaseForTesting("https://auth.test");
__setApiRootForTesting("https://api.test");

const AUTH: ChatAuth = { userId: "u-err-1", identityKey: "u-err-1:7" };

const HYDRATE_MSG = "Couldn't load your chats. Showing what's on this device.";
const HISTORY_MSG =
  "Couldn't load this chat's history. Showing what's on this device.";
const CREATE_MSG = "Couldn't create that chat. Try again.";
const APPEND_MSG = "Couldn't save that message. Try again.";
const TRUNCATE_MSG = "Couldn't update that chat. Try again.";

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
  return Array.from({ length: n }, (_, i) => () => tokenOk(`t-err-${i}`));
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

async function hydrateOneServerChat(
  apiLog: ApiCall[],
  code = "c-err-m",
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

// ---- Hydrate signal ----------------------------------------------------------

test("hydrate failure sets the hydrate error (toast copy) + failed flag", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter(tokens(10), [() => serverError()], apiLog),
  );
  try {
    const notifies: string[] = [];
    const result = await hydrateChats(AUTH, {
      notify: (body) => notifies.push(body),
    });
    assert.deepEqual(result, { status: "kept-memory" });
    assert.deepEqual(notifies, [HYDRATE_MSG]);
    assert.equal(getHydrateSyncError(), HYDRATE_MSG);
    assert.equal(getChatHydrateFailed(), true);
  } finally {
    restore();
  }
});

test("hydrate success clears the hydrate error + failed flag", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  const failRestore = __setFetchForTesting(
    makeRouter(tokens(10), [() => serverError()], apiLog),
  );
  try {
    await hydrateChats(AUTH);
  } finally {
    failRestore();
  }
  assert.equal(getChatHydrateFailed(), true);

  const row = serverChat("c-err-h");
  const okRestore = __setFetchForTesting(
    makeRouter(tokens(10), [() => apiJson(listEnvelope([row]))], apiLog),
  );
  try {
    const result = await hydrateChats(AUTH);
    assert.deepEqual(result, { status: "ready" });
  } finally {
    okRestore();
  }
  assert.equal(getHydrateSyncError(), null);
  assert.equal(getChatHydrateFailed(), false);
});

test("hydrate 401 stays silent: no toast, no signal", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter(tokens(10), [() => unauthorized()], apiLog),
  );
  try {
    const notifies: string[] = [];
    const result = await hydrateChats(AUTH, {
      notify: (body) => notifies.push(body),
    });
    assert.deepEqual(result, { status: "kept-memory" });
    assert.deepEqual(notifies, []);
    assert.equal(getHydrateSyncError(), null);
    assert.equal(getChatHydrateFailed(), false);
  } finally {
    restore();
  }
});

// ---- History signal ----------------------------------------------------------

test("history failure sets the per-chat error; retry success clears it", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  await hydrateOneServerChat(apiLog, "c-err-h");
  assert.equal(getChatSyncError("c-err-h"), null);

  const restore = __setFetchForTesting(
    makeRouter(
      tokens(10),
      [
        () => serverError(),
        () => apiJson(listEnvelope([])),
      ],
      apiLog,
    ),
  );
  try {
    const notifies: string[] = [];
    const notify = (body: string) => notifies.push(body);
    await loadChatMessages("c-err-h", AUTH, { notify });
    assert.equal(getChatMessagesStatus("c-err-h"), "failed");
    assert.deepEqual(notifies, [HISTORY_MSG]);
    assert.equal(getChatSyncError("c-err-h"), HISTORY_MSG);

    // The composer Retry clears optimistically, then the reload lands ready.
    clearChatSyncError("c-err-h");
    assert.equal(getChatSyncError("c-err-h"), null);
    await loadChatMessages("c-err-h", AUTH, { notify });
    assert.equal(getChatMessagesStatus("c-err-h"), "ready");
    assert.equal(getChatSyncError("c-err-h"), null);
    assert.equal(notifies.length, 1);
  } finally {
    restore();
  }
});

test("history 401: failed status, no toast, no signal", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  await hydrateOneServerChat(apiLog, "c-err-401");

  const restore = __setFetchForTesting(
    makeRouter(tokens(10), [() => unauthorized()], apiLog),
  );
  try {
    const notifies: string[] = [];
    await loadChatMessages("c-err-401", AUTH, {
      notify: (body) => notifies.push(body),
    });
    assert.equal(getChatMessagesStatus("c-err-401"), "failed");
    assert.deepEqual(notifies, []);
    assert.equal(getChatSyncError("c-err-401"), null);
  } finally {
    restore();
  }
});

// ---- Persist signal ----------------------------------------------------------

test("persist failures set the per-chat error; success clears it", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  await hydrateOneServerChat(apiLog, "c-err-p");

  const failRestore = __setFetchForTesting(
    makeRouter(tokens(10), [() => serverError(), () => serverError()], apiLog),
  );
  try {
    const notifies: string[] = [];
    const notify = (body: string) => notifies.push(body);
    assert.equal(
      await persistAppendedBlock("c-err-p", userBlock("unsaved"), AUTH, {
        notify,
      }),
      false,
    );
    assert.deepEqual(notifies, [APPEND_MSG]);
    assert.equal(getChatSyncError("c-err-p"), APPEND_MSG);

    assert.equal(
      await persistTruncate("c-err-p", 1, AUTH, { notify }),
      false,
    );
    assert.deepEqual(notifies, [APPEND_MSG, TRUNCATE_MSG]);
    assert.equal(getChatSyncError("c-err-p"), TRUNCATE_MSG);
  } finally {
    failRestore();
  }

  const okRestore = __setFetchForTesting(
    makeRouter(
      tokens(10),
      [() => apiJson(serverMessage("m-err-1", 0, userBlock("saved")), 201)],
      apiLog,
    ),
  );
  try {
    assert.equal(
      await persistAppendedBlock("c-err-p", userBlock("saved"), AUTH),
      true,
    );
    assert.equal(getChatSyncError("c-err-p"), null);
  } finally {
    okRestore();
  }
});

test("persist 401 stays silent: no toast, no signal", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  await hydrateOneServerChat(apiLog, "c-err-p401");

  const restore = __setFetchForTesting(
    makeRouter(tokens(10), [() => unauthorized()], apiLog),
  );
  try {
    const notifies: string[] = [];
    assert.equal(
      await persistAppendedBlock("c-err-p401", userBlock("x"), AUTH, {
        notify: (body) => notifies.push(body),
      }),
      false,
    );
    assert.deepEqual(notifies, []);
    assert.equal(getChatSyncError("c-err-p401"), null);
  } finally {
    restore();
  }
});

// ---- Create signal -----------------------------------------------------------

test("create failure sets the create error; success clears it", async () => {
  setup();
  const apiLog: ApiCall[] = [];

  const failRestore = __setFetchForTesting(
    makeRouter(tokens(10), [() => serverError()], apiLog),
  );
  try {
    const notifies: string[] = [];
    const chat = await createChatBacked("CN", "nope", AUTH, {
      notify: (body) => notifies.push(body),
    });
    assert.equal(chat, null);
    assert.deepEqual(notifies, [CREATE_MSG]);
    assert.equal(getCreateSyncError(), CREATE_MSG);
  } finally {
    failRestore();
  }

  const created = serverChat("c-err-c");
  const okRestore = __setFetchForTesting(
    makeRouter(tokens(10), [() => apiJson(created, 201)], apiLog),
  );
  try {
    const chat = await createChatBacked("CN", "yes", AUTH);
    assert.ok(chat);
    assert.equal(getCreateSyncError(), null);
  } finally {
    okRestore();
  }
});

test("create 401 stays silent: no toast, no signal", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter(tokens(10), [() => unauthorized()], apiLog),
  );
  try {
    const notifies: string[] = [];
    const chat = await createChatBacked("CN", "nope", AUTH, {
      notify: (body) => notifies.push(body),
    });
    assert.equal(chat, null);
    assert.deepEqual(notifies, []);
    assert.equal(getCreateSyncError(), null);
  } finally {
    restore();
  }
});

// ---- Scope guards ------------------------------------------------------------

test("guest paths set no signal (zero fetches, memory-only)", async () => {
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
    assert.equal(
      await persistAppendedBlock(chat.code, userBlock("hi"), null),
      true,
    );
    assert.equal(await persistTruncate(chat.code, 0, null), true);
    assert.deepEqual(apiLog, []);
    assert.equal(getCreateSyncError(), null);
    assert.equal(getHydrateSyncError(), null);
    assert.equal(getChatHydrateFailed(), false);
    assert.equal(getChatSyncError(chat.code), null);
  } finally {
    restore();
  }
});

test("sidebar rename failure stays toast-only (no composer signal)", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  await hydrateOneServerChat(apiLog, "c-err-m");

  const restore = __setFetchForTesting(
    makeRouter(tokens(10), [() => serverError()], apiLog),
  );
  try {
    const notifies: string[] = [];
    assert.equal(
      await renameChatBacked("c-err-m", "Renamed!", AUTH, {
        notify: (body) => notifies.push(body),
      }),
      false,
    );
    assert.deepEqual(notifies, ["Couldn't rename that chat. Try again."]);
    assert.equal(getChatSyncError("c-err-m"), null);
    assert.equal(getCreateSyncError(), null);
    assert.equal(getHydrateSyncError(), null);
  } finally {
    restore();
  }
});

// ---- Loader contract ---------------------------------------------------------

test("provisional-hydrate-failed: spinner off, thread error set", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter(tokens(10), [() => serverError()], apiLog),
  );
  try {
    await hydrateChats(AUTH);
  } finally {
    restore();
  }
  // Pesdac derivation: isHistoryLoading = provisional && !hydrateFailed.
  const provisional = true;
  const isHistoryLoading = provisional && !getChatHydrateFailed();
  assert.equal(isHistoryLoading, false);
  // No backed row, empty paint, failed hydrate → the thread composer error.
  assert.equal(getHydrateSyncError(), HYDRATE_MSG);
  // The skeleton predicate stays false off the loading path (failed and
  // idle both clear it; explicit provisional flags are consumed above).
  assert.equal(shouldShowThreadSkeleton(true, "failed", 0), false);
  assert.equal(shouldShowThreadSkeleton(false, "idle", 0), false);
});
