// Quiz configuration contract (settings S2).
//
// `QuizConfig` is frozen by spec-quiz-customization §3 — the future quiz
// engine consumes it verbatim. Resolution is per-chat override >
// per-subject override > global default > built-in default, pure and
// fetch-free: `difficulty` and `proactive` reuse the existing profile fields
// (same values, same backend enums); `format` / `optionCount` /
// `questionCount` are new customizable axes with no profile column, so their
// global tier is unset and they fall through to the built-ins.
//
// Overrides are config-only and memory-only (the Step-0 kernel map,
// identity-scoped, cleared on transition); per-chat panels are v2, so this
// module ships the override API + resolver only.

import { getProfile, getScopeOverride, scopeKey } from "./session.ts";

/** One correct answer vs several. */
export type QuizFormat = "single" | "multi";

/** Reuses the existing profile difficulty enum. */
export type QuizDifficulty = "easy" | "medium" | "hard";

export type QuizOptionCount = 2 | 3 | 4 | 5 | 6;

export type QuizQuestionCount = 1 | 3 | 5 | 10;

/** Frozen by spec §3 — the engine consumes this shape verbatim. */
export type QuizConfig = {
  format: QuizFormat;
  optionCount: QuizOptionCount;
  difficulty: QuizDifficulty;
  questionCount: QuizQuestionCount;
  /** Offer a quiz after finishing an explanation. */
  proactive: boolean;
};

/**
 * Built-in default: `{ single, 4, medium, 5, proactive }`. `proactive`
 * reads the existing profile flag; the constant carries today's default
 * (`true`, mirroring DEFAULT_PROFILE) for callers with no profile access.
 */
export const BUILTIN_QUIZ_CONFIG: QuizConfig = {
  format: "single",
  optionCount: 4,
  difficulty: "medium",
  questionCount: 5,
  proactive: true,
};

// Server-mirrored validators: an override holding an unknown value (never
// written by the UI, which only offers legal options) is treated as unset
// so resolution inherits instead of surfacing garbage.

function isQuizFormat(value: unknown): value is QuizFormat {
  return value === "single" || value === "multi";
}

function isQuizDifficulty(value: unknown): value is QuizDifficulty {
  return value === "easy" || value === "medium" || value === "hard";
}

function isOptionCount(value: unknown): value is QuizOptionCount {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 2 &&
    value <= 6
  );
}

function isQuestionCount(value: unknown): value is QuizQuestionCount {
  return value === 1 || value === 3 || value === 5 || value === 10;
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/**
 * Resolve the effective quiz config. Each field independently returns the
 * nearest set value across per-chat override > per-subject override >
 * global default > built-in. `undefined` (the "Use default" path) deletes
 * an override and is identical to never-set downstream.
 */
export function resolveQuizConfig(opts?: {
  subject?: string | null;
  chatCode?: string | null;
}): QuizConfig {
  const subject = opts?.subject ?? null;
  const chatCode = opts?.chatCode ?? null;
  const chatScope = chatCode != null ? scopeKey("chat", chatCode) : null;
  const subjectScope = subject != null ? scopeKey("subject", subject) : null;
  const profile = getProfile();

  function pick<T>(
    setting: string,
    isValid: (value: unknown) => value is T,
    global: unknown,
    builtin: T,
  ): T {
    if (chatScope !== null) {
      const chat = getScopeOverride(setting, chatScope);
      if (isValid(chat)) return chat;
    }
    if (subjectScope !== null) {
      const sub = getScopeOverride(setting, subjectScope);
      if (isValid(sub)) return sub;
    }
    if (isValid(global)) return global;
    return builtin;
  }

  return {
    format: pick("format", isQuizFormat, undefined, BUILTIN_QUIZ_CONFIG.format),
    optionCount: pick(
      "optionCount",
      isOptionCount,
      undefined,
      BUILTIN_QUIZ_CONFIG.optionCount,
    ),
    difficulty: pick(
      "difficulty",
      isQuizDifficulty,
      profile.difficulty,
      BUILTIN_QUIZ_CONFIG.difficulty,
    ),
    questionCount: pick(
      "questionCount",
      isQuestionCount,
      undefined,
      BUILTIN_QUIZ_CONFIG.questionCount,
    ),
    // Frozen override name is the profile field (`proactiveQuiz`); it maps
    // onto QuizConfig.proactive.
    proactive: pick(
      "proactiveQuiz",
      isBoolean,
      profile.proactiveQuiz,
      BUILTIN_QUIZ_CONFIG.proactive,
    ),
  };
}
