# Hydration, Auth, and Web Vitals Plan — MiniMax M3 Edition

Use this plan after or alongside T1–T54. Do not renumber or delete T1–T54. These tasks begin at T55.

This version is intentionally explicit for MiniMax M3. It uses small tasks, narrow file scopes, concrete commands, checkpoints, stop conditions, and evidence requirements. Never implement multiple numbered tasks in one unreviewed batch.

## Execution rules

- One task at a time; keep diffs small and reviewable.
- Inspect current T1–T54 changes before editing overlapping files.
- Preserve Astryx 0.5.2, `PESDacMockupTheme`, component hierarchy, and behavior.
- Every implementation task must include focused verification before moving on.
- If a task reveals a security or data-loss risk, stop that task and document the blocker.
- Before editing, run `git status --short` and do not reset, checkout, clean, or overwrite existing changes.
- Read only the files listed for the current task plus directly imported code needed to understand it.
- Do not infer a root cause from a filename or console message; reproduce and record evidence first.
- If a task would touch more than five files, split it and stop for review.
- Do not mark a task complete until its acceptance criteria and verification commands are satisfied.
- At each checkpoint, produce a short report: changed files, tests run, failures, and next task.

## Slice 13 — Hydration evidence and render contract

### T55 — Capture and classify hydration failures

Inspect all current console errors/warnings and reproduce them on representative routes using hard loads and Astro transitions. Record component stacks, auth state, viewport, server HTML, first client values, and dev-only tooling errors separately.

Likely files: `frontend/src/pages`, `frontend/src/components/layout`, `frontend/src/lib/auth.ts`, `frontend/src/lib/session.ts`.

Acceptance criteria:

- [ ] A written table exists for each warning/error with route, reproduction steps, and category.
- [ ] Dev-toolbar/Vite optimize-dependency failures are separated from React/Astro hydration failures.
- [ ] No source file is changed unless the evidence identifies it as part of the cause.

Verification: start the dev server, reproduce at least one guest and one authenticated route, then repeat with a production build/preview if possible. Do not fix yet unless required to capture evidence.

Files likely touched: none; evidence may be saved under `docs/reasonix/`.

Dependencies: none. Scope: XS/S.

### T56 — Define the SSR/client auth bootstrap contract

Trace `middleware/auth.ts`, `InitialSession.astro`, `useAuth`, `AuthGate`, `authClient.useSession`, and the persisted shell. Make loading/authenticated/guest rendering deterministic and ensure a pending session never renders the create-account modal.

Acceptance criteria:

- [ ] `loading`, `authenticated`, and `guest` have explicit meanings.
- [ ] A pending session cannot render the create-account modal.
- [ ] The server hint, `useAuth`, and Better Auth client query have one documented authority order.

Verification: test guest, valid session, expired session, and slow-session cases. Run the focused frontend tests and `astro check`.

Files likely touched: `frontend/src/lib/auth.ts`, `frontend/src/components/auth/AuthGate.tsx`, `frontend/src/components/layout/InitialSession.astro`, possibly `frontend/src/middleware/auth.ts`. Scope: M; split if more than five files.

### T57 — Repair Astro transition and persisted-island lifecycle

Audit `ClientRouter`, `transition:persist="pesdac-shell"`, page payload replacement, and any Astro transition handling. Ensure the persisted React island does not hydrate twice, retain old session data, or miss new initial data.

Acceptance criteria:

- [ ] Login → app → profile → new-chat works through hard load and client navigation.
- [ ] The persisted island is not hydrated twice and does not retain a previous user’s session data.
- [ ] Any lifecycle hook added is narrowly scoped and documented.

Verification: browser console is clean for the transition matrix; run `astro check`, frontend tests, and build.

Files likely touched: relevant `frontend/src/pages/*.astro`, `frontend/src/components/layout/AppLayout.tsx`, and one lifecycle/cache file at most. Scope: M.

### T58 — Remove nondeterministic render inputs

Audit browser globals, local storage, media queries, random IDs, dates/locales, unstable keys, and environment branches in the main island and auth/profile components. Add deterministic SSR fallbacks and effects only where necessary.

Acceptance criteria:

- [ ] Browser-only values are read after hydration or have identical SSR fallbacks.
- [ ] IDs, keys, dates, locale output, and media-query branches are deterministic.
- [ ] No blanket `suppressHydrationWarning` or `client:only` conversion is introduced.

Verification: test desktop/mobile widths, reduced motion, guest/authenticated state, and hard/client navigation. Run frontend tests and build.

Files likely touched: one or two audited components plus focused tests. Scope: S/M.

Checkpoint after T55–T58:

- [ ] `npm.cmd test` passes in `frontend`.
- [ ] `npm.cmd run astro -- check` passes.
- [ ] `npm.cmd run build` passes.
- [ ] No new hydration warning is unexplained.
- [ ] MiniMax reports the evidence and waits for review before auth hardening.

## Slice 14 — Better Auth hardening and integration

### T59 — Audit server and browser Better Auth configuration

Review `lib/auth.ts`, `frontend/src/lib/auth-client.ts`, auth route handlers, env loading, CORS, cookies, trusted origins, CSRF, rate limits, session lifetime/cache, OAuth state/PKCE, Google callbacks, account linking, and secret exposure.

Acceptance criteria:

- [ ] Findings are classified as correct, code change, or deployment-only configuration.
- [ ] `baseURL`, trusted origins, cookies, CSRF, CORS, rate limits, OAuth callbacks, and secret handling are explicitly verified.
- [ ] No secret, cookie, token, or authorization header is printed.

Verification: inspect configuration and run safe local checks; do not rotate or delete credentials. Scope: M; documentation-only if no code issue is found.

### T60 — Reconcile auth request behavior with T1–T54

Verify `apiFetch`, token minting/retry classification, 401 handling, auth-required events, cross-tab invalidation, logout, and stale request cancellation. Protected requests must stop safely when auth cannot be established. Do not duplicate the T47–T54 implementation.

Acceptance criteria:

- [ ] Transient failures retry only under the existing T1–T54 policy.
- [ ] Deterministic 400/401/403 failures do not loop.
- [ ] Protected requests stop safely when token minting fails.
- [ ] Logout, 401, cross-tab invalidation, and session-version changes remain coherent.

Verification: add/run focused tests for network, timeout, 429/5xx, deterministic 4xx, expired, and revoked sessions. Scope: M; split auth cache and API integration if needed.

### T61 — Add auth/hydration regression coverage

Add focused tests for the real integration boundaries: initial-session bootstrap, AuthGate pending behavior, Astro transition state refresh, `apiFetch` auth-required event flow, and Google/email success/failure states. Use existing test tooling and avoid production-only test exports unless justified.

Acceptance criteria:

- [ ] Tests exercise the real integration boundary, not only helper functions.
- [ ] AuthGate pending behavior and initial-session bootstrap are covered.
- [ ] Google/email success and failure paths have explicit assertions.

Verification: run `npm.cmd test`, backend tests, `astro check`, and build. Scope: M.

Checkpoint after T59–T61:

- [ ] Frontend tests pass.
- [ ] Backend tests pass.
- [ ] Astro check and build pass.
- [ ] No auth secret appears in logs, bundles, tests, or generated output.
- [ ] MiniMax reports security findings and waits before performance edits.

## Slice 15 — Performance and Web Vitals

### T62 — Establish reproducible performance baseline

Use production preview with throttled mobile CPU/network for guest/authenticated hard loads, login transition, profile open, and first chat render. Record TTFB, FCP, LCP element/time, INP/long tasks, CLS sources, request waterfall, transferred bytes, and JS execution.

Acceptance criteria:

- [ ] Measurements use production preview, not only the dev server.
- [ ] Guest and authenticated routes are tested under the same conditions.
- [ ] Report includes URL, viewport, CPU/network throttle, browser, auth state, run count, LCP element, CLS sources, and request/JS data.

Verification: use Chrome DevTools/Lighthouse or the existing browser-testing skill. Scope: XS/S; documentation and measurement only.

### T63 — Reduce critical-path work

Use the baseline to remove duplicate session/profile requests, defer non-critical dialogs/effects, split heavy route-only modules, reserve dynamic layout space, and protect input handlers. Do not change Astryx visuals or remove functionality. Avoid adding dependencies unless evidence requires them.

Acceptance criteria:

- [ ] Every optimization cites a baseline problem and expected metric.
- [ ] Duplicate requests, critical-path code, layout dimensions, and event work are addressed only when evidence supports it.
- [ ] No Astryx visual or feature regression occurs.

Verification: run the relevant browser route, console check, build, and focused tests after each optimization. Scope: M; split any bundle, request, and rendering changes into separate tasks.

### T64 — Verify Core Web Vitals and regression budgets

Repeat the T62 matrix. Compare LCP ≤2.5s, INP ≤200ms, CLS ≤0.1, TTFB/FCP supporting goals, JS bytes, and first interaction latency. Investigate any regression before accepting.

Acceptance criteria:

- [ ] Before/after runs use identical conditions.
- [ ] LCP ≤2.5s, INP ≤200ms, and CLS ≤0.1 are reported where measurable, or the remaining gap is explained.
- [ ] No regression in TTFB, FCP, transferred JS, or first interaction latency is hidden.

Verification: repeat T62 and attach the report. Scope: S.

## Slice 16 — Final review

### T65 — Final quality and deployment handoff

Run code review, security review, browser verification, `astro check`, frontend tests, backend tests, build, and `git diff --check`. Confirm env/callback/CORS deployment notes, rollback considerations, unresolved issues, and T1–T54 compatibility.

Acceptance criteria:

- [ ] Code-review, security, browser, test, check, build, and diff checks pass.
- [ ] T1–T54 compatibility is explicitly confirmed.
- [ ] Remaining risks have severity, reproduction, and follow-up task.

Verification: `npm.cmd test`, `python -m pytest`, `npm.cmd run astro -- check`, `npm.cmd run build`, and `git diff --check`. Scope: S.

## Dependency order

`T55 → T56 → T57 → T58 → T59 → T60 → T61 → T62 → T63 → T64 → T65`

T62 may begin in parallel with T59 after T58, but T63 must wait for the baseline. T65 is blocked until all prior checkpoints pass.

## MiniMax M3 stop conditions

Stop and report instead of guessing when:

- the current T1–T54 implementation is missing, contradictory, or already modified by another agent;
- a fix requires changing the Astryx theme, changing dependency versions, rotating credentials, or changing database schema;
- the console error cannot be reproduced;
- a proposed change would touch more than five files in one task;
- local and production auth origins/cookies cannot be determined safely;
- a performance improvement cannot be measured before and after.

The report must contain: task number, evidence, files inspected, exact blocker, safe options, and the next smallest action.
