# MiniMax M3 Implementation Prompt

You are implementing the PESDac auth bootstrap performance and resilience
follow-up.

Read these files before changing code:

1. `AGENTS.md`
2. `docs/design/DESIGN.md`
3. `docs/audits/2026-09-07-pesdac-full-stack-readiness-audit.md`
4. `docs/reasonix/specs/pesdac-auth-flow-lockdown.md`
5. `docs/reasonix/plans/pesdac-auth-flow-lockdown-plan.md`
6. `docs/reasonix/specs/auth-bootstrap-performance-resilience.md`
7. `docs/reasonix/plans/auth-bootstrap-performance-resilience-plan.md`

## Mission

Implement T37–T46 from the companion plan. The original problem is:

- a valid authenticated user can briefly see the required Create Account
  dialog while Better Auth is still checking the session;
- auth/profile/campus/linked-account data can take roughly 11 seconds or more
  when token minting or the auth server is slow;
- profile and auth-connection reads can duplicate each other;
- a transient token endpoint failure can be mistaken for an expired session;
- loading surfaces are incomplete or misleading.

## Non-negotiable preservation rules

- T1–T36 are complete and must remain complete.
- Do not remove or disable existing auth, Google OAuth, email/password,
  link-password, logout, deletion, 2FA, toast, modal, error-envelope,
  optimistic UI, or loading behavior.
- Do not remove Study Library, attachments, sharing, AI/SSE, demo, mock, or
  other planned UI. Planned features must remain visibly planned/local/demo
  rather than being deleted.
- Preserve the current Astro/React architecture.
- Preserve Astryx 0.5.2 and `PESDacMockupTheme`.
- Use real Astryx components whenever available. Use Astryx `Skeleton`,
  `Spinner`, `Toast`, `Dialog`, `Button`, `VStack`, and `HStack` as appropriate.
- Do not add Tailwind, another UI library, or custom replacements for Astryx.
- Do not redesign spacing, colors, typography, radii, shadows, or layout.
- Do not change dependencies or upgrade Astro without completing the separate
  dependency-review task and documenting the migration impact.
- Do not commit secrets or log cookies, tokens, passwords, OAuth codes, JWT
  claims, or personal data.
- Do not use `npm audit fix --force`.

## Required implementation behavior

### 1. Auth state

`useAuth()` must distinguish:

- `loading`: Better Auth has not completed its authoritative session check;
- `guest`: Better Auth completed and returned no session;
- `authenticated`: Better Auth completed and returned a user.

`AuthGate` may render only for confirmed `guest`.

It must never render for `loading`, profile loading, linked-account loading,
token minting, auth-service timeout, or transient network failure.

Astro SSR timeout/failure must not be serialized as a confirmed guest. Astro
transitions must not retain an old embedded session after the user changes.

### 2. Token failures

Separate these cases:

- confirmed backend `401`: clear identity caches and dispatch the existing
  auth-required flow;
- token network error, timeout, malformed response, or Better Auth 5xx: expose
  a typed recoverable service failure and do not redirect to login;
- missing configuration: fail clearly in development/build validation.

Only confirmed invalid authorization may trigger `AUTH_REQUIRED_EVENT`.

If implementing retry, retry only safe bootstrap reads. Use at most one
bounded retry with short backoff. Never automatically retry password changes,
OAuth mutations, deletion, logout, link-password, or other writes.

### 3. Identity-safe caches

`/auth/me`, `/profiles/me`, and linked-account data must be scoped to the
current Better Auth user ID.

Invalidate or replace caches on:

- sign-in;
- sign-up;
- OAuth callback/user change;
- logout;
- account deletion;
- backend `401`;
- cross-tab session user-ID change.

An old promise resolving after a user switch must be ignored. User A data must
never paint into User B’s screen.

### 4. Request deduplication

Concurrent calls for the same identity must share one in-flight request for:

- token mint;
- `/auth/me`;
- `/profiles/me`;
- linked accounts.

Rejected promises must be cleared so retry works. Profile mutations must
invalidate the relevant read cache. Independent `/auth/me` and
`/profiles/me` calls may run in parallel.

### 5. Loading UI

Use only existing Astryx components and the current theme.

- Account shell: Astryx `Skeleton` while auth is unresolved.
- Profile identity: preserve layout with skeletons while server identity loads.
- Authentication connections: skeleton while linked accounts load.
- Campus/profile loading: do not show false defaults or a guest gate.
- Every skeleton region needs `aria-busy="true"` and a meaningful accessible
  label/container.
- Use existing Astryx toasts for recoverable failures.
- Use existing Astryx dialogs for security-sensitive/destructive decisions.

### 6. Instrumentation

Add development-only timing instrumentation if needed for:

- SSR `getSession`;
- browser `get-session`;
- token mint;
- `/auth/me`;
- `/profiles/me`;
- linked accounts.

Log only operation name, duration, status category, and a safe reference ID.
Remove temporary instrumentation when it is no longer useful, or retain only
safe permanent performance signals.

## Execution protocol

Implement one task at a time in dependency order:

1. T37 baseline/reproduction
2. T38 auth state contract
3. T39 token failure classification
4. T40 bounded retry/recovery
5. T41 user-scoped cache invalidation
6. T42 request deduplication/orchestration
7. T43 SSR/client session handoff
8. T44 Astryx loading/accessibility states
9. T45 dependency audit decision
10. T46 integrated verification

Before every edit:

- inspect the current file;
- inspect current uncommitted changes;
- preserve changes from other work;
- identify the smallest owning module;
- add or update a focused regression test.

Do not rewrite large components from scratch. Do not bundle unrelated cleanup
into these tasks.

## Required tests

Add tests for:

- pending auth remains `loading`;
- confirmed null session becomes `guest`;
- valid SSR session is immediately authenticated;
- token timeout/network/malformed/5xx does not dispatch auth-required;
- confirmed backend 401 dispatches auth-required once;
- one token request is shared by concurrent callers;
- one profile request is shared by concurrent callers;
- stale user-A response cannot update user-B state;
- cross-tab/user-ID change invalidates identity caches;
- rejected requests can retry;
- loading skeletons appear in the correct unresolved states.

Do not weaken or delete existing tests.

## Verification commands

Run exact commands and record results:

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

The current baseline is approximately:

- backend: 43 passing tests;
- Astro check: 0 errors, with an existing `document.execCommand`
  deprecation hint;
- production build: passing;
- dependency audit: high-severity Astro/esbuild/sharp findings requiring a
  deliberate decision.

## Dependency audit rule

For T45, inspect the exact installed versions and advisory paths. Determine
whether the packages are production-runtime reachable or build/dev-only. If an
upgrade is needed, create a separate migration-sized change with reviewed
lockfile changes and Astro compatibility verification. Do not silently upgrade
Astro 7 as part of the auth fix. If deferred, document owner, reason, impact,
and follow-up task.

## Manual browser matrix

Verify all of these after implementation:

1. Existing authenticated user opens `/new` and never sees Create Account while
   auth is pending.
2. Authenticated shell account skeleton resolves to the correct identity.
3. Confirmed guest sees the required login gate.
4. Slow Better Auth keeps the app in loading/recoverable state.
5. Token endpoint timeout does not navigate to login.
6. Confirmed backend 401 navigates to login exactly once.
7. Campus/profile data loads without duplicate profile requests.
8. Authentication tab shows skeleton before linked accounts resolve.
9. Cross-tab logout and account switching do not leak prior user data.
10. Login, signup, Google OAuth, link-password, logout, deletion, 2FA, toasts,
    modals, planned/demo features, and existing optimistic UI still work.

Test at 320, 768, 1024, and 1440 px widths.

## MiniMax report format

After each task, report:

```text
Task: T<number> — title
Status: Complete | Blocked | Needs review | Deferred
Files inspected:
- ...
Files changed:
- ...
Auth states verified:
- loading:
- guest:
- authenticated:
- service outage:
- confirmed 401:
Request behavior:
- token:
- /auth/me:
- /profiles/me:
- linked accounts:
Tests:
- exact command and result
Performance:
- before:
- after:
Planned features preserved:
- ...
Risks/blockers:
- ...
Next task:
- ...
```

Do not report completion if:

- a token timeout can redirect a valid user to login;
- an unresolved session can open the guest gate;
- identity caches can cross users;
- duplicate avoidable requests remain unexplained;
- loading states are blank or misleading;
- dependency audit findings are silently ignored;
- any T1–T36 behavior or planned feature was removed.

Use these skills while implementing:

- `code-review-and-quality`
- `debugging-and-error-recovery`
- `performance`
- `astro`
- `better-auth-best-practices`
- `better-auth-security-best-practices`
- `frontend-ui-engineering`
- `test-driven-development`
- `incremental-implementation`
- `planning-and-task-breakdown`
