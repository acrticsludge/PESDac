# Spec: Auth surface v6 — Neon Auth (frontend) + JWT-verified backend

Status: Approved v6 — Neon Auth replaces our FastAPI auth. Astryx-only
chrome; `<AuthView>` lives inside our own layout. Backend verifies Neon
JWTs locally against `NEON_AUTH_JWKS_URL`. Implementation may proceed in
plan order.

Decisions already approved (2026-09-07 + 2026-09-08 Neon-Auth rework):
D1 Apple cut — Google + email only. D1a No reset pages or email flows
in our app; `<AuthView>` ships with forgot-password + verify-email and
we surface them as-is. D2 (relaxed) Emailing is Neon-owned; logged-out
recovery exists via Neon's reset UI. D3 Signup has password only
(handled by `<AuthView>`); our app adds no extra confirm field.
D4 Login-page legal footer line dropped entirely. D5 Side panel stays
blank (`COVER` slot). D6 Post-signup onboarding wizard (required,
Astryx-only): campus + semester + branch + subjects; name/email already
in Neon. D7 "Institution" becomes "Campus" with exactly 2 options
(RR, EC). D8 2FA/Passkeys are Neon-only; we don't render a Login &
security tab. D9 Active sessions live in Neon (we link to console if
needed). D10 Sign-out-other happens in Neon console. D11 Password
change/Set happens in Neon console. D12 Gate primary button is "Create
account". D13 Backend identifies the user by verifying the Neon JWT
locally against JWKS — no per-request HTTP call to Neon.

## Objective

Logged-out visitors are gated (non-closable modal → signup/login);
signup/login pages (login-split port) host `<AuthView>` from
`@neondatabase/auth-ui` so sign-in/sign-up/Google OAuth happen on
Neon Auth; first signup flows into a one-time onboarding wizard
(campus/semester/branch/subjects) then lands on `/new` with My Profile
prefilled; My Profile gains a Campus selector and Danger-zone
"Delete account"; password change, sessions, 2FA, passkeys all live
in Neon (we don't reimplement them).

Security bar: backend verifies Ed25519 JWT against Neon's JWKS, owns
authorization on `/chats`, `/profiles`, `/users`; no credential
handling in our code; no emailing; Astryx-only error chrome.

## Tech Stack

- Astro 6 static + React 19 + Astryx 0.5.2 + `PESDacMockupTheme`
  (dark, unchanged).
- `@neondatabase/neon-js` (auth client) + `@neondatabase/auth-ui`
  (`<AuthView>`) inside an Astryx `AuthLayout` (login-split port).
- Backend: FastAPI + SQLAlchemy2 + Neon Postgres; `pyjwt[crypto]` for
  Ed25519 verification of the Neon access_token.
- No new CSS framework. Astryx primitives only.

## Commands

```text
Typecheck: & "C:\Program Files\nodejs\npx.cmd" --yes -p typescript tsc --noEmit   (from frontend/)
Build:     & "C:\Program Files\nodejs\npm.cmd" run build                          (from frontend/, 30 pages: 28 + login + signup)
Dev:       & "C:\Program Files\nodejs\npm.cmd" run dev                            (Astro 4321 + backend 8000)
Backend:   python -m pytest -q                                                    (from backend/)
Migrate:   alembic upgrade head                                                   (from backend/, DATABASE_URL set)
```

## A. Auth gate (unchanged from v5)

`components/auth/AuthGate.tsx` above `ProfileDialog`, driven by Neon
session state via `useAuth()`: 401/guest → required-purpose Dialog opens;
in-flight → shell as-is; never on `/login`|`/signup`. Triple
non-closable (required purpose + controlled-open ignores closes +
Pesdac Esc yields while active). Content: brand row, "Log in to
continue" + "Create a PESDac account to study with your course
material. It takes a minute.", PRIMARY "Create account" (→ `/signup`,
D12) + secondary "Log in" (→ `/login`). No embedded form. Logout calls
`apiLogout()` + auth refresh + `navigate("/login")`. Gate is UX, not a
boundary — endpoints enforce ownership.

## B. Login / signup pages (v5 + Neon)

Standalone islands (`pages/login.astro`, `pages/signup.astro`), never
`AppLayout`. Brand row `SparklesIcon` + PESDac; blank muted image
panel (`aria-hidden`, full-height desktop / 160px stacked strip,
`COVER` slot). `AuthLayout` wraps `<AuthView pathname="sign-in" />` or
`pathname="sign-up" />` from `@neondatabase/auth-ui`. `<AuthView>` ships
Google OAuth + forgot-password + verify-email + email/password sign-up
+ sign-in — we surface all of them as-is. Footer swap-link only (login
↔ signup); legal agreement line REMOVED per D4. Logged-in loads bounce
to `/new`. `AuthView` errors render inline (Neon UI) — no extra Astryx
chrome.

The page-level Astryx shell is required: the existing Playwright
template ports only the outer chrome, the form is Neon.

## C. Neon session → our API

Neon's HTTP-only cookie lives on the `*.neonauth.*` origin and is not
shared with our API. The frontend SDK exposes the JWT in
`session.access_token`. `lib/auth.ts` `apiFetch(path, init)` always
injects `Authorization: Bearer <jwt>` (no tokens in URLs, no JS
cookies). `useAuth()` = `useNeonSession()` wrapper; logout calls
`authClient.signOut()` which clears the Neon cookie server-side too.

## D. Campus replaces Institution (D7)

`sections.tsx` Identity section: "Institution" `TextInput` → "Campus"
`Selector` (options `RR Campus`/`EC Campus`, values `RR`/`EC`,
`hasClear`, description "Your PES University campus."). `session.ts`
`Profile.institution` KEY UNCHANGED (no stored-data migration); values
constrained to `""|"RR"|"EC"` — loader maps any legacy free-text value
to `""` on read. Backend `profiles.campus` column (added in 0002);
Pydantic enforces the enum.

## E. Backend delta (only changes; everything else frozen)

- Discard all password / OAuth / sessions endpoints from v5
  (password/change, password/set, sessions list/revoke, google start,
  google callback, _pretty_device_label, _exchange_google_code,
  _find_or_create_user, hasPassword/googleConnected on /me).
- Discard 0002 columns that were only for v5: `users.password_changed_at`,
  `refresh_tokens.device_label/ip_address/user_agent/last_used_at`.
  **Keep** 0002 columns that the onboarding + profile flow still needs:
  `profiles.campus`, `profiles.onboarding_done`.
- New migration `0003_neon_auth_link`:
  - `users` (new table): `id uuid pk`, `neon_user_id text unique not
    null`, `email text`, `display_name text`, `created_at`,
    `updated_at`. Our `User` row is keyed by `neon_user_id` (Neon's
    `sub` claim). Renamed from "v5 users" — the v5 users table is
    removed in downgrade; the 0003 migration creates the new one.
  - **No** `password_*`, `oauth_*`, `refresh_token*`, `password_reset_*`
    tables. Sessions live in Neon; passwords live in Neon.
- Endpoints (`/api/v1/*`, existing envelope/conventions):
  - `GET /auth/me` — verify JWT, upsert our `users` row by
    `neon_user_id`, return `{user: {id, email, displayName, onboardingDone}}`.
    401 with envelope on missing/invalid/expired token.
  - `GET /profiles/me` + `PATCH /profiles/me` — switch dependency to
    `get_current_user_from_neon`. Pydantic accepts `campus`,
    `onboardingDone`, the same field set as v5 minus the email/displayName
    sync (those are Neon-owned).
  - `POST /auth/logout` — `204`. Frontend calls `authClient.signOut()`;
    we don't manage sessions, but a logout call lets the frontend
    confirm.
  - All `/chats`, `/demo_state`, `/users/me/export`, `/users/me`
    endpoints switch to the same Neon-JWT dependency.
- JWT verify: `app/auth/neon.py` fetches `NEON_AUTH_JWKS_URL` (cached,
  1h TTL by `kid`) and verifies Ed25519. Required claims:
  `sub`, `email`, `exp`. The `neon_user_id` is `claims['sub']`. Email
  is taken from `claims['email']` (we trust the verified JWT, not the
  user's own profile row).
- CORS: `FRONTEND_ORIGINS` must include the browser origin so the
  `Authorization: Bearer` request isn't blocked.
- Rate classes: only `/auth/logout` and the existing chat/profile
  classes remain; auth-class rate limiting is Neon-owned.

## F. Onboarding wizard (D6 + subjects step)

`components/auth/OnboardingDialog.tsx`, required-purpose Dialog over
`/new`, opens when `GET /auth/me` reports `onboardingDone == false`
(signup AND returning logins until completed — survives reload, no URL
param). Single screen: heading "Set up your profile", supporting copy
"Three quick picks so PESDac scopes answers to your course.", Campus
`SegmentedControl` (RR Campus / EC Campus — exactly 2), Semester
`Selector` (1–8), Branch `Selector` (7 options), Subjects
`CheckboxList` (5 subject codes + "Select all"), primary "Start
studying" (disabled until campus+semester+branch+≥1 subject; `isLoading`
on save → `PATCH /profiles/me` + `onboardingDone: true` → close).
Dismissal impossible (same triple lock as §A — required details). On
success, `apiGetProfile()` is re-called and the local store is updated
explicitly (reads are local-only, fetch-without-seed would leave the
dialog blank). Reuses the exact option lists/validators as the Profile
tab through one shared `lib/profile-options.ts` (no copies).

## G. Login & security tab — REMOVED in v6

The Login & security tab is removed. Password change/set, active
sessions, 2FA, passkeys, and "Set password" all live in Neon Auth. We
do not link to the Neon console from our app (we'd be embedding a
remote UI inside our app, which violates "Astryx-only chrome" for the
profile surface). If the user wants to manage their account they can
visit their provider's flow naturally (password reset emails etc.).

A small text row at the bottom of My Profile → Account section: "Sign
in and account management are handled by our auth provider." This is
the only acknowledgement of the split.

## I. Fold-ins (updated for v6)

F1 Real identity touches: welcome heading becomes "What are you
studying today, {name}?" when logged in (first name = displayName up to
first space; falls back to the generic heading logged-out); sidebar
Account section shows the real email + display name when logged in
(avatar initials already name-driven — now real); Login row only when
logged out. Logout row appears under "My Profile" in the Account
section when logged in.
F2 Server export: Privacy "Export my data" uses `GET /users/me/export`
when logged in, existing local `dumpStore()` when logged out.
F3 Server delete-all: "Delete all chats" calls `DELETE /chats` AND
wipes the in-memory customs keys when logged in (overlays still live
in memory until the messages slice — both stores must clear or ghosts
remain); local-only path unchanged logged-out. Keeps the existing
confirm dialog.
F4 Delete account: "Danger zone" card at the bottom of Account — "Delete
account" row (description: removes your PESDac identity, profile,
chats) → `AlertDialog` ("Delete your account?", "Everything you did on
PESDac is permanently erased. This cannot be undone.", action "Delete")
→ `DELETE /users/me` (deletes our `users` + `profiles` + `chats` rows)
→ `authClient.deleteUser()` (removes the Neon user record; falls back
to `authClient.signOut()` + a "Contact support to finish deletion"
banner if the SDK does not expose `deleteUser`) → `navigate("/signup")`
(gate re-opens on next check).
F5 Sign-in methods card — REMOVED. The card in §G is gone; the Account
section's "Sign in is handled by our auth provider" line is the only
acknowledgement.
F6 Onboarding subjects step: fourth question "Which subjects do you
plan to study mainly?" — `CheckboxList` with the 5 subject codes + a
"Select all" item (toggling all selects/clears the rest); ≥1 required
before "Start studying" enables; saved to `profile.subjects`.

## Project Structure

```text
frontend/src/pages/login.astro | signup.astro                   (Neon AuthView host)
frontend/src/components/auth/AuthLayout.tsx                    (login-split Astryx port)
frontend/src/components/auth/AuthGate.tsx                      (required gate)
frontend/src/components/auth/OnboardingDialog.tsx              (required wizard)
frontend/src/components/profile/sections.tsx                   (Campus selector, server paths)
frontend/src/components/profile/ProfileDialog.tsx              (Account section; no Security tab)
frontend/src/lib/auth.ts                                       (apiFetch + useAuth, Neon-backed)
frontend/src/lib/neon-auth.ts                                  (authClient singleton, useNeonSession)
frontend/src/lib/profile-options.ts                            (shared lists)
frontend/src/env.d.ts                                          (PUBLIC_NEON_AUTH_URL, PUBLIC_API_BASE_URL)
backend/alembic/versions/0003_neon_auth_link.py                 (users keyed by neon_user_id)
backend/app/auth/neon.py                                       (JWKS cache + Ed25519 verify)
backend/app/deps.py                                            (get_current_user_from_neon)
backend/app/schemas/users.py                                   (User, neon link)
backend/app/routers/auth.py                                    (just /me + /logout)
```

## Testing (no runner — manual matrix + backend pytest)

`tsc` + 30-page `build` + backend `pytest` green (Neon JWT verify with
monkeypatched JWKS, /me upsert, profile onboarding + campus enum,
DELETE /users/me cascade) + `alembic upgrade/downgrade` on clean
branch. Manual: gate on logged-out `/new` (Esc/backdrop/X inert, both
buttons route, login → closes); signup via `<AuthView>` →
onboarding (cannot dismiss, all-four-required, save → closes, never
again); profile shows real email/displayName/campus/sem/branch;
Campus rejects legacy text (→ blank); logout → cookie cleared → gate
re-opens; 401 from API → Banner with retry; 360px + keyboard-only
passes; Google OAuth via Neon round-trips to `/new`.

## Boundaries

Ask-first: new Astryx primitives beyond the verified set; sidebar
beyond Account row + Logout; backend beyond §E; theme/global.css.
Never: custom modal/banner/form chrome; dead links/buttons; oracles;
credential logs; guest mode; our own password/2FA/passkeys/sessions
UI; emailing of any kind from our app; global guard removal.

## §H Known limitations (accepted)

L1 Logged-out users who forget passwords recover via Neon's
`<AuthView>` reset UI (sends email from Neon). L2 Our app has no
reset endpoints; the v5 `request`/`confirm` route files are deleted.
L3 Pre-migration `institution` free text maps to blank on read.
L4 Session store is memory-only (no legacy import): reload wipes
chats, drafts, and unsynced profile edits. Stale `pesdac-*` browser
keys from earlier builds are purged automatically at boot.
L5 Password change, 2FA, passkeys, active sessions management all
happen in Neon Auth; we don't surface them.

## Non-goals

Custom password UI, 2FA, passkeys, active-sessions UI, sign-out-other
from our app, logged-out recovery flows we own, email verification we
own, Apple, avatar upload, remember-me, password toggle, Playwright.

## Success Criteria

1. Gate blocks all non-auth routes, undismissable, correct routing.
2. `<AuthView>` round-trips signup/login/Google → `/new` with profile
   complete (email/displayName/campus/sem/branch/subjects).
3. Onboarding required, all four fields, save closes, never again.
4. Logout clears Neon cookie; `DELETE /users/me` cascades; gate
   re-opens on next check.
5. `tsc` 0, 30-page build, backend pytest + migrate/downgrade green.
