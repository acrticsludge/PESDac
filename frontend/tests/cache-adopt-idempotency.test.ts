// Adopt idempotency tests (caching Phase 5, spec §5 Fix 5 + §10.2).
// The locked contract: client generates one UUID per guest chat
// (`clientAdoptKey`, `crypto.randomUUID()`), sent in `POST /chats` body;
// the server stores it with a per-user unique constraint and answers a
// duplicate POST with `200` + the existing row (no duplicate).
// No DOM library, no live backend: fetch is stubbed in the same router
// style as chat-backing.test.ts, `window` is minimally stubbed so the
// memory store activates, fixtures are synthetic (`c-adopt-*`).

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
  ApiError,
  chatWriteRetryDelayMs,
} from "../src/lib/auth.ts";
import { apiCreateChat, apiListChats } from "../src/lib/chat-sync.ts";
import {
  __resetChatBackingForTesting,
  appendBlocks,
  createCustomChat,
  hydrateChats,
  listCustomChats,
  type ChatAuth,
} from "../src/lib/session.ts";
import type { Block } from "../src/content/threads/types.ts";

__setAuthBaseForTesting("https://auth.test");
__setApiRootForTesting("https://api.test");

const AUTH: ChatAuth = { userId: "u-adopt-1", identityKey: "u-adopt-1:1" };
const AUTH_NEXT: ChatAuth = { userId: "u-adopt-1", identityKey: "u-adopt-1:2" };

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

function serverError(): Response {
  return apiJson(
    { error: { code: "SERVER_ERROR", message: "Boom." } },
    500,
  );
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
    // Archived-list leg of hydrate: no archived fixtures here, serve an
    // empty page without consuming queued contract responses.
    if (
      (init?.method ?? "GET") === "GET" &&
      url.includes("/chats") &&
      !url.includes("/messages") &&
      url.includes("archived=true")
    ) {
      return apiJson(listEnvelope([]));
    }
    const next = apiQueue.shift();
    if (!next) throw new Error(`api fetch with empty queue: ${url}`);
    return next();
  }) as typeof fetch;
}

function tokens(n: number): Array<() => Response> {
  return Array.from({ length: n }, (_, i) => () => tokenOk(`t-adopt-${i}`));
}

function serverChat(code: string) {
  return {
    code,
    subject: "CN",
    title: "adopted",
    isPinned: false,
    isArchived: false,
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
  };
}

function listEnvelope(data: unknown[]) {
  return {
    data,
    pagination: { limit: 50, offset: 0, total: data.length },
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

function isUuid(v: unknown): boolean {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

// ---- apiCreateChat signature ------------------------------------------------

test("apiCreateChat sends clientAdoptKey when provided", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter(
      tokens(2),
      [() => apiJson(serverChat("c-adopt-k1"), 201)],
      apiLog,
    ),
  );
  try {
    await apiCreateChat("CN", "hello", {
      clientAdoptKey: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    });
    assert.equal(apiLog.length, 1);
    assert.deepEqual(apiLog[0].body, {
      subject: "CN",
      title: "hello",
      clientAdoptKey: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    });
  } finally {
    restore();
  }
});

test("apiCreateChat omits clientAdoptKey when not provided", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter(
      tokens(2),
      [() => apiJson(serverChat("c-adopt-k2"), 201)],
      apiLog,
    ),
  );
  try {
    await apiCreateChat("CN", "plain");
    assert.equal(apiLog.length, 1);
    assert.deepEqual(apiLog[0].body, { subject: "CN", title: "plain" });
  } finally {
    restore();
  }
});

// ---- adopt sender -----------------------------------------------------------

test("adopt sends one UUID clientAdoptKey per guest chat", async () => {
  setup();
  const guestA = createCustomChat("CN", "guest a");
  appendBlocks(guestA.code, [userBlock("a")]);
  createCustomChat("OS", "guest b");

  const apiLog: ApiCall[] = [];
  const createdA = serverChat("c-adopt-a");
  const createdB = serverChat("c-adopt-b");
  const restore = __setFetchForTesting(
    makeRouter(
      tokens(10),
      [
        () => apiJson(createdA, 201),
        () => apiJson(serverMessage("m-adopt-a", 0, userBlock("a")), 201),
        () => apiJson(createdB, 201),
        () => apiJson(listEnvelope([createdA, createdB])),
      ],
      apiLog,
    ),
  );
  try {
    const result = await hydrateChats(AUTH);
    assert.deepEqual(result, { status: "ready" });
    const posts = apiLog.filter(
      (c) => c.method === "POST" && c.url.endsWith("/chats"),
    );
    assert.equal(posts.length, 2);
    const keys = posts.map((p) => (p.body as Record<string, unknown>)["clientAdoptKey"]);
    assert.ok(keys.every(isUuid), `expected UUID keys, got ${JSON.stringify(keys)}`);
    assert.notEqual(keys[0], keys[1]);
  } finally {
    restore();
  }
});

test("adopt retry resends the SAME key; conflict-200 drops memory, exactly one row", async () => {
  setup();
  const guest = createCustomChat("CN", "retry me");
  appendBlocks(guest.code, [userBlock("again")]);

  // Login 1: adopt container leg fails — guest copy preserved pending.
  const apiLog1: ApiCall[] = [];
  const restore1 = __setFetchForTesting(
    makeRouter(
      tokens(10),
      [() => serverError(), () => apiJson(listEnvelope([serverChat("c-adopt-s")]))],
      apiLog1,
    ),
  );
  try {
    const result = await hydrateChats(AUTH);
    assert.deepEqual(result, { status: "ready" });
    assert.ok(listCustomChats().some((c) => c.code === guest.code));
  } finally {
    restore1();
  }
  const firstKey = (apiLog1[0].body as Record<string, unknown>)["clientAdoptKey"];
  assert.ok(isUuid(firstKey), `expected UUID key, got ${JSON.stringify(firstKey)}`);

  // Next login: the container POST returns 200 with the existing row
  // (the server saw the key already) — memory drops, no duplicate.
  const apiLog2: ApiCall[] = [];
  const adopted = serverChat("c-adopt-n");
  const restore2 = __setFetchForTesting(
    makeRouter(
      tokens(10),
      [
        () => apiJson(adopted, 200),
        () => apiJson(serverMessage("m-adopt-n", 0, userBlock("again")), 201),
        () => apiJson(listEnvelope([serverChat("c-adopt-s"), adopted])),
      ],
      apiLog2,
    ),
  );
  try {
    const result = await hydrateChats(AUTH_NEXT);
    assert.deepEqual(result, { status: "ready" });
    const posts = apiLog2.filter(
      (c) => c.method === "POST" && c.url.endsWith("/chats"),
    );
    assert.equal(posts.length, 1);
    assert.equal(
      (posts[0].body as Record<string, unknown>)["clientAdoptKey"],
      firstKey,
      "retry must resend the identical key",
    );
    const codes = listCustomChats().map((c) => c.code);
    assert.deepEqual(codes, ["c-adopt-s", "c-adopt-n"]);
    assert.ok(!codes.includes(guest.code));
  } finally {
    restore2();
  }
});

// ---- chat-write 429: one bounded retry honoring min(Retry-After, 5s) --------

function rateLimited(retryAfter: string | null): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (retryAfter != null) headers["Retry-After"] = retryAfter;
  return new Response(
    JSON.stringify({ error: { code: "RATE_LIMITED", message: "Slow down." } }),
    { status: 429, headers },
  );
}

test("chatWriteRetryDelayMs honors min(Retry-After, 5s)", async () => {
  assert.equal(chatWriteRetryDelayMs("2"), 2000);
  assert.equal(chatWriteRetryDelayMs("0"), 0);
  assert.equal(chatWriteRetryDelayMs("30"), 5000);
  assert.equal(chatWriteRetryDelayMs(null), 0);
  assert.equal(chatWriteRetryDelayMs("garbage"), 0);
});

test("chat-write 429 → one retry, then success surfaces normally", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  const row = serverChat("c-adopt-429");
  const restore = __setFetchForTesting(
    makeRouter(
      tokens(2),
      [() => rateLimited("0"), () => apiJson(row, 201)],
      apiLog,
    ),
  );
  try {
    const chat = await apiCreateChat("CN", "after 429");
    assert.deepEqual(chat, row);
    assert.equal(
      apiLog.filter((c) => c.url.endsWith("/chats")).length,
      2,
      "exactly one retry",
    );
  } finally {
    restore();
  }
});

test("chat-write 429 twice → second 429 is terminal (exactly one retry)", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter(
      tokens(2),
      [() => rateLimited("0"), () => rateLimited("0")],
      apiLog,
    ),
  );
  try {
    let caught: unknown = null;
    try {
      await apiCreateChat("CN", "limited");
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof ApiError, "surfaces as ApiError");
    assert.equal((caught as ApiError).status, 429);
    assert.equal(apiLog.length, 2, "one initial try + one retry, no loop");
  } finally {
    restore();
  }
});

test("non-chat paths never retry on 429", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter(tokens(2), [() => rateLimited("0")], apiLog),
  );
  try {
    let caught: unknown = null;
    try {
      await apiListChats();
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof ApiError, "surfaces as ApiError");
    assert.equal((caught as ApiError).status, 429);
    assert.equal(apiLog.length, 1, "reads never retry");
  } finally {
    restore();
  }
});

test("non-429 chat-write failures never retry", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter(tokens(2), [() => serverError()], apiLog),
  );
  try {
    let caught: unknown = null;
    try {
      await apiCreateChat("CN", "boom");
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof ApiError, "surfaces as ApiError");
    assert.equal((caught as ApiError).status, 500);
    assert.equal(apiLog.length, 1, "only 429 retries, once");
  } finally {
    restore();
  }
});
