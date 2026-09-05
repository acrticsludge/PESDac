// Deterministic demo responder (mockup stage). Produces a study-assistant
// turn shape without a backend. Later replaced by POST /api/.../messages
// (SSE) with identical output shape. No randomness: same input → same turn.

import type { ToolCall } from "../content/threads/types";
import {
  parseReferenceIds,
  stripReferenceTokens,
  sourceTarget,
} from "./references";

export type ResponseMode = "ask" | "deep" | "auto";

export type PlannedTurn = {
  toolCalls: ToolCall[];
  answer: string;
  followUps: string[];
  /** Simulated failure (mockup stage): lets the error UI exist pre-backend.
   * Test phrases: "simulate error" (mid-stream abort), "simulate empty"
   * (empty response), "simulate limit" (rate limit). */
  error?: "stream-failed" | "rate-limited" | "empty";
};

export function planResponse(
  question: string,
  subject: string,
  mode: ResponseMode = "auto",
): PlannedTurn {
  // @ mentions scope retrieval: "@textbook ..." searches the textbook
  // first. Tokens are stripped so they never leak into echoes/titles.
  const clean = stripReferenceTokens(question) || question.trim();
  const short =
    clean.length > 140 ? clean.slice(0, 140) + "…" : clean;
  const seed = question.length;
  const refs = parseReferenceIds(question);
  const primary =
    refs.length > 0 ? sourceTarget(refs[0], subject) : `${subject} course slides`;

  if (/\bsimulate (a )?limit\b/i.test(question)) {
    return { toolCalls: [], answer: "", followUps: [], error: "rate-limited" };
  }

  if (/\bsimulate (an )?empty\b/i.test(question)) {
    return {
      toolCalls: [
        {
          name: "retrieve",
          target: primary,
          status: "complete",
          duration: "41ms",
        },
      ],
      answer: "",
      followUps: [],
      error: "empty",
    };
  }

  if (/\bsimulate (a )?tool error\b/i.test(question)) {
    return {
      toolCalls: [
        {
          name: "retrieve",
          target: primary,
          status: "complete",
          duration: "36ms",
        },
        {
          name: "search",
          target: `${subject} textbook`,
          status: "error",
          duration: "",
          errorMessage: "Search timed out after 8s",
        },
      ],
      answer: `**Short answer:** ${short} comes down to the core ${subject} definition in your slides — nail that first, then apply it directly.

**Note:** the textbook search failed this time, so this is answered from ${primary} only. Retry the question if you want both sources checked.`,
      followUps: [
        "Walk me through it step by step",
        "Give me a worked example",
        "Quiz me on this",
      ],
    };
  }

  if (/\bsimulate (an )?error\b/i.test(question)) {
    return {
      toolCalls: [
        {
          name: "retrieve",
          target: primary,
          status: "complete",
          duration: "38ms",
        },
      ],
      answer: `Here is the thing about **${short}** — the key idea is simpler than it looks. First, pin down the exact definition from your ${subject} slides. Then apply it one step at a time, checking each step before moving on. Most mistakes come from skipping that first part, so slow down there and the rest follows. If anything feels shaky, ask about that specific step and we will dig into it together.`,
      followUps: [],
      error: "stream-failed",
    };
  }

  if (/\bquiz me\b/i.test(question)) {
    return {
      toolCalls: [
        {
          name: "retrieve",
          target: primary,
          status: "complete",
          duration: `${28 + (seed % 31)}ms`,
        },
      ],
      answer: `### Quick quiz — ${subject}

1. State the key definition behind **${short}** exactly as your slides
   put it. What breaks if you drop one condition?
2. Give one worked example where it applies, and one edge case where
   it does not.
3. Explain the idea in two sentences, as if to a friend who missed
   the lecture.

Reply with your answers, then pick **Show me the answers** below to
compare step by step.`,
      followUps: [
        "Show me the answers",
        "Ask harder questions",
        "Quiz me on something else",
      ],
    };
  }

  // Auto depth (answer-depth spec): depth-cue phrasing resolves to the
  // chapter shape, everything else to the short shape. Runs after the
  // simulate-* and quiz branches, so those intents always win.
  const DEEP_RE =
    /\bstep by step\b|\bwalk me through\b|\bin detail\b|\bmore detail\b|\bin[-\s]?depth\b|\bfull chapter\b|\bwhole chapter\b|\bthis chapter\b|\bchapter analysis\b|\banalys\w*\b|\belaborate\b|\bderivation\b|\bderive\b|\bteach me\b|\bcompare and contrast\b/i;
  const depth: "ask" | "deep" =
    mode === "auto" ? (DEEP_RE.test(clean) ? "deep" : "ask") : mode;

  if (depth === "deep") {
    return {
      toolCalls: [
        {
          name: "retrieve",
          target: primary,
          status: "complete",
          duration: `${32 + (seed % 37)}ms`,
        },
        {
          name: "search",
          target: `${subject} textbook`,
          status: "complete",
          duration: `${51 + (seed % 53)}ms`,
        },
      ],
      answer: `### ${short} — chapter view

**Definitions first.** Everything below rests on the exact ${subject} slide definitions — quote them before reasoning. Examiners award the first marks here, not at the final answer.

**Full walkthrough.** Work it end to end, one step at a time, checking each step against those definitions instead of jumping ahead. When a step feels shaky, slow down: that is where the marks hide.

**Worked check.** Apply the chain to one concrete case from your slides, then flip one condition and state what breaks. If you cannot, re-read the definition.

**Don't lose marks.** Skipped definitions, jumped steps, and unflipped edge cases cause most lost marks on this topic.

Say **"quiz me"** and I will test you on it.`,
      followUps: [
        "Explain step 1 in more detail",
        "Give me a worked example",
        "Quiz me on this",
      ],
    };
  }

  return {
    toolCalls: [
      {
        name: "retrieve",
        target: primary,
        status: "complete",
        duration: `${32 + (seed % 37)}ms`,
      },
    ],
    answer: `**${short}** — one line: the exact ${subject} definition from your slides, applied directly. Quote it first and the mark is yours.

Say **"walk me through it"** for the chapter version, or **"quiz me"** to test it.`,
    followUps: [
      "Walk me through it step by step",
      "Give me a worked example",
      "Quiz me on this",
    ],
  };
}
