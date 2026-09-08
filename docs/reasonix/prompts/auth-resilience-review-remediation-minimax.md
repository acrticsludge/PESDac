# MiniMax M3 Prompt: Auth Resilience Review Remediation

Implement the focused remediation described in:

- `docs/reasonix/specs/auth-resilience-review-remediation.md`
- `docs/reasonix/plans/auth-resilience-review-remediation-plan.md`

Read these first:

- `AGENTS.md`
- `docs/design/DESIGN.md`
- `docs/reasonix/specs/pesdac-auth-flow-lockdown.md`
- `docs/reasonix/plans/pesdac-auth-flow-lockdown-plan.md`
- `docs/reasonix/specs/auth-bootstrap-performance-resilience.md`
- `docs/reasonix/plans/auth-bootstrap-performance-resilience-plan.md`
- current uncommitted working-tree changes

## Important context

T1–T36 are complete. T37–T45 are in progress or recently implemented. Do not
rewrite them. Fix only the review blockers documented in the remediation spec.

## The bug to fix

Current flow:

```text
token mint fails
  → auth.ts clears cache
  → apiFetch continues without Authorization
  → protected backend returns 401
  → AUTH_REQUIRED_EVENT fires
  → valid user can be redirected to login
```

This is wrong. A Better Auth timeout, network failure, malformed token body,
429, or 5xx is an auth-service outage, not proof that the user session is
invalid.

## Required changes

### A. Stop the protected fallback request

In the real `apiFetch` path:

- proceed only when token mint returns `ok`;
- throw/return a typed recoverable auth-service error for all other token
  outcomes;
- do not call the FastAPI protected endpoint after token failure;
- do not dispatch `AUTH_REQUIRED_EVENT` for token failure;
- preserve existing confirmed backend 401 behavior.

Use existing error and toast infrastructure. Do not invent a second auth UI.

### B. Restrict retry statuses

Retry once, with bounded short backoff, only for:

- timeout;
- network failure;
- HTTP 429;
- HTTP 5xx.

Do not retry:

- HTTP 400;
- HTTP 401;
- HTTP 403;
- malformed response;
- missing configuration.

Never auto-retry mutations such as login, signup, OAuth, link-password,
password changes, logout, deletion, or 2FA writes.

### C. Add real integration tests

The existing pure helper tests are not enough. Add tests that exercise or
narrowly inject the actual `apiFetch` decision boundary and observe:

1. successful token → one protected request with Authorization;
2. timeout → retry policy, zero protected fallback requests, zero auth-required
   events;
3. network failure → same guarantees;
4. 429/5xx → one retry, then recoverable failure if still failing;
5. 400/401/403 → zero retry;
6. malformed body → recoverable failure, no protected fallback;
7. backend 401 after a valid token → exactly one auth-required event;
8. concurrent callers → one shared token attempt/retry sequence.

Tests must not require live Better Auth, Neon, Google, or FastAPI services.

### D. Correct the T45 audit document

Run:

```powershell
cd frontend
npm.cmd audit --omit=dev --audit-level=high
```

Update `docs/reasonix/plans/auth-bootstrap-performance-resilience-t45-decision.md`
from the exact output. Do not manually downgrade severity. Do not upgrade Astro
in this task. If deferring the upgrade, record the owner, reason, runtime vs
build/dev reachability analysis, and follow-up migration task.

## Implementation rules

- Use existing Astro, React 19, Better Auth 1.7.3, Astryx 0.5.2, and StyleX.
- Use Astryx-only UI components and `PESDacMockupTheme`.
- Preserve all existing skeletons, toasts, modals, optimistic UI, auth flows,
  planned features, and demo/mock behavior.
- Do not add dependencies.
- Do not edit `node_modules`.
- Do not expose or log secrets, cookies, tokens, passwords, OAuth codes, JWT
  claims, or user data.
- Inspect files before editing and preserve unrelated in-progress changes.
- Make one task at a time: T47, T48, T49, T50, T51, T52, T53.
- Add regression tests before reporting a task complete.

## Verification commands

```powershell
cd frontend
npm.cmd test
npm.cmd run astro -- check
npm.cmd run build
npm.cmd audit --omit=dev --audit-level=high

cd ..\backend
python -m pytest

cd ..
git diff --check
```

## Completion conditions

Do not claim completion unless:

- token failures cannot redirect valid users to login;
- no protected fallback request occurs after token failure;
- only confirmed backend 401 triggers auth-required;
- retry statuses are exact and bounded;
- integration tests cover the production decision path;
- T45 audit evidence is accurate;
- frontend tests, backend tests, Astro check, build, and diff check pass;
- T1–T36 and planned/demo functionality remain intact.

## Required report after each task

```text
Task: T<number> — title
Status: Complete | Blocked | Needs review | Deferred
Files inspected:
- ...
Files changed:
- ...
Token behavior verified:
- ...
Protected fallback request count:
- ...
Auth-required event count:
- ...
Tests:
- exact command and result
Audit decision:
- ...
Planned features preserved:
- ...
Risks/blockers:
- ...
Next task:
- ...
```

Use these skills:

- `code-review-and-quality`
- `debugging-and-error-recovery`
- `performance`
- `better-auth-best-practices`
- `better-auth-security-best-practices`
- `test-driven-development`
- `incremental-implementation`
- `planning-and-task-breakdown`
