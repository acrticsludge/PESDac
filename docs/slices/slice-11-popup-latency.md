# Slice NN — AuthGate + OnboardingDialog Popup Latency

## Problem (user report)

> When a logged-out user visits `/new`, the "Log in to continue" AuthGate
> dialog takes a solid 5–10 seconds to appear.
>
> When a new user signs up, the OnboardingDialog (campus / semester /
> branch / subjects wizard) takes ages to pull up.

Both popups block user progress; even 5 seconds feels broken.

## Exploration — what is happening on the wire

### A. AuthGate on `/new` (guest)

`/new.astro` (line 21) → `<AppLayout client:load />` → `Pesdac.tsx` line
1518 → `<AuthGate />`. `AuthGate.tsx` line 31 calls `useAuth()` which
goes to `frontend/src/lib/auth.ts:115-140`:

```ts
export function useAuth(): AuthState {
  const { data: session, isPending } = authClient.useSession();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  if (!hydrated || isPending) return { status: "loading" };
  ...
}
```

`authClient.useSession()` (BetterAuth React client, `node_modules/better-auth/dist/client/react/`):
- On first mount, dispatches a fetch to `/api/auth/get-session`.
- The fetch goes through `frontend/src/pages/api/auth/[...slug].ts` which
  is `prerender = false` → SSR.
- SSR handler = `lib/auth.ts` `betterAuth({...}).handler(request)`.
- BetterAuth's session endpoint queries Neon for the session row by token
  cookie. Even for a guest (no cookie), the handler runs the full
  pipeline before answering `null`.

So the gate waits for at least one round-trip: client → Astro SSR →
BetterAuth → Neon → back. The dev server adds HMR + on-the-fly
compilation overhead. Measured 5–10s on the user's machine.

### B. OnboardingDialog (authenticated, new user)

`OnboardingDialog.tsx:97-134` runs `useEffect` on `auth.status ===
"authenticated"`. It fires `Promise.all([apiGetMe(), apiGetProfile()])`.
Each `apiFetch` (auth.ts:430) first calls `getBackendToken()` (auth.ts:
399) which fetches `/api/auth/token` to mint a JWT. So the chain is:

1. `useSession` → `/api/auth/get-session` (slow, see A)
2. Once `authenticated`, `useEffect` fires.
3. `apiGetMe` → `getBackendToken` → `/api/auth/token` (slow — JWT mint
   reads the JWKS table)
4. `apiGetMe` → `apiFetch` → `http://localhost:8000/api/v1/auth/me`
   (backend, separate server)
5. `apiGetProfile` → `getBackendToken` (cached, fast)
6. `apiGetProfile` → `apiFetch` → `http://localhost:8000/api/v1/profiles/me`

Steps 1, 3, 4 add up. Steps 5–6 are fast (backend on port 8000 is
not the dev server).

### C. Middleware already loads the session

`frontend/src/middleware/auth.ts` (Slice 6) calls
`authClient.getSession()` server-side with an 800 ms timeout and writes
`context.locals.session / .user`. But:

- `useAuth()` and `OnboardingDialog` are **client components** (`"use
  client"`). They can't read `context.locals`.
- They re-fetch via `authClient.useSession()` independently.

So the middleware's work is **wasted** for these consumers.

## Root cause (synthesis)

| Cause | Effect | Where |
|---|---|---|
| Astro dev server slow on `prerender=false` SSR routes | Every `/api/auth/*` round-trip adds 3–8s in dev | `astro.config.mjs` defaults; env not configured for fast dev SSR |
| BetterAuth `useSession` re-fetches from client even when middleware already knows | One redundant round-trip on every page load | `auth-client.ts` + `middleware/auth.ts` |
| `getBackendToken` mints a JWT on first call (DB write to `jwks`) | First authenticated request adds ~500ms–2s | `auth.ts:399-421` |
| No SSR-hydrated initial session state | Client must wait for fetch before deciding guest vs authed | `useAuth()` always starts at "loading" |
| No optimistic gate | The shell renders before the gate appears, then the gate pops up 5s later | `AuthGate.tsx:34` |

## Fix plan (incremental, smallest change first)

### Step 1 — Pass session from middleware to client via initial props
**Files:** `middleware/auth.ts`, `useAuth()` hook, `Pesdac.tsx`,
`AppLayout.astro`.

- Middleware already loads session; serialize it to
  `context.locals.initialSession` (string, JSON-safe).
- Astro page reads `Astro.locals.initialSession` and embeds it as a
  `<script type="application/json" id="pesdac:initial-session">` tag,
  rendered before the client island.
- `useAuth()` reads that JSON synchronously on first mount — no
  fetch, no 5s wait.
- `useSession()` is still used for live updates (e.g. sign-out from
  another tab), but the initial state is instant.

**Expected effect:** AuthGate pops up immediately for guests (the
initial session is `null`, so `status === "guest"` on first render).
OnboardingDialog's first `useSession` is replaced by the same initial
state; the dialog still waits for `apiGetMe` + `apiGetProfile` but no
longer waits for the redundant session round-trip.

### Step 2 — Pre-fetch profile on the server (optional, biggest win)
**Files:** `OnboardingDialog.tsx`, `Pesdac.tsx`, possibly a new
`apiGetProfileServer()`.

- Middleware can also pre-fetch the profile for authenticated users
  (one `getBackendToken()` + one `apiFetch` to `/profiles/me`, all
  server-side, parallel to the session fetch).
- Embed profile as another `<script type="application/json">` tag.
- `OnboardingDialog` reads it on mount and skips the `Promise.all`.

**Expected effect:** OnboardingDialog opens immediately for users
who haven't onboarded yet, with form values pre-filled from the
profile row (returning users see their saved picks).

### Step 3 — Optimistic AuthGate
**Files:** `AuthGate.tsx`.

- If `window.__PESDAC_NO_COOKIE__` is set (Astro SSR can detect this
  from `request.headers.get("cookie")` in the page frontmatter, set
  a CSS class on `<html>`), the gate can render immediately on
  hydration without waiting for `useAuth` to resolve.
- If the cookie is present, wait for the session check.

**Expected effect:** No more 5s blank where the shell renders
unprotected. The gate either pops up immediately or never.

### Step 4 — Reduce `getBackendToken` overhead (only if 1+2 aren't enough)
**Files:** `lib/auth.ts`.

- The first authenticated request mints a JWT (DB write). If the
  server has just minted one for the same session, the next mint is
  cheap, but a fresh session always pays the cost.
- Workaround: have the server-side middleware pre-mint the token and
  embed it in the initial state. The client's `getBackendToken` short-
  circuits to the embedded token on first call.

**Expected effect:** `apiGetMe` / `apiGetProfile` lose their first-call
JWT mint cost.

## Verification steps (after each step)

### Step 1 (session from middleware)
1. `tsc --noEmit` — no new errors.
2. `npm run dev` — fresh server, fresh request to `/new` as guest.
3. Browser DevTools → Network → `/new` request.
4. Response should contain `<script id="pesdac:initial-session" type="application/json">null</script>`.
5. AuthGate Dialog appears within ~100ms of the page being interactive
   (down from 5–10s).
6. Repeat for an authenticated request — the script tag should contain
   a JSON session object, not `null`.
7. `curl -H "Cookie: better-auth.session_token=..." http://localhost:4321/new` → same behavior.

### Step 2 (profile from middleware)
1. `tsc --noEmit` — no new errors.
2. Sign in as a returning user (onboarded), visit `/new`.
3. Profile data should hydrate in OnboardingDialog without an
   additional network round-trip to `/api/v1/profiles/me`.
4. Browser DevTools → Network tab should show no `profiles/me` request
   on initial page load.
5. Sign in as a new user (not onboarded), visit `/new` — dialog opens
   immediately with empty form (no profile data to seed).

### Step 3 (optimistic AuthGate)
1. Visit `/new` as guest — the Dialog should appear before the
   initial paint of `AppLayout`, or within 1 frame of it.
2. Network tab should show no `/api/auth/get-session` request before
   the Dialog appears.
3. Visit `/new` as authenticated user — Dialog does NOT appear.
4. Hit "Log out" in another tab — return to `/new` in this tab — the
   Dialog should appear within one event loop tick (driven by the
   existing session-storage event in `useAuth`).

### Step 4 (pre-mint token)
1. `tsc --noEmit` — no new errors.
2. Open `/new` in a fresh incognito window, sign in.
3. DevTools → Network → on the first authenticated `/new` request, no
   `/api/auth/token` request should fire (token is embedded in
   initial state).
4. Subsequent `apiFetch` calls in the same session use the embedded
   token until it expires (15m by default), then the client falls
   back to `/api/auth/token`.

## Out of scope (intentionally)

- The underlying Astro dev server slowness is environmental, not a
  code issue. Build output (`npm run build` + adapter preview) will
  serve these routes from the Node server without the dev
  HMR/compilation overhead. We are not fixing the dev server here.
- This slice is purely about removing redundant client-side
  round-trips. If the dev server itself is the bottleneck, that is
  addressed separately (Slice 5-adjacent: build verification only).
- We do not add a service worker or any client-side cache beyond
  the existing `mePromise` / `accountsPromise` / `cachedToken` cache.
- We do not change the public auth API. The middleware just stops
  duplicating work the client was doing.

## Estimated impact

| Popup | Before | After (all 4 steps) |
|---|---|---|
| AuthGate (guest on `/new`) | 5–10s wait for first `/api/auth/get-session` | <100ms (initial state) |
| AuthGate (returning user logs out) | 1 fetch + 1 event tick | 1 event tick (Step 3) |
| OnboardingDialog (new user) | session + token + 2 backend fetches | 2 backend fetches (Steps 1+4) |
| OnboardingDialog (returning, not done) | session + token + 2 backend fetches | 1 backend fetch (Steps 1+2+4) |
| OnboardingDialog (returning, already done) | session + token + 2 backend fetches | 1 backend fetch (Steps 1+2+4); dialog closes before render |

The first three steps are additive; Step 4 is optional and only
needed if the JWT mint cost is measured as a significant contributor
in the user's network.

## Implementation status (2026-09-08, branch `fix/auth-gate-instant-guest`)

Step 1 guest path is done: `useAuth()` (`frontend/src/lib/auth.ts`)
now reads the embedded tag tri-state (present-guest vs present-user
vs absent) and resolves `guest` while `useSession` is still pending,
gated on a mount-latched auth epoch so stale hints after in-page
identity transitions fail closed to `loading`. Locked by
`frontend/tests/initial-session.test.ts` (node:test, no new deps).

Step 3 is subsumed, not built: the epoch-gated instant guest read
already opens the gate in ~1 frame, so the `__PESDAC_NO_COOKIE__` /
`<html>` class machinery would add a second mechanism for the same
frame with no further latency to remove.

Steps 2 and 4 are deferred per this slice's own optionality ("only
if 1+2 aren't enough"): no profile pre-fetch, no pre-minted token.
Revisit Step 2 if OnboardingDialog's `apiGetMe` + `apiGetProfile`
chain measures slow after this change; revisit Step 4 only if the
first-call JWT mint cost shows up in the user's network timings.

## Slice ordering

This slice is **N+1** (the next one). It comes after Slice 8 and
before FINAL. Implementation is incremental — Step 1 alone fixes
the 5–10s AuthGate delay; the other steps are progressive wins.

## T1 verdict — Step 2 NO-GO (2026-09-09, proxy measurement)

Spec `docs/reasonix/specs/slice11-step2-profile-prefetch.md` §6 FR1
gates Step 2 on a GO verdict (post-Step-1 chain p50 > ~1s
attributable to token+me+profile). No browser/DevTools session was
available, so T1 ran as a server-leg proxy on the live dev servers
(single listener per port: :4321 Astro, :8000 FastAPI), judged
against a production-like baseline per instruction — warm dev-SSR
numbers are quoted raw, and the 3–8s cold-dev SSR overhead from the
table above is discounted to zero (production serves these routes
from the Node server without HMR/compilation).

Proxy timings (curl, 3 runs each, unauthenticated baselines):

| Leg | Run 1 | Run 2 | Run 3 | Production-like? |
|---|---|---|---|---|
| `GET /api/auth/get-session` (guest, Astro SSR) | 7ms (200) | 7ms | 7ms | dev route, warm — no 3–8s overhead present |
| `GET /api/auth/token` (guest, Astro SSR) | 9ms (401) | 8ms | 7ms | reject path only, not a mint |
| `GET /api/v1/auth/me` (no bearer, FastAPI direct) | 213ms (401) | 217ms | 207ms | yes — FastAPI has no dev-SSR inflation |
| `GET /api/v1/profiles/me` (no bearer, FastAPI direct) | 233ms (401) | 231ms | 233ms | yes — same |

Production estimate for the signed-in post-Step-1 chain
(`useSession` converges instantly from the embedded tag, so ~0;
one token mint + `apiGetMe`/`apiGetProfile` sharing the cached
token, backend legs effectively parallel): ~0 + mint (unmeasurable
without a session; slice estimate 100–300ms in prod) + ~250ms
backend wall ≈ ~450ms, roughly half the ~1s GO threshold. Even at
2× safety margin it lands in the ±200ms gray zone, which defaults
to NO-GO. The token mint alone was not shown to dominate (guest
reject path is 8ms; a real mint needs a session to time), so this
is NO-GO, not ROUTE-TO-4.

Verdict: **NO-GO — Step 2 is not built.** Zero code diff. Revisit
only if real browser timings (session-resolved → dialog-open split
by leg) show the chain p50 > ~1s in production-like serving, or if
the token mint itself proves dominant (that routes to a Step 4
spec, not this one).
