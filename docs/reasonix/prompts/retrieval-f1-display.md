# Agent Handoff: Retrieval frontend display (UI-only)

Copy-paste everything below the line into your next agent session.
It is self-contained — the agent needs no prior conversation.

---

You are implementing Retrieval frontend display for the PESDac repo
(Windows, PowerShell 5.1). UI-only. No backend files, ever.

## 0. Setup (do this first, in order)

1. Repo: `C:\Anubhav\Web Dev Projects\PESDac`. Branch:
   `feat/retrieval-f1-display` — create it from the updated default
   branch (`git switch -c feat/retrieval-f1-display`); confirm with
   `git branch --show-current` and `git status --short`.
2. Read in this order (stop after each and confirm understanding):
   a. `docs/reasonix/specs/retrieval-frontend-display.md` — THE
      contract (§1–§8). It is complete and reviewed. Do not
      re-litigate its decisions; implement them.
   b. `docs/reasonix/plans/retrieval-f1-display-plan.md` — 7 tasks, T1–T7:
      store → bar → dot → results → states → e2e → leftovers.
   c. `tasks/todo-retrieval-f1-display.md` — your checkbox list.
      Work top to bottom; check boxes only for actually-done,
      verified work.
   d. The seams you will plug into (read-only first):
      `frontend/src/components/Pesdac.tsx` (AppShell mount ~:1863,
      `showKeyDot` pattern ~:545-742), `frontend/src/components/
      chat/ThreadView.tsx` (`sendError`/`handleRetry` ~:1102-1449,
      composer status ~:2032-2040, `ChatToolCalls` ~:1812/2313),
      `frontend/src/components/AppToasts.tsx`,
      `frontend/src/components/profile/sections.tsx` (citations
      ~:1091-1098), one existing `frontend/e2e/section-*.spec.ts`
      (idiom) and one `frontend/tests/*.test.ts` (unit idiom).
3. Confirm the pre-existing state (already done, do NOT redo):
   Retrieval P1 backend (ingest + search + health) is implemented,
   reviewed, and pushed on `feat/retrieval-p1-backend`. Your tests
   mock `/retrieval/*` at the network seam — you never need that
   branch checked out except for the final manual pass (seeded P1
   backend running locally).

## 1. Hard rules (violations = stop and ask)

- **Frontend-only diff.** `git status` must never show `backend/`.
  Docs under `docs/` are allowed where the plan says so.
- **The exported UI is the source of truth.** Never redesign,
  never replace Astryx components with custom HTML/CSS, never
  change spacing/typography/colors/radii/shadows/layout unless the
  spec explicitly says so. Never "improve" the design on your own.
- **Astryx 0.5.2 is mandatory.** `Banner`, `Button`, `StatusDot`,
  existing chips/bubbles/skeletons only. No new UI library, no
  Tailwind, no global CSS, no `src/theme/` edits — the
  `PESDacMockupTheme` is authoritative.
- **No secrets, ever.** Never ask for API keys. Test fixtures use
  mocked network data only.
- **Zero new sleeps** (suite discipline). Stub timers/clocks.
- **Update nothing outside `tasks/todo-retrieval-f1-display.md`
  and the §7 file list** without asking.

## 2. Method (TDD, no exceptions)

- RED first: each task starts with a failing test (unit or targeted
  e2e). A test that passes immediately proves nothing. GREEN
  minimal. REFACTOR only while green.
- Test state, not interactions. DAMP tests (readable > DRY). Mock
  only at the network seam (`/retrieval/*` fixtures); everything
  else is real components and the real store.
- One behavior per test; names read like specification.

## 3. Commands (use these exactly)

- Focused units: `node --test --experimental-transform-types
  tests/<name>.test.ts` with `workdir` = `frontend/`. Full units:
  `npm test` (checkpoints only). Build: `npm run build`
  (checkpoints only). E2E: `playwright test section-n` (slow —
  checkpoints only, never per task).
- `git diff --check` before every commit. `git diff --stat` at
  every checkpoint: `src/theme/` and `src/styles/` must be absent.
- Shell is PowerShell 5.1: no `tail`, no `&&` (use `;`),
  execution-policy blocks `npm.ps1` — prefer `node` binaries
  directly, or `-ExecutionPolicy Bypass` for `npm` scripts.
- Commit per completed task (repo style: `feat(retrieval): …`,
  `test(retrieval): …`); push at checkpoints.

## 4. Task loop (repeat per task in `tasks/todo-retrieval-f1-display.md`)

1. Read the task + its spec section. State the acceptance criteria
   back in one line.
2. RED: write the failing test(s). Run the focused command —
   confirm FAIL.
3. GREEN: minimal implementation. Run the focused command —
   confirm PASS.
4. REFACTOR if needed (tests stay green).
5. `git diff --check`; tick the todo box; commit.
6. At checkpoints: units + build + targeted e2e, then report.

## 5. Definition of done (whole phase)

- All 7 boxes ticked with green runs behind each.
- Full units + build green, e2e section green, `git status` shows
  frontend + docs only, no theme/global-CSS diff.
- Spec §8 boxes ticked, including the manual pass against a seeded
  P1 backend (skeleton on slow embed, provenance banner, video
  seek, pills on empty, bar on forced 502, dismissal + 1 h re-show).
  No merge — report ready-for-review and stop.

## 6. If stuck

- Ambiguity in the spec → re-read the cited section; anchors
  (file:line) are pinned there.
- Vendor prop doubt (e.g. the AppShell banner-slot prop) → read
  the installed `@astryxdesign/core` 0.5.2 package first; never
  guess the prop name.
- Genuine gap (spec silent + blocks progress) → stop, write the
  smallest spec amendment as a proposal, and ask the user before
  implementing around it. Do not invent contracts.
- Failing pre-existing test unrelated to your diff → stash your
  changes, reproduce on clean tree, report; do not fix drive-by.
