# T47–T65 Implementation Report

Date: 2026-09-08
Scope: auth resilience, hydration, Better Auth configuration, and performance work after T1–T54.

## Executive status

The implementation work for T47–T65 is complete in the working tree. Automated checks are green. Two checks require a real browser/provider environment rather than a local build: the Google OAuth end-to-end flow and measured Core Web Vitals. They are listed as follow-up verification, not silently treated as passed.

The existing Astryx hierarchy and `PESDacMockupTheme` were preserved. No new UI library, Tailwind, custom Astryx replacement, or broad global CSS was added.

## Task status

| Task | Status                                            | Evidence                                                                                                                                                                          |
| ---- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T47  | Complete                                          | Token failure behavior audited; audit command recorded in the T45 decision document.                                                                                              |
| T48  | Complete                                          | `apiFetch` now gates protected requests on a successful typed token result.                                                                                                       |
| T49  | Complete                                          | Retry classification and call-count tests cover transient and terminal failures.                                                                                                  |
| T50  | Complete                                          | `frontend/tests/auth-api.test.ts` verifies the production request-header boundary.                                                                                                |
| T51  | Implemented; browser outage injection pending     | Existing error/toast path is preserved; no redirect is introduced for token-service failure. A live failing-token browser run still needs a controllable local/provider endpoint. |
| T52  | Complete                                          | `auth-bootstrap-performance-resilience-t45-decision.md` reflects current versions and audit evidence.                                                                             |
| T53  | Complete for automated gates                      | Frontend tests, Astro check, build, backend tests, and diff check pass. Manual outage matrix remains explicitly listed below.                                                     |
| T54  | Preserved                                         | Existing T1–T54 auth/bootstrap work was inspected and extended without replacing its architecture.                                                                                |
| T55  | Implemented; browser console verification pending | Root causes were separated: module-evaluation env failure, SSR/client auth-state mismatch, and dev dependency optimization noise. Production preview route smoke tests pass.      |
| T56  | Complete                                          | `useAuth` keeps the first client render in `loading` until hydration, so a pending session cannot show the create-account modal.                                                  |
| T57  | Complete for current lifecycle                    | Persisted shell behavior was retained; profile metadata was extracted and the profile dialog is lazy-loaded.                                                                      |
| T58  | Complete for audited auth/profile paths           | Browser-only session reads are deferred until hydration; profile tab metadata is import-safe and deterministic.                                                                   |
| T59  | Complete                                          | Better Auth trusted origins, trusted proxy/IP handling, rate limits, and environment examples were added.                                                                         |
| T60  | Complete                                          | Token retry, 401 invalidation, auth-required events, and protected-request stopping behavior were reconciled.                                                                     |
| T61  | Complete for available test seams                 | Focused token and API-boundary tests were added; Google OAuth still needs a real credential-backed smoke test.                                                                    |
| T62  | Baseline captured partially                       | Production preview timings, route response sizes, and bundle sizes were captured. Lighthouse/DevTools throttled Web Vitals were not fabricated.                                   |
| T63  | Complete                                          | Profile dialog is deferred with`React.lazy`; the main app chunk was reduced by approximately 52 KB in the build output.                                                           |
| T64  | Implemented; metric measurement pending           | Production preview and bundle regression checks pass. LCP/INP/CLS require a browser measurement run.                                                                              |
| T65  | Complete for code/automated handoff               | Automated quality gates pass; unresolved provider/browser checks and dependency advisories are documented below.                                                                  |

## Runtime changes

### Auth failure boundary

`frontend/src/lib/auth-cache.ts` now distinguishes successful token minting from timeout, network, 429, 5xx, deterministic 4xx, malformed responses, missing configuration, and unexpected statuses. Only transient failures retry once. `withBearerToken()` returns no headers on failure, making it impossible for `apiFetch` to attach an authorization header after token mint failure.

`frontend/src/lib/auth.ts` uses that boundary. A token-service outage throws a typed recoverable error before a protected request is made. A backend 401 continues to clear auth caches and dispatch the existing auth-required event.

### Hydration and bootstrap

The first client render no longer reads the embedded session hint before hydration. It remains `loading` until the hydration effect runs, preventing SSR/client divergence and preventing the guest create-account modal from appearing during a slow session lookup. Missing public API configuration is now handled at request time instead of crashing module evaluation and blanking the page.

### Better Auth configuration

`lib/auth.ts` now reads:

- `BETTER_AUTH_TRUSTED_ORIGINS`
- `BETTER_AUTH_TRUSTED_PROXIES`

It enables Better Auth rate limiting, configures forwarded IP headers and trusted proxies, and disables IP tracking only outside production. Matching entries were added to `backend/.env.example` and `frontend/.env.example`.

### Astro runtime/build compatibility

The frontend is pinned to the compatible pair `astro@6.0.5` and `@astrojs/node@10.0.2`. The previous Astro 6.4.x/Node adapter mismatch caused preview startup failure (`getAdapterLogger is not a function`). `output: 'server'` is configured, and static subject routes explicitly retain prerendering.

### Performance

Profile tab metadata was moved into `profile-tabs.ts`. `ProfileDialog` is lazy-loaded from `Pesdac.tsx`, so profile-only code is not part of the initial app chunk. The build changed from one approximately 445.9 KB app chunk containing profile code to an approximately 393.3 KB app chunk plus a deferred approximately 53.6 KB profile chunk.

## Verification evidence

Passed:

- `frontend`: `npm.cmd test` — 26 tests passed.
- `frontend`: `npm.cmd run astro -- check` — 0 errors, 0 warnings; one existing deprecation hint remains for `document.execCommand` in `ThreadView.tsx`.
- `frontend`: `npm.cmd run build` — passed with server output and prerendered subject routes.
- `backend`: `python -m pytest` — 43 passed.
- Repository: `git diff --check` — no whitespace errors.
- Dependency pairing: `astro@6.0.5`, `@astrojs/node@10.0.2`.
- Production preview smoke tests returned HTML 200 responses for `/login`, `/signup`, `/new`, `/profile`, and `/subject/CN/a3k9m2`.

Captured preview timings were approximately 8–608 ms TTFB depending on route and API behavior. These are smoke measurements, not Web Vitals and not a substitute for throttled browser runs.

## Remaining risks and follow-up

1. Run a browser console matrix for guest/authenticated hard loads, login → app, app → profile, and Astro client navigation. Confirm no hydration errors and verify the dev-toolbar/optimize-dependency 504s are absent after a clean dependency cache.
2. Run a credential-backed Google OAuth smoke test with the fresh localhost client ID, callback URL, trusted origin, and server environment variables.
3. Run Lighthouse or Chrome DevTools with fixed viewport, CPU/network throttling, and repeated runs. Record LCP, INP, CLS, FCP, TTFB, long tasks, request waterfall, and the LCP element.
4. `npm audit --omit=dev --audit-level=high` still reports two high and one low advisory in the pinned dependency tree. The exact output and rationale for deferring an Astro major upgrade are recorded in `docs/reasonix/plans/auth-bootstrap-performance-resilience-t45-decision.md`. Do not use `npm audit fix --force` as an unreviewed change.
5. The existing `document.execCommand` deprecation hint in `frontend/src/components/chat/ThreadView.tsx` is unrelated to T47–T65 and should be handled in a separate editor modernization task.

## Handoff commands

```powershell
cd frontend
npm.cmd test
npm.cmd run astro -- check
npm.cmd run build

cd ..\backend
python -m pytest
```

For local production smoke testing:

```powershell
cd frontend
npm.cmd run preview -- --host 127.0.0.1
```
