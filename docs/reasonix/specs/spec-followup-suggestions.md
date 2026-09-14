# SPEC: Follow-up suggestions — global default only

Status: **Implemented** (global persist + pill gate + pill-anchor timing, tests in
`setting-followups.test.ts`). Supersedes the earlier global+per-chat design: the
per-chat override was removed — the thread's "..." menu carries no suggestions
item. The profile switch below is the single control.
Rule: UI uses existing Astryx components only; no dialog redesign (`AGENTS.md` holds).

## 1. Goal

The profile toggle (`profile.followUps`) is real: suggestion pills render iff the
global is on. One switch, every chat — no per-chat compartments.

## 2. Scope model

Global default only. No per-chat tier, no per-subject tier.

## 3. UI (Astryx only, existing patterns)

- ProfileDialog → Assistant → Follow-ups: unchanged row (Switch). It is the default
  and the only control.
- Thread "..." (Conversation actions) menu: Copy transcript only — no suggestions item.
- No new dialog, no new component, no layout change.

## 4. Data model

- Global: existing `profile.followUps` (boolean), persisted via `PATCH
  /profiles/me` (`ProfilePatch.followUps` validated).
- Pill anchor (pure, unit-testable): `latestFollowUps(blocks)` — the latest
  assistant turn's suggestions, suppressed while a newer user message awaits its
  response (pills show only after the response is done). System dividers skipped;
  suggestion-less rows (e.g. error turns) skipped.
- Resolution at render: pills iff `getProfile().followUps` is true (reactive via
  the existing session subscription — flipping the switch repaints open chats).

## 5. Behavior rules

- Render gate only: the server keeps sending suggestions; the client decides display.
- Guest path: memory-only, zero fetches (same rule as every Phase-1–4 path).
- No change to how suggestions are generated. Future backend shaping (fewer/better
  suggestions) composes: it changes payload quality, this spec owns visibility.

## 6. Acceptance criteria

- Global off → no pills in any chat (regression test, stubbed, `chat-backing` style).
- Sent prompt hides stale pills until its response lands (anchor test).
- Guest toggling costs zero fetches.

## 7. Out of scope

Suggestion content/quality, quiz behavior, per-chat/per-subject tiers, server
persistence of overrides.
