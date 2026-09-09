// App readiness gate predicate tests (spec §3.2–§3.3 — frozen).
// Truth tables for `userReady(auth, profile, seed)` and
// `chatReady(auth, hydratedKey)`: loading blocks, error settles (fail
// open), guests lift on the guest proof, stale identity keys are not
// ready. Pure predicates only — no DOM library, no fetches, no timers.
// Fixtures are synthetic (`u-test-*`), never real.

import test from "node:test";
import assert from "node:assert/strict";

import {
  chatReady,
  userReady,
  type ChatAuth,
} from "../src/lib/session.ts";

function authed(key: string): ChatAuth {
  return { userId: "u-test-gate", identityKey: key };
}

// ---- userReady (spec §3.2) -------------------------------------------------

test("userReady: settled authenticated identity is ready", () => {
  assert.equal(userReady("authenticated", "ready", false), true);
});

test("userReady: auth loading blocks (unknown-tag windows, slow session)", () => {
  assert.equal(userReady("loading", "ready", false), false);
  assert.equal(userReady("loading", "guest", false), false);
  assert.equal(userReady("loading", "error", false), false);
});

test("userReady: profile loading blocks", () => {
  assert.equal(userReady("authenticated", "loading", false), false);
  assert.equal(userReady("guest", "loading", false), false);
});

test("userReady: seed in flight blocks even when both signals settled", () => {
  assert.equal(userReady("authenticated", "ready", true), false);
  assert.equal(userReady("guest", "guest", true), false);
});

test("userReady: guest lifts the moment the guest proof lands", () => {
  assert.equal(userReady("guest", "guest", false), true);
});

test("userReady: profile error settles (fail open — error UI owns recovery)", () => {
  assert.equal(userReady("authenticated", "error", false), true);
  assert.equal(userReady("guest", "error", false), true);
});

test("userReady: error still blocks while auth loads or seed pends", () => {
  assert.equal(userReady("loading", "error", false), false);
  assert.equal(userReady("authenticated", "error", true), false);
});

// ---- chatReady (spec §3.3) -------------------------------------------------

test("chatReady: guest (null auth) is always ready, key or no key", () => {
  assert.equal(chatReady(null, null), true);
  assert.equal(chatReady(null, "u-test-gate:1"), true);
});

test("chatReady: authenticated identity is ready only for its own key", () => {
  assert.equal(chatReady(authed("u-test-gate:1"), "u-test-gate:1"), true);
});

test("chatReady: stale keys are not ready (post-logout, pre-hydrate)", () => {
  assert.equal(chatReady(authed("u-test-gate:2"), "u-test-gate:1"), false);
});

test("chatReady: pre-hydrate null key is not ready for authenticated users", () => {
  assert.equal(chatReady(authed("u-test-gate:1"), null), false);
});

test("chatReady: another identity's key is not ready (TaggedCache rule)", () => {
  assert.equal(
    chatReady({ userId: "u-test-other", identityKey: "u-test-other:9" }, "u-test-gate:1"),
    false,
  );
});

// ---- Gate matrix pin (spec §4): !U forces chat skeletons even when C holds
// The component branches render skeletons on !(U && C); this pins the
// predicate half of that contract — a live list must never paint over an
// unproven identity.

test("gate matrix: !U && C still gates chats (predicate half)", () => {
  const U = userReady("authenticated", "loading", false);
  const C = chatReady(authed("u-test-gate:1"), "u-test-gate:1");
  assert.equal(U, false);
  assert.equal(C, true);
  assert.equal(U && C, false);
});

test("gate matrix: U && !C gates only chats (predicate half)", () => {
  const U = userReady("authenticated", "ready", false);
  const C = chatReady(authed("u-test-gate:1"), null);
  assert.equal(U, true);
  assert.equal(C, false);
  assert.equal(U && C, false);
});

test("gate matrix: U && C is the only live combination", () => {
  assert.equal(
    userReady("authenticated", "ready", false) &&
      chatReady(authed("u-test-gate:1"), "u-test-gate:1"),
    true,
  );
  assert.equal(
    userReady("guest", "guest", false) && chatReady(null, null),
    true,
  );
});
