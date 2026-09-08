// Logout + Google relogin flow regression tests (L5).
// Covers: logout-window suppression scope, seed helpers + identity keying,
// skeleton predicate semantics, social-entry cache hygiene, and
// logout-time local-seed clearing. No real network: fetch is routed from
// queues and window is faked (same patterns as auth-api.test.ts).
// React-state behavior (isLoggingOut/expiry-ref resets, loader
// persistence across the redirect flight) is verified via the browser
// matrix in the plan, not here — node has no component runtime.

import test from "node:test";
import assert from "node:assert/strict";

import {
  beginLogoutTransition,
  endLogoutTransition,
  isLogoutTransition,
  isTransitionNoise,
  LOGOUT_TRANSITION_EVENT,
  __resetLogoutTransitionForTesting,
} from "../src/lib/logout-guard.ts";
import {
  clearLocalProfileSeed,
  getProfile,
  getProfileSeedPending,
  getSeededIdentityKey,
  identitySeedKey,
  setProfileSeedPending,
  setSeededIdentityKey,
  shouldShowIdentitySkeleton,
  updateProfile,
} from "../src/lib/session.ts";
import {
  ApiError,
  AuthRequiredError,
  apiGetMe,
  apiLogout,
  getAuthEpoch,
  signInWithGoogle,
  __resetAuthCachesForTesting,
  __setApiRootForTesting,
  __setAuthBaseForTesting,
  __setFetchForTesting,
} from "../src/lib/auth.ts";

__setAuthBaseForTesting("https://auth.test");
__setApiRootForTesting("https://api.test");

type FakeWindow = {
  __pesdacAuthDispatched?: boolean;
  addEventListener: (type: string, fn: (ev: { type: string }) => void) => void;
  removeEventListener: (type: string, fn: (ev: { type: string }) => void) => void;
  dispatchEvent: (ev: { type: string }) => boolean;
};

/** Minimal window: captures dispatched event types for assertions. */
function installFakeWindow(): { events: string[]; uninstall: () => void } {
  const events: string[] = [];
  const listeners = new Map<string, Set<(ev: { type: string }) => void>>();
  const fake: FakeWindow = {
    __pesdacAuthDispatched: false,
    addEventListener: (type, fn) => {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(fn);
    },
    removeEventListener: (type, fn) => {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent: (ev) => {
      events.push(ev.type);
      listeners.get(ev.type)?.forEach((fn) => fn(ev));
      return true;
    },
  };
  (globalThis as Record<string, unknown>).window = fake;
  return {
    events,
    uninstall: () => {
      delete (globalThis as Record<string, unknown>).window;
    },
  };
}

function tokenOk(token: string): Response {
  return new Response(JSON.stringify({ token }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function apiNoContent(): Response {
  // NB: undici rejects `new Response("", { status: 204 })` (body with a
  // null-body status) — the backend's real 204 likewise carries null.
  return new Response(null, { status: 204 });
}

function apiJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Logout window
// ---------------------------------------------------------------------------

test("logout window opens at click and closes after navigation commits", () => {
  const { events, uninstall } = installFakeWindow();
  try {
    __resetLogoutTransitionForTesting();
    assert.equal(isLogoutTransition(), false);
    beginLogoutTransition();
    assert.equal(isLogoutTransition(), true);
    endLogoutTransition();
    assert.equal(isLogoutTransition(), false);
    assert.deepEqual(
      events.filter((t) => t === LOGOUT_TRANSITION_EVENT),
      [LOGOUT_TRANSITION_EVENT, LOGOUT_TRANSITION_EVENT],
      "one edge per transition",
    );
  } finally {
    uninstall();
  }
});

test("suppression scope: only epoch-invalidated transition noise is silent", () => {
  // The exact rejection the TaggedCache guards raise when the session
  // intentionally changed under an in-flight fetch.
  assert.equal(isTransitionNoise(new Error("identity-changed")), true);
  // Genuine failures keep their existing handling — even in the window.
  assert.equal(
    isTransitionNoise(new ApiError(404, null, "Request failed.")),
    false,
  );
  assert.equal(isTransitionNoise(new AuthRequiredError(null)), false);
  assert.equal(isTransitionNoise(new TypeError("Failed to fetch")), false);
  assert.equal(isTransitionNoise(new Error("boom")), false);
  assert.equal(isTransitionNoise(null), false);
  assert.equal(isTransitionNoise("identity-changed"), false);
});

// ---------------------------------------------------------------------------
// Seed helpers + identity keying
// ---------------------------------------------------------------------------

test("identity seed key separates users and epochs", () => {
  assert.equal(identitySeedKey("user-a", 3), "user-a:3");
  assert.notEqual(identitySeedKey("user-a", 3), identitySeedKey("user-a", 4));
  assert.notEqual(identitySeedKey("user-a", 3), identitySeedKey("user-b", 3));
});

test("seed pending flag and identity key round-trip", () => {
  const { uninstall } = installFakeWindow();
  try {
    setProfileSeedPending(true);
    assert.equal(getProfileSeedPending(), true);
    setSeededIdentityKey(identitySeedKey("user-a", 7));
    assert.equal(getSeededIdentityKey(), "user-a:7");
    setProfileSeedPending(false);
    setSeededIdentityKey(null);
    assert.equal(getProfileSeedPending(), false);
    assert.equal(getSeededIdentityKey(), null);
  } finally {
    uninstall();
  }
});

test("logout seed clear drops identity data but keeps device prefs", () => {
  const { uninstall } = installFakeWindow();
  try {
    updateProfile({
      institution: "RR",
      semester: "S5",
      branch: "CSE",
      subjects: ["CN"],
      language: "hi",
    });
    setProfileSeedPending(true);
    setSeededIdentityKey(identitySeedKey("user-a", 1));
    clearLocalProfileSeed();
    const cleared = getProfile();
    assert.equal(cleared.institution, "");
    assert.equal(cleared.semester, "");
    assert.equal(cleared.branch, "");
    assert.deepEqual(cleared.subjects, []);
    assert.equal(cleared.language, "hi", "device prefs survive");
    assert.equal(getProfileSeedPending(), false);
    assert.equal(getSeededIdentityKey(), null);
  } finally {
    uninstall();
  }
});

test("skeleton predicate: pending skeletons, ready-empty does not", () => {
  // Today's behavior preserved: auth/profile loading still skeletons.
  assert.equal(shouldShowIdentitySkeleton("loading", "loading", false), true);
  assert.equal(
    shouldShowIdentitySkeleton("authenticated", "loading", false),
    true,
  );
  // The fix: seed in flight skeletons even when /auth/me already landed.
  assert.equal(shouldShowIdentitySkeleton("authenticated", "ready", true), true);
  assert.equal(shouldShowIdentitySkeleton("guest", "guest", true), true);
  // Ready-but-empty (new user, blank campus) renders Select
  // placeholders — visually distinct from pending, no skeleton.
  assert.equal(
    shouldShowIdentitySkeleton("authenticated", "ready", false),
    false,
  );
  assert.equal(shouldShowIdentitySkeleton("guest", "guest", false), false);
  assert.equal(
    shouldShowIdentitySkeleton("authenticated", "error", false),
    false,
    "profile error keeps existing (non-skeleton) handling",
  );
});

// ---------------------------------------------------------------------------
// Entry-point hygiene + logout-time clearing (mocked fetch)
// ---------------------------------------------------------------------------

test("signInWithGoogle clears identity caches before the social redirect", async () => {
  __resetAuthCachesForTesting();
  const before = getAuthEpoch();
  // The redirect flight never settles in node (no browser navigation), so
  // bound the wait: the hygiene runs BEFORE the redirect, hence is
  // observable either way. clearAuthCache() is the only epoch bump on
  // this path, so exactly +1 proves the entry guard ran.
  await Promise.race([
    signInWithGoogle().then(
      () => null,
      () => null,
    ),
    new Promise((r) => setTimeout(() => r("timeout"), 3000)),
  ]);
  assert.equal(getAuthEpoch(), before + 1);
});

test("signInWithGoogle drops cached identity rows so user-B never paints user-A", async () => {
  // Stronger than the epoch assertion above: seed a user-A /auth/me row,
  // prove it is served from cache, run the social sign-in (its redirect
  // never settles in node — hygiene runs before it either way), then
  // prove the next read refetches instead of replaying user-A's row.
  const { uninstall } = installFakeWindow();
  __resetAuthCachesForTesting();
  let meFetches = 0;
  const restore = __setFetchForTesting(
    (async (input: unknown) => {
      const url = String(input);
      if (url.includes("/api/auth/token")) return tokenOk("seed-token");
      if (url.includes("/api/v1/auth/me")) {
        meFetches += 1;
        return apiJson({
          user: {
            id: "user-a",
            email: "a@test.com",
            displayName: "A",
            onboardingDone: true,
          },
        });
      }
      return apiJson({});
    }) as typeof fetch,
  );
  try {
    const seeded = await apiGetMe("user-a");
    assert.equal(seeded.id, "user-a");
    await apiGetMe("user-a");
    assert.equal(meFetches, 1, "second read served from cache");
    await Promise.race([
      signInWithGoogle().then(
        () => null,
        () => null,
      ),
      new Promise((r) => setTimeout(() => r("timeout"), 3000)),
    ]);
    await apiGetMe("user-a");
    assert.equal(
      meFetches,
      2,
      "cached user-A row must not survive a social sign-in",
    );
  } finally {
    restore();
    uninstall();
  }
});

test("apiLogout clears the local profile seed and reports ok", async () => {
  const { uninstall } = installFakeWindow();
  __resetAuthCachesForTesting();
  updateProfile({
    institution: "EC",
    semester: "S3",
    branch: "ECE",
    subjects: ["OS"],
  });
  setProfileSeedPending(true);
  setSeededIdentityKey(identitySeedKey("user-a", 1));
  // Token mint + POST /auth/logout 204 + BetterAuth signOut round-trip
  // (extra queue entry; harmless if the client short-circuits offline).
  const restore = __setFetchForTesting(
    (async (input: unknown) => {
      const url = String(input);
      if (url.includes("/api/auth/token")) return tokenOk("logout-token");
      if (url.includes("/api/v1/auth/logout")) return apiNoContent();
      return apiJson({});
    }) as typeof fetch,
  );
  try {
    const outcome = await apiLogout();
    assert.deepEqual(outcome, { kind: "ok" });
    const cleared = getProfile();
    assert.equal(cleared.institution, "");
    assert.equal(cleared.semester, "");
    assert.equal(cleared.branch, "");
    assert.deepEqual(cleared.subjects, []);
    assert.equal(getProfileSeedPending(), false);
    assert.equal(getSeededIdentityKey(), null);
  } finally {
    restore();
    uninstall();
  }
});
