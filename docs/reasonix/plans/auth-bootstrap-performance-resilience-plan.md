# Implementation Plan: Auth Bootstrap Performance and Resilience

## Handoff context

T1–T36 are complete. This plan starts at T37 and is additive. MiniMax must
preserve all completed auth, error, toast, modal, loading, optimistic UI,
security, backend, planned, and demo behavior.

Read first:

- `AGENTS.md`
- `docs/design/DESIGN.md`
- `docs/audits/2026-09-07-pesdac-full-stack-readiness-audit.md`
- `docs/reasonix/specs/pesdac-auth-flow-lockdown.md`
- `docs/reasonix/specs/auth-bootstrap-performance-resilience.md`
- `docs/reasonix/plans/pesdac-auth-flow-lockdown-plan.md`

## Architecture decisions

1. Keep Better Auth 1.7.3 and the existing Astro/React/Astryx architecture.
2. Model auth-service outage separately from invalid session. A timeout is not
   authorization evidence.
3. Keep identity data caches scoped to a user identity and invalidate on every
   identity transition.
4. Deduplicate reads with existing lightweight promises/helpers; do not add a
   query/cache dependency.
5. Use Astryx `Skeleton` for known-shape loading areas and existing Astryx
   toast/dialog surfaces for recoverable and critical errors.
6. Treat dependency upgrades as a separate, reviewed task. Do not force Astro
   7 into the auth fix.

## Dependency graph

```text
T37 baseline + reproduction
  ├── T38 auth state contract
  ├── T39 token error classification
  │     └── T40 bounded retry + UI recovery
  ├── T41 identity-scoped cache invalidation
  │     └── T42 request deduplication/profile orchestration
  ├── T43 SSR/client session timing
  ├── T44 skeleton/accessibility verification
  └── T45 dependency audit decision
        └── T46 integrated verification + MiniMax report
```

T38 and T41 can be implemented in parallel after T37. T39 must precede T40.
T41 should precede T42. T43 and T44 may proceed after T38. T45 is isolated
from runtime behavior and must not block the auth fix unless an approved
security upgrade is required.

## Phase 1 — Reproduce and lock contracts

### T37 — Baseline auth critical-path measurement

**Description:** Reproduce the original behavior with an authenticated browser
session and record timings for SSR page load, Better Auth `get-session`, token
mint, `/auth/me`, `/profiles/me`, and linked accounts. Confirm whether the
delay is token mint, database cold start, duplicate requests, or hydration.

**Acceptance criteria:**

- [ ] A timing table exists for fast, slow, and unavailable Better Auth cases.
- [ ] No secrets, cookies, tokens, or personal data are recorded.
- [ ] The current 43 backend tests, Astro check, and build are baseline-green.

**Verification:**

- `cd backend; python -m pytest`
- `cd frontend; npm.cmd run astro -- check; npm.cmd run build`
- Browser Network timing capture with request names only.

**Dependencies:** None.

**Files likely touched:** Documentation only unless temporary dev instrumentation
is necessary.

**Estimated scope:** Small.

### T38 — Auth pending/guest/authenticated regression contract

**Description:** Make the auth state machine impossible to misclassify while
Better Auth is pending. Ensure `AuthGate` renders only for confirmed guests and
preserve the existing server-injected session fast path.

**Acceptance criteria:**

- [ ] Pending with no SSR hint returns `loading`, never `guest`.
- [ ] Pending with a valid SSR hint renders authenticated identity.
- [ ] Completed null session returns `guest`.
- [ ] Astro transition changes cannot retain an old embedded session value.
- [ ] Unit/component tests cover all three states.

**Verification:** Focused frontend tests plus manual slow-session browser test.

**Dependencies:** T37.

**Files likely touched:**

- `frontend/src/lib/auth.ts`
- `frontend/src/components/auth/AuthGate.tsx`
- frontend auth test files.

**Estimated scope:** Medium.

### Checkpoint A

- [ ] No guest modal appears during unresolved auth.
- [ ] Existing guest gate still appears after confirmed guest resolution.
- [ ] Build and focused tests pass.

## Phase 2 — Resilient token and session behavior

### T39 — Separate auth-service failure from invalid session

**Description:** Refactor token minting and `apiFetch` so timeout, network,
malformed, and Better Auth 5xx failures produce a typed recoverable service
failure. Only a confirmed backend `401` may trigger `AUTH_REQUIRED_EVENT`.

**Acceptance criteria:**

- [ ] Token timeout does not dispatch auth-required.
- [ ] Token network failure does not navigate to login.
- [ ] Confirmed backend 401 still clears caches and dispatches once.
- [ ] Mutation calls do not silently retry.
- [ ] User-facing copy uses `toUserMessage` and existing Astryx toast rules.

**Verification:** Unit tests for every token result category and one backend
401 integration test.

**Dependencies:** T38.

**Files likely touched:**

- `frontend/src/lib/auth.ts`
- frontend auth tests.

**Estimated scope:** Medium.

### T40 — Bounded token retry and recoverable UI

**Description:** Add one bounded retry for token minting with a short backoff,
only for read/bootstrap operations where retry is safe. Expose retry state to
the shell/profile data consumers without opening the guest gate.

**Acceptance criteria:**

- [ ] At most one automatic token retry occurs per bootstrap attempt.
- [ ] A second failure produces a visible recoverable toast or inline state.
- [ ] A retry action starts a fresh attempt and clears stale failure state.
- [ ] Password, OAuth, deletion, logout, and other mutations are not
  automatically replayed.

**Verification:** Fake-timer tests and browser test with a delayed/failing token
endpoint.

**Dependencies:** T39.

**Files likely touched:**

- `frontend/src/lib/auth.ts`
- `frontend/src/components/Pesdac.tsx` or owning bootstrap component
- frontend auth tests.

**Estimated scope:** Medium.

## Phase 3 — Identity-safe cache and request orchestration

### T41 — User-scoped cache invalidation

**Description:** Key or invalidate `mePromise`, `profilePromise`, and
`accountsPromise` by Better Auth user ID. Detect session user-ID changes from
`useSession`, including cross-tab changes and OAuth completion.

**Acceptance criteria:**

- [ ] User A data cannot be returned to User B.
- [ ] Old in-flight responses are ignored after an identity change.
- [ ] Explicit sign-in, sign-up, logout, deletion, 401, and cross-tab changes
  all invalidate the correct cache.
- [ ] Tests cover stale response ordering.

**Verification:** Deferred-promise unit tests simulating A→B transition and
cross-tab session change.

**Dependencies:** T38, T39.

**Files likely touched:**

- `frontend/src/lib/auth.ts`
- `frontend/src/lib/auth-client.ts` only if listener support is needed
- frontend auth tests.

**Estimated scope:** Medium.

### T42 — Deduplicate profile and connection reads

**Description:** Ensure shell hydration, onboarding, identity settings, and
authentication settings share the same identity-scoped read promises. Remove
duplicate profile calls without hiding errors or making stale data permanent.

**Acceptance criteria:**

- [ ] One concurrent `/profiles/me` request per identity.
- [ ] One concurrent `/auth/me` request per identity.
- [ ] One concurrent linked-account request per identity.
- [ ] Rejected promises are cleared for safe retry.
- [ ] Explicit profile mutations invalidate the relevant read cache.

**Verification:** Request-count tests and browser Network capture.

**Dependencies:** T41.

**Files likely touched:**

- `frontend/src/lib/auth.ts`
- `frontend/src/components/auth/OnboardingDialog.tsx`
- `frontend/src/components/Pesdac.tsx`
- `frontend/src/components/profile/sections.tsx`
- frontend auth tests.

**Estimated scope:** Medium.

### Checkpoint B

- [ ] Token outage no longer logs out valid users.
- [ ] A→B identity switch cannot show A’s profile/connections.
- [ ] Profile reads are deduplicated and parallel where independent.
- [ ] Backend tests and frontend build pass.

## Phase 4 — SSR timing and loading UX

### T43 — Remove avoidable SSR/client session duplication

**Description:** Review the 800 ms middleware race and implement a truthful
SSR/client handoff. Preserve fast authenticated SSR when available, but do not
turn timeout into guest. Avoid leaving unbounded Better Auth work behind a
request if the runtime supports cancellation; otherwise document the limitation
and ensure the client does not duplicate avoidable reads.

**Acceptance criteria:**

- [ ] A slow SSR session check produces a loading hint, not guest.
- [ ] The client performs only the necessary authoritative session check.
- [ ] Page render is not blocked indefinitely by Better Auth.
- [ ] Timing instrumentation proves the duplicate path was removed or bounded.

**Verification:** Browser tests with 100 ms, 1 s, and failed session responses.

**Dependencies:** T38, T37.

**Files likely touched:**

- `frontend/src/middleware/auth.ts`
- `frontend/src/components/layout/InitialSession.astro`
- `frontend/src/lib/auth.ts`
- frontend middleware/session tests.

**Estimated scope:** Medium.

### T44 — Complete Astryx loading and accessibility states

**Description:** Audit the auth shell, onboarding/profile data, and linked
accounts for unresolved-state rendering. Add only missing Astryx skeletons or
existing loading props; preserve layout and do not create a new visual system.

**Acceptance criteria:**

- [ ] Account identity has a skeleton during auth loading.
- [ ] Linked-account controls have a skeleton during account loading.
- [ ] Campus/profile loading preserves the intended layout and never shows a
  false default or guest modal.
- [ ] Loading regions use `aria-busy` and meaningful labels.
- [ ] Reduced-motion behavior remains delegated to Astryx.

**Verification:** Accessibility tree inspection and 320/768/1440 px manual
checks, plus Astro check/build.

**Dependencies:** T38, T42, T43.

**Files likely touched:**

- `frontend/src/components/Pesdac.tsx`
- `frontend/src/components/auth/OnboardingDialog.tsx`
- `frontend/src/components/profile/sections.tsx`

**Estimated scope:** Medium.

## Phase 5 — Dependency and integrated verification

### T45 — Resolve or document dependency audit findings

**Description:** Review the current high-severity Astro/esbuild/sharp audit
findings. Decide whether to isolate a dependency upgrade into a separate
migration or record an accepted risk. Do not combine a breaking Astro upgrade
with auth runtime changes.

**Acceptance criteria:**

- [ ] Installed versions and advisory paths are recorded.
- [ ] Production-runtime reachability is assessed.
- [ ] If upgrading, Astro migration notes, lockfile diff, build, and browser
  checks are reviewed.
- [ ] If deferring, owner, reason, risk, and follow-up date are documented.

**Verification:** `npm.cmd audit --omit=dev --audit-level=high` and appropriate
build/security checks.

**Dependencies:** T37.

**Files likely touched:**

- `frontend/package.json` only if approved;
- `frontend/package-lock.json` only through npm;
- dependency-risk documentation.

**Estimated scope:** Small to Large depending on approved upgrade.

### T46 — Integrated regression verification and MiniMax handoff

**Description:** Run the full verification matrix after T37–T45 and report
completed, deferred, blocked, and needs-review items without claiming that a
deferred dependency risk is fixed.

**Acceptance criteria:**

- [ ] `python -m pytest` passes.
- [ ] `npm.cmd run astro -- check` has zero errors.
- [ ] `npm.cmd run build` passes.
- [ ] `git diff --check` passes.
- [ ] Authenticated, guest, slow-auth, auth-outage, profile, campus,
  connections, OAuth, link-password, logout, deletion, 2FA, and cross-tab
  scenarios are manually tested.
- [ ] No T1–T36 feature or planned/demo flow is removed.
- [ ] MiniMax report includes files, timings, tests, screenshots/notes, risks,
  and deferred work.

**Verification:** Full commands plus browser smoke matrix.

**Dependencies:** T37–T45.

**Files likely touched:** This plan/spec and test/report documentation only.

**Estimated scope:** Medium.

## Parallelization

After T37:

- T38 can proceed independently from T41.
- T43 can proceed after T38 and the SSR contract is agreed.
- T45 can proceed independently as a security/dependency review.

Do not parallelize T39 and T40, or T41 and T42, because each later task depends
on the earlier error/cache contract.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---:|---|
| Token outage classified as logout | High | Typed error path; only confirmed 401 dispatches auth-required |
| Old user data shown after account switch | High | User-scoped cache keys and stale-response guards |
| SSR and client session checks duplicate | Medium | Explicit loading hint and measured handoff |
| Skeleton changes drift from Astryx | Medium | Use only Astryx Skeleton and current theme |
| Astro upgrade breaks SSR/auth routes | High | Separate T45 migration; no blind force fix |
| Retry repeats a mutation | High | Retry only safe bootstrap reads; no mutation replay |
| Instrumentation leaks identity data | High | Allowlist operation/status/duration only |

## MiniMax completion report format

```text
Task: T<number> — title
Status: Complete | Blocked | Needs review | Deferred
Files inspected:
- ...
Files changed:
- ...
Auth state verified:
- pending:
- guest:
- authenticated:
- service outage:
- confirmed 401:
Request behavior:
- token requests:
- /auth/me:
- /profiles/me:
- listAccounts:
UI/accessibility verified:
- ...
Performance timings:
- before:
- after:
Tests:
- command and exact result
Planned features preserved:
- ...
Risks/blockers:
- ...
Next task:
- ...
```

## Final gate

Do not report this follow-up complete if a valid session can be redirected to
login because of a token timeout, if identity caches can cross users, if the
guest gate renders during pending auth, or if the dependency audit is silently
ignored.
