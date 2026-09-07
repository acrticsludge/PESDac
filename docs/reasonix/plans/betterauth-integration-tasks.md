# Tasks: BetterAuth + Neon Database Integration

## Phase A: Database & BetterAuth Server Config (Foundation)

- [ ] **A1: Create Neon branch `auth-setup`**
  - Acceptance: New branch exists in Neon console with same Postgres instance
  - Verify: `neon branch list` shows `auth-setup`
  - Files: None (CLI command)

- [ ] **A2: Add Drizzle schema for BetterAuth tables**
  - Acceptance: `lib/db/schema.ts` exports `user`, `session`, `account`, `verification` tables matching BetterAuth spec
  - Verify: `npx drizzle-kit generate` produces valid SQL
  - Files: `lib/db/schema.ts`, `lib/db/index.ts`

- [ ] **A3: Configure `lib/auth.ts` with Drizzle + Neon**
  - Acceptance: `lib/auth.ts` exports `auth` instance with `drizzleAdapter`, email/password + Google, `requireEmailVerification: false`
  - Verify: `npx auth generate` produces types without error
  - Files: `lib/auth.ts`, `lib/package.json` (deps)

- [ ] **A4: Run `npx auth migrate` to create tables**
  - Acceptance: Tables `user`, `session`, `account`, `verification` exist in Neon `auth-setup` branch
  - Verify: Neon dashboard → Tables shows 4 new tables
  - Files: None (CLI command)

- [ ] **A5: Verify tables in Neon dashboard**
  - Acceptance: All columns match BetterAuth schema (id, email, emailVerified, etc.)
  - Verify: Neon dashboard → Table explorer → sample queries work
  - Files: None

---

## Phase B: Backend Session Verification

- [ ] **B1: Add `BETTER_AUTH_*` env vars to backend `.env`**
  - Acceptance: `.env` contains `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
  - Verify: `cat backend/.env` shows all 4 vars
  - Files: `backend/.env`, `backend/.env.example`

- [ ] **B2: Create `app/auth/betterauth.py` (JWKS verification)**
  - Acceptance: Module exports `verify_betterauth_token(token: str) -> dict | None` using JWKS from `BETTER_AUTH_URL/.well-known/jwks.json`
  - Verify: Unit test with mocked JWKS returns valid claims
  - Files: `backend/app/auth/betterauth.py`, `backend/app/auth/__init__.py`

- [ ] **B3: Update `app/deps.py` → real `get_current_user`**
  - Acceptance: `get_current_user` extracts Bearer token, calls `verify_betterauth_token`, upserts `User` by `auth_user_id`
  - Verify: Integration test with valid token returns User; invalid token → 401
  - Files: `backend/app/deps.py`

- [ ] **B4: Update `app/config.py` with BetterAuth config**
  - Acceptance: Config reads `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, validates on startup
  - Verify: `python -c "from app import config; print(config.BETTER_AUTH_URL)"`
  - Files: `backend/app/config.py`

- [ ] **B5: Update `app/routers/auth.py` (keep shape, new impl)**
  - Acceptance: `/auth/me` returns `{user: {id, email, displayName, onboardingDone}}`; `/auth/logout` returns 204
  - Verify: Contract tests pass (`test_auth_contract.py`)
  - Files: `backend/app/routers/auth.py`

- [ ] **B6: Run backend tests (`pytest`)**
  - Acceptance: All 32+ tests pass including new auth contract tests
  - Verify: `pytest -v` output shows 0 failures
  - Files: `backend/tests/conftest.py`, `backend/tests/test_auth_contract.py`

---

## Phase C: Frontend Auth Facade

- [ ] **C1: Add BetterAuth deps to frontend `package.json`**
  - Acceptance: `better-auth` and `@better-auth/react` in dependencies
  - Verify: `npm install` succeeds; `npm ls better-auth`
  - Files: `frontend/package.json`

- [ ] **C2: Create `src/lib/auth-client.ts` (BetterAuth client)**
  - Acceptance: Exports `authClient` from `createAuthClient({ baseURL: import.meta.env.PUBLIC_BETTER_AUTH_URL })`
  - Verify: TypeScript compiles; no runtime errors on import
  - Files: `frontend/src/lib/auth-client.ts`

- [ ] **C3: Rewrite `src/lib/auth.ts` facade to use BetterAuth**
  - Acceptance: Exports `useAuth`, `signIn`, `signUp`, `signOut`, `signInWithGoogle`, `linkGoogle`, `apiFetch`, `apiGetMe`, `apiGetProfile`, `apiDeleteAccount`, `toUserMessage`, `AUTH_REQUIRED_EVENT`, `AuthRequiredError`, `ApiError`
  - Verify: All imports in `AuthLayout`, `AuthGate`, `Pesdac`, `sections.tsx` resolve
  - Files: `frontend/src/lib/auth.ts`

- [ ] **C4: Update `src/env.d.ts` with `PUBLIC_BETTER_AUTH_URL`**
  - Acceptance: `ImportMetaEnv` has `PUBLIC_BETTER_AUTH_URL: string`
  - Verify: `npm run astro check` passes
  - Files: `frontend/src/env.d.ts`

- [ ] **C5: Update frontend `.env` with BetterAuth URL**
  - Acceptance: `.env` has `PUBLIC_BETTER_AUTH_URL=http://localhost:4321`
  - Verify: `cat frontend/.env`
  - Files: `frontend/.env`, `frontend/.env.example`

- [ ] **C6: Run `npm run build` (typecheck)**
  - Acceptance: `astro build` succeeds with 30 pages, no TypeScript errors
  - Verify: Build output shows "Complete!"
  - Files: None (verification command)

---

## Phase D: Login/Signup UI Wiring

- [ ] **D1: Wire `AuthLayout.tsx` email/password to `signIn`/`signUp`**
  - Acceptance: `handleSubmit` calls `signIn(email, password)` or `signUp(email, password, name)`; errors mapped to `setError`
  - Verify: TypeScript compiles; form submits without Neon SDK
  - Files: `frontend/src/components/auth/AuthLayout.tsx`

- [ ] **D2: Wire Google button to `signInWithGoogle`**
  - Acceptance: Google button `onClick` calls `signInWithGoogle()`; redirects to `/new` on success
  - Verify: Clicking Google button initiates OAuth flow
  - Files: `frontend/src/components/auth/AuthLayout.tsx`

- [ ] **D3: Wire forgot password to `forgetPassword`**
  - Acceptance: "Forgot your password?" link calls `authClient.forgetPassword({ email, redirectTo: "/login" })`
  - Verify: Email entered → "Check your inbox" state shown
  - Files: `frontend/src/components/auth/AuthLayout.tsx`

- [ ] **D4: Update success/error handling to match BetterAuth errors**
  - Acceptance: Error messages match current UI: "Incorrect password", "Couldn't create account", "Use at least 8 characters", "Check your inbox"
  - Verify: Manual test each error path
  - Files: `frontend/src/components/auth/AuthLayout.tsx`

- [ ] **D5: Test: signup → login → `/new` flow**
  - Acceptance: Fresh browser → `/signup` → create account → `/login` → sign in → redirects to `/new`
  - Verify: Manual E2E test
  - Files: None (verification)

---

## Phase E: Profile Google Linking

- [ ] **E1: Wire Google linking row in `sections.tsx` to `linkGoogle`**
  - Acceptance: "Link Google account" button calls `linkGoogle()`; redirects to Google → returns → UI updates
  - Verify: Click button → Google consent → returns → shows "Google linked"
  - Files: `frontend/src/components/profile/sections.tsx`

- [ ] **E2: Update linked state detection (BetterAuth accounts)**
  - Acceptance: `useAuth` session includes `accounts` array; Google linked if `accounts.some(a => a.providerId === "google")`
  - Verify: Password-first user → links Google → row shows "Google linked" with checkmark
  - Files: `frontend/src/lib/auth.ts` (extend `useAuth`), `frontend/src/components/profile/sections.tsx`

- [ ] **E3: Test: password-first user links Google → UI shows "linked"**
  - Acceptance: Signup with email/password → go to Profile → link Google → success
  - Verify: Manual E2E test
  - Files: None (verification)

---

## Phase F: Shell Integration (AuthGate, Logout, Events)

- [ ] **F1: Verify `AuthGate.tsx` works with new `useAuth`**
  - Acceptance: Gate opens for guests, closes for authenticated, never on `/login` or `/signup`
  - Verify: Manual test: logout → visit `/new` → gate opens
  - Files: `frontend/src/components/auth/AuthGate.tsx` (likely no changes needed)

- [ ] **F2: Update `Pesdac.tsx` logout → `signOut()`**
  - Acceptance: `handleLogout` calls `signOut()` then `navigate("/login")`; no `sdkMessage` import
  - Verify: Click logout in sidebar → redirects to `/login`
  - Files: `frontend/src/components/Pesdac.tsx`

- [ ] **F3: Verify `AUTH_REQUIRED_EVENT` still fires on 401**
  - Acceptance: `apiFetch` dispatches `AUTH_REQUIRED_EVENT` on 401; `Pesdac` listener calls `signOut()` + `navigate("/login")`
  - Verify: Expire session (dev tools) → API call → gate opens
  - Files: `frontend/src/lib/auth.ts`, `frontend/src/components/Pesdac.tsx`

- [ ] **F4: Test: session expire → 401 → gate opens**
  - Acceptance: Wait for session expiry or manually clear cookie → visit `/new` → AuthGate opens
  - Verify: Manual E2E test
  - Files: None (verification)

---

## Phase G: Onboarding & Edge Cases

- [ ] **G1: Verify `OnboardingDialog.tsx` fetches profile correctly**
  - Acceptance: Onboarding dialog opens for new users, pre-fills from `/profiles/me`, saves via `apiUpdateProfile`
  - Verify: Signup → `/new` → onboarding opens → fill → save → dialog closes
  - Files: `frontend/src/components/auth/OnboardingDialog.tsx` (likely no changes)

- [ ] **G2: Test: Google OAuth new user → `/new`**
  - Acceptance: Fresh browser → `/login` → click Google → consent → account created → `/new`
  - Verify: Manual E2E test
  - Files: None (verification)

- [ ] **G3: Test: Google OAuth existing email → link behavior**
  - Acceptance: Signup with email/password → logout → login with Google → links to existing account
  - Verify: Manual E2E test (BetterAuth handles linking logic)
  - Files: None (verification)

- [ ] **G4: Test: Delete account → cascade → `/signup`**
  - Acceptance: Profile → Delete account → confirm → all data deleted → redirect `/signup`
  - Verify: Manual E2E test; backend `DELETE /users/me` returns 202
  - Files: None (verification)

- [ ] **G5: Test: Rate limits still work**
  - Acceptance: 60 profile patches/min → 429; 10 deletes/5min → 429
  - Verify: Existing rate limit contract tests pass
  - Files: `backend/tests/test_rate_limit_contract.py` (verify passing)

---

## Phase H: Astro Middleware for BetterAuth Routes

- [ ] **H1: Create Astro middleware `src/middleware/auth.ts`**
  - Acceptance: Middleware matches `/api/auth/*` and calls `auth.handler(request)`
  - Verify: `npm run dev` starts; `/api/auth/sign-in/email` responds
  - Files: `frontend/src/middleware/auth.ts`

- [ ] **H2: Mount `auth.handler` at `/api/auth/*`**
  - Acceptance: All BetterAuth endpoints accessible: `/api/auth/sign-up/email`, `/api/auth/sign-in/email`, `/api/auth/sign-in/social`, `/api/auth/callback/google`, `/api/auth/sign-out`, `/api/auth/link-social`, `/api/auth/forget-password`, `/api/auth/session`
  - Verify: `curl -X POST http://localhost:4321/api/auth/sign-in/email` returns 400 (validation) not 404
  - Files: `frontend/src/middleware/auth.ts`

- [ ] **H3: Verify all BetterAuth endpoints accessible**
  - Acceptance: Each endpoint returns expected response (not 404)
  - Verify: Manual curl test for each endpoint
  - Files: None (verification)

---

## Task Dependencies Summary

```
A1 → A2 → A3 → A4 → A5
                    ↓
         ┌──────────┼──────────┐
         ▼          ▼          ▼
        B1→B2→B3→B4→B5→B6   C1→C2→C3→C4→C5→C6   H1→H2→H3
         │                    │
         ▼                    ▼
    (backend ready)    (frontend facade ready)
         │                    │
         └────────┬───────────┘
                  ▼
         ┌───────┼───────┐
         ▼       ▼       ▼
        D1-D5   E1-E3   F1-F4
         │       │       │
         └───────┼───────┘
                 ▼
              G1-G5 (integration)
```

---

## Total Tasks: 38
- Foundation (A): 5 tasks
- Backend (B): 6 tasks
- Frontend Facade (C): 6 tasks
- Login/Signup UI (D): 5 tasks
- Profile Linking (E): 3 tasks
- Shell Integration (F): 4 tasks
- Edge Cases (G): 5 tasks
- Middleware (H): 3 tasks

---

## Verification Commands Reference

```bash
# Database
neon branch create auth-setup
npx auth migrate
npx auth generate

# Backend
cd backend
pytest -v
pytest tests/test_auth_contract.py -v

# Frontend
cd frontend
npm install
npm run astro check
npm run build
npm run dev
```

---

**Ready to start implementation with Task A1.**