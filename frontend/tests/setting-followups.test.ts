// Settings S1 — follow-up suggestions.
// Pill visibility is the profile global alone (My Profile → Assistant →
// Follow-up suggestions); the thread's "..." menu carries no per-chat
// override. Covered here: the global write-through contract this stream
// wires into the UI, plus the pure pill anchor (`latestFollowUps`).
// Guests cost zero fetches.
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
  resetChatStoreForIdentity,
  updateProfile,
} from "../src/lib/session.ts";
import {
  __flushSettingsDebounceForTesting,
  savePreference,
} from "../src/lib/settings-scope.ts";
import { latestFollowUps } from "../src/lib/setting-followups.ts";

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
// Global default: the profile switch is the single control
// ---------------------------------------------------------------------------

test("profile switch is the pill gate's source of truth", () => {
  resetState();
  assert.equal(getProfile().followUps, true);
  updateProfile({ followUps: false });
  assert.equal(getProfile().followUps, false);
});

// ---------------------------------------------------------------------------
// Pill anchor: pills show only after the response is done
// ---------------------------------------------------------------------------

test("latest assistant turn's pills show while nothing follows them", () => {
  assert.deepEqual(
    latestFollowUps([
      { from: "system" },
      { from: "user" },
      { from: "assistant", followUps: ["Go deeper", "Quiz me"] },
    ]),
    ["Go deeper", "Quiz me"],
  );
});

test("a sent prompt suppresses stale pills until its response lands", () => {
  const before = [
    { from: "system" },
    { from: "user" },
    { from: "assistant", followUps: ["Go deeper"] },
  ] as const;
  // Prompt sent, response pending: user block is newest.
  assert.equal(
    latestFollowUps([...before, { from: "user" }]),
    null,
  );
  // A day-break divider inserted ahead of the prompt changes nothing.
  assert.equal(
    latestFollowUps([...before, { from: "system" }, { from: "user" }]),
    null,
  );
  // Response done: the new assistant turn's pills show.
  assert.deepEqual(
    latestFollowUps([
      ...before,
      { from: "user" },
      { from: "assistant", followUps: ["Worked example"] },
    ]),
    ["Worked example"],
  );
});

test("assistant rows without suggestions never anchor (error rows skip)", () => {
  assert.deepEqual(
    latestFollowUps([
      { from: "user" },
      { from: "assistant", followUps: ["Go deeper"] },
      { from: "assistant" },
    ]),
    ["Go deeper"],
  );
  assert.equal(latestFollowUps([]), null);
  assert.equal(
    latestFollowUps([{ from: "system" }, { from: "user" }]),
    null,
  );
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
  // Logout/login never clears the persisted global.
  resetChatStoreForIdentity();
  assert.equal(getProfile().followUps, false);
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
// Guest path: memory-only, zero fetches
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
