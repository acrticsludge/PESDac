// lib/api leaf-split identity tests (audit §6).
// lib/auth.ts re-exports the error surface from lib/api/errors.ts so the
// 7 consumers keep one import path. These tests prove the re-export is
// the same binding (not a fork): identity, instanceof behavior, and the
// funnel mapping resolve identically through both paths.

import test from "node:test";
import assert from "node:assert/strict";

import {
  ApiError as ApiErrorViaAuth,
  AuthRequiredError as AuthRequiredViaAuth,
  AuthServiceError as AuthServiceViaAuth,
  toUserMessage as toUserMessageViaAuth,
} from "../src/lib/auth.ts";
import {
  ApiError,
  AuthRequiredError,
  AuthServiceError,
  toUserMessage,
} from "../src/lib/api/errors.ts";

test("re-exported error bindings are identical (no fork)", () => {
  assert.equal(ApiErrorViaAuth, ApiError);
  assert.equal(AuthRequiredViaAuth, AuthRequiredError);
  assert.equal(AuthServiceViaAuth, AuthServiceError);
  assert.equal(toUserMessageViaAuth, toUserMessage);
});

test("instanceof works across the split boundary", () => {
  const err = new AuthRequiredError(null);
  assert.ok(err instanceof ApiError);
  assert.ok(err instanceof ApiErrorViaAuth);
});

test("funnel mapping is identical through both paths", () => {
  const notFound = new ApiError(404, null, "fallback");
  assert.equal(toUserMessage(notFound, "fallback"), toUserMessageViaAuth(notFound, "fallback"));
  assert.equal(
    toUserMessage(new TypeError("Failed to fetch"), "fallback"),
    "Couldn't reach the server. Check your connection and try again.",
  );
});
