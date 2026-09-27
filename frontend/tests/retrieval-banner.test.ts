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
  RETRIEVAL_RETRY_EVENT,
  bannerStatusForCode,
  clearRetrievalBannerDismissal,
  deriveRetrievalHealthState,
  getRetrievalIncident,
  readRetrievalBannerDismissal,
  recordRetrievalBannerDismissal,
  retrievalBannerView,
  retrievalDotLabel,
  retrievalDotTooltip,
  selectRetrievalCopy,
  setRetrievalIncident,
  shouldShowRetrievalBanner,
  shouldShowRetrievalDot,
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

test("bar view pins the section container and dismiss label", () => {
  const view = retrievalBannerView({ code: "EMBED_UNREACHABLE" });
  assert.equal(view.container, "section");
  assert.equal(view.dismissLabel, "Dismiss search outage notice");
});

test("bar view carries the 502 title and default description", () => {
  const view = retrievalBannerView({ code: "EMBED_UNREACHABLE" });
  assert.equal(view.status, "error");
  assert.equal(view.title, "Search is temporarily unavailable");
  assert.equal(
    view.description,
    "Your course material can't be reached right now. Your chats and settings still work — new questions will wait until search is back.",
  );
});

test("bar view carries the 503 title with warning status", () => {
  const view = retrievalBannerView({ code: "EMBED_MISCONFIGURED" });
  assert.equal(view.status, "warning");
  assert.equal(view.title, "Search isn't available right now");
});

test("bar view renders the envelope message as the description", () => {
  const view = retrievalBannerView({
    code: "EMBED_UNREACHABLE",
    envelopeMessage: "Custom backend copy.",
  });
  assert.equal(view.title, "Search is temporarily unavailable");
  assert.equal(view.description, "Custom backend copy.");
});

test("no incident is stored initially", () => {
  setRetrievalIncident(null);
  assert.equal(getRetrievalIncident(), null);
});

test("newest incident replaces the previous one (never stacked)", () => {
  setRetrievalIncident({ code: "EMBED_UNREACHABLE" });
  setRetrievalIncident({ code: "EMBED_MISCONFIGURED", envelopeMessage: "Down." });
  assert.deepEqual(getRetrievalIncident(), {
    code: "EMBED_MISCONFIGURED",
    envelopeMessage: "Down.",
  });
  setRetrievalIncident(null);
});

test("clearing the incident empties the slot", () => {
  setRetrievalIncident({ code: "EMBED_UNREACHABLE" });
  setRetrievalIncident(null);
  assert.equal(getRetrievalIncident(), null);
});

test("healthy backend derives ok", () => {
  assert.equal(
    deriveRetrievalHealthState({
      health: {
        ok: true,
        provider: "workers-ai",
        dims: 768,
        sources: 3,
        chunks: 41,
        neurons_24h_estimate: 12,
      },
      fetchFailed: false,
    }),
    "ok",
  );
});

test("unhealthy backend derives degraded", () => {
  assert.equal(
    deriveRetrievalHealthState({
      health: {
        ok: false,
        provider: "workers-ai",
        dims: 768,
        sources: 0,
        chunks: 0,
        neurons_24h_estimate: 0,
      },
      fetchFailed: false,
    }),
    "degraded",
  );
});

test("no read yet derives unknown", () => {
  assert.equal(deriveRetrievalHealthState({ health: null, fetchFailed: false }), "unknown");
});

test("failed read derives unreachable", () => {
  assert.equal(deriveRetrievalHealthState({ health: null, fetchFailed: true }), "unreachable");
});

test("dot shows for degraded or unreachable while authenticated", () => {
  assert.equal(shouldShowRetrievalDot(true, "degraded"), true);
  assert.equal(shouldShowRetrievalDot(true, "unreachable"), true);
  assert.equal(shouldShowRetrievalDot(true, "ok"), false);
  assert.equal(shouldShowRetrievalDot(true, "unknown"), false);
});

test("dot never shows for guests", () => {
  assert.equal(shouldShowRetrievalDot(false, "degraded"), false);
  assert.equal(shouldShowRetrievalDot(false, "unreachable"), false);
});

test("dot tooltip names last check, provider, and Settings retry", () => {
  const tip = retrievalDotTooltip({
    state: "degraded",
    provider: "workers-ai",
    lastCheckAtMs: Date.parse("2026-09-27T10:30:00Z"),
  });
  assert.ok(tip.includes("workers-ai"));
  assert.ok(tip.includes("Settings"));
});

test("dot label names the degraded state", () => {
  assert.equal(retrievalDotLabel("degraded"), "Course search degraded");
  assert.equal(retrievalDotLabel("unreachable"), "Course search unreachable");
});

test("retry event name is the spec bus name", () => {
  assert.equal(RETRIEVAL_RETRY_EVENT, "pesdac:retrieval-retry");
});

test("incident hook server-renders without throwing (SSR gate)", async () => {
  const { createElement } = await import("react");
  const { renderToString } = await import("react-dom/server");
  const { useRetrievalIncident } = await import("../src/lib/retrieval-banner.ts");
  function Probe() {
    const incident = useRetrievalIncident();
    return createElement("span", null, incident == null ? "none" : incident.code);
  }
  setRetrievalIncident(null);
  const html = renderToString(createElement(Probe));
  assert.ok(html.includes("none"));
});
