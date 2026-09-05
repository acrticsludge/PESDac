# Plan: auth surface v6 (Neon Auth) — spec `login-signup.md`

## Source of truth

`docs/reasonix/specs/login-signup.md` (v6, this slice). What changed from
v5: Neon Auth replaces our FastAPI auth. Backend verifies Neon JWTs
locally against `NEON_AUTH_JWKS_URL`; UI uses `@neondatabase/auth-ui`
(`<AuthView>`) inside Astryx-only chrome. §E is simplified to one
endpoint — `GET /auth/me` reads the verified JWT and returns the Neon
user; password change/set/sessions/google-callback are Neon-owned.

## Phase 0 — prereqs (ops, no code)

1. `backend/.env` rewritten with: `NEON_AUTH_BASE_URL` (already there),
   `NEON_AUTH_JWKS_URL` (derived from base, verified in env), our app
   `DATABASE_URL` (Neon Postgres), `JWT_SECRET` no longer required (drop),
   `FRONTEND_ORIGINS`, `COOKIE_SECURE`. Google is configured inside the
   Neon console (not in our env).
2. Verify the JWKS URL returns valid keys: `curl $NEON_AUTH_JWKS_URL`.
3. CORS: `FRONTEND_ORIGINS` lists the Astro dev/prod origin so our API
   accepts the browser-issued credentialed request.
4. `alembic upgrade head` on a clean branch (0001 only after rollback).

## Phase 1 — backend delta (Neon JWT verify + drop §E)

5. **Discard** `0002_auth_security` migration and the §E endpoints we
   shipped for v5 (password change/set, sessions list/revoke, OAuth
   start/callback, `_pretty_device_label`, `_exchange_google_code`,
   `_find_or_create_user`, `hasPassword`/`googleConnected` on `/me`).
   Pytest tests for those become obsolete and get deleted in the same
   commit. Keep the campus enum + onboarding_done additions to `Profile`
   and the corresponding profile schema fields.
6. **Add** Neon JWT verification:
   - `app/auth/neon.py` — JWKS fetch (cached, 1h TTL, keyset by `kid`),
     Ed25519 verify via `pyjwt[crypto]`, claim extraction (`sub`, `email`,
     `name`, `email_verified`, `exp`).
   - `app/deps.py` — new `get_current_user_from_neon` dependency that
     reads the JWT from `Authorization: Bearer <jwt>` (frontend sends it
     explicitly because the session cookie is on Neon's origin and not
     shared with our API). Returns our `User` row, auto-creating it on
     first authenticated call (link by `neon_user_id`).
   - `app/schemas/users.py` — add `User` + `NeonUserLink` tables:
     - `users.id uuid pk`, `neon_user_id text unique not null`,
       `email text`, `display_name text`, `created_at`, `updated_at`.
   - `0003_neon_auth_link` migration: `users` table for our identity +
     unique `neon_user_id` index.
7. **Update** routers:
   - `GET /auth/me` — verifies JWT, upserts our user row, returns
     `{user: {id, email, displayName}}`. No `hasPassword`/`googleConnected`
     flags (Neon owns the source of truth).
   - `GET /profiles/me`, `PATCH /profiles/me` — switch dependency to
     `get_current_user_from_neon`. Add `campus` and `onboardingDone`
     fields (already done in 0002 cleanup; preserved).
   - `POST /auth/logout` — just `204`. Frontend calls `authClient.signOut()`
     to clear the Neon cookie; we don't manage sessions.
8. Pytest contracts (with Neon JWT monkeypatched in conftest):
   - `GET /me` without bearer → 401
   - `GET /me` with valid Neon JWT → 200, returns our user, creates
     `users` + `NeonUserLink` row on first call
   - `GET /me` re-called with same JWT → same user, no duplicate row
   - `PATCH /profiles/me` with onboardingDone round-trips
   - `PATCH /profiles/me` rejects unknown campus (RR|EC|"")
   - CORS: preflight from `FRONTEND_ORIGINS[0]` passes
9. `pytest` green, `alembic upgrade head` + `downgrade 0002` clean.

## Phase 2 — frontend auth core (Neon Auth UI in Astryx chrome)

10. `npm install @neondatabase/neon-js @neondatabase/auth-ui` in
    `frontend/`.
11. `frontend/src/lib/neon-auth.ts` — singleton `authClient` from
    `createAuthClient(import.meta.env.PUBLIC_NEON_AUTH_URL)`; export
    `useNeonSession()` (small wrapper around the SDK's `useSession` for
    our `useAuth()` shape) and a `getAccessToken()` helper used by the
    API adapter.
12. `frontend/src/env.d.ts` — add `PUBLIC_NEON_AUTH_URL` and
    `PUBLIC_API_BASE_URL` typed envs.
13. `frontend/src/components/auth/AuthLayout.tsx` — `login-split` port
    using Astryx only (Card, Grid, VStack/HStack, Text, Icon, TextInput,
    Button, Link, Divider, Banner, EmptyState). Slots:
    - brand row: SparklesIcon + PESDac
    - left: `<AuthView pathname="sign-in" />` or `sign-up` (per page)
    - right: blank muted image panel (aria-hidden, full-height desktop /
      160px stacked strip; `COVER` slot stays blank — D5)
14. `frontend/src/pages/login.astro` and `pages/signup.astro` —
    standalone islands, never `AppLayout`. Wrap with `AuthLayout`,
    bounce logged-in users to `/new`.
15. `frontend/src/lib/auth.ts` — `useAuth()` backed by `useNeonSession()`.
    `apiFetch(path, init)` always injects `Authorization: Bearer ${token}`
    from `authClient.getSession()`. `apiLogout()` calls
    `authClient.signOut()` then refreshes auth state. No `apiChange` /
    `apiSet` / sessions helpers (Neon owns those).
16. `frontend/src/components/auth/AuthGate.tsx` — required-purpose
    `Dialog` driven by `useAuth()`:
    - never on `/login` or `/signup`
    - Esc/backdrop inert (required purpose + controlled-open ignores
      closes + Pesdac Esc yields)
    - content: brand row, "Log in to continue" + copy, primary
      "Create account" → `/signup`, secondary "Log in" → `/login`
    - 401/guest → opens; in-flight → shell as-is
    - gate is UX-only (enforced at the API), copy-adjacent comment
      says so, never user copy
17. `Pesdac.tsx` mount `<AuthGate />` above `<ProfileDialog />`; Esc
    yield while active.
18. Logged-in bounce: `/login` + `/signup` redirect to `/new` if a
    session is present (page-level effect using `useNeonSession`).
19. `tsc` + `astro build` (30 pages: 28 + login + signup) green.

## Phase 3 — profile, onboarding, identity (Neon-aware)

20. `frontend/src/lib/profile-options.ts` — single shared
    SEMESTERS/BRANCHES/CAMPUSES/SUBJECTS lists + validators. Sections +
    onboarding import it (no copies).
21. `frontend/src/components/auth/OnboardingDialog.tsx` — required
    Dialog over `/new`, opens when backend `GET /me` reports
    `onboardingDone == false`. Single screen: Campus SegmentedControl +
    Semester/Branch Selectors + Subjects CheckboxList with Select-all.
    Save `PATCH /profiles/me` with `onboardingDone: true` + payload.
    Failure → dialog stays open with Banner. Dismissal impossible
    (required triple lock). Onboarding creates a `profiles` row for the
    first authenticated user.
22. `frontend/src/components/profile/sections.tsx` — Campus Selector
    (replaces Institution TextInput per D7). Server export calls
    `GET /users/me/export` (still exists); delete-all calls
    `DELETE /chats` and clears the in-memory customs keys.
23. `frontend/src/components/profile/ProfileDialog.tsx` — Identity +
    Account sections: email + displayName (read from Neon), plus
    Campus + onboarding remainder. **No Login & security tab** (Neon
    Auth owns password change/2FA/passkeys/sessions UI). Danger zone:
    "Delete account" row stays in the Account section, calls
    `DELETE /users/me` (server-side deletes our profile + link row),
    then `authClient.deleteUser()` (or `signOut` + support banner if
    the SDK lacks `deleteUser`), then `navigate("/signup")`.
24. `Pesdac.tsx` Account row:
    - logged-out: "Login" → `/login`
    - logged-in: "My Profile" still navigates to the profile tab.
      Logout moves to the Account row: a small "Logout" item under
      "My Profile" (or as a sibling row — pick the one that fits the
      existing layout with the smallest diff). Logout →
      `apiLogout()` + auth refresh + `navigate("/login")`.
25. Welcome greeting: heading "What are you studying today, {name}?"
    when logged in (first name = displayName up to first space; falls
    back to the generic heading logged-out). Existing heading stays
    otherwise.
26. `tsc` + `astro build` (30 pages) green.

## Phase 4 — verify

27. Backend `pytest` green, `alembic upgrade/downgrade` on clean branch.
28. Frontend `tsc` 0, `astro build` 30 pages.
29. Manual matrix per spec Testing adapted to Neon Auth:
    - gate inertness/routing (Esc, backdrop, X, primary → `/signup`,
      secondary → `/login`)
    - signup via `<AuthView>` → onboarding (Campus + Semester + Branch +
      Subjects, all required) → save closes dialog → never again
    - login via `<AuthView>` returns to gate target
    - Google OAuth via Neon (configured in Neon console) round-trips
      and returns to `/new`
    - profile shows real email/displayName from Neon + campus/sem/branch
    - logout → cookie cleared → gate re-opens
    - 401 from API surfaces Banner with retry
    - 360px + keyboard-only passes
30. Done when the five Success Criteria in the spec hold.

## Boundaries

Ask-first: any new Astryx primitive beyond the verified set; sidebar
beyond Account row + Logout; backend beyond Phase 1; theme/global.css.
Never: custom modal/banner/form chrome; dead links/buttons; oracles;
credential logs; guest mode; our own email sending; our own 2FA /
passkeys / sessions UI; rewriting the existing component hierarchy to
fit auth; global guard removal.

## Plan vs spec — what this plan does NOT cover

The spec lists in §G a Login & security tab with password change/set,
sessions list, 2FA/passkeys, Danger zone. **All of those move to Neon
Auth** in v6 — we link to the Neon console for self-serve, and our
Danger zone keeps only "Delete account" (which deletes our `users` +
`profile` rows; the Neon user record is left for the user to remove via
Neon directly because we don't have an admin token). Fold-ins F1–F6
adjust accordingly.
