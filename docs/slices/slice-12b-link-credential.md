# Slice 12B — Link email/password to an existing account

> **Status:** SHIPPED.
> **Date:** 2026-09-07.
> **Auth provider:** BetterAuth 1.7.3 (Astro + FastAPI + Neon Postgres).
> **Scope:** Authentication section in `profile.astro` (slice 12 work extended).

## 1. Problem

The current Authentication section in My Profile only supports:

- Linking / unlinking Google
- Enabling / disabling 2FA
- Changing the password (only when a credential account already exists)

A Google-only user (the most common path — "Sign in with Google") **has no way to add a password** so they can also sign in with email + password. That's a real problem: if Google ever revokes their account, locks them out, or they simply want password sign-in as a backup, they're stuck.

We want a "Link with email/password" action that adds a credential account to the user's existing identity — without going through email-verification or password-reset (we have no email sender; reset-password therefore can't ship).

## 2. Constraint (the one that decides everything)

BetterAuth 1.7.3 has three password endpoints:

| Endpoint                | Purpose                              | Client-callable? |
|-------------------------|--------------------------------------|------------------|
| `POST /sign-up/email`   | Create a new user with a password    | Yes              |
| `POST /change-password` | Change a password (needs `current`)  | Yes              |
| `POST /reset-password`  | Reset (needs a mail sender)          | No (no sender)   |
| `POST /set-password`    | **Set** a first password             | **`serverOnly`** |

`auth.api.setPassword` is declared `createAuthEndpoint.serverOnly()` — the client cannot call it. There is no `authClient.setPassword(...)` in 1.7.3.

The only way to set a first password is a **server-side endpoint** that calls `auth.api.setPassword({ body: { newPassword }, headers: { cookie } })` with the user's session cookie.

## 3. Decision

A new FastAPI endpoint `POST /api/v1/auth/link-password` that:

1. Verifies the BetterAuth session JWT (existing `get_current_user` dependency).
2. Proxies to `auth.api.setPassword(...)` carrying the session cookie.
3. Returns `{ ok: true }` on success, surfaces the BetterAuth error envelope on failure.

The frontend `AuthenticationSection` gets a "Link with email/password" row that:

- Only renders when the user has **no** credential account (Google-only).
- Asks for `newPassword` + `confirmPassword` (no current — the user has none).
- Validates `MIN_PASSWORD_LENGTH` + the two match.
- On success, refreshes the `useAccounts()` list and shows a success Toast.
- On failure, surfaces the server message in the existing auth-error Banner.

The Password (Change) row is unchanged — it remains gated to `hasCredential === true`. The two rows are mutually exclusive by gating: link-credential is the inverse condition.

## 4. Design

### 4.1 Backend (FastAPI)

**`backend/app/routers/auth.py`** — add `POST /auth/link-password`:

```
POST /api/v1/auth/link-password
Authorization: Bearer <jwt>
Origin: http://localhost:4321
Content-Type: application/json

{ "newPassword": "<string>" }
```

Behavior:
- `get_current_user` enforces the JWT (rejects 401 on bad/missing).
- `check_mutation_origin` rejects cross-origin (same as `DELETE /users/me`).
- `rate_limit.check("auth-link-password", request, 5, 300)` — 5 attempts per 5 min per IP.
- Forwards to `auth.api.setPassword({ body: { newPassword }, headers })` with the request's `Cookie` header copied into the upstream call (BetterAuth verifies the session cookie server-side; this is the existing pattern from `/api/auth/token`).
- On upstream 2xx → 200 `{ ok: true }`.
- On upstream 4xx/5xx → 4xx/5xx with `error_body("AUTH_ERROR", message)`; for upstream 400/422 the body includes a `details` field for the UI.
- On upstream network error → 502 `error_body("AUTH_UNREACHABLE", "Authentication service unavailable.")`.

Why a new route and not a BetterAuth route mount: every existing router is a FastAPI native one; we don't mount BetterAuth as a sub-app at `/api/v1` (the live API is a pure JSON one). The proxy call is the same shape as `app/auth/betterauth.py`'s JWKS fetch — `httpx.AsyncClient` with a 10s timeout.

**`backend/app/main.py`** — no change: `auth.router` already includes the new route via the `auth` import.

**`backend/app/schemas/auth.py`** — add `LinkPasswordIn(BaseModel)` with a `min_length=8, max_length=128` field (mirrors the BetterAuth config) and a regex `^[!-~]+$` to reject whitespace. Trimmed.

**`backend/tests/test_auth_contract.py`** — one contract test (mirrors `test_chats_contract.py`'s style):
- 401 with no Authorization.
- 401 with bad token.
- 403 with `Origin: https://evil.com` (origin check).
- 429 after 5 hits in 5 min.
- 200 with valid session → row count in `account` table increases by 1, response is `{ ok: true }`.
- 400 on `newPassword` length 7 (Zod rejects server-side; we surface 400).
- 400 on missing body field.

### 4.2 Frontend

**`frontend/src/lib/auth.ts`** — add:

```ts
export async function linkPassword(newPassword: string): Promise<void> {
  const res = await apiFetch<{ ok: true }>("/auth/link-password", {
    method: "POST",
    body: { newPassword },
  });
  if (!res?.ok) throw new Error("Couldn't link password. Try again.");
  refreshAccounts();
}
```

The shared `useAccounts` cache (`accountsPromise`) is dropped after success so the new credential account surfaces immediately.

**`frontend/src/components/profile/sections.tsx`** — `AuthenticationSection` extends:

- New state: `showLinkPasswordForm`, `newPassword`, `confirmPassword`, `isLinkingPassword`.
- Inverse of `hasCredential`: `canLinkCredential = !hasCredential && accounts.status === "ready"`. Only when no credential account exists.
- New `SettingsRow` "Link with email/password" with description "Add a password so you can also sign in with email."
- Click toggles an inline form (same pattern as Change Password): `newPassword` + `confirmPassword` inputs, "Link password" primary button, "Cancel" secondary.
- `handleLinkPassword()` validates length + match, calls `linkPassword`, refreshes accounts on success, success Toast "Email + password linked." (F2 toast policy: small, body-only, info).
- Errors go to the existing `authError` Banner (single banner, no duplicate).
- The row does NOT render when `hasCredential` is true (the existing Change Password row is shown instead).

**No new components, no new files, no new Astryx primitives.** The Password Change row and the Link Password row share `MIN_PASSWORD_LENGTH`, the same input field shapes, and the same Button patterns. We deliberately keep them inside the Authentication section rather than as a Dialog — inline keeps the form context obvious and the dialog budget reserved for destructive confirmations (Delete account, Delete all chats).

### 4.3 i18n / accessibility

- All visible strings are inline English; no i18n file change.
- Inputs have `label`s and `isLabelHidden` (the row owns the visible label, matching every other row in the section).
- Form is keyboard-navigable: inputs tab forward, buttons tab forward; submit on Enter; cancel on Escape is intentionally NOT bound (no surprise close).

## 5. Why not the alternatives

- **Email-based reset (the standard "forgot password" flow):** We have no email sender. Adding one is a separate slice (involves transactional email provider choice, DNS, deliverability testing).
- **Client-side `authClient.setPassword(...)`:** Doesn't exist in 1.7.3; the underlying route is `serverOnly`. Direct server mount would expose BetterAuth as a sub-app at the `/api/v1` mount, which mixes auth-cookie semantics with our JWT-gated JSON contract.
- **Pre-filling a `currentPassword` from the user's Google account:** We never have the password to set a current; the server can't read it. The `changePassword` endpoint is the wrong tool.
- **Asking the user to type their Google password into PESDac:** We don't and never will store OAuth provider credentials.
- **Server-rendered `POST /api/auth/set-password` (mounted in `lib/auth.ts`):** Adds another mount in the BetterAuth config, complicates `app/main.py`, and exposes the BetterAuth cookie semantics on the same prefix as our API. The proxy endpoint keeps the surfaces clean.

## 6. Out of scope (deliberately)

- Setting a display name during link.
- Confirming the password is the user's by re-typing their current email (the email is the same — no proof).
- A separate "Verify email" step before allowing the link. The server doesn't require it (`requireEmailVerification: false`); this is a deliberate product decision in slice 0.
- Showing a "linked on" timestamp. The list-accounts endpoint in BetterAuth 1.7.3 doesn't surface it; we'd be guessing.

## 7. Rollback

The slice is a single FastAPI route + ~40 lines in the Authentication section.

Rollback:
1. Remove the `POST /auth/link-password` route from `app/routers/auth.py`.
2. Remove the `linkPassword` export from `lib/auth.ts`.
3. Remove the "Link with email/password" `SettingsRow` and its form from `AuthenticationSection`.
4. (No migration to reverse — adding a credential account is additive; existing users still have whatever they had before.)

No DB migration. No data loss.

## 8. Increments

Each step is one logical commit, isolated, and verifiable on its own.

| # | Where | What |
|---|---|---|
| 12B.1 | `backend/app/schemas/auth.py` | `LinkPasswordIn` schema: `newPassword: str` (min 8, max 128). |
| 12B.2 | `backend/app/routers/auth.py` | `POST /auth/link-password`: deps + origin + rate-limit + proxy to `auth.api.setPassword`. |
| 12B.3 | `backend/tests/test_auth_contract.py` | Contract test: 401/403/429/200/400. |
| 12B.4 | `frontend/src/lib/auth.ts` | `linkPassword(newPassword)` — `apiFetch` + `refreshAccounts()`. |
| 12B.5 | `frontend/src/components/profile/sections.tsx` | `AuthenticationSection`: inverse `canLinkCredential` row + form + Toast + Banner. |

After 12B.5: `npm run build` clean (chunk budget ≤ 750 kB), backend `pytest` green, dev-server manual smoke (Google-only user signs in → Profile → Authentication → "Link with email/password" → submits `passwordpassword` → success Toast → row replaced by "Password" Change row → sign out → sign in with email + password works).
