# Env + secret rotation (audit §17)

## Required vars (dev / staging / prod)

Backend: `ENV`, `DATABASE_URL`, `FRONTEND_ORIGINS` (every origin: dev
port, preview URLs, prod domain), `BETTER_AUTH_URL`,
`BETTER_AUTH_SECRET` (32+ chars), `COOKIE_SECURE=true` + https origins
in prod. Optional: `UPSTASH_REDIS_REST_URL/TOKEN` (unset = `NullCache`,
zero behavior delta), `TRUSTED_PROXY_HOSTS` (unset = never trust
`X-Forwarded-For`). Frontend browsers receive ONLY `PUBLIC_API_BASE_URL`
+ one auth URL (`PUBLIC_BETTER_AUTH_URL`) — no secret ever gets `PUBLIC_`.

## Rotation procedure

1. Mint the new value (e.g. `BETTER_AUTH_SECRET`, Fernet data key).
2. Deploy with the new value. Expect: sessions minted under the old
   secret stop verifying → users re-login (that is the safe failure,
   not an incident).
3. **Rotation orphans stored keys:** LLM BYOK rows are Fernet-encrypted
   with the data key — rotating it makes existing `llm_credentials`
   rows undecryptable. There is no re-encryption path (we never hold
   the plaintext). Procedure: rotate, then users re-save their key in
   Settings (the UI shows `invalid` with a re-save path — spec
   `llm-byok-settings` §5.3). Say so in the maintenance note; do not
   silently drop the rows (they still delete cleanly with the account).
4. Never log values (names only), never commit `.env` (names-only
   `.env.example` files are the contract).

## Local files never override deploys

`sibling-.env` gap-filling (`config.py`) loads local files only for
missing keys — real environment wins. If prod behaves like dev,
suspect a leaked local file in the image, not the code.
