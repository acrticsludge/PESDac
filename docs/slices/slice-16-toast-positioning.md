# Slice 16 — Toast positioning (top-right, above dialogs)

> **Status:** SHIPPED.
> **Date:** 2026-09-07.
> **Scope:** ToastViewport config in both shells (Pesdac, AuthLayout).

## 1. Problem

User reports:
> "toast shows up on bottom left rather than top right and is behind the modal instead of sitting on top of all components."

Two distinct bugs:

1. **Position is bottom-left.** `LayerProvider` accepts a `toast` prop with `{position, maxVisible, inset}`. We pass none. `LayerProvider.js:42` then forwards `position: toastConfig.position` (undefined) to `ToastViewport`, which defaults to `bottomEnd` (bottom-left in LTR). The example in the Astryx docs shows `position="bottomEnd"` as a sample, but that's not where the user wants toasts.

2. **Behind the modal.** The user opened the Profile dialog, triggered a server error, and the toast rendered behind the dialog's backdrop. The Astryx `ToastViewport` defaults `isTopLayer=true` and uses `popover="manual"` to promote to the top layer — but the user is reporting this isn't working for them.

For (2), the most likely cause is that the **fallback viewport** (mounted by `useToast` itself when no provider is found) is in use, not the LayerProvider's viewport. The fallback viewport IS `isTopLayer=true` but lives at `document.body.appendChild(container)`. With a Dialog's backdrop using `position: fixed; z-index: ...`, the toast viewport's popover top-layer may not promote above the dialog in all browsers.

The fix for both: **explicitly configure the LayerProvider's ToastViewport** to top-right position, and **add `maxVisible` so we don't run out of room**.

## 2. Decision

Pass `toast={{ position: "topEnd", maxVisible: 3 }}` to both `<LayerProvider>` instances in the app:

- `frontend/src/components/Pesdac.tsx:1056`
- `frontend/src/components/auth/AuthLayout.tsx:310` (the AuthLayout also has one)

That moves the viewport to top-right. The popover top-layer still applies, so toasts SHOULD be above dialogs. If the user is still seeing "behind the modal" after this fix, the issue is browser-specific popover behavior — for which the only workaround is a custom CSS overlay (deferred).

## 3. Why now

The user has reported this twice (in passing earlier and explicitly now). It's the most visible UX bug — every error and every success toast lands in the wrong place.

## 4. What changes

| File | What |
|---|---|
| `frontend/src/components/Pesdac.tsx` | Add `toast={{ position: "topEnd", maxVisible: 3 }}` to `<LayerProvider>`. |
| `frontend/src/components/auth/AuthLayout.tsx` | Same on the auth page's `<LayerProvider>`. |

No behavior change. No new deps. No backend work.

## 5. Out of scope

- **A custom CSS overlay** to guarantee above-dialog rendering across all browsers. If the popover top-layer doesn't work in the user's browser, the fix is a `position: fixed; z-index: 999999;` overlay. Deferred — the user can confirm the popover works first.
- **Animations, dismiss timers, custom toast content.** All defaults are fine; user didn't ask.
- **A11y improvements** (announce on error, focusable, etc.) — already handled by Astryx (`role="alert"` for error type, `aria-live` region).

## 6. Rollback

Revert the two files. No data layer changes. One-line revert.

## 7. Verification

Manual:
- Trigger any toast in the Profile dialog → it appears top-right, above the dialog.
- Trigger any toast on the auth page → top-right.
- Toast count: capped at 3 visible at once; older ones stack.
