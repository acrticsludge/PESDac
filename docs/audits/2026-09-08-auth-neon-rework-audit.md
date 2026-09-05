# Audit: auth spec v5 → v6 (Neon Auth rework)

Date: 2026-09-08. Scope: re-check after the decision to use Neon Auth
instead of our own FastAPI auth. Source of truth: spec v6
(`docs/reasonix/specs/login-signup.md`) + plan v6
(`docs/reasonix/plans/login-auth-surface.md`).

## Verdict

Spec v6 + plan v6 are consistent and approvable. The §E backend delta
is reduced to one dependency (`get_current_user_from_neon`) + one
endpoint group (`/auth/me`, `/auth/logout`, `/profiles/me`).
Authentication is now Neon-owned; our backend is a stateless JWT
verifier + resource owner.

## A. Decisions that changed (and why)

| ID | Was (v5) | Now (v6) | Why |
|---|---|---|---|
| D2 | No emailing in our app | `<AuthView>` owns reset + verify-email | Neon Auth ships these; reimplementing would be wrong and `<AuthView>` already provides them |
| D11 | Google-only set-password in our profile | Not surfaced (Neon owns) | Same reason |
| §G | Login & security tab with 7 rows | Tab removed; one acknowledgement line in Account | Neon's UI does it better than we would; embedding a remote UI violates "Astryx-only chrome" |
| §E | 5 new endpoints + 0002 columns | 1 endpoint group + 0003 link table | Auth is no longer our surface |
| F5 | Sign-in methods card | Removed | Replaced by Neon |
| F11/D10/D9 | Sessions list + sign-out-other | In Neon | Replaced by Neon |

## B. Blockers fixed by v6

- **B1 (v5) — OAuth callback stub.** Gone: Google OAuth is configured
  in the Neon console, not our backend. The frontend `authClient` does
  the round-trip; backend just verifies the resulting JWT.
- **B2 (v5) — gate re-open on logout.** Still applies; the spec text
  in §A was updated for v6 to drive the gate from `useAuth()` (Neon
  session). Implementation note: `useNeonSession()` returns `{data,
  isPending}` — the gate reads `data == null` as "guest".
- **F1 (v5) — 30 pages.** Unchanged.

## C. New blockers / risks for v6

- **NB1 — JWKS reachability.** Backend's first request after deploy
  hits `NEON_AUTH_JWKS_URL`. If Neon is unreachable the API is
  effectively down. Mitigation: cache JWKS for 1h, log a warning on
  fetch failure, fall back to last-known cache; never silently accept
  an unverifiable token.
- **NB2 — Cross-origin session cookie.** Neon sets the cookie on its
  own origin (`*.neonauth.*`); our API never sees it. The frontend
  forwards the JWT in `Authorization: Bearer`. Any XSS in the app can
  read the JWT. Mitigation: standard CSP + no inline scripts; treat
  the JWT as a short-lived bearer token (Neon issues 1h tokens).
- **NB3 — Delete account is split.** Our `DELETE /users/me` deletes
  our `users` + `profiles` + `chats` rows; the Neon user record has
  to be removed via `authClient.deleteUser()` or the Neon console.
  Spec §I.F4 calls `authClient.signOut()` after — that's wrong,
  the user record would remain. Corrected in plan v6 step 24:
  call `authClient.deleteUser()` (or fall back to a sign-out +
  "To finish deletion, contact support" banner if the SDK lacks it).
- **NB4 — F4 wording.** Spec §I.F4 description says "removes identity,
  chats, preferences" — accurate for our side. Will update to "removes
  your PESDac identity, profile, chats" so it's clear the Neon
  account itself needs separate deletion.

## D. Factual checks (frontend)

- `@neondatabase/neon-js` exports `createAuthClient(url)` +
  `useSession()` (from `@neondatabase/neon-js/auth/react/adapters`)
  per the SDK ref + react quickstart. UI package
  `@neondatabase/auth-ui` exports `<AuthView pathname="sign-in" />`
  etc. Both packages are independent of the framework beyond the
  adapter import; Astro static hosting works because the SDK talks
  to the Neon REST API from the browser at runtime, no SSR.
- `<AuthView>` ships its own styles (`@neondatabase/auth-ui/css`).
  Per the AGENTS.md rule "do not add arbitrary global CSS", we import
  the stylesheet only inside `AuthLayout.tsx`, scoped to that page.
  No global CSS touch.

## E. Backend tests to remove

The v5 tests in `test_auth_security_contract.py` and
`test_oauth_exchange.py` exercise endpoints that no longer exist.
Cleanup commit deletes them. The 0002 migration is reverted; a new
0003 migration replaces it. Pytest for v6 covers: JWT verify (with
monkeypatched JWKS), `/me` upsert, profile onboarding + campus enum,
`DELETE /users/me` cascade.

## F. Boundaries held

Astryx-only chrome: confirmed (`<AuthView>` is an opaque block inside
our `AuthLayout`; the surrounding card, brand row, blank image
panel, and footer are all Astryx). No new CSS framework. No
replacement theme. No unrelated refactor of existing components.
