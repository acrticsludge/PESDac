# Spec: Auth Bootstrap Performance and Resilience

## Status

Implementation handoff for MiniMax M3. This spec is a follow-up to the
completed T1–T36 auth/website foundation. It does not reopen or replace those
tasks.

## Objective

Make the first authenticated page load feel immediate and truthful. A user
with a valid Better Auth session must not see the required “Create account”
dialog while the session is still being checked. Profile, campus, and linked
authentication data must load without duplicate requests, stale-user leakage,
or an unexplained logout when Better Auth is temporarily slow or unavailable.

The implementation must preserve the existing PESDac UI hierarchy, Astryx 0.5.2
components, `PESDacMockupTheme`, current T1–T36 behavior, planned/demo
features, and existing error/toast/modal contracts.

## Current failure model

The current flow has several interacting latency paths:

```text
Astro SSR middleware
  └─ Better Auth getSession() with an 800 ms race
       ├─ session found → embed initial session
       └─ timeout/failure → embed null

React hydration
  └─ Better Auth useSession()
       ├─ pending + no embedded session must remain `loading`
       └─ resolved null becomes `guest`

Authenticated backend reads
  └─ mint /api/auth/token
       ├─ shared in-flight request
       ├─ cached for 5 minutes
       └─ bounded timeout
  └─ /api/v1/auth/me and /api/v1/profiles/me
```

The previously observed modal flash was caused by classifying an unresolved
session as `guest`. The observed multi-second data delay can be amplified by
the token-mint timeout, the SSR/client duplicate session lookup, and duplicate
profile reads.

## Scope

### In scope

- Auth state machine correctness during SSR, hydration, pending, guest,
  authenticated, timeout, and service-outage states.
- Better Auth token mint failure classification and retry behavior.
- Identity-scoped frontend caches for `/auth/me`, `/profiles/me`, and linked
  accounts.
- Deduplication of session/profile/account requests.
- Astryx skeleton/loading states for unresolved account and linked-account
  data.
- Backend/frontend tests for the corrected state transitions.
- Performance instrumentation sufficient to identify which auth request is
  slow in development and manual smoke testing.
- Review of the Astro/esbuild/sharp audit findings without performing a blind
  breaking dependency upgrade.

### Explicitly out of scope

- Rewriting Better Auth or replacing it with another auth provider.
- Changing Astryx versions or introducing another UI library.
- Redesigning the login, signup, profile, or app-shell UI.
- Removing planned Study Library, attachments, sharing, AI/SSE, or demo/mock
  features.
- Changing the database schema unless a later measured bottleneck proves it is
  necessary and the change is separately approved.
- Treating a transient auth-service outage as proof that the user's session is
  invalid.

## Required behavior

### R1 — Auth states are explicit

`useAuth()` must expose only these meaningful states:

- `loading`: session is unresolved or the client is revalidating it;
- `guest`: Better Auth has completed and confirmed no session;
- `authenticated`: Better Auth has completed and supplied a user.

The required `AuthGate` must render only for `guest`. It must never render for
`loading`, token minting, profile loading, account loading, or transient
network failure.

### R2 — SSR hints are not authoritative guest decisions

If Astro middleware times out or cannot reach Better Auth, it must not cause the
client to classify the user as a guest. The serialized initial-session value
must be distinguishable from a confirmed guest, or the client must remain in
`loading` until Better Auth resolves.

Astro transitions must not reuse a process-global session value from a prior
page or prior user. Guest → authenticated and authenticated → guest transitions
must update the embedded-session reader safely.

### R3 — Token failures are not session failures

The frontend must distinguish:

- confirmed invalid/expired session: safe to clear identity caches and dispatch
  the existing auth-required flow;
- Better Auth token endpoint timeout, network failure, malformed response, or
  5xx: auth service unavailable; keep the session unresolved/known locally,
  expose a recoverable error, and do not redirect to login automatically;
- missing configuration: fail fast in development/build validation, never treat
  it as a real guest session.

The retry policy must be bounded. A recommended policy is one retry after a
short backoff for token minting, followed by a typed recoverable error. Do not
create infinite retry loops or retry password/OAuth mutations automatically.

### R4 — Identity caches are scoped to the authenticated user

Cached promises/data for `apiGetMe`, `apiGetProfile`, and `apiGetAccounts` must
never be reused for another user. Cache invalidation must occur on:

- explicit sign-in success;
- sign-up success;
- explicit logout;
- account deletion;
- backend `401`;
- Better Auth session user-ID change, including cross-tab changes;
- OAuth callback completion when the user changes.

An old request resolving after an identity change must be ignored and must not
paint the old user's data into the new user's UI.

### R5 — Requests are deduplicated and parallelized

For one authenticated identity:

- concurrent token requests share one in-flight promise;
- concurrent `/auth/me` callers share one request;
- concurrent `/profiles/me` callers share one request;
- linked-account requests share one request while the result is valid;
- onboarding and shell hydration must not independently duplicate the same
  profile request.

Do not serialize `/auth/me` and `/profiles/me` if they do not depend on one
  another. They may run in parallel after the identity is known.

### R6 — Loading UI is honest and non-blocking

Use existing Astryx components only:

- shell account row: Astryx `Skeleton` while auth identity is unresolved;
- linked-account control: Astryx `Skeleton` while account connections load;
- profile/onboarding fields: preserve layout while data loads; do not show a
  false guest gate or blank unexplained modal;
- recoverable network failure: existing Astryx toast contract;
- security-sensitive/destructive decision: existing Astryx dialog/modal
  contract.

Skeletons are decorative and must be inside an `aria-busy` region with a
meaningful accessible label. Do not add custom CSS that recreates Astryx.

### R7 — Performance is measurable

Development instrumentation must identify durations for:

- SSR `getSession`;
- client `get-session`;
- token mint;
- `/auth/me`;
- `/profiles/me`;
- `listAccounts`.

Instrumentation must not log cookies, tokens, passwords, OAuth codes, full JWT
claims, or personal data. It may log operation name, duration, status category,
and a short request/reference ID in development.

### R8 — Dependency security is handled deliberately

The current audit reports high-severity findings through Astro’s dependency
tree, including Astro, esbuild, and sharp. MiniMax must:

- record the exact installed versions and advisory output;
- determine whether the vulnerable packages are production-runtime reachable
  or development/build-only;
- inspect the Astro 7 migration impact before upgrading;
- not run `npm audit fix --force` blindly;
- either create a focused upgrade task with migration verification or document
  an accepted temporary risk and owner.

## Technical constraints

- Astro 6, React 19, Better Auth 1.7.3, Astryx 0.5.2, StyleX.
- Use the existing `PESDacMockupTheme`.
- Use existing `apiFetch`, `authClient`, `AuthRequiredError`, `ApiError`,
  `toUserMessage`, and cache helpers where appropriate.
- Do not add a data-fetching library for this work.
- Do not expose backend secrets or session cookies to client logs.
- Preserve all current T1–T36 acceptance behavior.

## Expected files

Likely frontend files:

- `frontend/src/lib/auth.ts`
- `frontend/src/lib/auth-client.ts` only if required by the Better Auth API
- `frontend/src/middleware/auth.ts`
- `frontend/src/components/auth/AuthGate.tsx`
- `frontend/src/components/auth/OnboardingDialog.tsx`
- `frontend/src/components/Pesdac.tsx`
- `frontend/src/components/profile/sections.tsx`

Likely tests/docs:

- `frontend/tests/` or the existing frontend test location, if present;
- `backend/tests/test_auth_contract.py` only for backend contract coverage;
- `docs/reasonix/plans/auth-bootstrap-performance-resilience-plan.md`;
- this spec.

Do not modify vendor files under `node_modules`.

## Commands

Run from the repository root unless a working directory is shown:

```powershell
cd backend
python -m pytest

cd ..\frontend
npm.cmd run astro -- check
npm.cmd run build
npm.cmd audit --omit=dev --audit-level=high

cd ..
git diff --check
```

Manual local smoke test:

```powershell
# backend
cd backend
python -m uvicorn app.main:app --reload --port 8000

# separate terminal
cd frontend
npm.cmd run dev -- --force
```

Use a browser with an authenticated session and inspect request timing for
`get-session`, `token`, `auth/me`, `profiles/me`, and `list-accounts`.

## Testing strategy

### Unit tests

- `useAuth` remains `loading` while Better Auth is pending and no SSR session
  hint exists;
- `useAuth` becomes `guest` only after a completed null session;
- token timeout/network/malformed responses do not dispatch auth-required;
- confirmed backend 401 still dispatches auth-required exactly once;
- session user-ID changes invalidate all identity caches;
- stale old-user promises cannot update current-user state;
- profile/account requests deduplicate.

### Backend contract tests

Keep existing backend auth/JWT/error tests green. Do not weaken tests to hide
real failures. Add backend tests only when the API contract changes.

### Build and browser tests

Verify:

1. Existing authenticated user opens `/new` without a Create Account modal.
2. Shell account skeleton appears only during unresolved auth, then resolves.
3. Confirmed guest receives the required gate after session resolution.
4. Slow Better Auth keeps the shell in loading/recoverable state rather than
   redirecting or falsely showing guest UI.
5. Profile campus data loads once and remains associated with the current user.
6. Authentication connections show a skeleton, then linked/unlinked state.
7. Cross-tab logout and account switch do not leak prior user data.
8. Existing sign-in, sign-up, Google OAuth, link-password, logout, deletion,
   2FA, toast, modal, and planned/demo flows remain intact.

## Definition of done

- No valid authenticated session sees the required guest gate during pending
  auth resolution.
- No transient token-service outage automatically logs the user out.
- No identity-scoped cache can display another user's profile or connections.
- Shell/profile/account reads do not issue avoidable duplicate requests.
- Auth loading and linked-account loading use Astryx skeletons and accessible
  busy labels.
- Backend tests remain green: currently 43 passing before this follow-up.
- `astro check` has zero errors.
- Production build succeeds.
- `git diff --check` passes.
- Dependency audit is either remediated through a reviewed upgrade or recorded
  as an explicit accepted risk with a follow-up owner.
- No T1–T36 task is removed, regressed, or silently reclassified.
- MiniMax reports files, tests, timings, manual scenarios, deferred risks, and
  confirms that the existing Astryx layout/theme and planned features remain.

## Boundaries

### Always

- Read the current file before editing.
- Use Astryx components and the existing theme.
- Add regression tests for corrected state behavior.
- Keep user-facing failures safe and actionable.
- Preserve planned/demo features.
- Run focused tests before broad verification.

### Ask first

- Any database schema or migration change.
- Any dependency upgrade, especially Astro 7.
- Any change to cookie settings, Better Auth providers, JWT claims, or token
  lifetime.
- Any change to the required gate’s product behavior beyond pending/loading
  correctness.

### Never

- Never treat a timeout as proof the user is logged out.
- Never log secrets, cookies, tokens, passwords, OAuth codes, or raw claims.
- Never use `npm audit fix --force` without reviewing the migration.
- Never delete T1–T36 behavior or planned features to make tests pass.
- Never replace Astryx with custom HTML/CSS or another UI library.

## Skills MiniMax should use

- `code-review-and-quality`: review each slice across correctness, security,
  architecture, readability, and performance.
- `debugging-and-error-recovery`: reproduce the 11-second path and preserve
  timing evidence before changing behavior.
- `performance`: measure the auth critical path and compare before/after.
- `astro`: preserve SSR middleware, Astro transitions, island hydration, and
  build behavior.
- `better-auth-best-practices`: use Better Auth 1.7.3-compatible APIs and
  session semantics.
- `better-auth-security-best-practices`: review session invalidation, token
  failure classification, cookies, and cross-user cache isolation.
- `frontend-ui-engineering`: implement accessible loading/error states without
  changing the canonical Astryx design.
- `test-driven-development`: add focused regression tests before or alongside
  each behavior fix.
- `incremental-implementation`: implement one T37+ task at a time and verify
  before continuing.
- `planning-and-task-breakdown`: follow the companion task dependencies.

## Open questions

1. Should the product wait for SSR session resolution on protected app routes,
   or is a client-visible loading shell the preferred tradeoff? Default for
   this spec: client-visible loading shell with no guest gate.
2. Is the Astro 7 upgrade approved as a separate dependency task? Default:
   no; document and isolate it until migration impact is reviewed.
