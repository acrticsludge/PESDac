# Slice 15 — Server errors as toasts (form-level Text removed)

> **Status:** SHIPPED.
> **Date:** 2026-09-07.
> **Scope:** Link password + change password form server errors + `toUserMessage` copy.

## 1. Problem

User feedback after slice 14: "I just got an inline message and not even red so I didn't even know it was an error." Also: "Why is user getting backend error messages instead of a toast?"

The user got "That action isn't available. Restart the server and try again." (a 404 with my slice 12E copy) inline as `<Text type="supporting">`. The Text rendered in the default text color (gray-ish), not red, because Astryx's `Text` primitive's `TextColorMap` has no `error` key — the theme defines `--color-error` CSS but the primitive doesn't expose it.

Three problems:

1. **Wrong surface for server errors.** The form-level `<Text type="supporting">` pattern is correct for "I can identify a field for this error". For server errors (no field, transient, possibly-network), it should be a **toast** — same as every other transient failure in the app (slice 12E).

2. **No visual distinction.** The Text renders in default color, so it looks like body copy. The user can't tell it's an error.

3. **The 404 copy is dev-facing.** "Restart the server and try again." is something the operator does, not the user. A real user doesn't restart servers. The copy should be user-safe: "That didn't work. Please try again later." The 404 is still logged server-side; the server log + ref ID already serve the operator.

## 2. Decision

### 2.1 Convert all server-error form-level Text to toasts

The two `linkFormError` and `changeFormError` server paths fire `toast({body, type:"error"})` instead of setting state. The state variables and the `<Text type="supporting">` blocks are removed. The state was only ever used for the server-error case; per-field errors already use `status` on the field. So removing the form-level Text is safe.

### 2.2 User-safe 404 / 5xx copy

`toUserMessage` 404 branch: "That didn't work. Please try again later." (no operator instruction).
`toUserMessage` 5xx branch: "That didn't work on our end. Please try again later." (no ref ID exposed).

Server-side logs keep the full `ApiError.status` and ref ID for the operator; the client only sees the human copy.

## 3. Why now

Slice 12E was the first pass at the "errors as toasts" rule. It covered the **section-level** state (authError, serverError, saveError, deleteNotice) but missed the **form-level** state (linkFormError, changeFormError). The user has now hit both:
- Section-level: fixed in slice 12E
- Form-level (the link-password form): this slice

## 4. What changes

| File | What |
|---|---|
| `frontend/src/lib/auth.ts` | `toUserMessage` 404 + 5xx copy → user-safe. |
| `frontend/src/components/profile/sections.tsx` | Drop `linkFormError` / `changeFormError` state + their Text blocks. Both server-error catches fire `toast({type:"error"})` directly. The handler no longer sets these states. |

## 5. Out of scope

- The `OnboardingDialog` (slice 12C already moved its errors to inline Text). The dialog has no field-level surface for server errors, and toasts in a blocking Dialog are out of scope (the dialog is supposed to be the only thing the user sees).
- Auto-refresh of the accounts list after a successful link (BetterAuth's session cookie doesn't pick up the new credential account until the user re-logs-in; the row only shows up after refresh). Tracked as a separate UX concern; will be fixed when the BetterAuth session JWT carries the credential list.

## 6. Rollback

Revert the two files. No data layer changes.

## 7. Increments

| # | Where | What |
|---|---|---|
| 15.1 | `frontend/src/lib/auth.ts` | `toUserMessage` user-safe copy for 404 + 5xx. |
| 15.2 | `frontend/src/components/profile/sections.tsx` | Drop `linkFormError` + `changeFormError` state; both server-error catches fire toasts. Remove the form-level Text blocks. |

After 15.2: every server-side error in the password forms surfaces as a toast in the top-right corner. Field-level errors stay on the field. No more "is this an error?" guesswork.
