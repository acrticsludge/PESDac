# Spec: logout + Google relogin flow fix

Status: Proposed
Audit basis: `docs/audits/2026-09-08-logout-relogin-flow-audit.md`
Sibling fix (parallel): `docs/reasonix/specs/link-password-modal-toast-fix.md` + `docs/reasonix/plans/link-password-modal-toast-fix-plan.md`
Stack: Astro + React 19 + Astryx 0.5.2 + StyleX + `PESDacMockupTheme` (per `AGENTS.md`).

## 1. Problem

Logout shows loader, then an account-data error toast, then the "Log in to continue" gate modal, and only then navigates to `/login`. Google relogin shows spinner + "Redirecting to Google…" but clears them before navigation commits. First My Profile open after relogin skips the skeleton: campus and related fields render empty, then fill ~5s later. Later opens skeleton correctly.

## 2. Users

- Signed-in users logging out from the sidebar Logout row.
- Returning users logging back in via Google on `/login`.
- Same-or-different identity relogin in the same browser/island lifetime (the persisted shell makes this the common case, not an edge).

## 3. Goals

1. Logout is one clean transition: loader -> `/login`, with no error toast and no gate-modal flash in between.
2. Google login loader + "Redirecting to Google…" persist until the browser actually leaves.
3. First profile open after any (re)login shows the same skeleton/loading treatment as later opens; campus/semester/branch never paint another identity's values and never flash empty-then-filled.
4. Identity hygiene: no user-A data (server caches or local profile seed) is readable in user-B's session.
5. No visual redesign; Astryx components, theme, copy tone preserved.

## 4. Non-goals

- No change to the link-password contract, toast-over-modal layering, or upstream error mapping — owned by the sibling fix. Shared helpers may gain additive branches only (see §9).
- No change to password policy, 2FA, account deletion, signup/email flows beyond the listed hygiene calls.
- No Astryx upgrade, no global CSS, no theme edit, no new UI library.
- No backend change in this fix (logout route stays a 204 no-op; all sequencing is frontend).
- No performance optimization of the ~5s profile latency beyond showing the correct pending state; measure it, don't chase it here.

## 5. User flows

### F1: Logout

1. Authenticated user on an app route clicks Logout.
2. Logout row shows `"Logging out…"` loading, disabled against re-entry.
3. App navigates to `/login`. No error toast appears. The gate modal never opens during the transition.
4. On `/login`, the row (if ever revisited without reload) is back to `"Logout"`, not stuck loading.
5. Local profile seed and server caches from the old identity are gone.

### F2: Google relogin

1. On `/login`, user clicks Google.
2. Button shows spinner, disabled; `"Redirecting to Google…"` appears underneath.
3. Both persist until the browser navigates away (Google, then back to the app). They are cleared only if the flow errors (typed inline form error, same as today).
4. After returning authenticated, no stale previous-identity data is visible.

### F3: First profile open after relogin

1. User opens My Profile (any tab) shortly after relogin.
2. While identity (`/auth/me`) OR local profile seed (`/profiles/me` -> local store) is pending, the dialog shows skeletons — including the campus/semester/branch rows — identical to later opens.
3. When data lands, rows render the current identity's values. Empty-then-filled flash does not occur.
4. Offline/backend-down keeps prior behavior for the seed (local defaults, silent retry on remount) but must still skeleton while the attempt is in flight.

## 6. Functional requirements

### FR1: Logout-intent window

- From logout click until navigation to `/login` commits, the app MUST suppress the guest-triggered surfaces on app routes: `AuthGate` dialog AND account-data error toasts/dialogs arising from epoch-invalidated in-flight fetches (`apiGetMe`, `apiGetProfile`, `listAccounts`, onboarding check).
- Genuine errors from the logout calls themselves still surface per existing contract (`server-failed` info toast; catch-path error toast).
- The window MUST be time-bounded and navigation-guaranteed: logout always ends on `/login` even if backend/BetterAuth calls fail or hang (reuse the existing best-effort semantics; add a timeout only if the current code can hang past the 15s `apiFetch` abort — verify, don't assume).

### FR2: Logout state hygiene

- `isLoggingOut` MUST reset after navigation commits (or be scoped so a persisted island never shows a stuck `"Logging out…"`).
- `authExpiredRef`-style one-shot refs touched by this flow MUST be reset when the flow completes so a later real expiry still fires.
- Logout MUST clear the local profile seed (or retag it to the.logged-out state) in addition to the existing `clearAuthCache()` server-cache clear.

### FR3: Google loader persistence

- `isGoogleLoading` MUST NOT clear on the success/redirect path. Clear it only in the error path (where the existing typed inline error renders).
- Email auth loader behavior is unchanged.
- `"Redirecting to Google…"` visibility follows `isGoogleLoading` as today (no copy change).

### FR4: Identity-scoped caches on every entry point

- `signInWithGoogle` (and the `signOut` helper if it is on any login path) MUST get the same `clearAuthCache()` identity hygiene the email `signIn`/`signUp` paths already have (T28 rule: every sign-in is a different identity).
- No new cache shape; reuse `clearAuthCache()`/`bumpAuthEpoch()` and the `TaggedCache` user-id guards.

### FR5: Identity-keyed profile hydration

- The server->local profile seed effect MUST be keyed by identity (authenticated user id and/or auth epoch), not by island lifetime. `hydratedRef`-style one-shot flags MUST reset on logout and on identity change so user B always reseeds.
- Seeding MUST write only the payload of the current identity (guard against the user-A promise resolving after user-B took over, mirroring the existing `identity-changed` pattern).

### FR6: Skeleton covers the local seed

- `IdentitySection` (and any consumer of the local profile seed) MUST distinguish seed-pending from seed-ready. While pending, campus/semester/branch rows render the existing `SkeletonCard`/`SkeletonIdentityHeader` treatment, not empty selectors.
- Ready-with-empty stays a valid state (new user, blank campus renders `Select` placeholder) and MUST be visually distinct from pending (skeleton) — no behavior change for genuinely empty values.

## 7. Acceptance criteria

- [ ] AC1: Logout from an app route with devtools open shows zero error toasts, zero gate-modal frames (record a frame/step log, not just the end state), then lands on `/login`. Forced backend-logout failure still shows the honest `server-failed` info toast and still lands on `/login`.
- [ ] AC2: Logout row never sticks on `"Logging out…"` after navigation; a second real session expiry later in the same island lifetime still fires the expired flow once.
- [ ] AC3: Google login click keeps spinner + `"Redirecting to Google…"` until navigation; cancelled/failed Google flow clears the loader and shows the existing typed inline error.
- [ ] AC4: Relogin as a different identity (or same identity after logout) then immediately opening My Profile shows skeletons for identity + campus rows, then the current identity's values. No previous-identity values ever paint; no empty-then-filled flash. Repeat open also skeletons while refetching.
- [ ] AC5: Offline/backend-down relogin keeps local defaults without crashing; pending skeleton shows during the attempt; retry happens on remount.
- [ ] AC6: Astryx UI unchanged (no theme/CSS/version change); all strings keep existing tone; no new global styles.
- [ ] AC7: Frontend tests + `astro check` + `build` + `git diff --check` pass; new regression tests cover the logout window, Google loader persistence, identity-keyed hydration, and cross-identity leak.

## 8. Constraints

- `AGENTS.md` authoritative for UI: smallest change, real Astryx components, preserve `PESDacMockupTheme`.
- Auth is high-risk per `CLAUDE.md`: use `security-and-hardening` (no session leak across identities), `test-driven-development`, `debugging-and-error-recovery` (reproduce timing first), `frontend-ui-engineering` + `browser-testing-with-devtools` (frame-level verification, not build-only).
- Never log secrets/tokens; never suppress ALL error toasts to fix the logout flash — suppress only the epoch-invalidated transition noise inside the logout window.
- Feature branch, never main; no commits/pushes unless explicitly asked.

## 9. Parallel-execution contract (binding on both fixes)

Sibling: link-password fix (`fix/link-password-modal-toast`, spec `link-password-modal-toast-fix.md`, plan `link-password-modal-toast-fix-plan.md`).

- This fix MUST NOT edit: `backend/**` (any file), `frontend/src/components/AppToasts.tsx`, link-password form/handlers in `sections.tsx` (`handleLinkPassword`, link form state/copy), `toUserMessage` 404/5xx branches.
- Sibling MUST NOT edit: `handleLogout`/`isLoggingOut`/`authExpiredRef`/hydration effect in `Pesdac.tsx`, `AuthGate.tsx`, `AuthLayout.tsx` Google loader, `IdentitySection` skeleton conditions, local profile seed/clear in `session.ts`, `signInWithGoogle`/`signOut` hygiene in `auth.ts`.
- Shared files (`frontend/src/lib/auth.ts`, `frontend/src/components/profile/sections.tsx`, `frontend/src/components/Pesdac.tsx`) are edited in NON-OVERLAPPING hunks only: this fix owns logout/login/identity/hydration hunks; sibling owns link-password/toast-layering/accounts-refetch hunks. Neither reformats nor moves the other's code.
- Shared additive helpers (if both need them, e.g. an `AuthServiceError` branch or a cache-invalidation trigger) are owned by the sibling; this fix consumes them read-only and, if the sibling has not merged yet, duplicates nothing — it guards with the existing API and notes the follow-up.
- Tests live in separate new files: this fix uses `frontend/tests/auth-session-flow.test.ts` (new); sibling uses its own new/extended files. Neither edits the other's test file.
- Backend tests are sibling-only. This fix adds no backend tests.
- Merge order: either may merge first; each branch rebases onto the other before final verification and re-runs `npm.cmd test`, `astro check`, `build`, `git diff --check` plus its browser matrix.
