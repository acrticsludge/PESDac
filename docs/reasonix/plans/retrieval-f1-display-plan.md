# Implementation Plan: Retrieval frontend display (F1–F3)

## Overview

Bind the display contract from
`docs/reasonix/specs/retrieval-frontend-display.md` (§1–§8) on branch
`feat/retrieval-f1-display`: downtime bar, ThreadView search states,
health dot, dismissal policy — Astryx only, no redesign, no theme or
global-CSS diff. Backend is done and untouched (P1 API mocked at the
network seam in tests; a seeded P1 backend is needed only for the
final manual pass). Every task is TDD RED→GREEN→REFACTOR and leaves
the suite green.

## Architecture Decisions

- **Pure logic before UI**: dismissal store + copy selection land as
  tested modules first; components bind them after.
- **No new data layer**: reuse the existing sidebar polling cadence
  for health, the existing toast/composer-status bridges, the
  existing skeleton idiom. New timer/transport code is a review
  failure.
- **E2E mocks at the network seam** (`/retrieval/*` fixtures) —
  never a live backend in the suite.
- **ThreadView split in two**: results path first (normal path,
  highest value), states second (loading/empty/errors). One file,
  sequential tasks, green between them.

## Task List

### Phase 0: Pure modules (no UI)

- [ ] **T1 — dismissal store + copy selection (S)**
  RED: `tests/retrieval-banner.test.ts` importing
  `lib/retrieval-banner.ts` that doesn't exist. GREEN: dismissal
  read/write (key `pesdac:retrieval-banner`, per-class keys, 1 h
  quiet window, flap detection), copy fallback (envelope message
  preferred, title fallback), unit-tested pure functions.
  Verify (from `frontend/`): `node --test
  --experimental-transform-types tests/retrieval-banner.test.ts`.
  Deps: none. Files: `src/lib/retrieval-banner.ts`,
  `tests/retrieval-banner.test.ts`.

### Checkpoint: Modules
- [ ] Focused units green; `git status` shows frontend + docs only.

### Phase 1: Bar + dot

- [ ] **T2 — RetrievalBanner component (S)**
  RED: e2e/unit asserting the bar from §4.2 props (status/container,
  `role="alert"` on error / `role="status"` on warning, dismiss +
  Retry). GREEN: `components/retrieval/RetrievalBanner.tsx` with
  Astryx `Banner` + `Button` only, wired to the T1 store.
  Verify: unit file + targeted e2e run. Deps: T1.
  Files: `src/components/retrieval/RetrievalBanner.tsx`.
- [ ] **T3 — Pesdac wiring: banner slot + health dot (M)**
  RED: e2e asserting bar mount in the `AppShell` slot on forced 502
  and dot on the Settings row on degraded health (mocked).
  GREEN: slot wiring (`Pesdac.tsx`, confirm vendor banner-slot prop
  on 0.5.2), `StatusDot` mirror of `showKeyDot`, health poll on the
  existing cadence, tooltip (last-check + provider + Retry) → Settings.
  Verify: targeted e2e run. Deps: T2.
  Files: `src/components/Pesdac.tsx`.

### Checkpoint: Chrome
- [ ] Units green; targeted e2e green; no theme/global-CSS diff
  (`git diff --stat` shows no `src/theme/`, no `src/styles/`).

### Phase 2: Thread states

- [ ] **T4 — results path (M)**
  RED: e2e with seeded bundle fixture asserting bubbles +
  collapsible sources `Banner container="card" status="info"`
  (default ON, honors `citations` setting) + "Open at mm:ss"
  video button (`mp4#t=` seek, tooltip = segment text) +
  crop `alt`/Lightbox/full-page link. GREEN: `ThreadView.tsx`
  results binding, existing parts only.
  Verify: targeted e2e run. Deps: none (parallelizable with T2/T3).
  Files: `src/components/chat/ThreadView.tsx`.
- [ ] **T5 — loading / empty / error states (M)**
  RED: e2e per state — running chip + skeleton after ~800 ms
  (stubbed timers); empty assistant message + 3 action pills, no
  banner; 502/503 bar + composer status + Retry replays search
  without duplicating the user message; 429 composer status only,
  never the bar; focus stays in composer on bar mount.
  GREEN: `ThreadView.tsx` state bindings on existing idioms.
  Verify: targeted e2e run. Deps: T4.
  Files: `src/components/chat/ThreadView.tsx`.

### Checkpoint: Thread
- [ ] Units + targeted e2e green; `git status` frontend-only.

### Phase 3: Coverage + leftovers

- [ ] **T6 — e2e section-n spec (M)**
  RED: spec file exists and fails (no coverage yet). GREEN: full
  §4.1 matrix in `e2e/section-n-retrieval-display.spec.ts`
  (one case per row + dismissal re-show with stubbed clock +
  a11y assertions), all mocked, zero new sleeps.
  Verify: `playwright test section-n` (slow — once, not per task).
  Deps: T2–T5.
- [ ] **T7 — toasts + citations leftovers (XS)**
  422 inline copy + one `AppToasts` toast; 429 one-toast-max;
  sources banner reads `sections.tsx` citations (no shape change).
  Reuse first — new toast plumbing is a review failure.
  Verify: targeted e2e run. Deps: T4, T5.

### Checkpoint: Complete
- [ ] Full unit suite + build green; e2e section green; spec §8
  boxes ticked; ready for review (no merge until human approves).

## Risks and Mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| Vendor banner-slot prop differs on 0.5.2 | Med | T3 verifies prop against installed `@astryxdesign/core` first; never guess |
| ThreadView is a large file | Med | Split T4/T5, green between; no unrelated cleanups inside it |
| E2E suite is slow | Low | Targeted spec runs per task; full e2e at checkpoints only; zero new sleeps |
| Scope creep into admin panel/completions | Med | Branch rule + §7 file list; new surfaces become a new spec, not a task edit |
| P1 backend unmerged | Low | Tests mock the seam; manual pass needs seeded P1 (pushed branch) running |

## Open Questions
- None blocking. Watch item: exact vendor banner-slot prop name (resolved in T3, not assumed here).

## Parallelization
- Sequential: T1→T2→T3, T4→T5, then T6→T7. T4 parallelizable with
  T2/T3 once T1 lands (different files). No parallel agents on
  `ThreadView.tsx`.
