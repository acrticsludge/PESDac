# Spec: Conversation management (custom chats)

Status: Implemented (tsc + build + HTTP verified 2026-09-04; interactive rename/delete/search need manual browser QA)

## Problem
Custom chats accumulate with no rename, delete, or search — sidebar rots.
The hover `MoreMenu` on items has dead Pin/Rename/Archive/Delete slots
and "Search conversations" is a dead nav item.

## Scope (custom chats only; demo threads untouched)
- Store (`lib/session.ts`): `renameCustomChat(code, title)` (trim,
  34-char slice, ignore empty), `deleteCustomChat(code)` (removes chat +
  its overlay). Both `emit()`.
- `ConversationItem`: optional `onRename?: (title: string) => void`,
  `  onDelete?: () => void`. When provided, the existing menu's Rename /
  Delete items call them; when absent, menu stays exactly as today
  (demo chats unchanged). Pin/Archive stay dead everywhere (mockup).
- Menu clicks are isolated from the item link (`preventDefault` +
  `stopPropagation` wrapper): the `···` sits inside the SideNavItem
  anchor, and without isolation every menu click navigates away.
  (2026-09-04 fix: moved to the dedicated `actions` slot instead —
  `endContent` nests inside the anchor; `actions` renders as a sibling
  per the Astryx contract. Hover-reveal behavior unchanged. Tracer
  verified: menu opens, item clicks fire; demo items stay dead by design.)
- Dev env note (2026-09-04): `@astrojs/react` pulled Vite 8 while Astro 6
  needs Vite 7, breaking island transforms in dev. Pinned via
  `"overrides": { "vite": "^7" }` in `frontend/package.json`. After any
  dep change, restart dev fully (HMR alone may stay wedged).
- Rename UI: `Dialog` + controlled `TextInput` (auto-focus, Enter saves,
  prefilled with current title) owned by `ShellSideNav`
  (`renaming: CustomChat | null`).
- Delete: `AlertDialog` confirm (destructive action, Escape/cancel safe);
  confirm wipes the chat + overlay; if it was the open draft,
  `setDraftCode(null)` (+ `setDraftAutoSend(null)`) back to welcome.
- Search: "Search conversations" toggles a `TextInput` filter
  (search startIcon, `hasClear`) above Subjects; case-insensitive match
  across demo + custom labels; per-workspace filtering, empty workspaces
  hidden while querying.

## Non-goals
- No pin/archive, no backend, no URLs for customs (unchanged mockup
  constraint), no demo-thread edits, no sidebar redesign.

## Verification
- `tsc --noEmit` clean; `npm run build` green.
- Preview: rename via hover menu + dialog; delete removes + exits open
  draft; search filters across subjects, clear restores.
