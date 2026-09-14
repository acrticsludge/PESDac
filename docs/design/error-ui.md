# PESDac Error UI — the single Astryx-only system

Date: 2026-09-14. Status: Implemented (standard).
Scope: every user-facing failure, warning, and success-confirmation surface.
Rule: error display uses Astryx components only — no custom error CSS, no
new surfaces without amending this document. Inventory below was scanned
from the tree on 2026-09-14 (no new UI invented for this doc).

## 1. Inventory (observed, with owners)

| # | Surface | Astryx component | Where | Notes |
|---|---|---|---|---|
| 1 | Async-operation failure outside a form | `useToast({ body, type: "error" })` (`@astryxdesign/core/Toast`) | `sections.tsx` ×12 (259, 289, 326, 1419, 1441, 1696, 1712, 1729, 1752, 1767, 1799, 1846), `Pesdac.tsx` (783, 830, 919, 2157) | `type: "error"` is load-bearing: assertive live region + no auto-hide (`types.ts:6-35`). Omitting `type` renders an auto-hiding info toast — always pass it on failure. |
| 2 | Success confirmation | `useToast({ body, type: "info" })` | `sections.tsx` (322, 1416, 1451, 1693, 1709, 1843), `Pesdac.tsx` (910) | Info only. Never use info styling for a failure. |
| 3 | Global safety net | error Toast in `unhandledrejection` | `AppToasts.tsx:108-113` | Generic copy + `console.error` for devtools. Caught flows must never reach it; raw rejection reasons are never rendered. Toast-above-modal ordering via top-layer re-assert (`AppToasts.tsx:46-93`). |
| 4 | Field-level validation | `TextInput status={{ type: "error", message }}` | `AuthLayout.tsx` (`statusFor`), `sections.tsx` (display name), `OnboardingDialog.tsx:424-428` | Astryx sets `aria-invalid` + `aria-describedby` internally (`TextInput.tsx:450-452`). Focus the first invalid field on submit. |
| 5 | Form-level failure (no single field) | `Banner status="error"` with title + description | Migrating to (was `Text type="supporting"` in `AuthLayout.tsx:406-408,472-474`) | Banner carries heading semantics a supporting line lacks; focus moves to it. Optional retry action via `endContent`. |
| 6 | Non-blocking warning | `Banner status="warning"` with dismiss (+ optional action) | `OnboardingDialog.tsx:448-463` (title, description, `endContent` action, `onDismiss`) | Canonical warning shape. Never blocks submit. |
| 7 | Destructive confirmation | `AlertDialog` | `sections.tsx:1534` (delete account), `SettingsDialog.tsx:293`, `Pesdac.tsx:2487` (clear) | Confirm spins, memory follows on success. Failure after close → Toast error; failure with modal open → Banner error inside. |
| 8 | Message-level failure | In-flow `AssistantBlock.error` + retry action | `ThreadView.tsx:764-766,1688-1694`, `chat-error-display` spec | Never a toast — a toast detaches the failure from its message context. Retry must not duplicate user messages. |
| 9 | Copy funnel | `toUserMessage(error, fallback)` (`lib/auth.ts:133-159`); auth-page mappers in `lib/auth-errors.ts` | Every surface above | Server-envelope / network / timeout / auth-service mapping in one place. Raw `error.message` is never rendered (sole exception: `AuthServiceError`, authored user-safe at construction — pinned in `toUserMessage`). No secrets, tokens, emails, or stack traces in copy. |
| 10 | Last-method unlink | Server refusal → Toast error | `lib/auth.ts:542-546`, `sections.tsx:1674` | Enforcement is server-side; the client surfaces the refusal as a normal op failure. No client-side method counting. |

## 2. Canonical mapping (the one system — use this, nothing else)

- **E1 — one field is wrong:** `TextInput status` error + focus the first invalid field. Rules visible before submit (e.g. password-length description).
- **E2 — submit failed, no single field to blame:** `Banner status="error"` (title + description, optional retry `endContent`), focus to the banner, cleared on next submit or input change.
- **E3 — background op failed:** Toast `type: "error"` with a stable `uniqueID` (dedupe repeatable failures) + funnel copy; success → Toast `type: "info"`, short.
- **E4 — non-blocking warning:** `Banner status="warning"` + dismiss (+ optional action). Never blocks.
- **E5 — destructive:** `AlertDialog`; failures follow E2 (modal open) or E3 (modal closed).
- **E6 — chat message failure:** in-flow error block + retry (E3 forbidden here).
- **E7 — copy:** funnel only (`toUserMessage` / `lib/auth-errors.ts`). Never interpolate raw errors, payloads, or identifiers into user copy.
- **E8 — settle:** every action ends in idle, loading, success, or error. No infinite spinner; conflicting controls disabled while pending; values preserved across recoverable failures.

## 3. Known deviations and backlog (not new surfaces)

- Toast `uniqueID`/`collisionBehavior` are unused anywhere in `src` (zero hits 2026-09-14) — repeatable failures can stack duplicate toasts. Roll out stable IDs per call site as §15 hardening; `AppToasts` dedupe rides the same mechanism.
- `ThreadView.tsx` `Text type="supporting"` status lines are statuses, not errors — they stay.
- Blocked by library: Astryx 0.5.2 `TextInput` props extend `BaseProps` (`React.HTMLAttributes`), so `autoComplete`/`name` are not accepted ("through Astryx-supported props only" per the readiness audit). No casts, no spread hacks — revisit on an Astryx upgrade, not as custom code.
