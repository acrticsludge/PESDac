# Spec: T47–T65 Remainder — Real apiFetch Integration Coverage

## Status

Proposed. Completes the automatable remainder of T47–T65. Browser/provider-gated
items (outage-injection matrix, credential-backed Google OAuth, Lighthouse CWV)
stay documented follow-ups in the T47–T65 implementation report.

## Objective

Close the two automatable gaps found in the T47–T65 audit without touching UI:

1. **T50 is overstated.** `frontend/tests/auth-api.test.ts` only exercises the pure
   `withBearerToken` helper. The plan/spec require observing the real `apiFetch`
   decision boundary: fetch calls made, `Authorization` presence, and
   `AUTH_REQUIRED_EVENT` dispatch.
2. **T49 tests are partial.** `mintTokenWithRetry` has call-count tests for
   429/5xx/400/401/403/unexpected-status, but not for timeout, network, or
   malformed outcomes, even though the retry policy explicitly covers them.

Success: every T47–T53 acceptance criterion that can run headlessly is proven by
a test that observes the production code path. No Astryx/visual change.

## Tech Stack

- Astro 6.0.5 + `@astrojs/node` 10.0.2 (pinned pair, server output)
- React 19, Astryx 0.5.2, `PESDacMockupTheme` (untouched)
- Better Auth 1.7.3 (client `better-auth/react` + `twoFactorClient`)
- Node built-in test runner (`node --test --experimental-transform-types`)

## Commands

```powershell
cd frontend
npm.cmd test
npm.cmd run astro -- check
npm.cmd run build
cd ..\backend
python -m pytest
cd ..
git diff --check
```

Focused loop while editing tests:

```powershell
cd frontend
npm.cmd test
```

## Project Structure

```text
frontend/src/lib/auth.ts        → apiFetch, token mint, caches, test hooks
frontend/src/lib/auth-cache.ts  → pure token classification + retry (no React/env)
frontend/src/lib/auth-client.ts → Better Auth browser client
frontend/tests/auth-cache.test.ts → pure helper tests (extend for T49)
frontend/tests/auth-api.test.ts   → production-boundary tests (extend for T50)
docs/reasonix/specs/             → this spec
docs/reasonix/plans/             → implementation plan
```

## Code Style

Follow the existing test files: `node:test` + `node:assert/strict`, small local
response factories, exact call-count assertions. Example of the established
pattern (do not change it):

```ts
test("mintTokenWithRetry does not retry 401 client-error", async () => {
  let calls = 0;
  const fn: typeof fetch = async () => {
    calls += 1;
    return makeHttpResponse(401);
  };
  const result = await mintTokenWithRetry("https://auth.test", fn, 1000, 10);
  assert.equal(result.reason, "client-error");
  assert.equal(calls, 1, "no retry for non-retryable 401");
});
```

Production source stays minimal and additive. Test-only seams mirror the existing
`__setAuthBaseForTesting` / `__resetAuthCachesForTesting` pattern.

## Testing Strategy

- Framework: Node built-in runner, no new dependencies.
- T49 additions live in `frontend/tests/auth-cache.test.ts` (pure, no DOM).
- T50 additions live in `frontend/tests/auth-api.test.ts` and MUST import the
  real `apiFetch` from `frontend/src/lib/auth.ts`, with:
  - a fetch router distinguishing the token endpoint (`/api/auth/token`) from
    the API endpoint (`/api/v1/...`),
  - per-test isolation via `__resetAuthCachesForTesting`,
  - a minimal fake `window` (addEventListener/dispatchEvent + flag) because
    Node has no `window`; `CustomEvent` exists natively.
- Coverage required (each with exact fetch-count assertions):
  1. success → exactly 1 token call + 1 protected request with `Bearer` header;
  2. token failure (e.g. 500 twice) → 0 protected requests, `AuthServiceError`;
  3. token failure → 0 `AUTH_REQUIRED_EVENT` dispatches;
  4. backend 401 on a token-bearing request → exactly 1 `AUTH_REQUIRED_EVENT`;
  5. concurrent `apiFetch` callers share one token attempt/retry sequence.

## Boundaries

- Always: smallest diff; run `npm.cmd test` after each task; keep Astryx UI,
  theme, routes, and T1–T54 behavior intact; never log tokens/secrets.
- Ask first: any dependency upgrade; any cookie/JWT/session config change;
  any user-visible navigation change.
- Never: `npm audit fix --force`; retry mutations automatically; turn
  auth-service outage into logout; redesign UI; commit secrets or build output.

## Success Criteria

- [ ] `mintTokenWithRetry` timeout → 2 attempts, `timeout` result.
- [ ] `mintTokenWithRetry` network failure → 2 attempts, `network` result.
- [ ] `mintTokenWithRetry` malformed → 1 attempt, `malformed` result.
- [ ] T50 tests import the real `apiFetch` and assert all five behaviors above.
- [ ] `npm.cmd test` 26 + new tests pass; `astro check` 0 errors; `build`
      passes; `python -m pytest` passes; `git diff --check` passes.
- [ ] No UI/visual diff; source diff limited to test-only seams + tests.

## Open Questions

None blocking. Browser outage matrix, OAuth provider smoke, and Lighthouse CWV
remain environment-gated and are tracked as follow-ups, not claimed here.

## ASSUMPTIONS MADE

1. Node 22 test env has `fetch`, `Response`, `CustomEvent`, `DOMException`
   (verified) and no `window`/`document` (verified) — a tiny fake window is
   legitimate test scaffolding.
2. Adding explicit `.ts` extensions to the three relative imports in
   `frontend/src/lib/auth.ts` is Vite/Astro-safe (verified via check+build).
3. An `apiRootOverride` test seam mirroring `authBaseOverride` is acceptable
   because `PUBLIC_API_BASE_URL` is unset under Node and `apiFetch` otherwise
   throws `missing-config` before any token logic.
