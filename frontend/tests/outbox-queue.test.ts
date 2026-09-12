// Outbox queue contract (Phase 5 T5b): failure taxonomy + record lifecycle.
// Pure module (no DOM, no network): the matrix below pins the `auth.ts`
// retry policy the queue mirrors structurally.

import test from "node:test";
import assert from "node:assert/strict";

import {
  OutboxQueue,
  classifyOutboxError,
  newClientKey,
} from "../src/lib/outbox-queue.ts";

function apiError(status: number) {
  const error = new Error(`status ${status}`);
  (error as { name?: string }).name = "ApiError";
  (error as { status?: number }).status = status;
  return error;
}

function named(name: string, message = "boom") {
  const error = new Error(message);
  (error as { name?: string }).name = name;
  return error;
}

// ---- Taxonomy matrix -------------------------------------------------------

test("401s are failed-fatal (global re-login owns them)", () => {
  assert.equal(classifyOutboxError(named("AuthRequiredError")), "failed-fatal");
  assert.equal(classifyOutboxError(apiError(401)), "failed-fatal");
});

test("authoritative refusals are failed-fatal", () => {
  for (const status of [400, 403, 404, 422]) {
    assert.equal(
      classifyOutboxError(apiError(status)),
      "failed-fatal",
      `status ${status}`,
    );
  }
});

test("429 / 409 / 5xx are failed-retryable", () => {
  for (const status of [409, 429, 500, 502, 503]) {
    assert.equal(
      classifyOutboxError(apiError(status)),
      "failed-retryable",
      `status ${status}`,
    );
  }
});

test("never-reached-server failures are failed-retryable", () => {
  assert.equal(
    classifyOutboxError(new TypeError("fetch failed")),
    "failed-retryable",
  );
  assert.equal(
    classifyOutboxError(new DOMException("aborted", "AbortError")),
    "failed-retryable",
  );
  assert.equal(
    classifyOutboxError(named("AuthServiceError", "mint down")),
    "failed-retryable",
  );
});

test("unknown failures default to failed-retryable (bounded by the worker cap)", () => {
  assert.equal(classifyOutboxError(new Error("weird")), "failed-retryable");
  assert.equal(classifyOutboxError(null), "failed-retryable");
  assert.equal(classifyOutboxError("string failure"), "failed-retryable");
});

// ---- Record lifecycle ------------------------------------------------------

test("track → markSent settles sent and clears the error", () => {
  const queue = new OutboxQueue();
  queue.track("k-1");
  assert.equal(queue.get("k-1")?.status, "pending");
  queue.markFailed("k-1", apiError(500));
  assert.equal(queue.get("k-1")?.status, "failed-retryable");
  assert.ok(queue.get("k-1")?.lastError);
  queue.markSent("k-1");
  assert.equal(queue.get("k-1")?.status, "sent");
  assert.equal(queue.get("k-1")?.lastError, undefined);
  assert.deepEqual(queue.unsent(), []);
});

test("markFailed records failed-fatal for refusals", () => {
  const queue = new OutboxQueue();
  queue.track("k-2");
  queue.markFailed("k-2", apiError(404));
  assert.equal(queue.get("k-2")?.status, "failed-fatal");
  assert.equal(queue.unsent().length, 1);
});

test("settle on an unknown id returns null (no phantom records)", () => {
  const queue = new OutboxQueue();
  assert.equal(queue.markSent("nope"), null);
  assert.equal(queue.markFailed("nope", apiError(500)), null);
  assert.deepEqual(queue.list(), []);
});

test("markFatal forces failed-fatal even for retryable errors (exhaustion)", () => {
  const queue = new OutboxQueue();
  queue.track("k-4");
  queue.markFatal("k-4", apiError(500));
  assert.equal(queue.get("k-4")?.status, "failed-fatal");
  assert.equal(queue.markFatal("missing", apiError(500)), null);
});

test("forget drops the record", () => {
  const queue = new OutboxQueue();
  queue.track("k-3");
  queue.forget("k-3");
  assert.equal(queue.get("k-3"), null);
});

// ---- Key generation --------------------------------------------------------

test("newClientKey returns unique UUID-shaped keys", () => {
  const keys = new Set(Array.from({ length: 100 }, () => newClientKey()));
  assert.equal(keys.size, 100);
  for (const key of keys) {
    assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  }
});
