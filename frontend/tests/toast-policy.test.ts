// Toast safety policy tests (audit §11 item 4): repeat dedupe window
// and rejection-reason redaction.

import test from "node:test";
import assert from "node:assert/strict";

import {
  __resetToastPolicyForTesting,
  isRepeatToast,
  redactForLog,
  TOAST_REPEAT_WINDOW_MS,
} from "../src/lib/toast-policy.ts";

test("identical bodies collapse inside the window, differ outside", () => {
  __resetToastPolicyForTesting();
  assert.equal(isRepeatToast("boom", 1000), false);
  assert.equal(isRepeatToast("boom", 1000 + TOAST_REPEAT_WINDOW_MS - 1), true);
  assert.equal(isRepeatToast("boom", 1000 + TOAST_REPEAT_WINDOW_MS), false);
  assert.equal(isRepeatToast("other", 1000 + TOAST_REPEAT_WINDOW_MS), false);
});

test("redaction keeps the error shape, drops secret material", () => {
  const err = new Error("mint failed for sk-abc123XYZ7890 sorry");
  (err as { name: string }).name = "AuthServiceError";
  assert.equal(redactForLog(err), "AuthServiceError: mint failed for [redacted] sorry");
  assert.equal(
    redactForLog("call failed: Bearer test-token-123"),
    "call failed: [redacted]",
  );
  assert.equal(redactForLog("login password=hunter2 denied"), "login [redacted] denied");
  assert.equal(redactForLog("plain words, no secrets"), "plain words, no secrets");
});

test("redaction handles non-errors without throwing", () => {
  assert.equal(redactForLog({ code: "x", key: "sk-abc123XYZ7890" }).includes("[redacted]"), true);
  assert.equal(redactForLog(null), "null");
  assert.equal(redactForLog(undefined), "undefined");
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.equal(redactForLog(circular), "object");
  assert.ok(redactForLog("y".repeat(600)).length <= 500);
});
