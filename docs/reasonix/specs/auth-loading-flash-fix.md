# Spec: loading flashes — gate on refresh, profile error after login

Status: Proposed
Audit basis: user report 2026-09-08 (gate dialog flashes on refresh while logged in; post-login transient "couldn't load profile" / gate flashes that self-resolve) + code inspection of the same session (no code changed for this spec).
Stack: Astro + React 19 + Astryx 0.5.2 + StyleX + `PESDacMockupTheme` (per `AGENTS.md`; `CLAUDE.md` Next.js/Supabase references are stale for this repo and do not apply).

## 1. Problem

Two flashes, one theme: **transient slowness rendered as final state**.

**S1 — gate flash on refresh (logged in).** Refresh `/new` while signed in: the "Log in to continue" `AuthGate` dialog appears mid-load, then vanishes once the session resolves. Root cause chain (all verified in current code): dev-SSR `auth.api.getSession` in `middleware/auth.ts` routinely exceeds its 800ms `SESSION_TIMEOUT` race (slice-11's premise: 3–8s per SSR round-trip in dev) or throws on a cold DB — and the `catch` maps timeout/throw to the SAME `null` locals as a proved guest. `InitialSession.astro` serializes that as tag `null`; the slice-11 pending branch reads present-guest with unchanged epoch and resolves `guest` instantly. Before slice-11 this window rendered `loading`; the instant-guest fast path misfires exactly when the server *gave up* rather than *proved guest*.

**S2 — profile-error flash after login.** `OnboardingDialog` fires `Promise.all([apiGetMe(), apiGetProfile()])` once on `authenticated` with NO retry (`OnboardingDialog.tsx:105-153`). First request after login routinely hits a cold backend (token mint + JWKS + Neon cold start) and rejects -> `phase === "error"` opens the "Couldn't load your profile" required dialog. Retry (manual "Try again") then succeeds because the backend is warm — matching the report ("gone after a few seconds", i.e. after retry resolves). A single transient failure must never open a required dialog.

## 2. Users

- Signed-in users refreshing app routes (S1): must never see the gate, not even for a frame.
- Newly logged-in users (S2): must never see a profile-error dialog for a failure that a prompt retry would have absorbed.
- Genuine guests: gate must STILL open instantly (slice-11 AC preserved — this spec narrows the hint, it does not revert it).

## 3. Goals

1. Middleware distinguishes **proved guest** (`getSession` affirmatively returned no session) from **unknown** (timeout/throw). Only proved-guest embeds tag `null`; unknown embeds an explicit unknown marker.
2. `useAuth()` pending branch maps unknown -> `loading` (wait for the live check, today's pre-slice-11 behavior for that window). present-guest -> `guest` and present-user -> `authenticated` stay instant.
3. Onboarding check retries transient failures silently (bounded policy, §6 FR2) and opens the error dialog ONLY after exhaustion. Manual "Try again" keeps working exactly as today.
4. Genuine-guest path provably unchanged: guest `/new` with a fast middleware still resolves `guest` pre-`useSession` (existing initial-session tests keep passing unmodified).

## 4. Non-goals

- No middleware timeout retuning as THE fix (800ms stays; dev-SSR slowness is environmental per slice-11 out-of-scope — but T1 records whether production timings make the timeout itself suspect; if prod `getSession` p50 approaches the budget, that becomes its own spec).
- No auto-retry on mutations (rename/link/password flows untouched); the onboarding check is a READ, retries are safe and idempotent.
- No Astryx/theme/CSS/dialog-copy change ("Couldn't load your profile" copy, buttons, sizes all stay).
- No backend change, no schema/migration, no new endpoint, no new dependency.
- No Step-2/Step-4 revival; no BFCache work beyond the existing accepted limitation.

## 5. User flows

### F1: Refresh while logged in, slow middleware (S1 fixed)

1. SSR: `getSession` exceeds 800ms (or throws) -> locals marked unknown -> tag carries unknown marker.
2. Hydrate (`loading`), effect commits, `useSession` pending + epoch unchanged -> resolver sees unknown -> `loading`. Shell renders as-is; NO gate.
3. Live `useSession` resolves authenticated -> normal authenticated render. User perceives a slightly longer load, never a gate flash.

### F2: Refresh while logged in, fast middleware (unchanged)

1. Tag carries the session object -> instant `authenticated` (current behavior, preserved).

### F3: Genuine guest (unchanged)

1. `getSession` affirmatively returns no session (fast: no cookie, no DB work) -> tag `null` -> instant `guest` -> gate opens pre-`useSession` (slice-11 headline preserved).

### F4: Post-login cold backend (S2 fixed)

1. Onboarding check attempt 1 rejects transiently (network/timeout/5xx) -> silent retry per policy (checking phase renders null, as today).
2. Retry succeeds -> wizard opens (new user) or `done` (onboarded). No error dialog ever painted.
3. Retries exhausted (persistent outage) -> error dialog exactly as today, manual retry intact.

### F5: 401 mid-check (unchanged)

1. `identity-changed`/logout-transition silences and genuine 401 flows global — the existing `isLogoutTransition() || isTransitionNoise(error)` guard runs on EVERY attempt's failure, including retries, not just the first.

## 6. Functional requirements

### FR1: Unknown-state initial session (S1)

- Middleware MUST separate outcomes: `{ session }` with a session -> user locals; affirmative no-session -> guest locals; timeout/throw -> **unknown locals** (new third state, e.g. `session: undefined` vs `null` — implementer picks the representation, spec fixes the semantics).
- `InitialSession.astro` MUST serialize all three states distinctly (proved-guest `null` MUST NOT be reused for unknown; propose `"unknown"` literal or `{ state }` envelope — keep the payload JSON-safe and tiny).
- Tag reader becomes quad-state `{ present, user }` where present-unknown is `present: true, user: null` PLUS an explicit unknown flag (do NOT overload `present: false`: absent-tag (auth pages, transit nav) and unknown (server gave up) share the `loading` outcome today but must stay distinguishable for logging/tests).
- Resolver: unknown (+ unchanged epoch) -> `loading`. Epoch-mismatch still forces `loading` for every tag kind. The §6 FR2 table from the guest-instant spec gains one row; all six existing cells MUST NOT change (existing `initial-session.test.ts` passes unmodified).
- Logging: middleware timeout/throw keeps its silent-guest fallback behavior for LOCALS consumers (SSR pages must not crash) but SHOULD log one line (method + path + `session=unknown`, no PII) so operators can see timeout frequency — currently invisible.

### FR2: Silent retry for the onboarding check (S2)

- Policy (bounded, reads-only): up to **3 attempts total**, backoff **300ms then 900ms** (under the existing 15s `API_TIMEOUT_MS` per attempt; total worst case well inside human patience and far below the sum of three full timeouts because transient cold-start failures reject fast — T1 measures the actual first-failure latency to sanity-check the budget).
- Retryable: network `TypeError`, `AbortError`, 5xx `ApiError`, `AuthServiceError` (token-mint outage — the session is alive, the mint side is down; retrying is correct).
- NOT retryable (fail fast to current handling): 401/`AuthRequiredError` (global flow), `identity-changed` (stale resolve), logout-transition window, 4xx other than 429? — 429 SHOULD retry once after `Retry-After` (cap wait at 5s; the link-password precedent sends `Retry-After`). 400/403/404 go straight to the error dialog as today (real problems, retry won't help).
- `checking` phase keeps rendering null through retries (no spinner/dialog swap mid-retry — the current null render IS the loading state).
- Attempt count MUST reset when `authUserId` changes or manual retry fires (no cross-identity retry leakage; `attempt` state already exists — extend it, don't add a parallel counter).
- Pure retry-policy helper, exported for tests (proposed: `isRetryableOnboardingError(error, attempt): boolean` or a `withOnboardingRetry(fn)` wrapper — implementer picks the shape; unit-testable without timers via injected sleep).

### FR3: No other behavior change

- `AuthGate`, dialog copy/sizes, `apiGetMe`/`apiGetProfile` contracts, token minting, epoch semantics, guest/authenticated fast paths: untouched.
- Onboarding manual retry button, `onActiveChange` wiring, Esc handling: untouched.

## 7. Acceptance criteria

- [ ] AC1: Slow/timeout middleware on refresh-while-authed NEVER opens the gate (unit: unknown tag + unchanged epoch -> `loading`; browser: throttled-refresh matrix, gate absent until live resolve).
- [ ] AC2: Genuine guest still resolves `guest` pre-`useSession` (existing initial-session suite green UNMODIFIED + guest curl shows proved-guest tag, not unknown).
- [ ] AC3: Forced single-transient-failure onboarding check (stubbed first-attempt reject, then success) NEVER paints the error dialog; wizard/`done` lands after silent retry (unit + browser with throttled backend if feasible).
- [ ] AC4: Forced persistent failure still opens the exact current error dialog after policy exhaustion; manual retry still works; 401/identity-changed/logout-window still bypass retries to current handling.
- [ ] AC5: `npm.cmd test` + `astro check` + `astro build` + `git diff --check` pass; backend suite green with zero backend diffs.
- [ ] AC6: Astryx UI/theme/copy/layout unchanged; desktop + <=640px; clean console.

## 8. Constraints

- `AGENTS.md` UI rules apply in full (this change should touch no JSX except possibly zero lines — error dialog and gate JSX stay byte-identical).
- Max five touched source files (expected: `middleware/auth.ts`, `InitialSession.astro`, `auth.ts` tag+resolver, `OnboardingDialog.tsx`, one test file; helper may push to a second test file — split if exceeded).
- Never lengthen the 800ms middleware timeout as the fix; never add unbounded/perpetual retry; never auto-retry a mutation.
- Work on `fix/auth-loading-flash` from main; no commit/push unless asked.

## 9. API / interface requirements

- No public API change (frontend or backend). The tag payload shape change is an internal SSR->client contract: document the three serialized states in `InitialSession.astro`'s header comment (it already documents the contract — extend, don't relocate).
- Retry helper (whatever the shape) MUST be pure/injectable for node:test (no real timers in unit tests — inject sleep or return decisions).

## 10. Data requirements

- None. No schema/migration. Tags stay transient HTML.

## 11. Security requirements

- Unknown-state must fail closed to `loading` (never `guest` — that reopens the exact flash; never `authenticated`).
- Retry policy MUST NOT retry 401s (re-login flow owns them) and MUST reset attempt state on identity change (no cross-user retry bleed).
- No tokens/PII in new log line (method + path + outcome only). No secrets in tests (synthetic users).

## 12. Testing requirements

- node:test, no DOM library (existing stub styles): resolver quad-state table (new unknown row × epoch match/mismatch), tag serializer/reader cases (guest/user/unknown/absent/malformed), retry-policy matrix (retryable: TypeError/AbortError/5xx/AuthServiceError/429-once; terminal: 401/identity-changed/400/403/404; exhaustion opens error), attempt-reset on identity change.
- Existing `initial-session.test.ts` MUST pass unmodified (pins the six preserved cells).
- Browser (user-assisted): refresh-while-authed with throttled CPU/network (gate must not appear); cold-backend login (error dialog must not appear on first transient; wizard lands); persistent-failure still dialogs; desktop + narrow; clean console.

## 13. Rollout / rollback

- Rollout: frontend-only. No flag/env/migration. Verify post-deploy with the AC2 guest curl (proved-guest tag literal) + a logged-in refresh watch.
- Rollback: revert branch; behavior returns to today's flashes (self-resolving, non-destructive). No data impact.
