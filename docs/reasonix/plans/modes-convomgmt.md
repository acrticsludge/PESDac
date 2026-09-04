# Plan: Modes + follow-ups & conversation management

Status: Implemented. Specs: `docs/reasonix/specs/modes-followups.md`, `docs/reasonix/specs/convo-mgmt.md`.

## Order (incremental, build after each)
1. `lib/responder.ts`: add `mode` param + quiz branch + `followUps`.
   Types: `PlannedTurn { toolCalls, answer, followUps }`.
2. `content/threads/types.ts`: `AssistantBlock.followUps?: string[]`.
3. `ThreadView`: pass `composerMode` in `handleSend` + autoSend;
   persist `followUps` in `finalizeTurn`; chips row above composer
   (idle only, from last assistant block with follow-ups).
4. `lib/session.ts`: `renameCustomChat`, `deleteCustomChat`.
5. `Pesdac.tsx`: `ConversationItem` optional `onRename`/`onDelete`;
   customs wire both; rename `Dialog` + `TextInput`; delete exits open
   draft; search toggle + per-workspace filtering.
6. Verify: `tsc --noEmit` (mandatory) → build → preview flows →
   review diff.

## Touchpoints
- `frontend/src/lib/responder.ts`, `frontend/src/lib/session.ts`
- `frontend/src/content/threads/types.ts`
- `frontend/src/components/chat/ThreadView.tsx`
- `frontend/src/components/Pesdac.tsx`

## Risks
- Astryx prop drift → re-read `.d.ts` before use (done: TextInput,
  MoreMenu, Dialog pattern already in codebase).
- Build-green/type-broken → `tsc --noEmit` gates every step.
