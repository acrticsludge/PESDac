// Display-name rename boundary tests (display-name-edit T2).
// updateDisplayName calls authClient.updateUser (BetterAuth-owned
// identity, per T20) with zero-request client validation. The transport
// is injected via __setUpdateUserForTesting: the generated client is a
// Proxy whose methods can't be reassigned (dist/client/proxy.mjs serves
// init-time closures), and its bundled fetch bypasses the fetch-swap
// seam in node. Cache-refresh assertions reuse the fetch-swap +
// fake-window patterns from the other suites.

import test from "node:test";
import assert from "node:assert/strict";

import {
  ApiError,
  AuthRequiredError,
  AUTH_REQUIRED_EVENT,
  apiGetMe,
  MAX_DISPLAY_NAME_LENGTH,
  toUserMessage,
  updateDisplayName,
  __getProfileVersionForTesting,
  __resetAuthCachesForTesting,
  __setApiRootForTesting,
  __setAuthBaseForTesting,
  __setFetchForTesting,
  __setUpdateUserForTesting,
  type UpdateUserTransport,
} from "../src/lib/auth.ts";

__setAuthBaseForTesting("https://auth.test");
__setApiRootForTesting("https://api.test");

type UpdateUserArgs = { name: string };

function stubUpdateUser(impl: UpdateUserTransport): () => void {
  __setUpdateUserForTesting(impl);
  return () => {
    __setUpdateUserForTesting(null);
  };
}

function installFakeWindow(): { events: string[]; uninstall: () => void } {
  const events: string[] = [];
  const listeners = new Map<string, Set<(ev: { type: string }) => void>>();
  const fake = {
    __pesdacAuthDispatched: false,
    addEventListener: (type: string, fn: (ev: { type: string }) => void) => {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(fn);
    },
    removeEventListener: (type: string, fn: (ev: { type: string }) => void) => {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent: (ev: { type: string }) => {
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

function apiJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("display-name cap mirrors the backend [:80] mirror", () => {
  assert.equal(MAX_DISPLAY_NAME_LENGTH, 80);
});

test("updateDisplayName trims and sends { name } only", async () => {
  __resetAuthCachesForTesting();
  const seen: UpdateUserArgs[] = [];
  const restore = stubUpdateUser(async (args) => {
    seen.push(args);
    return { data: {}, error: null };
  });
  try {
    await updateDisplayName("  Test User  ");
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0], { name: "Test User" });
    assert.deepEqual(
      Object.keys(seen[0]),
      ["name"],
      "never send email (the server rejects it)",
    );
  } finally {
    restore();
  }
});

test("updateDisplayName rejects empty/whitespace with zero calls", async () => {
  __resetAuthCachesForTesting();
  let calls = 0;
  const restore = stubUpdateUser(async () => {
    calls += 1;
    return { data: {}, error: null };
  });
  try {
    for (const bad of ["", "   ", "\n\t "]) {
      let caught: unknown = null;
      try {
        await updateDisplayName(bad);
      } catch (e) {
        caught = e;
      }
      assert.ok(caught instanceof Error, `input ${JSON.stringify(bad)} throws`);
      assert.equal((caught as Error).message, "Enter a display name.");
    }
    assert.equal(calls, 0, "validation costs zero requests");
  } finally {
    restore();
  }
});

test("updateDisplayName rejects over-long input with zero calls", async () => {
  __resetAuthCachesForTesting();
  let calls = 0;
  const restore = stubUpdateUser(async () => {
    calls += 1;
    return { data: {}, error: null };
  });
  try {
    let caught: unknown = null;
    try {
      await updateDisplayName("x".repeat(MAX_DISPLAY_NAME_LENGTH + 1));
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof Error, "81 chars throws");
    assert.equal(
      (caught as Error).message,
      `Display name must be at most ${MAX_DISPLAY_NAME_LENGTH} characters.`,
    );
    assert.equal(calls, 0, "validation costs zero requests");
    // Boundary: exactly 80 passes validation and reaches the client.
    await updateDisplayName("x".repeat(MAX_DISPLAY_NAME_LENGTH));
    assert.equal(calls, 1);
  } finally {
    restore();
  }
});

test("updateDisplayName surfaces the server message, then the fallback", async () => {
  __resetAuthCachesForTesting();
  const restore = stubUpdateUser(async () => ({
    data: null,
    error: { message: "Name update failed." },
  }));
  try {
    let caught: unknown = null;
    try {
      await updateDisplayName("Test User");
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof Error, "server failure throws");
    assert.ok(!(caught instanceof AuthRequiredError), "not a session loss");
    assert.equal(
      toUserMessage(caught, "FALLBACK"),
      "Name update failed.",
      "server-authored copy survives",
    );
  } finally {
    restore();
  }

  const restoreFallback = stubUpdateUser(async () => ({
    data: null,
    error: {},
  }));
  try {
    let caught: unknown = null;
    try {
      await updateDisplayName("Test User");
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof Error, "messageless failure throws");
    assert.equal(
      toUserMessage(caught, "FALLBACK"),
      "Couldn't save your name. Try again.",
    );
  } finally {
    restoreFallback();
  }
});

test("updateDisplayName 401 routes to the global flow exactly once", async () => {
  __resetAuthCachesForTesting();
  const { events, uninstall } = installFakeWindow();
  const restore = stubUpdateUser(async () => ({
    data: null,
    error: { status: 401, message: "Unauthorized" },
  }));
  const restoreFetch = __setFetchForTesting((async () => {
    throw new Error("no fetch expected on the 401 path");
  }) as typeof fetch);
  try {
    let caught: unknown = null;
    try {
      await updateDisplayName("Test User");
    } catch (e) {
      caught = e;
    }
    assert.ok(
      caught instanceof AuthRequiredError,
      "session loss surfaces as AuthRequiredError, never a form error",
    );
    assert.equal(
      events.filter((t) => t === AUTH_REQUIRED_EVENT).length,
      1,
      "one navigation signal per genuine 401",
    );
  } finally {
    restore();
    restoreFetch();
    uninstall();
  }
});

test("updateDisplayName success drops the cached /auth/me row", async () => {
  __resetAuthCachesForTesting();
  let meFetches = 0;
  const restoreFetch = __setFetchForTesting(
    (async (input: unknown) => {
      const url = String(input);
      if (url.includes("/api/auth/token")) {
        return apiJson({ token: "name-token" });
      }
      if (url.includes("/api/v1/auth/me")) {
        meFetches += 1;
        return apiJson({
          user: {
            id: "user-a",
            email: "a@test.com",
            displayName: "Test User",
            onboardingDone: true,
          },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch,
  );
  const restore = stubUpdateUser(async () => ({ data: {}, error: null }));
  try {
    await apiGetMe("user-a");
    await apiGetMe("user-a");
    assert.equal(meFetches, 1, "second read served from cache");
    await updateDisplayName("Test User");
    await apiGetMe("user-a");
    assert.equal(
      meFetches,
      2,
      "renamed row must be refetched, never replayed stale",
    );
  } finally {
    restore();
    restoreFetch();
  }
});

test("updateDisplayName failure keeps the cached /auth/me row", async () => {  __resetAuthCachesForTesting();
  let meFetches = 0;
  const restoreFetch = __setFetchForTesting(
    (async (input: unknown) => {
      const url = String(input);
      if (url.includes("/api/auth/token")) {
        return apiJson({ token: "name-token" });
      }
      if (url.includes("/api/v1/auth/me")) {
        meFetches += 1;
        return apiJson({
          user: {
            id: "user-a",
            email: "a@test.com",
            displayName: "Test User",
            onboardingDone: true,
          },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch,
  );
  const restore = stubUpdateUser(async () => ({
    data: null,
    error: { message: "boom" },
  }));
  try {
    await apiGetMe("user-a");
    assert.equal(meFetches, 1);
    await assert.rejects(() => updateDisplayName("Test User"), /boom/);
    await apiGetMe("user-a");
    assert.equal(
      meFetches,
      1,
      "a failed rename must not invalidate the good row",
    );
  } finally {
    restore();
    restoreFetch();
  }
});

// Keeps the ApiError import live: server-envelope 404/5xx copy is pinned
// here so a future edit to the fallback cannot regress it silently.
test("toUserMessage still pins server-envelope copy", () => {
  assert.equal(
    toUserMessage(new ApiError(404, null, "Not Found"), "FALLBACK"),
    "That didn't work. Please try again later.",
  );
});

test("updateDisplayName success bumps the profile generation (mounted useProfile readers refetch)", async () => {
  __resetAuthCachesForTesting();
  const before = __getProfileVersionForTesting();
  const restore = stubUpdateUser(async () => ({ data: {}, error: null }));
  try {
    await updateDisplayName("Test User");
    assert.equal(
      __getProfileVersionForTesting(),
      before + 1,
      "rename visibly refetches without a reload",
    );
  } finally {
    restore();
  }
});

test("updateDisplayName validation failure bumps nothing and calls nothing", async () => {
  __resetAuthCachesForTesting();
  const before = __getProfileVersionForTesting();
  let calls = 0;
  const restore = stubUpdateUser(async () => {
    calls += 1;
    return { data: {}, error: null };
  });
  try {
    await assert.rejects(() => updateDisplayName("   "), /Enter a display name/);
    assert.equal(calls, 0);
    assert.equal(__getProfileVersionForTesting(), before);
  } finally {
    restore();
  }
});
