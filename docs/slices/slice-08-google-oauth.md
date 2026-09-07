# Slice 8 — Google OAuth Setup

BetterAuth Google provider requires a real OAuth client secret from Google
Cloud Console. The current `.env` files hold a `GOCSPX-xxxxxxxxxxxxxxxxxxxxxxxx`
placeholder and BetterAuth warns "Social provider google is missing clientId or
clientSecret" on every request.

## 1. Create OAuth credentials (Google Cloud Console)

URL: https://console.cloud.google.com/apis/credentials

1. Create (or select) a project — e.g. `pesdac-dev`.
2. **OAuth consent screen** — fill app name + support email + scopes
   (email, profile, openid). Add your email to test users for local dev.
3. **Credentials → Create credentials → OAuth client ID → Web application**.
4. Authorized JavaScript origins:
   - `http://localhost:4321`
   - `https://your-production-domain` (when ready)
5. Authorized redirect URIs:
   - `http://localhost:4321/api/auth/callback/google`
   - `https://your-production-domain/api/auth/callback/google`
6. Copy the `Client ID` and `Client secret` (starts with `GOCSPX-`).

The current placeholder Client ID is
`782857907580-gdmqm3g0bcejbco4ug63o7c6aegmaou.apps.googleusercontent.com` —
re-use it if you own that GCP project, or replace with a fresh one.

## 2. Update `.env` files (both must match)

`C:\Anubhav\Web Dev Projects\PESDac\.env` (root — used by drizzle + node):

```
GOOGLE_CLIENT_ID="<paste-client-id-here>"
GOOGLE_CLIENT_SECRET="<paste-real-GOCSPX-secret-here>"
```

`C:\Anubhav\Web Dev Projects\PESDac\frontend\.env` (used by Astro dev server;
gitignored mirror):

```
GOOGLE_CLIENT_ID="<paste-client-id-here>"
GOOGLE_CLIENT_SECRET="<paste-real-GOCSPX-secret-here>"
```

Slice 13 added this mirror — both files MUST stay in sync.

## 3. Restart Astro dev server

`Get-Process node | Stop-Process -Force`, then `npm run dev` from
`C:\Anubhav\Web Dev Projects\PESDac\frontend`. The "Social provider google is
missing clientId or clientSecret" warning should disappear.

## 4. Verify (live endpoints)

```
curl.exe -s --max-time 15 -o NUL -w '%{http_code}' http://localhost:4321/api/auth/sign-in/social
```

Should return `200` (not `400` missing-client-secret). The "google missing
clientId" warning should also be gone from the Astro log.

Click the Google button in `/login` or `/signup` — BetterAuth redirects to
`accounts.google.com/o/oauth2/v2/auth?...`, then back to
`/api/auth/callback/google` with a session cookie set.

## 5. Verify the Google button works end-to-end

- `/login` or `/signup` → click "Google" → Google account picker → consent
  screen → returns to `http://localhost:4321/new` with a valid session.
- `curl /api/auth/get-session` → 200 with `{ session: { ... }, user: { email, name, id, twoFactorEnabled: false } }`.
- The new user has providerId="google" in `list-accounts`.

## Why this is deferred

I cannot generate a real `GOCSPX-...` secret — that requires GCP console
access. The code path is verified end-to-end up to the OAuth redirect
(Slice 10 endpoint matrix). When you paste the real secret, no code change is
needed; the env wiring (Slice 13) handles both server processes.

## Rollback

If the new GCP project/secret is wrong, revert both `.env` files and the
GCP console changes. No code rollback needed.
