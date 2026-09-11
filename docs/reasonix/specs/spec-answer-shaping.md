# SPEC: Answer shaping — verbosity + citations, global defaults + per-chat override

Status: **proposed, not implemented.** No code touched.
Rule: UI uses existing Astryx components only; no dialog redesign (`AGENTS.md` holds).
Note: no AI send-path integration exists yet (`depth` is the only shaping field the
send path reads). This spec covers **persistence + scoping**; the backend/AI phase
binds the resolved values into the request.

## 1. Goal

Verbosity (`concise / balanced / thorough`) and citations (`always / on request`) are
stored but affect nothing. Persist them server-side now (roaming), and make them
compartmental: any chat can override shaping for its situation (e.g. this thread:
thorough + always cite for exam revision; default elsewhere).

## 2. Scope model (precedence)

`per-chat override > global default > built-in default`
(`balanced`, `on request` — today's defaults, unchanged).
No per-subject tier in v1: shaping is a thread-situation concern like suggestions.
The model reserves the tier (same `scope_overrides` shape as the quiz spec) if a
subject-level need appears — no contract change required.

## 3. UI (Astryx only, existing patterns)

- ProfileDialog → Assistant rows unchanged (`SegmentedControl`s) — they become
  global defaults and start persisting via `PATCH /profiles/me` (contract exists +
  validated; same `saveIdentity` shape as campus/semester/branch).
- Per-chat: one "Answer style" menu entry in the thread's existing menu surface
  opening a small panel built from `SettingsCard`/`SettingsRow` + the same two
  `SegmentedControl`s, plus "Use default" reset. No new components.

## 4. Data model

- Global: existing profile columns (`verbosity`, `citations`) — persist now.
- Per-chat: memory-map overrides (identity-scoped, cleared on transition), migrating
  later into `profiles.scope_overrides.chats` under keys like
  `{ verbosity, citations }` — same column as quiz overrides, one migration total.
- Resolution: `resolveAnswerStyle({ chatCode }): { verbosity, citations }`, pure and
  unit-testable. The send path (backend phase) reads this — never raw profile fields
  — so scoping works the moment binding lands, with zero rework.

## 5. Behavior rules

- Setting an override changes no current behavior (nothing consumes these fields
  today except future binding) — safe to ship persistence + UI first.
- Server-validated enums; 422 surfaces as the existing toast pattern.
- Guests: memory-only. Deleting a chat deletes its override.

## 6. Acceptance criteria

- Changing global verbosity persists across login (PATCH round-trip test).
- Per-chat override resolves only in that chat; reset restores inheritance.
- Zero behavior change to current answers (no consumer yet — assertion is
  no-op-safety: suite stays green, send path untouched).

## 7. Out of scope

Send-path/AI binding (backend phase), per-subject tier (reserved, not built),
citation rendering UI.
