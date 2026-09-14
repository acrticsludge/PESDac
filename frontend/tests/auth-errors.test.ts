// Auth-page copy mapper regression tests (audit §3, error-ui.md E7).
// The mappers are pure, so every typed branch is pinned here: a future
// edit that drops a case (or leaks a raw provider message) fails loudly
// instead of shipping generic copy.

import test from "node:test";
import assert from "node:assert/strict";

import {
  toEmailAuthMessage,
  toGoogleSignInMessage,
  toTwoFactorMessage,
} from "../src/lib/auth-errors.ts";

// ---- Google sign-in mapper ----

test("google: invalid_client maps to setup copy, never raw", () => {
  const msg = toGoogleSignInMessage(
    new Error("400 invalid_client: unauthorized client"),
  );
  assert.equal(msg, "Google sign-in isn't set up. Contact support.");
  assert.doesNotMatch(msg, /invalid_client/);
});

test("google: redirect mismatch maps to redirect copy", () => {
  assert.equal(
    toGoogleSignInMessage(new Error("redirect_uri_mismatch")),
    "Google sign-in redirect was blocked. Try again.",
  );
});

test("google: user cancellation maps to cancelled copy", () => {
  for (const raw of ["access_denied", "user_cancelled by user", "Popup canceled"]) {
    assert.equal(
      toGoogleSignInMessage(new Error(raw)),
      "Google sign-in was cancelled. Try again when you're ready.",
    );
  }
});

test("google: stale state maps to expired-link copy", () => {
  assert.equal(
    toGoogleSignInMessage(new Error("invalid_request: state mismatch")),
    "Google sign-in link expired. Try again.",
  );
});

test("google: network failure maps to connection copy", () => {
  assert.equal(
    toGoogleSignInMessage(new Error("Failed to fetch")),
    "Couldn't reach Google. Check your connection and try again.",
  );
});

test("google: unknown rejection stays generic, never raw", () => {
  const msg = toGoogleSignInMessage(new Error("weird_provider_boom_12345"));
  assert.equal(msg, "Google sign-in failed. Try again.");
});

test("google: non-Error rejection stays generic", () => {
  assert.equal(
    toGoogleSignInMessage("string rejection"),
    "Google sign-in failed. Try again.",
  );
});

// ---- Email auth mapper ----

test("email: signup names the already-registered case", () => {
  assert.equal(
    toEmailAuthMessage({ code: "USER_EXISTS", message: "taken" }, true),
    "That email is already registered. Log in instead.",
  );
});

test("email: signin never distinguishes unknown-email from wrong-password", () => {
  const a = toEmailAuthMessage({ code: "INVALID_EMAIL_OR_PASSWORD" }, false);
  const b = toEmailAuthMessage({ code: "SOME_OTHER_AUTH_FAILURE" }, false);
  assert.equal(
    a,
    "Couldn't sign in with those details. Check your email and password and try again.",
  );
  assert.equal(a, b);
  assert.doesNotMatch(a, /INVALID_EMAIL_OR_PASSWORD/);
});

test("email: signup generic failure copy is unchanged", () => {
  assert.equal(
    toEmailAuthMessage({ code: "DB_DOWN" }, true),
    "Couldn't create your account. Try again.",
  );
});

// ---- Two-factor mapper ----

test("2fa: rate limit maps to wait copy", () => {
  assert.equal(
    toTwoFactorMessage({ code: "RATE_LIMITED", message: "slow down" }),
    "Too many attempts. Wait a bit and try again.",
  );
});

test("2fa: expiry maps to fresh-code copy", () => {
  assert.equal(
    toTwoFactorMessage({ code: "INVALID", message: "code expired" }),
    "That code expired. Enter a fresh code from your app.",
  );
});

test("2fa: anything else keeps the long-standing fallback", () => {
  assert.equal(
    toTwoFactorMessage({ code: "NOPE" }),
    "That code didn't work. Try again.",
  );
});
