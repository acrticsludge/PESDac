# PESDac Design — source of truth

Regenerated 2026-09-06 by scanning the implementation. The running
UI (Playground export + `PESDacMockupTheme`) is canonical; this
document describes it so future work matches it. It replaces the
previous revision, which named a `gothic` theme and a 6-subject
sidebar — neither exists in the code.

## 1. Stack and mounting

- Astro 6 static output + React 19 islands (`client:load`) +
  Astryx 0.5.2 + StyleX + `@astryxdesign/theme-neutral`.
  No Tailwind, no other CSS framework (`frontend/package.json`).
- `src/styles/global.css` contains exactly two imports and
  nothing else:
  `@astryxdesign/core/reset.css`, `@astryxdesign/core/astryx.css`.
  No global selectors, no overrides.
- Every Astryx primitive reads its tokens from
  `<Theme theme={PESDacMockupTheme} mode="dark">`. The app shell
  mounts it in `src/components/Pesdac.tsx:862`. Standalone pages
  that never render `Pesdac` (login/signup) mount the same Theme
  inside their own layout (`src/components/auth/AuthLayout.tsx`).
  Pages without a Theme mount render unstyled Astryx — that is
  always a bug, never a style choice.
- Dark only. Pages set `html { color-scheme: dark }` and force
  `background-color: #1b1b1b`, `color: #fafafa`, Figtree stack via
  an inline `<style is:inline>` block (`src/pages/new.astro`,
  `profile.astro`, `login.astro`, `signup.astro` share the shape).
- `ClientRouter` (`astro:transitions`) on every page; the app
  shell persists across navigation via
  `transition:persist="pesdac-shell"`.
- Build baseline: single `AppLayout` island (~630 kB, ~714 kB
  with the profile dialog); `chunkSizeWarningLimit: 750` in
  `astro.config.mjs` so growth stays visible. 30 static pages.

## 2. Theme — `src/theme/PESDacMockupTheme.ts`

Exported Playground theme, `defineTheme({ name: 'PESDacMockup' })`.
Authoritative — never recreated elsewhere, never edited to fix a
component. All tokens are `light-dark()` pairs; the app runs the
dark side. Dark values:

| Token | Dark value |
|---|---|
| `--color-background-body` | `#1b1b1b` |
| `--color-background-card` / `-popover` | `#1b1b1b` |
| `--color-background-surface` | `#262626` |
| `--color-background-muted` | `#1b1b1b` |
| `--color-accent` | `#ebebeb` |
| `--color-accent-muted` | `#262626` |
| `--color-on-accent` | `#171717` |
| `--color-neutral` | `#FFFFFF1A` |
| `--color-text-primary` | `#fafafa` |
| `--color-text-secondary` | `#a3a3a3` |
| `--color-text-disabled` | `#525252` |
| `--color-text-accent` | `#ebebeb` |
| `--color-icon-primary` | `#fafafa` |
| `--color-icon-secondary` | `#a3a3a3` |
| `--color-icon-disabled` | `#525252` |
| `--color-icon-accent` | `#ebebeb` |
| `--color-border` | `#FFFFFF1A` |
| `--color-border-emphasized` | `#525252` |
| `--color-skeleton` | `#525252` |
| `--color-shadow` | `#0000004D` |
| `--color-overlay` | `#000000CC` |
| success / error / warning | `#9fe59b` / `#ffc6c1` / `#fdcf4f` (muted `…3D` fills, on-color `#171717`) |
| blue / cyan / gray / green / orange / pink / purple / red / teal / yellow | tinted `background-*` (`…3D`), matching `border-*`, `icon-*`, `text-*` |

Typography: Figtree for body and headings
(`--font-family-body`, `--font-family-heading`), monospace stack
for code. Text types used: `display-1`/`display-2` (page
headings), `large` (brand rows), `body`, `label` (settings rows),
`supporting` (descriptions, footers), `code`. `Heading level={2}`
for dialog panel titles.

Radii: `--radius-inner 0.375rem`, `--radius-element 0.625rem`,
`--radius-container 0.75rem`, `--radius-page 1.75rem`.

Shadows `low/med/high` are layered black + inner 1px white ring
in dark mode; inset selection rings for hover/selected/success/
warning/error.

Motion: `--duration-fast 125ms`, `--duration-medium 300ms`,
`--duration-slow 700ms` (with min/max steps).

Code syntax palette (`--color-syntax-*`): dark background
`#0a0a0a`, keyword/type `#efa8ff`, string `#a6d2a2`, number
`#ffb37f`, function `#a0caff`, comment `#a3a3a3`.

Component overrides in the theme (not in components):
heading/display sizes, `button variant:destructive`
(error-muted bg), `badge` info/neutral/success/warning/error +
red/orange/yellow/green/teal/cyan/blue/purple/green/pink/gray
tints, `statusdot` + `avatar-status-dot` fills,
`segmented-control` padding + item heights + no selected shadow,
`banner` per-status token remaps, `step-indicator` + `progressbar`
status fills, `switch` track color, `card`/`section` base padding
`--spacing-3`.

## 3. App shell — `src/components/Pesdac.tsx`

`AppLayout` (`src/components/layout/AppLayout.tsx`) is a thin
wrapper over `Pesdac` (`initialSubject`/`initialCode`/
`initialView`). `Pesdac` renders `<Theme>` > `AppShell`
(`contentPadding={0}`) with:

- `sideNav`: `SideNav` collapsible + resizable
  (`defaultWidth: 300, minWidth: 240, maxWidth: 420`),
  header `SideNavHeading heading="PESDac"` with `NavIcon`
  (`SparklesIcon`, `size="sm"`), footer `SideNavSection
  title="Account" isHeaderHidden` with Settings + My Profile
  (`UserCircleIcon`, opens the profile dialog, never navigates).
- Menu section (`isHeaderHidden`): New chat (`PlusIcon`,
  selected when no chat), Search conversations
  (`MagnifyingGlassIcon`, toggles a `TextInput` with `startIcon`
  + `hasClear`), Study Library (`BookOpenIcon`).
- `Divider`, then Pinned section (only when non-empty), then
  Subjects section with five collapsible `SideNavItem`
  workspaces — the subject registry, exactly these:
  CN (`GlobeAltIcon`), OS (`ComputerDesktopIcon`), DLCD
  (`CpuChipIcon`), DSA (`CircleStackIcon`), Math
  (`CalculatorIcon`). Demo threads + custom chats render as
  `ConversationItem` rows with a `MoreMenu` (pin, archive,
  rename, hide).
- Content: welcome view or `ThreadView` (keyed remount per
  thread; sidebar untouched). Unknown codes fall back to welcome.
- Global keydown bus (`lib/session.ts`): `pesdac:cancel`
  (Esc → cancel stream), `pesdac:focus-composer` (`/`).

## 4. Welcome view (`Pesdac.tsx:1079-~1250`)

`Layout height="fill" contentWidth={720}` > `LayoutContent` >
`VStack gap={8} vAlign="center"` (`minHeight: 100%`):

- Brand row: `HStack gap={2} vAlign="center"`, `Icon
  icon={SparklesIcon} size="md" color="accent"` + `Text
  type="large" as="h2"` "Welcome to PESDac".
- `Text type="display-2" as="h1"` "What are you studying today?"
  (first-name suffix when logged in).
- `ChatComposer` (`value`/`onChange`/`onSubmit`, warning
  `status` slot only for storage problems, placeholder varies by
  subject or "Ask anything about your course..."):
  `ChatComposerInput` (`minHeight: 84`, `@` reference trigger,
  file staging), `ChatComposerDrawer` ("Files" with `Thumbnail`
  previews or `Token` labels), `headerActions` (ask/explain/quiz
  mode, model/verbosity selectors), footer actions
  (attach, dictate, settings, send).
- Quick-prompt category cards below (`paddingInline:
  var(--spacing-3)`), each heading + body + prompt.

## 5. Thread view — `src/components/chat/ThreadView.tsx`

`LayoutContent padding={0}` > `ChatMessageList
(isStreaming)`:

- Day dividers: `ChatSystemMessage variant="divider"`.
- User turns: `ChatMessage sender="user"` > `ChatMessageBubble`
  + `ChatMessageMetadata`.
- Assistant turns: `ChatMessage` with `avatar={<Avatar
  name="PESDac" size="md" />}` > ghost `ChatMessageBubble
  width="100%"` > `Markdown density="compact"`; `CodeBlock` for
  code; `ChatMessageMetadata` (vote, regenerate, copy, timestamp).
- Same composer as welcome (same triggers, drawer, actions);
  `sessionKey`-scoped drafts, per-answer feedback map, edit (trunc
  + resend) and regenerate (pop + resend).

## 6. Profile dialog

`ProfileDialog.tsx`: `Dialog title="My Profile"` — settings
without leaving the conversation. Grouped icon rail
(`NAV_GROUPS`: Account → Profile; Preferences →
Study/Assistant/Shortcuts/Language; Data & legal →
Privacy/Legal) + filter `TextInput`; below 640px a search + tab
strip (`useMediaQuery("(max-width: 640px)")`). `ActivePane`:
`Heading level={2}` + `Text type="supporting"
color="secondary"` description, then the section.

`sections.tsx` row system (used by every tab):

- `SettingsCard`: title (`Text`) + `Card padding={0}
  width="100%" variant="muted"`.
- `CardRows`: `Divider variant="subtle"` between rows.
- `SettingsRow`: `Icon size="sm" color="secondary"` (required —
  keeps titles aligned) + `Text type="label"` title +
  `Text type="supporting" color="secondary"` description on the
  left; control in a fixed-width right column. Every control
  keeps `isLabelHidden` — the row owns the label.
- Controls used: `TextInput size="sm"`, `Selector`, `Switch`,
  `SegmentedControl`, `CheckboxList`, `Collapsible` /
  `CollapsibleGroup`, `AlertDialog` (delete-all, delete
  account), `Avatar size="lg" shape="circle"` (name-driven
  initials, `displayName || email || "?"`), `Badge`, `Kbd`.
- Identity tab: avatar + name/email header, Identity card,
  Account section (provider line, Export my data, Delete all
  chats, Danger-zone Delete account).

## 7. Auth pages — `src/components/auth/AuthLayout.tsx`

Standalone islands (`src/pages/login.astro`,
`src/pages/signup.astro`), never `AppLayout`. Login-split port:

- `Center axis="both" padding={6}` (`minHeight: 100%`,
  `backgroundColor: --color-background-body`) > `VStack gap={4}`
  > `maxWidth: 1000` div > `Card padding={0}` > `Grid
  columns={{minWidth: 240, repeat: 'fit'}} gap={8}
  align="stretch"` with a container query at 511px (cover
  `order: -1`, grid padding `--spacing-4`; keyed to card width,
  not the window; 240 + 32 + 48 = 320 floor).
- Form: `Section variant="transparent"` > brand row
  (`SparklesIcon` + `Text weight="bold"` "PESDac") >
  `StackItem size="fill"` + `Center axis="vertical"` > title
  `Text type="display-1" as="h2"` + subtitle `Text type="body"
  color="secondary" size="sm"` > Astryx-native form (`TextInput
  size="lg" isLabelHidden`, error `status` on the failing field
  only, primary `Button size="lg" isLoading`, `Divider label="Or
  continue with"`, secondary Google `Button size="lg"` with an
  inlined four-color G mark) > `EmptyState` success slot >
  swap link (`Text type="supporting"`, login ↔ signup).
- Cover: `div.login-split-image` (`aria-hidden`) > `Card
  variant="transparent"` (clips rounded corners) > `img
  object-fit: cover` — muted local SVG
  (`public/template-assets/light-working-vertical-1.svg`,
  swappable for a photo at the same path), 160px strip when
  stacked.
- Behavior: logged-in bounce to `/new` on mount; Google
  `callbackURL: "/new"`; signup checks for a session and shows
  check-your-inbox instead of navigating when verification is
  pending; forgot-password link (on failure, sign-in only) calls
  reset and swaps to confirmation. No legal footer line.

## 8. Routes — `src/pages/`

`index.astro` redirects to `/new`. `new.astro` (welcome),
`subject/[subject].astro`, `subject/[subject]/[code].astro`
(thread), `profile.astro` (`AppLayout initialView="profile"`),
`login.astro`, `signup.astro`. Subject codes come from
`src/lib/chat.ts` (`SUBJECTS`, `SUBJECT_NAMES`,
`CHAT_CODES`, `dayDividerLabel`); content from
`src/content/threads/` (CN/OS/DLCD/DSA/Math + `types.ts`).

## 9. Client state — `src/lib/session.ts` (summary)

Memory-only store (no `localStorage` reads after boot; one-time
purge of legacy `pesdac-*` keys). Same-tab reactivity via
listener set + `useSessionVersion()`. Custom chats + overlay
turns, demo renames/hides, pins/archive, per-answer feedback,
composer drafts (never leave the tab), `DEFAULT_PROFILE` +
`getProfile`/`updateProfile` merge-over-defaults,
`dumpStore`/`clearAllChats`. Server state (auth, profiles,
chats) lives behind `lib/auth.ts` (`apiFetch` + `useAuth`) and
is documented with the backend, not here.

## 10. Rules for new work

- The implementation above is the spec. Match its primitives,
  props, spacing, and type scale; do not restyle.
- Astryx component whenever one exists; never custom HTML/CSS
  approximations. No Tailwind, no global selectors, no theme
  edits unless explicitly requested.
- Mount `<Theme theme={PESDacMockupTheme} mode="dark">` on any
  page that renders Astryx outside `Pesdac`.
- Smallest diff that implements the request; never remove
  existing behavior while adding.
- Icons: `@heroicons/react/24/outline` via Astryx `Icon`
  (`size="sm"` rows/nav, `"md"` brand/headers, `"lg"`
  empty-states); avatars are name-driven initials.
- Never: dead links/buttons, credential logs, oracles, guest
  mode, custom modal/banner/form chrome.
