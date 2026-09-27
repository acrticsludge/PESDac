# Todo: Retrieval frontend display (F1–F3)

Source: `docs/reasonix/plans/retrieval-f1-display-plan.md` (spec:
`docs/reasonix/specs/retrieval-frontend-display.md`).
Commands run from `frontend/` unless noted. Branch:
`feat/retrieval-f1-display`.

## Phase 0 — Pure modules
- [x] T1 — dismissal store + copy selection (`lib/retrieval-banner.ts`, units)
- [ ] Checkpoint: focused units green, frontend + docs only in `git status`

## Phase 1 — Bar + dot
- [x] T2 — RetrievalBanner component (Astryx only, role mapping)
- [x] T3 — Pesdac wiring (AppShell slot + health dot on existing cadence)
- [x] Checkpoint: units + targeted e2e green, no theme/global-CSS diff

## Phase 2 — Thread states (wiring deferred per user call)
- [x] T4 — evidence data layer (types, search client, mapper, units)
- [ ] T5 — ThreadView wiring later: fetch + results render + loading / empty / error states (skeleton, pills, bar+retry, 429)
- [ ] Checkpoint: units + targeted e2e green, frontend-only diff

## Phase 3 — Coverage + leftovers
- [ ] T6 — e2e section-n spec (full §4.1 matrix, mocked, zero sleeps)
- [ ] T7 — toasts + citations leftovers (reuse only)
- [ ] Checkpoint: complete — full units + build + e2e green, spec §8 ticked, ready for review, no merge yet

## Standing rules (every task)
- RED first (must fail), GREEN minimal, REFACTOR only while green
- Focused units: `node --test --experimental-transform-types tests/<name>.test.ts` · Full units: `npm test` · Build at checkpoints · E2E once per checkpoint
- `git diff --check` before every commit; no backend files in `git status`
- State, not interactions · DAMP tests · real impls over mocks (mock only at the network seam)
- Zero new sleeps · Astryx only · no theme/global-CSS edits · no frontend redesign
