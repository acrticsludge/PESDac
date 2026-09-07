# PESDac Full Website Frontend + Backend Audit

Audit date: 2026-09-07

Scope: the complete current frontend, BetterAuth integration, FastAPI backend, database layer, user-visible states, and planned/dummy feature boundaries.

Purpose: give MiniMax M3 a complete defect and readiness map. This audit does not authorize removing planned dummy features.

## Severity

- Critical: security, data loss, broken authentication, false success, or blank screen.
- High: a common user flow is unreliable or the frontend/backend contract is misleading.
- Medium: resilience, accessibility, consistency, or maintainability gap.
- Planned: intentionally incomplete product functionality. Keep the surface and dummy behavior; make it honest and integration-ready.

## Executive summary

The visual foundation is strong and the BetterAuth/FastAPI seams exist, but the website is not yet a reliable end-to-end application.

The main causes are:

1. Some async handlers do not await the promise whose error they try to catch.
2. Some failures are swallowed, while others show raw or inconsistent messages.
3. Session state is split between SSR markup, BetterAuth client state, cached promises, and an in-memory product store.
4. Account deletion crosses BetterAuth and the backend without a durable transaction/reconciliation contract.
5. JWT/JWKS verification and post-logout token semantics are incomplete.
6. Profile persistence is only partial; several preferences remain local/dummy by design.
7. Chat containers exist in FastAPI, but the frontend still uses a deterministic in-memory responder.
8. There is no React error boundary.
9. There are no adequate frontend/browser auth regression tests.
10. Planned UI exists without all backend integrations; it must remain visible and honestly communicate what is demo/local/planned.

The target is not merely a happy-path login. Every operation must tell the user whether it is idle, validating, in progress, complete, failed, canceled, timed out, partially complete, or still planned.

## Canonical file map

### Frontend

| File | Responsibility | Required audit |
|---|---|---|
| frontend/src/components/auth/AuthLayout.tsx | Login, signup, Google, 2FA | Promise ownership, validation, focus, safe copy, redirect state |
| frontend/src/components/auth/AuthGate.tsx | Required login dialog | Session race, focus, return path, navigation failure |
| frontend/src/components/auth/OnboardingDialog.tsx | Required first-run setup | Load failure, retry, save rollback, required dialog |
| frontend/src/components/auth/AuthBackground.tsx | Planned auth visuals | Decorative fallback; never block hydration |
| frontend/src/components/AppToasts.tsx | Toast host/global rejection safety net | Dedupe, safe logging, relationship to error boundary |
| frontend/src/components/Pesdac.tsx | App shell, nav, logout, local actions | 401 convergence, logout truth, planned controls |
| frontend/src/components/profile/ProfileDialog.tsx | Profile modal/tabs/search | Load pane, tabs, close/focus, empty/error state |
| frontend/src/components/profile/sections.tsx | Identity, preferences, privacy, auth settings | Every save/link/2FA/export/delete state |
| frontend/src/components/chat/ThreadView.tsx | Demo chat, retry, regenerate, copy | Planned backend seam, abort/errors/copy |
| frontend/src/components/chat/AttachButton.tsx | Attachment staging | Planned upload boundary and local errors |
| frontend/src/components/layout/AppLayout.tsx | Shell route wrapper | Route props and persisted island behavior |
| frontend/src/components/layout/InitialSession.astro | SSR session JSON | Stale cache, malformed/missing data, privacy |
| frontend/src/lib/auth.ts | Auth facade and API client | Timeout, typed errors, caches, logout/delete |
| frontend/src/lib/auth-client.ts | BetterAuth browser client | Base URL and plugin parity |
| frontend/src/lib/async-action.ts | Async action helper | Cancel/stale result/error state |
| frontend/src/lib/session.ts | In-memory planned product state | User isolation and persistence honesty |
| frontend/src/lib/chat.ts | Demo catalog/routes | Unknown subject/code fallback |
| frontend/src/lib/responder.ts | Deterministic planned responder | Simulated error/empty/limit/tool states |
| frontend/src/lib/attachments.ts | Attachment metadata | Future upload contract |
| frontend/src/middleware/auth.ts | SSR session lookup | Timeout, guest fallback, observability |
| frontend/src/pages/api/auth/[...slug].ts | BetterAuth Astro handler | Request, cookie, response forwarding |
| frontend/src/pages/login.astro and signup.astro | Auth pages | SSR/CSR transition and dev assets |
| frontend/src/pages/index.astro, new.astro, profile.astro, subject routes | App routes | Auth gate, bootstrap, unknown route |
| frontend/src/styles/global.css | Astryx foundation | No broad overrides |
| frontend/src/theme/PESDacMockupTheme.js | Theme source of truth | Never change to hide functional defects |
| frontend/astro.config.mjs | Astro/Vite/Node | 504 cache guard and build/dev parity |

### BetterAuth and database

| File | Responsibility | Required audit |
|---|---|---|
| lib/auth.ts | BetterAuth server configuration | Env, Google, 2FA, JWT, session, deletion |
| lib/auth-client.ts | Shared auth boundary | Runtime import separation |
| lib/db/schema.ts | BetterAuth schema | Session/account/JWKS/cascade assumptions |
| lib/db/index.ts | Drizzle connection | Startup and connection failures |
| lib/db/migrations/* | Auth migrations | Applied state, rollback, orphan rows |

### FastAPI backend

| File | Responsibility | Required audit |
|---|---|---|
| backend/app/main.py | App factory, middleware, errors | Startup fallback, envelope, headers, CORS |
| backend/app/config.py | Env loading and validation | Production/test separation |
| backend/app/auth/betterauth.py | JWKS/JWT verification | Issuer, audience, algorithms, kid refresh |
| backend/app/deps.py | Auth dependency and origin guard | Scope, origin policy, upsert race |
| backend/app/rate_limit.py | Rate limiter | Bounds, multi-worker behavior, proxy IP |
| backend/app/routers/auth.py | Me, logout, link password | Upstream failure, cookies, logout semantics |
| backend/app/routers/users.py | Export and delete | Scope, deletion contract, response |
| backend/app/routers/profiles.py | Profile read/patch | Ownership, validation, rollback |
| backend/app/routers/chats.py | Authenticated chat containers | Scope, update errors, future message seam |
| backend/app/routers/demo_state.py | Demo overrides | Validation and races |
| backend/app/routers/health.py | Health/readiness | Truthful readiness |
| backend/app/models/* | Persistence models | Defaults, constraints, cascade |
| backend/app/schemas/* | API validation/output | Exact wire contract |
| backend/tests/* | Backend tests | Missing frontend/browser coverage |

## Critical findings

### C1 — Google error handling is still broken

File: frontend/src/components/auth/AuthLayout.tsx around handleGoogleSignIn.

The function calls signInWithGoogle with void inside try/catch. Rejected promises escape to the global unhandled rejection handler. The finally block resets Google loading before the request has settled.

Required:

- Await the call or attach a local rejection handler.
- Keep the button disabled while redirect initiation is pending.
- Handle invalid_client, redirect mismatch, denied/canceled access, invalid state, timeout, network failure, and server failure.
- Use a local safe auth error surface first; the global toast is only a fallback.
- Add a regression test proving a rejected promise reaches the local handler.

### C2 — Backend token failure is treated as anonymous

File: frontend/src/lib/auth.ts, getBackendToken.

Token acquisition has no timeout and catches every failure, returning null. apiFetch starts its timeout afterward. The UI cannot tell missing session from unavailable BetterAuth.

Required:

- Timeout and abort token acquisition.
- Deduplicate concurrent token mint requests.
- Distinguish confirmed guest, auth service unavailable, timeout, malformed response, and invalid token.
- Do not silently send a protected request as a guest after infrastructure failure.

### C3 — Account deletion can orphan data

Files: frontend/src/lib/auth.ts and backend/app/routers/users.py.

The current client deletes BetterAuth identity before backend data. Backend failure after identity deletion is represented only by a fallback boolean; no durable retry/reconciliation exists.

Required:

- Select a contract: coordinated server operation, pre-authorized backend deletion before identity deletion, or resumable deletion job.
- Make repeated requests safe.
- Never claim full deletion when only identity deletion finished.
- Give a partial-completion status/reference and recovery path.
- Test every failure ordering.

### C4 — SSR session cache can outlive its document state

Files: frontend/src/components/layout/InitialSession.astro and frontend/src/lib/auth.ts.

The module-global initial session cache can survive Astro transitions and persisted islands. It must not make a later user/route render with stale identity.

Required:

- Key or invalidate bootstrap data on document/transition/user identity.
- Clear all auth/profile/account/product caches on logout, 401, deletion, or user change.
- Test hard refresh, same-tab sign-out/sign-in, and Astro navigation.

### C5 — BetterAuth session and backend JWT can disagree

Files: frontend/src/lib/auth.ts, backend/app/auth/betterauth.py, backend/app/routers/auth.py.

A BetterAuth session can be valid while the backend JWT is expired/invalid. Backend logout is currently a no-op.

Required:

- Define lifetimes and revocation guarantees.
- Handle one 401 epoch: clear token, abort protected requests, notify once, navigate once.
- Document whether a stale token works after logout.
- Protect sensitive routes according to the chosen revocation model.

### C6 — JWT verification is incomplete

File: backend/app/auth/betterauth.py.

Audience validation is disabled; issuer is not enforced; unknown kid handling and operational error visibility need strengthening.

Required:

- Allow only configured algorithms.
- Validate issuer, audience, expiration, not-before, subject, and required email claim.
- Refresh JWKS once for unknown kid.
- Bound JWKS requests.
- Return generic 401 while logging safe operational category.

### C7 — No React error boundary

File: frontend app root and AppToasts.

Unhandled promise rejection handling does not catch render/lifecycle errors. A React exception can still produce a blank island.

Required:

- Add an app-level React error boundary using Astryx components.
- Include retry/remount and safe navigation.
- Use a non-sensitive reference ID.
- Test render failure and recovery.

## File-level frontend requirements

### AuthLayout.tsx

- Use explicit idle, validating, submitting, redirecting, 2FA, success, and error states.
- Await every async handler that has local catch/finally.
- Prevent email/Google double submission.
- Make Enter submit exactly once.
- Trim submitted email without surprising input mutation.
- Show name/password rules before submit.
- Support autocomplete/current-password/new-password/one-time-code through Astryx-supported props.
- Map raw BetterAuth errors into safe user copy.
- Use accessible live error output, invalid state, described-by links, and focus first invalid field.
- Preserve safe fields after recoverable errors; never expose/log passwords.
- Leave email form usable after Google failure.
- Navigate only after confirmed session.
- Handle auth page already logged in without redirect loops.
- Handle 2FA invalid, expired, rate-limited, back, and success states.
- Keep current Astryx layout/theme/background intact.

### AuthGate.tsx

- Do not show gate during unresolved session hydration.
- Preserve required dialog behavior and working login/signup navigation.
- Preserve an allowlisted return path.
- Handle navigation failure.
- Test focus entry/return, browser back, forward, and Astro transitions.
- Do not remove planned gate behavior.

### OnboardingDialog.tsx

- Make slow checking visible without flashing false content.
- Keep dialog open on fetch/save failure.
- Preserve values on save failure and timeout.
- Retry must re-fetch server truth.
- Prevent duplicate saves.
- Handle malformed/unknown options.
- Focus and announce invalid/missing selections.
- Confirm successful save before closing.
- Keep required onboarding behavior.

### AppToasts.tsx

- Deduplicate repeated global errors.
- Do not duplicate local form/action errors.
- Do not log sensitive rejection reasons.
- Integrate with the React error boundary.
- Verify live-region semantics, duration, and route-transition survival.

### Pesdac.tsx

- Deduplicate 401 handling and redirect.
- Clear user-scoped state on logout, deletion, and account switch.
- Show server profile hydration failure rather than silently hiding it.
- Make logout progress and result truthful.
- Add loading/error/retry states to search, rename, pin, archive, hide, delete, and navigation actions.
- Keep planned/dummy chats and label local/demo/planned behavior honestly.
- Unknown routes must get a useful fallback.
- Do not remove future controls.

### ProfileDialog.tsx

- Loading, empty search, error, retry, pending-close, and focus-return states.
- Mobile behavior at 320px and 200% zoom.
- Keep tab/search behavior intact.

### sections.tsx

Identity:
- BetterAuth-owned identity fields are read-only or use a trusted BetterAuth flow.
- Optimistic campus/semester/branch/subjects changes roll back atomically.
- Concurrent saves cannot apply stale responses over new values.
- Map 401, 422, 429, timeout, and 5xx separately.
- Do not show saved before server confirmation.

Privacy/export/clear:
- Export handles loading, timeout, malformed payload, download failure, and retry.
- Export excludes tokens/secrets.
- Clear uses destructive modal with cancel/pending/failure/success.
- Local state cleanup follows the server contract.
- Preserve planned local/demo data.

Authentication:
- Linked accounts have loading/empty/error/retry.
- Prevent unlinking last usable method.
- Link Google handles redirect, callback, denial, already linked, and network failure.
- Link password handles mismatch, policy, timeout, upstream, and session errors.
- Change password handles wrong current password, policy, rate limit, timeout, and expiry.
- 2FA setup handles missing/malformed URI, missing backup codes, invalid/expired code, already enabled, and network failure.
- Backup codes have copy/download and warning treatment.
- Disable 2FA requires explicit security confirmation.
- Every action has a distinct loading state and disables only conflicting controls.

### auth.ts

- Avoid import-time blanking when public config is absent; provide a controlled configuration error in development.
- Preserve status, code, details, and safe reference IDs in ApiError.
- Distinguish timeout from user cancellation.
- Timeout token acquisition and API requests.
- Deduplicate token mint requests.
- Invalidate token/profile/account caches on user changes.
- Parse 204, JSON, empty, malformed, and unexpected responses.
- Retry only safe/idempotent requests.
- Deduplicate auth-required events.
- Return honest logout results.
- Replace deletion ordering with selected deletion contract.
- Add tests for every exported auth operation.

### session.ts

This is intentionally temporary in-memory product state. Do not remove it.

- Namespace state by authenticated user ID.
- Clear on logout/account switch.
- Keep planned/demo/local features.
- Do not claim storage health that is not measured.
- Protect listener fanout from one listener throwing.
- Bound or clean overlay/message growth.
- Handle malformed state and duplicate codes.
- Preserve future backend adapter signatures.

### ThreadView.tsx, responder.ts, attachments.ts

These are planned/dummy product flows, not removal targets.

- Keep simulated error, empty, limit, and tool-error inputs.
- Each simulation needs clear retry/next-step copy.
- Abort settles state and preserves partial output.
- Retry does not duplicate user messages.
- Regenerate/edit handles stale/missing overlay and failed persistence.
- Copy uses clipboard first, fallback second, and maps permission failure to toast.
- Replace deprecated execCommand as a focused task.
- Attachment staging handles unsupported type, size, duplicate, cancel, preview failure, and removal.
- Do not pretend staged files are uploaded.
- Sanitize future model output before Markdown.

### Pages, middleware, and config

- Include session bootstrap consistently on protected routes.
- Make middleware timeout observable; do not silently treat auth outage as ordinary guest forever.
- Reconcile SSR/client session disagreement.
- Test persisted Astro islands and transitions.
- Auth pages need a controlled configuration error.
- Keep optimizeDeps.force as a dev-cache guard without production impact.
- Document hard reload after stale versioned dev asset URLs.
- Preserve Astryx CSS/theme.

## BetterAuth and database requirements

lib/auth.ts:
- Validate required secrets instead of relying on non-null assertions.
- Validate Google credentials server-side.
- Configure exact base URL and trusted origins.
- Keep CSRF protection.
- Confirm OAuth state/PKCE and callback behavior.
- Define expiry/update-age/cookie attributes for localhost and production.
- Keep account enumeration safe.
- Match UI/server password policy.
- Define 2FA recovery semantics.
- Require fresh auth for deletion/sensitive changes.
- Avoid unnecessary OAuth token storage and never export tokens.
- Add safe audit events.

Database/migrations:
- Verify account/session/two-factor/JWKS foreign keys and cascades.
- Confirm BetterAuth deletion does not assume PESDac rows are deleted.
- Confirm PESDac deletion cascades profile/chats/demo state.
- Add orphan detection/reconciliation query.
- Test migrations in a disposable database.
- Verify lookup indexes.

## Backend requirements

config.py:
- Deployment environment variables must not be silently overridden by local files.
- Test-mode bypass must be explicit.
- Validate URLs/origins and insecure-cookie combinations.
- Never log values.

main.py:
- Production must fail fast, not create an unvalidated fallback.
- Standardize all errors, preserve Retry-After, attach safe request/reference IDs.
- Test security headers and CORS.
- Separate liveness from database readiness.

betterauth.py:
- Validate algorithm, issuer, audience, time claims, subject/email.
- Force-refresh unknown kid once.
- Bound JWKS timeout.
- Log safe categories.

deps.py:
- Standard 401 for all auth failures.
- Verified claims are the only identity source.
- Explicit absent-origin policy.
- Exact/proxy-aware origin comparison.
- Safe correlation IDs.

rate_limit.py:
- Bounded development fallback.
- Shared store or explicit single-worker constraint.
- Trusted proxy handling.
- Limits for login/signup/password/2FA/OAuth/export/clear/delete.
- Retry-After and clock-boundary tests.

routers/auth.py:
- Safe /me profile creation failure.
- Document no-op logout semantics or implement revocation.
- Forward only intended session cookie for link password.
- Distinguish upstream timeout, validation, invalid session, and unexpected response.
- Add freshness/idempotency for linking.

routers/users.py:
- Export is scoped, bounded, versioned, and secret-free.
- Delete is transactional or returns a real job/status contract.
- Delete is safe to retry.
- Add orphan/reconciliation handling.

profiles.py and schemas:
- Remove or route BetterAuth-owned fields.
- Validate catalog fields and max sizes.
- Roll back commit/refresh failures.
- Return canonical full profile.
- Add concurrency/version handling before multi-client editing.
- Do not imply local-only settings are persisted.

chats.py and demo_state.py:

These are planned backend foundations. Do not remove them.

- Preserve user scoping and cross-user 404 behavior.
- Validate title/subject/code lengths and characters.
- Handle duplicate/race/commit failures.
- Keep message/SSE/upload work as planned next phase.
- Define future reconciliation from local demo/custom state to server state.

## UX contract

For every action, the user must know:

1. What is happening?
2. Is it validating or sending?
3. Is it still running?
4. Did it succeed?
5. If not, what happened?
6. What can they do next?
7. What data was preserved/rolled back/partially changed?
8. Can retry be safe?
9. Does the action need a modal?
10. What does a screen reader hear?

Use Astryx toast for small recoverable operations. Use Astryx modal for deletion, clear-all, disabling 2FA, last-method unlink, or leaving pending changes.

Never leave an infinite spinner, show false saved/deleted/linked text, navigate away before an unknown result, expose raw exceptions, or remove planned dummy features.

## Planned features must remain

Keep deterministic demo responses, static subject threads, local custom chats, attachment staging, future uploads, future share links, future study library, future AI/SSE messages, and future durable preferences.

For each planned feature, retain the UI and intended behavior, label demo/local/planned boundaries, add mock loading/error/empty states, preserve future adapter signatures, and never claim an in-memory operation is persisted.

## Verification matrix

Static:
- frontend npm.cmd run astro -- check
- frontend npm.cmd run build
- backend python -m pytest
- git diff --check
- dependency audit reviewed
- no secrets in tracked diff

Browser:
- guest visit;
- email signup validation/server failure;
- invalid credentials;
- auth timeout;
- Google success/invalid_client/mismatch/denial/callback failure;
- 2FA invalid/expired/rate-limited/success/back;
- refresh after login;
- API session expiry and simultaneous 401s;
- logout success/server failure;
- account switch;
- profile save/load failure;
- export failure;
- clear cancel/failure/success;
- deletion cancel/failure/partial/success;
- render crash recovery;
- 320/768/1024/1440px and 200% zoom.

Backend:
- malformed and invalid tokens;
- wrong issuer/audience/algorithm/signature;
- unknown kid and JWKS outage;
- cross-user every user-owned route;
- allowed/denied/no-origin/proxy origins;
- CORS credentials;
- rate limit/Retry-After;
- DB rollback;
- startup missing env;
- health readiness;
- deletion idempotency/orphans.

## Release gate

Auth and website foundation are ready for core product work only when no Critical finding remains, all Required file-level items are complete or explicitly blocked, planned features remain intact, every user-facing operation has a recoverable state, all verification passes, and accepted limitations have an owner/follow-up task.

## Incident follow-up: link-password 404

The reported browser error was a `404` for `POST /api/v1/auth/link-password`.
The current source and assembled FastAPI application both define this route:

- frontend: `frontend/src/lib/auth.ts` calls `/auth/link-password`, which is
  resolved by `apiFetch` against `PUBLIC_API_BASE_URL` plus `/api/v1`;
- backend: `backend/app/routers/auth.py` defines `POST /link-password` and
  `backend/app/main.py` mounts the router at `/api/v1`;
- live verification: the current backend OpenAPI lists the route and an
  unauthenticated request returns `401`, not `404`.

This indicates the screenshot came from a stale backend worker or stale
frontend/dev-server state rather than a missing current implementation. The
backend was restarted from the repository's `backend` directory. A route
registration regression test was added to
`backend/tests/test_auth_contract.py`; the localhost smoke check must also be
run after restarting both dev servers and hard-refreshing the browser.
