// Setting-locale stream tests (S4).
// Locks the spec's persist-now half plus application layer 1:
// - the locale triple (language/region/timezone) round-trips through the
//   existing validated PATCH contract via the Step-0 `savePreference` kernel,
//   so it survives logout/login for authed users;
// - guests stay memory-only (zero fetches);
// - the pure `Intl` timestamp helper renders a fixed instant differently
//   under IN/IST vs US/ET and fails closed to built-ins on unknown values
//   without ever throwing.
//
// Style mirrors settings-scope.test.ts: stubbed window/fetch,
// state-based assertions, DAMP self-contained cases. Explicit IANA-mapped
// zones only — never the machine zone.

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
  updateProfile,
} from "../src/lib/session.ts";
import {
  __flushSettingsDebounceForTesting,
  savePreference,
} from "../src/lib/settings-scope.ts";
import { formatTimestamp } from "../src/lib/format-timestamps.ts";
import {
  formatDayLabel,
  isSameCalendarDay,
  resolveDividerText,
} from "../src/lib/format-timestamps.ts";

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
    language: "en-US",
    region: "IN",
    timezone: "IST",
  });
}

type Toast = { body: string; type: string };

// ---------------------------------------------------------------------------
// Persist-now half: the triple roams with the account
// ---------------------------------------------------------------------------

test("locale triple survives logout/login via one PATCH round-trip", async () => {
  resetState();
  const apiLog: FetchLog[] = [];
  __setFetchForTesting(
    makeRouter(
      [() => tokenOk("t-locale")],
      [() => apiJson({ ok: true }), () => apiJson({ ok: true }), () => apiJson({ ok: true })],
      apiLog,
    ),
  );
  const toasts: Toast[] = [];
  // One control save carries the whole triple (single debounced PATCH shape
  // only when saved together; here each row saves its own key — assert each
  // row's PATCH carries its field).
  savePreference({ language: "hi" }, (t) => toasts.push(t as Toast), {
    server: true,
  });
  savePreference({ region: "US" }, (t) => toasts.push(t as Toast), {
    server: true,
  });
  savePreference({ timezone: "ET" }, (t) => toasts.push(t as Toast), {
    server: true,
  });
  // Instant local UI (write-through optimism).
  assert.equal(getProfile().language, "hi");
  assert.equal(getProfile().region, "US");
  assert.equal(getProfile().timezone, "ET");
  await __flushSettingsDebounceForTesting();
  assert.equal(apiLog.length, 3);
  for (const entry of apiLog) {
    assert.ok(entry.url.endsWith("/profiles/me"));
    assert.equal(entry.method, "PATCH");
  }
  assert.deepEqual(
    apiLog.map((e) => JSON.parse(e.body)),
    [{ language: "hi" }, { region: "US" }, { timezone: "ET" }],
  );
  assert.equal(toasts.length, 0);

  // Logout/login: a fresh device holds built-ins until the server row seeds
  // it — the PATCHed server values restore the exact triple.
  updateProfile({ language: "en-US", region: "IN", timezone: "IST" });
  const serverRow = { language: "hi", region: "US", timezone: "ET" };
  updateProfile(serverRow);
  assert.equal(getProfile().language, "hi");
  assert.equal(getProfile().region, "US");
  assert.equal(getProfile().timezone, "ET");
});

test("guest locale change is memory-only with zero fetches", async () => {
  resetState();
  const apiLog: FetchLog[] = [];
  __setFetchForTesting(
    makeRouter([() => tokenOk("t-never")], [], apiLog),
  );
  const toasts: Toast[] = [];
  savePreference({ language: "hi" }, (t) => toasts.push(t as Toast), {
    server: false,
  });
  savePreference({ region: "US" }, (t) => toasts.push(t as Toast), {
    server: false,
  });
  savePreference({ timezone: "ET" }, (t) => toasts.push(t as Toast), {
    server: false,
  });
  assert.equal(getProfile().language, "hi");
  assert.equal(getProfile().region, "US");
  assert.equal(getProfile().timezone, "ET");
  await __flushSettingsDebounceForTesting();
  assert.equal(apiLog.length, 0);
  assert.equal(toasts.length, 0);
});

// ---------------------------------------------------------------------------
// Application layer 1: pure timestamp helper
// ---------------------------------------------------------------------------

const FIXED_INSTANT = "2026-01-15T12:00:00.000Z";

test("fixed timestamp renders differently under IN/IST vs US/ET", () => {
  const inIst = formatTimestamp(FIXED_INSTANT, {
    region: "IN",
    timeZone: "IST",
  });
  const usEt = formatTimestamp(FIXED_INSTANT, {
    region: "US",
    timeZone: "ET",
  });
  assert.ok(inIst.length > 0);
  assert.ok(usEt.length > 0);
  assert.notEqual(inIst, usEt);
});

test("unknown region and time zone fall back to built-ins without throwing", () => {
  const builtin = formatTimestamp(FIXED_INSTANT, {
    region: "IN",
    timeZone: "IST",
  });
  assert.equal(
    formatTimestamp(FIXED_INSTANT, { region: "XX", timeZone: "XX" }),
    builtin,
  );
  assert.equal(
    formatTimestamp(FIXED_INSTANT, { region: "XX", timeZone: "IST" }),
    builtin,
  );
  assert.equal(
    formatTimestamp(FIXED_INSTANT, { region: "IN", timeZone: "XX" }),
    builtin,
  );
});

test("helper never throws: garbage input returns the input", () => {
  assert.doesNotThrow(() =>
    formatTimestamp("not-a-timestamp", { region: "XX", timeZone: "XX" }),
  );
  assert.equal(
    formatTimestamp("not-a-timestamp", { region: "XX", timeZone: "XX" }),
    "not-a-timestamp",
  );
});

// ---------------------------------------------------------------------------
// Day divider: stored "Today" must age on revisit (explicit now, IST)
// ---------------------------------------------------------------------------

const DIV_NOW = "2026-09-13T12:00:00.000Z"; // a Sunday, 17:30 IST
const IN_IST = { region: "IN", timeZone: "IST" } as const;

test("divider day word ages: today / yesterday / weekday / date", () => {
  assert.equal(
    formatDayLabel("2026-09-13T06:00:00.000Z", { ...IN_IST, now: DIV_NOW }),
    "Today",
  );
  assert.equal(
    formatDayLabel("2026-09-12T12:00:00.000Z", { ...IN_IST, now: DIV_NOW }),
    "Yesterday",
  );
  // 3 days back: Thursday in Asia/Kolkata.
  assert.equal(
    formatDayLabel("2026-09-10T12:00:00.000Z", { ...IN_IST, now: DIV_NOW }),
    "Thursday",
  );
  // 10 days back: medium date, never a frozen relative word.
  const old = formatDayLabel("2026-09-03T12:00:00.000Z", {
    ...IN_IST,
    now: DIV_NOW,
  });
  assert.equal(
    old,
    new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeZone: "Asia/Kolkata",
    }).format(new Date("2026-09-03T12:00:00.000Z")),
  );
});

test("divider label follows the selected time zone, not the machine zone", () => {
  // 00:30Z Sep 13 is still Sep 12 in Los Angeles, Sep 13 in Kolkata.
  assert.equal(
    formatDayLabel("2026-09-13T00:30:00.000Z", {
      region: "US",
      timeZone: "PT",
      now: DIV_NOW,
    }),
    "Yesterday",
  );
  assert.equal(
    formatDayLabel("2026-09-13T00:30:00.000Z", { ...IN_IST, now: DIV_NOW }),
    "Today",
  );
});

test("resolveDividerText recomputes the prefix, keeps subject, demo passthrough", () => {
  assert.equal(
    resolveDividerText("Today · Computer Networks", "2026-09-10T12:00:00.000Z", {
      ...IN_IST,
      now: DIV_NOW,
    }),
    "Thursday · Computer Networks",
  );
  // No anchor (static demo shells, empty drafts before creation lookup):
  // stored text verbatim.
  assert.equal(
    resolveDividerText("Last week · Computer Networks", undefined, {
      ...IN_IST,
      now: DIV_NOW,
    }),
    "Last week · Computer Networks",
  );
  // Garbage anchor: keep the stored prefix, never blank.
  assert.equal(
    resolveDividerText("Today · Computer Networks", "not-a-timestamp", {
      ...IN_IST,
      now: DIV_NOW,
    }),
    "Today · Computer Networks",
  );
});

test("isSameCalendarDay is zone-aware and fails safe on garbage", () => {
  // 18:30Z Sep 12 = 00:00 Sep 13 IST: same IST day as Sep 13 noon.
  assert.equal(
    isSameCalendarDay(
      "2026-09-12T18:30:00.000Z",
      "2026-09-13T12:00:00.000Z",
      IN_IST,
    ),
    true,
  );
  assert.equal(
    isSameCalendarDay(
      "2026-09-12T12:00:00.000Z",
      "2026-09-13T12:00:00.000Z",
      IN_IST,
    ),
    false,
  );
  assert.equal(isSameCalendarDay("garbage", DIV_NOW, IN_IST), false);
});
