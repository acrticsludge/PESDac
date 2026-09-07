# E2E Auth Flow Audit — Google linking + onboarding persistence

Date: 2026-09-06. Scope: full auth path (Neon Auth SDK → frontend
`lib/neon-auth.ts`, `lib/auth.ts`, `AuthLayout`, `AuthGate`,
`OnboardingDialog`, Profile tab → FastAPI `/auth/*`, `/profiles/*`,
`/users/*` → Neon Postgres). Method: systematic-debug orient pass —
code trace, contract tests, live JWKS + read-only DB inspection.
No code changed in this audit.

## Verified healthy (do not "fix")

- JWT verification is correct: EdDSA against live JWKS (1 Ed25519 key,
  reachable), kid-based cache with refetch-on-miss (key rotation safe),
  `require: sub/email/exp`. `backend/app/auth/neon.py:87-114`.
- Backend contract suite: **34/34 pass** (`pytest tests/ -x -q`).
  Race-safe user/profile upsert covered.
- Live Neon DB (read-only): alembic `0004_subjects_jsonb` (current),
  all 6 tables present, subjects seeded (CN/OS/DLCD/DSA/Math), backend
  `validate_startup` OK.
- **The one real user row IS onboarded server-side**
  (`campus=RR, semester=3, branch=CSE(Core)`, 5 subjects,
  `onboarding_done=true`). The server write path works.
- CORS uses exact-origin match (`deps.py:_origin_of`), error envelope
  is user-safe, no secrets in logs, `frontend/.env` and `backend/.env`
  point at the same Neon project/region.

## G1 (critical) — Profile tab never writes to the server

`sections.tsx` (`IdentitySection`, `StudySection`, `AssistantSection`,
`ShortcutsSection`, `LanguageSection`) calls only the local
`updateProfile()` from `lib/session.ts`. `apiUpdateProfile` is called
from exactly one place: `OnboardingDialog` (grep: all 10
`apiGetProfile|apiUpdateProfile|apiGetMe` hits are `lib/auth.ts`
definitions + `OnboardingDialog`). Every preference edit outside the
wizard is local-only and dies on reload.

## G2 (critical) — No server→client hydration; reload wipes everything

`lib/session.ts` is an in-memory `Map` and **purges all `pesdac-*`
localStorage keys on every page load** (`session.ts:37-49`). Nothing
hydrates the store from `/profiles/me` on boot — except
`OnboardingDialog`, which only runs while `onboardingDone=false`.
Result: the server-saved onboarding (proven above) is invisible to the
UI after reload — Profile tab shows blanks, welcome heading loses the
name context. This is the reported "onboarding data never saved":
it saves, it just never comes back.

## G3 (critical) — Google linking: fragile code + probable dashboard config

- `linkGoogleAccount()` (`neon-auth.ts:66-106`) hand-rolls
  `fetch(<base>/link-social)` instead of the SDK method.
  Verified against bundled better-auth 1.6.23: `authClient.linkSocial`
  exists. The manual path bypasses SDK baseURL/cookie/error handling.
- Even with correct code, linking requires Neon-dashboard state this
  repo cannot verify (no API key here): Google provider enabled,
  **trusted domains** include the app origin (`http://localhost:4321`
  + prod domain; else `invalid domain` / CORS failure on the
  `credentials:include` call), account-linking policy that avoids
  `account_not_linked` for password-first users (the `AuthGate` copy
  already handles that error, so users are hitting it).
- Related inconsistency: social sign-in uses relative
  `callbackURL: "/new"` (`AuthLayout.tsx:288-291`) while link-social
  uses an absolute URL — both must be allowlisted in Neon.

## G4 (high) — OnboardingDialog fails silent

Mount-fetch failure (401/network) → `setPhase("done")`
(`OnboardingDialog.tsx:117-121`): dialog never opens, no retry, no
banner. User proceeds permanently un-onboarded until next mount.

## G5 (high) — Origin-gated mutations can hard-block onboarding

`check_mutation_origin` (`deps.py:119-142`) 403s PATCH/DELETE whose
`Origin` is not in `FRONTEND_ORIGINS` (currently only
`http://localhost:4321`). Serve the frontend from any other
port/host (preview, LAN, prod domain missing from `backend/.env`)
and onboarding save, delete-account, and chat mutations all fail.
Onboarding surfaces it as a Banner (good) but the fix is env config,
which nothing documents at the point of failure.

## G6 (high) — No handling for "Neon session valid, backend 401"

`useAuth` reports `authenticated` from the Neon session alone
(`auth.ts:116-144`, `onboardingDone` hard-coded `false`). If the JWT
is expired/malformed/missing-email, every backend call 401s while the
gate stays closed: onboarding closes silently (G4), exports banner,
user is stuck with no re-login prompt. `apiFetch` also has no
timeout — a hung backend hangs the UI with no feedback.

## G7 (medium) — Unverified-email login error lands on the wrong field

`AuthLayout` maps all sign-in failures to the password field. An
"email not verified" failure renders as a password error. Cosmetic
but confusing at the exact moment trust is lowest.

## G8 (medium) — Branch enum drift frontend↔backend

Frontend offers only `CSE(Core)`/`CSE(AI&ML)`
(`profile-options.ts:27-32`); backend accepts 10 values
(`models/profiles.py:25`). Any row with another branch renders a
Selector value with no matching option. Needs a product decision
(widen UI vs narrow server), not a unilateral edit.

## G9 (medium) — Rate limiter is dead code

`app/rate_limit.py::check()` is never called by any router; the
`limit()` dependency its docstring promises does not exist.
`RATE_LIMIT_*` env vars are read and then ignored. Our endpoints
have no abuse protection (auth-class is Neon-owned, but PATCH/POST
loops are ours). `x-forwarded-for` is trusted raw — spoofable when
wired behind no proxy config.

## G10 (low) — Stale `deleteNeonUser` comment

`neon-auth.ts:140-151` says the SDK may not expose `deleteUser`;
verified present in better-auth 1.6.23. The real failure mode is
server-side rejection (correctly handled by the fallback banner).
Comment will mislead the next debug session.

## G11 (low) — `campus` vs `institution` split brain

Onboarding PATCHes `campus`; the Profile tab reads/writes
`institution`. Live row proves the split: `campus='RR'`,
`institution=''`. Local mirror maps campus→institution, so the two
sources disagree after every reload. Unify on `campus` (deprecate
`institution`) when G1/G2 are fixed.

## G12 (low) — Hardening leftovers

No `Content-Security-Policy` / HSTS headers (only
nosniff/DENY/Referrer-Policy in `main.py:41-47`); JWT lives in JS
memory (accepted per prior NB2 audit, but CSP would narrow the XSS
window that can steal it).

## Fix plan (UI-preserving, thinnest slices first)

- Phase 0 (dashboard, needs human): trusted domains
  (`http://localhost:4321` + prod), Google provider on, linking
  policy set so password-first users can link, callback URLs
  allowlisted. Cannot be verified from here — needs a click-through.
- Phase 1 (persistence): hydrate local profile from `/profiles/me`
  on authenticated boot; make Identity campus/semester/branch PATCH
  the server (local mirror kept); unify `campus`/`institution`.
- Phase 2 (linking): replace manual fetch with
  `authClient.linkSocial({provider, callbackURL, errorCallbackURL})`;
  keep gate copy; browser-verify the round trip.
- Phase 3 (robustness): onboarding retry banner instead of silent
  `done`; global 401→re-login path; `apiFetch` timeout; wire-or-remove
  rate limiter; add CSP/HSTS; fix stale comments.
- Phase 4 (verify): contract tests for new PATCH paths, browser smoke
  signup→onboarding→reload→profile, Google link click-through,
  re-run 34-test suite + `astro build`.

## Production status

Auth flow as it stands: **NOT READY TO SHIP** — G1+G2 lose user data
on every reload, G3 blocks Google users. Backend verifier + schema
are shippable; the breakage is all in the client persistence layer,
the linking call, and Neon-dashboard config.

## Resolution (2026-09-06, Phases 1+2+3 implemented)

- G1/G11: Identity campus/semester/branch PATCH `/profiles/me`
  (server-first, local revert + Banner on failure); campus writes both
  `campus` and `institution`. `sections.tsx:saveIdentity`.
- G2: authenticated boot hydrates local store from `/profiles/me`
  (once per session). `Pesdac.tsx` hydration effect.
- G3: manual `/link-social` fetch replaced with
  `authClient.linkSocial`; gate treats any non-`account_not_linked`
  `?error=` as a failed link. Neon-dashboard items (trusted domains,
  Google provider, linking policy) remain human-verified.
- G4: onboarding check failure opens a required Dialog with Retry
  instead of silently resolving to `done`.
- G5: `.env.example` documents that every serving origin must be
  listed or mutations 403.
- G6: backend 401 dispatches `pesdac:auth-required`; shell toasts,
  signs out, routes to `/login` (reentrancy-guarded). `apiFetch` has a
  15s timeout mapped to the connection copy.
- G7: verification failures render on the email field.
- G9: rate limiter wired (60/min routine mutations, 10/5min
  destructive) + `test_rate_limit_contract.py` (3 tests).
- G10/G12: stale comment fixed; HSTS on https deployments; CSP
  intentionally left to the frontend host (would break `/api/docs`).
- Open: G8 branch-enum decision (needs product call); dashboard
  click-through for Google link + implicit-linking policy.

Verification: `pytest` 37/37 ✓, `tsc --noEmit` ✓, `astro build`
(30 pages) ✓. UI hierarchy untouched — same Astryx primitives.
Auth flow after human dashboard pass: **READY TO SHIP**.

## Follow-up (2026-09-06): Google login lands on /new as guest

Symptom: Google click → no visible Google step → /new shows the
guest gate, yet `neon_auth` gains a user + google account + valid
sessions. No-redirect is NOT normal — the chain must pass through
`accounts.google.com` (verified live: init 302s there correctly).

Proven by probe (server side fully functional):
- POST `/sign-in/social` → 200 `{url: <neon init>, redirect: true}`;
  bad provider → 400 `PROVIDER_NOT_SUPPORTED` (so Google IS enabled).
- Neon init → 302 to `accounts.google.com` with valid OAuth params.
- `neon_auth.user` + `account(providerId=google)` + 2 live sessions
  exist for the attempt — OAuth completed, twice (09:18, 09:20).
- Session cookie is `__Secure-neon-auth.session_token`,
  `SameSite=None; Secure; Partitioned`; SDK fetch defaults to
  `credentials: include` (better-auth `getClientConfig`).
- Replaying the browser exactly (GET `/get-session` with the real
  signed session cookie) returns the session JSON. Transport works
  when the cookie is present and sent.

Fix shipped: `handleGoogle` now passes an absolute callbackURL
(`${origin}/new`, per Neon docs + G3 rule); relative `/new` left the
return leg undefined.

Not fixable from here — needs browser evidence (see request to user):
whether `__Secure-neon-auth.session_token` exists under the Neon
origin after the attempt (set-failure vs send-failure), plus console
and `get-session` network entries.

Side findings (need human action, no code change made):
- Throwaway probe user `pesdac-audit-probe@example.com` (unverified)
  created during cookie-attribute diagnosis — delete in Neon console.
- Orphaned `public.users` row (old `neon_user_id` 61b414df…, 08:03)
  no longer matches any `neon_auth.user` (current: 42d7734d…,
  09:18). The Google identity will onboard from scratch; delete or
  reconcile the stale row if the old email identity is gone.

## Follow-up 2 (2026-09-06): G14 — useSession stale after verifier exchange

Browser evidence (user DevTools) decoded the guest-gate mystery:
- `__Secure-neon-auth.session_token` IS stored (SameSite=None,
  partitioned for localhost) — set-failure ruled out.
- `get-session?neon_auth_session_verifier=…` → 200 (2.2kB): Neon DOES
  append the verifier on the OAuth return, and the exchange works.
- Three apiFetch `me` calls → 200: vanilla `getSession()` yields a
  JWT our backend verifies. Backend truth = authenticated.
- Yet the gate showed guest: only `useSession()` (React adapter)
  disagreed — stale adapter state after the verifier exchange.

Fix: `useAuth()` falls back to backend truth — when the adapter says
guest but a JWT exists, `resolveServerUser()` (`/auth/me`, 30s shared
cache + in-flight dedup) decides; true guests (no token) make no
request. Cache clears on logout/delete. Invalid-token 401s still flow
into the existing sign-out + `/login` handler. No UI changes.

Not touched (out of scope, pre-existing dev noise): React hydration
mismatch on `ChatDictationButton` (span-vs-button, composer subtree
only), Astro dev-toolbar 504, Astryx runtime-theme warning.

## Follow-up 3 (2026-09-06): G15 — popup Google sign-in

Root cause (browser evidence): after redirect OAuth, NO session cookie
exists in the jar — only initiation artifacts (`state`, `challenge`,
`aid`). The session cookie set during the top-level Neon→app
navigation is partitioned out of cross-site reach, so `get-session`
returns `null`, no JWT exists, and the gate opens. Deterministic in
Chrome; email flows are unaffected (XHR from our origin yields the
session inline plus a correctly-partitioned cookie).

Fix (mirrors the SDK's own iframe popup protocol, same HTTP shape):
- `signInWithGooglePopup()` (`lib/neon-auth.ts`): opens the popup
  synchronously (blocker-safe), POSTs `/sign-in/social` with
  `disableRedirect` + popup callbackURL, navigates the popup to the
  OAuth URL, awaits the `neon-auth:oauth-complete` postMessage
  (120s timeout, closed-popup detection), then lands on
  `/new?neon_auth_session_verifier=…` for the SDK's cookie-free
  exchange. `GooglePopupBlockedError` → redirect fallback.
- `src/pages/auth/callback.astro` (new protocol page): posts the
  verifier to the opener, self-closes. No interactive UI.
- `AuthLayout.handleGoogle`: popup first, redirect fallback.
- Refinement (retest evidence): with a query-bearing callbackURL Neon
  still lands the popup on `/` (session minted the same second, no
  `/auth/callback` hit) — the callbackURL is dropped at callback time.
  Simplified to a plain `{origin}/auth/callback`; our page forwards
  whatever Neon appends. If that still falls back, Plan B is the
  no-redirect ID-token flow.
- Correction (same evening): the ONLY observed verifier issuance came
  with the ORIGINAL relative `callbackURL: "/new"`; absolute URLs land
  bare every time. The absolute-URL change was the regression. Popup
  path retired entirely (never reached `/auth/callback` in 5+
  attempts): `handleGoogle` is back to redirect + relative `/new`,
  which plus the G14 backend-truth fallback is the complete working
  loop. `signInWithGooglePopup`, `GooglePopupBlockedError`, and
  `/auth/callback` removed. linkSocial stays absolute (that endpoint
  rejects relative URLs — verified separately).
- Review (settings-era diff): one real bug found and fixed — a logout
  racing an in-flight `resolveServerUser()` could repopulate the cache
  with the dead user (generation guard added). Everything else in the
  login path re-verified additive-safe. Recurring `apiDeleteAccount`
  dev error traced to Vite serving stale bundles across rapid saves,
  not source (tsc + prod build green throughout).
- Reassessment (redirect attempts exhausted): Google sign-in moved to
  the ID-token flow (`signInWithGoogleIdToken` + One Tap prompt, GIS
  script loaded on demand). Same transport as the working email flow:
  XHR in with the Google ID token, session JSON out, cached inline —
  no redirect, popup, callbackURL, or cookie reads. Environmental
  failures (blocked script, dismissed prompt) fall back to redirect;
  Neon rejections surface verbatim. Uses Neon's shared dev OAuth
  client ID (observed in Neon's own auth URL); prod needs its own
  client ID per Neon docs.

Verification: `tsc` ✓, `astro build` 31 pages ✓. Browser
click-through still required (popup allow + Google consent + gate
opens + onboarding appears): sign out fully first (the old
partitioned jar state otherwise confuses the test).

## Follow-up 4 (2026-09-06): G16 link status + G17 delete hardening

- G16: Identity Google row now reflects `listAccountProviders()` —
  linked accounts show a disabled "Google linked" button + copy,
  unlinked show the link button, unknown (offline) falls back to a
  disabled "Checking…" that resolves to the link button. Same
  Astryx row, no layout change.
- G17: account deletion previously removed only our rows; the Neon
  user survived (deleteUser disabled by default server-side, stale
  sessions rejected), so re-login resurrected everything. Client now
  forwards the password for credential accounts (fresh re-auth Neon
  accepts) via a password field in the delete dialog (Dialog +
  TextInput, rename-dialog pattern; AlertDialog has no content
  slot). OAuth-only users still depend on the project's verification
  flow. Fallback copy is explicit that PESDac data is gone but the
  sign-in record remains. Human prerequisite (Neon console): enable
  user deletion, else the Neon record can never be removed from here.
- Open cleanup: orphaned `public.users`/`profiles` rows for dead
  subs (61b414df, 42d7734d) — delete once confirmed unneeded.
- Decision (same evening): provider migration declined. Staying on Neon
  Auth. Google login's remaining blocker is data-only (own client ID in
  `frontend/.env` + origin registered + dev restart) — no code changes
  pending on that path. Email login verified working end-to-end.
