// Outbox worker contract (Phase 5 T5c + T5d): paced FIFO flush,
// idempotent retries, cap + eviction, single-flusher, snapshots.
// Senders are mocked (no DOM, no network); every enqueue passes
// `kick: false` so no background real-network flush can race the
// deterministic `flushOutbox(mock)` assertions.

import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_OUTBOX_OPS,
  __resetOutboxForTesting,
  discardOp,
  enqueueAppend,
  enqueueCreate,
  flushOutbox,
  getOutboxSnapshot,
  orderOutboxOps,
  type OutboxSenders,
} from "../src/lib/outbox.ts";
import { outboxStore } from "../src/lib/outbox-db.ts";
import type { OutboxOp } from "../src/lib/outbox-db.ts";

function apiError(status: number) {
  const error = new Error(`status ${status}`);
  (error as { name?: string }).name = "ApiError";
  (error as { status?: number }).status = status;
  return error;
}

function mockSenders(impl?: Partial<OutboxSenders>): OutboxSenders & {
  calls: Array<{ kind: string; key: string }>;
} {
  const calls: Array<{ kind: string; key: string }> = [];
  return {
    calls,
    appendMessage: async (_chat, _body, key) => {
      calls.push({ kind: "append", key });
      await impl?.appendMessage?.(_chat, _body, key);
    },
    createChat: async (_subject, _title, key) => {
      calls.push({ kind: "create", key });
      const res = await impl?.createChat?.(_subject, _title, key);
      return res ?? { code: "chat-new" };
    },
  };
}

function reset() {
  __resetOutboxForTesting();
}

test("enqueue → flush drains on ack and zeroes the snapshot", async () => {
  reset();
  await enqueueAppend(
    "chat-1",
    { role: "user", content: { text: "hi" } },
    { kick: false },
  );
  assert.equal(getOutboxSnapshot().total, 1);
  assert.equal(getOutboxSnapshot().pending, 1);
  const senders = mockSenders();
  const result = await flushOutbox(senders);
  assert.deepEqual(result, { sent: 1, kept: 0 });
  assert.deepEqual(await outboxStore.list(), []);
  assert.deepEqual(getOutboxSnapshot(), {
    total: 0,
    pending: 0,
    failedRetryable: 0,
    failedFatal: 0,
    evicted: 0,
  });
});

test("drop-connection retry replays the SAME clientKey (server dedupes)", async () => {
  reset();
  const op = await enqueueAppend(
    "chat-1",
    { role: "user", content: { text: "hi" } },
    { kick: false },
  );
  let calls = 0;
  const senders = mockSenders({
    appendMessage: async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("fetch failed");
    },
  });
  // Offline leg: kept for the next trigger, attempts bumped.
  const first = await flushOutbox(senders);
  assert.deepEqual(first, { sent: 0, kept: 1 });
  // Online leg: same key replayed, acked, drained.
  const second = await flushOutbox(senders);
  assert.deepEqual(second, { sent: 1, kept: 0 });
  assert.deepEqual(
    senders.calls.map((c) => c.key),
    [op.clientKey, op.clientKey],
  );
  assert.deepEqual(await outboxStore.list(), []);
});

test("offline → online drains every queued op in FIFO order", async () => {
  reset();
  await enqueueAppend("chat-1", { role: "user", content: { text: "one" } }, { kick: false });
  await enqueueAppend("chat-1", { role: "user", content: { text: "two" } }, { kick: false });
  let online = false;
  const senders = mockSenders({
    appendMessage: async () => {
      if (!online) throw new TypeError("fetch failed");
    },
  });
  assert.deepEqual(await flushOutbox(senders), { sent: 0, kept: 2 });
  online = true;
  assert.deepEqual(await flushOutbox(senders), { sent: 2, kept: 0 });
  assert.equal(senders.calls.length, 4);
  assert.deepEqual(await outboxStore.list(), []);
});

test("pending ops survive a worker restart (reload recovery)", async () => {
  reset();
  await enqueueAppend("chat-1", { role: "user", content: { text: "one" } }, { kick: false });
  await enqueueAppend("chat-2", { role: "user", content: { text: "two" } }, { kick: false });
  // No worker state involved: the store alone carries the backlog.
  assert.equal((await outboxStore.list()).length, 2);
  assert.deepEqual(await flushOutbox(mockSenders()), { sent: 2, kept: 0 });
});

test("fatal refusals stay queued, visible, and are never auto-retried", async () => {
  reset();
  await enqueueAppend("chat-1", { role: "user", content: { text: "hi" } }, { kick: false });
  const senders = mockSenders({
    appendMessage: async () => {
      throw apiError(404);
    },
  });
  assert.deepEqual(await flushOutbox(senders), { sent: 0, kept: 1 });
  assert.equal(getOutboxSnapshot().failedFatal, 1);
  assert.equal(getOutboxSnapshot().total, 1);
  // Next trigger skips the settled-fatal op: no second send.
  assert.deepEqual(await flushOutbox(senders), { sent: 0, kept: 1 });
  assert.equal(senders.calls.length, 1);
});

test("401 aborts the round and keeps everything queued", async () => {
  reset();
  await enqueueAppend("chat-1", { role: "user", content: { text: "one" } }, { kick: false });
  await enqueueAppend("chat-1", { role: "user", content: { text: "two" } }, { kick: false });
  const authFailure = new Error("Sign in to continue.");
  (authFailure as { name?: string }).name = "AuthRequiredError";
  (authFailure as { status?: number }).status = 401;
  const senders = mockSenders({
    appendMessage: async () => {
      throw authFailure;
    },
  });
  assert.deepEqual(await flushOutbox(senders), { sent: 0, kept: 2 });
  assert.equal(senders.calls.length, 1);
});

test("surfaced 429s pace the round and the op retries later", async () => {
  reset();
  await enqueueAppend("chat-1", { role: "user", content: { text: "hi" } }, { kick: false });
  let calls = 0;
  const senders = mockSenders({
    appendMessage: async () => {
      calls += 1;
      if (calls === 1) throw apiError(429);
    },
  });
  // First round backs off (5s cap) and keeps the op for the next trigger.
  assert.deepEqual(await flushOutbox(senders), { sent: 0, kept: 1 });
  assert.deepEqual(await flushOutbox(senders), { sent: 1, kept: 0 });
});

test("exhausted retryables become failed-fatal (never silently dropped)", async () => {
  reset();
  await enqueueAppend("chat-1", { role: "user", content: { text: "hi" } }, { kick: false });
  const senders = mockSenders({
    appendMessage: async () => {
      throw apiError(500);
    },
  });
  for (let i = 0; i < 6; i++) {
    await flushOutbox(senders);
  }
  assert.equal(senders.calls.length, 6);
  assert.equal(getOutboxSnapshot().failedFatal, 1);
  // Settled-fatal: further triggers do not resend.
  await flushOutbox(senders);
  assert.equal(senders.calls.length, 6);
  assert.equal((await outboxStore.list()).length, 1);
});

test("create ops drain before their chat's appends", async () => {
  reset();
  await enqueueCreate("CN", "New chat", { chatCode: "chat-9", kick: false });
  await enqueueAppend("chat-9", { role: "user", content: { text: "hi" } }, { kick: false });
  const senders = mockSenders();
  assert.deepEqual(await flushOutbox(senders), { sent: 2, kept: 0 });
  assert.deepEqual(
    senders.calls.map((c) => c.kind),
    ["create", "append"],
  );
});

test("orderOutboxOps: FIFO with same-timestamp creates first", () => {
  const append: OutboxOp = {
    id: "a",
    chatCode: "c",
    kind: "append-message",
    clientKey: "k-a",
    payload: {},
    createdAt: 100,
    attempts: 0,
  };
  const create: OutboxOp = {
    id: "b",
    chatCode: "c",
    kind: "create-chat",
    clientKey: "k-b",
    payload: {},
    createdAt: 100,
    attempts: 0,
  };
  assert.deepEqual(
    orderOutboxOps([append, create]).map((o) => o.id),
    ["b", "a"],
  );
  assert.deepEqual(
    orderOutboxOps([{ ...append, createdAt: 50 }, create]).map((o) => o.id),
    ["a", "b"],
  );
});

test("cap evicts oldest-first with a visible evicted count", async () => {
  reset();
  const { orderOutboxOps: order } = await import("../src/lib/outbox.ts");
  const enqueued = [];
  for (let i = 0; i < MAX_OUTBOX_OPS + 5; i++) {
    enqueued.push(
      await enqueueAppend(
        "chat-1",
        { role: "user", content: { text: `m-${i}` } },
        { kick: false },
      ),
    );
  }
  const snapshot = getOutboxSnapshot();
  assert.equal(snapshot.total, MAX_OUTBOX_OPS);
  assert.equal(snapshot.evicted, 5);
  // Survivors are exactly the newest 200 by flush order, whatever the
  // timestamp collisions (ids break ties deterministically).
  const expected = new Set(order(enqueued).slice(-MAX_OUTBOX_OPS).map((o) => o.id));
  const remaining = await outboxStore.list();
  assert.equal(remaining.length, MAX_OUTBOX_OPS);
  assert.deepEqual(new Set(remaining.map((o) => o.id)), expected);
});

test("cross-tab lease: a fresh lease elsewhere skips this flush", async () => {
  reset();
  // Neutralize the locks-first path (present in node 22+): this case
  // pins the localStorage-lease fallback used by older browsers.
  const nav = navigator as unknown as Record<string, unknown>;
  const proto = Object.getPrototypeOf(navigator) as object;
  const locksDescriptor =
    Object.getOwnPropertyDescriptor(nav, "locks") ??
    Object.getOwnPropertyDescriptor(proto, "locks");
  Object.defineProperty(nav, "locks", {
    configurable: true,
    enumerable: true,
    value: undefined,
    writable: true,
  });
  const storage = new Map<string, string>();
  (globalThis as unknown as Record<string, unknown>).localStorage = {
    getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
    setItem: (key: string, value: string) => {
      storage.set(key, String(value));
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
  };
  try {
    await enqueueAppend("chat-1", { role: "user", content: { text: "hi" } }, { kick: false });
    const { OUTBOX_FLUSH_LEASE_KEY } = await import("../src/lib/outbox.ts");
    storage.set(OUTBOX_FLUSH_LEASE_KEY, String(Date.now()));
    const senders = mockSenders();
    // Sibling tab holds the lease: zero sends, op kept.
    assert.deepEqual(await flushOutbox(senders), { sent: 0, kept: 1 });
    assert.equal(senders.calls.length, 0);
    // Stale lease: this tab proceeds and drains.
    storage.set(OUTBOX_FLUSH_LEASE_KEY, String(Date.now() - 60000));
    assert.deepEqual(await flushOutbox(senders), { sent: 1, kept: 0 });
    assert.equal(senders.calls.length, 1);
  } finally {
    if (locksDescriptor) {
      Object.defineProperty(nav, "locks", locksDescriptor);
    } else {
      delete nav.locks;
    }
    delete (globalThis as unknown as Record<string, unknown>).localStorage;
  }
});

test("concurrent flushes collapse to a single send stream", async () => {
  reset();
  await enqueueAppend("chat-1", { role: "user", content: { text: "hi" } }, { kick: false });
  let inFlight = 0;
  let maxInFlight = 0;
  const senders = mockSenders({
    appendMessage: async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
    },
  });
  const [first, second] = await Promise.all([
    flushOutbox(senders),
    flushOutbox(senders),
  ]);
  assert.equal(senders.calls.length, 1);
  assert.equal(maxInFlight, 1);
  assert.deepEqual(
    [first, second].map((r) => r.sent).sort(),
    [0, 1],
  );
});

test("discardOp drops a user-discarded draft", async () => {
  reset();
  const op = await enqueueAppend(
    "chat-1",
    { role: "user", content: { text: "hi" } },
    { kick: false },
  );
  await discardOp(op.id);
  assert.deepEqual(await outboxStore.list(), []);
  assert.equal(getOutboxSnapshot().total, 0);
  const senders = mockSenders();
  assert.deepEqual(await flushOutbox(senders), { sent: 0, kept: 0 });
  assert.equal(senders.calls.length, 0);
});
