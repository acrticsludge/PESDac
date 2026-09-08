// Link-password boundary regression tests (T6, retargeted).
// linkPassword calls the SAME-ORIGIN Astro route POST /api/link-password
// (the BetterAuth serverOnly setPassword has no HTTP path, so the old
// backend proxy could only 404). No token mint, no /api/v1 prefix — the
// session cookie rides along same-origin. Reuses the
// `__setFetchForTesting` fetch-swap pattern: no live server, fake window
// for AUTH_REQUIRED_EVENT dispatch capture.

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
  __setFetchForTesting,
} from "../src/lib/auth.ts";

function apiJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type ApiCall = { url: string; init: RequestInit | undefined };

function makeRouter(queue: Array<() => Response>, apiLog: ApiCall[]): typeof fetch {
  return (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    apiLog.push({ url, init });
    const next = queue.shift();
    if (!next) throw new Error(`fetch with empty queue: ${url}`);
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
  const restore = __setFetchForTesting(
    makeRouter([() => apiJson({ ok: true })], apiLog),
  );
  try {
    await linkPassword("passwordpassword");
    assert.equal(apiLog.length, 1);
    // Same-origin Astro route: relative URL, no backend prefix, no token.
    assert.equal(apiLog[0].url, "/api/link-password");
    assert.equal(apiLog[0].init?.method, "POST");
    assert.equal(apiLog[0].init?.credentials, "same-origin");
    // Cookie-only auth: no bearer token is minted or attached on this route.
    const sentHeaders = (apiLog[0].init?.headers ?? {}) as Record<string, string>;
    assert.ok(!("Authorization" in sentHeaders), "no Authorization header on same-origin link");
    const sent = JSON.parse(String(apiLog[0].init?.body));
    assert.equal(sent.newPassword, "passwordpassword");
    assert.equal(__getAccountsVersionForTesting(), before + 1);
  } finally {
    restore();
  }
});

test("linkPassword against a server failure throws ApiError with zero auth-required events", async () => {
  __resetAuthCachesForTesting();
  const { events, uninstall } = installFakeWindow();
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter(
      [() => apiJson({ error: { code: "AUTH_ERROR", message: "Couldn't link password. Try again." } }, 500)],
      apiLog,
    ),
  );
  try {
    let caught: unknown = null;
    try {
      await linkPassword("passwordpassword");
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof ApiError, "server failure surfaces as ApiError");
    assert.ok(!(caught instanceof AuthRequiredError), "server failure is not a session loss");
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

test("linkPassword against a genuine 401 still dispatches exactly one auth-required event", async () => {
  __resetAuthCachesForTesting();
  const { events, uninstall } = installFakeWindow();
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter(
      [() => apiJson({ error: { code: "UNAUTHORIZED", message: "Sign in to continue." } }, 401)],
      apiLog,
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

test("linkPassword surfaces the server's message for 4xx (e.g. already set)", async () => {
  __resetAuthCachesForTesting();
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter(
      [() => apiJson({ error: { code: "PASSWORD_ALREADY_SET", message: "You already have a password set." } }, 400)],
      apiLog,
    ),
  );
  try {
    let caught: unknown = null;
    try {
      await linkPassword("passwordpassword");
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof ApiError, "4xx surfaces as ApiError");
    assert.equal(toUserMessage(caught, "FALLBACK"), "You already have a password set.");
  } finally {
    restore();
  }
});

test("linkPassword with ok:false throws the generic link error", async () => {
  __resetAuthCachesForTesting();
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter([() => apiJson({ ok: false })], apiLog),
  );
  try {
    let caught: unknown = null;
    try {
      await linkPassword("passwordpassword");
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof Error, "non-ok body throws");
    assert.equal(toUserMessage(caught, "FALLBACK"), "Couldn't link password. Try again.");
  } finally {
    restore();
  }
});
