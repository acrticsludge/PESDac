# Chat power slices — edit, shortcuts, feedback, multitab, find, drafts

Mockup stage: localStorage-backed, same signatures the backend serves later.
Error-states spec (`error-states.md`) unchanged; these slices add no new
error kinds.

## 1. Edit user message → regenerate

- Pencil action on session-added user turns only (`index >=
  thread.blocks.length`, static demo tails immutable, hidden while a turn
  streams). Edits route through the composer, not an inline editor:
  clicking fills the composer with `userBlockText`, focuses it, and sets
  `editingIndex`.
- Notice bar above the composer while editing: "Editing message — Send
  applies it to this turn, Esc cancels."
- Send with `editingIndex != null`: `truncateOverlay(sessionKey,
  editingIndex - thread.blocks.length)` first (drops that user turn and
  everything after), then the normal send path appends a fresh user block
  and streams a new answer. Cancel (Esc / ×): clear `editingIndex` and the
  composer, overlay untouched.
- `truncateOverlay(code, keep)`: keep first `keep` overlay blocks. Emits.

## 3. Keyboard shortcuts

- Global keydown in `Pesdac` (ignored when the event target is editable —
  `input`, `textarea`, `[contenteditable]`):
  - `Ctrl/⌘+K` → new chat (`startNewChat` path).
  - `Esc` → close Pesdac dialogs/search/mode menu first; otherwise emit
    `pesdac:cancel` on window.
  - `/` → emit `pesdac:focus-composer` (preventDefault so no glyph lands).
- `ThreadView` subscribes: `pesdac:cancel` → stop stream if live, else
  cancel edit, else close find; `pesdac:focus-composer` → focus thread
  composer. Welcome composer subscribes to focus only.
- No `Ctrl+F` hijack — in-thread find has its own UI (slice 8).

## 5. Per-answer feedback

- `pesdac-feedback-v1`: `Record<voteKey, "up" | "down">`, voteKey =
  `${sessionKey}:${blockIndex}` (demo labels are canonical ids; custom
  codes are stable). `getFeedback` / `setFeedback(key, vote | null)`.
  Emits, so votes sync across tabs via slice 6.
- Thumbs up/down ghost icon buttons in the assistant footer beside copy.
  All assistant turns (static + session), hidden while streaming. Click
  toggles (second click clears). Voted state: accent icon color.
- Backend later: `POST /turns/{id}/feedback`; voteKey becomes turn id.

## 6. Multi-tab sync

- Module-scope `storage` listener in `session.ts`: any key starting with
  `pesdac-` → `emit()`. All subscribers (`useSessionVersion`,
  `useStorageHealth`) re-read. Fires only in *other* tabs by browser
  design — exactly the fork case. No listener cleanup needed (module
  scope, app lifetime). Draft text is component state and never clobbered.

## 8. In-thread find

- Magnifier in the thread composer header opens a find bar above the
  message list: `TextInput` + `n of m` + up/down + close. `Enter` = next,
  `Shift+Enter`? — `TextInput` only exposes `onEnter`, so Enter = next
  match, buttons cover both directions, Esc closes (via `pesdac:cancel`).
- Match corpus per block: user → `userBlockText`, assistant →
  `assistantBlockText`, system → raw text. Case-insensitive substring.
- Rows wrapped in `<div data-block={i}>`; current match scrolls into view
  (`block: "center"`) via `rootRef` query and gets an accent outline.
  Wrapping divs are unstyled otherwise — no Astryx DOM changes.

## 9. Composer draft persistence

- `ChatComposerInput` is controlled (`value` + `onChange`) in both thread
  and welcome composers. Imperative fills (suggestions, `@` tokens, edit
  prefill) sync back via `handle.getValue()` → state, so controlled state
  never clobbers editor mutations.
- `pesdac-drafts-v1`: `Record<draftKey, string>`, draftKey = thread
  `sessionKey`, welcome = `"welcome"`. Debounced write (~400ms), initial
  state reads the stored draft, send clears it. No store emit (local
  state; cross-tab clobbering explicitly out of scope).
