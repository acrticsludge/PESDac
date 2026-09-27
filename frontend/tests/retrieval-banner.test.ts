// Retrieval banner dismissal + copy selection (spec §4.4, §5).
// TDD RED: imports lib/retrieval-banner.ts which does not exist yet.
// DAMP, state-based, clock stubbed via explicit nowMs (zero sleeps).

import test from "node:test";
import assert from "node:assert/strict";

// Minimal window.localStorage stub (session-store.test.ts idiom).
// Each file runs in its own process under `node --test`.
const backing = new Map<string, string>();
const fakeLocalStorage = {
  getItem: (k: string) => (backing.has(k) ? backing.get(k)! : null),
  setItem: (k: string, v: string) => {
    backing.set(k, String(v));
  },
  removeItem: (k: string) => {
    backing.delete(k);
  },
  clear: () => backing.clear(),
  get length() {
    return backing.size;
  },
  key: (i: number) => [...backing.keys()][i] ?? null,
};
if (typeof (globalThis as Record<string, unknown>).window === "undefined") {
  (globalThis as Record<string, unknown>).window = {
    dispatchEvent() {},
    addEventListener() {},
    removeEventListener() {},
    localStorage: fakeLocalStorage,
  };
} else {
  (globalThis as Record<string, unknown> as { window: Record<string, unknown> }).window.localStorage =
    fakeLocalStorage;
}

import {
  RETRIEVAL_BANNER_KEY,
  RETRIEVAL_BANNER_QUIET_MS,
  bannerStatusForCode,
  clearRetrievalBannerDismissal,
  readRetrievalBannerDismissal,
  recordRetrievalBannerDismissal,
  selectRetrievalCopy,
  shouldShowRetrievalBanner,
} from "../src/lib/retrieval-banner.ts";

function reset(): void {
  backing.clear();
  clearRetrievalBannerDismissal();
}

test("storage key is the spec contract key", () => {
  assert.equal(RETRIEVAL_BANNER_KEY, "pesdac:retrieval-banner");
});

test("quiet window is one hour", () => {
  assert.equal(RETRIEVAL_BANNER_QUIET_MS, 3600000);
});

test("no dismissal stored means the bar shows", () => {
  reset();
  assert.equal(shouldShowRetrievalBanner("EMBED_UNREACHABLE", 1000), true);
});

test("dismissal hides the same code inside the quiet window", () => {
  reset();
  recordRetrievalBannerDismissal("EMBED_UNREACHABLE", 1000);
  assert.equal(shouldShowRetrievalBanner("EMBED_UNREACHABLE", 1000 + 60_000), false);
});

test("dismissal stores code and timestamp", () => {
  reset();
  recordRetrievalBannerDismissal("EMBED_UNREACHABLE", 1000);
  const stored = readRetrievalBannerDismissal();
  assert.equal(stored?.code, "EMBED_UNREACHABLE");
  assert.equal(stored?.dismissedAt, 1000);
});

test("a different code re-shows immediately (502 to 503)", () => {
  reset();
  recordRetrievalBannerDismissal("EMBED_UNREACHABLE", 1000);
  assert.equal(shouldShowRetrievalBanner("EMBED_MISCONFIGURED", 1000 + 60_000), true);
});

test("the bar re-shows after one hour", () => {
  reset();
  recordRetrievalBannerDismissal("EMBED_UNREACHABLE", 1000);
  assert.equal(
    shouldShowRetrievalBanner("EMBED_UNREACHABLE", 1000 + RETRIEVAL_BANNER_QUIET_MS - 1),
    false,
  );
  assert.equal(
    shouldShowRetrievalBanner("EMBED_UNREACHABLE", 1000 + RETRIEVAL_BANNER_QUIET_MS),
    true,
  );
});

test("success clears the dismissal so the next failure is a new incident (flap)", () => {
  reset();
  recordRetrievalBannerDismissal("EMBED_UNREACHABLE", 1000);
  assert.equal(shouldShowRetrievalBanner("EMBED_UNREACHABLE", 2000), false);
  clearRetrievalBannerDismissal();
  assert.equal(shouldShowRetrievalBanner("EMBED_UNREACHABLE", 3000), true);
});

test("dismissing 502 does not hide 503 (per-class keys)", () => {
  reset();
  recordRetrievalBannerDismissal("EMBED_UNREACHABLE", 1000);
  assert.equal(shouldShowRetrievalBanner("EMBED_SPACE_MISMATCH", 2000), true);
});

test("envelope message wins when present", () => {
  const copy = selectRetrievalCopy({
    code: "EMBED_UNREACHABLE",
    envelopeMessage: "Custom backend copy.",
  });
  assert.equal(copy.message, "Custom backend copy.");
});

test("title fallback is used on unreadable body", () => {
  const copy = selectRetrievalCopy({ code: "EMBED_UNREACHABLE", envelopeMessage: "   " });
  assert.equal(copy.message, "Search is temporarily unavailable");
});

test("502 maps to the error fallback title", () => {
  const copy = selectRetrievalCopy({ code: "EMBED_UNREACHABLE" });
  assert.equal(copy.title, "Search is temporarily unavailable");
  assert.equal(copy.status, "error");
});

test("503 misconfigured maps to the warning fallback title", () => {
  const copy = selectRetrievalCopy({ code: "EMBED_MISCONFIGURED" });
  assert.equal(copy.title, "Search isn't available right now");
  assert.equal(copy.status, "warning");
});

test("503 space mismatch never says curator", () => {
  const copy = selectRetrievalCopy({ code: "EMBED_SPACE_MISMATCH" });
  assert.equal(copy.message, "Search index needs a refresh. Let your instructor know.");
  assert.equal(copy.message.includes("curator"), false);
});

test("banner status is error for 502 and warning-first for 503", () => {
  assert.equal(bannerStatusForCode("EMBED_UNREACHABLE"), "error");
  assert.equal(bannerStatusForCode("EMBED_MISCONFIGURED"), "warning");
  assert.equal(bannerStatusForCode("EMBED_MISCONFIGURED", true), "error");
});
