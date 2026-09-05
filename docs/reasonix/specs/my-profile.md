# Spec: My Profile page (settings-dialog)

## Status: Implemented 2026-09-06 as a settings-dialog (modal over chat) — supersedes the approved view-swap; sidebar item, dropdown shortcut, hash deep-links, and blank identity seeds unchanged.

## Objective

Give the sidebar "My Profile" item a real destination: a settings-sidebar
page with five sections — Identity, Study Preference, Assistant behavior,
Privacy & data, Legal. Built from the Astryx `settings-sidebar` template,
adapted to the Astro island architecture. Mockup-honest throughout:
everything that can work client-side works; everything needing a backend
is a stored preference or a labeled placeholder, never a silent no-op.

## Tech Stack

Astro 6 static + React 19 + Astryx 0.5.2 + `PESDacMockupTheme` (unchanged).
Template source: `settings-sidebar` (components: Layout, Toolbar,
TabList/Tab, InfoRow, Switch, Selector, TextInput, ExpandableRow, Badge,
Card, Divider). No new dependencies.

## Commands

```text
Typecheck: & "C:\Program Files\nodejs\npx.cmd" --yes -p typescript tsc --noEmit   (from frontend/)
Build:     & "C:\Program Files\nodejs\npm.cmd" run build                          (from frontend/, 28 pages after)
Dev:       & "C:\Program Files\nodejs\npm.cmd" run dev
```

## Architecture (settings-dialog — user direction 2026-09-06)

## Template port (settings-dialog source, user direction 2026-09-06)

The Playground `settings-dialog` source was ported idiom-for-idiom where
0.5.2 allows it: grouped icon rail (`SideNav` + `topContent` search),
muted zero-padding cards with subtle row dividers, icon-titled rows with
a shared 192px control column, `SegmentedControl` for 2–3 named choices
(depth, verbosity, citations, goal, difficulty), `isLabelHidden`
controls (the row owns the label), panel heading + description,
`useMediaQuery` narrow shell. Deliberate deviations: `TabList` strip
instead of a custom tab row below 640px (system component); section
filter instead of the setting-level combobox + keyboard traversal
(kept small — promote if search proves inadequate); no container-query
row stacking (no stylex in our source — rows hold two columns, narrow
shell gives them full width); ghost-button rows not used — real
`SideNavItem`s. All five sections, controls, copy, and storage behavior
unchanged by the restyle.

`AppLayout` always renders `Pesdac` and is `transition:persist`ed. Profile
is a **`Dialog` modal over the chat** (settings without leaving the
conversation), following the `settings-dialog` composition (header +
searchable section nav + content pane) hand-built from verified 0.5.2
primitives — its `SettingsSideNav`/`SettingsContentPane` composites don't
exist in this version:

- `components/profile/sections.tsx`: the five storage-backed sections.
- `components/profile/ProfileDialog.tsx`: wide `Dialog` (920px,
  80dvh) with search-filtered section list + active pane.
- `Pesdac` holds `isProfileOpen` + `profileTab`; sidebar My Profile and
  the composer Settings → Study preferences shortcut call
  `openProfile(tab)` in place — no navigation, no shell churn.
- `/profile` (`profile.astro` + `AppLayout initialView`) still exists for
  direct loads and deep links (`/profile#study`): the route-sync effect
  auto-opens the dialog over the welcome view with the hashed tab.

## Sections (content contract)

### 1. Profile / Identity

Avatar (initials circle, no upload), display name, email, institution
(PESU), semester, branch. All fields editable `TextInput`/`Selector`
rows; persisted to a new `pesdac-profile-v1` key following the
`session.ts` readJSON/writeJSON/emit pattern. Seeded demo values.
Backend-gated: binding to a real auth identity (stored values are the
migration payload, same deal as customs/overlays).

### 2. Study Preference (replaces generic "study context")

*What* you study: enrolled subjects (multi-select, same 5 subject keys as
`MODE_OPTIONS`), semester exam dates (month inputs), weekly study goal
(Selector: 3 / 5 / 7 days), quiz difficulty (easy / medium / hard —
stored; consumed by future quiz generation, not wired yet). Stored in
`pesdac-profile-v1`.
Relation to the existing new-chat composer Settings → "Study
preferences" item: that item stays (no removals), and is wired to
`navigate("/profile")` with the Study tab selected — the dropdown stays
the shortcut, Profile becomes the surface. (Open Question 2.)

### 3. Assistant behavior

*How* it responds: default answer depth (Auto / Ask / Deep — mirrors
composer modes), explanation verbosity (concise / balanced / thorough),
proactive quizzes (Switch), follow-up suggestions (Switch, default on),
citation display (always / on request). Stored in `pesdac-profile-v1`.
Explicitly **not wired into the composer in v1** (non-goal below) —
switches persist and read back; behavior binding is backend-phase work.

### 4. Privacy & data

- Retention selector (forever / 1 year / 30 days / session-only): stored
  pref; enforcement is backend-gated, labeled as such inline.
- **Export my data**: works fully client-side — downloads one JSON of all
  `pesdac-*` keys (chats, overlays, drafts, votes, profile). Real button.
- **Delete all chats**: works client-side via existing session mutators
  behind an Astryx confirm dialog. Real button.
- **Third-party training disclaimer** (static notice row, no toggle per
  user direction): "Conversations may be processed or used for training
  purposes by third-party model providers such as NVIDIA. Avoid sharing
  sensitive personal information." Exact product copy, not a legal doc.
- No "don't train on my data" toggle (explicitly out, user direction).

### 5. Legal

Rows (ExpandableRow) for Terms of Use, Privacy Policy, Cookie Notice —
each expandable with a one-line scope summary and a "Full document
publishes at launch" badge (no invented legal copy). Plus two inline
static notices (product copy, always visible): AI accuracy — "PESDac can
make mistakes. Verify important answers against your course material.";
academic integrity — "Built as a study aid. Your institution's academic
integrity policy applies to submitted work."

## Project Structure

```text
frontend/src/pages/profile.astro        → route chrome (copy of new.astro pattern)
frontend/src/components/profile/        → ProfileDialog.tsx (modal shell) + sections.tsx (five sections)
frontend/src/lib/session.ts             → pesdac-profile-v1 accessors (getProfile/updateProfile)
docs/reasonix/specs/my-profile.md       → this spec
```

Template handling: hand-built from CLI-verified primitives following the
skeleton's composition (plan decision — the skeleton references `InfoRow`/
`ExpandableRow`, absent in 0.5.2, and template output targets Next-style
`src/app`). No scratch dir was created; no template code was copied.

## Code Style

Follow existing island conventions: `"use client"`, Astryx primitives
only, theme tokens only (no custom CSS, no new global selectors),
`label` on every control for a11y, `useSessionVersion()` for reactive
reads. New storage key follows the `-v1` convention.

## Testing Strategy

No test runner exists (backend-readiness audit §1.5 — still open).
Verification is manual against acceptance criteria + `tsc` + `build`:
direct-load `/profile`, sidebar round-trip without shell rebuild,
reload-persistence of every edited field, export downloads valid JSON,
delete-all clears and confirms, 360px + keyboard pass.

## Boundaries

- Always: spec approval before code; tsc + build per slice; atomic
  commits; no unprompted removals anywhere.
- Ask first: any change to existing chat UI/sidebar behavior beyond the
  specified wiring; adding a dependency; inventing legal copy.
- Never: modify `PESDacMockupTheme`; touch auth-shaped code (none
  exists); wire prefs into composer behavior (v1 non-goal); commit the
  template scratch dir.

## Non-goals (v1)

Auth, password/sessions, delete-account cascade, notifications, avatar
upload, real legal documents, composer consuming stored prefs other than
answer depth (see answer-depth spec), mobile redesign of the shell,
Playwright harness (tracked separately).

## Success Criteria

1. `/profile` loads directly (typed URL, refresh) with the dialog open
   over the sidebar-intact shell.
2. Sidebar My Profile and the composer shortcut open the dialog in place
   with no shell rebuild and no navigation.
3. All five sections render from the adapted template; every editable
   control persists across reload.
4. Export downloads JSON containing all `pesdac-*` state; Delete-all
   clears chats behind a confirm.
5. Training disclaimer + both inline notices visible without interaction.
6. Composer Settings dropdown unchanged in place; "Study preferences"
   navigates to Profile/Study (pending Q2).
7. `TSC-EXIT=0`, 28-page build, no chunk-warning regression.

## Open Questions (need answers with approval)

1. Route-as-view-swap (§Architecture) — acceptable, or do you want a
   standalone page that rebuilds the shell?
2. Wire the composer "Study preferences" item to `/profile`, or leave it
   a no-op until you say so?
3. Legal docs as "publishes at launch" badge rows — acceptable tone?
4. Seed identity values — placeholder user (e.g. "Aarav Sharma,
   PESU 4th sem CSE") or blank fields?
