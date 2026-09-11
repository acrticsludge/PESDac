# SPEC: Customizable quizzes — global defaults + per-subject / per-chat compartments

Status: **proposed, not implemented.** No code touched.
Rule: UI uses existing Astryx components only; no dialog redesign (`AGENTS.md` holds).
Note: no quiz engine exists yet. This spec covers **configuration + contract** (what the
user customizes, where it lives, how it resolves). Question generation/delivery is a
later engine spec that consumes this contract unchanged.

## 1. Goal

Quizzes must be customizable per situation: any chat of any subject can define its own
quiz behavior — question format (single-answer vs multiple-answer), option count
(2–6, not fixed at 3), difficulty, question count, and whether quizzes are offered
proactively — while the profile holds sane global defaults.

## 2. Scope model (precedence)

`per-chat override > per-subject override > global default > built-in default`.
Example: global = medium / single / 4 options; CN subject = hard; tonight's CN thread =
multi-answer, 6 options, 5 questions. Resolution is a pure function
`resolveQuizConfig({ subject, chatCode })`, unit-testable, no fetch.

## 3. QuizConfig shape (frozen by this spec; the engine consumes it verbatim)

```ts
type QuizConfig = {
  format: "single" | "multi";   // one correct answer vs several
  optionCount: 2 | 3 | 4 | 5 | 6;
  difficulty: "easy" | "medium" | "hard";
  questionCount: 1 | 3 | 5 | 10;
  proactive: boolean;           // offer a quiz after finishing an explanation
};
```

Built-in default: `{ single, 4, medium, 5, proactive: <existing profile.proactiveQuiz> }`.
`difficulty` and `proactive` reuse the existing profile fields (same values, same
backend enums) — this spec adds `format`, `optionCount`, `questionCount` as the new
customizable axes from your example.

## 4. Data model

- Global: existing profile columns (`difficulty`, `proactive_quiz`). Persist via
  `PATCH /profiles/me` (contract already exists + validated).
- Subject + chat overrides: new `profiles.scope_overrides` JSONB column (one future
  migration), shaped `{ subjects: Record<SubjectCode, Partial<QuizConfig>>,
  chats: Record<ServerChatCode, Partial<QuizConfig>> }`. Partial = unset keys inherit
  downward. Stale chat keys pruned on chat delete (same hook that drops overlays).
- Frontend first: overrides live in the memory store (identity-scoped, cleared on
  transition, same pattern as `messageStates`); server sync of `scope_overrides`
  follows without changing the resolution function. The same column later carries
  other per-scope settings (verbosity, citations) — one column, many settings.

## 5. UI (Astryx only, existing patterns)

- ProfileDialog → Study → Quiz difficulty: unchanged (global default). Proactive
  quizzes Switch (Assistant tab): unchanged (global default).
- New "Quiz format" rows using the existing components: `SegmentedControl` for
  Single/Multi; `Selector` for option count (2–6) and question count (1/3/5/10).
  Same rows render in two places: ProfileDialog (global) and a per-chat "Quiz
  settings" panel (chat scope) plus an equivalent per-subject panel (subject scope),
  each with a "Use default" reset that deletes the override. Panels reuse
  `SettingsCard`/`SettingsRow` inside the existing menu/dialog surfaces — no new
  chrome.
- Engine trigger UI (e.g. "Quiz me" button, proactive offer pill) belongs to the
  engine spec, not this one — but it reads `resolveQuizConfig`, never raw fields.

## 6. Behavior rules

- Overrides are config-only: setting them never generates a question, costs zero
  fetches, and works for guests (memory-only).
- Validation mirrored both ends: `optionCount` int 2–6, `format`/`difficulty` from
  the existing enum tuples; server rejects unknown values (422, existing pattern).
- Deleting a chat deletes its override. Logging out clears all overrides from memory.

## 7. Acceptance criteria

- Resolve-table test: every combination of unset/set across the three tiers returns
  the nearest set value (pure-function tests, no fetch).
- Setting per-chat multi/6-options while global stays single/4: resolved config
  differs only in that chat; deleting the override restores inheritance.
- Guest config changes cost zero fetches; identity transition clears overrides.
- `PATCH /profiles/me` round-trips global difficulty + proactive flag (existing
  contract test extended, not rewritten).

## 8. Out of scope

Question generation, delivery UI, scoring/streaks, override sync to server (reserved:
`scope_overrides` column), per-question adaptivity.
