# Spec: Auth Resilience Review Remediation

## Status and relationship to prior work

This is a narrowly scoped remediation spec for findings from the code review of
T37–T45. T1–T36 are complete. The broader auth bootstrap spec and plan remain
the source of product intent; this document only closes the review blockers.

MiniMax must preserve all existing auth, Google OAuth, email/password,
link-password, logout, deletion, 2FA, toast, modal, optimistic UI, skeleton,
planned, and demo behavior.

## Objective

Ensure that Better Auth token-service failures cannot be mistaken for an
invalid user session, that token retries happen only for genuinely transient
responses, and that tests cover the real `apiFetch` behavior rather than only
isolated helpers. Correct the T45 dependency-audit record so its severity and
reachability claims match the actual command output.

## Review findings being fixed

### Finding F1 — token failure still falls through to unauthenticated API

The current `apiFetch()` receives a failed token result, clears caches, then
continues without `Authorization`. The backend returns `401`, which triggers
the existing auth-required event and can route a valid user to login.

Required behavior: token timeout, network failure, malformed token body, and
Better Auth 5xx must return a typed recoverable auth-service error before the
backend request is attempted. They must not dispatch `AUTH_REQUIRED_EVENT`.

### Finding F2 — retry class is too broad

The current token helper retries every non-2xx response classified as `http`.
Retry only timeout, network failure, `429`, and `5xx`. Do not retry `400`,
`401`, `403`, or configuration/response-shape errors unless the implementation
can prove the error is transient.

### Finding F3 — missing integration coverage

Pure `auth-cache.ts` tests pass, but they do not prove the production chain:

```text
getBackendToken → apiFetch → request decision → auth-required event/toast
```

Add tests that observe the actual decision boundary and prove that no fallback
unauthenticated request occurs after token failure.

### Finding F4 — T45 audit record is inconsistent

The T45 decision document must be regenerated or corrected from the exact
current `npm audit --omit=dev --audit-level=high` output. Never manually lower
an advisory severity. If the result is deferred, document the exact installed
versions, advisory severity, runtime reachability, owner, and follow-up.

## Scope

### In scope

- Frontend token failure result type and request control flow.
- Retry classification and tests.
- Auth-service-unavailable user-facing recovery using existing Astryx surfaces.
- Integration tests for `apiFetch` and auth-required dispatch.
- Accurate T45 dependency audit documentation.
- Verification against all existing T1–T36 and T37–T45 tests/build behavior.

### Out of scope

- Replacing Better Auth.
- Changing token/session lifetime, cookies, providers, JWT claims, or database
  schema.
- Astro 6 → 7 upgrade in this remediation.
- UI redesign or replacing Astryx components.
- Removing planned/demo functionality.
- Automatic retries for mutations.

## Required behavior contract

### Token result categories

Use an explicit typed result or equivalent:

- `ok`: token received and cached;
- `timeout`: token request exceeded the configured budget;
- `network`: fetch failed before a valid response;
- `rate-limited`: token endpoint returned 429;
- `server`: token endpoint returned 5xx;
- `malformed`: 2xx response did not contain a valid token;
- `client-error`: 400/401/403 or other non-retryable response;
- `missing-config`: auth base URL is unavailable.

Only `ok` proceeds to a protected backend request with `Authorization`.
`timeout`, `network`, `rate-limited`, `server`, `malformed`, and
`client-error` must not proceed as an unauthenticated protected request.

### Retry policy

- Retry at most once.
- Retry only `timeout`, `network`, `429`, and `5xx`.
- Use a bounded short backoff.
- Never retry writes or auth mutations automatically.
- A failed second attempt returns a typed recoverable error.

### Session invalidation policy

- Backend `401` from a request that had a valid token may clear identity caches
  and dispatch `AUTH_REQUIRED_EVENT` once.
- Failure to mint a token is not proof of session invalidity.
- Auth-service failure uses existing toast/retry handling and keeps the user in
  the current shell.

### UI policy

- Use existing Astryx `Toast` for recoverable token-service failure.
- Use a retry action where the owning screen can safely retry a read.
- Do not show the required guest gate for service failure.
- Do not show a false success state.
- Keep current skeleton/loading states.

## Implementation constraints

- Astro 6, React 19, Better Auth 1.7.3, Astryx 0.5.2.
- Use the existing `apiFetch`, `toUserMessage`, `AuthRequiredError`, cache
  helpers, toast bridge, and current theme.
- No new dependency.
- Test helpers must not create a dangerous production API where avoidable.
  Prefer testing pure helpers or injecting fetch into a narrow internal seam.
- Never log secrets, cookies, tokens, passwords, OAuth codes, JWT claims, or
  personal data.

## Expected files

- `frontend/src/lib/auth.ts`
- `frontend/src/lib/auth-cache.ts`
- `frontend/src/components/Pesdac.tsx` only if the recovery surface needs a
  shell-level toast/retry bridge
- `frontend/tests/auth-cache.test.ts`
- a new focused frontend integration test under `frontend/tests/`
- `docs/reasonix/plans/auth-bootstrap-performance-resilience-t45-decision.md`

## Testing strategy

Add focused tests for:

1. successful token mint proceeds with authorization;
2. timeout retries once and then returns recoverable failure;
3. network failure retries once and then returns recoverable failure;
4. 429 and 5xx retry once;
5. 400, 401, and 403 do not retry;
6. malformed 2xx body does not retry indefinitely;
7. failed token mint makes zero protected API requests;
8. failed token mint dispatches zero auth-required events;
9. confirmed backend 401 dispatches one auth-required event;
10. concurrent callers share one token attempt/retry sequence.

Existing tests must remain unchanged unless an assertion accurately reflects
the corrected contract.

## Commands

```powershell
cd frontend
npm.cmd test
npm.cmd run astro -- check
npm.cmd run build
npm.cmd audit --omit=dev --audit-level=high

cd ..
cd backend
python -m pytest

cd ..
git diff --check
```

## Definition of done

- A failed token mint never falls through to an unauthenticated protected API
  request.
- A failed token mint never dispatches the invalid-session event.
- Only a confirmed backend `401` can trigger auth-required navigation.
- Retry behavior is bounded and status-aware.
- Integration tests prove the production decision path.
- T45 dependency documentation matches exact audit output.
- Frontend tests pass, backend tests pass, Astro check has zero errors, build
  succeeds, and diff check passes.
- T1–T36 and T37–T45 behavior remains intact.

## Boundaries

### Always

- Inspect current uncommitted changes before editing.
- Make the smallest focused change.
- Add regression tests for each corrected finding.
- Preserve Astryx and existing UX contracts.

### Ask first

- Any dependency upgrade.
- Any cookie/JWT/session configuration change.
- Any new user-visible navigation behavior.

### Never

- Never turn auth-service outage into logout.
- Never retry mutations automatically.
- Never use `npm audit fix --force`.
- Never remove prior feature behavior to simplify tests.
