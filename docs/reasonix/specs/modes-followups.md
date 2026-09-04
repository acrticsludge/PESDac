# Spec: Modes + Follow-ups (live responses)

Status: Implemented (tsc + build + HTTP verified 2026-09-04; interactive modes/chips need manual browser QA)

## Problem
`composerMode` (Ask / Deep Study) only swaps the placeholder, and the
responder's closing "quiz me / ask a follow-up" lines are dead text. The
live turn feels identical everywhere.

## Scope
- `planResponse(question, subject, mode)` branches answer shape:
  - `ask` — concise: direct answer + one-line why. Tools: `[retrieve]`.
  - `deep` — current step-by-step Recall/Apply/Check. Tools:
    `[retrieve, search]`.
  - `quiz me` (matches `/\bquiz me\b/i`, either mode) — short revision
    quiz (3 questions) referencing the question topic + subject.
- `planResponse` also returns deterministic `followUps: string[]`
  (2–3 per branch; quiz branch: answers/harder variants).
- ThreadView passes its existing `composerMode` state (footer dropdown,
  unchanged) into `handleSend` incl. the autoSend path.
- `AssistantBlock.followUps?: string[]` (new optional field); live
  `finalizeTurn` persists them. Static demo threads carry none.
- Follow-up chips: row of small buttons above the composer, shown only
  when idle (`live == null`), sourced from the last assistant block in
  `blocks` with non-empty `followUps`. Click → `handleSend(label)`.
  Uses existing `Button` (ghost/sm pattern already in file).

## Non-goals
- No real quiz grading, no backend, no changes to static demo content,
  no composer/mode-dropdown redesign.

## Verification
- `tsc --noEmit` clean (mandatory — build does not typecheck).
- `npm run build` green; preview `/new`: ask mode → short answer +
  chips; deep mode → long answer; "quiz me" → quiz; chip click sends.
