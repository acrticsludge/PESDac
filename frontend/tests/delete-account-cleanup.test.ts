// Identity-heap cleanup tests (audit §4).
// Every terminal identity transition must drop the same heap: auth
// caches, local profile seed (no leak into the next identity), and the
// sibling-tab ping. A failed backend delete must touch nothing; an
// identity-pending delete keeps the local heap for the login-page retry.

import test from "node:test";
import assert from "node:assert/strict";

import {
  apiDeleteAccount,
  clearIdentityHeap,
  __resetAuthCachesForTesting,
  __setApiRootForTesting,
  __setAuthBaseForTesting,
  __setFetchForTesting,
} from "../src/lib/auth.ts";
import { getProfile, updateProfile } from "../src/lib/session.ts";
import { LOGOUT_PING_KEY } from "../src/lib/cache-revalidation.ts";

__setAuthBaseForTesting("https://auth.test");
__setApiRootForTesting("https://api.test");

function tokenOk(): Response {
  return new Response(JSON.stringify({ token: "signed-token" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function jsonOk(data: unknown = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function installFakeWindow(): {
  storage: Map<string, string>;
  uninstall: () => void;
} {
  const storage = new Map<string, string>();
  const fake = {
    localStorage: {
      getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
      setItem: (k: string, v: string) => {
        storage.set(k, String(v));
      },
      removeItem: (k: string) => {
        storage.delete(k);
      },
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  };
  (globalThis as Record<string, unknown>).window = fake;
  return {
    storage,
    uninstall: () => {
      delete (globalThis as Record<string, unknown>).window;
    },
  };
}

function seedIdentity(): void {
  // Institution carries the campus (D7: only RR/EC/blank survive a read).
  updateProfile({
    institution: "RR",
    semester: "S5",
    branch: "CSE",
    subjects: ["CN"],
  });
}

function makeFetch(deleteStatus: number): typeof fetch {
  return (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/auth/token")) return tokenOk();
    if (url.includes("/api/v1/users/me") && (init?.method ?? "GET") === "DELETE") {
      // NB: 204 responses must carry a null body — undici rejects "".
      return deleteStatus === 204
        ? new Response(null, { status: 204 })
        : new Response(
            JSON.stringify({ error: { code: "DOWN", message: "Down." } }),
            {
              status: deleteStatus,
              headers: { "content-type": "application/json" },
            },
          );
    }
    return jsonOk();
  }) as typeof fetch;
}

test("clearIdentityHeap resets the profile seed and pings siblings", () => {
  const { storage, uninstall } = installFakeWindow();
  try {
    seedIdentity();
    assert.equal(getProfile().institution, "RR");
    clearIdentityHeap();
    const after = getProfile();
    assert.equal(after.institution, "");
    assert.equal(after.semester, "");
    assert.equal(after.branch, "");
    assert.deepEqual(after.subjects, []);
    assert.ok(
      storage.has(LOGOUT_PING_KEY),
      "sibling tabs must be told to drop their heaps",
    );
  } finally {
    uninstall();
    __resetAuthCachesForTesting();
  }
});

test("failed backend delete touches neither seed nor siblings", async () => {
  const { storage, uninstall } = installFakeWindow();
  const restore = __setFetchForTesting(makeFetch(500));
  try {
    seedIdentity();
    const outcome = await apiDeleteAccount();
    assert.equal(outcome.kind, "backend-failed");
    assert.equal(getProfile().institution, "RR");
    assert.ok(!storage.has(LOGOUT_PING_KEY));
  } finally {
    restore();
    uninstall();
    __resetAuthCachesForTesting();
  }
});

test("identity-pending delete keeps the heap for the login-page retry", async () => {
  // Node limitation, documented: the BetterAuth client is created with a
  // relative baseURL, unresolvable without a browser origin, so
  // deleteUser() always throws here and the complete path (heap-drop +
  // best-effort signOut) cannot run in this harness. The heap-drop itself
  // is pinned above; the browser complete path reuses that same helper.
  const { storage, uninstall } = installFakeWindow();
  const restore = __setFetchForTesting(makeFetch(204));
  try {
    seedIdentity();
    const outcome = await apiDeleteAccount();
    assert.equal(outcome.kind, "identity-pending");
    assert.equal(getProfile().institution, "RR");
    assert.ok(!storage.has(LOGOUT_PING_KEY));
  } finally {
    restore();
    uninstall();
    __resetAuthCachesForTesting();
  }
});
