// Regression tests for the LLM status derivation + hint masking.
// Pure functions only (no React) — matches the repo lib-test style.

import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveLlmState,
  maskKeyHint,
  type LlmStatus,
} from "../src/lib/llm.ts";

const CONFIGURED: LlmStatus = {
  configured: true,
  provider: "openrouter",
  keyHint: "mnop",
  model: "openai/gpt-4o-mini",
  validatedAt: "2026-09-14T00:00:00+00:00",
};

const EMPTY: LlmStatus = {
  configured: false,
  provider: null,
  keyHint: null,
  model: null,
  validatedAt: null,
};

test("configured status is ready even with a stale rejected flag", () => {
  assert.equal(
    deriveLlmState({ status: CONFIGURED, fetchFailed: false, rejected: true }),
    "ready",
  );
});

test("empty status without rejection is unconfigured", () => {
  assert.equal(
    deriveLlmState({ status: EMPTY, fetchFailed: false, rejected: false }),
    "unconfigured",
  );
});

test("empty status with rejection is invalid", () => {
  assert.equal(
    deriveLlmState({ status: EMPTY, fetchFailed: false, rejected: true }),
    "invalid",
  );
});

test("fetch failure degrades open regardless of the rest", () => {
  assert.equal(
    deriveLlmState({ status: EMPTY, fetchFailed: true, rejected: true }),
    "degraded",
  );
  assert.equal(
    deriveLlmState({ status: null, fetchFailed: true, rejected: false }),
    "degraded",
  );
});

test("no status yet is unknown", () => {
  assert.equal(
    deriveLlmState({ status: null, fetchFailed: false, rejected: false }),
    "unknown",
  );
});

test("maskKeyHint renders bullets plus the hint", () => {
  assert.equal(maskKeyHint("mnop"), "••••mnop");
  assert.equal(maskKeyHint(null), "••••");
});
