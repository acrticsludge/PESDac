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
  apiRetrievalSearch,
  bannerStatusForCode,
  clearRetrievalBannerDismissal,
  deriveRetrievalHealthState,
  formatVideoTimestamp,
  getRetrievalIncident,
  readRetrievalBannerDismissal,
  recordRetrievalBannerDismissal,
  retrievalBannerView,
  retrievalDotLabel,
  retrievalDotTooltip,
  retrievalScopeForText,
  retrievalSourceLabel,
  retrievalSources,
  selectRetrievalCopy,
  setRetrievalIncident,
  shouldShowRetrievalBanner,
  shouldShowRetrievalDot,
  toEvidenceItems,
  videoSeekUrl,
  type RetrievalBundle,
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

function bundleItem(overrides = {}) {
  return {
    chunk_id: "c-1",
    kind: "slides",
    page: 42,
    bbox: { x: 1, y: 2 },
    text: "Photosynthesis takes in leaf chloroplasts.",
    latex: null,
    table_md: null,
    caption: "Chloroplast diagram",
    concepts: ["photosynthesis"],
    thumb_url: "https://cdn.test/t1.png",
    page_url: "https://cdn.test/p42",
    video: null,
    score: 0.91,
    ...overrides,
  };
}

function bundleWith(items: unknown[]): RetrievalBundle {
  return {
    data: items as RetrievalBundle["data"],
    pagination: { limit: 10, offset: 0, total: items.length },
  };
}

test("@textbook scopes the search to the textbook", () => {
  assert.deepEqual(retrievalScopeForText("@textbook explain integrals"), ["textbook"]);
});

test("no tokens searches all scopes", () => {
  assert.deepEqual(retrievalScopeForText("explain integrals"), ["slides", "textbook", "lectures"]);
});

test("unknown tokens are ignored, known ones dedupe", () => {
  assert.deepEqual(retrievalScopeForText("@slides @nope @slides hi"), ["slides"]);
});

test("video timestamps render mm:ss", () => {
  assert.equal(formatVideoTimestamp(0), "0:00");
  assert.equal(formatVideoTimestamp(65), "1:05");
  assert.equal(formatVideoTimestamp(852), "14:12");
});

test("video seek appends the media fragment", () => {
  assert.equal(videoSeekUrl("https://cdn.test/l14.mp4", 852.7), "https://cdn.test/l14.mp4#t=852");
});

test("slides source names kind and page", () => {
  assert.equal(retrievalSourceLabel("CN", bundleItem()), "CN course slides p.42");
});

test("lecture source names the segment time", () => {
  const item = bundleItem({
    kind: "lectures",
    page: null,
    video: { url: "https://cdn.test/l14.mp4", start: 852, end: 900 },
  });
  assert.equal(retrievalSourceLabel("CN", item), "CN lecture recordings 14:12");
});

test("sources list dedupes repeat hits", () => {
  const labels = retrievalSources("CN", [bundleItem(), bundleItem({ chunk_id: "c-2" })]);
  assert.deepEqual(labels, ["CN course slides p.42"]);
});

test("empty bundle yields no sources", () => {
  assert.deepEqual(retrievalSources("CN", []), []);
});

test("evidence keeps display fields and drops the bbox", () => {
  const [evidence] = toEvidenceItems(bundleWith([bundleItem()]));
  assert.equal(evidence.chunk_id, "c-1");
  assert.equal(evidence.caption, "Chloroplast diagram");
  assert.equal((evidence as Record<string, unknown>).bbox, undefined);
});

test("search posts the P1 contract body", async () => {
  const { __resetAuthCachesForTesting, __setApiRootForTesting, __setAuthBaseForTesting, __setFetchForTesting } =
    await import("../src/lib/auth.ts");
  __setAuthBaseForTesting("https://auth.test");
  __setApiRootForTesting("https://api.test");
  __resetAuthCachesForTesting();
  const apiLog: Array<{ method: string; url: string; body: unknown }> = [];
  const bundle = bundleWith([bundleItem()]);
  const restore = __setFetchForTesting((async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/auth/token")) {
      return new Response(JSON.stringify({ token: "t-search-0" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    let body: unknown;
    try {
      body = typeof init?.body === "string" && init.body ? JSON.parse(init.body) : undefined;
    } catch {
      body = init?.body;
    }
    apiLog.push({ method: init?.method ?? "GET", url, body });
    return new Response(JSON.stringify(bundle), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch);
  try {
    const result = await apiRetrievalSearch({ query: "photosynthesis", subject: "CN" });
    assert.equal(result.pagination.total, 1);
    assert.equal(apiLog.length, 1);
    assert.equal(apiLog[0].method, "POST");
    assert.ok(apiLog[0].url.endsWith("/api/v1/retrieval/search"));
    assert.deepEqual(apiLog[0].body, {
      query: "photosynthesis",
      subject: "CN",
      scope: null,
      topK: 10,
    });
  } finally {
    restore();
    __resetAuthCachesForTesting();
  }
});
