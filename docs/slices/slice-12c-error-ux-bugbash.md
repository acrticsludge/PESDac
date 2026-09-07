# Slice 12C — Error UX bug-bash

> **Status:** SHIPPED.
> **Date:** 2026-09-07.
> **Scope:** Error rendering across the app.

## 1. Problem

User-reported issues from the profile screen and auth pages:

1. **Error location mismatch.** `AuthenticationSection`, `IdentitySection`, and `PrivacySection` render error messages in a **separate Banner card** below the form. The login / sign-up page renders the same kind of error **inline on the field** (using Astryx `TextInput.status` + a small `<Text>` under the form). The Banner card looks out of place and is inconsistent with the rest of the app — and it's the only place in the app that uses a red card-with-icon for a form error.

2. **Dismiss X icons do nothing.** Banner's `isDismissable={true}` shows a close (X) icon. We don't pass `isDismissable` on the four Banners in `sections.tsx`, so they should NOT show an X — but the user reports one appears. Either way, the user wants no X at all. The right answer is: **remove the Banners for form errors** so there's no X to be confused by.

3. **Auth page button loading.** The Google button on `/login` shows no spinner before the OAuth redirect. This is a known BetterAuth limitation (the `redirectPlugin` calls `window.location.href` synchronously inside the fetch promise, so React never gets a paint between `setIsLoading(true)` and navigation). The email button's spinner does show. The visible "no loading" complaint is the Google one — we need a fallback that does not depend on React render.

4. **"Add password" option looks unwired.** The `Add` button does work (the form opens), but the user has no way to tell from the form itself that a failed submit was caught. The "Password must be at least 8 characters" error currently lands in the **Banner at the bottom of the entire Authentication section**, far below the form. The user submits, the page does nothing visible, and they assume the click handler is broken.

## 2. Decision

### 2.1 Error rendering

Replace every error Banner with the same inline pattern AuthLayout uses:

- **Field-level errors:** `status={{ type: "error", message: "..." }}` on the input.
- **Form-level errors (no specific field):** a small `<Text type="supporting" color="error">` below the form, BEFORE the primary button — matches the AuthLayout `{error?.field === "form" && <Text>...</Text>}` style.
- **The Banner primitive stays for non-form errors** (the "Service may be used for training" notice in `PrivacySection`, the "Conversation may be processed" notice, and any future info banners). It is not used for user-actionable errors.

### 2.2 Auth page Google button

Add a small "Redirecting to Google…" line that shows for the ~50ms before navigation lands. Implemented as a `<Text type="supporting" color="secondary">` inside the form, mounted conditionally on `isGoogleLoading`. Even a single paint of that text reassures the user. The `isGoogleLoading` flag is already there — it just needs to render.

### 2.3 "Add password" perception fix

The state machine was right; the **error surface was wrong**. Once the Banner is removed in favor of inline `status` on the `New password` TextInput, the user sees the failure on the same line they typed it. No other change needed.

## 3. What changes

| Where | What |
|---|---|
| `frontend/src/components/profile/sections.tsx` | IdentitySection: 2 Banners → inline `status` on Campus/Semester/Branch Selectors + small `<Text>` for the "delete account" notice. PrivacySection: 1 Banner → small `<Text>` near the Export/Delete controls. AuthenticationSection: 1 Banner → inline `status` on `New password` (link form) and on `New password` / `Current password` (change form) + small `<Text>` for unlink/link-2FA/disable-2FA errors. |
| `frontend/src/components/auth/OnboardingDialog.tsx` | 2 Banners → small `<Text type="supporting" color="error">` under the form's primary button. |
| `frontend/src/components/auth/AuthLayout.tsx` | Add a "Redirecting to Google…" line under the email + Google buttons when `isGoogleLoading` is true. |

**No new components. No new files. No new dependencies.** Pure UX rework.

## 4. Out of scope

- Adding a "Try again" button to the inline errors. The user can re-submit; that's the same action.
- Re-introducing the X dismiss icon on anything. The user wants it gone.
- Changing Astryx primitive defaults. The Banner primitive is correct; we just stop using it for form errors.

## 5. Rollback

Revert the three files. No data layer changes, no migration. Five-minute revert.

## 6. Increments

| # | Where | What |
|---|---|---|
| 12C.1 | `frontend/src/components/profile/sections.tsx` | IdentitySection: Banners → inline `status` on Selectors. |
| 12C.2 | `frontend/src/components/profile/sections.tsx` | PrivacySection: Banner → inline `<Text>`. |
| 12C.3 | `frontend/src/components/profile/sections.tsx` | AuthenticationSection: Banner → inline `status` on `New password` (link form) and `Current password` / `New password` (change form); small `<Text>` for unlink/link/disable-2FA form-level errors. |
| 12C.4 | `frontend/src/components/auth/OnboardingDialog.tsx` | Both Banners → inline `<Text type="supporting" color="error">` under the form's primary button. |
| 12C.5 | `frontend/src/components/auth/AuthLayout.tsx` | Add "Redirecting to Google…" line; no-op for non-Google flows. |

After 12C.5: `npm run build` clean (chunk budget ≤ 750 kB). Manual smoke: trigger an error on the link-password form → the message paints on the `New password` field, not in a card at the bottom. Trigger the "add password" form's "Add" button → form opens, no Banner appears anywhere.
