# PESDac Authentication Flow Lockdown — Authoritative Spec

This is the authoritative auth implementation spec for MiniMax M3.

Read this file together with:

- AGENTS.md
- docs/design/DESIGN.md
- docs/audits/2026-09-07-pesdac-full-stack-readiness-audit.md
- docs/reasonix/specs/error-states.md
- docs/reasonix/specs/betterauth-integration.md
- docs/reasonix/plans/pesdac-auth-flow-lockdown-plan.md

Important scope rule: this document locks down authentication, account lifecycle, error handling, UX state communication, and the integration boundary for planned product features. It does not authorize removing dummy/demo/planned features. Keep planned UI and mock behavior; make its state honest and future-backend-compatible.

## MiniMax operating rules

1. Inspect the current file before editing it.
2. Preserve existing working-tree changes and the Astryx 0.5.2 UI hierarchy.
3. Implement one task from the companion plan at a time.
4. For every async operation, explicitly define start, success, failure, timeout, cancellation, retry, and stale-result behavior.
5. For every user-visible failure, explain what happened and what the user can do next.
6. Use Astryx components and the existing PESDacMockupTheme only.
7. Never log or render passwords, cookies, OAuth codes, raw JWTs, secrets, full claims, or provider stack traces.
8. Do not claim that an in-memory/demo operation is persisted.
9. Add a regression test for every corrected edge case.
10. Do not report completion while a Critical or Required item remains open.

## Current implementation truth

The companion full-stack audit is the source for current findings. In particular, treat these as active until verified fixed:

- Google sign-in currently has a non-awaited promise inside a try/catch.
- Token minting is not timeout-bounded and failures are flattened into null.
- Account deletion can leave BetterAuth/backend data split.
- SSR session bootstrap is cached at module scope and must be invalidated across transitions/user changes.
- Backend JWT verification needs issuer/audience/algorithm/time/kid-refresh hardening.
- The app needs a React error boundary.
- Profile/auth operations need explicit retry/timeout/partial-success states.
- Chat, attachments, sharing, library, and AI/SSE surfaces are planned and must remain.

## Non-negotiable user experience contract

For every action, the UI must communicate:

- what is happening;
- whether it is validating, sending, redirecting, or waiting;
- whether the action is still active;
- success;
- safe failure reason;
- next action;
- whether data was preserved, rolled back, or partially changed;
- whether retry is safe.

Use Astryx toast for small recoverable operations. Use an Astryx modal/dialog for destructive or security-sensitive decisions. Never leave an infinite spinner, silent failure, false success message, or blank screen.

## Required state vocabulary

Use explicit state names or an equivalent state machine. Avoid booleans that permit impossible combinations.

- idle
- validating
- loading/checking
- submitting
- redirecting
- awaiting-callback
- verifying-2fa
- success
- error
- timeout
- canceled
- rate-limited
- partial-success
- blocked-by-auth
- planned/local-only

## Link-password route contract

The email/password linking action is a real backend flow, not a frontend-only
placeholder. `frontend/src/lib/auth.ts` must call
`POST {PUBLIC_API_BASE_URL}/api/v1/auth/link-password` with `{ newPassword }`.
The backend router must remain mounted at exactly `/api/v1`, and the endpoint
must preserve the existing auth, origin, rate-limit, and error-envelope
contracts. A route-registration test is required so a bad router prefix or
missing `include_router` cannot reach the browser as an unexplained 404.

Local verification requires: restart the backend from `backend/`, restart or
force-refresh the Astro dev server, confirm the endpoint appears in
`/api/openapi.json`, and confirm an unauthenticated request returns the
expected `401` envelope rather than `404`.

Each state must define which controls are enabled, what text/toast/modal is shown, what focus does, and whether retry is safe.

# PESDac Authentication Flow Lockdown

## Implementation brief for MiniMax M3

**Repository:** `PESDac`

**Primary objective:** Make the complete authentication and account-lifecycle flow reliable, secure, observable, and ready to serve as the foundation for the rest of the product.

**Do not start core chat/product work until this spec is complete.**

This is an implementation specification, not a redesign request. Implement the work in small, verified slices. Preserve the current Astryx UI, current PESDac theme, existing route structure, and current behavior unless this document explicitly changes behavior.

---

## 1. Required skills for the implementer

Use these skills in this order. Read the relevant `SKILL.md` completely before working in that area.

1. **`debugging-and-error-recovery`**
   - Trace failures from browser action through Astro/React, BetterAuth, FastAPI, database, and back to the UI.
   - Reproduce each failure before changing it.
   - Preserve useful error context while hiding secrets and internal details from users.

2. **`planning-and-task-breakdown`**
   - Break the work into the phases and checkpoints in this document.
   - Keep each implementation task small enough to review independently.
   - Do not combine auth security, UI redesign, and unrelated chat features in one change.

3. **`better-auth-best-practices`**
   - Use BetterAuth as the source of truth for users, sessions, OAuth, email/password, 2FA, and account linking.
   - Do not invent a second authentication system in FastAPI.

4. **`better-auth-security-best-practices`**
   - Verify trusted origins, CSRF protections, cookies, OAuth state/PKCE, session expiry, rate limits, account enumeration behavior, and token handling.

5. **`security-and-hardening`**
   - Audit authorization boundaries, JWT verification, proxy headers, secret handling, logging, dependency risks, and destructive account operations.

6. **`code-review-and-quality`**
   - Review every completed slice across correctness, readability, architecture, security, and performance.
   - Findings must be categorized as Critical, Required, Optional, or FYI.

7. **`frontend-ui-engineering`**
   - Implement clear loading, error, retry, empty, disabled, and success states.
   - Check keyboard access, focus management, responsive layouts, and screen-reader announcements.

8. **`accessibility`**
   - Audit auth forms, dialogs, toasts, inline errors, focus recovery, and destructive confirmations against WCAG 2.2 AA.

9. **`test-driven-development`**
   - Add regression tests before or with each bug fix.
   - Favor behavior tests over implementation-detail tests.

10. **`observability-and-instrumentation`**
    - Add safe server-side structured logging and request/error references where needed.
    - Never log passwords, OAuth codes, access tokens, refresh tokens, cookies, raw JWTs, or full claims.

### Project-specific rules

- Astryx 0.5.2 is mandatory.
- Use existing Astryx components whenever an appropriate component exists: `Button`, `TextInput`, `Dialog`, `Toast`, `Banner`, `Text`, `VStack`, `HStack`, `Card`, `Theme`, and related primitives.
- Do not replace Astryx with custom HTML/CSS or another UI library.
- `frontend/src/theme/PESDacMockupTheme.js` and `docs/design/DESIGN.md` are authoritative.
- Do not redesign the login/signup layout, change colors, change spacing, or modify the theme unless explicitly required to fix a functional or accessibility defect.
- Do not add Tailwind or broad global CSS selectors.
- Preserve unrelated user changes already present in the working tree.
- Do not silently delete existing features, routes, test fixtures, or mock data.

---

## 2. Current stack and verified baseline

- Frontend: Astro 6, React 19, Astryx 0.5.2, StyleX, BetterAuth client, Cobe.
- Backend: FastAPI, SQLAlchemy, PostgreSQL/SQLite test support, BetterAuth JWKS verification.
- Auth frontend entry points:
  - `frontend/src/components/auth/AuthLayout.tsx`
  - `frontend/src/components/auth/AuthGate.tsx`
  - `frontend/src/lib/auth.ts`
  - `frontend/src/lib/auth-client.ts`
  - `frontend/src/pages/api/auth/[...slug].ts`
  - `frontend/src/middleware/auth.ts`
- Auth/backend entry points:
  - `backend/app/auth/betterauth.py`
  - `backend/app/deps.py`
  - `backend/app/routers/auth.py`
  - `backend/app/routers/users.py`
  - `backend/app/routers/profiles.py`
  - `backend/app/main.py`
  - `backend/app/config.py`
  - `backend/app/rate_limit.py`
- Current frontend verification baseline:
  - `cd frontend; npm.cmd run astro -- check`
  - `cd frontend; npm.cmd run build`
- Current backend verification baseline:
  - `cd backend; python -m pytest`
- Existing backend tests pass at the time this spec was written.
- There are no adequate frontend or browser-level auth tests yet.
- Root `npm test` is currently a placeholder that intentionally fails with `no test specified`; it must be replaced with a real repository verification command or clearly documented as not being the canonical test command.
- A dependency audit currently reports high-severity issues through the Astro/Sharp dependency tree and a low-severity esbuild issue. Dependency remediation must be handled in a separate, compatibility-tested task; do not casually change Astro or Astryx versions during auth work.

---

## 3. Definition of done

The auth flow is not complete until all of the following are true:

- A new user can sign up with email/password, see deterministic validation, and reach the authenticated app only after auth state is confirmed.
- An existing user can sign in with email/password and Google OAuth.
- Google OAuth works on localhost using the configured client ID, callback URL, trusted origin, and BetterAuth server configuration.
- OAuth failure, cancellation, invalid client, callback mismatch, network failure, and expired state all produce a useful recoverable UI state.
- A user requiring 2FA can complete the second-factor step, retry an invalid code, go back, and recover from expired/invalid challenges.
- Logout clears frontend session state, invalidates the BetterAuth session, clears cached user data, and gives honest feedback when one part fails.
- Session expiry and revoked/invalid backend tokens return the user to the login flow without infinite redirects or blank screens.
- Account deletion is explicit, re-authenticated where required, idempotent enough to retry, and cannot leave a misleading success state.
- Profile/account data has a clear ownership boundary: BetterAuth owns identity/account fields; the PESDac backend owns application profile/preferences.
- Frontend API errors and backend errors use one documented envelope.
- Backend startup fails safely when required production configuration is missing.
- JWT verification checks the correct signature, algorithm, issuer, audience, time claims, subject, email, and key ID behavior.
- Sensitive endpoints have effective rate limiting that works across deployed workers/processes or have a documented deployment constraint.
- Every auth operation has loading, success, error, retry/cancel, and disabled states where applicable.
- No auth page can render as a blank page or silently swallow an exception.
- Automated tests cover the failure paths listed below.
- `astro check`, frontend build, backend tests, and browser smoke tests pass.

---

## 4. Known gaps to fix

### Critical correctness and security gaps

#### 4.1 Google OAuth promise is not awaited

File: `frontend/src/components/auth/AuthLayout.tsx`

`handleGoogleSignIn()` starts `signInWithGoogle()` with `void` inside a `try/finally`. The `try/catch` cannot catch a rejected promise, and `isGoogleLoading` can reset before the redirect/error completes.

Required result:

- Await the OAuth call inside the handler.
- Normalize provider errors into a safe user-facing message.
- Keep the button disabled while the redirect is being initiated.
- Handle popup/redirect cancellation without an unhandled rejection.
- Add a regression test or browser test that forces the OAuth call to reject.

#### 4.2 Backend token acquisition is not covered by the API timeout

File: `frontend/src/lib/auth.ts`

`getBackendToken()` performs a fetch before `apiFetch()` starts its timeout. A stalled auth endpoint can therefore leave a user operation pending indefinitely.

Required result:

- Put a timeout around token acquisition as well as the API request.
- Use one abort/timeout utility with a clear distinction between timeout, abort, network, and server errors.
- Ensure callers can cancel the whole operation.
- Do not turn a timeout into a false success or silently return `null` for every failure.

#### 4.3 Account deletion ordering can orphan application data

File: `frontend/src/lib/auth.ts`

The current flow deletes the BetterAuth user first and then attempts to call the backend delete endpoint. If the backend token must be minted after BetterAuth deletion, the second operation may fail, leaving backend-owned data behind.

Required result:

- Choose and document one safe deletion strategy:
  1. Preferred: authenticated server-side orchestration that deletes application data and BetterAuth identity as one coordinated workflow, with retry/reconciliation semantics; or
  2. Capture/authorize the backend deletion before deleting the BetterAuth identity, then delete the identity, then record completion; or
  3. Use an explicit deletion job/state machine if the two systems cannot be transactional.
- Never show â€œaccount deletedâ€ until the contract says deletion is complete or clearly queued.
- Make retry behavior safe and idempotent.
- Add tests for backend failure before, during, and after identity deletion.
- Do not log deletion tokens or personal data.

#### 4.4 Production can boot with invalid configuration

File: `backend/app/main.py`

The import-time fallback calls `create_app(validate=False)` when environment configuration is missing or invalid. That is convenient for tests but dangerous for a deployed process.

Required result:

- Production startup must fail fast when required configuration is absent or invalid.
- Test configuration must be explicit, not inferred from missing variables.
- If an unvalidated app factory is retained for tests, it must not be the production `app` fallback.
- Log which configuration category is missing, never the secret value.
- Add startup tests for valid production config, missing database URL, missing BetterAuth URL/secret, invalid origins, and test mode.

#### 4.5 JWT verification is incomplete

File: `backend/app/auth/betterauth.py`

Current verification disables audience validation and does not enforce issuer. Unknown key IDs can fail until the one-hour JWKS cache expires. Broad catches hide operational failures.

Required result:

- Validate the expected algorithm and reject algorithm confusion.
- Validate issuer and audience using configured values.
- Validate required time claims according to BetterAuthâ€™s token contract.
- Require a valid subject and correctly validated email claim where the application contract needs it.
- Refresh JWKS immediately once when an unknown `kid` is encountered, then retry verification once.
- Use bounded HTTP timeouts and distinguish JWKS outage from invalid user token internally.
- Do not reveal verification internals to the client.
- Add tests for expired tokens, wrong issuer, wrong audience, wrong algorithm, invalid signature, missing claims, unknown key ID, and JWKS outage.

### High-priority product and architecture gaps

#### 4.6 Chat is still a local/mock flow

Files: `frontend/src/lib/responder.ts`, `frontend/src/lib/session.ts`, `backend/app/models/chats.py`, `backend/app/routers/chats.py`

The frontend still uses an in-memory session store and deterministic responder. The backend currently stores chat containers but not message bodies, streaming state, or AI results.

This is out of scope for the first auth patch, but the auth lock-down must leave a clean authenticated API seam for the next phase:

- authenticated user identity must be stable across frontend and backend;
- API failures must not be confused with fake assistant responses;
- unauthorized/expired sessions must be handled consistently;
- draft and pending state must survive a failed request without pretending it was persisted.

Do not implement the AI/chat backend in this auth task unless required to test auth integration.

#### 4.7 Most preferences are not persisted

Study, assistant, shortcuts, and language settings are primarily local/session state while backend profile schemas imply persistence.

For this auth phase:

- document which settings are intentionally local-only;
- ensure identity/profile values do not claim to be saved when they are not;
- ensure sign-out/sign-in does not leak one userâ€™s preferences to another;
- add a follow-up task for durable preference persistence.

#### 4.8 Account field ownership is ambiguous

Backend profile PATCH schemas currently permit `displayName` and `email`, while BetterAuth owns identity/account fields.

Required result:

- Define canonical ownership.
- Prefer BetterAuth endpoints for email/name/account identity changes and the PESDac backend for application profile/preferences.
- Reject or remove duplicate account-field mutations from the profile API, or explicitly synchronize them through a trusted server workflow.
- Update UI copy and API types to match the ownership contract.

### Unimplemented controls that affect auth/product readiness

- `Study Library` currently has a dead `href="#"` path.
- The settings navigation contains a dead `href="#"` path.
- Attachments are staged as local `File` objects but do not have an upload API, server ID, progress, validation, quota, or cleanup flow.
- Share links are not implemented in the current backend/UI contract.

For this task, do not pretend these are available after login. Either mark them disabled/coming soon with an honest state or keep them as explicit follow-up tasks. Do not make dead controls appear functional.

### Error and resilience gaps

#### 4.9 No React error boundary

`frontend/src/components/AppToasts.tsx` listens for unhandled promise rejections, but this does not catch render errors, lifecycle errors, or synchronous event errors.

Required result:

- Add an app-level React error boundary using existing project UI primitives.
- Render a recoverable error state, not a blank screen.
- Provide a retry/remount action and a safe route back to login/home.
- Display a non-sensitive reference ID if an error is reported.
- Preserve developer console diagnostics in development.
- Add a test that intentionally throws during render.

#### 4.10 Error envelope consistency must be completed and protected

The working tree contains slice-13 changes for HTTP exception and chat/health envelope consistency. Treat those changes as in progress; do not revert them.

Required final contract:

```json
{
  "error": {
    "code": "STABLE_MACHINE_CODE",
    "message": "Safe human-readable message.",
    "details": {}
  }
}
```

- `details` is optional and must not contain secrets or raw exception traces.
- Validation errors may include field paths and safe validation messages.
- FastAPI `HTTPException`, validation errors, rate-limit responses, origin failures, not-found responses, and internal errors must use the same envelope.
- Frontend `apiFetch` must parse the envelope and preserve `code`, `message`, `details`, HTTP status, and a request/reference ID when available.
- Unknown response shapes must become a safe generic error, not a JSON parsing exception or blank state.
- Add contract tests for every response class.

#### 4.11 Logout errors are currently misleading

The frontend logout helper swallows backend and BetterAuth errors, while the UI has success/error handling around the call. This can make the UI report success even when one side failed.

Required result:

- Decide whether logout is best-effort or strict.
- Recommended behavior: always clear local state immediately, attempt server logout, and show a warning only when server revocation failed and the failure matters to the deploymentâ€™s security model.
- Return a typed result such as `{ localCleared, serverRevoked, error }` rather than hiding all failures.
- Never leave the user on an authenticated screen after local logout cleanup.

#### 4.12 Stateless backend JWT remains valid after logout unless revoked

The backend logout route is currently a no-op while BetterAuth handles the client session. If a backend JWT remains valid after logout, it may continue to authorize requests until expiry.

Required result:

- Document token lifetime and revocation behavior.
- Prefer short-lived backend access tokens plus a revocation/session-version strategy, or validate the BetterAuth session server-side for sensitive operations.
- Define what â€œlogoutâ€ guarantees.
- Add a test for a token used after logout according to the selected contract.

#### 4.13 Rate limiter is process-local and trusts forwarding headers

File: `backend/app/rate_limit.py`

The in-memory bucket map is unbounded and does not coordinate across workers. Raw `X-Forwarded-For` can also be spoofed unless the deployment trusts and sanitizes the proxy.

Required result:

- Use a bounded/shared store in deployed environments, or explicitly constrain deployment to one process and document the limitation.
- Add cleanup/size bounds for the in-memory fallback.
- Only trust forwarded IP headers from configured trusted proxies.
- Apply stricter limits to sign-in, sign-up, password changes, 2FA verification, password linking, OAuth initiation/callback, and account deletion.
- Return `Retry-After` for 429 responses.

---

## 5. Target auth behavior

### 5.1 Sign-up

1. User submits name, email, and password.
2. Client validates required fields and password policy immediately.
3. Submit button enters loading state and prevents duplicate submission.
4. Server performs BetterAuth sign-up with generic account-enumeration-safe errors.
5. On success, refresh the authoritative session and route to onboarding or `/new`.
6. On failure, show field-level errors when the field is known; otherwise show a form-level Astryx toast/banner.
7. Preserve entered non-secret fields when safe; never preserve or log passwords after a failed submission.

### 5.2 Email/password sign-in

1. Validate email/password locally.
2. Disable competing auth actions during submission.
3. Show an inline form error for invalid credentials without revealing whether the email exists.
4. If BetterAuth returns a 2FA challenge, transition to a clearly labeled second-factor state.
5. On success, refresh the session before navigating.
6. On network/server failure, offer retry without clearing the form unnecessarily.

### 5.3 Google OAuth

1. Validate that the client ID, BetterAuth provider config, base URL, trusted origins, redirect URI, and local port agree.
2. Start the redirect through the existing BetterAuth client/server integration.
3. Keep loading visible until redirect starts or the call returns an error.
4. Handle provider errors with safe messages for:
   - `invalid_client` / missing OAuth client;
   - redirect URI mismatch;
   - unauthorized test user;
   - access denied/cancelled;
   - expired/invalid state;
   - network/server failure.
5. After callback, fetch/refresh the session and route only after the session is known.
6. Never expose client secret values in frontend code or errors.

### 5.4 Two-factor authentication

- Code input accepts only the expected format.
- Verify button has loading and disabled states.
- Invalid code preserves the challenge and gives a retryable error.
- Expired challenge explains that the user must restart sign-in.
- Back returns to the previous auth state without creating duplicate sessions.
- Lockout/rate-limit responses are explicit and do not reveal unnecessary security detail.
- Focus moves to the code input when the challenge opens and to the error when verification fails.

### 5.5 Logout

- User invokes logout from the existing Astryx control.
- Control enters loading/disabled state.
- Local session cache, user-specific app state, drafts, and pending auth-sensitive operations are cleared.
- Backend/BetterAuth logout/revocation is attempted.
- Navigation goes to `/login` even if server logout reports a recoverable failure.
- A warning toast may explain that the local session ended but server revocation could not be confirmed.

### 5.6 Session restoration and expiry

- Initial session loading must not flash the authenticated app to logged-out users or vice versa.
- Expired/invalid sessions must produce one controlled redirect, not a redirect loop.
- An API 401 emits one auth-required event and all subscribers converge on the same logged-out state.
- Pending requests are aborted or safely rejected.
- The user sees a toast/banner such as â€œYour session expired. Please sign in again.â€
- Return URL handling must be allowlisted and must not permit open redirects.

### 5.7 Account deletion

- Destructive action uses an Astryx modal, not only a toast.
- Modal explains what will be deleted and whether deletion is immediate or queued.
- Require explicit confirmation; for production, require recent authentication/re-authentication if BetterAuth policy requires it.
- Show progress state and disable duplicate submits.
- On success, clear all local state and route to the logged-out landing page.
- On partial failure, show a clear recovery state with retry/support reference; never claim full success.

---

## 6. Error-state and UX matrix

Use toasts for small, recoverable operations. Use an Astryx modal for destructive, irreversible, security-sensitive, or blocking decisions.

| Operation | Loading state | Success | Failure | Recovery |
|---|---|---|---|---|
| Sign up | Button loading, form disabled | Navigate after session refresh | Inline field/form error | Edit and retry |
| Email login | Button loading | Navigate after session refresh | Generic credentials/network error | Retry/reset password follow-up |
| Google login | Google button loading | Redirect/callback | Provider-specific safe message | Retry Google or use email |
| 2FA verify | Verify loading | Continue login | Invalid/expired/rate-limited state | Retry or restart |
| Profile save | Row/button loading | Success toast | Roll back optimistic value | Retry |
| Export data | Button loading | Download/success toast | Error toast with retry | Retry |
| Clear chats/data | Confirmation modal | Success toast | Error toast; preserve data if failed | Retry |
| Logout | Button loading | Redirect to login | Local logout still occurs; warning if server revoke fails | Sign in again if needed |
| Delete account | Destructive modal + progress | Logged-out completion | Partial-failure recovery state | Retry/status/support reference |
| Session expiry | Global auth transition | Redirect to login | Session expired toast | Sign in |
| Backend unavailable | Local request loading | None | Service unavailable state | Retry with backoff |
| Render crash | Boundary fallback | None | Error boundary UI | Retry/remount/home |

Rules:

- Do not show both a noisy toast and a duplicate inline error for the same failure unless the toast announces a global consequence.
- Error text must say what happened and what the user can do next.
- Do not use raw exception messages for user-facing text.
- Every disabled control needs a reason available to assistive technology where the reason is not obvious.
- Keep toast durations long enough to read; critical messages require user dismissal or a modal.

---

## 7. API and security contract

### 7.1 Configuration

Document and validate these by environment:

- BetterAuth base URL.
- BetterAuth secret/server secret.
- BetterAuth trusted origins.
- Google OAuth client ID and client secret on the server only.
- Exact Google redirect URI(s) for localhost and production.
- Frontend origin allowlist.
- Backend database URL.
- Cookie secure/same-site policy.
- Trusted proxy configuration.
- Session/token expiry values.
- Rate-limit storage/configuration.

Never put Google client secrets, BetterAuth secrets, database URLs with credentials, or private keys in frontend `PUBLIC_*` variables.

### 7.2 Origin and CSRF

- Keep BetterAuth CSRF protection enabled.
- Configure exact trusted origins; do not use broad wildcards for localhost or production without a reason.
- Keep backend mutation origin checks.
- Decide and document the policy for requests with no `Origin`/`Referer` header; do not accidentally make production mutation protection depend on test behavior.

### 7.3 JWT/JWKS

The verifier must:

- parse the header defensively;
- allow only configured algorithms;
- resolve `kid` with bounded caching and one forced refresh;
- validate signature, issuer, audience, expiration, not-before, and required claims;
- avoid broad silent failure in a way that hides JWKS outages from operators;
- return only safe generic 401 responses to clients.

### 7.4 Authorization

- Every user-owned backend record is scoped by authenticated user ID from verified claims, never by a client-supplied user ID.
- Test cross-user access for every profile, chat, demo-state, export, and delete endpoint.
- Do not treat a valid frontend route as authorization.
- Ensure account deletion and export cannot be called for another user by changing a path or body identifier.

### 7.5 Logging

Log structured fields such as:

- event name;
- method and path;
- HTTP status;
- safe request/reference ID;
- latency;
- user ID hash or internal ID only when policy permits;
- error category.

Never log passwords, codes, cookies, Authorization headers, OAuth callback codes, raw tokens, or full personal profiles.

---

## 8. Implementation plan

Do these sequentially. Each phase must leave the repository buildable and testable.

### Phase 0 â€” Reconnaissance and contracts

- [ ] Read this spec, `AGENTS.md`, `docs/design/DESIGN.md`, and the existing BetterAuth/error-state specs.
- [ ] Record the current working-tree changes before editing; preserve them.
- [ ] Map each auth action to its BetterAuth endpoint, frontend helper, backend endpoint, UI component, loading state, and error state.
- [ ] Confirm the actual local ports, origins, callback URLs, cookies, and environment variable names.
- [ ] Write or update a compact auth flow diagram in the implementation notes.

**Checkpoint:** No code changes are accepted until the current OAuth and session configuration is understood.

### Phase 1 â€” Error primitives and frontend crash safety

- [ ] Define typed frontend errors: `ApiError`, `AuthError`, `TimeoutError`, `NetworkError`, `AbortError` or equivalent.
- [ ] Make `apiFetch` parse the standard error envelope and preserve status/code/details/reference ID.
- [ ] Add timeout/cancellation to token acquisition and API calls.
- [ ] Add the React error boundary and safe fallback UI using Astryx.
- [ ] Extend global async error handling only where it adds value; avoid duplicate toasts.
- [ ] Add tests for unknown response shapes, timeout, abort, 401, 403, 404, 422, 429, and 500.

**Checkpoint:** A simulated failed API request and a simulated render crash produce visible, recoverable UI rather than a blank page.

### Phase 2 â€” Complete email/password and 2FA flow

- [ ] Fix handler promise ownership and duplicate-submit behavior.
- [ ] Normalize sign-up/sign-in errors without account enumeration.
- [ ] Verify session refresh before navigation.
- [ ] Complete 2FA invalid, expired, retry, back, and rate-limited states.
- [ ] Add keyboard/focus behavior and accessible announcements.
- [ ] Add unit/component/browser tests for all branches.

### Phase 3 â€” Google OAuth hardening

- [ ] Fix the missing `await` in Google sign-in.
- [ ] Verify BetterAuth Google provider configuration and local callback URI.
- [ ] Verify Google Cloud OAuth consent screen, test users, client type, origins, and redirect URI.
- [ ] Validate trusted origins and callback allowlists.
- [ ] Add deterministic handling for invalid client, mismatch, denial, canceled flow, invalid state, and network failure.
- [ ] Add a localhost browser smoke test using a real test account when credentials are available; never commit credentials.

**Checkpoint:** A real localhost Google sign-in either completes or shows an actionable error; it never leaves a stuck spinner or blank page.

### Phase 4 â€” Session lifecycle and logout

- [ ] Make initial session restoration deterministic.
- [ ] Handle one coordinated 401/auth-required event.
- [ ] Abort/reject pending auth-sensitive requests after logout/expiry.
- [ ] Define server token revocation/session lifetime behavior.
- [ ] Make logout result typed and honest instead of swallowing all failures.
- [ ] Clear user-scoped local state on logout and user switch.
- [ ] Test refresh, expiry, invalid token, logout, and re-login.

### Phase 5 â€” Backend production safety and authorization

- [ ] Remove unsafe production unvalidated startup fallback.
- [ ] Complete JWT issuer/audience/time/algorithm/key-refresh validation.
- [ ] Normalize every backend error response and add contract tests.
- [ ] Review all ownership filters and cross-user tests.
- [ ] Harden rate limiter storage, cleanup, proxy IP handling, and `Retry-After`.
- [ ] Review CORS, CSRF, secure cookies, trusted origins, and security headers.

### Phase 6 â€” Account/profile lifecycle

- [ ] Define BetterAuth-owned versus PESDac-owned fields.
- [ ] Ensure profile saves have rollback and truthful persistence behavior.
- [ ] Implement safe export behavior and error state.
- [ ] Implement coordinated/idempotent account deletion.
- [ ] Add destructive confirmation modal and partial-failure recovery UI.
- [ ] Test deletion with backend unavailable, identity unavailable, timeout, retry, and repeated request.

### Phase 7 â€” Honest feature boundaries and follow-ups

- [ ] Replace or explicitly mark dead navigation controls.
- [ ] Document chat persistence/messages/SSE as a separate next-phase spec.
- [ ] Document attachments/uploads as a separate next-phase spec.
- [ ] Document share links as a separate next-phase spec.
- [ ] Decide which preferences are local-only versus backend-persisted.
- [ ] Add frontend and browser test infrastructure to the repository.

### Phase 8 â€” Dependency and release gate

- [ ] Review npm audit findings and upgrade only with compatibility tests.
- [ ] Do not upgrade Astryx without explicit approval.
- [ ] Run frontend type check/build, backend tests, and browser smoke tests.
- [ ] Run a final security review and inspect generated bundles/logs for secrets.
- [ ] Update this spec with completed items and remaining accepted risks.

---

## 9. Required test matrix

### Frontend/component tests

- Empty email, malformed email, missing name, short password.
- Duplicate submit while loading.
- Sign-up server rejection.
- Sign-in invalid credentials.
- Sign-in network timeout.
- Google provider rejection with a rejected promise.
- Google cancellation and callback error.
- 2FA invalid code, expired challenge, retry, back, and success.
- Session loading, authenticated, unauthenticated, and stale-cache transitions.
- 401 event causes one redirect and no loop.
- Logout clears state even when server call fails.
- Account deletion confirmation, cancellation, success, and partial failure.
- Toast announcements and modal focus.
- Error boundary fallback and retry.

### Backend tests

- Missing/empty/malformed Authorization header.
- Invalid, expired, wrong issuer, wrong audience, wrong algorithm, bad signature, missing `sub`, missing `email`.
- Unknown `kid` followed by successful JWKS refresh.
- JWKS timeout/outage.
- Startup validation and explicit test mode.
- Standard envelopes for HTTP exceptions, validation, rate limit, origin rejection, not found, and internal errors.
- CORS allow/deny behavior.
- CSRF/origin behavior for mutations.
- Cross-user access denial for every user-owned resource.
- Rate-limit threshold, reset, cleanup, proxy behavior, and `Retry-After`.
- Export/delete authorization and idempotency.

### Browser smoke tests

Run at minimum at 320px, 768px, 1024px, and 1440px:

1. Open `/login` while signed out.
2. Sign up with invalid values and verify accessible errors.
3. Sign up or sign in with a test account.
4. Refresh the authenticated page.
5. Open profile and save a value.
6. Sign out.
7. Sign in with Google on localhost.
8. Simulate backend unavailable and verify a recoverable state.
9. Simulate session expiry and verify the login redirect.
10. Open account deletion, cancel, then complete it in a disposable test account.

---

## 10. Acceptance checklist for MiniMax M3

Before reporting completion, MiniMax must provide:

- [ ] Files changed, grouped by phase.
- [ ] Any migration or environment-variable changes.
- [ ] Test commands executed and exact results.
- [ ] Manual/browser scenarios executed and results.
- [ ] Remaining known gaps and accepted risks.
- [ ] Any behavior intentionally deferred to the chat/core-product phase.
- [ ] Confirmation that no secrets were added to git.
- [ ] Confirmation that existing Astryx layout/theme was preserved.
- [ ] Confirmation that the working treeâ€™s pre-existing changes were not overwritten.

Do not report â€œauth completeâ€ if any Critical or Required item remains unresolved. If an item cannot be completed because an external service or credential is unavailable, mark it **Blocked**, explain the exact blocker, implement all local validation and error states around it, and provide the manual step needed to unblock it.

---

## 11. Suggested MiniMax execution prompt

Use the following instruction when handing this spec to MiniMax M3:

> Read `AGENTS.md` and `docs/reasonix/specs/pesdac-auth-flow-lockdown.md` completely before editing. First inspect the current working tree and preserve all existing changes. Work phase by phase; do not redesign the Astryx UI or implement chat features. For every task, reproduce the current behavior, write/adjust a regression test, make the smallest compatible change, run the focused test, then run the relevant frontend/backend verification. Use BetterAuth as the authentication source of truth. Do not create a parallel auth system. Treat every token, cookie, OAuth code, password, and personal field as secret. Never log them. Use the existing Astryx components and PESDac theme for all user-facing states. After each checkpoint, report changed files, tests, remaining risks, and whether the phase is complete. Stop and mark a task blocked when an external credential/service is required; do not fake a successful auth result.




## File-by-file completion gate

Before closing this spec, MiniMax must verify each file below and report the evidence. “No obvious bug found” is not evidence; a passing behavior test or manual scenario is required.

### Frontend

- frontend/src/components/auth/AuthLayout.tsx
- frontend/src/components/auth/AuthGate.tsx
- frontend/src/components/auth/OnboardingDialog.tsx
- frontend/src/components/auth/AuthBackground.tsx
- frontend/src/components/AppToasts.tsx
- frontend/src/components/Pesdac.tsx
- frontend/src/components/profile/ProfileDialog.tsx
- frontend/src/components/profile/sections.tsx
- frontend/src/components/chat/ThreadView.tsx
- frontend/src/components/chat/AttachButton.tsx
- frontend/src/components/layout/AppLayout.tsx
- frontend/src/components/layout/InitialSession.astro
- frontend/src/lib/auth.ts
- frontend/src/lib/auth-client.ts
- frontend/src/lib/async-action.ts
- frontend/src/lib/session.ts
- frontend/src/lib/chat.ts
- frontend/src/lib/responder.ts
- frontend/src/lib/attachments.ts
- frontend/src/middleware/auth.ts
- frontend/src/pages/api/auth/[...slug].ts
- frontend/src/pages/login.astro
- frontend/src/pages/signup.astro
- frontend/src/pages/index.astro
- frontend/src/pages/new.astro
- frontend/src/pages/profile.astro
- frontend/src/pages/subject/[subject].astro
- frontend/src/pages/subject/[subject]/[code].astro
- frontend/astro.config.mjs

For each frontend file, record:

- async actions and whether their promises are owned;
- loading/disabled state;
- success state;
- failure state;
- timeout/cancel behavior;
- stale result/unmount behavior;
- keyboard/focus/live-region behavior;
- whether the operation is real, local/demo, or planned;
- regression test or manual scenario.

### BetterAuth/database

- lib/auth.ts
- lib/auth-client.ts
- lib/db/schema.ts
- lib/db/index.ts
- lib/db/migrations/*
- frontend/src/pages/api/auth/[...slug].ts

Verify:

- environment validation;
- exact base URL/trusted origins;
- Google client ID/secret placement;
- CSRF/state/PKCE;
- session/cookie policy;
- password policy;
- 2FA/recovery;
- deletion freshness;
- audit logging;
- cascades and orphan detection.

### Backend

- backend/app/main.py
- backend/app/config.py
- backend/app/auth/betterauth.py
- backend/app/deps.py
- backend/app/rate_limit.py
- backend/app/routers/auth.py
- backend/app/routers/users.py
- backend/app/routers/profiles.py
- backend/app/routers/chats.py
- backend/app/routers/demo_state.py
- backend/app/routers/health.py
- backend/app/models/*
- backend/app/schemas/*
- backend/tests/*

Verify:

- authorization scope;
- error envelope;
- validation;
- transaction rollback;
- idempotency;
- rate limits;
- origin/CORS/CSRF;
- startup behavior;
- safe logging;
- cross-user denial;
- planned feature boundary.

## Planned-feature preservation rule

Do not remove or rewrite these as if they were defects:

- deterministic responder scenarios;
- static subject/demo threads;
- local custom chats;
- attachment staging;
- future upload processing;
- future study library;
- future share links;
- future AI/SSE messages;
- future durable preferences.

Instead, implement a visible planned/local/demo state, safe mock failure handling, and an adapter boundary for later integration.

## Required MiniMax handoff

At completion, report:

- files changed;
- task IDs completed;
- tests and exact output;
- manual/browser scenarios;
- any external credential/service blocker;
- remaining planned features;
- accepted risks;
- confirmation that no existing planned feature was removed;
- confirmation that current Astryx layout/theme was preserved.
