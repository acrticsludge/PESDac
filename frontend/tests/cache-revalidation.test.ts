// Foreground-gated revalidation regression tests (caching Phase 4).
// (a) coalesce math: two foregrounds <60 s apart → exactly one refetch;
//     guest/logged-out foreground → zero fetches.
// (b) logout ping: a single localStorage key written ONLY on logout
//     transitions; receivers run the Phase-1 reset with no navigation.
// (c) refetch entry reuses the hydrate/load paths (no duplicate fetch
//     logic): a server-side delete surfaces without reload.
// (d) pageshow persisted=true with a dead session → loading, no
//     logged-out rows painted; live session → re-proven then rows.
// Style mirrors cache-rollback-paging / auth-session-flow tests. No real
// network: fetch is routed from queues. Hook listener wiring (React
// effects) is verified via the browser matrix, not here — node has no
// component runtime.

import test from "node:test";
import assert from "node:assert/strict";

import {
  __resetAuthCachesForTesting,
  __setApiRootForTesting,
  __setAuthBaseForTesting,
  __setFetchForTesting,
  apiLogout,
  AUTH_REQUIRED_EVENT,
} from "../src/lib/auth.ts";
import {
  __resetChatBackingForTesting,
  chatReady,
  getChatHydratedKey,
  listCustomChats,
  readDraft,
  resetChatStoreForIdentity,
  revalidateForeground,
  writeDraft,
  type ChatAuth,
  type CustomChat,
} from "../src/lib/session.ts";
import {
  broadcastLogoutPing,
  FOREGROUND_REFETCH_FLOOR_MS,
  handleForegroundTick,
  installLogoutPingReceiver,
  isLogoutPingEvent,
  LOGOUT_PING_KEY,
  shouldForegroundRefetch,
  shouldReproveOnPageshow,
} from "../src/lib/cache-revalidation.ts";

__setAuthBaseForTesting("https://auth.test");
__setApiRootForTesting("https://api.test");

// Memory store reads no-op without a window (SSR guard in session.ts) —
// keep a minimal one mounted file-wide; per-test fakes layer localStorage
// and listener capture on top and restore this on uninstall.
if (typeof (globalThis as Record<string, unknown>).window === "undefined") {
  (globalThis as Record<string, unknown>).window = {
    dispatchEvent() {},
    addEventListener() {},
    removeEventListener() {},
  };
}

const AUTH: ChatAuth = { userId: "u-ph4-1", identityKey: "u-ph4-1:9" };

// ---- Fakes ---------------------------------------------------------------

type StorageListener = (ev: { key: string | null }) => void;

function installFakeWindow(): {
  events: string[];
  storageListeners: StorageListener[];
  store: Map<string, string>;
  writes: string[];
  uninstall: () => void;
} {
  const previous = (globalThis as Record<string, unknown>).window;
  const events: string[] = [];
  const storageListeners: StorageListener[] = [];
  const store = new Map<string, string>();
  const writes: string[] = [];
  const listeners = new Map<string, Set<(ev: { type: string }) => void>>();
  (globalThis as Record<string, unknown>).window = {
    __pesdacAuthDispatched: false,
    addEventListener: (type: string, fn: (ev: { type: string }) => void) => {
      if (type === "storage") {
        storageListeners.push(fn as unknown as StorageListener);
        return;
      }
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(fn);
    },
    removeEventListener: (type: string, fn: (ev: { type: string }) => void) => {
      if (type === "storage") {
        const i = storageListeners.indexOf(fn as unknown as StorageListener);
        if (i >= 0) storageListeners.splice(i, 1);
        return;
      }
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent: (ev: { type: string }) => {
      events.push(ev.type);
      listeners.get(ev.type)?.forEach((fn) => fn(ev));
      return true;
    },
    localStorage: {
      getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
      setItem: (k: string, v: string) => {
        store.set(k, v);
        writes.push(k);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    },
  };
  return {
    events,
    storageListeners,
    store,
    writes,
    uninstall: () => {
      (globalThis as Record<string, unknown>).window = previous;
    },
  };
}

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

function apiNoContent(): Response {
  return new Response(null, { status: 204 });
}

function serverChat(code: string, overrides: Partial<CustomChat> = {}) {
  return {
    code,
    subject: "CN",
    title: `Chat ${code}`,
    isPinned: false,
    isArchived: false,
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
    ...overrides,
  };
}

function chatEnvelope(data: unknown[], total: number) {
  return { data, pagination: { limit: 50, offset: 0, total } };
}

type ApiCall = { method: string; url: string };

/** Router: token mint always ok; chat list reads serve `rows`; archived reads empty. */
function listRouter(apiLog: ApiCall[], rows: Array<ReturnType<typeof serverChat>>) {
  return (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/auth/token")) return tokenOk("t-ph4");
    apiLog.push({ method: init?.method ?? "GET", url });
    if (url.includes("archived=true")) return apiJson(chatEnvelope([], 0));
    if (url.includes("/chats")) return apiJson(chatEnvelope(rows, rows.length));
    return apiJson({});
  }) as typeof fetch;
}

function setup() {
  __resetAuthCachesForTesting();
  __resetChatBackingForTesting();
}

// ---- (a) coalesce ----------------------------------------------------------

test("coalesce floor is 60 s: rapid re-foregrounds do not refetch", () => {
  assert.equal(FOREGROUND_REFETCH_FLOOR_MS, 60_000);
  assert.equal(shouldForegroundRefetch(0, 0), false);
  assert.equal(shouldForegroundRefetch(0, 59_999), false);
  assert.equal(shouldForegroundRefetch(0, 60_000), true);
  assert.equal(shouldForegroundRefetch(1_000, 61_000), true);
  assert.equal(shouldForegroundRefetch(1_000, 60_999), false);
});

test("foreground tick: guest never refetches, authed refetches only when due", () => {
  const guest = handleForegroundTick({
    auth: null,
    nowMs: 120_000,
    lastRefetchAtMs: 0,
  });
  assert.deepEqual(guest, { refetch: false, lastRefetchAtMs: 0 });

  const due = handleForegroundTick({
    auth: AUTH,
    nowMs: 120_000,
    lastRefetchAtMs: 0,
  });
  assert.deepEqual(due, { refetch: true, lastRefetchAtMs: 120_000 });

  const storm = handleForegroundTick({
    auth: AUTH,
    nowMs: 120_000 + 30_000,
    lastRefetchAtMs: due.lastRefetchAtMs,
  });
  assert.deepEqual(storm, { refetch: false, lastRefetchAtMs: 120_000 });
});

test("two foregrounds <60 s apart → exactly one refetch; guest → zero fetches", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    listRouter(apiLog, [serverChat("c-ph4-a"), serverChat("c-ph4-b")]),
  );
  try {
    let lastRefetchAtMs = 0;
    const foreground = async (nowMs: number) => {
      const tick = handleForegroundTick({
        auth: AUTH,
        nowMs,
        lastRefetchAtMs,
      });
      lastRefetchAtMs = tick.lastRefetchAtMs;
      if (tick.refetch) {
        const result = await revalidateForeground(AUTH);
        assert.deepEqual(result, { status: "ready" });
      }
      return tick.refetch;
    };
    assert.equal(await foreground(120_000), true);
    const listCallsAfterFirst = apiLog.filter((c) => c.url.includes("/chats")).length;
    assert.ok(listCallsAfterFirst > 0, "first foreground refetches");
    assert.equal(await foreground(120_000 + 30_000), false);
    assert.equal(
      apiLog.filter((c) => c.url.includes("/chats")).length,
      listCallsAfterFirst,
      "second foreground inside the floor issues zero fetches",
    );

    const guestCallsBefore = apiLog.length;
    assert.deepEqual(await revalidateForeground(null), { status: "skipped" });
    assert.equal(apiLog.length, guestCallsBefore, "guest foreground performs zero fetches");
  } finally {
    restore();
  }
});

// ---- (b) logout ping --------------------------------------------------------

test("logout ping key matches only itself", () => {
  assert.equal(isLogoutPingEvent(LOGOUT_PING_KEY), true);
  assert.equal(isLogoutPingEvent("pesdac:other"), false);
  assert.equal(isLogoutPingEvent(null), false);
});

test("apiLogout writes exactly one ping key; unrelated transitions write none", async () => {
  const { writes, uninstall } = installFakeWindow();
  try {
    setup();
    const restore = __setFetchForTesting(
      (async (input: unknown) => {
        const url = String(input);
        if (url.includes("/api/auth/token")) return tokenOk("t-ph4-logout");
        if (url.includes("/api/v1/auth/logout")) return apiNoContent();
        return apiJson({});
      }) as typeof fetch,
    );
    try {
      const outcome = await apiLogout();
      assert.deepEqual(outcome, { kind: "ok" });
    } finally {
      restore();
    }
    assert.deepEqual(
      writes.filter((k) => k === LOGOUT_PING_KEY).length,
      1,
      "logout writes the ping exactly once",
    );
  } finally {
    uninstall();
  }

  // A bare broadcast outside logout is the only other writer — the ping is
  // never written by hydrate/refetch paths (proven by the zero extra writes
  // above: broadcast ran once, inside apiLogout).
  const { writes: writes2, uninstall: uninstall2 } = installFakeWindow();
  try {
    setup();
    const apiLog: ApiCall[] = [];
    const restore = __setFetchForTesting(
      listRouter(apiLog, [serverChat("c-ph4-a")]),
    );
    try {
      assert.deepEqual(await revalidateForeground(AUTH), { status: "ready" });
    } finally {
      restore();
    }
    assert.equal(
      writes2.includes(LOGOUT_PING_KEY),
      false,
      "foreground refetch never writes the logout ping",
    );
  } finally {
    uninstall2();
  }
});

test("sibling-tab ping runs the Phase-1 reset with no navigation", async () => {
  const { events, storageListeners, uninstall } = installFakeWindow();
  try {
    setup();
    const apiLog: ApiCall[] = [];
    const restore = __setFetchForTesting(
      listRouter(apiLog, [serverChat("c-ph4-a")]),
    );
    try {
      assert.deepEqual(await revalidateForeground(AUTH), { status: "ready" });
    } finally {
      restore();
    }
    assert.equal(listCustomChats().length, 1, "sibling tab holds rows before the ping");

    let resets = 0;
    const cleanup = installLogoutPingReceiver(() => {
      resets += 1;
      resetChatStoreForIdentity();
    });
    assert.equal(storageListeners.length, 1, "receiver subscribes exactly once");
    // Noise on other keys is ignored.
    for (const fn of [...storageListeners]) fn({ key: "pesdac:other" });
    assert.equal(resets, 0, "unrelated storage keys never reset");
    // The logout ping drops the sibling cache immediately.
    for (const fn of [...storageListeners]) fn({ key: LOGOUT_PING_KEY });
    assert.equal(resets, 1, "ping triggers exactly one reset");
    assert.equal(listCustomChats().length, 0, "sibling rows dropped");
    assert.equal(getChatHydratedKey(), null, "hydrate marker dropped");
    assert.ok(!events.includes(AUTH_REQUIRED_EVENT), "ping never navigates");
    assert.ok(!events.includes("pesdac:auth-required"), "ping never routes to re-login");
    cleanup();
    assert.equal(storageListeners.length, 0, "receiver cleans up on unmount");
  } finally {
    uninstall();
  }
});

test("broadcastLogoutPing is a single-key write (no navigation surface)", () => {
  const { store, writes, uninstall } = installFakeWindow();
  try {
    broadcastLogoutPing();
    assert.equal(writes.length, 1, "exactly one key written");
    assert.equal(writes[0], LOGOUT_PING_KEY);
    assert.match(store.get(LOGOUT_PING_KEY) as string, /^\d+$/, "payload is a timestamp");
  } finally {
    uninstall();
  }
});

// ---- (c) refetch entry reuses hydrate/load paths ----------------------------

test("server-side delete surfaces on foreground refetch without reload", async () => {
  setup();
  const live = [serverChat("c-ph4-a"), serverChat("c-ph4-b")];
  const apiLog: ApiCall[] = [];
  let restore = __setFetchForTesting(listRouter(apiLog, live));
  try {
    assert.deepEqual(await revalidateForeground(AUTH), { status: "ready" });
  } finally {
    restore();
  }
  assert.deepEqual(
    listCustomChats().map((c) => c.code).sort(),
    ["c-ph4-a", "c-ph4-b"],
  );

  // Deleted on another device: the next foreground refetch drops it.
  live.splice(0, 1);
  restore = __setFetchForTesting(listRouter(apiLog, live));
  try {
    assert.deepEqual(await revalidateForeground(AUTH), { status: "ready" });
  } finally {
    restore();
  }
  assert.deepEqual(
    listCustomChats().map((c) => c.code),
    ["c-ph4-b"],
    "deleted chat gone without reload",
  );
});

// ---- (d) pageshow re-proof, fail closed ---------------------------------------

test("pageshow reproof gating: only persisted restores with an identity reprove", () => {
  assert.equal(shouldReproveOnPageshow(false, AUTH), false, "initial load never reproves");
  assert.equal(shouldReproveOnPageshow(true, null), false, "guests never reprove");
  assert.equal(shouldReproveOnPageshow(true, AUTH), true, "bfcache restore reproves");
});

test("simulated pageshow persisted=true with dead session → loading, no rows painted", async () => {
  const { events, uninstall } = installFakeWindow();
  try {
    setup();
    const apiLog: ApiCall[] = [];
    let restore = __setFetchForTesting(
      listRouter(apiLog, [serverChat("c-ph4-a")]),
    );
    try {
      assert.deepEqual(await revalidateForeground(AUTH), { status: "ready" });
    } finally {
      restore();
    }
    assert.equal(listCustomChats().length, 1);

    // Hook step 1 on pageshow(persisted=true): invalidate BEFORE reproof —
    // rows can never paint from the restored heap past this point.
    assert.equal(shouldReproveOnPageshow(true, AUTH), true);
    resetChatStoreForIdentity();
    assert.equal(getChatHydratedKey(), null);
    assert.equal(listCustomChats().length, 0);
    assert.equal(
      chatReady(AUTH, getChatHydratedKey()),
      false,
      "gate is loading while the session reproves",
    );

    // Hook step 2: reproof against a dead session (401). The global
    // re-login flow owns recovery; the store stays empty and loading.
    restore = __setFetchForTesting(
      (async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/auth/token")) return tokenOk("t-ph4-dead");
        apiLog.push({ method: init?.method ?? "GET", url });
        return new Response(
          JSON.stringify({ error: { code: "unauthorized", message: "no" } }),
          { status: 401, headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch,
    );
    try {
      const result = await revalidateForeground(AUTH);
      assert.deepEqual(result, { status: "kept-memory" });
    } finally {
      restore();
    }
    assert.equal(listCustomChats().length, 0, "no logged-out rows painted");
    assert.equal(getChatHydratedKey(), null, "gate stays loading on ambiguity");
    assert.equal(chatReady(AUTH, getChatHydratedKey()), false);
    assert.ok(
      events.includes(AUTH_REQUIRED_EVENT),
      "dead session routes through the existing global re-login flow",
    );
  } finally {
    uninstall();
  }
});

test("simulated pageshow persisted=true with live session → re-proven then rows", async () => {
  const { uninstall } = installFakeWindow();
  try {
    setup();
    const apiLog: ApiCall[] = [];
    let restore = __setFetchForTesting(
      listRouter(apiLog, [serverChat("c-ph4-a")]),
    );
    try {
      assert.deepEqual(await revalidateForeground(AUTH), { status: "ready" });
    } finally {
      restore();
    }
    resetChatStoreForIdentity();
    assert.equal(chatReady(AUTH, getChatHydratedKey()), false);

    restore = __setFetchForTesting(
      listRouter(apiLog, [serverChat("c-ph4-a"), serverChat("c-ph4-b")]),
    );
    try {
      assert.deepEqual(await revalidateForeground(AUTH), { status: "ready" });
    } finally {
      restore();
    }
    assert.deepEqual(
      listCustomChats().map((c) => c.code).sort(),
      ["c-ph4-a", "c-ph4-b"],
      "live session re-proves then rows repaint",
    );
    assert.equal(chatReady(AUTH, getChatHydratedKey()), true);
  } finally {
    uninstall();
  }
});

test("pageshow re-proof wipe preserves drafts while rows fail closed", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    listRouter(apiLog, [serverChat("c-ph4-a")]),
  );
  try {
    assert.deepEqual(await revalidateForeground(AUTH), { status: "ready" });
  } finally {
    restore();
  }
  assert.equal(listCustomChats().length, 1);
  writeDraft("composer:welcome", "typed-but-unsent");

  // Hook step 1 on pageshow(persisted=true): invalidate rows BEFORE the
  // reproof, but keep typed input — a bfcache restore is a same-identity
  // return, not a transition, and no server leg can restore unsent text.
  resetChatStoreForIdentity({ preserveDrafts: true });
  assert.equal(listCustomChats().length, 0, "rows fail closed to loading");
  assert.equal(getChatHydratedKey(), null, "marker dropped");
  assert.equal(
    chatReady(AUTH, getChatHydratedKey()),
    false,
    "gate is loading while the session reproves",
  );
  assert.equal(
    readDraft("composer:welcome"),
    "typed-but-unsent",
    "unsent composer input survives the re-proof wipe",
  );
});
