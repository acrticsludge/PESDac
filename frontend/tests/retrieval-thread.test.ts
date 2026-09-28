// ThreadView search bindings (spec §4.1, §4.3): pure helpers behind the
// turn wiring. Retrieval fetch outcomes map to exactly one surface;
// evidence maps to existing bubble parts; video opens via buttons
// rendered from the persisted evidence (never a bubble).

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { ApiError, AuthRequiredError, AuthServiceError } from "../src/lib/api/errors.ts";
import {
  chipTargetForScope,
  classifyRetrievalFailure,
  evidenceToBubbles,
  retrievalFailureMessage,
  retrievalToastForFailure,
  searchToolCall,
  sourcesBannerDescription,
  withSearchToolCall,
  withoutFabricatedSearch,
  RETRIEVAL_EMPTY_MESSAGE,
  RETRIEVAL_EMPTY_PILLS,
  type SearchPhase,
} from "../src/lib/retrieval.ts";
import type { RetrievalEvidenceItem, ToolCall } from "../src/content/threads/types.ts";

function item(overrides: Partial<RetrievalEvidenceItem> = {}): RetrievalEvidenceItem {
  return {
    chunk_id: "c1",
    kind: "slides",
    page: 42,
    text: "The mitochondria is the powerhouse.",
    latex: null,
    table_md: null,
    caption: null,
    concepts: [],
    thumb_url: null,
    page_url: null,
    video: null,
    score: 0.9,
    ...overrides,
  };
}

describe("classifyRetrievalFailure (§4.1: exactly one surface)", () => {
  test("502 with a known incident code mounts the bar", () => {
    assert.deepEqual(
      classifyRetrievalFailure(new ApiError(502, { code: "EMBED_UNREACHABLE", message: "down" }, "Bad Gateway")),
      { surface: "bar", incidentCode: "EMBED_UNREACHABLE" },
    );
  });

  test("503 misconfigured mounts the bar as warning-class", () => {
    assert.deepEqual(
      classifyRetrievalFailure(new ApiError(503, { code: "EMBED_MISCONFIGURED", message: "no creds" }, "Unavailable")),
      { surface: "bar", incidentCode: "EMBED_MISCONFIGURED" },
    );
  });

  test("503 space mismatch mounts the bar (student-safe copy comes from the envelope)", () => {
    assert.deepEqual(
      classifyRetrievalFailure(new ApiError(503, { code: "EMBED_SPACE_MISMATCH", message: "reindex" }, "Unavailable")),
      { surface: "bar", incidentCode: "EMBED_SPACE_MISMATCH" },
    );
  });

  test("502/503 with an unknown code stays composer-only (nothing to key dismissal on)", () => {
    assert.deepEqual(
      classifyRetrievalFailure(new ApiError(503, { code: "SOME_FUTURE_CODE", message: "?" }, "Unavailable")),
      { surface: "composer", incidentCode: null },
    );
    assert.deepEqual(
      classifyRetrievalFailure(new ApiError(502, null, "Bad Gateway")),
      { surface: "composer", incidentCode: null },
    );
  });

  test("429 is composer-only, never the bar", () => {
    assert.deepEqual(
      classifyRetrievalFailure(new ApiError(429, { code: "RATE_LIMITED", message: "slow down" }, "Too Many Requests")),
      { surface: "composer", incidentCode: null },
    );
  });

  test("422 is composer-only (the toast lands in T7)", () => {
    assert.deepEqual(
      classifyRetrievalFailure(new ApiError(422, { code: "VALIDATION_ERROR", message: "bad query" }, "Unprocessable")),
      { surface: "composer", incidentCode: null },
    );
  });

  test("401 is swallowed (the global re-login flow owns it — no new UI)", () => {
    assert.deepEqual(
      classifyRetrievalFailure(new AuthRequiredError({ code: "AUTH_REQUIRED", message: "sign in" })),
      { surface: "none", incidentCode: null },
    );
    assert.deepEqual(
      classifyRetrievalFailure(new ApiError(401, { code: "AUTH_REQUIRED", message: "sign in" }, "Unauthorized")),
      { surface: "none", incidentCode: null },
    );
  });

  test("network failure is composer-transient, never the bar", () => {
    assert.deepEqual(
      classifyRetrievalFailure(new TypeError("Failed to fetch")),
      { surface: "composer", incidentCode: null },
    );
  });

  test("auth-service outage is composer-transient (user stays in the shell)", () => {
    assert.deepEqual(
      classifyRetrievalFailure(new AuthServiceError("network")),
      { surface: "composer", incidentCode: null },
    );
  });

  test("anything unexpected degrades to composer, never a crash", () => {
    assert.deepEqual(
      classifyRetrievalFailure(new Error("weird")),
      { surface: "composer", incidentCode: null },
    );
    assert.deepEqual(classifyRetrievalFailure(null), { surface: "composer", incidentCode: null });
  });
});

describe("evidenceToBubbles (existing parts only)", () => {
  test("text maps to one markdown bubble", () => {
    const [bubble] = evidenceToBubbles([item()], "CN");
    assert.equal(bubble?.type, "markdown");
    assert.match((bubble as { md: string }).md ?? "", /mitochondria/);
  });

  test("latex and tables map to markdown when no text", () => {
    const [latexBubble] = evidenceToBubbles([item({ text: "  ", latex: "E=mc^2" })], "CN");
    assert.equal(latexBubble?.type, "markdown");
    const [tableBubble] = evidenceToBubbles([item({ text: null, latex: null, table_md: "| a |\n|---|\n| b |" })], "CN");
    assert.equal(tableBubble?.type, "markdown");
  });

  test("page_url appends the View-full-page link to the card", () => {
    const [bubble] = evidenceToBubbles([item({ page_url: "https://cdn.test/u1/p42" })], "CN");
    assert.equal(bubble?.type, "markdown");
    assert.match((bubble as { md: string }).md, /\[View full page\]\(https:\/\/cdn\.test\/u1\/p42\)/);
  });

  test("link-only item still renders a card (never a dropped source)", () => {
    const [bubble] = evidenceToBubbles(
      [item({ text: null, latex: null, table_md: null, page_url: "https://cdn.test/u1/p42" })],
      "CN",
    );
    assert.equal(bubble?.type, "markdown");
  });

  test("thumbnail maps to an image bubble with the caption as alt", () => {
    const bubbles = evidenceToBubbles(
      [item({ text: null, thumb_url: "https://cdn.test/u1/p42.png", caption: "Krebs cycle" })],
      "CN",
    );
    assert.equal(bubbles.length, 1);
    assert.deepEqual(bubbles[0], {
      type: "image",
      src: "https://cdn.test/u1/p42.png",
      alt: "Krebs cycle",
      label: "Krebs cycle",
    });
  });

  test("text plus thumbnail renders both bubbles, text first", () => {
    const bubbles = evidenceToBubbles(
      [item({ thumb_url: "https://cdn.test/u1/p42.png", caption: "Krebs cycle" })],
      "CN",
    );
    assert.deepEqual(bubbles.map((b) => b.type), ["markdown", "image"]);
  });

  test("video-only item renders no bubble (the Open-at button covers it)", () => {
    const bubbles = evidenceToBubbles(
      [item({ text: null, video: { url: "https://cdn.test/l14.mp4", start: 852, end: 900 } })],
      "CN",
    );
    assert.deepEqual(bubbles, []);
  });

  test("content-free item with nothing to show renders nothing", () => {
    assert.deepEqual(evidenceToBubbles([item({ text: null, latex: null, table_md: null })], "CN"), []);
  });
});

describe("retrievalFailureMessage (§3: envelope wins when present)", () => {
  test("5xx envelope beats the generic masked copy", () => {
    assert.equal(
      retrievalFailureMessage(
        new ApiError(502, { code: "EMBED_UNREACHABLE", message: "Search is down for maintenance" }, "Bad Gateway"),
        "Search failed. Try again.",
      ),
      "Search is down for maintenance",
    );
  });

  test("unreadable bodies fall back", () => {
    assert.equal(
      retrievalFailureMessage(new ApiError(502, null, "Bad Gateway"), "Search failed. Try again."),
      "Search failed. Try again.",
    );
    assert.equal(retrievalFailureMessage(new TypeError("Failed to fetch"), "Search failed. Try again."), "Search failed. Try again.");
  });
});

describe("chipTargetForScope (running-chip label)", () => {
  test("single scope reads like the mock responder target", () => {
    assert.equal(chipTargetForScope("CN", ["textbook"]), "CN textbook");
    assert.equal(chipTargetForScope("CN", ["slides"]), "CN course slides");
  });

  test("multi-scope reads as the course material", () => {
    assert.equal(chipTargetForScope("CN", ["slides", "textbook", "lectures"]), "CN course material");
  });
});

describe("empty state copy", () => {
  test("message and pills match the spec wording", () => {
    assert.equal(RETRIEVAL_EMPTY_MESSAGE, "Nothing in your course material covers this yet.");
    assert.deepEqual(RETRIEVAL_EMPTY_PILLS, [
      "Try rephrasing",
      "Search a different source",
      "Quiz me on what we've covered",
    ]);
  });
});

// The tool-call row is the turn's only loading signal (it replaces the
// skeleton bar). These pin the mapping onto ChatToolCall.status, which is
// all ChatToolCalls reads to pick a spinner / tick / cross.
describe("searchToolCall (loading state on the tool-call row)", () => {
  test("idle contributes no row (guest turns, pre-kickoff)", () => {
    assert.equal(searchToolCall({ status: "idle" }), null);
  });

  test("running maps to the vendor spinner and carries no duration", () => {
    // A duration here is what made the old chip tick for a request that
    // had not been made — the row must stay duration-less until it lands.
    assert.deepEqual(searchToolCall({ status: "running", target: "CN textbook" }), {
      name: "search",
      target: "CN textbook",
      status: "running",
      duration: "",
    });
  });

  test("complete maps to the green tick with the real duration", () => {
    assert.deepEqual(
      searchToolCall({ status: "complete", target: "CN textbook", duration: "312ms" }),
      { name: "search", target: "CN textbook", status: "complete", duration: "312ms" },
    );
  });

  test("error maps to the red cross and keeps the failure copy", () => {
    assert.deepEqual(
      searchToolCall({
        status: "error",
        target: "CN course material",
        message: "Search is temporarily unavailable.",
      }),
      {
        name: "search",
        target: "CN course material",
        status: "error",
        duration: "",
        errorMessage: "Search is temporarily unavailable.",
      },
    );
  });

  test("every non-idle phase produces a row the vendor can render", () => {
    const phases: SearchPhase[] = [
      { status: "running", target: "CN textbook" },
      { status: "complete", target: "CN textbook", duration: "1ms" },
      { status: "error", target: "CN textbook", message: "down" },
    ];
    for (const phase of phases) {
      const row = searchToolCall(phase) as ToolCall;
      // ChatToolCalls picks its icon from `status` alone (STATUS_ICON_NAMES
      // + the running Spinner branch) and only shows `duration` when the
      // status is complete — so these three are the whole contract.
      assert.equal(row.status, phase.status);
      assert.ok(["running", "complete", "error"].includes(row.status));
      if (phase.status !== "complete") assert.equal(row.duration, "");
    }
  });
});

describe("withSearchToolCall (the real search owns the search row)", () => {
  const mockRetrieve: ToolCall = {
    name: "retrieve",
    target: "CN course slides",
    status: "running",
    duration: "",
  };
  // What lib/responder.ts plans in its `deep` branch: a duration seeded
  // off the question length, i.e. a green tick for a request that had not
  // been made.
  const mockSearch: ToolCall = {
    name: "search",
    target: "CN textbook",
    status: "complete",
    duration: "82ms",
  };
  // What it plans in its "simulate a tool error" branch: the failed call
  // IS the narrative, so it must survive.
  const simulatedSearchError: ToolCall = {
    name: "search",
    target: "CN textbook",
    status: "error",
    duration: "",
    errorMessage: "Search timed out after 8s",
  };

  test("replaces the mock's fabricated search success, keeping the planned rows", () => {
    const merged = withSearchToolCall([mockRetrieve, mockSearch], {
      status: "running",
      target: "CN textbook",
    });
    assert.deepEqual(merged, [
      mockRetrieve,
      { name: "search", target: "CN textbook", status: "running", duration: "" },
    ]);
    // Exactly one search row, and it is not the fabricated one.
    assert.equal(merged.filter((t) => t.name === "search").length, 1);
    assert.equal(merged[1]?.duration, "");
  });

  test("a failed real search never leaves the fabricated tick behind", () => {
    const merged = withSearchToolCall([mockRetrieve, mockSearch], {
      status: "error",
      target: "CN textbook",
      message: "Search is temporarily unavailable.",
    });
    assert.deepEqual(merged[1], {
      name: "search",
      target: "CN textbook",
      status: "error",
      duration: "",
      errorMessage: "Search is temporarily unavailable.",
    });
    assert.ok(merged.every((t) => !(t.name === "search" && t.status === "complete")));
  });

  test("planned order is preserved and the real row lands last", () => {
    const merged = withSearchToolCall([mockRetrieve], {
      status: "complete",
      target: "CN textbook",
      duration: "9ms",
    });
    assert.deepEqual(merged, [
      mockRetrieve,
      { name: "search", target: "CN textbook", status: "complete", duration: "9ms" },
    ]);
  });

  test("idle returns the planned rows untouched (no row invented)", () => {
    const planned = [mockRetrieve];
    assert.deepEqual(withSearchToolCall(planned, { status: "idle" }), planned);
  });

  test("a plan with no search row still gains the real one", () => {
    const merged = withSearchToolCall([mockRetrieve], {
      status: "running",
      target: "CN course material",
    });
    assert.equal(merged.length, 2);
    assert.equal(merged[1]?.name, "search");
  });

  test("a simulated search ERROR stands, and no real row is added over it", () => {
    // The demo branch that shows a failed tool call must keep telling that
    // story — a real result landing beside it would contradict it.
    for (const phase of [
      { status: "running", target: "CN textbook" },
      { status: "complete", target: "CN textbook", duration: "5ms" },
    ] as SearchPhase[]) {
      const merged = withSearchToolCall([mockRetrieve, simulatedSearchError], phase);
      assert.deepEqual(merged, [mockRetrieve, simulatedSearchError]);
    }
  });
});

describe("withoutFabricatedSearch (persisted history)", () => {
  test("drops a completed search row, keeps a retrieve row", () => {
    const planned: ToolCall[] = [
      { name: "retrieve", target: "CN course slides", status: "complete", duration: "63ms" },
      { name: "search", target: "CN textbook", status: "complete", duration: "82ms" },
    ];
    assert.deepEqual(withoutFabricatedSearch(planned), [planned[0]]);
  });

  test("keeps a simulated search error verbatim", () => {
    const planned: ToolCall[] = [
      { name: "search", target: "CN textbook", status: "error", duration: "", errorMessage: "Search timed out after 8s" },
    ];
    assert.deepEqual(withoutFabricatedSearch(planned), planned);
  });

  test("leaves a plan with no search row alone", () => {
    const planned: ToolCall[] = [
      { name: "retrieve", target: "CN course slides", status: "complete", duration: "38ms" },
    ];
    assert.deepEqual(withoutFabricatedSearch(planned), planned);
  });
});

describe("retrievalToastForFailure (T7: one toast beside the composer copy)", () => {
  test("422 toasts the envelope copy with a stable per-question ID", () => {
    const spec = retrievalToastForFailure(
      new ApiError(422, { code: "VALIDATION_ERROR", message: "Query too short." }, "Unprocessable"),
      "hi",
    );
    assert.equal(spec?.body, "Query too short.");
    assert.match(spec?.uniqueID ?? "", /^retrieval-search:422:/);
    assert.ok((spec?.uniqueID ?? "").includes("hi"));
  });

  test("429 toasts the envelope copy with a stable per-question ID", () => {
    const spec = retrievalToastForFailure(
      new ApiError(429, { code: "RATE_LIMITED", message: "Slow down a little" }, "Too Many Requests"),
      "what is mitochondria",
    );
    assert.equal(spec?.body, "Slow down a little");
    assert.match(spec?.uniqueID ?? "", /^retrieval-search:429:/);
  });

  test("same question retries share the ID (vendor ignore = one-toast-max)", () => {
    const err = new ApiError(429, { code: "RATE_LIMITED", message: "Slow down" }, "Too Many Requests");
    const first = retrievalToastForFailure(err, "same question");
    const second = retrievalToastForFailure(err, "same question");
    assert.equal(first?.uniqueID, second?.uniqueID);
  });

  test("a new question is a new episode (fresh toast)", () => {
    const err = new ApiError(429, { code: "RATE_LIMITED", message: "Slow down" }, "Too Many Requests");
    const first = retrievalToastForFailure(err, "question one");
    const second = retrievalToastForFailure(err, "question two");
    assert.notEqual(first?.uniqueID, second?.uniqueID);
  });

  test("502/503 never toast (the bar IS the notice)", () => {
    assert.equal(
      retrievalToastForFailure(
        new ApiError(502, { code: "EMBED_UNREACHABLE", message: "down" }, "Bad Gateway"),
        "q",
      ),
      null,
    );
    assert.equal(
      retrievalToastForFailure(
        new ApiError(503, { code: "EMBED_MISCONFIGURED", message: "no creds" }, "Unavailable"),
        "q",
      ),
      null,
    );
  });

  test("401 and network failures never toast", () => {
    assert.equal(
      retrievalToastForFailure(new AuthRequiredError({ code: "AUTH_REQUIRED", message: "sign in" }), "q"),
      null,
    );
    assert.equal(retrievalToastForFailure(new TypeError("Failed to fetch"), "q"), null);
  });
});

describe("sourcesBannerDescription (citations verbosity, no shape change)", () => {
  test("always-lists-everything in verbose mode", () => {
    const labels = ["a p.1", "b p.2", "c 1:00", "d p.4", "e p.5"];
    assert.equal(sourcesBannerDescription(labels, true), labels.join(" · "));
  });

  test("compacts past three labels when not verbose", () => {
    assert.equal(
      sourcesBannerDescription(["a p.1", "b p.2", "c 1:00", "d p.4"], false),
      "a p.1 · b p.2 · c 1:00 · +1 more",
    );
  });

  test("three or fewer labels render in full either way", () => {
    const labels = ["a p.1", "b p.2", "c 1:00"];
    assert.equal(sourcesBannerDescription(labels, false), labels.join(" · "));
    assert.equal(sourcesBannerDescription(labels, true), labels.join(" · "));
  });
});
