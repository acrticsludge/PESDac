# Security baseline audit — non-LLM scope (audit §16)

Date: 2026-09-14. Scope: FastAPI backend + Astro frontend host, identity
via BetterAuth. Out of scope: LLM key handling beyond storage shape
(spec `llm-byok-settings`), future uploads/votes/share endpoints (each
gets its own audit line when specified). History is append-only: new
audits land as new dated files; `periodic/` holds the cadence log.

## Baseline vs CLAUDE.md §24 (all rows evidenced, none waived silently)

| # | Rule | Verdict + evidence |
|---|---|---|
| 1 | Never log secrets | PASS — category-only logging (`cache._warn`, rate-limit `category=%s`, timing stats); `test_error_copy_safety.py`, `test_error_logging.py`; toast redaction (`toast-policy.ts`) |
| 2 | Never commit secrets | PASS — `.env`/`drizzle.config.json` gitignored + example templates; secret scan on every slice commit |
| 3 | Validate input at boundaries | PASS — Pydantic on every input schema, `extra="forbid"` everywhere incl. `ChatCreate` (§9); lengths/chars pinned (`test_chat_create_rejects_…`) |
| 4 | Enforce authorization server-side | PASS — BetterAuth JWT per request, no sessions/cookies, no client user id (§5 + `test_jwt_verifier_unit.py`) |
| 5 | Ownership on mutations | PASS — `_get_owned` scoping everywhere; two-identity 404 proof (`test_cross_user_isolation.py`) |
| 6 | DB-level isolation | APP-LEVEL (accepted) — isolation via `user_id` scoping + `ON DELETE CASCADE` on every child FK (pinned); no Postgres RLS (would couple migrations across the dual-ORM split — ADR-0004) |
| 7 | HTTPS in production | PASS (config) — `COOKIE_SECURE=false + https` forbidden, prod requires https + `COOKIE_SECURE=true` (`config.py`, §19 tests) |
| 8 | CORS allowlist | PASS — exact-match allowlist, tested (§24 rows in `test_cors_error_headers.py`) |
| 9 | Mutation origin policy | PASS — exact-match + prefix-bypass rejection + absent/referer policy, tested (`test_mutation_origin.py`, new this audit) |
| 10 | Webhook signatures | N/A — no webhooks exist |
| 11 | No payment data | N/A — no payments exist |
| 12 | Rate-limit auth/abuse endpoints | PASS — backend table in `docs/operations/cache-and-rate-limits.md`; Astro link-password own bucket; BetterAuth owns login/signup/2FA/OAuth throttling (boundary, not our code) |
| 13 | No stack traces to users | PASS — generic 500 + ref ID, proven incl. commit-outage path (§13) |
| 14 | No sensitive creds in responses | PASS — export secret-free proof incl. stored LLM credential (§9); `key_hint` last-4 only by spec |
| 15 | Least privilege | PARTIAL — single Neon role via `DATABASE_URL` (pooled); no per-concern roles yet. Owner: §20 deploy (split read/write roles when staging lands) |
| 16 | Dep review on security changes | PASS (this audit) — no new runtime deps backend; frontend additions (`@playwright/test`, `@axe-core/playwright`, `lighthouse`, `cross-env`) are all `devDependencies` |

## Trust boundaries (pinned)

- **User content is opaque server-side.** The backend stores message
  `content` JSON and returns it byte-identical — never rendered,
  interpolated, or sanitized (`test_server_echoes_user_content_opaquely…`,
  new this audit; no markdown/HTML code exists in `backend/app`).
  Rendering XSS burden sits on the frontend Astryx Markdown surface,
  which receives exactly these bytes.
- **Identity tables are BetterAuth-owned** (Drizzle; ADR-0004). Account
  enumeration, session-cookie flags, OAuth state, and 2FA throttling
  are upstream behavior — monitored, not reimplemented. Overlay
  decisions (if upstream defaults ever weaken) belong in a new audit,
  not in app code.
- **Attachments are staging-only** (`Attachment{id,name,mime,size}` —
  metadata in memory, no bytes persisted, no endpoint). Server-side
  type/size/duplicate/cancel/preview validation lands WITH the future
  uploads spec, not before (staging validation now would be shelfware).

## Open decisions (accepted risks with owners, not silent passes)

1. **No step-up (fresh) auth for deletion / sensitive changes.** Delete
   requires a valid session JWT + allowlisted origin + 10/5-min rate
   limit, and is idempotent — judged sufficient for a single-user
   study app today. Step-up (passwordless re-prompt / re-OAuth) needs
   product input on which assurance level deletion warrants. Owner:
   product decision; revisit with the credentials-maturity milestone.
2. **No CSP on the frontend host yet.** A strict policy needs
   `unsafe-inline` for the pervasive inline theme styles (or a style
   migration first) — a policy that allows everything it must would
   be theater. Owner: dedicated CSP migration slice (§20); intended
   direction is strict `script-src` + nonced styles when the theme
   pipeline supports it.
3. **No security audit events pipeline.** Deletion/auth failures leave
   structured server logs (user-id hash, never email); there is no
   queryable event stream. Owner: §17 observability (events ride the
   metrics/logging work, not a parallel system).

## Cadence

Next full re-audit: on any boundary change (new endpoint, new auth
method, uploads spec, share links) or 90 days, whichever comes first.
Log runs in `periodic/` (one line per run: date, scope, result file).
