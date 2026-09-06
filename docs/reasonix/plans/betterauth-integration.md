# Plan: BetterAuth + Neon Database Integration

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Astro + React)                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  │
│  │ AuthLayout  │  │  AuthGate   │  │My Profile   │  │  Pesdac   │  │
│  │ (login/     │  │  (gate)     │  │ (link       │  │ (shell,   │  │
│  │  signup)    │  │             │  │  Google)    │  │  logout)  │  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └─────┬─────┘  │
│         │                │                │                │        │
│         ▼                ▼                ▼                ▼        │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    src/lib/auth.ts (facade)                  │   │
│  │  useAuth()  signIn()  signUp()  signOut()  linkGoogle()     │   │
│  │  apiFetch()  apiGetMe()  apiGetProfile()  apiDeleteAccount()│   │
│  └────────────────────────────┬────────────────────────────────┘   │
│                               │                                    │
│                    ┌──────────┴──────────┐                         │
│                    ▼                     ▼                         │
│         ┌─────────────────┐    ┌─────────────────┐                │
│         │ BetterAuth      │    │ Backend API     │                │
│         │ (Astro          │    │ (FastAPI)       │                │
│         │  middleware)    │    │                 │                │
│         │ /api/auth/*     │    │ /api/v1/*       │                │
│         └────────┬────────┘    └────────┬────────┘                │
│                  │                      │                         │
│         ┌────────┴────────┐    ┌────────┴────────┐                │
│         ▼                 ▼    ▼                 ▼                │
│  ┌─────────────┐   ┌─────────────┐  ┌─────────────────────┐      │
│  │ Neon DB     │   │ BetterAuth  │  │ Neon DB (app data)  │      │
│  │ (auth tables)│   │ JWKS        │  │ users, profiles,    │      │
│  └─────────────┘   └─────────────┘  │ chats, demo_state   │      │
│                                      └─────────────────────┘      │
└─────────────────────────────────────────────────────────────────────┘
```

**Data Flow**:
1. Frontend calls BetterAuth directly for auth operations (`signIn`, `signUp`, `signOut`, `linkSocial`)
2. BetterAuth manages sessions via httpOnly cookies (set on frontend origin)
3. Frontend calls backend API with `credentials: "include"` → cookie sent automatically
4. Backend verifies BetterAuth JWT via JWKS, upserts local `users` table by `auth_user_id`
5. Backend returns user data + onboarding status

---

## Implementation Phases (Dependency Order)

### Phase A: Database & BetterAuth Server Config (Foundation)
**Must complete first** — everything depends on auth tables existing.

| Task | Description | Dependencies |
|------|-------------|--------------|
| A1 | Create Neon branch `auth-setup` | — |
| A2 | Add Drizzle schema for BetterAuth tables | A1 |
| A3 | Configure `lib/auth.ts` with Drizzle + Neon | A2 |
| A4 | Run `npx auth migrate` to create tables | A3 |
| A5 | Verify tables in Neon dashboard | A4 |

### Phase B: Backend Session Verification
**After Phase A** — needs JWKS endpoint from BetterAuth.

| Task | Description | Dependencies |
|------|-------------|--------------|
| B1 | Add `BETTER_AUTH_*` env vars to backend `.env` | A4 |
| B2 | Create `app/auth/betterauth.py` (JWKS verification) | A4 |
| B3 | Update `app/deps.py` → real `get_current_user` | B2 |
| B4 | Update `app/config.py` with BetterAuth config | B1 |
| B5 | Update `app/routers/auth.py` (keep shape, new impl) | B3 |
| B6 | Run backend tests (`pytest`) | B5 |

### Phase C: Frontend Auth Facade
**After Phase A** — needs BetterAuth client config.

| Task | Description | Dependencies |
|------|-------------|--------------|
| C1 | Add BetterAuth deps to frontend `package.json` | A3 |
| C2 | Create `src/lib/auth-client.ts` (BetterAuth client) | C1 |
| C3 | Rewrite `src/lib/auth.ts` facade to use BetterAuth | C2 |
| C4 | Update `src/env.d.ts` with `PUBLIC_BETTER_AUTH_URL` | C1 |
| C5 | Update frontend `.env` with BetterAuth URL | C1 |
| C6 | Run `npm run build` (typecheck) | C5 |

### Phase D: Login/Signup UI Wiring
**After Phase C** — needs working `useAuth`, `signIn`, `signUp`.

| Task | Description | Dependencies |
|------|-------------|--------------|
| D1 | Wire `AuthLayout.tsx` email/password to `signIn`/`signUp` | C3 |
| D2 | Wire Google button to `signInWithGoogle` | C3 |
| D3 | Wire forgot password to `forgetPassword` | C3 |
| D4 | Update success/error handling to match BetterAuth errors | D1-D3 |
| D5 | Test: signup → login → `/new` flow | D4 |

### Phase E: Profile Google Linking
**After Phase C** — needs `linkGoogle` in facade.

| Task | Description | Dependencies |
|------|-------------|--------------|
| E1 | Wire Google linking row in `sections.tsx` to `linkGoogle` | C3 |
| E2 | Update linked state detection (BetterAuth accounts) | E1 |
| E3 | Test: password-first user links Google → UI shows "linked" | E2 |

### Phase F: Shell Integration (AuthGate, Logout, Events)
**After Phase C** — needs `useAuth`, `signOut`, `AUTH_REQUIRED_EVENT`.

| Task | Description | Dependencies |
|------|-------------|--------------|
| F1 | Verify `AuthGate.tsx` works with new `useAuth` | C3 |
| F2 | Update `Pesdac.tsx` logout → `signOut()` | C3 |
| F3 | Verify `AUTH_REQUIRED_EVENT` still fires on 401 | B5, C3 |
| F4 | Test: session expire → 401 → gate opens | F3 |

### Phase G: Onboarding & Edge Cases
**After Phases D-F** — integration testing.

| Task | Description | Dependencies |
|------|-------------|--------------|
| G1 | Verify `OnboardingDialog.tsx` fetches profile correctly | D5, F1 |
| G2 | Test: Google OAuth new user → `/new` | D5 |
| G3 | Test: Google OAuth existing email → link behavior | D5, E3 |
| G4 | Test: Delete account → cascade → `/signup` | F2 |
| G5 | Test: Rate limits still work | B6 |

### Phase H: Astro Middleware for BetterAuth Routes
**Can start after A3** — serves `/api/auth/*` on frontend.

| Task | Description | Dependencies |
|------|-------------|--------------|
| H1 | Create Astro middleware `src/middleware/auth.ts` | A3 |
| H2 | Mount `auth.handler` at `/api/auth/*` | H1 |
| H3 | Verify all BetterAuth endpoints accessible | H2 |

---

## Parallelization Opportunities

| Parallel Group | Tasks |
|----------------|-------|
| **After A3** | Phase B (Backend) + Phase C (Frontend) + Phase H (Middleware) |
| **After C3** | Phase D (Login/Signup) + Phase E (Profile Link) + Phase F (Shell) |
| **After D5, E3, F1** | Phase G (Integration) |

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| BetterAuth JWKS not accessible from backend | Verify `BETTER_AUTH_URL` is reachable from backend network; use public URL |
| Cookie not sent cross-origin | Ensure `credentials: "include"` + CORS `allow_credentials=True` + same origin |
| Google OAuth redirect mismatch | Triple-check Google Cloud Console redirect URI matches exactly |
| Email verification disabled but BetterAuth requires it | Set `requireEmailVerification: false` in BetterAuth config |
| Existing tests break | Update `conftest.py` with BetterAuth mock fixtures first |
| Neon branch auth tables not visible to backend | Use same `DATABASE_URL` pattern; verify connection string |

---

## Rollback Plan

If critical issues arise:
1. **Frontend**: Revert `src/lib/auth.ts` to dev-user stub (git checkout)
2. **Backend**: Revert `app/deps.py` to dev-user `get_current_user`
3. **Database**: Neon branch `auth-setup` can be deleted; main branch unchanged
4. **Env vars**: Remove `BETTER_AUTH_*` from `.env` files

---

## Verification Checkpoints

| Checkpoint | Command | Expected |
|------------|---------|----------|
| DB Migration | `npx auth migrate` | Tables created in Neon |
| Backend Tests | `pytest` (backend) | 32+ tests pass |
| Frontend Build | `npm run build` (frontend) | 30 pages, no TS errors |
| Auth Flow | Manual browser test | Signup → login → `/new` |
| Google OAuth | Manual browser test | Google sign-in works |
| Link Google | Manual browser test | Profile shows "Google linked" |
| Logout | Manual browser test | Gate opens on `/new` |
| 401 Handling | Manual browser test | Gate opens on expired session |

---

## Open Questions (Resolved from Spec)

| Question | Decision |
|----------|----------|
| BetterAuth basePath | Default `/api/auth` |
| Email verification | Disabled for dev (`requireEmailVerification: false`) |
| Session verification | JWKS (fast, no extra hop) |
| Frontend serves BetterAuth | Same origin (Astro middleware) |
| Google redirect URI | `http://localhost:4321/api/auth/callback/google` |

---

## Next Steps

1. **Approve this plan** → I'll create discrete tasks (Phase 3)
2. **Start implementation** → Phase A (Database + BetterAuth config)
3. **Parallel tracks** → Backend, Frontend, Middleware in parallel after A3