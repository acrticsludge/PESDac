// Identity-scoped reset tests (caching Phase 1 — Fix 1, P0-1…P0-5).
// Seed-as-A → transition → zero A rows/overlays/drafts/signals paint for B;
// dumpStore clean; device prefs preserved. Genuine guest→login adoption is
// pinned in slice 3 below — the reset must never break it.
//
// Style mirrors chat-backing.test.ts: stubbed fetch, state-based assertions,
// DAMP self-contained cases, synthetic (`c-rst-*`) fixtures.

import test from "node:test";
import assert from "node:assert/strict";

// The memory store gates on `window` existing (SSR returns fallbacks).
// Stubbed before any session write; each file runs in its own process
// under `node --test`, so this cannot leak into other suites.
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
  __resetAuthCachesForTesting,
  __setApiRootForTesting,
  __setAuthBaseForTesting,
  __setFetchForTesting,
  apiFetch,
  clearAuthCache,
} from "../src/lib/auth.ts";
import {
  __resetChatBackingForTesting,
  appendBlocks,
  archiveChat,
  createCustomChat,
  dumpStore,
  getChatHydrateFailed,
  getChatHydratePending,
  getChatHydratedKey,
  getChatMessagesStatus,
  getChatSyncError,
  getCreateSyncError,
  getHydrateSyncError,
  getOverlay,
  getProfile,  hydrateChats,
  LAST_KNOWN_ARCHIVED_COUNT_KEY,
  LAST_KNOWN_PINNED_COUNT_KEY,
  LAST_KNOWN_SNAPSHOT_AT_KEY,
  LAST_KNOWN_SUBJECT_COUNTS_KEY,
  listArchived,
  listCustomChats,
  listPinned,
  loadChatMessages,
  readDraft,
  resetChatStoreForIdentity,
  setSeededIdentityKey,
  togglePin,
  updateProfile,
  writeDraft,
  type ChatAuth,
  type CustomChat,
} from "../src/lib/session.ts";
import type { Block } from "../src/content/threads/types.ts";

__setAuthBaseForTesting("https://auth.test");
__setApiRootForTesting("https://api.test");

const AUTH_A: ChatAuth = { userId: "u-rst-a", identityKey: "u-rst-a:3" };
const AUTH_B: ChatAuth = { userId: "u-rst-b", identityKey: "u-rst-b:9" };

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

function tokens(n: number): Array<() => Response> {
  return Array.from({ length: n }, (_, i) => () => tokenOk(`t-rst-${i}`));
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

function listEnvelope(data: unknown[]) {
  return {
    data,
    pagination: { limit: 200, offset: 0, total: data.length },
  };
}

function userBlock(text: string): Block {
  return {
    from: "user",
    bubbles: [{ type: "text", text }],
    time: "2026-09-09T00:00:00.000Z",
  };
}

function serverMessage(id: string, seq: number, block: Block) {
  return {
    id,
    seq,
    role: block.from,
    content: block,
    createdAt: "2026-09-09T00:00:00.000Z",
  };
}

type ApiCall = { method: string; url: string; body: unknown };

/** Routes token mints and API calls from separate queues; records API calls. */
function makeRouter(
  tokenQueue: Array<() => Response | Promise<Response>>,
  apiQueue: Array<() => Response | Promise<Response>>,
  apiLog: ApiCall[],
  tokenLog: string[] = [],
): typeof fetch {
  return (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/auth/token")) {
      tokenLog.push(url);
      const next = tokenQueue.shift();
      if (!next) throw new Error(`token fetch with empty queue: ${url}`);
      return next();
    }
    const raw = init?.body;
    let body: unknown;
    try {
      body = typeof raw === "string" && raw ? JSON.parse(raw) : undefined;
    } catch {
      body = raw;
    }
    apiLog.push({ method: init?.method ?? "GET", url, body });
    // Phase-3 paging leg: hydrate reads the archived list explicitly.
    // Fixtures carry no archived server rows, so serve an empty page here
    // without consuming the queued contract responses (queue positions —
    // and every assertion on them — stay aligned).
    if (
      (init?.method ?? "GET") === "GET" &&
      url.includes("/chats") &&
      !url.includes("/messages") &&
      url.includes("archived=true")
    ) {
      return apiJson(listEnvelope([]));
    }
    const next = apiQueue.shift();
    if (!next) throw new Error(`api fetch with empty queue: ${url}`);
    return next();
  }) as typeof fetch;
}

function setup() {
  __resetAuthCachesForTesting();
  __resetChatBackingForTesting();
  snapshotStorage.clear();
  setSeededIdentityKey(null);
  writeDraft("welcome", "");
  writeDraft("rst-probe", "");
}

/** Seed a fully-lived-in store as identity A: server rows, overlays,
 *  pin/archive refs, message states, error signals, drafts. */
async function seedAsA(): Promise<void> {
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter(
      tokens(10),
      [
        () => apiJson(listEnvelope([serverChat("c-rst-a1"), serverChat("c-rst-a2")])),
        () => apiJson(listEnvelope([serverMessage("m-rst-1", 0, userBlock("a-one"))])),
      ],
      apiLog,
    ),
  );
  try {
    const result = await hydrateChats(AUTH_A);
    assert.deepEqual(result, { status: "ready" });
    // A lived-in overlay + per-chat ready state for one server row.
    appendBlocks("c-rst-a1", [userBlock("a-unsent")]);
    await loadChatMessages("c-rst-a1", AUTH_A);
    // Pin/archive refs, drafts, and a device pref mixing identity + device data.
    togglePin({ kind: "custom", id: "c-rst-a1" });
    archiveChat({ kind: "custom", id: "c-rst-a2" });
    writeDraft("welcome", "A's half-typed question");
    writeDraft("rst-probe", "A's thread draft");
    updateProfile({ language: "hi", weeklyGoal: "3 days" });
  } finally {
    restore();
  }
}

// ---- Slice 1 — reset function (P0-1/P0-5) ------------------------------------

test("reset drops every A row, overlay, draft, signal, and marker", async () => {
  setup();
  await seedAsA();
  assert.equal(listCustomChats().length, 2);
  assert.equal(getChatHydratedKey(), AUTH_A.identityKey);

  resetChatStoreForIdentity();

  // B-visible chat state is empty: no rows, no overlays, no per-chat status.
  assert.deepEqual(listCustomChats(), []);
  assert.equal(getOverlay("c-rst-a1").length, 0);
  assert.equal(getOverlay("c-rst-a2").length, 0);
  assert.equal(getChatMessagesStatus("c-rst-a1"), "idle");
  // Hydrate markers + all three error signals are gone.
  assert.equal(getChatHydratedKey(), null);
  assert.equal(getChatHydratePending(), false);
  assert.equal(getChatHydrateFailed(), false);
  assert.equal(getHydrateSyncError(), null);
  assert.equal(getCreateSyncError(), null);
  assert.equal(getChatSyncError("c-rst-a1"), null);
  // Drafts are identity data (P0-5) — they go.
  assert.equal(readDraft("welcome"), "");
  assert.equal(readDraft("rst-probe"), "");
  // The serialized export carries zero A data.
  const dumped = JSON.stringify(dumpStore());
  assert.ok(!dumped.includes("c-rst-a1"), "A row leaks via dumpStore");
  assert.ok(!dumped.includes("c-rst-a2"), "A row leaks via dumpStore");
  assert.ok(!dumped.includes("A's half-typed"), "A draft leaks via dumpStore");
});

test("reset keeps device prefs and demo refs, drops only c: pin/archive refs", async () => {
  setup();
  await seedAsA();
  togglePin({ kind: "demo", id: "demo-thread" });

  resetChatStoreForIdentity();

  // Device-level profile prefs survive byte-identical; the reset never
  // touches the profile store (clearLocalProfileSeed owns identity seed).
  assert.equal(getProfile().language, "hi");
  assert.equal(getProfile().weeklyGoal, "3 days");
  // Demo refs are device-level (demos never sync) — only c: refs retire.
  assert.deepEqual(
    listPinned().filter((r) => r.kind === "custom"),
    [],
  );
  assert.deepEqual(
    listArchived().filter((r) => r.kind === "custom"),
    [],
  );
  assert.ok(
    listPinned().some((r) => r.kind === "demo" && r.id === "demo-thread"),
  );
});

test("post-reset hydrate for B lists server rows only, with no A residue", async () => {
  setup();
  await seedAsA();
  resetChatStoreForIdentity();

  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter(
      tokens(10),
      [() => apiJson(listEnvelope([serverChat("c-rst-b1")]))],
      apiLog,
    ),
  );
  try {
    const result = await hydrateChats(AUTH_B);
    assert.deepEqual(result, { status: "ready" });
    assert.deepEqual(
      listCustomChats().map((c) => c.code),
      ["c-rst-b1"],
    );
    // Guest-created control: memory customs never leak across the reset.
    const guest = createCustomChat("CN", "b guest");
    assert.deepEqual(
      listCustomChats().map((c) => c.code),
      ["c-rst-b1", guest.code],
    );
  } finally {
    restore();
  }
});

// ---- Slice 2 — choke-point wiring (P0-2) -------------------------------------

test("mint started as A never populates the post-transition cache", async () => {
  setup();
  const tokenLog: string[] = [];
  const apiLog: ApiCall[] = [];
  let releaseStaleMint!: (res: Response) => void;
  const staleMintGate = new Promise<Response>((resolve) => {
    releaseStaleMint = resolve;
  });
  const restore = __setFetchForTesting(
    makeRouter(
      [() => staleMintGate, () => tokenOk("t-rst-fresh"), () => tokenOk("t-rst-third")],
      [
        () => apiJson({ ok: true }),
        () => apiJson({ ok: true }),
        () => apiJson({ ok: true }),
        () => apiJson({ ok: true }),
      ],
      apiLog,
      tokenLog,
    ),
  );
  try {
    // A's request starts its mint, then the identity transition lands.
    const pendingA = apiFetch<{ ok: boolean }>("/profiles/me");
    assert.equal(tokenLog.length, 1);
    clearAuthCache();
    // A caller arriving after the transition must NOT share A's in-flight
    // mint — it starts its own.
    const pendingB = apiFetch<{ ok: boolean }>("/profiles/me");
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(tokenLog.length, 2);
    // A's stale mint resolves: it may finish its own call, but the cache
    // write is dropped — B's own mint populates the cache exactly once.
    releaseStaleMint(tokenOk("t-rst-stale"));
    const [aRes, bRes] = await Promise.all([pendingA, pendingB]);
    assert.deepEqual(aRes, { ok: true });
    assert.deepEqual(bRes, { ok: true });
    assert.equal(tokenLog.length, 2);
    // Within-identity callers reuse B's fresh mint (no fetch storm)…
    await apiFetch<{ ok: boolean }>("/profiles/me");
    assert.equal(tokenLog.length, 2);
    // …while the next transition drops it again.
    clearAuthCache();
    await apiFetch<{ ok: boolean }>("/profiles/me");
    assert.equal(tokenLog.length, 3);
  } finally {
    restore();
  }
});

test("clearAuthCache drops the chat store; login paths preserve true guests", async () => {
  setup();
  await seedAsA();
  assert.equal(listCustomChats().length, 2);

  // Logout/401 path: full wipe, even of unsynced-looking rows that carry
  // no server flags is NOT preserved here — the transition owns the heap.
  clearAuthCache();
  assert.deepEqual(listCustomChats(), []);
  assert.equal(getOverlay("c-rst-a1").length, 0);
  assert.equal(readDraft("welcome"), "");
  assert.equal(getChatHydratedKey(), null);
});

test("login-transition reset preserves never-synced guests, drops flagged rows", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter(
      tokens(10),
      [() => apiJson(listEnvelope([serverChat("c-rst-a9")]))],
      apiLog,
    ),
  );
  try {
    await hydrateChats(AUTH_A);
  } finally {
    restore();
  }
  // Heap now mixes a flagged server row with fresh never-synced guest rows.
  const guest = createCustomChat("CN", "guest notes");
  appendBlocks(guest.code, [userBlock("g-one")]);
  togglePin({ kind: "custom", id: guest.code });
  writeDraft("welcome", "guest draft");
  assert.ok(listCustomChats().some((c) => c.code === "c-rst-a9"));

  clearAuthCache({ preserveTrueGuests: true });

  const codes = listCustomChats().map((c) => c.code);
  assert.ok(codes.includes(guest.code), "genuine guest row must survive");
  assert.ok(!codes.includes("c-rst-a9"), "flagged leftover must drop");
  assert.deepEqual(getOverlay(guest.code), [userBlock("g-one")]);
  assert.ok(
    listPinned().some((r) => r.kind === "custom" && r.id === guest.code),
    "guest pin ref must survive",
  );
  // Drafts are identity data (P0-5) — they go on every transition,
  // even the login path that preserves adoptable guest rows.
  assert.equal(readDraft("welcome"), "");
});

// ---- Slice 3 — hydrate adopt-ordering (P0-3/P0-4) -----------------------------

test("A rows in memory + hydrate as B: zero adopt POSTs, B list only", async () => {
  setup();
  await seedAsA();
  assert.equal(listCustomChats().length, 2);

  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter(
      tokens(10),
      [() => apiJson(listEnvelope([serverChat("c-rst-b1")]))],
      apiLog,
    ),
  );
  try {
    const result = await hydrateChats(AUTH_B);
    assert.deepEqual(result, { status: "ready" });
    // Post-logout leftovers carry server flags ⇒ never adoptable: the
    // only fetch is the list leg, and B's list is the server list only.
    assert.deepEqual(
      apiLog.map((c) => `${c.method} ${c.url}`),
      [
        "GET https://api.test/api/v1/chats",
        "GET https://api.test/api/v1/chats?archived=true&limit=50&offset=0",
      ],
    );
    assert.deepEqual(
      listCustomChats().map((c) => c.code),
      ["c-rst-b1"],
    );
    assert.equal(getOverlay("c-rst-a1").length, 0);
  } finally {
    restore();
  }
});

test("genuine guest rows still adopt exactly once, pins included", async () => {
  setup();
  const guest = createCustomChat("CN", "guest notes");
  appendBlocks(guest.code, [userBlock("hello")]);
  togglePin({ kind: "custom", id: guest.code });

  const apiLog: ApiCall[] = [];
  const adopted = serverChat("c-adopt-1");
  const restore = __setFetchForTesting(
    makeRouter(
      tokens(10),
      [
        () => apiJson(adopted, 201),
        () => apiJson(serverMessage("m-adopt-1", 0, userBlock("hello")), 201),
        () => apiJson({ ...adopted, isPinned: true }),
        () => apiJson(listEnvelope([{ ...adopted, isPinned: true }])),
      ],
      apiLog,
    ),
  );
  try {
    const result = await hydrateChats(AUTH_B);
    assert.deepEqual(result, { status: "ready" });
    // Adopted exactly once under the server code — never double-listed.
    assert.deepEqual(
      listCustomChats().map((c) => c.code),
      ["c-adopt-1"],
    );
    assert.equal(getOverlay(guest.code).length, 0);
    // The guest pin migrated to the adopted row via the server flag.
    assert.ok(
      listPinned().some((r) => r.kind === "custom" && r.id === "c-adopt-1"),
    );
    // Adopt-then-list ordering: exactly one create, one message POST,
    // one pin PATCH — never duplicated, never skipped.
    assert.deepEqual(
      apiLog.map((c) => `${c.method} ${c.url}`),
      [
        "POST https://api.test/api/v1/chats",
        "POST https://api.test/api/v1/chats/c-adopt-1/messages",
        "PATCH https://api.test/api/v1/chats/c-adopt-1",
        "GET https://api.test/api/v1/chats",
        "GET https://api.test/api/v1/chats?archived=true&limit=50&offset=0",
      ],
    );
  } finally {
    restore();
  }
});

test("deferred A message resolve after identity switch paints nothing", async () => {
  setup();
  const apiLog: ApiCall[] = [];
  let releaseMessages!: (res: Response) => void;
  const messagesGate = new Promise<Response>((resolve) => {
    releaseMessages = resolve;
  });
  const restore = __setFetchForTesting(
    makeRouter(
      tokens(10),
      [
        () => apiJson(listEnvelope([serverChat("c-rst-a1")])),
        () => messagesGate,
      ],
      apiLog,
    ),
  );
  try {
    await hydrateChats(AUTH_A);
    // A's history load starts, then the identity transition lands.
    const pendingLoad = loadChatMessages("c-rst-a1", AUTH_A);
    assert.equal(getChatMessagesStatus("c-rst-a1"), "loading");
    resetChatStoreForIdentity();
    // A's stale resolve lands after the switch: dropped, never painted.
    releaseMessages(
      apiJson(listEnvelope([serverMessage("m-rst-9", 0, userBlock("a-stale"))])),
    );
    await pendingLoad;
    assert.equal(getOverlay("c-rst-a1").length, 0);
    assert.equal(getChatMessagesStatus("c-rst-a1"), "idle");
    assert.ok(!JSON.stringify(dumpStore()).includes("a-stale"));
  } finally {
    restore();
  }
});

// ---- Reviewer additions — transition-time snapshot wipe + stale-tab attribution

test("reset wipes all four skeleton snapshot keys synchronously", async () => {
  setup();
  // The wipe must happen at transition time (inside the reset), not after
  // the next identity resolves — B's loading window must never read them,
  // and remounts must not skip them.
  fakeLocalStorage.setItem(LAST_KNOWN_SUBJECT_COUNTS_KEY, JSON.stringify({ CN: 2 }));
  fakeLocalStorage.setItem(LAST_KNOWN_PINNED_COUNT_KEY, "1");
  fakeLocalStorage.setItem(LAST_KNOWN_ARCHIVED_COUNT_KEY, "1");
  fakeLocalStorage.setItem(LAST_KNOWN_SNAPSHOT_AT_KEY, String(Date.now()));

  resetChatStoreForIdentity();

  assert.equal(fakeLocalStorage.getItem(LAST_KNOWN_SUBJECT_COUNTS_KEY), null);
  assert.equal(fakeLocalStorage.getItem(LAST_KNOWN_PINNED_COUNT_KEY), null);
  assert.equal(fakeLocalStorage.getItem(LAST_KNOWN_ARCHIVED_COUNT_KEY), null);
  assert.equal(fakeLocalStorage.getItem(LAST_KNOWN_SNAPSHOT_AT_KEY), null);
});

test("stale-tab orphans: seeded-A heap preserved at signin never adopts into B", async () => {
  setup();
  // This tab holds A's seeded heap (A's session died elsewhere; no
  // transition ran here). Its flagless orphans are indistinguishable from
  // genuine guest rows at signin time — the preserve tags them with A's seed.
  setSeededIdentityKey(AUTH_A.identityKey);
  const orphan = createCustomChat("CN", "a orphan notes");
  appendBlocks(orphan.code, [userBlock("a-orphan")]);
  togglePin({ kind: "custom", id: orphan.code });

  clearAuthCache({ preserveTrueGuests: true });
  assert.ok(
    listCustomChats().some((c) => c.code === orphan.code),
    "orphans ride the preserve (attribution happens at hydrate)",
  );

  // B's hydrate proves the foreign tag and drops them: zero adopt POSTs,
  // B list only, no orphan overlay or pin — A's content never enters B's
  // account.
  const apiLog: ApiCall[] = [];
  const restore = __setFetchForTesting(
    makeRouter(
      tokens(10),
      [() => apiJson(listEnvelope([serverChat("c-rst-b9")]))],
      apiLog,
    ),
  );
  try {
    const result = await hydrateChats(AUTH_B);
    assert.deepEqual(result, { status: "ready" });
    assert.deepEqual(
      apiLog.map((c) => `${c.method} ${c.url}`),
      [
        "GET https://api.test/api/v1/chats",
        "GET https://api.test/api/v1/chats?archived=true&limit=50&offset=0",
      ],
    );
    assert.deepEqual(
      listCustomChats().map((c) => c.code),
      ["c-rst-b9"],
    );
    assert.equal(getOverlay(orphan.code).length, 0);
    assert.ok(
      !listPinned().some((r) => r.kind === "custom" && r.id === orphan.code),
      "orphan pin ref must not survive the drop",
    );
    assert.ok(!JSON.stringify(dumpStore()).includes("a-orphan"));
  } finally {
    restore();
  }
});
