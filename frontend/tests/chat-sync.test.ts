// Chat-sync client contract tests (spec §4 — Stream B).
// One success-mapping test per function + error propagation (401->
// AuthRequiredError, 404->ApiError with body, network failure->
// TypeError passthrough) + a 204-no-body case. No DOM library, no live
// backend: fetch is stubbed in the same router style as
// auth-api.test.ts (token endpoint vs API endpoint from queues), and
// each test records request path/method/body plus the mapped return.
// Fixtures are synthetic (`c-test-*` / `m-test-*`), never real.

import test from "node:test";
import assert from "node:assert/strict";

import {
  apiAppendMessage,
  apiClearChats,
  apiCreateChat,
  apiDeleteChat,
  apiListChats,
  apiListMessages,
  apiPatchChat,
  apiTruncateMessages,
} from "../src/lib/chat-sync.ts";
import {
  ApiError,
  AuthRequiredError,
  __resetAuthCachesForTesting,
  __setApiRootForTesting,
  __setAuthBaseForTesting,
  __setFetchForTesting,
} from "../src/lib/auth.ts";

__setAuthBaseForTesting("https://auth.test");
__setApiRootForTesting("https://api.test");

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

function noContent(): Response {
  return new Response(null, { status: 204 });
}

function nestedError(code: string, message: string): Record<string, unknown> {
  return { error: { code, message } };
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

function chatFixture(code: string) {
  return {
    code,
    subject: "physics",
    title: "Test chat",
    isPinned: false,
    isArchived: false,
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
  };
}

function messageFixture(id: string, seq: number) {
  return {
    id,
    seq,
    role: "user",
    content: { text: "hello" },
    createdAt: "2026-09-09T00:00:00.000Z",
  };
}

// ---- Success mapping (one test per function) -------------------------------

test("apiListChats GETs bare /chats and returns the data array", async () => {
  __resetAuthCachesForTesting();
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter(
      [() => tokenOk("t-list")],
      [
        () =>
          apiJson({
            data: [chatFixture("c-test-1"), chatFixture("c-test-2")],
            pagination: { limit: 50, offset: 0, total: 2 },
          }),
      ],
      apiLog,
    ),
  );
  try {
    const chats = await apiListChats();
    assert.equal(chats.length, 2);
    assert.deepEqual(chats[0], chatFixture("c-test-1"));
    assert.deepEqual(chats[1], chatFixture("c-test-2"));
    assert.equal(apiLog.length, 1);
    assert.equal(apiLog[0].method, "GET");
    assert.equal(apiLog[0].url, "https://api.test/api/v1/chats");
  } finally {
    restore();
  }
});

test("apiCreateChat POSTs {subject,title} and returns the chat row", async () => {
  __resetAuthCachesForTesting();
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter(
      [() => tokenOk("t-create")],
      [() => apiJson(chatFixture("c-test-3"), 201)],
      apiLog,
    ),
  );
  try {
    const chat = await apiCreateChat("physics", "Test chat");
    assert.deepEqual(chat, chatFixture("c-test-3"));
    assert.equal(apiLog.length, 1);
    assert.equal(apiLog[0].method, "POST");
    assert.equal(apiLog[0].url, "https://api.test/api/v1/chats");
    assert.deepEqual(apiLog[0].body, {
      subject: "physics",
      title: "Test chat",
    });
  } finally {
    restore();
  }
});

test("apiPatchChat PATCHes the chat code with the patch body", async () => {
  __resetAuthCachesForTesting();
  const apiLog: ApiCall[] = [];
  const patched = { ...chatFixture("c-test-4"), title: "Renamed" };
  const restore = __setFetchForTesting(
    makeRouter(
      [() => tokenOk("t-patch")],
      [() => apiJson(patched)],
      apiLog,
    ),
  );
  try {
    const chat = await apiPatchChat("c-test-4", { title: "Renamed" });
    assert.deepEqual(chat, patched);
    assert.equal(apiLog.length, 1);
    assert.equal(apiLog[0].method, "PATCH");
    assert.equal(apiLog[0].url, "https://api.test/api/v1/chats/c-test-4");
    assert.deepEqual(apiLog[0].body, { title: "Renamed" });
  } finally {
    restore();
  }
});

test("apiDeleteChat DELETEs the chat code and resolves void on 204", async () => {
  __resetAuthCachesForTesting();
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter([() => tokenOk("t-delete")], [() => noContent()], apiLog),
  );
  try {
    const result = await apiDeleteChat("c-test-5");
    assert.equal(result, undefined);
    assert.equal(apiLog.length, 1);
    assert.equal(apiLog[0].method, "DELETE");
    assert.equal(apiLog[0].url, "https://api.test/api/v1/chats/c-test-5");
  } finally {
    restore();
  }
});

test("apiClearChats DELETEs /chats and maps {data:{deleted}}", async () => {
  __resetAuthCachesForTesting();
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter(
      [() => tokenOk("t-clear")],
      [
        () =>
          apiJson({
            data: { deleted: 3 },
            pagination: { limit: 0, offset: 0, total: 3 },
          }),
      ],
      apiLog,
    ),
  );
  try {
    const res = await apiClearChats();
    assert.deepEqual(res, { deleted: 3 });
    assert.equal(apiLog.length, 1);
    assert.equal(apiLog[0].method, "DELETE");
    assert.equal(apiLog[0].url, "https://api.test/api/v1/chats");
  } finally {
    restore();
  }
});

test("apiListMessages GETs the messages leg and returns the data array", async () => {
  __resetAuthCachesForTesting();
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter(
      [() => tokenOk("t-msgs")],
      [
        () =>
          apiJson({
            data: [messageFixture("m-test-1", 0), messageFixture("m-test-2", 1)],
            pagination: { limit: 200, offset: 0, total: 2 },
          }),
      ],
      apiLog,
    ),
  );
  try {
    const messages = await apiListMessages("c-test-6");
    assert.equal(messages.length, 2);
    assert.deepEqual(messages[0], messageFixture("m-test-1", 0));
    assert.deepEqual(messages[1], messageFixture("m-test-2", 1));
    assert.equal(apiLog.length, 1);
    assert.equal(apiLog[0].method, "GET");
    assert.equal(
      apiLog[0].url,
      "https://api.test/api/v1/chats/c-test-6/messages",
    );
  } finally {
    restore();
  }
});

test("apiAppendMessage POSTs {role,content} and returns the message row", async () => {
  __resetAuthCachesForTesting();
  const apiLog: ApiCall[] = [];
  const appended = {
    id: "m-test-3",
    seq: 2,
    role: "assistant",
    content: { text: "reply" },
    createdAt: "2026-09-09T00:01:00.000Z",
  };
  const restore = __setFetchForTesting(
    makeRouter(
      [() => tokenOk("t-append")],
      [() => apiJson(appended, 201)],
      apiLog,
    ),
  );
  try {
    const message = await apiAppendMessage("c-test-7", {
      role: "assistant",
      content: { text: "reply" },
    });
    assert.deepEqual(message, appended);
    assert.equal(apiLog.length, 1);
    assert.equal(apiLog[0].method, "POST");
    assert.equal(
      apiLog[0].url,
      "https://api.test/api/v1/chats/c-test-7/messages",
    );
    assert.deepEqual(apiLog[0].body, {
      role: "assistant",
      content: { text: "reply" },
    });
  } finally {
    restore();
  }
});

test("apiTruncateMessages DELETEs with from_seq and maps {data:{deleted}}", async () => {
  __resetAuthCachesForTesting();
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter(
      [() => tokenOk("t-truncate")],
      [
        () =>
          apiJson({
            data: { deleted: 2 },
            pagination: { limit: 0, offset: 0, total: 2 },
          }),
      ],
      apiLog,
    ),
  );
  try {
    const res = await apiTruncateMessages("c-test-8", 2);
    assert.deepEqual(res, { deleted: 2 });
    assert.equal(apiLog.length, 1);
    assert.equal(apiLog[0].method, "DELETE");
    assert.equal(
      apiLog[0].url,
      "https://api.test/api/v1/chats/c-test-8/messages?from_seq=2",
    );
  } finally {
    restore();
  }
});

// ---- Error propagation (no toasts in this module) ---------------------------

test("401 propagates as AuthRequiredError", async () => {
  __resetAuthCachesForTesting();
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter(
      [() => tokenOk("t-401")],
      [
        () =>
          apiJson(
            nestedError("AUTH_REQUIRED", "Sign in to continue."),
            401,
          ),
      ],
      apiLog,
    ),
  );
  try {
    let caught: unknown = null;
    try {
      await apiListChats();
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof AuthRequiredError, "401 surfaces typed");
    assert.equal((caught as AuthRequiredError).status, 401);
  } finally {
    restore();
  }
});

test("404 propagates as ApiError carrying the server body", async () => {
  __resetAuthCachesForTesting();
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter(
      [() => tokenOk("t-404")],
      [() => apiJson(nestedError("NOT_FOUND", "Chat not found."), 404)],
      apiLog,
    ),
  );
  try {
    let caught: unknown = null;
    try {
      await apiAppendMessage("c-test-9", {
        role: "user",
        content: { text: "hi" },
      });
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof ApiError, "404 surfaces as ApiError");
    assert.ok(!(caught instanceof AuthRequiredError), "not a 401");
    assert.equal((caught as ApiError).status, 404);
    assert.equal((caught as ApiError).body?.code, "NOT_FOUND");
    assert.equal((caught as ApiError).body?.message, "Chat not found.");
  } finally {
    restore();
  }
});

test("network failure passes through as TypeError", async () => {
  __resetAuthCachesForTesting();
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter(
      [() => tokenOk("t-net")],
      [
        () => {
          throw new TypeError("fetch failed");
        },
      ],
      apiLog,
    ),
  );
  try {
    let caught: unknown = null;
    try {
      await apiListMessages("c-test-10");
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof TypeError, "never-reached-server passes through");
    assert.equal((caught as TypeError).message, "fetch failed");
  } finally {
    restore();
  }
});
