# MiniMax M3 implementation prompt: PESDac hydration, Better Auth, and Web Vitals

You are MiniMax M3 implementing in the PESDac repository. Follow the plan one task at a time. Do not attempt to solve the whole issue in one pass. Read these first:

- `AGENTS.md`
- `docs/design/DESIGN.md`
- `docs/reasonix/specs/hydration-auth-web-vitals.md`
- `docs/reasonix/plans/hydration-auth-web-vitals-plan.md`
- all current T1–T54 plans/specs that overlap auth, loading, caching, or error handling

Before touching code, run `git status --short`. Existing modified/untracked files belong to the user or another implementation run. Do not reset, clean, checkout, overwrite, or commit them.

## Mission

Implement T55–T65 from the plan while T1–T54 remain active. Fix genuine Astro/React hydration problems, harden Better Auth integration, and improve measured Core Web Vitals. Do not redesign the site.

Start with T55. After each task, stop and report what you found, what changed, what passed, and what remains. Continue only when the task’s acceptance criteria are satisfied.

## Hard constraints

- Preserve T1–T54 and all existing user/concurrent changes.
- Preserve the exported Astryx Playground UI exactly: Astryx 0.5.2, StyleX, `PESDacMockupTheme`, layout, spacing, typography, colors, radii, and behavior.
- Use existing Astryx components for UI states, toasts, dialogs, buttons, and skeletons.
- Never solve hydration by adding blanket `suppressHydrationWarning` or converting the application to `client:only`.
- Never put server secrets or tokens in client code or logs.
- Do not blindly upgrade dependencies or add a library.
- Do not commit or reset files.
- Do not make a task larger than five touched files. Split it if necessary.
- Do not guess at a hydration root cause. Reproduce it and capture the component stack first.
- Do not change credentials, rotate secrets, alter the database schema, or change dependency versions without explicit human approval.

## Required working method

Work in task order. Before each edit:

1. inspect the current implementation and overlapping T1–T54 changes;
2. reproduce the issue and capture evidence;
3. make the smallest compatible change;
4. run focused tests/checks;
5. report files changed, evidence, and remaining risk.

For every task, use this report structure:

```text
Task: T__
Evidence observed:
Files inspected:
Files changed:
Acceptance criteria completed:
Commands/tests run:
Failures or warnings:
Next action:
```

If blocked, do not improvise. Report the exact blocker and the smallest safe options.

Use the Astro, debugging-and-error-recovery, Better Auth best-practices, Better Auth security, performance, Core Web Vitals, browser-testing-with-devtools, test-driven-development, incremental-implementation, frontend-ui-engineering, and code-review-and-quality guidance available in this workspace.

## Implementation priorities

### First: hydration

Start with T55. Capture the exact warning and component stack on hard loads and Astro transitions. Compare server HTML, `InitialSession` payload, `useAuth`, `AuthGate`, `authClient.useSession`, and the first render of the persisted `AppLayout` island.

Pay special attention to:

- `ClientRouter` plus `transition:persist="pesdac-shell"`;
- the 800ms middleware session timeout and null session serialization;
- browser-only reads, media-query output, random/date/locale values, and unstable keys;
- duplicate hydration or stale module/DOM caches across transitions.

Make loading explicit. A pending/unknown session must not render the create-account modal. The server hint may bootstrap the UI, but Better Auth remains authoritative after hydration. Keep loading/skeleton states accessible and styled with Astryx.

### Second: Better Auth

Audit both `lib/auth.ts` and the browser client. Verify exact local and production origins, `trustedOrigins`, CSRF protection, CORS, cookie attributes, credentials mode, rate limits, session lifetime/cache, Google OAuth state/PKCE/callbacks, account linking, logout, and secret handling.

Reconcile with T1–T54 instead of creating another auth state machine. Ensure token failures stop protected requests safely, retries only apply to transient failures, 401/revocation invalidates state coherently, and cross-tab/session-version behavior remains intact. Add integration tests for the real `apiFetch` event path.

### Third: performance

Measure production preview before changing performance. Test guest/authenticated hard loads, login transition, profile open, and first chat render on throttled mobile conditions. Record TTFB, FCP, LCP element/time, INP/long tasks, CLS sources, request waterfall, JS bytes, and execution time.

Only implement evidence-backed improvements: remove duplicate auth/profile requests, defer route-only dialogs/effects, split heavy non-critical modules, reserve layout dimensions, and keep event handlers responsive. Do not remove features or alter Astryx visuals.

## Task-by-task guardrails

### T55–T58

Do not edit code during T55 unless needed to instrument reproduction. First separate application hydration from Vite dev-toolbar/optimized-dependency errors. Then trace `InitialSession`, the 800ms middleware timeout, `useAuth`, `AuthGate`, `ClientRouter`, and `transition:persist`.

Hydration fixes must preserve the loading state and must not use blanket `suppressHydrationWarning` or `client:only`. Test hard loads and client transitions after every change.

### T59–T61

Audit Better Auth before changing it. Verify origins, cookies, CSRF, CORS, rate limiting, OAuth state/PKCE, callback URLs, session cache, and secret boundaries against the installed version. Reuse T1–T54 auth-cache/event behavior. Do not create a second auth state machine. Ensure failed token minting cannot fall through to an unauthenticated protected request.

Add tests at the real integration boundary. A helper-only test is not enough for `apiFetch`, 401 handling, and auth-required events.

### T62–T64

Measure production preview first. Do not claim a Web Vitals improvement from a dev-server result. Use identical conditions for before/after runs and record LCP element, CLS source, long interactions, request waterfall, and JS execution. Change only the bottleneck supported by evidence.

## Commands to run

From `frontend`:

```powershell
npm.cmd test
npm.cmd run astro -- check
npm.cmd run build
```

From `backend`:

```powershell
python -m pytest
```

From the repository root:

```powershell
git diff --check
```

Also verify in a real browser in both dev and production preview. Use the browser/devtools skill if available. A clean build is not sufficient: the acceptance bar includes a clean application console for the supported matrix.

If a command fails, paste the exact command and relevant error in your report. Do not work around failures by weakening tests, deleting configuration, or suppressing warnings.

## Acceptance checklist

- T55–T65 are completed in order, or any deviation is explained.
- No unexplained application hydration warnings/errors remain.
- No false auth modal while session state is pending.
- Hard loads, Astro transitions, guest/authenticated/expired/revoked/slow/offline states work.
- Better Auth origins, cookies, CSRF, rate limiting, OAuth, secret handling, and error behavior are documented and safe.
- Protected requests never silently fall through unauthenticated after token failure.
- Frontend tests, backend tests, Astro check, build, and `git diff --check` pass.
- Before/after performance evidence is included; LCP, INP, and CLS do not regress.
- Existing Astryx UI and T1–T54 behavior are unchanged.
- Every task has a report and task-level verification.
- No unexplained blocker is hidden behind a broad refactor.

## Final response format

Report:

1. root cause for each hydration issue;
2. exact files changed and why;
3. Better Auth findings and required env/deployment notes;
4. tests and browser routes run;
5. before/after Web Vitals/performance measurements;
6. unresolved risks and recommended follow-up tasks.
