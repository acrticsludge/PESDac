# Slice 12E — Errors as toasts, not card text

> **Status:** SHIPPED.
> **Date:** 2026-09-07.
> **Scope:** Profile dialog error rendering + `toUserMessage` 404 handling.

## 1. Problem

After Slice 12C, the Profile dialog's section-level `authError` (AuthenticationSection) and `serverError` (PrivacySection) render as `<Text type="supporting">{message}</Text>` at the **bottom of the entire section card**. User reports:

> "90% of the error states don't exist, user sees backend error that pop up in the card rather than a toast. still not good enough."

The 404 on `POST /api/v1/auth/link-password` was the trigger: the error path rendered "Not Found" at the bottom of the Authentication section, 200+ pixels below the row the user clicked. The user perceived this as "error pops up in the card".

Per the Slice 12 loading spec, the right surface is:
- **Field-level errors:** `TextInput.status={{type:"error",message}}` on the affected input. (Already done for the password forms.)
- **Form-level errors (no specific field):** small `<Text type="supporting">` directly under the form, above the buttons. (Already done for the password forms.)
- **Recoverable failures with no better location:** one error `Toast`. (NOT done — these are the section-level `authError` and `serverError`.)

## 2. Decision

Convert every section-level error state in `sections.tsx` to a Toast. Specifically:

- **AuthenticationSection `authError`** → fire `toast({body, type:"error"})` on every catch. Remove the state and the bottom-of-section Text.
- **PrivacySection `serverError`** → fire `toast({body, type:"error"})` on every catch. Remove the state and the standalone Text.

The password forms (link + change) already have field-level `status` props and form-level `<Text>` above the buttons. Those are correct. We only touch the section-level states that show errors at the bottom of the section.

Also: improve `toUserMessage` to render 404 as a friendlier copy ("That action isn't available. Restart the server and try again.") so a stale backend doesn't surface as the unhelpful "Not Found".

## 3. Why now

- Slice 12C removed the Banner cards but used `<Text type="supporting">` at the section bottom as a stopgap. That stopgap is itself a "card" perception problem.
- The 404 is reproducible: any user who starts uvicorn before the slice 12B commit lands will see the broken route. The error copy needs to be useful even in that case.

## 4. What changes

| Where | What |
|---|---|
| `frontend/src/lib/auth.ts` | `toUserMessage` adds branches: 404 → "That action isn't available. Restart the server and try again." 5xx → "The server hit an error. Try again in a moment." Connection errors stay as before. |
| `frontend/src/components/profile/sections.tsx` AuthenticationSection | Drop `authError` state and the bottom-of-section Text. Every catch in the section calls `toast({body, type:"error"})` directly. Cancel/Add/Change buttons clear their form-level errors (already correct). |
| `frontend/src/components/profile/sections.tsx` PrivacySection | Drop `serverError` state and the standalone Text above the Your data card. Every catch calls `toast({body, type:"error"})` directly. |
| `frontend/src/components/profile/sections.tsx` IdentitySection | Drop `saveError` and `deleteNotice` state, replace with toasts on catch. The Banner text was already removed in 12C; this finishes the migration. |

The link-password form and change-password form keep their per-field `status` props and the small Text above the buttons. They never set the section-level state.

## 5. Out of scope

- Adding an "I understand, dismiss" button on the toast. The Astryx Toast primitive auto-dismisses.
- Routing 502 / network errors through a retry button. The toast's "Try again" copy is the recovery hint; the user re-submits.
- Replacing the password forms' field-level error pattern with toasts. Field-level is correct per the spec.
- Touching the OnboardingDialog errors. They were already small Text under the form in 12C.

## 6. Rollback

Revert the three files. The slice is a pure UX change — no schema, no migration, no data loss.

## 7. Increments

| # | Where | What |
|---|---|---|
| 12E.1 | `frontend/src/lib/auth.ts` | `toUserMessage` 404/5xx branches. |
| 12E.2 | `frontend/src/components/profile/sections.tsx` IdentitySection | `saveError`/`deleteNotice` → toasts. |
| 12E.3 | `frontend/src/components/profile/sections.tsx` PrivacySection | `serverError` → toast. |
| 12E.4 | `frontend/src/components/profile/sections.tsx` AuthenticationSection | `authError` → toast. |

After 12E.4: every auth/privacy mutation in the Profile dialog reports failure as a Toast in the top-right corner. Field-level password errors still appear inline. Build clean; manual smoke: trigger any auth/privacy error → toast appears, no card text below the section.
