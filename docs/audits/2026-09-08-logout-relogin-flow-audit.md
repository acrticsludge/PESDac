# Audit: logout flow + Google relogin flow (account-data error, gate flash, loader + skeleton gaps)

Date: 2026-09-08
Status: Proposed (source inspection; live browser timing not yet captured in this run)
Scope: logout sequencing in `Pesdac`/`auth.ts`, Google sign-in loader in `AuthLayout`, first-open profile hydration/skeleton after relogin.
Parallel context: runs alongside `fix/link-password-modal-toast` (see §7). This audit touches no link-password route logic.

## 1. Reported symptoms

Logout (authenticated, app route, click Logout):

1. Loader appears on the Logout row (`"Logging out…"`).
2. Once logout completes, an account-data error toast appears (user wording: "Failed to load account data" — closest installed copies are `"Couldn't load linked accounts."` in `frontend/src/lib/auth.ts:340` and `"Couldn't load your profile. Try again."` in `OnboardingDialog.tsx:130`).
3. Then the gate modal appears ("Log in to continue" — user wording "Log in to use PesDac", `frontend/src/components/auth/AuthGate.tsx:62`).
4. Only then does the redirect to `/login` happen.

Expected: loader -> direct redirect to `/login`, no error toast, no gate flash.

Relogin via Google:

5. Click Google login: spinner + "Redirecting to Google…" shows, then both disappear while the browser has still not navigated. Navigation does eventually happen, so the flow works — the loader just dies early.
6. After relogin, first open of My Profile shows no skeleton: campus/semester/branch render empty, then populate ~5s later when the API responds. Every later open shows the skeleton correctly. One-time-only on relogin.

## 2. Code paths traced

Logout:

- `Pesdac.tsx:596-620` `handleLogout()`: guard `isLoggingOut`, `setIsLoggingOut(true)`, `await apiLogout()`, info toast on `server-failed`, `navigate("/login")` on success. The `catch` path resets `isLoggingOut(false)`; the success path never resets it.
- `auth.ts:868-884` `apiLogout()`: `clearAuthCache()` FIRST (clears token/me/profile/accounts + `bumpAuthEpoch()` at `:737-743`), then `apiFetch POST /auth/logout`, then `authClient.signOut()`. Local cleanup is unconditional; backend/BetterAuth failures only shape the returned outcome.
- `auth.ts:558-585` `useProfile()`: guest -> `guest` state; `376-403` `useAccounts()`: same. Neither toasts on error; they set `error` state.
- `AuthGate.tsx:30-40`: renders the required-purpose dialog whenever `useAuth()` is `guest` on a non-`/login|/signup` path. There is no logout-intent suppression.
- `Pesdac.tsx:556-570` global `AUTH_REQUIRED_EVENT` handler: toasts session-expired + `apiLogout()` + navigate. Guarded by `authExpiredRef` (never reset).
- `AppToasts.tsx:26-40`: any unhandled promise rejection becomes a generic error toast plus `console.error`.

Google login:

- `AuthLayout.tsx:187-191,221-269` `handleGoogleSignIn()`: sets `isGoogleLoading(true)`, `await signInWithGoogle()` (`auth.ts:301-303` -> `authClient.signIn.social({provider:"google"})`), typed error mapping on catch, `finally { setIsGoogleLoading(false) }`. The comments at `:213-220` already admit the redirect usually navigates before the promise settles and the finally still runs.
- `AuthLayout.tsx:498-502`: spinner comes from `Button isLoading`, text `"Redirecting to Google…"` renders only while `isGoogleLoading`.
- `auth.ts:283-295`: email `signIn`/`signUp` call `clearAuthCache()` for user-A->B safety; **`signInWithGoogle` does not**.

Profile hydration after (re)login:

- `Pesdac.tsx:524-547` hydration effect: when `authState` becomes authenticated and `hydratedRef.current` is false, fetches `apiGetProfile(userId)` once and seeds the memory-only local store (`updateLocalProfile` institution/semester/branch/subjects). `hydratedRef` is a plain ref, never reset on logout, user switch, or epoch bump. The catch silently keeps the flag false for retry on remount only.
- `session.ts:391-456`: local profile is in-memory (`mem` map), seeded only by the above effect, onboarding save, or direct edits. Nothing clears it on logout.
- `sections.tsx:172-193,271-284` `IdentitySection`: skeleton shows only when `auth.status === "loading" || serverProfile.status === "loading"` (i.e. `/auth/me` pending). Campus/semester/branch selectors read the LOCAL store (`getProfile()` at `:176`, rendered `:367,391,415`), which has no loading state of its own.
- `OnboardingDialog.tsx:101-139`: on each authenticated identity, fetches `apiGetMe + apiGetProfile`; failure opens the `"Couldn't load your profile"` required dialog with retry (`:143-181`).
- `auth.ts:240-279` `useAuth()`: first browser render is `loading`; while BetterAuth `isPending`, falls back to the SSR-embedded `InitialSession` (`InitialSession.astro`), else `loading` (never `guest` during the check window).

## 3. Root-cause analysis

### 3.1 Logout: gate + error toast race the navigation (sequencing bug, not a server bug)

`handleLogout` navigates only AFTER `apiLogout()` fully resolves, but the UI-visible session flips to guest EARLIER:

1. `clearAuthCache()` bumps the epoch immediately, invalidating in-flight `apiGetMe`/`apiGetProfile`/`apiGetAccounts` promises (their `identity-changed` guards now throw).
2. `authClient.signOut()` resolves -> `useSession()` goes null -> `useAuth()` returns `guest` while still on the app route -> `AuthGate` opens immediately.
3. Any still-mounted consumer of the killed promises (`OnboardingDialog` check, `useAccounts`/`useProfile` error branches, unhandled rejections via `AppToasts`) surfaces the account-data error copy in the same window.
4. Only then does `navigate("/login")` run, dismissing the just-opened gate.

So the user sees loader -> error toast -> gate modal -> login page. All three middle artifacts are the app reacting truthfully to a guest session on an app route during an intentional logout transition. The fix is a logout-intent window: suppress the gate and account-data error surfaces from the moment logout starts until the navigation commits, and navigate without waiting for anything that can only produce noise (or navigate first and clean up behind it — decision for the plan, but the window concept is required either way).

Contributing defects:

- `isLoggingOut` is never reset on the success path (`Pesdac.tsx:596-620`). If `navigate("/login")` keeps the persisted island alive (`transition:persist="pesdac-shell"` in `new.astro:23`), the Logout row stays `"Logging out…"` disabled on return. Minor but real.
- `authExpiredRef` (Pesdac `:551`) is never reset either; a real expiry later in the same island lifetime is swallowed silently after the first one. Same class of one-shot-ref bug as `hydratedRef`.
- The exact toast copy needs live confirmation (two candidates above plus the generic unhandled-rejection toast). T1 must capture the literal string from the browser before choosing which catch to silence/suppress — never blanket-suppress error toasts.

### 3.2 Google loader dies before navigation (finally runs during redirect flight)

BetterAuth's redirect flow sets `window.location.href` but the awaiting promise does not settle synchronously; the `finally { setIsGoogleLoading(false) }` runs while the old document is still painted, removing the spinner and the `"Redirecting to Google…"` line just before the browser leaves. This is exactly what the user describes, and the prior full-stack audit already flagged the shape (`2026-09-07-pesdac-full-stack-readiness-audit.md:103`: `void` in try/catch + finally resetting early). The fix is to NOT clear the Google loading flag on the success/redirect path (clear only on caught error), so the loader persists across the redirect flight. Email auth keeps its current finally behavior (no redirect flight there; it navigates programmatically after settle).

### 3.3 First-open profile after relogin: local hydration skipped, skeleton watches the wrong signal

Two independent gaps combine:

1. `hydratedRef` is one-shot per island lifetime (`Pesdac.tsx:524`). After logout -> login (same island via `transition:persist`), it is still `true` from user A, so user B's `apiGetProfile` seed never runs. The local store keeps user-A values (or defaults) and the campus selectors render immediately with wrong/empty data. Nothing clears the local store on logout (`session.ts` has no reset used by `apiLogout`), so this is also a cross-identity leak, not just empty state.
2. Even with correct data flow, `IdentitySection` skeletons on `/auth/me` (`useProfile`), while campus/semester/branch come from the LOCAL store seeded by `/profiles/me` via the Pesdac effect. There is no loading state for the local seed, so first paint after relogin shows empty selectors, then fills ~5s later when the profile response lands and emits. Later opens show the skeleton because by then `useProfile` re-enters `loading` on each mount while the local store is already seeded — i.e. the skeleton the user sees later is the `/auth/me` one, which was simply never slow on the first open relative to the local seed.

Fix direction: key the hydration effect by identity (user id and/or auth epoch), not by island lifetime; clear/retag the local profile seed on logout and on identity change; and add an explicit pending state for the local profile seed so `IdentitySection` can skeleton the campus rows on first open (not just the `/auth/me` header). Preserve the offline behavior (keep local defaults, retry on remount).

### 3.4 Trailing issues in the same area

| # | Finding | Location | Effect |
|---|---|---|---|
| L1 | `signInWithGoogle` skips `clearAuthCache()` | `auth.ts:301-303` vs `:283-295` | User-A cached `/auth/me` + accounts promises can paint user-B's first screens (the T28 bug the email paths already guard). |
| L2 | Logout does not clear the local session profile | `auth.ts:868-884`, `session.ts:391-456` | Campus/semester/branch/subjects of user A survive into user B's session (privacy + correctness). |
| L3 | `isLoggingOut` one-shot, `authExpiredRef` one-shot | `Pesdac.tsx:551-570,596-620` | Stuck logout label; swallowed second expiry. |
| L4 | Gate has no transition awareness | `AuthGate.tsx:30-40` | Any guest window on app routes (logout flight, session revalidation) flashes the required modal. |
| L5 | Onboarding error dialog competes with gate | `OnboardingDialog.tsx:96-141,143-181` | A failed `apiGetMe/apiGetProfile` during logout/login flight can open `"Couldn't load your profile"` over/under the gate. |
| L6 | Email `signIn`/`signUp` clear caches but Google does not; `signOut` helper (`auth.ts:297-299`) also does not | `auth.ts:283-303` | Inconsistent identity-change hygiene across the three entry points. |

## 4. What this audit does NOT claim

- The literal account-data toast string was not captured live (two installed candidates + generic fallback). T1 must record it verbatim with a screenshot before silencing anything.
- Whether OAuth callback lands via full document load (fresh `InitialSession`) or client transition (persisted island, stale `readInitialSession` cache) was not traced live; the plan handles both but T1 must confirm which one the current Astro/BetterAuth versions produce.
- The ~5s profile latency was not profiled (network vs token-mint retry vs middleware 800ms timeout). T1 must capture the waterfall; do not "optimize" it blind.

## 5. Inputs used

`frontend/src/components/Pesdac.tsx` (logout, hydration, gate wiring), `frontend/src/lib/auth.ts` (`useAuth`, caches, `apiLogout`, social entry), `frontend/src/components/auth/AuthGate.tsx`, `frontend/src/components/auth/AuthLayout.tsx:180-269,440-502`, `frontend/src/components/auth/OnboardingDialog.tsx`, `frontend/src/components/profile/sections.tsx:172-193,271-284,340-426`, `frontend/src/lib/session.ts`, `frontend/src/components/layout/InitialSession.astro`, `frontend/src/middleware/auth.ts`, `frontend/src/pages/login.astro`, `new.astro`, `frontend/src/components/AppToasts.tsx`, `docs/audits/2026-09-07-pesdac-full-stack-readiness-audit.md:103`.
