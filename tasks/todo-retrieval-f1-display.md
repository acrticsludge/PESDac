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
- [ ] Checkpoint: units green; e2e + global-CSS sign-off still open (review)

## Phase 2 — Thread states (wiring deferred per user call)
- [x] T4 — evidence data layer (types, search client, mapper, units)
- [x] T5 — ThreadView wiring: fetch + results render + loading / empty / error states (skeleton, pills, bar+retry, 429) — 23 units + 4-case headed browser proof (mocked seam), scratch deleted
- [ ] Checkpoint: full units (449) + build green; targeted e2e folded into T6 section-n

## Phase 3 — Coverage + leftovers
- [x] T6 — e2e section-n spec (full §4.1 matrix N1–N9 + N2b/N5b, mocked, zero sleeps) — 11/11 headed green + tool-call-row refactor + banner key fix
- [x] T7 — toasts + citations leftovers: 422 one error toast, 429 one-toast-max (vendor uniqueID+ignore), sources description helper + units; N4/N5 toast assertions green
- [x] Checkpoint: complete — full units (472) + build + e2e section (11/11) green, spec §8 ticked, ready for review, no merge yet

## Standing rules (every task)
- RED first (must fail), GREEN minimal, REFACTOR only while green
- Focused units: `node --test --experimental-transform-types tests/<name>.test.ts` · Full units: `npm test` · Build at checkpoints · E2E once per checkpoint
- `git diff --check` before every commit; no backend files in `git status`
- State, not interactions · DAMP tests · real impls over mocks (mock only at the network seam)
- Zero new sleeps · Astryx only · no theme/global-CSS edits · no frontend redesign
