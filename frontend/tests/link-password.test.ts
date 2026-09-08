// Link-password boundary regression tests (T6).
// Reuses the `__setFetchForTesting` fetch-router pattern from
// auth-api.test.ts: no live server, token + API queues, fake window for
// AUTH_REQUIRED_EVENT dispatch capture.

import test from "node:test";
import assert from "node:assert/strict";

import {
  ApiError,
  AuthRequiredError,
  AuthServiceError,
  AUTH_REQUIRED_EVENT,
  linkPassword,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  toUserMessage,
  __getAccountsVersionForTesting,
  __resetAuthCachesForTesting,
  __setApiRootForTesting,
  __setAuthBaseForTesting,
  __setFetchForTesting,
} from "../src/lib/auth.ts";

__setAuthBaseForTesting("https://auth.test");
__setApiRootForTesting("https://api.test");

function tokenOk(token: string): Response {
  return new Response(JSON.stringify({ token }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function apiJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type ApiCall = { url: string; auth: string | null };

function makeRouter(
  tokenQueue: Array<() => Response>,
  apiQueue: Array<() => Response>,
  apiLog: ApiCall[],
  tokenCounter: { value: number },
): typeof fetch {
  return (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/auth/token")) {
      tokenCounter.value += 1;
      const next = tokenQueue.shift();
      if (!next) throw new Error(`token fetch with empty queue: ${url}`);
      return next();
    }
    const headers = (init?.headers ?? {}) as Record<string, string>;
    apiLog.push({ url, auth: headers.Authorization ?? null });
    const next = apiQueue.shift();
    if (!next) throw new Error(`api fetch with empty queue: ${url}`);
    return next();
  }) as typeof fetch;
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

test("password length contract mirrors the server (8-128)", () => {
  assert.equal(MIN_PASSWORD_LENGTH, 8);
  assert.equal(MAX_PASSWORD_LENGTH, 128);
});

test("toUserMessage returns the AuthServiceError message via its explicit branch", () => {
  for (
    const reason of [
      "missing-config",
      "network",
      "timeout",
      "rate-limited",
      "server",
      "malformed",
      "client-error",
      "unexpected-status",
    ] as const
  ) {
    const err = new AuthServiceError(reason);
    assert.equal(
      toUserMessage(err, "FALLBACK"),
      err.message,
      `reason ${reason} must surface its own copy, never the fallback`,
    );
    assert.notEqual(toUserMessage(err, "FALLBACK"), "FALLBACK");
  }
});

test("toUserMessage pins 404 and 5xx copy", () => {
  assert.equal(
    toUserMessage(new ApiError(404, null, "Not Found"), "FALLBACK"),
    "That didn't work. Please try again later.",
  );
  assert.equal(
    toUserMessage(new ApiError(503, null, "Service Unavailable"), "FALLBACK"),
    "That didn't work on our end. Please try again later.",
  );
  assert.equal(
    toUserMessage(
      new ApiError(422, { code: "AUTH_VALIDATION", message: "Password too weak." }, "Unprocessable"),
      "FALLBACK",
    ),
    "Password too weak.",
  );
});

test("linkPassword success bumps the accounts generation (visible refetch trigger)", async () => {
  __resetAuthCachesForTesting();
  const before = __getAccountsVersionForTesting();
  const apiLog: ApiCall[] = [];
  const tokenCounter = { value: 0 };
  const restore = __setFetchForTesting(
    makeRouter([() => tokenOk("t-link")], [() => apiJson({ ok: true })], apiLog, tokenCounter),
  );
  try {
    await linkPassword("passwordpassword");
    assert.equal(apiLog.length, 1);
    assert.ok(apiLog[0].url.endsWith("/api/v1/auth/link-password"), apiLog[0].url);
    assert.equal(apiLog[0].auth, "Bearer t-link");
    assert.equal(__getAccountsVersionForTesting(), before + 1);
  } finally {
    restore();
  }
});

test("linkPassword against an upstream-mapped failure throws ApiError with zero auth-required events", async () => {
  // The backend maps BetterAuth upstream-401 to 500 AUTH_ERROR (T2), so the
  // modal must toast recoverably instead of logging out to /login.
  __resetAuthCachesForTesting();
  const { events, uninstall } = installFakeWindow();
  const apiLog: ApiCall[] = [];
  const tokenCounter = { value: 0 };
  const restore = __setFetchForTesting(
    makeRouter(
      [() => tokenOk("t-mapped")],
      [() => apiJson({ error: { code: "AUTH_ERROR", message: "Couldn't link password. Try again." } }, 500)],
      apiLog,
      tokenCounter,
    ),
  );
  try {
    let caught: unknown = null;
    try {
      await linkPassword("passwordpassword");
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof ApiError, "mapped failure surfaces as ApiError");
    assert.ok(!(caught instanceof AuthRequiredError), "mapped failure is not a session loss");
    assert.equal(apiLog.length, 1);
    assert.equal(
      events.filter((t) => t === AUTH_REQUIRED_EVENT).length,
      0,
      "no logout navigation for a recoverable link failure",
    );
    assert.equal(toUserMessage(caught, "FALLBACK"), "That didn't work on our end. Please try again later.");
  } finally {
    restore();
    uninstall();
  }
});

test("linkPassword against a genuine backend 401 still dispatches exactly one auth-required event", async () => {
  __resetAuthCachesForTesting();
  const { events, uninstall } = installFakeWindow();
  const apiLog: ApiCall[] = [];
  const tokenCounter = { value: 0 };
  const restore = __setFetchForTesting(
    makeRouter(
      [() => tokenOk("t-401")],
      [() => apiJson({ error: { code: "UNAUTHORIZED", message: "Invalid or expired session." } }, 401)],
      apiLog,
      tokenCounter,
    ),
  );
  try {
    let caught: unknown = null;
    try {
      await linkPassword("passwordpassword");
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof AuthRequiredError, "genuine 401 surfaces");
    assert.equal(
      events.filter((t) => t === AUTH_REQUIRED_EVENT).length,
      1,
      "one navigation signal per genuine 401",
    );
  } finally {
    restore();
    uninstall();
  }
});
