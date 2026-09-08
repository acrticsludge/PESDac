# Hydration, Better Auth, and Core Web Vitals Hardening

Status: implementation handoff for MiniMax M3
Scope: follow-up work while T1–T54 are in progress or being verified

## 1. Objective

Make PESDac reliable on the first render and fast under realistic network conditions:

1. Remove genuine Astro/React hydration warnings and errors without hiding them with blanket suppression.
2. Make server-rendered auth state and the first browser render obey one deterministic contract.
3. Bring Better Auth configuration and request handling in line with secure production practice.
4. Improve TTFB, LCP, INP, and CLS using measured changes rather than speculative refactors.
5. Preserve all T1–T54 behavior, the existing Astryx Playground UI, `PESDacMockupTheme`, and current routes.

This document is additive. It must not replace, reset, or silently rework the T1–T54 implementation. If a conflict is found, document it and keep the smallest compatible change.

MiniMax M3 execution note: use the companion plan as the source of task order. Do not attempt the entire plan in one pass. Finish one task, run its verification, and report the result before starting the next task.

## 2. Non-negotiable project constraints

- Astro + React 19 + Astryx 0.5.2 + StyleX remain in place.
- Use existing Astryx components and theme. Do not recreate Astryx with custom HTML/CSS.
- Do not redesign spacing, colors, typography, layout, or component hierarchy.
- Do not add Tailwind or another UI library.
- Do not expose `BETTER_AUTH_SECRET`, database credentials, OAuth secrets, JWT signing material, or server-only auth config to client code.
- Do not use `suppressHydrationWarning` as a general fix.
- Do not use `client:only` as a blanket fix; use it only when a component is fundamentally browser-only and record why.
- Do not upgrade Astro, Better Auth, Astryx, React, or add a performance dependency without documenting the reason and compatibility impact.
- Keep existing uncommitted user/concurrent changes intact.

## 3. Current architecture to understand first

Relevant areas:

- `frontend/src/pages/*.astro`: `ClientRouter`, `InitialSession`, and persisted `AppLayout` islands.
- `frontend/src/components/layout/InitialSession.astro`: server-embedded session JSON.
- `frontend/src/components/layout/AppLayout.tsx` and `frontend/src/components/Pesdac.tsx`: the main `client:load` island and persisted shell.
- `frontend/src/lib/auth.ts`: client auth state, initial-session cache, token minting, `apiFetch`, and auth events.
- `frontend/src/lib/auth-client.ts`: Better Auth browser client.
- `frontend/src/components/auth/AuthGate.tsx` and onboarding UI: guest/loading/authenticated decisions.
- `frontend/src/middleware/auth.ts`: server session lookup and its timeout behavior.
- `lib/auth.ts`: server Better Auth configuration.
- `frontend/src/pages/api/auth/[...slug].ts`: Astro auth route adapter.
- `frontend/src/lib/session.ts`, profile sections, and `ProfileDialog.tsx`: browser state and media-query boundaries.
- `frontend/astro.config.mjs`: Node adapter, React integration, Vite aliases, and dependency optimization.

Known risk areas are hypotheses, not diagnoses. Confirm each with a reproduction and component stack:

- `ClientRouter` plus `transition:persist="pesdac-shell"` can preserve a React island while page-level `InitialSession` markup changes.
- The middleware’s short server timeout can serialize `null` even when the browser later discovers a valid session, producing a different first client state.
- Browser-only values, media queries, local storage, random IDs, dates, or environment-dependent branches can differ between SSR and hydration.
- Persisted islands need explicit transition lifecycle handling; a module-level cache or DOM lookup must not retain a previous user/page indefinitely.
- Dev-toolbar and Vite “Outdated Optimize Dep” 504s are separate from a React hydration mismatch. Track them separately.

## 4. Functional requirements

### HYD-1: Evidence-first hydration diagnosis

For every warning/error, record:

- exact console text and component stack;
- route, viewport, auth state, and whether the navigation was a hard load or an Astro client transition;
- server HTML or serialized props involved;
- first client render values;
- whether the failure occurs in development only, production preview, or both.

Do not close a hydration issue because the screen looks correct. The acceptance condition is a clean console on the supported test matrix, apart from explicitly documented third-party/dev-tool messages.

### HYD-2: Deterministic auth bootstrap

Define one contract for `loading`, `authenticated`, and `guest`.

- The server-rendered hint and the first client render must agree for the same request.
- `AuthGate` must never render a create-account/login modal while auth is unresolved.
- A cached or embedded session is a bootstrap hint, not a permanent authority. Better Auth’s session query remains authoritative after hydration.
- Guest rendering must occur only after the initial session check is resolved, or after a documented timeout/error state that cannot be mistaken for a valid guest session.
- A stale session must be cleared when the user identity changes or the session is revoked.
- Ensure transitions re-read the current page/session payload without breaking the persisted shell.
- Preserve T1–T54 token retry, logout, cache, and event behavior; fix integration issues rather than duplicating auth state machines.

### HYD-3: Safe Astro/React boundaries

Audit all components rendered by the main island and make the smallest correction:

- move browser-only reads into effects or an explicit client boundary;
- provide identical SSR fallback markup for media-query-dependent content;
- make IDs and list keys deterministic;
- avoid render-time random/date/locale output;
- ensure conditional trees do not change before hydration unless the server receives the same input;
- use Astro transition lifecycle hooks only where required by persisted islands;
- retain accessible loading/skeleton states while data is pending.

### AUTH-1: Better Auth configuration review

Audit `lib/auth.ts`, env loading, the Astro route adapter, and client fetch configuration against the installed Better Auth version.

- `baseURL`, frontend origin, API origin, and callback URLs must be explicit and consistent in local and production environments.
- Configure `trustedOrigins` for the exact local and deployed origins; do not use broad wildcards casually.
- Keep CSRF/origin protection enabled.
- Confirm secure, HttpOnly, SameSite cookie behavior in production and correct localhost behavior during testing.
- Confirm every browser auth request uses the required credentials/cookie mode and that backend CORS allows only intended origins.
- Keep a strong 32+ character production secret outside source control.
- Keep rate limiting enabled; use durable storage where multiple backend instances require shared limits.
- Review session expiry, update age, fresh-session requirements, cookie cache tradeoffs, and revocation behavior.
- Review Google OAuth state/PKCE, callback URL validation, account linking, duplicate provider accounts, and failure redirects.
- Enable OAuth-token encryption only if provider tokens are stored or later used; do not add it blindly.
- Review JWT/JWKS token minting for issuer, audience, expiry, key rotation, and error handling.
- Avoid logging tokens, cookies, authorization headers, passwords, or full OAuth responses.
- Preserve generic authentication error messages to avoid account enumeration.

### AUTH-2: Auth request and error contract

Verify all auth paths: email sign-in, sign-up, Google sign-in, email linking, password reset, logout, session refresh, token minting, profile loading, and onboarding.

- Every failed request has a typed, user-safe error state and a retry path where appropriate.
- Network/timeout/429/5xx token failures may retry according to the T1–T54 policy; deterministic 400/401/403 failures must not be retried blindly.
- Protected API calls must not continue unauthenticated after token minting fails; they must return a typed auth-required result and let the UI show the existing Astryx flow.
- Abort stale requests on route/user changes where possible.
- Keep cross-tab sign-out and session-version invalidation coherent.
- Add integration coverage for the actual `apiFetch` event path, not only isolated token helpers.

### PERF-1: Measure before changing

Create a baseline in production mode (`astro build` + preview) on a throttled mobile profile for guest/authenticated hard loads, login-to-app navigation, profile open/data refresh, and first chat route render.

Record TTFB, FCP, LCP element/time, INP or long interactions, CLS sources, transferred bytes, JS execution, and request waterfall. Use the same routes and conditions after each change.

Targets are the 75th percentile “good” thresholds: LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1. Treat TTFB under 800ms and FCP under 1.8s as practical supporting goals.

### PERF-2: Optimize the critical path without visual changes

Investigate, measure, and only then implement:

- avoid blocking the first meaningful paint on duplicate session/profile/campus requests;
- keep above-the-fold SSR markup useful while auth/data loads;
- split or defer profile dialogs, chat-only modules, globe/effects, icons, and other non-critical code when not needed for the first route;
- remove duplicate requests and abort stale requests;
- preserve dimensions for images, SVGs, dialogs, skeletons, and other dynamic regions to prevent CLS;
- use `font-display` and font loading consistent with the existing design;
- yield or defer expensive event work to protect INP;
- keep Astro/Vite dependency optimization deterministic and avoid masking stale-cache problems with arbitrary config.

Do not optimize by removing functionality or changing the Astryx UI.

## 5. Acceptance criteria

- No unexplained hydration warnings/errors on the supported browser matrix in dev and production preview.
- Hard loads and Astro transitions work for guest, authenticated, expired-session, revoked-session, slow-auth, auth-error, and offline cases.
- No false create-account modal while auth is pending.
- Server and first client auth state are deterministic and documented.
- Better Auth config has explicit origins, secure secret handling, CSRF, cookies, rate limiting, OAuth callback/state, and safe error behavior.
- Auth failures do not cause silent unauthenticated protected requests or infinite retry loops.
- Automated checks pass: `astro check`, frontend tests, backend tests, build, and `git diff --check`.
- Production-preview measurements show no regression in LCP, INP, CLS, TTFB, transferred JS, or first interaction latency; improvements include before/after evidence.
- Existing T1–T54 behavior and Astryx visuals remain intact.

## 6. Verification matrix

| Case | Expected result |
|---|---|
| Guest hard load | Stable loading/skeleton, then guest UI; no auth modal flash |
| Valid session hard load | SSR hint and first client render agree; app shell appears without duplicate blocking work |
| Expired/revoked session | Authenticated UI is invalidated safely and guest flow is recoverable |
| Slow auth endpoint | Loading state remains visible; no false guest state; retry/error is clear |
| Google success/cancel/failure | Correct callback, safe redirect, no stuck loading state |
| Email linking failure/success | Typed result, toast/modal according to severity, state refreshed |
| Astro transition | Persisted shell does not hydrate twice or retain old user/page data |
| Mobile viewport/media query | SSR fallback hydrates without mismatch and layout remains stable |
| Offline/API 5xx | No infinite retries; user can retry and protected calls remain protected |

## 7. Required implementation output

The implementer must provide:

1. a concise root-cause log for each hydration issue;
2. a file-level change summary;
3. auth configuration/security findings and any env changes;
4. before/after performance measurements and test conditions;
5. tests added or updated;
6. unresolved items with severity and a safe follow-up task.
