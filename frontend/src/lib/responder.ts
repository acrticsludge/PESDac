// Deterministic demo responder (mockup stage). Produces a study-assistant
// turn shape without a backend. Later replaced by POST /api/.../messages
// (SSE) with identical output shape. No randomness: same input → same turn.

import type { ToolCall } from "../content/threads/types";
import {
  parseReferenceIds,
  stripReferenceTokens,
  sourceTarget,
} from "./references";

export type ResponseMode = "ask" | "deep";

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
  mode: ResponseMode = "ask",
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

Reply with your answers and I will check them step by step.`,
      followUps: [
        "Show me the answers",
        "Ask harder questions",
        "Quiz me on something else",
      ],
    };
  }

  if (mode === "deep") {
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
      answer: `### Working through it

**Your question:** ${short}

Here is how I would attack this in ${subject}:

1. **Recall** — pull the definitions this question depends on, exactly as
   your slides state them. Quote them before reasoning further.
2. **Apply** — work the question step by step, checking each step against
   those definitions instead of jumping to the answer.
3. **Check** — verify units, edge cases, and the "what would break this?"
   test. If a step feels shaky, that is where the marks hide.

Ask a follow-up on any step, or say **"quiz me"** and I will test you on it.`,
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
    answer: `**Short answer:** ${short} comes down to the core ${subject} definition in your slides — nail that first, then apply it directly.

**Why:** most marks are lost jumping to steps before quoting the definition. State it, then work forward from it.

Want the full walkthrough? Switch to **Deep Study**, or say **"quiz me"**.`,
    followUps: [
      "Walk me through it step by step",
      "Give me a worked example",
      "Quiz me on this",
    ],
  };
}
