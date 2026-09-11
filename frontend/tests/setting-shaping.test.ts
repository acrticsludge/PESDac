// Setting-shaping tests (stream S3): verbosity + citations persistence and
// per-chat answer-style resolution.
//
// Slice 1 locks the global persist contract (PATCH round-trip, guest
// memory-only, rollback on failure); slice 2 locks the compartmental
// resolver (`resolveAnswerStyle`: per-chat override > global > built-in).
// Nothing consumes these fields in the send path yet, so setting an
// override changes no current behavior — the suite staying green IS the
// no-op-safety assertion.
//
// Style mirrors settings-scope.test.ts: stubbed window/fetch,
// state-based assertions, DAMP self-contained cases.

import test from "node:test";
import assert from "node:assert/strict";

const snapshotStorage = new Map<string, string>();
const fakeLocalStorage = {
  getItem: (k: string) => (snapshotStorage.has(k) ? snapshotStorage.get(k)! : null),
  setItem: (k: string, v: string) => {
    snapshotStorage.set(k, String(v));
  },
  removeItem: (k: string) => {
    snapshotStorage.delete(k);
  },
  clear: () => snapshotStorage.clear(),
  get length() {
    return snapshotStorage.size;
  },
  key: (i: number) => [...snapshotStorage.keys()][i] ?? null,
};
if (typeof (globalThis as Record<string, unknown>).window === "undefined") {
  (globalThis as Record<string, unknown>).window = {
    dispatchEvent() {},
    addEventListener() {},
    removeEventListener() {},
    localStorage: fakeLocalStorage,
  };
}

import {
  __setApiRootForTesting,
  __setAuthBaseForTesting,
  __setFetchForTesting,
} from "../src/lib/auth.ts";
import {
  __resetChatBackingForTesting,
  clearLocalProfileSeed,
  clearScopeOverrides,
  getProfile,
  resetChatStoreForIdentity,
  scopeKey,
  setScopeOverride,
  updateProfile,
} from "../src/lib/session.ts";
import {
  __flushSettingsDebounceForTesting,
  savePreference,
} from "../src/lib/settings-scope.ts";
import { resolveAnswerStyle } from "../src/lib/setting-shaping.ts";

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

type FetchLog = { url: string; method: string; body: string };
/** Routes token mints + API calls from queues; records every API call. */
function makeRouter(
  tokenQueue: Array<() => Response>,
  apiQueue: Array<() => Response>,
  apiLog: FetchLog[],
): typeof fetch {
  return (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/auth/token")) {
      const next = tokenQueue.shift();
      if (!next) throw new Error(`token fetch with empty queue: ${url}`);
      return next();
    }
    apiLog.push({
      url,
      method: String((init as Record<string, unknown>)?.method ?? "GET"),
      body: String((init as Record<string, unknown>)?.body ?? ""),
    });
    const next = apiQueue.shift();
    if (!next) throw new Error(`api fetch with empty queue: ${url}`);
    return next();
  }) as typeof fetch;
}

function setShapingGlobals() {
  updateProfile({ verbosity: "balanced", citations: "on request" });
}

type Toast = { body: string; type: string };

// ---------------------------------------------------------------------------
// Slice 1: global persist (existing validated PATCH contract)
// ---------------------------------------------------------------------------

test("global verbosity survives logout/login: PATCH round-trip in stubbed test", async () => {
  __resetChatBackingForTesting();
  clearScopeOverrides();
  setShapingGlobals();
  const apiLog: FetchLog[] = [];
  __setFetchForTesting(
    makeRouter([() => tokenOk("t-s3")], [() => apiJson({ ok: true })], apiLog),
  );
  const toasts: Toast[] = [];
  savePreference({ verbosity: "thorough" }, (t) => toasts.push(t as Toast), {
    server: true,
  });
  // Instant local UI (write-through optimism).
  assert.equal(getProfile().verbosity, "thorough");
  await __flushSettingsDebounceForTesting();
  assert.equal(apiLog.length, 1);
  assert.ok(apiLog[0].url.endsWith("/profiles/me"));
  assert.equal(apiLog[0].method, "PATCH");
  assert.deepEqual(JSON.parse(apiLog[0].body), { verbosity: "thorough" });
  assert.equal(toasts.length, 0);
  // Logout/login hygiene keeps preference fields (identity seed only drops
  // campus/semester/branch/subjects) — the value roams.
  clearLocalProfileSeed();
  assert.equal(getProfile().verbosity, "thorough");
});

test("global citations PATCH round-trip persists", async () => {
  __resetChatBackingForTesting();
  clearScopeOverrides();
  setShapingGlobals();
  const apiLog: FetchLog[] = [];
  __setFetchForTesting(
    makeRouter([() => tokenOk("t-s3")], [() => apiJson({ ok: true })], apiLog),
  );
  const toasts: Toast[] = [];
  savePreference({ citations: "always" }, (t) => toasts.push(t as Toast), {
    server: true,
  });
  assert.equal(getProfile().citations, "always");
  await __flushSettingsDebounceForTesting();
  assert.equal(apiLog.length, 1);
  assert.deepEqual(JSON.parse(apiLog[0].body), { citations: "always" });
  assert.equal(toasts.length, 0);
});

test("guest shaping save is memory-only: zero fetches", async () => {
  __resetChatBackingForTesting();
  clearScopeOverrides();
  setShapingGlobals();
  const apiLog: FetchLog[] = [];
  __setFetchForTesting(
    makeRouter([() => tokenOk("t-never")], [], apiLog),
  );
  const toasts: Toast[] = [];
  const notify = (t: { body: string; type: "error" }) => toasts.push(t as Toast);
  savePreference({ verbosity: "concise" }, notify, { server: false });
  savePreference({ citations: "always" }, notify, { server: false });
  assert.equal(getProfile().verbosity, "concise");
  assert.equal(getProfile().citations, "always");
  await __flushSettingsDebounceForTesting();
  assert.equal(apiLog.length, 0);
  assert.equal(toasts.length, 0);
});

test("failed shaping PATCH rolls back memory and fires one error toast", async () => {
  __resetChatBackingForTesting();
  clearScopeOverrides();
  setShapingGlobals();
  const apiLog: FetchLog[] = [];
  __setFetchForTesting(
    makeRouter(
      [() => tokenOk("t-s3")],
      [() => apiJson({ code: "x", message: "boom" }, 500)],
      apiLog,
    ),
  );
  const toasts: Toast[] = [];
  savePreference({ verbosity: "concise" }, (t) => toasts.push(t as Toast), {
    server: true,
  });
  assert.equal(getProfile().verbosity, "concise");
  await __flushSettingsDebounceForTesting();
  assert.equal(apiLog.length, 1);
  assert.equal(getProfile().verbosity, "balanced");
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].type, "error");
});

// ---------------------------------------------------------------------------
// Slice 2: per-chat resolver (per-chat > global > built-in)
// ---------------------------------------------------------------------------

test("resolveAnswerStyle reads the globals when no override exists", () => {
  __resetChatBackingForTesting();
  clearScopeOverrides();
  setShapingGlobals();
  assert.deepEqual(resolveAnswerStyle({ chatCode: "C-CN-01" }), {
    verbosity: "balanced",
    citations: "on request",
  });
  assert.deepEqual(resolveAnswerStyle({ chatCode: null }), {
    verbosity: "balanced",
    citations: "on request",
  });
});

test("per-chat verbosity override resolves only in that chat", () => {
  __resetChatBackingForTesting();
  clearScopeOverrides();
  setShapingGlobals();
  setScopeOverride("verbosity", scopeKey("chat", "C-CN-01"), "concise");
  assert.deepEqual(resolveAnswerStyle({ chatCode: "C-CN-01" }), {
    verbosity: "concise",
    citations: "on request",
  });
  // Sibling chats still inherit the global.
  assert.deepEqual(resolveAnswerStyle({ chatCode: "C-CN-02" }), {
    verbosity: "balanced",
    citations: "on request",
  });
});

test("per-chat citations override resolves only in that chat", () => {
  __resetChatBackingForTesting();
  clearScopeOverrides();
  setShapingGlobals();
  setScopeOverride("citations", scopeKey("chat", "C-CN-01"), "always");
  assert.deepEqual(resolveAnswerStyle({ chatCode: "C-CN-01" }), {
    verbosity: "balanced",
    citations: "always",
  });
  assert.deepEqual(resolveAnswerStyle({ chatCode: "C-CN-02" }), {
    verbosity: "balanced",
    citations: "on request",
  });
});

test("reset (Use default) restores inheritance for that chat", () => {
  __resetChatBackingForTesting();
  clearScopeOverrides();
  setShapingGlobals();
  const scope = scopeKey("chat", "C-CN-01");
  setScopeOverride("verbosity", scope, "thorough");
  setScopeOverride("citations", scope, "always");
  assert.deepEqual(resolveAnswerStyle({ chatCode: "C-CN-01" }), {
    verbosity: "thorough",
    citations: "always",
  });
  setScopeOverride("verbosity", scope, undefined);
  setScopeOverride("citations", scope, undefined);
  assert.deepEqual(resolveAnswerStyle({ chatCode: "C-CN-01" }), {
    verbosity: "balanced",
    citations: "on request",
  });
});

test("identity transition clears shaping overrides (never leaks across users)", () => {
  __resetChatBackingForTesting();
  clearScopeOverrides();
  setShapingGlobals();
  const scope = scopeKey("chat", "C-CN-01");
  setScopeOverride("verbosity", scope, "concise");
  setScopeOverride("citations", scope, "always");
  resetChatStoreForIdentity();
  assert.deepEqual(resolveAnswerStyle({ chatCode: "C-CN-01" }), {
    verbosity: "balanced",
    citations: "on request",
  });
});
