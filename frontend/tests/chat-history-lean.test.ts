// Chat-history lean-storage tests (Stream B): wire strip (safe subset),
// query passthrough (limit/offset/q/subject/archived, same envelope),
// preview fallback, predicate truth tables unchanged.
// No DOM library, no live backend: fetch is stubbed in the same router
// style as chat-sync.test.ts. Fixtures are synthetic, never real.

import test from "node:test";
import assert from "node:assert/strict";

import {
  apiListChats,
  apiListChatsPage,
  apiListMessages,
  apiListMessagesPage,
  type ServerChat,
} from "../src/lib/chat-sync.ts";
import {
  __resetAuthCachesForTesting,
  __setApiRootForTesting,
  __setAuthBaseForTesting,
  __setFetchForTesting,
} from "../src/lib/auth.ts";
import {
  shouldShowChatListSkeleton,
  shouldShowThreadSkeleton,
  toWireBlock,
} from "../src/lib/session.ts";
import type { Block } from "../src/content/threads/types.ts";

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

type ApiCall = { method: string; url: string; body: unknown };

function makeRouter(
  tokenQueue: Array<() => Response>,
  apiQueue: Array<() => Response>,
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
    if (!next) throw new Error(`API fetch with empty queue: ${url}`);
    return next();
  }) as typeof fetch;
}

// ---- Wire strip (safe subset) --------------------------------------------

function assistantFixture(): Block {
  return {
    from: "assistant",
    bubbles: [{ type: "text", text: "A subnet splits the host space" }],
    toolCalls: [
      {
        name: "retrieve",
        target: "slides",
        status: "complete",
        duration: "0.4s",
      },
    ],
    toolCallsExpanded: true,
    toolCallsAfter: 0,
    footer: "PESDac · CN",
    followUps: [],
    error: { kind: "failed", retryText: "Explain subnets" },
    time: "2026-09-10T00:00:00.000Z",
  };
}

test("toWireBlock: drops render-only expansion state, keeps prose", () => {
  const wire = toWireBlock(assistantFixture()) as unknown as Record<
    string,
    unknown
  >;
  assert.equal(wire.toolCallsExpanded, undefined);
  assert.equal(wire.toolCallsAfter, undefined);
  assert.ok(!("toolCallsExpanded" in wire));
  assert.ok(!("toolCallsAfter" in wire));
  // Semantics intact: role, bubbles, toolCalls survive.
  assert.equal(wire.from, "assistant");
  assert.deepEqual(wire.bubbles, [
    { type: "text", text: "A subnet splits the host space" },
  ]);
  assert.deepEqual(wire.toolCalls, [
    { name: "retrieve", target: "slides", status: "complete", duration: "0.4s" },
  ]);
});

test("toWireBlock: drops empty followUps, keeps genuine suggestions", () => {
  const empty = toWireBlock(assistantFixture()) as unknown as Record<
    string,
    unknown
  >;
  assert.ok(!("followUps" in empty));
  const withSuggestions = {
    ...assistantFixture(),
    followUps: ["What is CIDR?"],
  } as Block;
  const kept = toWireBlock(withSuggestions) as unknown as Record<
    string,
    unknown
  >;
  assert.deepEqual(kept.followUps, ["What is CIDR?"]);
});

test("toWireBlock: keeps time/footer/error.retryText (render owns them)", () => {
  // Defect-documented: ThreadView renders block.time (:1458,1541),
  // block.footer (:1544), and error.retryText (:1535) directly with no
  // createdAt/fallback recompute — stripping them regresses reloads.
  const wire = toWireBlock(assistantFixture()) as unknown as Record<
    string,
    unknown
  >;
  assert.equal(wire.time, "2026-09-10T00:00:00.000Z");
  assert.equal(wire.footer, "PESDac · CN");
  assert.deepEqual(wire.error, { kind: "failed", retryText: "Explain subnets" });
});

test("toWireBlock: never mutates the memory paint", () => {
  const block = assistantFixture();
  const before = JSON.parse(JSON.stringify(block));
  toWireBlock(block);
  assert.deepEqual(block, before);
});

test("toWireBlock: artifactId-only bubbles + metadata-only attachments", () => {
  const block: Block = {
    from: "user",
    bubbles: [{ type: "artifactCard", artifactId: "a-lean-1" }],
    attachments: [{ id: "f-1", name: "notes.pdf", mime: "application/pdf", size: 12 }],
    time: "2026-09-10T00:00:00.000Z",
  };
  const wire = toWireBlock(block) as unknown as Record<string, unknown>;
  // Asserted (never inlined): no markdown/blob payload rides the wire.
  assert.deepEqual(wire.bubbles, [{ type: "artifactCard", artifactId: "a-lean-1" }]);
  assert.deepEqual(wire.attachments, [
    { id: "f-1", name: "notes.pdf", mime: "application/pdf", size: 12 },
  ]);
  const blobKeys = JSON.stringify(wire).match(
    /"(markdown|data|base64|blob|url)"/g,
  );
  assert.equal(blobKeys, null);
});

// ---- Query passthrough (same envelope) ------------------------------------

function chatRow(code: string): ServerChat {
  return {
    code,
    subject: "CN",
    title: "Subnets",
    isPinned: false,
    isArchived: false,
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
  };
}

test("apiListChats: threads q/subject/archived/limit/offset, keeps envelope", async () => {
  __resetAuthCachesForTesting();
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter(
      [() => tokenOk("t-list-q")],
      [
        () =>
          apiJson({
            data: [chatRow("c-lean-1")],
            pagination: { limit: 50, offset: 0, total: 1 },
          }),
      ],
      apiLog,
    ),
  );
  try {
    const rows = await apiListChats({
      q: "subnet",
      subject: "CN",
      archived: false,
      limit: 50,
      offset: 0,
    });
    assert.equal(rows.length, 1);
    assert.equal(
      apiLog[0].url,
      "https://api.test/api/v1/chats?archived=false&subject=CN&q=subnet&limit=50&offset=0",
    );
  } finally {
    restore();
  }
});

test("apiListChats: blank q/subject send nothing; no-arg URL stays bare", async () => {
  __resetAuthCachesForTesting();
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter(
      [() => tokenOk("t-list-blank"), () => tokenOk("t-list-bare")],
      [
        () => apiJson({ data: [], pagination: { limit: 50, offset: 0, total: 0 } }),
        () => apiJson({ data: [], pagination: { limit: 50, offset: 0, total: 0 } }),
      ],
      apiLog,
    ),
  );
  try {
    await apiListChats({ q: "   ", subject: "" });
    assert.equal(apiLog[0].url, "https://api.test/api/v1/chats");
    await apiListChats();
    assert.equal(apiLog[1].url, "https://api.test/api/v1/chats");
  } finally {
    restore();
  }
});

test("apiListChatsPage: exposes pagination.total for counts", async () => {
  __resetAuthCachesForTesting();
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter(
      [() => tokenOk("t-list-page")],
      [
        () =>
          apiJson({
            data: [chatRow("c-lean-2")],
            pagination: { limit: 50, offset: 0, total: 7 },
          }),
      ],
      apiLog,
    ),
  );
  try {
    const page = await apiListChatsPage({ limit: 50, offset: 0 });
    assert.deepEqual(page.pagination, { limit: 50, offset: 0, total: 7 });
    assert.equal(page.data.length, 1);
  } finally {
    restore();
  }
});

test("apiListMessages: threads limit/offset; bare call unchanged", async () => {
  __resetAuthCachesForTesting();
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter(
      [() => tokenOk("t-msg-win"), () => tokenOk("t-msg-bare")],
      [
        () =>
          apiJson({
            data: [],
            pagination: { limit: 50, offset: 150, total: 200 },
          }),
        () =>
          apiJson({
            data: [],
            pagination: { limit: 200, offset: 0, total: 0 },
          }),
      ],
      apiLog,
    ),
  );
  try {
    await apiListMessages("c-lean-3", { limit: 50, offset: 150 });
    assert.equal(
      apiLog[0].url,
      "https://api.test/api/v1/chats/c-lean-3/messages?limit=50&offset=150",
    );
    await apiListMessages("c-lean-3");
    assert.equal(
      apiLog[1].url,
      "https://api.test/api/v1/chats/c-lean-3/messages",
    );
  } finally {
    restore();
  }
});

test("apiListMessagesPage: tail-window envelope for open-thread paging", async () => {
  __resetAuthCachesForTesting();
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter(
      [() => tokenOk("t-msg-page")],
      [
        () =>
          apiJson({
            data: [],
            pagination: { limit: 50, offset: 150, total: 200 },
          }),
      ],
      apiLog,
    ),
  );
  try {
    // Open convention: limit=50, offset=max(0,total-50) → zero bodies
    // outside the window; scroll-back decrements offset by 50.
    const total = 200;
    const offset = Math.max(0, total - 50);
    const page = await apiListMessagesPage("c-lean-4", { limit: 50, offset });
    assert.equal(offset, 150);
    assert.deepEqual(page.pagination, { limit: 50, offset: 150, total: 200 });
  } finally {
    restore();
  }
});

test("ServerChat without lean columns falls back (title-only safe)", () => {
  const row = chatRow("c-lean-5");
  assert.equal(row.preview ?? "", "");
  assert.equal(row.msgCount ?? 0, 0);
  assert.equal(row.lastSeq ?? 0, 0);
  const lean: ServerChat = { ...row, preview: "A subnet…", msgCount: 2, lastSeq: 1 };
  assert.equal(lean.preview ?? "", "A subnet…");
  assert.equal(lean.msgCount ?? 0, 2);
  assert.equal(lean.lastSeq ?? 0, 1);
});

// ---- Predicate contracts untouched -----------------------------------------

test("predicates: truth tables unchanged (pending+0→skeleton, ready-empty→list, guest→none)", () => {
  assert.equal(shouldShowChatListSkeleton("authenticated", true, 0), true);
  assert.equal(shouldShowChatListSkeleton("authenticated", true, 1), false);
  assert.equal(shouldShowChatListSkeleton("authenticated", false, 0), false);
  assert.equal(shouldShowChatListSkeleton("guest", true, 0), false);
  assert.equal(shouldShowChatListSkeleton("loading", true, 0), false);
});

test("predicates: overlay>0 wins over history loading (memory paint rules)", () => {
  assert.equal(shouldShowThreadSkeleton(true, "loading", 0), true);
  assert.equal(shouldShowThreadSkeleton(true, "loading", 2), false);
  assert.equal(shouldShowThreadSkeleton(true, "loading", 0, true), true);
  assert.equal(shouldShowThreadSkeleton(false, "loading", 0), false);
  assert.equal(shouldShowThreadSkeleton(true, "ready", 0), false);
});
