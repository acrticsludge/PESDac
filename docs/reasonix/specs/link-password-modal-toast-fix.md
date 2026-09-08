# Spec: link-password in My Profile + toast-over-modal fix

Status: Proposed
Audit basis: `docs/audits/2026-09-08-link-password-modal-toast-audit.md`
Stack: Astro + React 19 + Astryx 0.5.2 + StyleX + `PESDacMockupTheme` (per `AGENTS.md`; `CLAUDE.md` Next.js/Supabase references are stale for this repo and do not apply).

## 1. Problem

Google-only users add a password from My Profile > Authentication > Email + password > Add. Two failures combine:

1. The `POST` to link the password 404s in the reported session, so linking never succeeds.
2. When it fails, the error toast renders behind the open `ProfileDialog` and is blurred by the dialog backdrop, so the user cannot read it.

Trailing defects in the same flow (stale linked-account list, upstream-401 triggering global logout, over-broad cookie forwarding, unguarded upstream body, dead-end accounts-error state) make the feature fragile even after the 404 is gone.

## 2. Users

- Google-only signed-in users adding a password as a second sign-in method.
- Credential users are out of scope for the link form (they use Change password); the spec must not alter their flow except to keep shared toast behavior consistent.

## 3. Goals

1. `POST {PUBLIC_API_BASE_URL}/api/v1/auth/link-password` with `{ newPassword }` works from the profile modal when both dev servers are current; a stale worker or env drift is detectable via a documented probe instead of a mystery 404.
2. Every link-password outcome (validation, success, recoverable server failure) is visible while the modal stays open: field errors inline, server/global errors as a sharp toast above the dialog backdrop, announced to screen readers.
3. Post-success UI reflects the new credential without a reload.
4. Upstream BetterAuth failures do not log the user out; only genuine backend 401s (invalid/expired JWT) trigger the global auth-required flow.
5. No visual redesign: Astryx components, `PESDacMockupTheme`, spacing, typography, colors, radii, dialog size (`min(1120px, calc(100vw - 2rem))`, `80dvh`) unchanged.

## 4. Non-goals

- No new auth methods, no password-policy change (8-128 stays), no change to signup/signin/Google OAuth/2FA/logout/delete flows.
- No Astryx upgrade, no Tailwind, no global CSS, no theme edit, no custom toast/dialog recreation.
- No second link-password endpoint or path change; the contract path is fixed.
- No retry-storm or auto-retry on mutations; retries stay limited to the existing token-mint transient policy.

## 5. User flows

### F1: Link password happy path

1. Authenticated Google-only user opens My Profile > Authentication.
2. Sees "Email + password / Add a password so you can also sign in with email." with Add button.
3. Clicks Add -> "Link a password" card opens with New password + Confirm new password.
4. Enters valid matching password (>=8 chars), clicks Link password (or Enter).
5. Sees loading on the button, then success toast above the modal, form closes and clears, Authentication section now shows the Change row (credential present) without reload.

### F2: Client validation

- New password < 8 chars -> inline `status` error on New password field, no request.
- Mismatch -> inline `status` error on Confirm field, no request.
- > 128 chars -> inline error on New password (new; currently server-only).

### F3: Server failure while modal open

- Any recoverable server/network/auth-service failure -> sharp error toast above the modal (topEnd), modal stays open, form values preserved, button loading clears, focus remains in the form.
- Genuine backend 401 (JWT invalid) keeps existing global behavior (session-expired toast + logout + navigate to `/login`).

## 6. Functional requirements

### FR1: Contract (unchanged path)

- Frontend MUST call `apiFetch("/auth/link-password", { method: "POST", body: { newPassword } })`, which resolves to `POST {PUBLIC_API_BASE_URL}/api/v1/auth/link-password`. No hardcoded host, no duplicated prefix.
- Backend MUST keep `POST /api/v1/auth/link-password` (`backend/app/routers/auth.py` + `backend/app/main.py` mount) with deps order: JWT (`get_current_user`) -> origin check -> rate limit (5/300s per IP) -> BetterAuth `POST {BETTER_AUTH_URL}/api/auth/set-password`.
- Success MUST be HTTP 200 `{ ok: true }`. Failures MUST use the envelope `{ error: { code, message } }` via `error_body`.

### FR2: Toast above modal

- Error AND success toasts triggered from `AuthenticationSection` MUST paint above the open `ProfileDialog` dialog + `::backdrop`, sharp (no backdrop blur over the toast), at the existing `topEnd` position with `maxVisible: 3`.
- MUST use the existing Astryx `useToast()` / `LayerProvider` plumbing; MUST NOT introduce a custom toast, custom z-index arms race, or global CSS override.
- Screen-reader announcement (existing `useAnnounce` path) MUST still fire once per toast; F6 focus affordance MUST keep working.

### FR3: Inline validation

- Keep existing split: length -> New field, mismatch -> Confirm field, server errors -> toast only (no bottom-of-card text, per slice 12E/15).
- Add max-length (128) inline check mirroring `LinkPasswordIn` so over-long input never costs a round trip.

### FR4: Fresh linked-account state

- After successful link (and after successful unlink / Google link), the Authentication section MUST reflect the new method list without a full reload.
- Acceptable mechanisms: explicit refetch of `apiGetAccounts` after `refreshAccounts()`, or a version/epoch signal that `useAccounts()` subscribes to. A cache-clear with no subscriber update is NOT acceptable (current bug).
- `handleLinkGoogle` MUST refresh accounts and show a success toast; `handleUnlinkGoogle` MUST show a success toast (currently silent) and refresh visibly.

### FR5: Error semantics

- BetterAuth upstream non-success MUST NOT surface as backend 401 to `apiFetch` unless the JWT itself is invalid. Map upstream 401/4xx/5xx to non-401 backend statuses (`AUTH_VALIDATION` for upstream 422, `AUTH_ERROR`/`AUTH_UNREACHABLE` otherwise) so the global `AUTH_REQUIRED_EVENT` logout fires only for genuine session loss.
- `toUserMessage` MUST have an explicit `AuthServiceError` branch returning its user-safe message (currently implicit via generic Error branch).
- Upstream JSON MUST be shape-guarded before reading `message`; unexpected shapes fall back to the safe default copy, never throw inside the handler.
- Forward ONLY the BetterAuth session cookie upstream, not the entire `Cookie` header.
- 404 copy stays `"That didn't work. Please try again later."`; 5xx copy stays `"That didn't work on our end. Please try again later."`. Do not reintroduce "Restart the server" user copy.

### FR6: Accounts error state

- When `useAccounts()` is `error`, the Authentication section MUST offer a visible retry (e.g. retry control re-invoking the fetch) instead of silently hiding both Add and Change rows. Row-description copy `"Couldn't load link status."` may remain as a supplement, not the only signal.

## 7. Acceptance criteria

- [ ] AC1: With current backend + frontend running, OpenAPI contains `POST /api/v1/auth/link-password`; unauthenticated `POST` returns 401 envelope (not 404); authenticated valid link returns 200 `{ok:true}` and the credential appears in the section without reload.
- [ ] AC2: With the profile dialog open on desktop and on <=640px, forced link failures (422 validation, 429 rate-limit, 502 unreachable via stubbed upstream, offline via aborted fetch) each show a sharp error toast above the modal; the toast is readable (not blurred), announced, and the modal stays open with values preserved.
- [ ] AC3: Short password, mismatched confirm, and >128-char password each show the correct inline field error with zero network requests (verify via network log).
- [ ] AC4: Upstream 401 during link shows a recoverable error toast and does NOT navigate to `/login` nor clear the session; genuine backend 401 still triggers the session-expired flow exactly once.
- [ ] AC5: After link/unlink/Google-link, the Authentication rows update without reload; accounts-error state shows a retry path.
- [ ] AC6: Existing Astryx UI unchanged (dialog size, theme, spacing, button variants); no new global CSS; no Astryx version change.
- [ ] AC7: `python -m pytest` (backend), `npm.cmd test` + `astro check` + `astro build` (frontend), and `git diff --check` pass; new/updated regression tests cover FR4-FR6 error branches.

## 8. Constraints

- `AGENTS.md` is authoritative for UI: smallest possible change, real Astryx components only, preserve `PESDacMockupTheme` and `src/styles/global.css` foundation imports.
- Auth is high-risk per `CLAUDE.md` risk escalation: activate `security-and-hardening`, `api-and-interface-design`, `test-driven-development`, `doubt-driven-development` for the cookie/error-status decisions; record the decision (forward-only-session-cookie + non-401 upstream mapping) in the plan report.
- Never log secrets, tokens, passwords, or request bodies; method + path + safe reason only.
- Work on a feature branch, never directly on main; do not commit unless the user explicitly asks (match existing prompt convention: report, don't push).

## 9. API / interface requirements

- Request: `POST /api/v1/auth/link-password`, headers `Authorization: Bearer <jwt>`, `Content-Type: application/json`, body `{ newPassword: string(8-128) }`.
- Responses: `200 {ok:true}`; `401 {error:{code:UNAUTHORIZED}}` (JWT only); `403 {FORBIDDEN}`; `422 {VALIDATION_ERROR|AUTH_VALIDATION}`; `429 {RATE_LIMITED}` with `Retry-After`; `502 {AUTH_UNREACHABLE}`; `500 {INTERNAL}`. Upstream statuses are never forwarded as backend 401.
- Frontend `linkPassword(newPassword): Promise<void>` keeps its signature; `refreshAccounts()` keeps its name but MUST gain an observable refetch trigger consumed by `useAccounts()`.

## 10. Data requirements

- No schema change. BetterAuth owns the credential account row; PESDac backend owns no new tables. `refreshAccounts` invalidation must be identity-scoped (existing `TaggedCache` user-id guard stays).

## 11. Security requirements

- Server-side JWT verification + ownership (`get_current_user` upsert by `sub`) unchanged.
- Origin allowlist + per-IP rate limit unchanged; verify `Retry-After` still sent on 429.
- Session-cookie-only forwarding; no password/token logging; no stack-trace leakage (generic envelope + server-side ref log per `main.py:_internal`).
- No auto-retry on the link mutation itself; no password value in logs, toasts, or error details.

## 12. Testing requirements

- Backend: keep `test_link_password_route_is_registered`; add tests for upstream-401-not-ours-401 mapping, malformed upstream body fallback, and session-cookie-only forwarding.
- Frontend: add `apiFetch`/`linkPassword` boundary tests for `AuthServiceError` copy, upstream-mapped 4xx toast copy, and accounts-refetch-after-link (no real network; reuse the existing `__setFetchForTesting` router pattern).
- Browser: profile-dialog-open toast layering capture (devtools top-layer/popover order + screenshot), plus F1/F2/F3 flows on desktop and narrow viewport. Build alone is not acceptance.

## 13. Rollout / rollback

- Rollout: backend + frontend together (contract unchanged, so order is flexible, but verify with the live 401-vs-404 probe after deploy). No migration, no env-var change, no flag.
- Rollback: revert the feature branch; the previous envelope + inline-error behavior is self-contained in `auth.py` / `auth.ts` / `sections.tsx`. No data cleanup needed (a linked credential already written stays valid).
