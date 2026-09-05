# Plan: My Profile page (settings-sidebar)

Spec: `docs/reasonix/specs/my-profile.md` (Approved 2026-09-06).
Skills: spec-driven-development (done) → this plan → frontend-ui-engineering,
source-driven-development, incremental-implementation during build.

## Architecture decisions

1. **View-swap route** (approved): `profile.astro` + `AppLayout
   initialView` + `Pesdac.view` state synced in the route effect. Sidebar
   never rebuilds; direct loads work via the prop.
2. **Hand-build from verified primitives, no template inject.** The
   `settings-sidebar` skeleton references `InfoRow`/`ExpandableRow`,
   which do not exist in Astryx 0.5.2 (verified via CLI), and template
   output targets Next-style `src/app`. We follow the skeleton's
   *composition* (Toolbar + heading, TabList section nav, rows edit in
   place) using primitives verified by `component --detail brief` at
   build time. (Spec §"Template handling" superseded by this — spec will
   be updated on implementation.)
3. **Storage before UI**: `pesdac-profile-v1` accessors land first so
   every section slice is verifiable end-to-end (edit → reload →
   persists).
4. **Legal Copy**: only user-approved strings (disclaimer, accuracy +
   integrity notices, "publishes at launch" badges). No invented legal
   prose.

## Phase 1 — Foundation

### Task 1: Profile storage (S)

**Description:** `PROFILE_KEY = "pesdac-profile-v1"`, `Profile` type
(identity: displayName/email/institution/semester/branch all blank
default; study: subjects[], examMonth, weeklyGoal, difficulty; assistant:
depth, verbosity, proactiveQuiz, followUps, citations; privacy:
retention), `DEFAULT_PROFILE`, `getProfile`/`updateProfile` via existing
readJSON/writeJSON/emit. Follows customs/feedback key patterns.

**Acceptance:** [ ] accessors persist + merge partial updates [ ] SSR-safe
(they are — readJSON guards window)
**Verify:** tsc clean. **Deps:** none. **Files:** `src/lib/session.ts`.

### Task 2: Route + shell view state (S)

**Description:** `profile.astro` (new.astro chrome → 28 pages);
`AppLayout` accepts `initialView?: "chat" | "profile"`; `Pesdac` gains
`view` state initialized + re-synced in the route effect; My Profile
item → `navigate("/profile")` + chat view; New chat / conversation /
logo clicks reset to chat. Chat content renders only in chat view;
profile pane renders in profile view (empty placeholder div — filled in
Phase 2).

**Acceptance:** [ ] `/profile` direct-loads with sidebar [ ] in-app
switches don't rebuild sidebar [ ] back-navigation restores chat view
**Verify:** tsc + build (28 pages). **Deps:** none (parallel-safe with
T1). **Files:** `profile.astro`, `AppLayout.tsx`, `Pesdac.tsx`.

### Checkpoint 1

- [ ] tsc + build clean, `/profile` + `/new` both render, shell persists.

## Phase 2 — Sections

### Task 3: ProfileView shell + Identity (M)

**Description:** `components/profile/ProfileView.tsx`: Toolbar + "My
Profile" heading, `TabList` (Profile/Study/Assistant/Privacy/Legal,
`value`+`onChange`), pane per tab. Identity tab: initials `Avatar`
(derived from display name), `TextInput` rows (name/email/institution),
`Selector` rows (semester/branch), all bound to storage slice 1.

**Acceptance:** [ ] 5 tabs switch panes [ ] edits survive reload [ ]
avatar initials update with name
**Verify:** tsc + build + manual. **Deps:** T1, T2. **Files:**
`components/profile/ProfileView.tsx`.

### Task 4: Study + Assistant sections (M)

**Description:** Study tab: subject multi-select (5 subject keys —
reuse subject constants; ToggleButtonGroup if verified, else checkboxes
via Switch rows), exam-month input, weekly-goal + difficulty Selectors.
Assistant tab: depth/verbosity/citation Selectors, proactive-quiz +
follow-ups Switches. All bound to storage; behavior-wiring explicitly
excluded.

**Acceptance:** [ ] every control persists across reload [ ] no control
alters composer behavior (v1 non-goal honored)
**Verify:** tsc + build + manual. **Deps:** T1, T3 (shell).

### Task 5: Privacy + Legal sections (M)

**Description:** Privacy: retention Selector (stored; "enforced after
backend" hint), Export (Blob download of all `pesdac-*` keys —
`downloadJSON` helper), Delete-all (existing session clear pattern +
`Dialog` confirm). Training disclaimer static notice row (approved
copy). Legal: three `Collapsible` rows with scope summary + "Publishes
at launch" `Badge`; inline accuracy + integrity notices always visible.

**Acceptance:** [ ] export downloads valid JSON [ ] delete-all clears
behind confirm [ ] disclaimer + notices visible without interaction
**Verify:** tsc + build + manual. **Deps:** T1, T3.

### Task 6: Dropdown wiring + hash tab (S)

**Description:** Composer "Study preferences" item →
`navigate("/profile#study")`; ProfileView picks initial tab from
`location.hash` on view-enter (`profile|study|assistant|privacy|legal`,
fallback profile); hash changes while in view update the tab.

**Acceptance:** [ ] dropdown jumps to Study tab [ ] direct
`/profile#privacy` opens Privacy [ ] unknown hash falls back
**Verify:** tsc + build + manual. **Deps:** T2, T3.

### Checkpoint 2

- [ ] Full acceptance-criteria pass (spec §Success Criteria 1–7).

## Phase 3 — Review & ship

### Task 7: Review, docs, report (S)

Self-review (correctness/a11y/labels, no theme edits, no removals);
update spec status + template-handling note; docs quality gate
(§36); atomic commits already per-task; final report per CLAUDE.md §38
contract with READY/NOT READY verdict.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| 0.5.2 missing a needed primitive | Med | CLI-verify each component before use; fallbacks (Collapsible for expandables, Switch rows for multi-select) |
| Hash + ClientRouter quirks | Low | Read hash imperatively on view-enter; no router state dependency |
| Export shape drift (new keys later) | Low | Enumerate `pesdac-*` by prefix scan, not a hardcoded list |
| Scope creep into composer wiring | Med | Non-goal enforced in T4 acceptance |

## Open questions

None — all four answered at approval. Remaining risk is implementation-only.
