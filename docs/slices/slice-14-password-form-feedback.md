# Slice 14 — Password form feedback (inline status + Enter to submit)

> **Status:** SHIPPED.
> **Date:** 2026-09-07.
> **Scope:** Profile → Authentication → Link password + Change password forms.

## 1. Problem

User report after the link-password form was working: "I only filled 1 slot and clicked Enter, no error no prompt saying what went wrong, same if I put in a password that won't match the first slot. same issue on other places probably where user does not know what he's doing is wrong."

Three concrete bugs:

1. **No `onEnter` binding** on the password TextInputs. Hitting Enter does nothing — the user has to click the primary button. Worse: the field's own `onChange` doesn't validate, so the user gets zero feedback until they manually click.
2. **The "Confirm new password" field has no `status` prop.** Mismatch is rendered as a `<Text type="supporting">` BELOW the field (slice 12C). The user can't see the link between the field and the error.
3. **"New password" field on the change-password form has no `status` prop.** Length errors (and the "new password can't be the same as current" case the user might run into) only show as a Text below the field.

Plus a fourth issue I caught while auditing:

4. **The form-level `<Text type="supporting">` and the field-level `status` both fire for the same error in some cases** (link-password: linkFormError for the mismatch case; the field has no status for the same case so we have ONE signal but it's below the field). After this slice, the field has the status and the Text is gone for that case — leaving only the server-error case (where the field can't be identified) using the form-level Text.

## 2. Decision

Per the auth page pattern (AuthLayout.tsx — which is the source of truth the user keeps pointing to):

- **Every validation error paints on the field that produced it, via `status={{type:"error", message:...}}`.**
- **Form-level `<Text type="supporting">` is reserved for "no specific field" errors** — only the server-error case in these forms.
- **`onEnter` on the last field submits the form.** Matches `AuthLayout.tsx`'s pattern (the `onEnter` on the password field there fires `handleEmailAuth`).

The two forms:

### Link password

- `New password` status:
  - length: "Password must be at least 8 characters."
- `Confirm new password` status:
  - mismatch: "Doesn't match the password above."
- `onEnter` on either field → `handleLinkPassword()`

### Change password

- `Current password` status:
  - empty: "Enter your current password." (already correct)
  - server: AUTH_ERROR (handled by toUserMessage)
- `New password` status:
  - length: "The new password must be at least 8 characters."
- `onEnter` on either field → `handleChangePassword()`

The Text below the form is removed for the validation cases. It stays ONLY for the server-error case (network 4xx/5xx from BetterAuth or our backend) because no field owns that error.

## 3. Why now

These are the last "the user can't tell what they did wrong" issues in the auth flow. The user has been clear they want toasts/errors to be obvious; the inline-status pattern from AuthLayout is the cleanest way to deliver that. Slice 12C made Banners into Text-below-field which is "less of a card" but still not "the field tells you". Slice 14 is the right next step.

## 4. What changes

| File | What |
|---|---|
| `frontend/src/components/profile/sections.tsx` | `handleLinkPassword` + `handleChangePassword` rewrite the error-state assignments so each error goes to the right field. Add `onEnter` to the last TextInput in each form. The form-level Text below the buttons is removed for validation cases. |

The link-password form gets a new state split: `linkConfirmError` is added; the existing `linkFormError` is reserved for server errors. The change-password form gets `changeNewError` (for length) and keeps `changeFieldError` (for current) + `changeFormError` (for server).

## 5. Out of scope

- Auto-focus the next empty field. Could be added later; the user didn't ask for it, and on Enter + the new "you must fill this" inline status, the user can see the field and click into it.
- Showing the length requirement in the description AND a real-time "0 / 8" character counter. The current `description` field ("At least 8 characters") is the standard pattern; a counter is extra noise.
- Strong-password requirements (uppercase, digit, special char). Not in scope of BetterAuth's password policy; the server enforces 8-char minimum only.

## 6. Rollback

Revert `frontend/src/components/profile/sections.tsx`. No data layer changes. Five-minute revert.

## 7. Increments

| # | Where | What |
|---|---|---|
| 14.1 | `frontend/src/components/profile/sections.tsx` | Rewrite `handleLinkPassword` + add `onEnter` + add `status` to `Confirm new password`. |
| 14.2 | `frontend/src/components/profile/sections.tsx` | Rewrite `handleChangePassword` + add `onEnter` + add `status` to `New password`. |

After 14.2: the user fills a slot and hits Enter → the form validates and the error appears on the right field. The user types a different value in the Confirm slot and the error clears the moment the values match. No more "what went wrong" silence.
