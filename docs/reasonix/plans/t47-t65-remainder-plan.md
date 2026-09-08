# Plan: T47–T65 Remainder — Real apiFetch Integration Coverage

Implements `docs/reasonix/specs/t47-t65-remainder.md`. Small additive slices,
each independently verifiable. No UI change.

## Dependency graph

```text
R1 node-resolvable imports (auth.ts .ts extensions)
  └── R2 apiRoot test seam
        ├── R3 T49 retry tests (independent of R1/R2, runs first)
        └── R4 T50 apiFetch integration tests (needs R1+R2)
              └── R5 full verification + review + ship
```

R3 is independent of R1/R2 (pure `auth-cache.ts`, already node-importable), so
it lands first for a fast green checkpoint.

## R1 — Make auth.ts node-importable (test enabler, no behavior change)

Objective: real `apiFetch` becomes importable under the Node test runner.

- Files: `frontend/src/lib/auth.ts` (3 import specifiers only).
- Change `./buffer-polyfill` → `./buffer-polyfill.ts`, `./auth-client` →
  `./auth-client.ts`, `./auth-cache` → `./auth-cache.ts`.
- Acceptance: probe import succeeds; `astro check` 0 errors; `build` passes.
- Verify: `npm.cmd test` (existing suite still green) + `npm.cmd run astro -- check`.
- Rollback: revert the 3 specifiers; no logic depends on them.

## R2 — Add apiRoot test seam (mirrors existing authBaseOverride)

Objective: let headless tests set the API root since `PUBLIC_API_BASE_URL` is
unset under Node and `apiFetch` otherwise throws `missing-config` pre-token.

- Files: `frontend/src/lib/auth.ts` (test-hooks section + `apiFetch` root read).
- Add `apiRootOverride`, `currentApiRoot()`, `__setApiRootForTesting`,
  `__getApiRootForTesting`; use `currentApiRoot()` in `apiFetch`.
- Production default unchanged (env value when present, `""` otherwise).
- Acceptance: no production call-site change; seam only read by tests.
- Verify: `npm.cmd test`.

## R3 — T49 missing retry tests (XS, tests only)

Objective: prove retry policy for the three uncovered outcomes.

- Files: `frontend/tests/auth-cache.test.ts` (append only).
- Tests: timeout → 2 attempts / `timeout`; network `TypeError` → 2 attempts /
  `network`; malformed 200 body → 1 attempt / `malformed`. Short backoff
  (10ms) matching existing style.
- Acceptance: spec success criteria 1–3; exact call counts asserted.
- Verify: `npm.cmd test`.
- Commit: `test: cover timeout/network/malformed token retry counts (T49)`.

## R4 — T50 real apiFetch integration tests (M, tests + R1/R2 seams)

Objective: observe the production decision boundary, not the helper.

- Files: `frontend/tests/auth-api.test.ts` (extend; keep existing 3 helper
  tests untouched).
- Harness: import real `apiFetch`, `AuthServiceError`, `AUTH_REQUIRED_EVENT`,
  `__resetAuthCachesForTesting`, `__setAuthBaseForTesting`,
  `__setApiRootForTesting`, `__setFetchForTesting` from
  `../src/lib/auth.ts`. Fetch router records token vs API calls and captured
  `Authorization` headers. Fake `window` with listener set installed per test
  and removed afterwards (`delete (globalThis as ...).window`).
- Five tests per spec §Testing Strategy (success 1+1 w/ Bearer; failure 0 API
  calls + AuthServiceError; failure 0 events; backend 401 → 1 event;
  concurrent callers share one token sequence).
- Acceptance: all five pass; failure paths assert zero protected requests.
- Verify: `npm.cmd test`.
- Commit: `test: prove apiFetch token boundary with real integration tests (T50)`.

## R5 — Full verification, review, ship

- Verify: `npm.cmd test`, `npm.cmd run astro -- check`, `npm.cmd run build`,
  `python -m pytest` (backend), `git diff --check`.
- Review: correctness (counts exact?), security (no secret/token logging, fake
  window removed per test, no production seam leakage), simplicity (no new
  deps, no UI diff). `git status` scope check.
- Ship: feature branch `feat/t47-t65-remainder`, atomic commits per slice
  (R1+R2 seam commit, R3 commit, R4 commit, spec/plan commit), final report per
  CLAUDE.md §38.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| `.ts` extensions break Astro/Vite resolution | Med | check+build gate on R1 before proceeding |
| `better-auth/react` import has browser side effects under Node | Med | probe import first; keep fake window minimal; no real network |
| Fake window leaks between tests | Low | install/remove per test in try/finally; reset caches per test |
| Scope creep into browser-gated items | Low | OAuth/Lighthouse stay follow-ups, explicitly not claimed |

## Stop conditions

Stop and report instead of guessing when: the `auth.ts` Node import fails for
reasons beyond extension resolution; `better-auth` client throws at import
time; or any gate regresses and the cause is not in the sliced files.
