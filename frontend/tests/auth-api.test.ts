// Production request-boundary regression tests (T48/T50).
// The first three tests pin the pure header helper used by apiFetch itself.
// The apiFetch tests below observe the REAL decision boundary: fetch calls
// made, Authorization presence, and AUTH_REQUIRED_EVENT dispatch.

import test from "node:test";
import assert from "node:assert/strict";

import { withBearerToken, type TokenResult } from "../src/lib/auth-cache.ts";
import {
  apiFetch,
  AuthRequiredError,
  AuthServiceError,
  AUTH_REQUIRED_EVENT,
  __resetAuthCachesForTesting,
  __setApiRootForTesting,
  __setAuthBaseForTesting,
  __setFetchForTesting,
} from "../src/lib/auth.ts";

const baseHeaders = { Accept: "application/json" };

test("successful token mint creates exactly one bearer authorization header", () => {
  const result: TokenResult = { reason: "ok", token: "signed-token" };
  assert.deepEqual(withBearerToken(baseHeaders, result), {
    Accept: "application/json",
    Authorization: "Bearer signed-token",
  });
});

test("token service failure cannot create a protected request header", () => {
  const transient: TokenResult = { reason: "server" };
  const invalid: TokenResult = { reason: "client-error" };
  assert.equal(withBearerToken(baseHeaders, transient), null);
  assert.equal(withBearerToken(baseHeaders, invalid), null);
});

test("header construction does not mutate the caller's headers", () => {
  const original = { Accept: "application/json" };
  const result: TokenResult = { reason: "ok", token: "token" };
  withBearerToken(original, result);
  assert.deepEqual(original, { Accept: "application/json" });
});

// ---------------------------------------------------------------------------
// T50 — real apiFetch boundary. No live server: the fetch router serves the
// token endpoint and the API endpoint from queues, and a fake window captures
// AUTH_REQUIRED_EVENT dispatches (Node has no window; CustomEvent is native).
// ---------------------------------------------------------------------------

__setAuthBaseForTesting("https://auth.test");
__setApiRootForTesting("https://api.test");

function tokenOk(token: string): Response {
  return new Response(JSON.stringify({ token }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function httpStatus(status: number): Response {
  return new Response("", { status });
}

function apiJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type ApiCall = { url: string; auth: string | null };

/** Routes token mints and API calls from separate queues; records API calls. */
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

function authRequiredCount(events: string[]): number {
  return events.filter((t) => t === AUTH_REQUIRED_EVENT).length;
}

test("apiFetch success mints once and sends one authorized request", async () => {
  __resetAuthCachesForTesting();
  const apiLog: ApiCall[] = [];
  const tokenCounter = { value: 0 };
  const restore = __setFetchForTesting(
    makeRouter([() => tokenOk("t1")], [() => apiJson({ user: "u1" })], apiLog, tokenCounter),
  );
  try {
    const res = await apiFetch<{ user: string }>("/auth/me");
    assert.deepEqual(res, { user: "u1" });
    assert.equal(tokenCounter.value, 1, "exactly one token mint");
    assert.equal(apiLog.length, 1, "exactly one protected request");
    assert.equal(apiLog[0].auth, "Bearer t1");
  } finally {
    restore();
  }
});

test("apiFetch token failure makes zero protected requests", async () => {
  __resetAuthCachesForTesting();
  const apiLog: ApiCall[] = [];
  const tokenCounter = { value: 0 };
  const restore = __setFetchForTesting(
    makeRouter([() => httpStatus(500), () => httpStatus(500)], [], apiLog, tokenCounter),
  );
  try {
    let caught: unknown = null;
    try {
      await apiFetch("/auth/me");
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof AuthServiceError, "typed recoverable error");
    assert.equal((caught as AuthServiceError).reason, "server");
    assert.equal(tokenCounter.value, 2, "initial attempt plus one retry");
    assert.equal(apiLog.length, 0, "no fallback unauthenticated request");
  } finally {
    restore();
  }
});

test("apiFetch token failure dispatches zero auth-required events", async () => {
  __resetAuthCachesForTesting();
  const { events, uninstall } = installFakeWindow();
  const apiLog: ApiCall[] = [];
  const tokenCounter = { value: 0 };
  const restore = __setFetchForTesting(
    makeRouter([() => httpStatus(503), () => httpStatus(503)], [], apiLog, tokenCounter),
  );
  try {
    let caught: unknown = null;
    try {
      await apiFetch("/auth/me");
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof AuthServiceError);
    assert.equal(apiLog.length, 0);
    assert.equal(authRequiredCount(events), 0, "outage is not an invalid session");
  } finally {
    restore();
    uninstall();
  }
});

test("apiFetch backend 401 dispatches exactly one auth-required event", async () => {
  __resetAuthCachesForTesting();
  const { events, uninstall } = installFakeWindow();
  const apiLog: ApiCall[] = [];
  const tokenCounter = { value: 0 };
  const restore = __setFetchForTesting(
    makeRouter(
      [() => tokenOk("t401")],
      [() => apiJson({ code: "AUTH_REQUIRED", message: "Sign in to continue." }, 401)],
      apiLog,
      tokenCounter,
    ),
  );
  try {
    let caught: unknown = null;
    try {
      await apiFetch("/auth/me");
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof AuthRequiredError, "confirmed 401 surfaces");
    assert.equal(apiLog.length, 1, "the authorized request was attempted");
    assert.equal(apiLog[0].auth, "Bearer t401");
    assert.equal(authRequiredCount(events), 1, "one navigation signal per 401");
  } finally {
    restore();
    uninstall();
  }
});

test("apiFetch concurrent callers share one token attempt sequence", async () => {
  __resetAuthCachesForTesting();
  const apiLog: ApiCall[] = [];
  const tokenCounter = { value: 0 };
  const restore = __setFetchForTesting(
    makeRouter(
      [() => tokenOk("shared")],
      [() => apiJson({ n: 1 }), () => apiJson({ n: 2 })],
      apiLog,
      tokenCounter,
    ),
  );
  try {
    const [a, b] = await Promise.all([apiFetch<{ n: number }>("/a"), apiFetch<{ n: number }>("/b")]);
    assert.deepEqual(a, { n: 1 });
    assert.deepEqual(b, { n: 2 });
    assert.equal(tokenCounter.value, 1, "concurrent callers deduped to one mint");
    assert.equal(apiLog.length, 2, "each caller still makes its own request");
    assert.equal(apiLog[0].auth, "Bearer shared");
    assert.equal(apiLog[1].auth, "Bearer shared");
  } finally {
    restore();
  }
});
