// Session-store hardening (audit §10 items 1–2, 4).
// - Listener fanout: one throwing subscriber breaks neither the rest
//   nor the mutator.
// - Overlay bound: per-chat cap trims oldest-first, newest survives.
// - Corrupt reads: one-time console.error per key, then silent fallback.
// - Drafts: tab-memory-only — exercising them costs zero fetches.

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

import type { Block } from "../src/content/threads/types.ts";
import { __setFetchForTesting } from "../src/lib/auth.ts";
import {
  __plantStoreRawForTesting,
  __resetCorruptWarningsForTesting,
  appendBlocks,
  getOverlay,
  readDraft,
  setOverlay,
  subscribeSession,
  updateProfile,
  writeDraft,
  MAX_OVERLAY_BLOCKS_PER_CHAT,
} from "../src/lib/session.ts";

// Storage-contract key (mirrors the private OVERLAY_KEY in session.ts;
// key names are the stable storage contract).
const OVERLAY_KEY = "pesdac-overlays-v1";

function userBlock(n: number): Block {
  return { from: "user", bubbles: [], time: `t${n}` } as unknown as Block;
}

test("throwing subscriber neither breaks fanout nor the mutator", () => {
  let secondRan = 0;
  const off1 = subscribeSession(() => {
    throw new Error("stale listener");
  });
  const off2 = subscribeSession(() => {
    secondRan += 1;
  });
  const errors: unknown[][] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  try {
    updateProfile({ weeklyGoal: "5 days" });
  } finally {
    console.error = orig;
  }
  assert.equal(secondRan, 1);
  off1();
  off2();
  updateProfile({ weeklyGoal: "7 days" });
  assert.equal(secondRan, 1);
});

test("overlay appends trim oldest-first at the per-chat cap", () => {
  setOverlay("cap-chat", []);
  const blocks = Array.from(
    { length: MAX_OVERLAY_BLOCKS_PER_CHAT + 50 },
    (_, i) => userBlock(i),
  );
  appendBlocks("cap-chat", blocks);
  const kept = getOverlay("cap-chat");
  assert.equal(kept.length, MAX_OVERLAY_BLOCKS_PER_CHAT);
  assert.equal((kept[0] as { time: string }).time, "t50");
  assert.equal(
    (kept[kept.length - 1] as { time: string }).time,
    `t${MAX_OVERLAY_BLOCKS_PER_CHAT + 49}`,
  );
  setOverlay("cap-chat", []);
});

test("setOverlay wholesale replace is capped the same way", () => {
  setOverlay(
    "cap-chat",
    Array.from({ length: MAX_OVERLAY_BLOCKS_PER_CHAT + 1 }, (_, i) => userBlock(i)),
  );
  assert.equal(getOverlay("cap-chat").length, MAX_OVERLAY_BLOCKS_PER_CHAT);
  setOverlay("cap-chat", []);
});

test("corrupt entry warns exactly once per key, then falls back silently", () => {
  const errors: unknown[][] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  try {
    __resetCorruptWarningsForTesting();
    __plantStoreRawForTesting(OVERLAY_KEY, "{damaged-json");
    assert.deepEqual(getOverlay("cap-chat"), []);
    assert.equal(errors.length, 1);
    assert.match(String(errors[0][0]), /pesdac-overlays-v1/);
    // Second damage, same key: still falls back, no second warning.
    __plantStoreRawForTesting(OVERLAY_KEY, "{damaged-again");
    assert.deepEqual(getOverlay("cap-chat"), []);
    assert.equal(errors.length, 1);
  } finally {
    console.error = orig;
  }
});

test("drafts round-trip in memory with zero fetches", async () => {
  let fetches = 0;
  const restore = __setFetchForTesting((async () => {
    fetches += 1;
    throw new Error("drafts must never fetch");
  }) as unknown as typeof fetch);
  try {
    writeDraft("thread:abc", "half-typed question");
    assert.equal(readDraft("thread:abc"), "half-typed question");
    writeDraft("thread:abc", "");
    assert.equal(readDraft("thread:abc"), "");
    assert.equal(fetches, 0);
  } finally {
    restore();
  }
});
