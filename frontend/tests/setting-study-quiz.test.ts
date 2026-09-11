// Settings S2 (study context + quiz config) tests.
//
// Study globals (examMonth, weeklyGoal, difficulty) persist server-side via
// the Step-0 `savePreference` write-through (PATCH round-trip in stubbed
// tests). Quiz + per-subject exam configuration resolves through the frozen
// kernel override map: per-chat > per-subject > global > built-in, pure and
// fetch-free. Guests are memory-only; every identity transition clears.
//
// Style mirrors settings-scope.test.ts: stubbed window/fetch, state-based
// assertions, DAMP self-contained cases.

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
  scopeKey,
  setScopeOverride,
  updateProfile,
} from "../src/lib/session.ts";
import {
  __flushSettingsDebounceForTesting,
  savePreference,
} from "../src/lib/settings-scope.ts";
import {
  BUILTIN_QUIZ_CONFIG,
  resolveQuizConfig,
} from "../src/lib/setting-quiz.ts";
import { resolveExamMonth, resolveWeeklyGoal } from "../src/lib/setting-study.ts";

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
  snapshotStorage.clear();
  updateProfile({
    examMonth: "",
    weeklyGoal: "5 days",
    difficulty: "medium",
    proactiveQuiz: true,
  });
}

type Toast = { body: string; type: string };

// ---------------------------------------------------------------------------
// Study globals persist (PATCH round-trip, stubbed)
// ---------------------------------------------------------------------------

test("study global examMonth PATCHes the server row and stays silent on success", async () => {
  resetState();
  const apiLog: FetchLog[] = [];
  __setFetchForTesting(
    makeRouter([() => tokenOk("t-s2")], [() => apiJson({ ok: true })], apiLog),
  );
  const toasts: Toast[] = [];
  savePreference(
    { examMonth: "December 2026" },
    (t) => toasts.push(t as Toast),
    { server: true },
  );
  // Instant local UI (write-through optimism).
  assert.equal(getProfile().examMonth, "December 2026");
  await __flushSettingsDebounceForTesting();
  assert.equal(apiLog.length, 1);
  assert.ok(apiLog[0].url.endsWith("/profiles/me"));
  assert.equal(apiLog[0].method, "PATCH");
  assert.deepEqual(JSON.parse(apiLog[0].body), { examMonth: "December 2026" });
  assert.equal(toasts.length, 0);
  // The persisted value is what a fresh login seeds from: still there.
  assert.equal(getProfile().examMonth, "December 2026");
});

test("study global weeklyGoal PATCHes the server row and stays silent on success", async () => {
  resetState();
  const apiLog: FetchLog[] = [];
  __setFetchForTesting(
    makeRouter([() => tokenOk("t-s2")], [() => apiJson({ ok: true })], apiLog),
  );
  const toasts: Toast[] = [];
  savePreference({ weeklyGoal: "7 days" }, (t) => toasts.push(t as Toast), {
    server: true,
  });
  assert.equal(getProfile().weeklyGoal, "7 days");
  await __flushSettingsDebounceForTesting();
  assert.equal(apiLog.length, 1);
  assert.deepEqual(JSON.parse(apiLog[0].body), { weeklyGoal: "7 days" });
  assert.equal(toasts.length, 0);
  assert.equal(getProfile().weeklyGoal, "7 days");
});

test("study global difficulty PATCHes the server row and stays silent on success", async () => {
  resetState();
  const apiLog: FetchLog[] = [];
  __setFetchForTesting(
    makeRouter([() => tokenOk("t-s2")], [() => apiJson({ ok: true })], apiLog),
  );
  const toasts: Toast[] = [];
  savePreference({ difficulty: "hard" }, (t) => toasts.push(t as Toast), {
    server: true,
  });
  assert.equal(getProfile().difficulty, "hard");
  await __flushSettingsDebounceForTesting();
  assert.equal(apiLog.length, 1);
  assert.deepEqual(JSON.parse(apiLog[0].body), { difficulty: "hard" });
  assert.equal(toasts.length, 0);
  assert.equal(getProfile().difficulty, "hard");
});

// ---------------------------------------------------------------------------
// Quiz resolve-table: per-chat > per-subject > global > built-in
// ---------------------------------------------------------------------------

test("quiz resolves built-ins when nothing is set anywhere", () => {
  resetState();
  assert.deepEqual(resolveQuizConfig({}), BUILTIN_QUIZ_CONFIG);
  assert.deepEqual(resolveQuizConfig({ subject: "CN", chatCode: "C-CN-01" }), {
    ...BUILTIN_QUIZ_CONFIG,
    // Globals ARE set (medium/true are the seeded profile values).
    difficulty: "medium",
    proactive: true,
  });
});

test("quiz global difficulty and proactive come from the profile row", () => {
  resetState();
  updateProfile({ difficulty: "hard", proactiveQuiz: false });
  const resolved = resolveQuizConfig({});
  assert.equal(resolved.difficulty, "hard");
  assert.equal(resolved.proactive, false);
  // Untouched axes stay built-in.
  assert.equal(resolved.format, "single");
  assert.equal(resolved.optionCount, 4);
  assert.equal(resolved.questionCount, 5);
});

test("quiz per-subject override beats the global", () => {
  resetState();
  updateProfile({ difficulty: "medium" });
  setScopeOverride("difficulty", scopeKey("subject", "CN"), "hard");
  assert.equal(resolveQuizConfig({ subject: "CN" }).difficulty, "hard");
  // A sibling subject still reads the global.
  assert.equal(resolveQuizConfig({ subject: "Math" }).difficulty, "medium");
});

test("quiz per-chat override beats per-subject and global", () => {
  resetState();
  updateProfile({ difficulty: "easy" });
  setScopeOverride("difficulty", scopeKey("subject", "CN"), "medium");
  setScopeOverride("difficulty", scopeKey("chat", "C-CN-01"), "hard");
  assert.equal(
    resolveQuizConfig({ subject: "CN", chatCode: "C-CN-01" }).difficulty,
    "hard",
  );
  // Same subject, another chat: subject tier wins.
  assert.equal(
    resolveQuizConfig({ subject: "CN", chatCode: "C-CN-02" }).difficulty,
    "medium",
  );
  // Another subject, same chat: the chat override is scoped to its own
  // tier lookup, so the other subject reads its own chain (global here).
  assert.equal(
    resolveQuizConfig({ subject: "Math", chatCode: "C-CN-01" }).difficulty,
    "hard",
  );
});

test("quiz difficulty resolve-table: every tier combination returns the nearest set value", () => {
  for (const global of ["easy", "hard"] as const) {
    for (const subject of [undefined, "medium"] as const) {
      for (const chat of [undefined, "easy"] as const) {
        resetState();
        updateProfile({ difficulty: global });
        if (subject !== undefined)
          setScopeOverride("difficulty", scopeKey("subject", "CN"), subject);
        if (chat !== undefined)
          setScopeOverride("difficulty", scopeKey("chat", "C-CN-01"), chat);
        const expected = chat ?? subject ?? global;
        assert.equal(
          resolveQuizConfig({ subject: "CN", chatCode: "C-CN-01" }).difficulty,
          expected,
          `global=${global} subject=${subject} chat=${chat}`,
        );
      }
    }
  }
});

test("quiz format resolve-table: chat x subject combinations return the nearest set value", () => {
  const cases: Array<{
    subject: "single" | undefined;
    chat: "multi" | undefined;
    expected: "single" | "multi";
  }> = [
    { subject: undefined, chat: undefined, expected: "single" },
    { subject: "single", chat: undefined, expected: "single" },
    { subject: undefined, chat: "multi", expected: "multi" },
    { subject: "single", chat: "multi", expected: "multi" },
  ];
  for (const { subject, chat, expected } of cases) {
    resetState();
    if (subject !== undefined)
      setScopeOverride("format", scopeKey("subject", "CN"), subject);
    if (chat !== undefined)
      setScopeOverride("format", scopeKey("chat", "C-CN-01"), chat);
    assert.equal(
      resolveQuizConfig({ subject: "CN", chatCode: "C-CN-01" }).format,
      expected,
      `subject=${subject} chat=${chat}`,
    );
  }
});

test("quiz fields resolve independently: chat sets format only", () => {
  resetState();
  updateProfile({ difficulty: "hard" });
  setScopeOverride("format", scopeKey("chat", "C-CN-01"), "multi");
  setScopeOverride("optionCount", scopeKey("chat", "C-CN-01"), 6);
  const resolved = resolveQuizConfig({ subject: "CN", chatCode: "C-CN-01" });
  assert.equal(resolved.format, "multi");
  assert.equal(resolved.optionCount, 6);
  // Untouched fields inherit down their own chains.
  assert.equal(resolved.difficulty, "hard");
  assert.equal(resolved.questionCount, 5);
  assert.equal(resolved.proactive, true);
});

test("quiz deleting an override restores inheritance", () => {
  resetState();
  const chatScope = scopeKey("chat", "C-CN-01");
  setScopeOverride("format", chatScope, "multi");
  assert.equal(resolveQuizConfig({ chatCode: "C-CN-01" }).format, "multi");
  setScopeOverride("format", chatScope, undefined);
  assert.equal(resolveQuizConfig({ chatCode: "C-CN-01" }).format, "single");
});

test("quiz ignores invalid override values and inherits", () => {
  resetState();
  updateProfile({ difficulty: "medium" });
  setScopeOverride("optionCount", scopeKey("chat", "C-CN-01"), 7);
  setScopeOverride("format", scopeKey("subject", "CN"), "triple");
  setScopeOverride("questionCount", scopeKey("subject", "CN"), 4);
  setScopeOverride("difficulty", scopeKey("chat", "C-CN-01"), "extreme");
  const resolved = resolveQuizConfig({ subject: "CN", chatCode: "C-CN-01" });
  assert.equal(resolved.optionCount, 4);
  assert.equal(resolved.format, "single");
  assert.equal(resolved.questionCount, 5);
  assert.equal(resolved.difficulty, "medium");
});

// ---------------------------------------------------------------------------
// Study resolvers: per-subject exam date, global-only weekly goal
// ---------------------------------------------------------------------------

test("study per-subject exam date resolves only for that subject", () => {
  resetState();
  updateProfile({ examMonth: "December 2026" });
  setScopeOverride("examMonth", scopeKey("subject", "CN"), "January 2027");
  assert.equal(resolveExamMonth("CN"), "January 2027");
  assert.equal(resolveExamMonth("Math"), "December 2026");
  assert.equal(resolveExamMonth(), "December 2026");
});

test("study resetting the subject exam date restores inheritance", () => {
  resetState();
  updateProfile({ examMonth: "December 2026" });
  const cn = scopeKey("subject", "CN");
  setScopeOverride("examMonth", cn, "January 2027");
  assert.equal(resolveExamMonth("CN"), "January 2027");
  setScopeOverride("examMonth", cn, undefined);
  assert.equal(resolveExamMonth("CN"), "December 2026");
});

test("study weeklyGoal is global-only: scoped overrides never apply", () => {
  resetState();
  updateProfile({ weeklyGoal: "5 days" });
  // Even if a stray override exists under the frozen name, the resolver
  // has no override tiers by design — the person-level value always wins.
  setScopeOverride("weeklyGoal", scopeKey("subject", "CN"), "7 days");
  setScopeOverride("weeklyGoal", scopeKey("chat", "C-CN-01"), "3 days");
  assert.equal(resolveWeeklyGoal(), "5 days");
});

// ---------------------------------------------------------------------------
// Identity transition + guest behavior
// ---------------------------------------------------------------------------

test("study+quiz identity transition clears every override", () => {
  resetState();
  updateProfile({ examMonth: "December 2026", difficulty: "medium" });
  setScopeOverride("examMonth", scopeKey("subject", "CN"), "January 2027");
  setScopeOverride("format", scopeKey("subject", "CN"), "multi");
  setScopeOverride("optionCount", scopeKey("chat", "C-CN-01"), 6);
  setScopeOverride("difficulty", scopeKey("chat", "C-CN-01"), "hard");
  resetChatStoreForIdentity();
  assert.equal(resolveExamMonth("CN"), "December 2026");
  assert.deepEqual(resolveQuizConfig({ subject: "CN", chatCode: "C-CN-01" }), {
    format: "single",
    optionCount: 4,
    difficulty: "medium",
    questionCount: 5,
    proactive: true,
  });
});

test("study guest save is memory-only: zero fetches, instant local value", async () => {
  resetState();
  const apiLog: FetchLog[] = [];
  // Empty queues: ANY fetch (token or API) throws — a strong zero-fetch
  // assertion, not just a log-length check.
  __setFetchForTesting(makeRouter([], [], apiLog));
  const toasts: Toast[] = [];
  const notify = (t: { body: string; type: "error" }) => toasts.push(t as Toast);
  savePreference({ examMonth: "December 2026" }, notify, { server: false });
  savePreference({ weeklyGoal: "7 days" }, notify, { server: false });
  savePreference({ difficulty: "hard" }, notify, { server: false });
  assert.equal(getProfile().examMonth, "December 2026");
  assert.equal(getProfile().weeklyGoal, "7 days");
  assert.equal(getProfile().difficulty, "hard");
  await __flushSettingsDebounceForTesting();
  assert.equal(apiLog.length, 0);
  assert.equal(toasts.length, 0);
});

test("quiz override writes and resolves cost zero fetches", () => {
  resetState();
  const apiLog: FetchLog[] = [];
  __setFetchForTesting(makeRouter([], [], apiLog));
  // Memory-only writes: no fetch queue is even consulted.
  setScopeOverride("format", scopeKey("chat", "C-CN-01"), "multi");
  setScopeOverride("optionCount", scopeKey("subject", "CN"), 6);
  setScopeOverride("examMonth", scopeKey("subject", "CN"), "January 2027");
  const resolved = resolveQuizConfig({ subject: "CN", chatCode: "C-CN-01" });
  assert.equal(resolved.format, "multi");
  assert.equal(resolved.optionCount, 6);
  assert.equal(resolveExamMonth("CN"), "January 2027");
  assert.equal(apiLog.length, 0);
});
