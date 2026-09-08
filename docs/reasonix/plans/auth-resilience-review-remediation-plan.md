# Plan: Auth Resilience Review Remediation

## Context

This plan follows the code review of T37–T45. T1–T36 remain complete and are
not to be rewritten. The work is deliberately split into small, reviewable
tasks.

## Dependency graph

```text
T47 baseline + audit capture
  ├── T48 typed token failure boundary
  │     └── T49 status-aware retry
  │           └── T50 apiFetch integration behavior
  ├── T51 recovery UI verification
  └── T52 dependency audit correction
        └── T53 final regression gate
```

T48 must precede T49 and T50. T51 depends on T48. T52 is independent. T53
depends on all tasks.

## T47 — Capture baseline and exact audit evidence

**Description:** Inspect the current implementation and record the exact
token-failure behavior plus the current audit output. Do not change runtime
code in this task.

**Acceptance criteria:**

- [ ] Confirm current `apiFetch` behavior for token timeout, 5xx, malformed
  response, and backend 401.
- [ ] Record whether a protected fallback request is made.
- [ ] Run `npm.cmd audit --omit=dev --audit-level=high` and preserve exact
  package/severity output.

**Verification:** Baseline tests and a focused mocked request trace.

**Dependencies:** None.

**Files:** Documentation/test notes only.

**Size:** Small.

## T48 — Enforce typed token failure boundary

**Description:** Change the frontend request orchestration so only a successful
token result proceeds to a protected backend request. All other results return
or throw a typed recoverable auth-service failure. Preserve existing confirmed
401 handling.

**Acceptance criteria:**

- [ ] No `Authorization` header is attached unless token mint succeeds.
- [ ] No protected request is attempted after token mint failure.
- [ ] No auth-required event is dispatched for token mint failure.
- [ ] Existing backend 401 behavior remains unchanged.
- [ ] Error maps through existing safe user-message/toast handling.

**Verification:** Focused integration tests for `apiFetch`.

**Dependencies:** T47.

**Files:**

- `frontend/src/lib/auth.ts`
- `frontend/src/lib/auth-cache.ts` if the result type needs refinement
- focused frontend tests.

**Size:** Medium.

## T49 — Restrict retryable token statuses

**Description:** Make the retry helper retry only transient conditions.

**Acceptance criteria:**

- [ ] Timeout, network, 429, and 5xx retry once.
- [ ] 400, 401, 403, malformed response, and missing config do not retry.
- [ ] Backoff remains bounded and testable.
- [ ] No auth mutation is automatically replayed.

**Verification:** Unit tests with exact call counts for each category.

**Dependencies:** T48.

**Files:**

- `frontend/src/lib/auth-cache.ts`
- `frontend/tests/auth-cache.test.ts`

**Size:** Small.

## T50 — Add production-path auth integration tests

**Description:** Test the actual `apiFetch` decision boundary, not only pure
token helpers. Observe fetch calls and auth-required event dispatch.

**Acceptance criteria:**

- [ ] Successful token mint produces exactly one protected request.
- [ ] Failed token mint produces zero protected requests.
- [ ] Failed token mint produces zero auth-required events.
- [ ] Confirmed backend 401 produces one auth-required event.
- [ ] Concurrent callers share the same token attempt/retry sequence.

**Verification:** `npm.cmd test` with focused test names visible in output.

**Dependencies:** T48, T49.

**Files:**

- `frontend/tests/auth-api.test.ts` or equivalent focused test file
- `frontend/src/lib/auth.ts` only if a narrow test seam is necessary.

**Size:** Medium.

## T51 — Verify recovery UI without changing design

**Description:** Ensure auth-service failure remains in the current shell,
uses existing Astryx toast/retry behavior, and does not open the required
guest gate. Preserve current skeletons and planned features.

**Acceptance criteria:**

- [ ] Auth-service failure is visible and actionable.
- [ ] Retry is safe for reads and bounded.
- [ ] No login redirect occurs for token-service outage.
- [ ] Confirmed invalid session still uses the existing required auth flow.

**Verification:** Manual browser test with delayed/failing token endpoint at
320, 768, 1024, and 1440 px widths.

**Dependencies:** T48.

**Files:**

- `frontend/src/components/Pesdac.tsx` only if needed
- existing toast/loading owner only if needed.

**Size:** Small to Medium.

## T52 — Correct T45 dependency audit record

**Description:** Regenerate the dependency decision from the exact current
`npm audit` output. Correct severity labels and separate accepted risk from
unverified assumptions. Do not upgrade Astro in this task.

**Acceptance criteria:**

- [ ] Every listed advisory matches the command output.
- [ ] Runtime/build/dev reachability claims are clearly labeled as analysis.
- [ ] Owner, follow-up, and reason for deferral are present.
- [ ] No advisory is downgraded manually.

**Verification:** Re-run the audit command and compare the document line by
line with its output.

**Dependencies:** T47.

**Files:**

- `docs/reasonix/plans/auth-bootstrap-performance-resilience-t45-decision.md`

**Size:** Small.

## Checkpoint A — after T48–T50

- [ ] Frontend integration tests pass.
- [ ] Token failures cannot trigger logout.
- [ ] Retry call counts are exact.
- [ ] Backend tests remain green.

## T53 — Final regression gate and MiniMax report

**Description:** Run the full verification suite and report the result without
claiming completion if any required finding remains.

**Acceptance criteria:**

- [ ] `npm.cmd test` passes.
- [ ] `npm.cmd run astro -- check` has zero errors.
- [ ] `npm.cmd run build` passes.
- [ ] `python -m pytest` passes.
- [ ] `git diff --check` passes.
- [ ] Manual auth/session outage matrix passes.
- [ ] T1–T36 and planned/demo features remain intact.
- [ ] Any dependency risk is explicitly deferred with accurate evidence.

**Dependencies:** T47–T52.

**Files:** Verification report and docs only.

**Size:** Medium.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---:|---|
| Valid user is redirected during auth outage | High | Stop before protected fallback request; typed service error |
| Retry repeats invalid credential request | Medium | Retry only timeout/network/429/5xx |
| Tests prove helpers but not production flow | High | T50 observes actual `apiFetch` fetch/event behavior |
| Audit record understates vulnerability | High | T52 copies exact current audit evidence |
| UI changes drift from Astryx | Medium | Reuse existing toast/skeleton/theme only |

## MiniMax task report format

```text
Task: T<number> — title
Status: Complete | Blocked | Needs review | Deferred
Files inspected:
- ...
Files changed:
- ...
Token behavior:
- success:
- timeout/network:
- 429/5xx:
- 400/401/403:
- malformed:
Protected fallback request:
- ...
Auth-required events:
- ...
Tests:
- exact command and result
Planned features preserved:
- ...
Risks/blockers:
- ...
Next task:
- ...
```
