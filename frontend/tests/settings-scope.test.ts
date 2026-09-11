// Settings-scope kernel tests (settings Step 0).
// The per-chat/per-subject override map, the tiered resolver, and the
// debounced write-through persister every S1–S4 stream builds on.
// Guests cost zero fetches; the map dies on every identity transition.
//
// Style mirrors cache-identity-reset.test.ts: stubbed window/fetch,
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
  clearScopeOverrides,
  getProfile,
  getScopeOverride,
  resetChatStoreForIdentity,
  scopeKey,
  setScopeOverride,
  updateProfile,
} from "../src/lib/session.ts";
import {
  __flushSettingsDebounceForTesting,
  resolveTiered,
  savePreference,
} from "../src/lib/settings-scope.ts";

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

function resetState() {
  __resetChatBackingForTesting();
  clearScopeOverrides();
  updateProfile({
    followUps: true,
    difficulty: "medium",
    verbosity: "balanced",
    citations: "on request",
    examMonth: "",
    weeklyGoal: "5 days",
    language: "en-US",
    region: "IN",
    timezone: "IST",
  });
}

type Toast = { body: string; type: string };

// ---------------------------------------------------------------------------
// Override map
// ---------------------------------------------------------------------------

test("scopeKey namespaces chat scopes", () => {
  resetState();
  assert.equal(scopeKey("chat", "C-CN-01"), "chat:C-CN-01");
});

test("override round-trips and unknown reads undefined", () => {
  resetState();
  assert.equal(getScopeOverride("followUps", scopeKey("chat", "C-CN-01")), undefined);
  setScopeOverride("followUps", scopeKey("chat", "C-CN-01"), false);
  assert.equal(getScopeOverride("followUps", scopeKey("chat", "C-CN-01")), false);
  // Scoped: a sibling chat sees nothing.
  assert.equal(getScopeOverride("followUps", scopeKey("chat", "C-CN-02")), undefined);
});

test("clearScopeOverrides empties the map", () => {
  resetState();
  setScopeOverride("followUps", scopeKey("chat", "C-CN-01"), false);
  clearScopeOverrides();
  assert.equal(getScopeOverride("followUps", scopeKey("chat", "C-CN-01")), undefined);
});

test("identity transition wipes overrides (never leaks across users)", () => {
  resetState();
  setScopeOverride("followUps", scopeKey("chat", "C-CN-01"), false);
  setScopeOverride("verbosity", scopeKey("chat", "C-CN-01"), "concise");
  resetChatStoreForIdentity();
  assert.equal(getScopeOverride("followUps", scopeKey("chat", "C-CN-01")), undefined);
  assert.equal(getScopeOverride("verbosity", scopeKey("chat", "C-CN-01")), undefined);
});

test("identity transition wipes overrides even when guest rows are preserved", () => {
  resetState();
  setScopeOverride("followUps", scopeKey("chat", "C-CN-01"), false);
  resetChatStoreForIdentity({ preserveTrueGuests: true });
  assert.equal(getScopeOverride("followUps", scopeKey("chat", "C-CN-01")), undefined);
});

// ---------------------------------------------------------------------------
// Tiered resolver
// ---------------------------------------------------------------------------

test("resolveTiered falls back to the built-in when the key is absent", () => {
  resetState();
  // `format` is quiz-only: never a Profile key, so the global tier is
  // genuinely absent (a Profile field like examMonth:"" is SET, and
  // first-set-wins correctly returns it).
  assert.equal(resolveTiered("format", null, "single"), "single");
  assert.equal(resolveTiered("format", "C-CN-01", "single"), "single");
});

test("resolveTiered prefers the global over the built-in", () => {
  resetState();
  updateProfile({ difficulty: "hard" });
  assert.equal(resolveTiered("difficulty", null, "medium"), "hard");
});

test("resolveTiered prefers the per-chat override over the global", () => {
  resetState();
  updateProfile({ followUps: true });
  setScopeOverride("followUps", scopeKey("chat", "C-CN-01"), false);
  assert.equal(resolveTiered("followUps", "C-CN-01", true), false);
  // Other chats still read the global.
  assert.equal(resolveTiered("followUps", "C-CN-02", true), true);
});

test("resolveTiered falls back to global after Use-default deletes the entry", () => {
  resetState();
  updateProfile({ followUps: true });
  const scope = scopeKey("chat", "C-CN-01");
  setScopeOverride("followUps", scope, false);
  assert.equal(resolveTiered("followUps", "C-CN-01", true), false);
  setScopeOverride("followUps", scope, undefined);
  assert.equal(resolveTiered("followUps", "C-CN-01", true), true);
});

// ---------------------------------------------------------------------------
// Write-through persister
// ---------------------------------------------------------------------------

test("guest save is memory-only: zero fetches, instant local value", async () => {
  resetState();
  const apiLog: FetchLog[] = [];
  __setFetchForTesting(
    makeRouter([() => tokenOk("t-never")], [], apiLog),
  );
  const toasts: Toast[] = [];
  savePreference({ difficulty: "hard" }, (t) => toasts.push(t as Toast), {
    server: false,
  });
  assert.equal(getProfile().difficulty, "hard");
  await __flushSettingsDebounceForTesting();
  assert.equal(apiLog.length, 0);
  assert.equal(toasts.length, 0);
});

test("authed save PATCHes the server row once and stays silent on success", async () => {
  resetState();
  const apiLog: FetchLog[] = [];
  __setFetchForTesting(
    makeRouter([() => tokenOk("t-s0")], [() => apiJson({ ok: true })], apiLog),
  );
  const toasts: Toast[] = [];
  savePreference({ weeklyGoal: "7 days" }, (t) => toasts.push(t as Toast), {
    server: true,
  });
  // Instant local UI (write-through optimism).
  assert.equal(getProfile().weeklyGoal, "7 days");
  await __flushSettingsDebounceForTesting();
  assert.equal(apiLog.length, 1);
  assert.ok(apiLog[0].url.endsWith("/profiles/me"));
  assert.equal(apiLog[0].method, "PATCH");
  assert.deepEqual(JSON.parse(apiLog[0].body), { weeklyGoal: "7 days" });
  assert.equal(toasts.length, 0);
});

test("failed PATCH rolls back memory and fires one error toast", async () => {
  resetState();
  const apiLog: FetchLog[] = [];
  __setFetchForTesting(
    makeRouter([() => tokenOk("t-s0")], [() => apiJson({ code: "x", message: "boom" }, 500)], apiLog),
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
  assert.equal(toasts[0].body, "That didn't work on our end. Please try again later.");
});

test("rapid re-saves collapse to one PATCH carrying the latest value", async () => {
  resetState();
  const apiLog: FetchLog[] = [];
  __setFetchForTesting(
    makeRouter([() => tokenOk("t-s0")], [() => apiJson({ ok: true })], apiLog),
  );
  const toasts: Toast[] = [];
  const notify = (t: { body: string; type: "error" }) => toasts.push(t as Toast);
  savePreference({ difficulty: "easy" }, notify, { server: true });
  savePreference({ difficulty: "hard" }, notify, { server: true });
  assert.equal(getProfile().difficulty, "hard");
  await __flushSettingsDebounceForTesting();
  assert.equal(apiLog.length, 1);
  assert.deepEqual(JSON.parse(apiLog[0].body), { difficulty: "hard" });
  assert.equal(toasts.length, 0);
});
