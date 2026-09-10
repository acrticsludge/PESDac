// Resolve-guard regression tests (caching Phase 2 — Fix 2).
// Every async resolve drops unless the identity is still current AND the
// entity still exists; reconciles by `updatedAt` (last-intent-wins), never
// blind overwrite; message loads MERGE with post-dispatch appends.
// Style mirrors chat-backing.test.ts / cache-identity-reset.test.ts.

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
  apiFetch,
  clearAuthCache,
} from "../src/lib/auth.ts";
import {
  __resetChatBackingForTesting,
  appendBlocks,
  deleteChatBacked,
  getChatMessagesStatus,
  getOverlay,
  hydrateChats,
  listCustomChats,
  loadChatMessages,
  renameChatBacked,
  setPinBacked,
  truncateOverlay,
  type ChatAuth,
  type CustomChat,
} from "../src/lib/session.ts";
import type { Block } from "../src/content/threads/types.ts";

__setAuthBaseForTesting("https://auth.test");
__setApiRootForTesting("https://api.test");

const AUTH: ChatAuth = { userId: "u-gd-1", identityKey: "u-gd-1:7" };

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

function tokens(n: number): Array<() => Response> {
  return Array.from({ length: n }, (_, i) => () => tokenOk(`t-gd-${i}`));
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

function noContent(): Response {
  return new Response(null, { status: 204 });
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

function makeRouter(
  tokenQueue: Array<() => Response | Promise<Response>>,
  apiQueue: Array<() => Response | Promise<Response>>,
  apiLog: ApiCall[],
  tokenLog: string[] = [],
): typeof fetch {
  return (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/auth/token")) {
      tokenLog.push(url);
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

async function hydrateOne(apiLog: ApiCall[], code = "c-gd-1"): Promise<void> {
  const restore = __setFetchForTesting(
    makeRouter(tokens(10), [() => apiJson(listEnvelope([serverChat(code)]))], apiLog),
  );
  try {
    const result = await hydrateChats(AUTH);
    assert.deepEqual(result, { status: "ready" });
  } finally {
    restore();
  }
}

// ---- (1) load/message guard: merge, never wholesale-clobber -----------------

test("append between load dispatch and resolve survives the merge", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  await hydrateOne(apiLog, "c-gd-1");

  let releaseHistory!: (res: Response) => void;
  const historyGate = new Promise<Response>((resolve) => {
    releaseHistory = resolve;
  });
  const restore = __setFetchForTesting(
    makeRouter(tokens(10), [() => historyGate], apiLog),
  );
  try {
    const pending = loadChatMessages("c-gd-1", AUTH);
    // Just-sent turn lands while history is in flight (ThreadView send path).
    appendBlocks("c-gd-1", [userBlock("just-sent")]);
    releaseHistory(
      apiJson(listEnvelope([serverMessage("m-gd-h", 0, userBlock("hist-one"))])),
    );
    const blocks = await pending;
    const texts = blocks.map(blockText);
    assert.ok(texts.includes("hist-one"), "server history must paint");
    assert.ok(texts.includes("just-sent"), "post-dispatch append must survive");
    assert.deepEqual(
      getOverlay("c-gd-1").map(blockText),
      texts,
      "server truth and paint agree",
    );
  } finally {
    restore();
  }
});

test("load resolve after delete drops instead of resurrecting the overlay", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  await hydrateOne(apiLog, "c-gd-1");

  let releaseHistory!: (res: Response) => void;
  const historyGate = new Promise<Response>((resolve) => {
    releaseHistory = resolve;
  });
  const restore = __setFetchForTesting(
    makeRouter(tokens(10), [() => historyGate], apiLog),
  );
  try {
    const pending = loadChatMessages("c-gd-1", AUTH);
    // Let the history leg claim the outer router's queue entry before the
    // delete swaps the stub (apiFetch awaits the cached token first).
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // Delete lands while history is in flight (non-optimistic memory drop).
    const delRestore = __setFetchForTesting(
      makeRouter(tokens(10), [() => noContent()], apiLog),
    );
    try {
      assert.equal(await deleteChatBacked("c-gd-1", AUTH), true);
    } finally {
      delRestore();
    }
    assert.deepEqual(
      listCustomChats().map((c) => c.code),
      [],
    );
    releaseHistory(
      apiJson(listEnvelope([serverMessage("m-gd-h", 0, userBlock("hist-one"))])),
    );
    await pending;
    assert.deepEqual(
      listCustomChats().map((c) => c.code),
      [],
      "deleted chat stays gone",
    );
    assert.equal(getOverlay("c-gd-1").length, 0, "no resurrected overlay");
  } finally {
    restore();
  }
});

// ---- (2) container-op reconcile guards: last-intent-wins + membership -------

test("two deferred renames resolved in reverse end at the last intent", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  await hydrateOne(apiLog, "c-gd-r");

  let releaseFirst!: (res: Response) => void;
  let releaseSecond!: (res: Response) => void;
  const firstGate = new Promise<Response>((resolve) => {
    releaseFirst = resolve;
  });
  const secondGate = new Promise<Response>((resolve) => {
    releaseSecond = resolve;
  });
  const restore = __setFetchForTesting(
    makeRouter(tokens(10), [() => firstGate, () => secondGate], apiLog),
  );
  try {
    const pendingFirst = renameChatBacked("c-gd-r", "First", AUTH);
    const pendingSecond = renameChatBacked("c-gd-r", "Second", AUTH);
    // User order: First, then Second. Resolve in reverse (Second lands first).
    releaseSecond(
      apiJson({ ...serverChat("c-gd-r", { title: "Second" }), updatedAt: "2026-09-09T00:00:02.000Z" }),
    );
    await pendingSecond;
    releaseFirst(
      apiJson({ ...serverChat("c-gd-r", { title: "First" }), updatedAt: "2026-09-09T00:00:01.000Z" }),
    );
    await pendingFirst;
    const row = listCustomChats().find((c) => c.code === "c-gd-r");
    assert.equal(row?.title, "Second");
    assert.equal(row?.updatedAt, "2026-09-09T00:00:02.000Z");
  } finally {
    restore();
  }
});

test("rename-inflight then delete-ok then rename-404 keeps the chat gone", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  await hydrateOne(apiLog, "c-gd-d");

  let releaseRename!: (res: Response) => void;
  const renameGate = new Promise<Response>((resolve) => {
    releaseRename = resolve;
  });
  const restore = __setFetchForTesting(
    makeRouter(tokens(10), [() => renameGate], apiLog),
  );
  try {
    const pendingRename = renameChatBacked("c-gd-d", "New name", AUTH);
    // Let the rename PATCH claim the outer router's queue entry before the
    // delete swaps the stub (apiFetch awaits the cached token first).
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const delRestore = __setFetchForTesting(
      makeRouter(tokens(10), [() => noContent()], apiLog),
    );
    try {
      assert.equal(await deleteChatBacked("c-gd-d", AUTH), true);
    } finally {
      delRestore();
    }
    assert.deepEqual(
      listCustomChats().map((c) => c.code),
      [],
    );
    releaseRename(apiJson({ error: { code: "NOT_FOUND", message: "gone" } }, 404));
    assert.equal(await pendingRename, false);
    assert.deepEqual(
      listCustomChats().map((c) => c.code),
      [],
      "rollback must not resurrect the deleted chat",
    );
  } finally {
    restore();
  }
});

test("two deferred pins resolved in reverse end at the last intent", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  await hydrateOne(apiLog, "c-gd-p");
  const ref = { kind: "custom" as const, id: "c-gd-p" };

  let releaseFirst!: (res: Response) => void;
  let releaseSecond!: (res: Response) => void;
  const firstGate = new Promise<Response>((resolve) => {
    releaseFirst = resolve;
  });
  const secondGate = new Promise<Response>((resolve) => {
    releaseSecond = resolve;
  });
  const restore = __setFetchForTesting(
    makeRouter(tokens(10), [() => firstGate, () => secondGate], apiLog),
  );
  try {
    const pendingFirst = setPinBacked(ref, true, AUTH);
    const pendingSecond = setPinBacked(ref, false, AUTH);
    releaseSecond(
      apiJson({ ...serverChat("c-gd-p", { isPinned: false }), updatedAt: "2026-09-09T00:00:02.000Z" }),
    );
    await pendingSecond;
    releaseFirst(
      apiJson({ ...serverChat("c-gd-p", { isPinned: true }), updatedAt: "2026-09-09T00:00:01.000Z" }),
    );
    await pendingFirst;
    const row = listCustomChats().find((c) => c.code === "c-gd-p");
    assert.equal(row?.isPinned, false);
    assert.equal(row?.updatedAt, "2026-09-09T00:00:02.000Z");
  } finally {
    restore();
  }
});

// ---- (3) mint epoch guard ----------------------------------------------------

test("mint started in epoch N resolving in N+1 drops the cache write", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  const tokenLog: string[] = [];
  let releaseStaleMint!: (res: Response) => void;
  const staleGate = new Promise<Response>((resolve) => {
    releaseStaleMint = resolve;
  });
  const restore = __setFetchForTesting(
    makeRouter(
      [() => staleGate, () => tokenOk("t-gd-fresh")],
      [() => apiJson({ ok: true }), () => apiJson({ ok: true }), () => apiJson({ ok: true })],
      apiLog,
      tokenLog,
    ),
  );
  try {
    const pendingA = apiFetch<{ ok: boolean }>("/profiles/me");
    assert.equal(tokenLog.length, 1);
    clearAuthCache();
    const pendingB = apiFetch<{ ok: boolean }>("/profiles/me");
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(tokenLog.length, 2);
    releaseStaleMint(tokenOk("t-gd-stale"));
    await Promise.all([pendingA, pendingB]);
    // Next call reuses B's fresh mint, never A's stale token.
    await apiFetch<{ ok: boolean }>("/profiles/me");
    assert.equal(tokenLog.length, 2);
  } finally {
    restore();
  }
});

test("truncate between load dispatch and resolve keeps the truncated paint", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  await hydrateOne(apiLog, "c-gd-t");
  appendBlocks("c-gd-t", [userBlock("t-one"), userBlock("t-two"), userBlock("t-three")]);

  let releaseHistory!: (res: Response) => void;
  const historyGate = new Promise<Response>((resolve) => {
    releaseHistory = resolve;
  });
  const restore = __setFetchForTesting(
    makeRouter(tokens(10), [() => historyGate], apiLog),
  );
  try {
    const pending = loadChatMessages("c-gd-t", AUTH);
    // Edit lands while history is in flight: truncate to the first turn
    // (persist assumed successful server-side — the fetched rows predate it).
    truncateOverlay("c-gd-t", 1);
    releaseHistory(
      apiJson(
        listEnvelope([
          serverMessage("m-gd-1", 0, userBlock("t-one")),
          serverMessage("m-gd-2", 1, userBlock("t-two")),
          serverMessage("m-gd-3", 2, userBlock("t-three")),
          serverMessage("m-gd-4", 3, userBlock("t-four-stale")),
        ]),
      ),
    );
    const blocks = await pending;
    // Cut turns must not resurrect from the stale fetch.
    assert.deepEqual(blocks.map(blockText), ["t-one"]);
    assert.deepEqual(
      getOverlay("c-gd-t").map(blockText),
      ["t-one"],
    );
    assert.equal(getChatMessagesStatus("c-gd-t"), "ready");
  } finally {
    restore();
  }
});

test("pin-inflight then delete-ok then pin-404 stays silent and gone", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  await hydrateOne(apiLog, "c-gd-q");
  const ref = { kind: "custom" as const, id: "c-gd-q" };
  const notifies: string[] = [];
  const notify = (body: string) => notifies.push(body);

  let releasePin!: (res: Response) => void;
  const pinGate = new Promise<Response>((resolve) => {
    releasePin = resolve;
  });
  const restore = __setFetchForTesting(
    makeRouter(tokens(10), [() => pinGate], apiLog),
  );
  try {
    const pendingPin = setPinBacked(ref, true, AUTH, { notify });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const delRestore = __setFetchForTesting(
      makeRouter(tokens(10), [() => noContent()], apiLog),
    );
    try {
      assert.equal(await deleteChatBacked("c-gd-q", AUTH), true);
    } finally {
      delRestore();
    }
    assert.deepEqual(
      listCustomChats().map((c) => c.code),
      [],
    );
    releasePin(apiJson({ error: { code: "NOT_FOUND", message: "gone" } }, 404));
    assert.equal(await pendingPin, false);
    assert.deepEqual(
      listCustomChats().map((c) => c.code),
      [],
      "no resurrected row",
    );
    assert.deepEqual(notifies, [], "no toast for a deleted chat");
  } finally {
    restore();
  }
});
