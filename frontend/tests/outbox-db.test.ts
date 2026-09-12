// Outbox durable-store contract (Phase 5 T5c): pending-ops only,
// FIFO ordering, strict validation of untrusted stored rows.
// Runs on the memory fallback in node (no IndexedDB): same ordering
// and validation semantics as the IndexedDB path.

import test from "node:test";
import assert from "node:assert/strict";

import {
  OutboxStore,
  isValidOutboxOp,
  type OutboxOp,
} from "../src/lib/outbox-db.ts";

function op(id: string, createdAt: number, chatCode = "chat-1"): OutboxOp {
  return {
    id,
    chatCode,
    kind: "append-message",
    clientKey: `key-${id}`,
    payload: { role: "user", content: { text: "hi" } },
    createdAt,
    attempts: 0,
  };
}

test("put + list returns FIFO oldest-first", async () => {
  const store = new OutboxStore();
  await store.put(op("b", 200));
  await store.put(op("a", 100));
  await store.put(op("c", 300));
  assert.deepEqual(
    (await store.list()).map((o) => o.id),
    ["a", "b", "c"],
  );
});

test("remove deletes on ack; unknown ids are a no-op", async () => {
  const store = new OutboxStore();
  await store.put(op("a", 100));
  await store.remove("missing");
  await store.remove("a");
  assert.deepEqual(await store.list(), []);
});

test("clear drops every pending op", async () => {
  const store = new OutboxStore();
  await store.put(op("a", 100));
  await store.put(op("b", 200, "chat-2"));
  await store.clear();
  assert.deepEqual(await store.list(), []);
});

test("put rejects malformed ops (never stores untrusted shapes)", async () => {
  const store = new OutboxStore();
  await assert.rejects(store.put({ id: "", chatCode: "c" } as unknown as OutboxOp));
  await assert.rejects(
    store.put({ ...op("a", 1), kind: "delete-everything" } as unknown as OutboxOp),
  );
  assert.deepEqual(await store.list(), []);
});

test("isValidOutboxOp accepts both kinds and rejects junk", () => {
  assert.equal(isValidOutboxOp(op("a", 1)), true);
  assert.equal(
    isValidOutboxOp({ ...op("a", 1), kind: "create-chat" }),
    true,
  );
  assert.equal(isValidOutboxOp(null), false);
  assert.equal(isValidOutboxOp("op"), false);
  assert.equal(isValidOutboxOp({ ...op("a", 1), clientKey: "" }), false);
  assert.equal(isValidOutboxOp({ ...op("a", 1), attempts: "0" }), false);
  // No token-ish fields may sneak in through validation gaps: extras are
  // tolerated (forward-compat) but the required shape is exact.
  assert.equal(
    isValidOutboxOp({ ...op("a", 1), token: "never-stored" }),
    true,
  );
});
