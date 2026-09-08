# Spec: instant guest AuthGate via embedded initial session (slice-11 Step 1 completion)

Status: Proposed
Audit basis: `docs/slices/slice-11-popup-latency.md` (AuthGate + OnboardingDialog Popup Latency); gap analysis performed 2026-09-08 against current `main` (no code changed).
Stack: Astro + React 19 + Astryx 0.5.2 + StyleX + `PESDacMockupTheme` (per `AGENTS.md`; `CLAUDE.md` Next.js/Supabase references are stale for this repo and do not apply).

## 1. Problem

Slice-11's headline complaint is unresolved: a logged-out user visiting `/new` still waits the full `authClient.useSession()` round-trip (client -> Astro SSR -> BetterAuth -> Neon, 5-10s on the reporter's machine) before the "Log in to continue" `AuthGate` dialog appears.

Step 1 of the slice (pass the middleware-loaded session to the client via an embedded JSON tag) is **half-implemented**:

- `frontend/src/components/layout/InitialSession.astro` embeds `<script id="pesdac:initial-session" type="application/json">` (session object or `null`) on `/new`, `/profile`, and `subject/*` routes. This half works.
- `readInitialSession()` (`frontend/src/lib/auth.ts:182-224`) returns `SessionUser | null`, conflating three distinct states: server-said-guest (literal `null`), server-said-authenticated (object), and **no hint at all** (tag missing on auth pages / transit navigation / malformed JSON).
- The `useAuth()` pending branch (`auth.ts:256-295`) treats a `null` read as "still loading". So the **guest path — the exact case the slice headline promises in <100ms — never resolves early**. Only the authenticated fast-path works.

A second latent defect rides in the same lines: while `isPending`, a **stale** embedded session object is trusted unconditionally. After an in-page identity transition (email sign-in/out without reload, 401-driven cache clear), the tag still carries the previous identity until the next full page load.

## 2. Users

- Logged-out visitors on app routes (`/new`, `/profile`, subjects): gate dialog must appear on first paint, not seconds later.
- Signed-in users: first-paint authenticated state must keep working exactly as today (no regression, no flash of gate).
- Users mid-transition (just signed in/out, session just expired): must never see a destructive-looking gate flash over a valid session, nor a false authenticated flash after logout.

## 3. Goals

1. Guest on a tagged page resolves `useAuth() -> { status: "guest" }` during the `useSession` pending window, so `AuthGate` opens immediately. The redundant `/api/auth/get-session` fetch still runs and converges state; we just stop waiting on it for the initial decision.
2. Authenticated on a tagged page keeps resolving instantly (current behavior, preserved).
3. Stale embedded hints are never trusted after an in-page identity transition (epoch gating).
4. No-transcript-change safety: SSR still renders `loading`; first browser render pre-effect still renders `loading` (no hydration mismatch); the live `useSession()` remains authoritative after it resolves.
5. Slice-11 Step 3 (optimistic gate via `__PESDAC_NO_COOKIE__` / `<html>` class machinery) is explicitly **subsumed** by Goals 1-3 and MUST NOT be built.

## 4. Non-goals

- Slice-11 Step 2 (server-side profile pre-fetch) and Step 4 (pre-minted token): deferred per the slice's own optionality ("only if 1+2 aren't enough"). No `apiGetProfileServer`, no embedded token.
- No new auth methods, no session/cookie configuration change, no BetterAuth option change, no backend change (zero backend files touched).
- No Astryx upgrade, no Tailwind, no global CSS, no theme edit, no dialog/button restyle. The gate dialog is byte-identical; it only appears earlier.
- No `document.cookie` session sniffing (see §6 FR1 rationale).
- No service worker, no new client cache beyond the existing tag read.

## 5. User flows

### F1: Guest visits `/new` (the slice headline)

1. SSR renders shell in `loading` state + `<script id="pesdac:initial-session">null</script>`.
2. React hydrates (`loading`), effect commits, `useSession` pending.
3. Tag present + user null + epoch unchanged -> `guest` on the first post-effect render.
4. `AuthGate` dialog opens (~1 frame after interactive, down from 5-10s).
5. `/api/auth/get-session` resolves `null` later; state stays `guest`. No visible change.

### F2: Authenticated user loads `/new`

1. Tag carries the session object; pending branch returns `authenticated` instantly (unchanged from today).
2. `AuthGate` stays shut; onboarding/profile proceed as today.

### F3: In-page email sign-in (no reload, tag still says guest)

1. `signIn()` calls `clearAuthCache()` -> epoch bumps BEFORE the session changes.
2. Pending branch sees epoch mismatch -> `loading` (NOT transient guest; no gate flash).
3. `useSession` resolves -> `authenticated`.

### F4: Sign-out / 401 without immediate navigation

1. `apiLogout()` / 401 path clears cache -> epoch bumps; stale embedded user ignored -> `loading` (NOT false-authenticated flash, which today's code can paint).
2. `useSession` resolves `null` -> `guest` -> gate opens (or `/login` navigation wins the race, as today).

## 6. Functional requirements

### FR1: Tri-state initial-session read with epoch gating

- The tag read MUST distinguish **absent** (no server hint: missing tag, malformed JSON) from **present-guest** (literal `null`) from **present-user** (validated object with string `id` + `email`).
- The pending branch MUST consult `getAuthEpoch()` against the epoch latched at mount (`useState` lazy initializer, NOT a render-time ref write). Epoch mismatch (any in-page identity transition since mount) forces `loading` regardless of tag contents.
- Pure decision logic MUST live in an exported, dependency-free resolver (proposed: `resolveInitialAuth(tag, epochAtMount, currentEpoch) -> "authenticated" | "guest" | "loading"`) so node:test can cover the full matrix without React or a DOM.
- Rationale for epoch-over-cookie (record in code comment): BetterAuth session cookies are expected to be `httpOnly` (T1 confirms attributes); `document.cookie` therefore cannot gate staleness. The epoch is fully JS-observable, and its ONLY bump site is `clearAuthCache()`, whose confirmed callers are all identity transitions (sign-in/up, Google sign-in, logout, 401 handling, account deletion — T1 re-confirms the full caller list).

### FR2: `useAuth()` contract (pending branch only)

| Tag | Epoch | Result |
|---|---|---|
| present-user | unchanged | `authenticated` (as today) |
| present-guest | unchanged | `guest` (**new**: the fix) |
| absent | unchanged | `loading` (as today) |
| anything | changed | `loading` (**new**: staleness guard) |

- Post-pending behavior (`session?.user` -> authenticated, else guest) MUST NOT change.
- SSR (`typeof document === "undefined"`) and first pre-effect render MUST still return `loading`.
- `useSession()` stays mounted and authoritative for live updates (cross-tab sign-out, server-side invalidation). The tag is an initial hint only.

### FR3: No other behavior change

- `AuthGate.tsx`, `InitialSession.astro`, `middleware/auth.ts`, all `.astro` pages: NO changes expected. (`index.astro` is a redirect to `/new`; `/login` + `/signup` intentionally carry no tag and keep today's loading fallback.)
- `clearAuthCache()`, `bumpAuthEpoch()`, token minting, `apiGetMe`/`useProfile`, onboarding: untouched.
- If T1 finds any identity transition that does NOT bump the epoch, the fix MUST add the bump there (same one-line pattern) rather than weakening the resolver.

## 7. Acceptance criteria

- [ ] AC1: Guest `GET /new` HTML contains `<script id="pesdac:initial-session" type="application/json">null</script>` (curl-verified); hydrated guest resolves `guest` while `useSession` is still pending (unit-proven via the pure resolver + tag-reader tests).
- [ ] AC2: Authenticated `GET /new` still resolves `authenticated` instantly (no regression); post-pending convergence unchanged.
- [ ] AC3: Simulated in-page transition (epoch bump with stale tag, either direction) resolves `loading`, never a false guest/authenticated flash (unit tests).
- [ ] AC4: Absent/malformed tag resolves `loading` (unit tests); auth pages (`/login`, `/signup`) behave exactly as today.
- [ ] AC5: Real browser (user-assisted, no browser tooling in this environment): guest `/new` shows the gate within ~1 frame of interactive (down from 5-10s); authenticated `/new` shows no gate flash; in-page logout->relogin shows no stale-identity paint; console clean.
- [ ] AC6: `npm.cmd test` + `astro check` + `astro build` (frontend) and `git diff --check` pass; backend suite untouched and green (no backend changes).
- [ ] AC7: Astryx UI, theme, dialog size/behavior unchanged; no new dependencies; max five touched source files.

## 8. Constraints

- `AGENTS.md` is authoritative for UI: smallest possible change, real Astryx components only, preserve `PESDacMockupTheme` and `src/styles/global.css` foundation imports. (This change is logic-only; no JSX/CSS is expected to change.)
- Never log or render session contents beyond the existing tag subset (id/email/name/2FA flag); no tokens, cookies, or claims in logs or tests.
- Work on a feature branch (`fix/auth-gate-instant-guest`), never directly on main; do not commit or push unless the user explicitly asks (match existing prompt convention: report, don't push).
- Do not import React test renderers, jsdom, or happy-dom. Node's built-in `node:test` + a minimal `globalThis.document` stub (same style as the existing fake-window harness in `frontend/tests/link-password.test.ts`) is the test harness.

## 9. API / interface requirements

- No API change (frontend or backend). No envelope, no route, no status-code change.
- New/changed TS surface (names negotiable, semantics fixed):
  - `resolveInitialAuth(tag: { present: boolean; user: SessionUser | null }, epochAtMount: number, currentEpoch: number): "authenticated" | "guest" | "loading"`.
  - `readInitialSession()` internals may change to tri-state; it is module-private (only `useAuth` consumes it — T1 confirms).
  - `useAuth()` gains a mount-epoch latch; its return type `AuthState` is unchanged.

## 10. Data requirements

- No schema change, no migration, no new tables, no env-var change.

## 11. Security requirements

- The embedded tag subset stays exactly id/email/name/twoFactorEnabled (no new fields).
- Absent-tag and epoch-mismatch MUST fail closed to `loading` (wait for the live check), never to `guest` (which would open a login prompt over a possibly-valid session) — and a stale user MUST fail closed to `loading`, never to `authenticated`.
- BFCache restore can serve a stale tag with an unchanged epoch; accepted limitation (identical exposure exists today for the authenticated fast-path; the live `useSession` converges within one fetch). Document it in code, do not build BFCache invalidation.

## 12. Testing requirements

- New `frontend/tests/` file (proposed `initial-session.test.ts`): resolver truth table (all 6 cells of §6 FR2), tag-reader present/absent/malformed/guest/user cases via stubbed `document`, mount-epoch latch semantics (epoch bump between latch and resolve forces `loading`).
- Existing suites must stay green unmodified (proves no contract drift for `useAuth` consumers: gate, onboarding, profile, shell).
- Browser matrix (user-assisted): guest/authenticated/just-logged-out × `/new` × desktop/narrow; gate timing observed in DevTools (interactive -> dialog paint); clean console. Build alone is not acceptance for AC5.

## 13. Rollout / rollback

- Rollout: frontend-only. No flag, no migration, no env change. Verify with the AC1 curl probe after deploy (tag present on `/new`).
- Rollback: revert the feature branch; `useAuth` returns to pending-always-`loading`, i.e. today's behavior. No data cleanup (nothing is persisted).
