// Chat skeleton predicate tests (spec §6 FR1 — frozen).
// Truth tables for `getChatHydratePending` / `setChatHydratePending`,
// `shouldShowChatListSkeleton`, and `shouldShowThreadSkeleton`.
// Pure predicates only — no DOM library, no fetches, no timers.
// Fixtures are synthetic (`u-test-*`), never real.

import test from "node:test";
import assert from "node:assert/strict";

import {
  getChatHydratePending,
  setChatHydratePending,
  shouldShowChatListSkeleton,
  shouldShowThreadSkeleton,
  __resetChatBackingForTesting,
} from "../src/lib/session.ts";

// Reset state before each test
function reset() {
  __resetChatBackingForTesting();
}

// ---- getChatHydratePending / setChatHydratePending ----------------------------

test("getChatHydratePending: initially false", () => {
  reset();
  assert.equal(getChatHydratePending(), false);
});

test("setChatHydratePending(true): sets flag and emits", () => {
  reset();
  setChatHydratePending(true, "u-test:1");
  assert.equal(getChatHydratePending(), true);
});

test("setChatHydratePending(false): clears flag", () => {
  reset();
  setChatHydratePending(true, "u-test:1");
  setChatHydratePending(false, "u-test:1");
  assert.equal(getChatHydratePending(), false);
});

test("setChatHydratePending: identity guard prevents stale clear", () => {
  reset();
  setChatHydratePending(true, "u-test:1");
  // Stale identity tries to clear — should be ignored
  setChatHydratePending(false, "u-test:2");
  assert.equal(getChatHydratePending(), true);
  // Correct identity clears
  setChatHydratePending(false, "u-test:1");
  assert.equal(getChatHydratePending(), false);
});

test("setChatHydratePending(false) without identity clears (backward compat)", () => {
  reset();
  setChatHydratePending(true, "u-test:1");
  setChatHydratePending(false);
  assert.equal(getChatHydratePending(), false);
});

test("__resetChatBackingForTesting: clears hydrate pending state", () => {
  reset();
  setChatHydratePending(true, "u-test:1");
  __resetChatBackingForTesting();
  assert.equal(getChatHydratePending(), false);
});

// ---- shouldShowChatListSkeleton (spec §6 FR1) ---------------------------------

// True iff authenticated && hydratePending && customCount === 0

test("shouldShowChatListSkeleton: authenticated + pending + zero customs = true", () => {
  assert.equal(
    shouldShowChatListSkeleton("authenticated", true, 0),
    true,
  );
});

test("shouldShowChatListSkeleton: authenticated + pending + non-zero customs = false", () => {
  assert.equal(
    shouldShowChatListSkeleton("authenticated", true, 1),
    false,
  );
  assert.equal(
    shouldShowChatListSkeleton("authenticated", true, 3),
    false,
  );
});

test("shouldShowChatListSkeleton: authenticated + not pending = false", () => {
  assert.equal(
    shouldShowChatListSkeleton("authenticated", false, 0),
    false,
  );
});

test("shouldShowChatListSkeleton: guest = false (even if pending + zero)", () => {
  assert.equal(
    shouldShowChatListSkeleton("guest", true, 0),
    false,
  );
});

test("shouldShowChatListSkeleton: loading auth = false", () => {
  assert.equal(
    shouldShowChatListSkeleton("loading", true, 0),
    false,
  );
});

// ---- shouldShowThreadSkeleton (spec §6 FR1) -----------------------------------

// True iff explicitFlag === true || (isBacked && msgStatus === "loading" && overlayLen === 0)

test("shouldShowThreadSkeleton: explicitFlag true = true", () => {
  assert.equal(
    shouldShowThreadSkeleton(false, "idle", 0, true),
    true,
  );
  assert.equal(
    shouldShowThreadSkeleton(true, "ready", 5, true),
    true,
  );
});

test("shouldShowThreadSkeleton: backed + loading + empty overlay = true", () => {
  assert.equal(
    shouldShowThreadSkeleton(true, "loading", 0),
    true,
  );
});

test("shouldShowThreadSkeleton: backed + loading + non-empty overlay = false (memory wins)", () => {
  assert.equal(
    shouldShowThreadSkeleton(true, "loading", 1),
    false,
  );
  assert.equal(
    shouldShowThreadSkeleton(true, "loading", 3),
    false,
  );
});

test("shouldShowThreadSkeleton: backed + not loading = false", () => {
  assert.equal(
    shouldShowThreadSkeleton(true, "idle", 0),
    false,
  );
  assert.equal(
    shouldShowThreadSkeleton(true, "ready", 0),
    false,
  );
  assert.equal(
    shouldShowThreadSkeleton(true, "failed", 0),
    false,
  );
});

test("shouldShowThreadSkeleton: not backed = false (guest/demo)", () => {
  assert.equal(
    shouldShowThreadSkeleton(false, "loading", 0),
    false,
  );
  assert.equal(
    shouldShowThreadSkeleton(false, "idle", 0),
    false,
  );
});

// ---- Hydrate flow integration (unit level) ------------------------------------

test("hydrate flow: pending true during hydrate, false after (unit proxy)", () => {
  reset();
  // Before hydrate
  assert.equal(getChatHydratePending(), false);
  // Simulate hydrate entry
  setChatHydratePending(true, "u-test:1");
  assert.equal(getChatHydratePending(), true);
  // Simulate hydrate success
  setChatHydratePending(false, "u-test:1");
  assert.equal(getChatHydratePending(), false);
});

test("hydrate flow: pending cleared on failure (unit proxy)", () => {
  reset();
  setChatHydratePending(true, "u-test:1");
  assert.equal(getChatHydratePending(), true);
  // Simulate hydrate failure
  setChatHydratePending(false, "u-test:1");
  assert.equal(getChatHydratePending(), false);
});