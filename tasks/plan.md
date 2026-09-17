# Implementation Plan: Section C findings (B19–B23)

## Overview

Three vertical slices, each leaving the suite green: (1) pure validation policy + unit tests, (2) wire policy into both composers with rejection copy, (3) attachment-only send + dropzone, then e2e pin updates. B22/B23 are document-only. Risk-first: the policy constants decide every later assertion, so they land first and are frozen after Slice 1.

## Architecture Decisions

- **Denylist v1, not allowlist:** block executables (`.exe/.bat/.cmd/.com/.scr/.msi/.ps1/.sh` + matching mimes) + `>10 MB` + `0-byte` + `>10 files`. Everything else stages. Rationale: allowlist would break honest `.bin`/`.txt`/image flows pinned by I9e/I9f/I15/I16; server MIME-sniffing owns the real allowlist later.
- **Pure `validateFiles(files, existingCount)`** in `lib/attachments.ts`; `stageFiles` signature preserved; `stageIntoDrawer` callers apply validation then toast once via existing `notify` bridge. No new UI components.
- **Attachment-only = allowed:** `handleSend`/`handleWelcomeSend` gate becomes `if ((!text && staged.length === 0) || live) return`; empty-text user block carries `bubbles: []` + attachments (render path already supports it); welcome title falls back to first attachment name / "Shared files".
- **Dropzone = thin wrapper div** (`onDragOver: preventDefault` + `onDrop: stageIntoDrawer(files)`) around each `ChatComposer`. Vendor `ChatComposerInput` untouched.

## Task List

### Phase 1: Policy foundation (risk-first)

- [ ] Task 1: `validateFiles` + constants + `rejectionCopy` in `attachments.ts` (pure, typesafe) + `frontend/tests/attachments-policy.test.ts` (TDD RED→GREEN).
- [ ] Task 2: wire into `stageIntoDrawer` (ThreadView + Pesdac) with single-toast rejection copy via `notify`/`notifyChat`.

### Checkpoint: Foundation

- [ ] `tsc --noEmit` clean; unit suite green; existing e2e untouched (may show new rejections — expected, fixed in Phase 2).

### Phase 2: Composer behaviors

- [ ] Task 3: B21 attachment-only send (both composers + empty-bubble-safe `appendAndStream`/welcome path + title fallback).
- [ ] Task 4: B20 dropzone wrappers (both composers, additive divs, no Astryx changes).

### Checkpoint: Behaviors

- [ ] Manual-ish verify via targeted e2e runs (I11, I10) before bulk pin updates.

### Phase 3: Pins + docs

- [ ] Task 5: update section-c pins (I9a/I9b/I9c/I14 reject-with-copy; I16 trio stages; I11 posts; I10 drop stages) + header D17/D18/D19 rewrite; B22/B23 documented deferred.
- [ ] Task 6: full `section-c.spec.ts` green + `tsc` + unit + audit follow-up note.

### Checkpoint: Complete

- [ ] All spec success criteria met; diff ≤ 5 app files; ready for review.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| New caps turn 4 green pins red by design (I9a/b/c, I14) | Med | Update pins in same run to new contract; I16 trio stays green as boundary proof |
| Empty-text block breaks edit/retry/transcript helpers | Med | `bubbles: []` + attachments; verify `userBlockText`/`lastUserText` empty-safe; e2e I11 covers |
| Toast spam on multi-reject staging | Low | One aggregated toast per staging action; existing repeat-dedupe policy |
| E2E timeout flake (T26/O6: multi-stream, ~4s/turn) | Med | Single-worker, run section-c alone; completion-based waits already in spec |
| Vendor `onDrop` appears in later Astryx | Low | Wrapper div is additive; vendor path would just also fire (idempotent stage) |

## Open Questions

- Confirm v1 numbers (10 MB / 10 files / exe-denylist) vs stricter allowlist.
- Picker `accept` hint now or later (plan: later).

## Parallelization

- Tasks 1→2→3→4→5→6 are sequential (shared policy + shared composers). No parallel agents on app code; e2e verification runs single-worker.
