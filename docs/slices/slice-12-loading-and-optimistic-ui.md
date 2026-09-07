# Slice 12 — Loading, Optimistic UI, and Astryx Feedback

## Status

Implementation specification based on the current scan of `frontend/src`.
This slice preserves the existing Astryx 0.5.2 hierarchy, the exported
`PESDacMockupTheme`, and the current behavior of the app.

## Goal

Every notable interactive operation must have deliberate pending, success, and
failure behavior.

Use optimistic UI only when the local state can be restored exactly. Capture a
rollback snapshot, update the UI immediately, persist the mutation, reconcile
on success, and restore the snapshot on failure.

Use feedback consistently:

- Astryx `Toast`: small, completed, recoverable, or non-blocking operations.
- Astryx `Banner`: persistent form or field errors that belong beside the
  affected content.
- Astryx `Dialog`: blocking multi-step flows that need context or user input.
- Astryx `AlertDialog`: destructive, irreversible, or high-consequence
  confirmation and action feedback.
- Astryx `Button`, `Switch`, `ToggleButton`, `Selector`, `Spinner`,
  `Skeleton`, and `ProgressBar`: pending state only where the operation
  actually takes time.

## Constraints

- Astryx primitives only for UI feedback. No custom spinner, loading CSS,
  Tailwind, or third-party loading library.
- Use `Button.clickAction` for a simple async action. It owns Astryx loading,
  busy semantics, and re-entry protection.
- Use `Button.isLoading` and `isDisabled` when state is shared by several
  controls or a flow needs a result before it can continue.
- Use `Switch.changeAction` and `ToggleButton.pressedChangeAction` for async
  toggles. The local value must update optimistically and be reversible.
- Keep `AppToasts.tsx` and its existing `useToast()`/`ShowToastFn` bridge. Do
  not add a second toast bus.
- Keep all feedback inside the existing `PESDacMockupTheme`.
- Do not show a spinner for synchronous local changes or route navigation.
- Do not make logout, account deletion, or delete-all-chats optimistic.

## Existing infrastructure

`frontend/src/lib/async-action.ts` already provides `useAsyncAction`. Reuse it
for multi-control flows; do not create another generic async hook. Simple
buttons should prefer `clickAction`.

`frontend/src/components/AppToasts.tsx` already mounts `useToast()` inside the
Astryx layer provider and exposes a toast ref to shell handlers. Use it for
success/error notices. Do not replace it with custom events.

### Toast policy

Show one Toast per completed notable operation, not for every keystroke:

- Pin/unpin: “Chat pinned” / “Chat unpinned”.
- Archive/unarchive: “Chat archived” / “Chat restored”.
- Rename: “Chat renamed”.
- Copy: “Copied to clipboard” only when useful; the existing icon/label state
  may remain the primary feedback for fast copies.
- Export: “Your data export is ready” after the download begins.
- Profile preference save: use a Toast only for a server-backed save; local
  preference changes remain silent because they are instantaneous.
- Link/unlink Google, 2FA, password change: success Toast after confirmation.
- Recoverable failures: one error Toast when there is no better field-level
  location.

### Modal policy

Use an Astryx `Dialog`/`AlertDialog` for:

- Delete account, delete all chats, and chat delete/hide confirmation.
- Required auth and onboarding flows.
- Multi-step 2FA setup and verification.
- Any future operation that blocks the user from continuing until a choice is
  made or a critical result is acknowledged.

Never use a modal merely to announce a successful small operation.

## Optimistic mutation contract

1. Capture the smallest exact rollback snapshot.
2. Update local state synchronously.
3. Mark only the affected control or row pending.
4. Await the server request.
5. Reconcile from the server response when one exists.
6. On failure, restore the snapshot and show a Toast or Banner.
7. Clear pending state in `finally`.

If a field can be changed again before an earlier request returns, attach a
revision/request id. A stale failure must not roll back a newer successful
value.

## Audit and implementation plan

### Auth: `AuthLayout.tsx`, `AuthGate.tsx`, `OnboardingDialog.tsx`

#### AuthLayout

Current email, Google, and TOTP submit buttons already use `isLoading`.

- Keep submit loading and prevent duplicate submission.
- Disable alternate auth actions while a submission is pending.
- Keep validation errors beside the field or in a Banner.
- Do not optimistically mark a user authenticated; wait for the session result.
- Do not toast a successful login/signup when navigation immediately leaves the
  page.

#### AuthGate

Create account and Log in only navigate. They need no loading state or Toast.
Astro transitions own route feedback.

#### OnboardingDialog

`Start studying` already has `isLoading={isSaving}` and an error Banner.

- Keep the dialog open until the PATCH succeeds.
- Disable campus, semester, branch, subject controls, and any cancel/back
  control while saving.
- Add `isLoading` to the `Try again` button while the profile check retries.
- Do not optimistically set `onboardingDone`.
- On successful save, a small success Toast is appropriate only if the dialog
  does not immediately transition into the app; otherwise the completed
  transition is enough.

### App shell: `Pesdac.tsx`

#### Synchronous controls

No loading UI is needed for new chat, opening a conversation, search toggling,
subject selection, mode selection, profile opening, reference insertion, quick
suggestions, or local composer attachment staging.

#### Logout

`handleLogout` is async but currently has no visible pending state.

- Add `isLoggingOut`.
- Use Astryx Button loading/disabled behavior on the Logout row.
- Keep the authenticated UI visible if logout fails and show one error Toast.
- Navigate to `/login` only after success.
- Do not optimistically clear the session.

#### Conversation row actions

The current `pending` row map and inline `Spinner` are the correct extension
point for pin, unpin, archive, and unarchive.

- While these actions are local-only, keep them immediate and silent or show a
  small success Toast for the notable action.
- When server persistence exists, update the row/section optimistically, keep
  only that row pending, and roll it back on failure with an error Toast.
- Rename keeps its Dialog open until persistence succeeds. On success show
  “Chat renamed”; on failure preserve the original name and show a Banner or
  error Toast.
- Delete/hide remains non-optimistic and uses `AlertDialog.isActionLoading`.
  The cancel/close controls are disabled only while the destructive request is
  active.

#### No-op menu items

The welcome Settings menu contains `Knowledge sources` and `About PESDac`
items with empty handlers. Give them a real Astryx Dialog/destination or remove
them. A no-op button cannot be fixed with loading UI.

### Welcome composer: `Pesdac.tsx`

`ChatComposer` owns its send control; do not overlay a custom Button.

- Creating a custom chat is synchronous local state and should remain instant.
- When a real backend send exists, use the composer’s pending/stop API.
- Append the user message optimistically before requesting the assistant.
- Preserve the user message on assistant failure and show the existing retry
  state; do not erase entered text.
- Attachment staging/removal is synchronous until uploads exist.
- If uploads are added later, each attachment row gets its own Spinner or
  determinate `ProgressBar`; successful upload may show a Toast, failure removes
  or marks the row failed and shows an error Toast.

### Thread: `chat/ThreadView.tsx`

#### Synchronous actions

MCQ choice, step navigation, expand/collapse, edit/cancel, find controls,
artifact open/close, and local vote changes need no loading state.

#### Send, retry, regenerate, and stop

The current implementation already appends the user block optimistically and
uses `live` for the simulated assistant stream.

- Keep the optimistic user block on failure.
- Use `ChatComposer`’s `isStopShown`, `onStop`, and `ChatMessageList
  isStreaming` contract for stream state.
- Before the first assistant text, show an Astryx Spinner or indeterminate
  progress state in the assistant area. Once text exists, keep partial Markdown
  visible.
- Retry and regenerate need per-action guards and must not run while `live` is
  non-null.
- Stop is currently synchronous simulation behavior. Do not fake a spinner;
  add Button interruptible/loading feedback only when a real abort request is
  introduced.
- Failed assistant requests keep the retry block and must produce no unhandled
  rejection.
- A successful retry/regeneration may show a small success Toast only when it
  completes after a visible failure; do not toast every normal response.

#### Copy and transcript

`CopyButton` and transcript copy use the Clipboard API but currently have no
pending state.

- Add `isCopying` and Astryx Button loading while the Clipboard promise is
  pending.
- Keep the existing “Copied” label/icon state.
- On failure show one error Toast.
- The Study Note Copy action follows the same rule.
- Study Note Close is synchronous.
- Study Note Share currently has no handler; implement it with a real action or
  remove it. Do not leave a no-op button.

### Attachments: `chat/AttachButton.tsx`

The current button opens the native file picker and stages local `File` objects.
It is synchronous and needs no loading state.

When an upload endpoint exists:

- Keep the picker Button as the picker trigger, not the upload indicator.
- Insert a staged row optimistically.
- Show row-level Spinner/ProgressBar during upload.
- On success show a Toast only if the upload is a notable standalone action.
- On failure remove or mark only that row failed and show an error Toast.

### Profile: `ProfileDialog.tsx`, `profile/sections.tsx`

#### Navigation

Profile tabs, search, and narrow-screen `TabList` are synchronous. Do not add
loading UI to them.

#### Identity

`saveIdentity` already has the correct optimistic shape: snapshot local profile,
update immediately, call `apiUpdateProfile`, restore on failure, and expose
selector loading/disabled state.

- Preserve that behavior.
- Include every changed field in the snapshot.
- Add a success Toast only for server-backed saves if the change is not already
  obvious in the control.
- Guard stale responses with a revision id.

#### Study, Assistant, Shortcuts, Language

These currently write to the memory-only session store synchronously. Keep them
instant and silent. If a control becomes server-backed, use its Astryx native
async prop:

```tsx
<Switch
  value={value}
  onChange={(next) => updateProfile({ followUps: next })}
  changeAction={async (next) => savePreference(next)}
  isLoading={isSaving}
  isDisabled={isSaving}
/>
```

The local update must have an exact rollback snapshot. Use a Toast for a
successful server preference save and a Banner or error Toast on failure.

#### Privacy

Export is async; delete-all is destructive.

- Add `isExporting` and Astryx Button loading/disabled behavior.
- On successful export, show “Your data export is ready” as a Toast after the
  browser download starts.
- On export failure, keep the surface open and show the existing error Banner.
- Keep delete-all behind `AlertDialog`; use `isActionLoading` for the confirm
  action. Do not clear local chats until the server request succeeds when
  authenticated.
- On success, clear the store and show a completion Toast after the dialog
  closes. On failure, keep chats and show the existing Banner.

#### Authentication

Existing loading and `anyPending` coverage applies to Link/Unlink Google,
2FA setup/verify/disable, password change, and account deletion.

- Keep controls disabled while another Better Auth mutation is pending.
- Link/unlink success may update the accounts view and show a success Toast;
  failure leaves the previous account list unchanged and shows an error Toast.
- Do not show enabled 2FA until verification succeeds. Setup key and backup
  codes appear only after the server returns them. Keep setup in an Astryx
  Dialog-like surface and use a Banner for verification errors.
- Password fields remain populated on failure. Show a success Toast only after
  the server confirms the change.
- Account deletion stays confirmed, non-optimistic, and uses
  `AlertDialog.isActionLoading`. Navigate only after success. If deletion is
  incomplete, keep the critical result in a Banner or blocking Dialog rather
  than a transient Toast.

## Astryx mapping

| Situation | Required implementation |
|---|---|
| Simple async Button | `Button clickAction` |
| Shared/multi-step async state | `Button isLoading` + `isDisabled` |
| Optimistic toggle | `Switch changeAction` or `ToggleButton pressedChangeAction` |
| Affected list row pending | Inline `Spinner size="sm"` |
| Unknown remote content | `Skeleton` inside the existing Card/row |
| Known percentage | `ProgressBar label=... value=...` |
| Unknown long operation | Indeterminate `ProgressBar` or `Spinner` |
| Persistent local/form error | `Banner status="error"` |
| Small completed/error notice | Existing Astryx `useToast()` |
| Critical/destructive action | `Dialog`/`AlertDialog` |

## Verification matrix

### Auth

- Double-click email, Google, TOTP, onboarding save, retry, and logout.
- Confirm only the relevant control is pending and conflicting actions are
  disabled.
- Force failures and confirm one Banner/Toast with a usable recovery path.

### Chat

- Send, stop, retry, regenerate, copy response, copy transcript, and copy a
  study note.
- Confirm the user message appears before the assistant response and is not
  deleted when the assistant fails.
- Force Clipboard failure and verify an error Toast.
- Verify MCQ, steps, find, edit, and votes remain instant.

### Sidebar

- Pin, unpin, archive, unarchive, rename, hide, and delete.
- Verify optimistic row changes restore exactly after a forced persistence
  failure.
- Verify destructive confirmation cannot be double-submitted.

### Profile

- Force identity save failure and verify exact rollback.
- Test export success/failure, delete-all confirmation, Google linking, 2FA,
  password change, and account deletion.
- Verify success Toasts are used for notable completions and critical results
  remain in Dialog/Banner surfaces.

### Commands

From `frontend/`:

```text
npm.cmd run astro -- check
npm.cmd run build
```

No new type errors are allowed. Existing unrelated deprecation warnings do not
count as a slice failure. The current Astro adapter and Astryx theme setup must
remain unchanged.

## Out of scope

- Replacing Astryx components or editing `PESDacMockupTheme`.
- Inventing remote chat loading where only the memory store exists.
- Adding upload progress before an upload endpoint exists.
- Adding route-level skeletons to static Astro pages.
- Optimistic logout, account deletion, or delete-all-chats.
- Keeping no-op menu/button actions in the UI.

## Definition of done

- Every current async operation has visible pending feedback and a failure path.
- Every safe server mutation has snapshot-based optimistic rollback.
- Small notable completions/errors use Astryx Toasts.
- Critical/destructive/multi-step flows use Astryx Dialog or AlertDialog.
- No custom loading or notification system exists.
- All feedback inherits `PESDacMockupTheme`.
