# Dead-Code Audit — 2026-09-04

Category: Maintainability / Deprecation
Status: Implemented
Scope: `frontend/src` (routes, components, data — no deps, no theme, no docs)

Method: every removal below was proven by reference count (importer grep),
not by judgment. Replacement exists or nothing consumed it (deprecation
decision: no unique value → remove; git history preserves all of it).

## Removed

| # | Dead code | Proof | Decision |
|---|-----------|-------|----------|
| 1 | `components/chat/WelcomeScreen.tsx` (~122 lines) | Zero importers; only self-reference is its own import of #2. Broken imports (`STATUS_DOT_VARIANTS` — not exported by `CNChat`) | Delete file |
| 2 | `components/chat/CNChat.tsx` (~114 lines) | Zero importers. Broken imports (`Card,Section` from `.../Card`; `Markdown,CodeBlock` from `.../Markdown`; `Grid,Stack` from `.../Grid`). Truncated copy of the live CN thread | Delete file + empty `chat/` dir |
| 3 | `data/index.ts` (sole importer was #1) | After #1 removal: zero importers. Full duplicate of `Pesdac.tsx` inline data (`WORKSPACES`, suggestions, modes). Two sources of truth, one live | Delete file |
| 4 | `Pesdac.tsx`: `LayoutFooter`, `StatusDot` (value), `PencilSquareIcon`, `CodeBracketIcon`, `LockClosedIcon`, `ClockIcon`, `LightBulbIcon` imports | 1 occurrence each (import line only); bundler `UNUSED_IMPORT` warnings confirmed | Delete import lines |
| 5 | `Pesdac.tsx`: `ConversationItem` `status`/`statusLabel` props | Destructured but never rendered (`endContent` is `MoreMenu`-only per remove-statusdot spec) | Delete props (destructure + type + call-site args) |
| 6 | `AppLayout.tsx`: `Theme`, `PESDacMockupTheme` imports | Body is pure `<Pesdac …/>` passthrough; `Theme` mount lives in `Pesdac` | Delete import lines |
| 7 | `src/pages/chat/CN/` + `src/components/nav/` (empty dirs) | No files inside; zero importers; leftovers of the abandoned `/chat/...` scheme and an unfinished split | Delete dirs |

## Deliberately kept

- `status`/`statusLabel` **data fields** in `Pesdac.tsx WORKSPACES` + `StatusDotVariant` **type** import — `docs/reasonix/specs/remove-statusdot.md` reserves them for future backend. Data ≠ dead rendering.
- `lib/chat.ts` in full — every export has a live importer (`SUBJECTS`, `getAllChatPaths` in `.astro` pages; rest in `Pesdac.tsx`). `ChatRef` is used by `getChatByCode`'s signature.
- `components/chat/` forks' *content* — the live equivalents already exist in `Pesdac.tsx`; nothing to migrate (deprecation Step 1 N/A — replacement predates the removal).
- Dependencies (`@astryxdesign/cli`, etc.), theme, `.astro` inline head — out of scope, no evidence of deadness.
- No TODO/FIXME/`console.log`/`debugger` found in `src`.

## Verification

- `npm run build` passes; 26 pages emitted (unchanged).
- Post-removal grep: zero references to `WelcomeScreen`, `CNChat`, `data/index`, removed icon names, `LayoutFooter`, `status={chat.status}`.
- HTTP spot-check (from chat-route work) unaffected — no component hierarchy or token changed.
