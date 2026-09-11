# SPEC: Follow-up suggestions — global default + per-chat override

Status: **proposed, not implemented.** No code touched.
Rule: UI uses existing Astryx components only; no dialog redesign (`AGENTS.md` holds).

## 1. Goal

The existing profile toggle (`profile.followUps`) is stored but never read — suggestion
pills render unconditionally. Make it real, and compartmental: a global default plus a
per-chat override, so any chat of any subject can show or hide suggestions for its own
situation (e.g. suggestions on for a revision thread, off for a timed drill).

## 2. Scope model (precedence)

`per-chat override > global default`. No per-subject tier: suggestion display is a
thread-situation concern, not a subject trait. Unset override = inherit global.

## 3. UI (Astryx only, existing patterns)

- ProfileDialog → Assistant → Follow-ups: unchanged row (Switch). It becomes the default.
- Per-chat: a "Suggestions" toggle row inside the thread's existing menu surface
  (`MoreMenu`/`DropdownMenu` pattern already used for chat rows), labeled
  "Follow-up suggestions — this chat", states On / Off / Use default (three-state;
  `SegmentedControl` with three items, same component as the depth row).
- No new dialog, no new component, no layout change.

## 4. Data model

- Global: existing `profile.followUps` (boolean). Wire persistence via `PATCH
  /profiles/me` (`ProfilePatch.followUps` already exists and is validated).
- Per-chat: in-memory map `chatId → boolean | undefined`, same module-level-Map
  pattern as `messageStates` in `session.ts` (identity-scoped: cleared by
  `resetChatStoreForIdentity`). Server sync later: key override rows by server chat
  code inside the future `scope_overrides` contract (see quiz spec §4) — no migration
  in this spec.
- Resolution helper (pure, unit-testable):
  `resolveFollowUps(chatCode): boolean` = override ?? global.

## 5. Behavior rules

- Render gate only: `ThreadView` shows pills iff `resolveFollowUps(code)` is true.
- Guest path: memory-only, zero fetches (same rule as every Phase-1–4 path).
- No change to how suggestions are generated — server keeps sending them; the client
  decides display. Future backend shaping (fewer/better suggestions) composes: it
  changes payload quality, this spec owns visibility.

## 6. Acceptance criteria

- Global off → no pills in any chat without an override; per-chat On re-enables them
  in exactly that chat (regression test, stubbed, `chat-backing` style).
- Per-chat Off suppresses pills in exactly that chat while the global stays on.
- "Use default" removes the override (map entry deleted, not stored as false).
- Guest toggling costs zero fetches. Identity transition clears overrides.

## 7. Out of scope

Suggestion content/quality, quiz behavior, per-subject tier, server persistence of
overrides (reserved for the `scope_overrides` contract).
