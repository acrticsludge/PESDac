// Settings S1 — follow-up suggestions (spec-followup-suggestions.md).
// Resolver precedence (override > global), the three-state menu cycle,
// and the global write-through contract this stream wires into the UI.
// Guests cost zero fetches; overrides die on every identity transition.
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
  savePreference,
} from "../src/lib/settings-scope.ts";
import {
  FOLLOW_UPS_SETTING,
  nextFollowUpsOverride,
  resolveFollowUps,
} from "../src/lib/setting-followups.ts";

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
  updateProfile({ followUps: true });
}

type Toast = { body: string; type: string };

// ---------------------------------------------------------------------------
// Resolver: per-chat override > global default
// ---------------------------------------------------------------------------

test("resolveFollowUps reads the global default for unknown chats", () => {
  resetState();
  assert.equal(resolveFollowUps(null), true);
  assert.equal(resolveFollowUps("C-CN-01"), true);
  updateProfile({ followUps: false });
  assert.equal(resolveFollowUps(null), false);
  assert.equal(resolveFollowUps("C-CN-01"), false);
  assert.equal(resolveFollowUps("C-CN-02"), false);
});

test("per-chat On re-enables exactly that chat when the global is off", () => {
  resetState();
  updateProfile({ followUps: false });
  setScopeOverride(FOLLOW_UPS_SETTING, scopeKey("chat", "C-CN-01"), true);
  assert.equal(resolveFollowUps("C-CN-01"), true);
  // Siblings and the default stay off.
  assert.equal(resolveFollowUps("C-CN-02"), false);
  assert.equal(resolveFollowUps(null), false);
});

test("per-chat Off suppresses exactly that chat when the global is on", () => {
  resetState();
  updateProfile({ followUps: true });
  setScopeOverride(FOLLOW_UPS_SETTING, scopeKey("chat", "C-CN-01"), false);
  assert.equal(resolveFollowUps("C-CN-01"), false);
  assert.equal(resolveFollowUps("C-CN-02"), true);
  assert.equal(resolveFollowUps(null), true);
});

test("Use default deletes the override entry (never stored as false)", () => {
  resetState();
  updateProfile({ followUps: true });
  const scope = scopeKey("chat", "C-CN-01");
  setScopeOverride(FOLLOW_UPS_SETTING, scope, false);
  assert.equal(resolveFollowUps("C-CN-01"), false);
  setScopeOverride(FOLLOW_UPS_SETTING, scope, undefined);
  assert.equal(getScopeOverride(FOLLOW_UPS_SETTING, scope), undefined);
  assert.equal(resolveFollowUps("C-CN-01"), true);
});

// ---------------------------------------------------------------------------
// Menu cycle: one item walks Off -> On -> Use default
// ---------------------------------------------------------------------------

test("menu cycle walks unset -> Off -> On -> Use default", () => {
  assert.equal(nextFollowUpsOverride(undefined), false);
  assert.equal(nextFollowUpsOverride(false), true);
  assert.equal(nextFollowUpsOverride(true), undefined);
});

// ---------------------------------------------------------------------------
// Global write-through (the contract the profile row wires into)
// ---------------------------------------------------------------------------

test("authed global-off PATCHes the server row once and stays silent", async () => {
  resetState();
  const apiLog: FetchLog[] = [];
  __setFetchForTesting(
    makeRouter([() => tokenOk("t-s1")], [() => apiJson({ ok: true })], apiLog),
  );
  const toasts: Toast[] = [];
  savePreference({ followUps: false }, (t) => toasts.push(t as Toast), {
    server: true,
  });
  // Instant local UI (write-through optimism).
  assert.equal(getProfile().followUps, false);
  await __flushSettingsDebounceForTesting();
  assert.equal(apiLog.length, 1);
  assert.ok(apiLog[0].url.endsWith("/profiles/me"));
  assert.equal(apiLog[0].method, "PATCH");
  assert.deepEqual(JSON.parse(apiLog[0].body), { followUps: false });
  assert.equal(toasts.length, 0);
});

test("global survives an identity transition (profile is not an override)", async () => {
  resetState();
  const apiLog: FetchLog[] = [];
  __setFetchForTesting(
    makeRouter([() => tokenOk("t-s1")], [() => apiJson({ ok: true })], apiLog),
  );
  const toasts: Toast[] = [];
  savePreference({ followUps: false }, (t) => toasts.push(t as Toast), {
    server: true,
  });
  await __flushSettingsDebounceForTesting();
  // Logout/login wipes the per-chat map but never the persisted global.
  resetChatStoreForIdentity();
  assert.equal(getProfile().followUps, false);
  assert.equal(resolveFollowUps("C-CN-01"), false);
});

test("failed PATCH rolls back memory and fires one error toast", async () => {
  resetState();
  const apiLog: FetchLog[] = [];
  __setFetchForTesting(
    makeRouter(
      [() => tokenOk("t-s1")],
      [() => apiJson({ code: "x", message: "boom" }, 500)],
      apiLog,
    ),
  );
  const toasts: Toast[] = [];
  savePreference({ followUps: false }, (t) => toasts.push(t as Toast), {
    server: true,
  });
  assert.equal(getProfile().followUps, false);
  await __flushSettingsDebounceForTesting();
  assert.equal(apiLog.length, 1);
  assert.equal(getProfile().followUps, true);
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].type, "error");
});

// ---------------------------------------------------------------------------
// Guest path: memory-only, zero fetches; transition clears overrides
// ---------------------------------------------------------------------------

test("guest global save is memory-only: zero fetches, instant local value", async () => {
  resetState();
  const apiLog: FetchLog[] = [];
  __setFetchForTesting(
    makeRouter([() => tokenOk("t-never")], [], apiLog),
  );
  const toasts: Toast[] = [];
  savePreference({ followUps: false }, (t) => toasts.push(t as Toast), {
    server: false,
  });
  assert.equal(getProfile().followUps, false);
  await __flushSettingsDebounceForTesting();
  assert.equal(apiLog.length, 0);
  assert.equal(toasts.length, 0);
});

test("guest per-chat override costs zero fetches and dies on transition", async () => {
  resetState();
  const apiLog: FetchLog[] = [];
  __setFetchForTesting(
    makeRouter([() => tokenOk("t-never")], [], apiLog),
  );
  updateProfile({ followUps: false });
  setScopeOverride(FOLLOW_UPS_SETTING, scopeKey("chat", "C-CN-01"), true);
  assert.equal(resolveFollowUps("C-CN-01"), true);
  await __flushSettingsDebounceForTesting();
  assert.equal(apiLog.length, 0);
  // Login wipes the guest's per-chat choice; the global still applies.
  resetChatStoreForIdentity();
  assert.equal(
    getScopeOverride(FOLLOW_UPS_SETTING, scopeKey("chat", "C-CN-01")),
    undefined,
  );
  assert.equal(resolveFollowUps("C-CN-01"), false);
});
