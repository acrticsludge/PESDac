# PESDac Authentication Flow Lockdown — Implementation Plan

This is the authoritative execution plan for MiniMax M3.

Read before implementation:

- AGENTS.md
- docs/design/DESIGN.md
- docs/audits/2026-09-07-pesdac-full-stack-readiness-audit.md
- docs/reasonix/specs/pesdac-auth-flow-lockdown.md
- docs/reasonix/specs/error-states.md

This plan refines the earlier auth plan into a file-by-file execution contract. Do not remove dummy/planned features. Do not redesign Astryx UI. Work sequentially unless a task is explicitly marked parallel-safe.

## Rules for every task

- Inspect the current file and diff before editing.
- Keep the working tree’s existing changes.
- Make the smallest coherent change.
- Add or update a regression test.
- Run the focused test before moving on.
- Define loading, success, error, timeout, cancel, retry, stale-result, and accessibility behavior.
- Use Astryx 0.5.2 and PESDacMockupTheme.
- Never log secrets or raw auth/provider errors.
- If an external Google/backend credential is unavailable, implement local handling and mark the live test blocked; never fake success.
- Keep planned/dummy surfaces and preserve future adapter signatures.

# PESDac Auth Flow Lockdown Ã¢â‚¬â€ Slice Plan

## Instructions for the implementer

Read these files before starting:

1. `AGENTS.md`
2. `docs/design/DESIGN.md`
3. `docs/reasonix/specs/pesdac-auth-flow-lockdown.md`
4. This file

This plan is intentionally sequential. Complete one task, verify it, and only then begin the next task unless a task is explicitly marked safe to parallelize.

Rules:

- Preserve all existing working-tree changes.
- Use Astryx 0.5.2 and the existing PESDac theme.
- Do not redesign the auth UI.
- Do not implement chat persistence, AI streaming, uploads, or sharing in this plan.
- Do not create a second authentication system.
- Use BetterAuth as the auth source of truth.
- Use `apply_patch` for edits.
- Add a regression test for every bug fix.
- Never log secrets, passwords, cookies, OAuth codes, raw JWTs, or authorization headers.
- Stop and report a blocker when a task requires an unavailable external credential or service. Do not fake success.

---

## Slice 0 Ã¢â‚¬â€ Baseline and implementation contract

### T1 Ã¢â‚¬â€ Capture repository baseline

**Goal:** Establish a clean factual starting point before editing.

**Actions:**

- Inspect `git status`, current diff, and recent commits.
- Record the existing in-progress API envelope changes, especially:
  - `backend/app/main.py`
  - `backend/app/deps.py`
  - `backend/app/routers/health.py`
  - `backend/app/routers/chats.py`
  - `backend/app/schemas/chats.py`
  - related tests and `docs/slices/slice-13-api-envelope-consistency.md`
- Run the frontend type check/build and backend test suite.
- Record exact pass/fail output in the implementation report.

**Acceptance criteria:**

- [ ] No pre-existing changes are overwritten.
- [ ] Baseline commands and results are documented.
- [ ] Existing slice-13 changes remain present.

**Verification:**

```powershell
git status --short
cd frontend; npm.cmd run astro -- check; npm.cmd run build
cd ..\backend; python -m pytest
```

**Dependencies:** None.

**Files likely touched:** None, unless a small implementation-notes file is created.

---

### T2 Ã¢â‚¬â€ Map the auth flow and configuration

**Goal:** Produce a concrete map before changing behavior.

**Actions:**

- Trace sign-up, email login, Google login, 2FA, session restoration, logout, profile save, export, and deletion.
- Map each flow to its frontend function, BetterAuth endpoint, backend endpoint, UI state, and test.
- Inventory environment variables without printing their values.
- Confirm local frontend origin, BetterAuth origin, backend origin, Google redirect URI, and cookie settings.

**Acceptance criteria:**

- [ ] Every auth action has a known owner and endpoint.
- [ ] No secret values are written to logs or notes.
- [ ] Unknown or contradictory configuration is listed as a blocker/risk.

**Verification:** Manual review of the map against source files.

**Dependencies:** T1.

**Files likely touched:** `docs/reasonix/specs/pesdac-auth-flow-lockdown.md` only if corrections are necessary.

---

## Slice 1 Ã¢â‚¬â€ Typed errors, API envelope, and crash safety

### T3 Ã¢â‚¬â€ Define the frontend error model

**Goal:** Give all frontend auth/API flows a predictable error shape.

**Actions:**

- Add or refine typed errors in `frontend/src/lib/auth.ts` or a focused error module.
- Preserve HTTP status, stable backend code, safe message, details, and reference ID.
- Distinguish API, auth, timeout, network, abort, validation, and unknown errors.
- Ensure unknown response bodies become safe generic errors.

**Acceptance criteria:**

- [ ] No caller needs to parse raw `response.json()` independently.
- [ ] No raw server exception text is shown by default.
- [ ] Error objects are serializable enough for logging/UI handling.

**Verification:** Unit tests for valid envelope, malformed JSON, empty body, and unknown shape.

**Dependencies:** T1.

**Files likely touched:**

- `frontend/src/lib/auth.ts`
- `frontend/src/lib/async-action.ts`
- new focused frontend test file(s)

---

### T4 Ã¢â‚¬â€ Complete backend error envelope normalization

**Goal:** Make every backend failure consumable through one contract.

**Actions:**

- Review the current slice-13 changes; do not revert them.
- Normalize `HTTPException`, validation errors, rate limits, origin failures, 404s, and 500s.
- Preserve safe headers such as `Retry-After`.
- Ensure internal errors have a reference ID and are logged server-side without sensitive data.
- Ensure `details` never contains traceback, tokens, or credentials.

**Acceptance criteria:**

- [ ] All tested 4xx/5xx responses use `{ error: { code, message, details? } }`.
- [ ] Frontend `apiFetch` can consume every tested response.
- [ ] Existing chat/health/auth contract tests remain compatible.

**Verification:**

```powershell
cd backend; python -m pytest
```

Add contract tests for 400, 401, 403, 404, 409, 422, 429, and 500.

**Dependencies:** T3.

**Files likely touched:**

- `backend/app/main.py`
- `backend/app/schemas/common.py`
- `backend/app/deps.py`
- `backend/app/routers/health.py`
- backend contract tests

---

### T5 Ã¢â‚¬â€ Add request timeout and cancellation primitives

**Goal:** Prevent auth/API operations from hanging indefinitely.

**Actions:**

- Add a shared timeout/abort helper.
- Cover `getBackendToken()` as well as the API request itself.
- Preserve caller cancellation.
- Distinguish timeout from user cancellation.
- Ensure a timed-out request cannot later update stale UI state.

**Acceptance criteria:**

- [ ] Token acquisition has a bounded timeout.
- [ ] API request has a bounded timeout.
- [ ] Aborted operations do not show a false success toast.
- [ ] Loading state always settles in `finally`.

**Verification:** Tests using fake timers or a controllable fetch mock.

**Dependencies:** T3.

**Files likely touched:**

- `frontend/src/lib/auth.ts`
- `frontend/src/lib/async-action.ts`
- frontend tests

---

### T6 Ã¢â‚¬â€ Add a React error boundary

**Goal:** Prevent render/lifecycle failures from producing a blank page.

**Actions:**

- Add an app-level error boundary around the React app shell and auth surfaces.
- Use existing Astryx primitives for the fallback UI.
- Provide retry/remount and safe navigation to login/home.
- Include a non-sensitive reference ID.
- Preserve detailed diagnostics in development only.

**Acceptance criteria:**

- [ ] A render exception produces visible recovery UI.
- [ ] Retry remounts the affected tree.
- [ ] The fallback is keyboard accessible.
- [ ] No raw stack trace or secrets are rendered to users.

**Verification:** Component test that throws during render; browser smoke test for fallback.

**Dependencies:** T3.

**Files likely touched:**

- `frontend/src/components/AppErrorBoundary.tsx`
- `frontend/src/components/AppToasts.tsx` if integration is needed
- app mounting component(s)
- frontend tests

---

### Checkpoint A Ã¢â‚¬â€ Error foundation

- [ ] T3Ã¢â‚¬â€œT6 complete.
- [ ] Frontend check/build passes.
- [ ] Backend tests pass.
- [ ] Simulated API failure is visible and recoverable.
- [ ] Simulated render failure is visible and recoverable.
- [ ] No auth UI redesign was introduced.

---

## Slice 2 Ã¢â‚¬â€ Email/password and 2FA correctness

### T7 Ã¢â‚¬â€ Harden sign-up and email sign-in handlers

**Goal:** Make primary credential auth deterministic.

**Actions:**

- Review `AuthLayout.tsx` handlers and every `void` async event callback.
- Await operations inside `try/catch` where the handler owns the promise.
- Prevent duplicate submits and competing Google/email submissions.
- Normalize BetterAuth errors without account enumeration.
- Refresh/confirm session before navigation.
- Preserve safe form values after recoverable errors; never retain/log passwords unnecessarily.

**Acceptance criteria:**

- [ ] Sign-up success navigates only after session confirmation.
- [ ] Sign-in success navigates only after session confirmation.
- [ ] Invalid credentials use a generic safe message.
- [ ] Loading state cannot settle before the request settles.
- [ ] Duplicate clicks create only one request.

**Verification:** Component tests for success, server error, network error, and duplicate click.

**Dependencies:** T3, T5.

**Files likely touched:**

- `frontend/src/components/auth/AuthLayout.tsx`
- `frontend/src/lib/auth.ts`
- frontend auth tests

---

### T8 Ã¢â‚¬â€ Complete the 2FA challenge state machine

**Goal:** Make second-factor auth recoverable and accessible.

**States:** `idle`, `verifying`, `success`, `invalid-code`, `expired`, `rate-limited`, `failed`.

**Actions:**

- Validate code format before request.
- Focus the code field when challenge opens.
- Move focus or announce error on failure.
- Keep the challenge on invalid code.
- Return to the prior sign-in state on Back.
- Restart auth on expired challenge.
- Honor rate-limit responses and `Retry-After`.

**Acceptance criteria:**

- [ ] Invalid code does not discard the challenge.
- [ ] Expired challenge offers restart.
- [ ] Back does not create a duplicate session.
- [ ] Loading and disabled states are visible and accessible.

**Verification:** Component tests for each state and keyboard navigation test.

**Dependencies:** T7.

**Files likely touched:**

- `frontend/src/components/auth/AuthLayout.tsx`
- auth helpers/tests

---

## Slice 3 Ã¢â‚¬â€ Google OAuth localhost flow

### T9 Ã¢â‚¬â€ Validate BetterAuth and Google configuration

**Goal:** Eliminate `invalid_client` and callback mismatch failures.

**Actions:**

- Inspect current BetterAuth provider configuration.
- Confirm Google Cloud OAuth consent screen is configured.
- Confirm OAuth client type is Web application.
- Confirm exact authorized JavaScript origins.
- Confirm exact authorized redirect URI used by BetterAuth.
- Confirm test user access and publishing/testing status.
- Confirm frontend/backend/BÃ¢â‚¬â€¹Ã¢â‚¬â€¹etterAuth origins are in trusted-origin and CORS allowlists.
- Document localhost values without committing secrets.

**Acceptance criteria:**

- [ ] Client ID used by BetterAuth matches the newly created Google credential.
- [ ] Client secret is server-only.
- [ ] Redirect URI exactly matches Google Cloud configuration.
- [ ] Test user can access the consent screen.
- [ ] No stale Google env values remain active.

**Verification:** Configuration review plus one real localhost test account.

**Dependencies:** T2.

**Files likely touched:**

- BetterAuth server configuration file(s)
- `.env.example` or safe configuration documentation
- no committed secret files

---

### T10 Ã¢â‚¬â€ Fix Google sign-in promise and UI states

**Goal:** Make Google OAuth failures catchable and visible.

**Actions:**

- Await the Google sign-in call in `AuthLayout.tsx`.
- Keep `isGoogleLoading` active until redirect starts or the operation fails.
- Normalize `invalid_client`, access denied, callback mismatch, invalid state, and network errors.
- Avoid duplicate toasts and inline messages.
- Keep the email form usable after Google failure.

**Acceptance criteria:**

- [ ] Rejected OAuth promise reaches the local error handler.
- [ ] Spinner/loading state always settles.
- [ ] The user receives an actionable safe message.
- [ ] No unhandled rejection appears in the console for simulated OAuth failure.

**Verification:** Component test with rejected OAuth promise; browser test for real localhost callback.

**Dependencies:** T7, T9.

**Files likely touched:**

- `frontend/src/components/auth/AuthLayout.tsx`
- `frontend/src/lib/auth.ts`
- auth tests

---

### T11 Ã¢â‚¬â€ Verify OAuth callback/session completion

**Goal:** Prevent successful provider authorization from landing in a blank or unauthenticated app.

**Actions:**

- Verify callback route behavior.
- Refresh/fetch session after callback.
- Handle callback errors and denied consent.
- Use an allowlisted return path only.
- Prevent redirect loops.

**Acceptance criteria:**

- [ ] Successful Google callback reaches the authenticated app.
- [ ] Failed callback reaches a visible login error state.
- [ ] Return URL cannot redirect to an arbitrary external origin.
- [ ] Refresh after callback preserves the session.

**Verification:** Browser smoke test with success, denial, callback error, and refresh.

**Dependencies:** T9, T10.

**Files likely touched:**

- `frontend/src/pages/api/auth/[...slug].ts`
- `frontend/src/lib/auth.ts`
- `frontend/src/middleware/auth.ts`
- auth browser tests

---

### Checkpoint B Ã¢â‚¬â€ Login methods

- [ ] Email sign-up/sign-in works.
- [ ] 2FA branches work.
- [ ] Google OAuth works on localhost with a real test user.
- [ ] Provider errors are visible and recoverable.
- [ ] No blank page, stuck spinner, or unhandled rejection occurs.

---

## Slice 4 Ã¢â‚¬â€ Session lifecycle and logout

### T12 Ã¢â‚¬â€ Make session restoration deterministic

**Goal:** Prevent auth flashes, stale cache, and inconsistent route state.

**Actions:**

- Review `initialSessionCache`, `useAuth`, `AuthGate`, middleware, and `InitialSession.astro`.
- Define one source of truth for initial session hydration.
- Ensure stale user state is cleared when the session is absent or belongs to another user.
- Ensure authenticated routes wait for session resolution.

**Acceptance criteria:**

- [ ] Signed-out users never see authenticated content during hydration.
- [ ] Signed-in users do not get redirected before hydration completes.
- [ ] Refresh produces the same auth state as a fresh navigation.
- [ ] User-specific local data cannot leak across accounts.

**Verification:** Browser tests with slow session response, no session, valid session, and expired session.

**Dependencies:** T3, T7.

**Files likely touched:**

- `frontend/src/lib/auth.ts`
- `frontend/src/components/auth/AuthGate.tsx`
- `frontend/src/components/layout/InitialSession.astro`
- `frontend/src/middleware/auth.ts`

---

### T13 Ã¢â‚¬â€ Coordinate 401/session-expiry handling

**Goal:** Convert expired backend auth into one controlled logout/re-login flow.

**Actions:**

- Deduplicate `AUTH_REQUIRED_EVENT` handling.
- Abort or reject pending protected requests.
- Clear auth-sensitive state once.
- Show one Astryx toast/banner.
- Redirect once to login with an allowlisted return path.

**Acceptance criteria:**

- [ ] One expired session causes one redirect.
- [ ] No redirect loop occurs.
- [ ] Pending requests do not repopulate stale authenticated state.
- [ ] User receives a readable expiry message.

**Verification:** Browser test with mocked 401 responses from multiple simultaneous requests.

**Dependencies:** T12.

**Files likely touched:**

- `frontend/src/lib/auth.ts`
- `frontend/src/components/auth/AuthGate.tsx`
- `frontend/src/components/AppToasts.tsx`

---

### T14 Ã¢â‚¬â€ Make logout honest and complete

**Goal:** Ensure logout clears local state and accurately reports server revocation.

**Actions:**

- Review `apiLogout()` and the logout action in `Pesdac.tsx`.
- Replace swallowed failures with a typed result.
- Clear local session/cache/drafts/pending operations regardless of server response.
- Define whether server logout is strict or best-effort.
- Ensure navigation goes to login after local cleanup.

**Acceptance criteria:**

- [ ] Logout cannot leave the user on authenticated content.
- [ ] A server logout failure is not falsely reported as total success.
- [ ] Local user-specific state is cleared.
- [ ] Re-login as another user cannot see the previous userÃ¢â‚¬â„¢s state.

**Verification:** Tests for successful logout, BetterAuth failure, backend failure, and both failures.

**Dependencies:** T12, T13.

**Files likely touched:**

- `frontend/src/lib/auth.ts`
- `frontend/src/components/Pesdac.tsx`
- `frontend/src/lib/session.ts`

---

### T15 Ã¢â‚¬â€ Define and enforce post-logout token behavior

**Goal:** Close the gap between UI logout and backend token validity.

**Actions:**

- Document backend token lifetime and revocation model.
- Choose short-lived tokens, session-version validation, revocation storage, or server-side session validation.
- Apply the chosen model to sensitive endpoints.
- Add a safe migration path if existing tokens are affected.

**Acceptance criteria:**

- [ ] The system has a documented guarantee for post-logout token use.
- [ ] Sensitive operations cannot rely on an indefinitely valid stale token.
- [ ] Tests reflect the selected revocation semantics.

**Verification:** Backend integration test using a token/session after logout.

**Dependencies:** T14, T19.

**Files likely touched:**

- `backend/app/auth/betterauth.py`
- `backend/app/deps.py`
- `backend/app/routers/auth.py`
- config/schema/tests as required

---

### Checkpoint C Ã¢â‚¬â€ Session lifecycle

- [ ] Restore, expiry, logout, and re-login pass.
- [ ] No redirect loops or stale user data.
- [ ] Post-logout token behavior is documented and tested.

---

## Slice 5 Ã¢â‚¬â€ Backend security and production safety

### T16 Ã¢â‚¬â€ Make startup validation fail safe

**Goal:** Prevent production from silently booting with missing configuration.

**Actions:**

- Separate explicit test app creation from production `app` creation.
- Make required config validation fail fast outside test mode.
- Validate database URL, BetterAuth URL/secret, origins, cookie policy, and required provider settings.
- Log configuration categories only, never values.

**Acceptance criteria:**

- [ ] Invalid production configuration prevents startup.
- [ ] Tests can still construct an explicit unvalidated/test app.
- [ ] Missing env values cannot produce a misleading healthy server.

**Verification:** Startup tests for valid, missing, and malformed configurations.

**Dependencies:** T2.

**Files likely touched:**

- `backend/app/main.py`
- `backend/app/config.py`
- backend startup tests

---

### T17 Ã¢â‚¬â€ Harden JWT and JWKS validation

**Goal:** Verify only authentic tokens issued for this application.

**Actions:**

- Validate configured algorithms only.
- Validate issuer and audience.
- Validate expiration/not-before and required claims.
- Refresh JWKS once for an unknown `kid`.
- Bound JWKS HTTP timeout.
- Distinguish operational logging from client response without leaking details.

**Acceptance criteria:**

- [ ] Wrong issuer/audience/algorithm/signature are rejected.
- [ ] Expired and not-yet-valid tokens are rejected.
- [ ] Unknown key IDs trigger one refresh attempt.
- [ ] JWKS outage produces safe 401 behavior and useful server logs.

**Verification:** Unit tests for all token cases and JWKS refresh behavior.

**Dependencies:** T2, T16.

**Files likely touched:**

- `backend/app/auth/betterauth.py`
- `backend/app/config.py`
- `backend/tests/test_security_unit.py`

---

### T18 Ã¢â‚¬â€ Harden origins, CORS, CSRF, and proxy identity

**Goal:** Make mutation protection match the deployment environment.

**Actions:**

- Review trusted origins and CORS exactness.
- Keep BetterAuth CSRF protection enabled.
- Define behavior for missing `Origin`/`Referer` headers.
- Trust `X-Forwarded-For` only when request came through configured trusted proxy infrastructure.
- Verify secure/same-site cookie behavior in local and production modes.

**Acceptance criteria:**

- [ ] Approved frontend origin succeeds.
- [ ] Unapproved origin is rejected.
- [ ] Mutation protection cannot be bypassed by spoofed forwarding headers.
- [ ] Local HTTP development remains usable without weakening production policy.

**Verification:** Backend security tests with allowed/denied origins and forwarded headers.

**Dependencies:** T16.

**Files likely touched:**

- `backend/app/config.py`
- `backend/app/deps.py`
- `backend/app/main.py`
- `backend/app/rate_limit.py`
- security tests

---

### T19 Ã¢â‚¬â€ Harden rate limiting

**Goal:** Protect sensitive auth operations under the actual deployment model.

**Actions:**

- Add bounded cleanup to the in-memory fallback.
- Decide whether deployed environments require Redis/another shared store.
- Apply endpoint-specific limits to auth and destructive operations.
- Return `Retry-After`.
- Avoid user enumeration through noticeably different limits/messages.

**Acceptance criteria:**

- [ ] Repeated auth attempts are limited.
- [ ] Limits apply across workers if the deployment has multiple workers.
- [ ] Memory cannot grow without bound in fallback mode.
- [ ] 429 responses have a stable envelope and retry guidance.

**Verification:** Rate-limit tests and, if applicable, multi-worker/shared-store integration test.

**Dependencies:** T18.

**Files likely touched:**

- `backend/app/rate_limit.py`
- `backend/app/routers/auth.py`
- `backend/app/routers/users.py`
- rate-limit tests/config

---

### Checkpoint D Ã¢â‚¬â€ Backend security

- [ ] T16Ã¢â‚¬â€œT19 complete.
- [ ] Backend tests pass.
- [ ] Auth failure response contract is stable.
- [ ] Startup is fail-fast outside explicit test mode.
- [ ] JWT and origin protections are covered by tests.

---

## Slice 6 Ã¢â‚¬â€ Profile, export, and account deletion

### T20 Ã¢â‚¬â€ Define identity/profile ownership

**Goal:** Remove ambiguous account mutations.

**Actions:**

- Decide which fields belong to BetterAuth and which belong to PESDac.
- Update backend schemas and routes accordingly.
- Update frontend types/forms/copy.
- Ensure email/name changes use the correct trusted workflow.

**Acceptance criteria:**

- [ ] The same field cannot be independently mutated by two systems.
- [ ] API contract and UI labels agree.
- [ ] Unauthorized account-field mutation is rejected.

**Verification:** Schema tests, API tests, and profile UI test.

**Dependencies:** T4, T17.

**Files likely touched:**

- `backend/app/schemas/profiles.py`
- `backend/app/routers/profiles.py`
- `frontend/src/components/profile/sections.tsx`
- `frontend/src/lib/auth.ts`

---

### T21 Ã¢â‚¬â€ Harden profile saves, export, and clear-data flows

**Goal:** Make account data operations truthful and recoverable.

**Actions:**

- Verify optimistic profile updates roll back on every failure.
- Ensure successful saves are confirmed by server response.
- Add export timeout, download failure, and retry handling.
- Confirm clear-data scope in UI and backend.
- Prevent duplicate destructive requests.

**Acceptance criteria:**

- [ ] UI never says saved when the server rejected the change.
- [ ] Export failure has retry and no corrupt download state.
- [ ] Clear-data action is explicit about what it removes.
- [ ] All data operations are scoped to current user.

**Verification:** Frontend and backend tests for success, timeout, 4xx, 5xx, and rollback.

**Dependencies:** T3, T4, T20.

**Files likely touched:**

- `frontend/src/components/profile/sections.tsx`
- `frontend/src/components/profile/ProfileDialog.tsx`
- `frontend/src/lib/auth.ts`
- `backend/app/routers/users.py`
- profile/user tests

---

### T22 Ã¢â‚¬â€ Implement safe account deletion workflow

**Goal:** Avoid orphaned data and false deletion success.

**Actions:**

- Choose coordinated deletion, pre-authorized deletion, or explicit deletion job/state machine.
- Make repeated requests safe/idempotent.
- Require recent auth/re-authentication where appropriate.
- Add Astryx destructive confirmation modal.
- Show progress and partial-failure recovery.
- Clear local state only after the selected completion/queue contract.

**Acceptance criteria:**

- [ ] Cancel leaves the account unchanged.
- [ ] Successful deletion has a defined completion guarantee.
- [ ] Backend failure never produces full-success copy.
- [ ] Retrying does not corrupt or duplicate deletion state.
- [ ] Deleted user cannot access protected data afterward.

**Verification:** Integration tests for all failure ordering cases and disposable-account browser test.

**Dependencies:** T14, T15, T20, T21.

**Files likely touched:**

- `frontend/src/components/profile/sections.tsx`
- `frontend/src/lib/auth.ts`
- `backend/app/routers/users.py`
- user/account deletion models or migrations if required
- frontend/backend tests

---

### Checkpoint E Ã¢â‚¬â€ Account lifecycle

- [ ] Profile ownership is unambiguous.
- [ ] Export/clear/delete states are truthful.
- [ ] Account deletion is tested for partial failure and retry.
- [ ] No orphan-data path remains undocumented.

---

## Slice 7 Ã¢â‚¬â€ Honest boundaries and test/release readiness

### T23 Ã¢â‚¬â€ Fix or mark dead controls

**Goal:** Remove misleading UI before auth is declared complete.

**Actions:**

- Inspect `Study Library` and settings navigation dead `href="#"` controls.
- Either implement the route within existing scope or mark it clearly as unavailable/coming soon using Astryx.
- Ensure clicks do not silently jump to the top of the page.
- Review attachment/share controls and do not imply backend persistence where none exists.

**Acceptance criteria:**

- [ ] No auth-adjacent control is silently non-functional.
- [ ] Unimplemented features have honest copy and accessible disabled behavior.
- [ ] No unrelated core chat implementation is added.

**Verification:** Manual keyboard/click audit of all nav and profile controls.

**Dependencies:** T21.

**Files likely touched:**

- `frontend/src/components/Pesdac.tsx`
- relevant navigation/profile components

---

### T24 Ã¢â‚¬â€ Add frontend auth test harness and browser smoke tests

**Goal:** Make auth regressions catchable in future work.

**Actions:**

- Add the smallest compatible frontend test setup.
- Add component tests for auth handlers, error boundary, session gate, logout, and deletion.
- Add browser smoke tests for localhost auth flow and key failure states.
- Keep real credentials outside the repository and CI logs.

**Acceptance criteria:**

- [ ] Frontend tests run with one documented command.
- [ ] Browser tests cover sign-in, OAuth, logout, expiry, and deletion.
- [ ] Test failures identify the broken flow, not only a generic timeout.

**Verification:** Run the documented frontend and browser commands.

**Dependencies:** T6, T8, T11, T14, T22.

**Files likely touched:**

- `frontend/package.json`
- frontend test config
- frontend test files
- browser test config/specs
- safe test environment documentation

---

### T25 Ã¢â‚¬â€ Dependency and security audit

**Goal:** Address known dependency risks without destabilizing Astryx.

**Actions:**

- Run frontend production dependency audit.
- Identify whether Astro/Sharp/esbuild findings are directly exploitable in this deployment.
- Prepare a separate upgrade task if Astro major upgrade is required.
- Do not change Astryx versions.
- Run build and smoke tests after any approved dependency change.

**Acceptance criteria:**

- [ ] Findings are either fixed, mitigated, or explicitly accepted with rationale.
- [ ] No unreviewed major framework upgrade is mixed into auth logic.
- [ ] Build output remains valid.

**Verification:**

```powershell
cd frontend; npm.cmd audit --omit=dev
cd frontend; npm.cmd run astro -- check; npm.cmd run build
```

**Dependencies:** T24.

**Files likely touched:**

- `frontend/package.json`
- `frontend/package-lock.json`
- security/release notes

---

### T26 Ã¢â‚¬â€ Final review and handoff

**Goal:** Confirm the auth foundation is ready for core product work.

**Actions:**

- Run all verification commands.
- Review the diff for accidental redesigns, secrets, debug code, dead code, and unrelated chat changes.
- Review all Critical/Required findings from the code-review skill.
- Update `docs/reasonix/specs/pesdac-auth-flow-lockdown.md` checkboxes or add a completion report.
- List accepted risks and deferred chat/product work.

**Acceptance criteria:**

- [ ] Frontend check passes.
- [ ] Frontend build passes.
- [ ] Backend tests pass.
- [ ] Frontend/browser auth tests pass.
- [ ] No Critical or Required auth finding remains open.
- [ ] Remaining gaps are explicit and owned by follow-up tasks.
- [ ] Working tree contains only intentional changes.

**Verification:**

```powershell
cd frontend; npm.cmd run astro -- check; npm.cmd run build
cd ..\backend; python -m pytest
git diff --check
git status --short
```

**Dependencies:** T1Ã¢â‚¬â€œT25.

**Files likely touched:**

- `docs/reasonix/specs/pesdac-auth-flow-lockdown.md`
- optional implementation completion report

---

## Dependency graph

```text
T1 Ã¢â€ â€™ T2
T1 Ã¢â€ â€™ T3 Ã¢â€ â€™ T4
T3 Ã¢â€ â€™ T5 Ã¢â€ â€™ T7 Ã¢â€ â€™ T8
T3 Ã¢â€ â€™ T6
T2 Ã¢â€ â€™ T9 Ã¢â€ â€™ T10 Ã¢â€ â€™ T11
T7 + T12 Ã¢â€ â€™ T13 Ã¢â€ â€™ T14 Ã¢â€ â€™ T15
T2 Ã¢â€ â€™ T16 Ã¢â€ â€™ T17 Ã¢â€ â€™ T18 Ã¢â€ â€™ T19
T4 + T17 Ã¢â€ â€™ T20 Ã¢â€ â€™ T21 Ã¢â€ â€™ T22
T21 Ã¢â€ â€™ T23
T6 + T8 + T11 + T14 + T22 Ã¢â€ â€™ T24 Ã¢â€ â€™ T25 Ã¢â€ â€™ T26
```

## Safe parallelization

Only parallelize after T1/T2 are complete and contracts are agreed:

- T3 and T16 can be worked on separately by frontend/backend implementers.
- T6 can proceed alongside T4 if both use the same documented error contract.
- T9 configuration documentation can proceed alongside T7, but T10/T11 must wait for T9.
- T17 and T18 can proceed in parallel after T16, then T19 should consume both decisions.

Do not parallelize tasks that edit the same auth handlers, session state, deletion workflow, or shared API contract without one owner reviewing the combined diff.

## MiniMax reporting format after each task

```text
Task: T<number> Ã¢â‚¬â€ <title>
Status: Complete | Blocked | Needs review
Changed files:
- ...
Verification:
- Command: ...
- Result: ...
Behavior checked:
- ...
Risks or blockers:
- ...
Next task: T<number>
```

## Final status vocabulary

- **Complete:** Acceptance criteria and verification passed.
- **Blocked:** External dependency prevents completion; local handling is still implemented where possible.
- **Needs review:** Implementation exists but a human decision or security review is required.
- **Deferred:** Explicitly outside this auth-lockdown plan and recorded as follow-up work.






## File-by-file implementation matrix

MiniMax must not mark a slice complete until every file touched by the slice has a row in the task report.

| File group | Required task outcome |
|---|---|
| AuthLayout/AuthGate/OnboardingDialog | No blank/stuck auth state; every branch has safe copy, retry, focus, and tests |
| AppToasts/error boundary | No duplicate global/local errors; render crash is recoverable |
| auth.ts/auth-client/async-action | Typed errors, bounded requests, cache invalidation, honest results |
| Pesdac/session/ProfileDialog/sections | User state isolation, truthful optimistic updates, toasts/modals, retry |
| ThreadView/responder/attachments | Planned behavior preserved; mock failures and future seam explicit |
| Astro pages/middleware/config | SSR/CSR agreement, transition safety, dev-cache recovery |
| lib/auth.ts/lib/db/* | BetterAuth security and cascade/orphan contract |
| backend auth/config/deps/main | Fail-fast config, JWT/JWKS validation, origins, error envelope |
| backend routers/schemas/models | Scope, validation, rollback, idempotency, planned API boundary |
| tests | Every Critical/Required finding has automated or browser evidence |

## Additional file-audit tasks

These tasks are deliberately appended to the earlier T1–T26 plan. Complete them even if an earlier task appears green.

### T27 — AuthLayout branch table

Files: frontend/src/components/auth/AuthLayout.tsx and auth tests.

Create a branch table for sign-up, email login, Google redirect, 2FA, already-authenticated, and navigation failure.

For each branch implement and test:

- idle;
- local validation;
- request pending;
- success/session confirmation;
- safe server error;
- timeout/network;
- cancellation;
- duplicate submit;
- unmount/stale result;
- keyboard Enter;
- focus/error announcement.

Do not accept a global unhandled-rejection toast as coverage.

Dependencies: T7, T8, T10, T11.

### T28 — Session epoch and cache isolation

Files: frontend/src/lib/auth.ts, InitialSession.astro, AuthGate.tsx, Pesdac.tsx, session.ts.

Implement one auth epoch/user identity invalidation mechanism. Verify:

- user A logout then user B login;
- same-tab transition;
- browser refresh;
- missing/malformed SSR session script;
- BetterAuth session present but backend 401;
- simultaneous 401s;
- stale profile/account promise completion after logout.

Dependencies: T12, T13, T14.

### T29 — Auth action operation matrix

Files: frontend/src/components/profile/sections.tsx and frontend/src/lib/auth.ts.

For linked Google, unlink, password change, password link, 2FA setup, 2FA verify, 2FA disable, export, clear data, and delete account, record and implement:

- input validation;
- request state;
- conflicting controls;
- success toast;
- field/form error;
- timeout;
- 401/403/409/422/429/5xx mapping;
- retry safety;
- rollback/partial success;
- focus and announcement.

Dependencies: T3, T4, T20, T21, T22.

### T30 — Backend error and transaction matrix

Files: backend/app/main.py, config.py, deps.py, routers, schemas, and tests.

For every endpoint test:

- malformed JSON;
- missing auth;
- invalid auth;
- wrong user;
- invalid field;
- oversized field;
- database failure;
- upstream auth failure;
- rate limit;
- origin rejection;
- successful response;
- retry/idempotency.

Every failure must use the stable error envelope and every mutating route must rollback on failure.

Dependencies: T4, T16, T17, T18, T19.

### T31 — Deletion contract implementation

Files: frontend/src/lib/auth.ts, frontend/src/components/profile/sections.tsx, backend/app/routers/users.py, BetterAuth config/database models as required.

Choose one deletion contract and write it down in the code comment and tests. Implement:

- confirmation;
- freshness/re-auth;
- in-progress;
- cancel;
- backend failure before identity delete;
- identity failure;
- backend failure after identity delete;
- retry;
- idempotent repeat;
- local cleanup;
- final navigation;
- partial status/reference.

Dependencies: T15, T20, T21, T22.

### T32 — Planned feature boundary audit

Files: Pesdac.tsx, ThreadView.tsx, AttachButton.tsx, session.ts, responder.ts, chat.ts, attachments.ts.

Keep all planned/dummy features. For each one, add or verify:

- local/demo/planned label where persistence is absent;
- visible loading/error/empty state;
- safe retry/cancel;
- no false server-success wording;
- future API seam;
- user data isolation.

Dependencies: T23.

### T33 — Frontend error boundary and accessibility pass

Files: new app error boundary, AppToasts.tsx, auth/profile/dialog components.

Verify:

- render crash fallback;
- keyboard-only use;
- focus entry/return;
- live error announcements;
- aria-invalid/description;
- reduced-motion behavior;
- 200% zoom;
- mobile widths;
- no keyboard trap;
- no duplicate toast and inline error.

Dependencies: T6, T24.

### T34 — Full website action inventory

Files: all frontend components.

Use rg or equivalent to inventory every onClick, clickAction, onEnter, submit, navigation, fetch, async callback, and button.

For each action record:

- owner function;
- promise ownership;
- loading flag;
- disabled rule;
- success surface;
- failure surface;
- retry/cancel;
- planned/local/real classification;
- test.

A button without an explicit state is not complete.

Dependencies: T1, T23.

### T35 — Full backend ownership and data integrity audit

Files: all backend routers/models/schemas/tests.

For each endpoint:

- derive identity only from verified auth;
- test another user cannot read/update/delete;
- test transaction rollback;
- test validation and bounds;
- test race/duplicate request;
- test error envelope;
- test rate limit and origin;
- document planned endpoints that do not yet exist.

Dependencies: T17, T18, T19, T30.

### T36 — Verification and MiniMax handoff

Run:

- frontend npm.cmd run astro -- check;
- frontend npm.cmd run build;
- backend python -m pytest;
- git diff --check;
- browser auth smoke suite;
- final no-secret diff scan.

Report every task as Complete, Blocked, Needs review, or Deferred. Deferred means planned feature intentionally remains for a later slice; it does not mean deleted.

Dependencies: T27–T35.

### T37 — Link-password route wiring and stale-process smoke test

Status: Required regression guard.

Files:

- `frontend/src/lib/auth.ts`
- `backend/app/main.py`
- `backend/app/routers/auth.py`
- `backend/tests/test_auth_contract.py`

Verify that the frontend resolves the action to
`POST /api/v1/auth/link-password`, that the backend router is mounted at that
exact path, and that the route remains protected by the normal auth/origin/
rate-limit contracts. Add or maintain a route-registration test. For local
testing, restart the backend from the repository's `backend/` directory,
restart/force-refresh Astro, inspect `/api/openapi.json`, and perform one
unauthenticated request: `401` is expected; `404` means the process or route
prefix is wrong. Preserve the existing link-password implementation and all
planned UI/demo features.

Acceptance:

- backend test suite passes, including the route-registration assertion;
- OpenAPI exposes `/api/v1/auth/link-password` with `POST`;
- unauthenticated localhost request returns the standard `401` envelope;
- authenticated valid requests reach BetterAuth and expose safe success or
  error toasts without leaking credentials;
- no stale old backend worker remains bound to port 8000 during the smoke test.

Dependencies: T17, T23, T36.

## MiniMax task report format

Task: T<number> — title
Status: Complete | Blocked | Needs review | Deferred
Files inspected:
- path
Files changed:
- path
State matrix verified:
- idle:
- loading:
- success:
- failure:
- timeout:
- cancel:
- retry:
- stale result:
UX/accessibility verified:
- ...
Tests:
- command and result
Planned features preserved:
- ...
Risks/blockers:
- ...
Next task:
- ...

## Completion rule

Do not report the auth/website foundation complete if:

- a button or async flow has no visible failure path;
- a catch block silently discards an actionable error;
- a destructive operation has no partial-failure contract;
- a session cache can cross user identities;
- a backend endpoint lacks ownership tests;
- a planned feature was removed instead of labeled/deferred;
- a build/test result is missing or only inferred.
