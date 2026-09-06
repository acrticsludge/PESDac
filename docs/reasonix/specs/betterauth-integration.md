# Spec: BetterAuth + Neon Database Integration (Reworked v2)

## Objective

Integrate BetterAuth as the production authentication provider for PESDac using Neon Postgres. Replace the dev-user placeholder. Design: Google OAuth primary, 2FA enabled, email/password kept in config (hidden from UI, available for future activation), no gaps in middleware/facade/backend verification.

## Auth Design Decisions (Verified against docs/introduction + plugins/2fa)

| Decision | Value | Evidence Source |
|---|---|---|
| Auth library | Better Auth 1.7.3 (`better-auth`) | `lib/auth.ts`, docs/introduction |
| Social provider | Google OAuth (`socialProviders.google`) | `lib/auth.ts` config, docs/plugins |
| Primary sign-in | Google OAuth (UI-only) | User request |
| Email/password | Config enabled (`emailAndPassword.enabled: true`), UI hidden | User request ("option to add later") |
| Email verification | Disabled (`requireEmailVerification: false`) | User has no domain/email provider |
| 2FA plugin | `twoFactor()` plugin (TOTP/authenticator) | docs/plugins/2fa |
| Database adapter | `drizzleAdapter` with `provider: "pg"` | `lib/auth.ts` |
| Schema tables | user, session, account, verification, two_factor, passkey | `lib/auth.ts` schema mapping |
| Session cookie | `cookieCache: { enabled: true, maxAge: 7d }` | `lib/auth.ts` |
| Middleware | Astro `defineMiddleware` (`astro:middleware`) | User request (no gaps) |
| Session hook | `better-auth/react` `useSession()` in facade | User request (no gaps) |
| Backend verify | JWKS verification (`backend/app/auth/betterauth.py`) | Existing file, user request |
| Profile auth | New "Authentication" tab in `ProfileDialog` with Google link + 2FA + auth settings | User request |

## Requirements (No-Gaps Checklist)

- [ ] `lib/auth.ts`: configured with Google + email config + `twoFactor()` plugin + `appName`
- [ ] `lib/db/schema.ts`: 6 tables mapped (user, session, account, verification, two_factor, passkey)
- [ ] Database: tables exist in Neon (`drizzle-kit` migration applied)
- [ ] Middleware: `src/middleware/auth.ts` with `defineMiddleware` from `astro:middleware`
- [ ] Facade (`frontend/src/lib/auth.ts`): `useAuth()` wired to `useSession()` (not stub)
- [ ] Client (`frontend/src/lib/auth-client.ts`): `createAuthClient` from `better-auth/react`, includes `twoFactorClient()` plugin
- [ ] Auth UI (`frontend/src/components/auth/AuthLayout.tsx`): Google button wired (`signInWithGoogle`); email/password fields hidden (not removed from component, just not shown); forgot-password link removed (no email provider)
- [ ] Profile auth section (`frontend/src/components/profile/sections.tsx` + `ProfileDialog.tsx`): new tab/section in profile modal; Google linking moved here; 2FA settings shown; auth-related controls centralized
- [ ] Shell (`frontend/src/components/auth/AuthGate.tsx`, `Pesdac.tsx`): session-aware; logout calls `signOut()`; 401 fires `AUTH_REQUIRED_EVENT`
- [ ] Backend verification (`backend/app/auth/betterauth.py`): JWKS verification working; `get_current_user` real (not dev-user stub)
- [ ] Build passes (`npm run build`, `astro check`)
- [ ] No secrets committed; `.env` files documented

---

## Tech Stack (Unchanged from v1)

| Layer | Technology | Version |
|---|---|---|
| Frontend Framework | Astro + React | 6.0.0 / 19.2.8 |
| UI Components | Astryx (Meta) | 0.5.2 |
| Styling | StyleX | 0.19.0 |
| Auth Library | Better Auth | 1.7.3 |
| DB ORM | Drizzle ORM | Latest |
| Database | Neon Postgres | Serverless |
| Backend API | FastAPI | 0.115+ |
| Python | 3.12+ | |

---

## Plugin Configuration (`lib/auth.ts`)

```typescript
import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins"; // NEW: 2FA plugin

export const auth = betterAuth({
  appName: "PESDac", // Required for 2FA issuer
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:4321",
  secret: process.env.BETTER_AUTH_SECRET!,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: "user",
      session: "session",
      account: "account",
      verification: "verification",
      twoFactor: "two_factor",
      passkey: "passkey",
    },
  }),
  emailAndPassword: {
    enabled: true, // Config kept; UI hidden
    requireEmailVerification: false,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      redirectURI: `${process.env.BETTER_AUTH_URL}/api/auth/callback/google`,
    },
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 60 * 60 * 24 * 7,
    },
  },
  plugins: [
    twoFactor({
      issuer: "PESDac", // App name for TOTP URI
      skipVerificationOnEnable: false,
    }),
  ],
  advanced: {
    crossSubDomainCookies: { enabled: false },
  },
});
```

---

## Phase Updates (Revised from v1)

### Phase A (Completed by previous session — verified)
- A1-A5 complete: DB schema (`lib/db/schema.ts`), auth config (`lib/auth.ts`), migrations (`0000_bent_manta.sql`), `.env` vars.

### Phase B (Backend Verification — needs verification/fix)
- B2 (`betterauth.py`): exists but uses `asyncio.run()` fallback; must be verified working with async FastAPI dependency.
- B3 (`deps.py`): must update `get_current_user` to use `verify_betterauth_token` instead of dev-user stub.

### Phase C (Frontend Facade — CRITICAL GAP)
- C1: `frontend/package.json` has `better-auth` installed (previous session); verify `better-auth/react` import works (previous session used `createAuthClient` from `better-auth/react` which failed; correct import is `better-auth/client` or `better-auth/react` export path verified).
- C2: `auth-client.ts` exists (previous session wrote it).
- C3: `src/lib/auth.ts` facade is a stub (`useAuth` returns `guest`). Must rewrite to use `useSession()` from `better-auth/react`.
- C4/C5: `env.d.ts` and `.env` updated (previous session).
- C6: Build passes (previous session verified).

### Phase D (Login/Signup UI — revised for Google-only primary)
- Remove/hide email/password fields in `AuthLayout.tsx`; keep Google button.
- Hide forgot-password link (no email provider/domain).
- Wire Google button to `authClient.signIn.social()`.

### Phase E (Profile Linking — revised)
- Move Google linking row from `IdentitySection` into new profile auth section.
- Wire `linkSocial()` to profile auth section.

### Phase F (Shell — unchanged)
- F1-F4: `AuthGate`, logout, 401 events — all depend on C3 being complete.

### Phase G (Onboarding — unchanged scope)
- G1-G5: Integration tests.

### Phase H (Middleware — NEW MANDATORY)
- H1: Create `frontend/src/middleware/auth.ts` using `defineMiddleware` from `astro:middleware`.
- H2: Mount `auth.handler` at `/api/auth/*` (already done in `[...slug].ts`, but middleware must also set `context.locals.user/session`).
- H3: Verify endpoints respond.

---

## Profile Auth Section Design (`ProfileDialog`)

New tab in `ProfileDialog` (`frontend/src/components/profile/ProfileDialog.tsx`):

- Add new `ProfileTab`: `"authentication"`.
- Add to `NAV_GROUPS` under a new group (e.g., "Security") or within "Account".
- Create `AuthenticationSection()` in `sections.tsx` (or new file).
- Section contents:
  1. **Google account link** (moved from `IdentitySection`): shows linked/unlinked state using `authClient.getAccounts()` or session data.
  2. **2FA settings**: enable/disable TOTP using `authClient.twoFactor.enable()` / `disable()`; show QR/setup instructions.
  3. **Trusted devices** (optional): show/manage trusted device list (if multi-session or 2FA plugin provides it).
  4. **Account management note**: reference to `deleteAccount` (existing).
- Remove Google linking row from `IdentitySection`.

---

## Security / Hardening Requirements (CLAUDE.md Gate)

- [ ] Inputs validated (auth endpoints protected by middleware, session cookies only).
- [ ] Authorization enforced server-side (`deps.py` verifies JWT, not frontend claims).
- [ ] Ownership checked (`deleteAccount` deletes user's own data).
- [ ] No secrets committed (`.env` not tracked; `env.d.ts` only types).
- [ ] CORS restricted to `FRONTEND_ORIGINS` (`http://localhost:4321` in dev).
- [ ] Rate limits preserved (existing backend contracts).
- [ ] No raw tokens in frontend `localStorage` (cookies only).

---

## Verification Checkpoints (Updated)

| Checkpoint | Command | Expected |
|---|---|---|
| Config | `cat lib/auth.ts` | `appName`, `plugins: [twoFactor]`, `emailAndPassword.enabled: true` |
| DB Schema | `cat lib/db/schema.ts` | 6 tables mapped |
| Migration | `ls lib/db/migrations/` | `0000_bent_manta.sql` exists |
| Middleware | `cat frontend/src/middleware/auth.ts` | `defineMiddleware` present |
| Facade | `cat frontend/src/lib/auth.ts` | `useAuth()` uses `useSession()`, not stub |
| Client | `cat frontend/src/lib/auth-client.ts` | `createAuthClient({ plugins: [twoFactorClient()] })` |
| Profile Auth | `cat frontend/src/components/profile/sections.tsx` | `AuthenticationSection` exists; Google link moved |
| Build | `npm run build` (frontend) | Passes |
| Typecheck | `npm run astro check` | Passes |
| Auth Flow | Manual test | Google sign-in → session cookie → `/new` |
| 2FA Flow | Manual test | Enable TOTP in profile → verify code → session works |
| Middleware | `curl` to `/api/auth/session` | Returns session or 401, not 404 |

---

## Open Questions (Resolved)

| Question | Decision |
|---|---|
| Auth method primary | Google OAuth (UI); email config kept hidden |
| Email verification | False (no provider/domain) |
| 2FA method | TOTP (authenticator app) |
| Profile auth location | New tab in `ProfileDialog` |
| Middleware | Mandatory (`astro:middleware`) |
| Full proof / no gaps | Middleware + facade + backend + profile auth all implemented |
