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
  RETRIEVAL_EMPTY_MESSAGE,
  RETRIEVAL_EMPTY_PILLS,
} from "../src/lib/retrieval.ts";
import type { RetrievalEvidenceItem } from "../src/content/threads/types.ts";

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
