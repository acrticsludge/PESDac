# SPEC: Study context — exam month + weekly goal, global + per-subject compartments

Status: **proposed, not implemented.** No code touched.
Rule: UI uses existing Astryx components only; no dialog redesign (`AGENTS.md` holds).
Note: no tracker/streak/countdown surface exists yet. This spec covers **persistence +
scoping**; the surfaces consume the resolved values later.

## 1. Goal

`examMonth` (free text) and `weeklyGoal` (`3/5/7 days`) are stored locally and affect
nothing. Persist them server-side, and compartmentalize the one that varies by
situation: exams land on different dates per subject (CN in December, Math in
January), while a weekly goal is person-level.

## 2. Scope model

- `examMonth`: `per-subject override > global default > ""`. A subject without its
  own date inherits the global one.
- `weeklyGoal`: global only. Days-per-week is a property of the person, not the
  subject — no override tiers, by design (adding tiers later needs no contract
  change if a reason appears).

## 3. UI (Astryx only, existing patterns)

- ProfileDialog → Study rows unchanged (`TextInput` for exam month, `SegmentedControl`
  for weekly goal) — they become persisted globals via `PATCH /profiles/me`
  (columns + validators exist).
- Per-subject exam date: one "Exam date" `TextInput` row in the per-subject settings
  surface (same `SettingsRow` pattern), plus "Use default" reset. No new components.

## 4. Data model

- Global: existing columns (`exam_month`, `weekly_goal`) — persist now.
- Per-subject exam dates ride the same future `profiles.scope_overrides` column:
  `{ subjects: { CN: { examMonth: "December 2026" } } }`. Memory-map first
  (identity-scoped), server sync with the same migration as quiz/citation overrides.
- Resolution: `resolveExamMonth(subject)`, `resolveWeeklyGoal()` (trivially global),
  pure and unit-testable. Future countdown/streak surfaces read these — never raw
  fields.

## 5. Behavior rules

- Free-text month stays free-text (120-char server cap exists); a date-picker is a
  later UI decision, not a contract change.
- Guests: memory-only. Subject overrides die with nothing (subjects aren't
  deletable); chat scope does not apply.

## 6. Acceptance criteria

- Global exam month + weekly goal survive logout/login (PATCH round-trip test).
- Per-subject date resolves only for that subject; others inherit global; reset
  restores inheritance.
- No consumer changes (no countdown exists — assertion is no-op-safety).

## 7. Out of scope

Countdown/progress/streak surfaces, date-picker UI, goal enforcement or reminders.
