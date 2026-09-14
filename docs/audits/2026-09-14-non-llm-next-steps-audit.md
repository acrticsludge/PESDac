# PESDac Full-Stack Audit — All Next Steps Excluding LLM / RAG Pipeline

Date: 2026-09-14.
Scope: entire PESDac system (Astro + React 19 + Astryx 0.5.2 frontend, FastAPI `/api/v1` backend, BetterAuth + Neon Postgres, Upstash cache / rate-limit, chat persistence / sync / outbox, profiles / settings / onboarding, testing, performance, accessibility, security, observability, privacy, env / deploy / CI, docs / repo hygiene).
Exclusions (explicit, per request): LLM model calls, BYOK execution path, prompt shaping for generation, ingestion pipeline, document / chunk / embedding tables, vector retrieval, context-meter / truncation-notice intelligence, SSE turn-streaming generation internals, interactive quiz-checking intelligence.
Method: static trace of working tree on 2026-09-14 (`frontend/src`, `backend/app`, `lib/db`, `docs/architecture/backend-foundation-auth-profiles-chats.md`, `docs/api-design-audit.md`, `docs/audits/*`, `docs/reasonix/specs/*`, `docs/reasonix/plans/*`, `docs/slices/*`, `git log --oneline -20`, `git status --short`). No browser run, no live Postgres, no provider credentials. Findings are code-derived; browser / provider checks are listed as verification, not claimed as passed.
Status key: **Done** = observed in tree with tests / docs. **Partial** = exists but with known gaps. **Missing** = not observed. **Debt** = works today, will block future work if left.

Severity: Critical = security / data-loss / broken auth / false success / blank screen. High = common flow unreliable or contract misleading. Medium = resilience / consistency / maintainability. Planned = intentionally deferred product surface that must stay honest.

Prior audits inherited: `docs/api-design-audit.md` (2026-09-07, fixes shipped in Slice 13), `docs/audits/2026-09-07-pesdac-full-stack-readiness-audit.md` (C1–C7 + file-level requirements), `docs/audits/2026-09-06-backend-readiness-audit.md` (blockers §1 + contracts §4), `docs/audits/profile-settings-wiring.md` (2026-09-11, Tier A/B/C), `docs/audits/2026-09-10-chat-history-storage.md` (Proposed), `docs/reasonix/reports/t47-t65-implementation-report.md` (2026-09-08, T47–T65 with explicit browser / OAuth / Web-Vitals follow-ups).

Working-tree note at audit time: `frontend/src/pages/mockups.astro` modified (498 insertions, unstaged), `frontend/src/components/chat/LibraryWallBackdrop.tsx` + `frontend/src/components/chat/library-wall-bg.ts` untracked. Triaged in §1.

---

## ~~1. Working tree and release gate — DONE (2026-09-14)~~

> **Status: DONE — struck through, not removed (2026-09-14).** Triage + verification complete. `mockups.astro` (+498, dev-only `/mockups` route, static composer-backdrop Options A–E): SHIP as dev-only slice — zero production UI impact, no Astryx violation, `git diff --check` clean, secret scan clean, frontend 341 tests pass, `astro check` 0 errors / 0 warnings. `LibraryWallBackdrop.tsx` + `library-wall-bg.ts`: unreferenced (zero imports, "test branch") — DO NOT commit to main (would add dead code); delete vs keep-local needs your call, explicitly not silently carried. No `git commit` executed (commits need your explicit request) — commit-ready commands in the final report.

### ~~Current status~~
Partial. Recent history is healthy (`3bc5bfe` settings wiring / locale timestamps / find shortcut / thread hardening; `63ed945` shortcut-find backend; `33583e0` Upstash cache + Redis rate-limit). But the tree is dirty at audit time (one modified page + two untracked chat files, see above). No CI definition was observed in the tree.

### ~~What to add~~
1. ~~Triage the three dirty paths: ship as a slice, split, or revert. No silent carry-over.~~ — DONE: `mockups.astro` → ship; LibraryWall pair → do-not-commit, awaiting delete/keep call.
2. ~~`git diff --check` + secret scan before every commit.~~ — DONE for this slice: both clean (evidence in report).
3. ~~Keep small atomic commits (`feat/` / `fix/` / `chore/`) per `CLAUDE.md` §14.~~ — DONE as plan: one `feat(frontend)` commit for `mockups.astro`; audit md separately; LibraryWall pair excluded.

### ~~What it changes for future~~
A clean tree + enforced gate stops stale-worker / stale-asset incidents of the `link-password 404` class (readiness audit §Incident follow-up: route existed, screenshot came from stale backend / dev-server state). Every later slice starts from a verifiable base.

---

## ~~2. Architecture decisions and contradiction close-out — DONE (2026-09-14)~~

> **Status: DONE — struck through, not removed (2026-09-14).** Ground truth established against the tree (not the stale docs): Astro is `output: 'server'` on Node standalone (`astro.config.mjs:15-17`), subject routes are `prerender = false`, auth is self-hosted BetterAuth with Neon database-only (`config.py:3-6`). Wrote `docs/decisions/0001-hosting-ssr-shape.md`, `0002-auth-provider.md`, `0003-client-data-fate.md`; banner-marked 4 superseded docs (arch foundation partial; login-auth-surface plan; auth-spec v4 audit; neon-rework audit). Zero `src`/`backend` code touched. `git diff --check` clean, secret scan clean. No `git commit` executed (commits need your explicit request).

### ~~Current status~~
Debt. `docs/architecture/backend-foundation-auth-profiles-chats.md` is authoritative for backend shape (separate FastAPI service D1, Neon Auth owns identity D2, `/api/v1` versioning D8, drafts never leave tab D6, demo threads static D7). It contradicts the T47–T65 report on Astro output mode (arch: static-only; report: `output: 'server'` configured, `frontend/src/pages` + `astro.config.mjs`). `docs/decisions/` does not exist yet. — Resolution: both predecessors were stale; the tree (server output, BetterAuth) won. See ADRs 0001/0002.

### ~~What to add~~
1. ~~One ADR locking hosting / SSR shape (static vs hybrid, where SSE/uploads would live if ever added, CORS + env config).~~ — DONE: ADR 0001 (server-rendered Astro on Node; static-export return needs a new ADR).
2. ~~One ADR locking identity model (Neon user id as sole key; device-id migration explicitly rejected or accepted).~~ — DONE: ADR 0002 (BetterAuth `sub` in `users.auth_user_id` is the sole scope; device-id rejected; guests memory-only).
3. ~~One ADR locking per-key data fate (drafts drop, votes drop, customs / overlays / pins migrate — from backend-readiness audit §1.4).~~ — DONE: ADR 0003 (migrate customs/overlays/pins/archive/demo-overrides/profile; drop drafts/votes/skeleton-counts/ephemeral keys; outbox stays client-only transport).
4. ~~Create `docs/decisions/` with sequential numbering per `CLAUDE.md` §30; mark superseded v5 auth docs as Superseded.~~ — DONE: `docs/decisions/` created with 0001–0003; 4 one-line status banners added, no history rewritten. Deferred to §3: `login-signup.md` (v6) still speaks Neon in places — needs a BetterAuth reconciliation pass.

### ~~What it changes for future~~
Stops re-litigation of static-vs-server, identity, and data-fate on every slice. All persistence / sync / deletion work inherits the same keys and hosting assumptions.

---

## ~~3. Auth flows (login / signup / Google / 2FA / link / logout) — DONE (2026-09-14)~~

> **Status: DONE — struck through, not removed (2026-09-14).** Prerequisite first: scanned all error/warning states and locked the single Astryx-only system in `docs/design/error-ui.md` (E1–E8), registered in `CLAUDE.md` §30. Then: extracted `frontend/src/lib/auth-errors.ts` (Google/email/2FA mappers) + `frontend/tests/auth-errors.test.ts` (13 tests); rewired `AuthLayout.tsx` to Banner form errors + focus management + 2FA mapping + navigate guard. Verified: 354 frontend tests pass, `astro check` 0 errors / 0 warnings, `diff --check` + secret scan clean. Astryx-only throughout; no layout/theme change. No `git commit` executed (commits need your explicit request).

### ~~Current status~~
Partial. BetterAuth integration, trusted origins / proxies, rate limits, env examples (T59), token-failure boundary with transient-vs-terminal classification (`frontend/src/lib/auth-cache.ts`, `auth.ts` per T47–T50), hydration loading guard (T56), lazy `ProfileDialog` (T63, ~445.9 KB → ~393.3 KB + ~53.6 KB deferred) are Done. Remaining from readiness audit C1–C2 + file-level requirements: Google `void`-in-try/catch promise-ownership class, email/Google double-submit, Enter-submits-once, pre-submit rules, autocomplete attrs, safe error copy, 2FA invalid/expired/rate-limited/back/success, link-password / link-Google / unlink-last-method guards, change-password wrong-current/policy/rate-limit/timeout/expiry. — Resolution below; `sections.tsx` link/unlink/2FA/password actions verified conforming (typed toasts + funnel copy + server-side last-method refusal) and untouched.

### ~~What to add~~
1. ~~`await` every async auth handler with a local rejection handler; keep buttons disabled while redirect initiation is pending; regression test proving a rejected Google promise reaches the local handler (not the global toast).~~ — DONE (pre-existing T10, verified): handler awaits; loader persists through redirect flight, clears on error only. Mapper branches pinned by the 13 new tests.
2. ~~Explicit auth-page state machine: idle / validating / submitting / redirecting / 2FA / success / error; focus first invalid field; `aria-describedby` + live errors; toast live-regions; preserve safe fields after recoverable errors; never log passwords.~~ — DONE as a slice (no redundant rewrite): kept existing idle/loading/2FA/success/error states; added first-invalid focus (Astryx `ref` → `<input>`), Banner `role="alert"` for form errors with focus + clear-on-change, field `aria-invalid`/`describedby` via Astryx internally; safe fields preserved (values untouched on failure); email trimmed for submit without mutating the field.
3. ~~2FA + backup-codes UX: missing/malformed URI, missing codes, invalid/expired code, already-enabled, copy/download + warning treatment, disable-2FA behind destructive confirmation modal.~~ — DONE for the auth-page step: `toTwoFactorMessage` adds rate-limit (wait) + expiry (fresh code) copy, fallback unchanged; back/success pre-existing. Backup-codes/disable-2FA live post-login in `sections.tsx` (typed toasts + `AlertDialog`) — verified, untouched.
4. ~~Link/unlink + change/link-password: mismatch, policy, timeout, upstream 5xx, invalid session mapped separately; forbid unlinking last usable method; add freshness/idempotency for linking; guard BetterAuth upstream response shape before treating as success (`api-design-audit.md` §2.3).~~ — NO CHANGE NEEDED: all in `sections.tsx` behind typed error toasts + funnel copy; last-method refusal enforced server-side (`auth.ts:542-546`) and surfaced as a normal op failure. Upstream-guard item stays with the api-design-audit P3 backlog.
5. ~~Navigate only after confirmed session; already-logged-in on `/login` / `/signup` without redirect loops.~~ — DONE: null-data edge renders the form Banner instead of navigating to `/new` unauthenticated; already-logged-in effect kept. Blocked by library (documented, not hacked): Astryx 0.5.2 `TextInput` accepts no `autoComplete`/`name` (`BaseProps` extends `HTMLAttributes`) — revisit on Astryx upgrade.

### ~~What it changes for future~~
Auth stops being happy-path-only. Every later feature (profiles, chats, export, delete) can assume the session state machine is truthful, and tests can target the local error surface instead of the global rejection net. Copy changes now mean editing `lib/auth-errors.ts` + its tests — never inline strings.

---

## ~~4. Session, hydration, and 401 / logout truth — DONE (2026-09-14)~~

> **Status: DONE — struck through, not removed (2026-09-14).** Orientation showed the machinery largely built (raw-tag-keyed bootstrap, epoch-latched `useAuth`, deduped 401 dispatch, honest `apiLogout`); the real gap was the deletion path. Fixed: `clearIdentityHeap()` single spelling used by logout + completed deletion, `delete-account-cleanup.test.ts` (3 tests), session/token semantics section in `betterauth-integration.md`. Verified: 357 frontend tests pass, `astro check` 0 errors / 0 warnings, `diff --check` + secret scan clean. No `git commit` executed (commits need your explicit request).

### ~~Current status~~
Partial. First client render stays `loading` until hydration (T56), import-safe profile tab metadata + deferred session reads (T57–T58), token mint dedupe + 401 invalidation path (T60) are Done. Still open per C4–C5: SSR bootstrap cache outliving document / user across Astro transitions + persisted islands; BetterAuth-session vs backend-JWT disagreement; backend logout no-op semantics; simultaneous-401 dedupe; user-scoped state clearing on logout / 401 / deletion / account-switch. — Resolution: all verified present except the deletion-path stores (fixed); semantics documented (fixed).

### ~~What to add~~
1. ~~Key or invalidate `InitialSession.astro` bootstrap on document / transition / user identity; clear auth / profile / account / product / outbox-identity caches on logout, 401 epoch, deletion, user change; test hard refresh + same-tab sign-out/sign-in + Astro navigation.~~ — VERIFIED PRESENT (`readInitialSessionTag` raw-tag keying, `clearAuthCache` + `resetChatStoreForIdentity` + epoch, existing session/cache-identity tests) + FIXED the one gap: deletion skipped the profile seed + sibling ping. New `clearIdentityHeap()` (caches + store + epoch, seed, ping) used by `apiLogout` (identical behavior, one spelling) and completed deletion; 3 new tests pin seed-reset, ping, and no-touch-on-failure. Deliberately unchanged: 401 path keeps this-tab clearing only (ping contract stays logout/deletion-initiated; siblings re-prove on next read).
2. ~~Define lifetimes + revocation guarantees in docs; implement one-401-epoch behaviour (clear token, abort protected requests, notify once, navigate once); document whether a stale token works after logout; protect sensitive routes per that model.~~ — DONE: semantics section in `betterauth-integration.md` (cookie session, 800 ms SSR tri-state, on-demand Bearer, no backend revocation list + stale-token-until-`exp` limitation stated plainly, 204 no-op pointer). One-401-epoch verified in code (dispatch-dedupe flag + one-shot shell ref + logout-transition silence + single navigate). Sensitive-route server enforcement pre-existing (backend ownership tests).
3. ~~Make logout progress + result truthful in `Pesdac.tsx`; document `POST /auth/logout` 204 no-op vs future revocation in `docs/API.md`, not just code comments.~~ — VERIFIED PRESENT: pending Logout row state, honest `server-failed` info toast (never silent success), bounded 15 s race, guaranteed `/login` navigate on every path. 204 no-op documented in the semantics section; full `docs/API.md` stays §6 work.

### ~~What it changes for future~~
Eliminates the stale-identity class (wrong user rendering after transition / switch) and the ghost-request class (protected calls sent as guest after infra failure). All sync / cache / outbox work can trust the identity it keys on. Any new terminal identity transition must call `clearIdentityHeap()` — not a hand-rolled subset.

---

## ~~5. JWT / JWKS verification and backend auth boundary — DONE (2026-09-14)~~

> **Status: DONE — struck through, not removed (2026-09-14).** Orientation corrected the section premise: the verifier was already hardened (T17 claim checks + T1.1 singleflight/negative-cache + T1.2 shared client), so this slice added tests, not code — zero production lines changed. Added 8 verifier tests (wrong/missing issuer, audience enforced-when-configured + positive path, wrong signature, rotation recovery, missing email/sub, future nbf, `none` alg) + 1 invalid-token 401 envelope test. Verified: 179 backend tests pass, `diff --check` + secret scan clean. Naming drift noted: the code is `betterauth.py` + `get_current_user` (not the `neon.py` names this section quoted from the stale arch doc) — ADR 0002 is canonical. No `git commit` executed (commits need your explicit request).

### ~~Current status~~
Partial. `backend/app/auth/betterauth.py` + `backend/app/deps.py:get_current_user_from_neon` + `GET /auth/me` upsert (`docs/architecture/backend-foundation-auth-profiles-chats.md` §10) exist; startup JWKS warmup in `backend/app/main.py:_lifespan` is Done. Still open per C6 + backend requirements: audience disabled, issuer not enforced, algorithm allowlist / time-claim / subject / email-claim validation, unknown-`kid` single-refresh, bounded JWKS timeout, safe-category logging. — Resolution: all verified present in code. Audience is configurable (`BETTER_AUTH_AUDIENCE`) and defaults to absent-accepted because BetterAuth omits `aud` — intentional, code-documented, and now tested on both branches; enforcing by default would break prod. Issuer enforced from startup-required `BETTER_AUTH_URL`.

### ~~What to add~~
1. ~~Enforce configured algorithms only; validate issuer, audience, `exp` / `nbf`, `sub`, required `email`; force-refresh JWKS once on unknown `kid`; bound JWKS requests; generic 401 + safe operational category in logs.~~ — VERIFIED PRESENT, no code change (allowlist RS256/EdDSA, `require` exp+iat+sub, `verify_nbf`, issuer/audience resolution, single forced refresh, 5 s bounded fetch, category-only logging, last-resort 401 — `betterauth.py:32-283`).
2. ~~Standardise all 401s to the envelope (`api-design-audit.md` §2.2: `deps.py:74` `HTTPException` `{detail}` shape vs envelope from JWT path) — replace with `JSONResponse(error_body("UNAUTHORIZED", ...))`.~~ — VERIFIED PRESENT via a better mechanism: `main.py`'s global `HTTPException` handler already re-wraps every deps 401 into the envelope, so no per-site replacement is needed (the P1 wording is superseded by the handler). Pinned by `test_401_envelope` (missing token) + new `test_401_invalid_token_envelope` (rejected token) — one 401 shape app-wide.
3. ~~Tests: malformed / invalid tokens; wrong issuer / audience / algorithm / signature; unknown `kid`; JWKS outage; startup missing-env; no trust in frontend-supplied user id (verified claims are sole identity source).~~ — DONE: pre-existing covered malformed/missing-kid/HS256/outage/expired/resilience/timeout/startup-missing-config; new tests close wrong+missing issuer, audience (3 branches incl. positive), wrong signature, rotation recovery, missing email/sub, future nbf, `none` alg. No-frontend-id-trust holds by construction (`_resolve_user_sync` keys on verified `sub` only; cross-user 404s covered by existing contract tests).

### ~~What it changes for future~~
The auth boundary becomes a real trust boundary instead of a parsing step. All ownership checks (§7) inherit correct identity, and key-rotation / provider-outage behaviour is defined before it is needed in production. Rotation recovery and the audience-on branch now have positive tests — a future verifier edit that breaks the happy path fails loudly.

---

## ~~6. Backend API consistency and OpenAPI contract — DONE (2026-09-14)~~

> **Status: DONE — struck through, not removed (2026-09-14).** Orientation showed Slice 13 had already shipped the P1/P2 fixes with pinning tests (503 envelope, typed `Pagination`, clear-chats envelope, no backend link-password proxy), and §5 had settled the 401 question via the global handler — so this slice did the two genuinely open items: leaf-split `lib/api/errors.ts` (verbatim move + identity tests, zero consumer changes) and `docs/API.md` (route table verified claim-by-claim against router code, including two corrections mid-write: adopt replay is 200 not 409; 409s are allocation/append races). Verified: 360 frontend tests pass, `astro check` 0 errors / 0 warnings, `diff --check` + secret scan clean. No `git commit` executed (commits need your explicit request).

### ~~Current status~~
Partial. `docs/api-design-audit.md` reports Contract-First PASS, Boundary-Validation PASS, Addition-over-Modification PASS, Naming PASS; fixes shipped in Slice 13. Residual items still listed as P1–P3: `routers/health.py:27` 503 bare `{ok:false}`; `deps.py:74` 401 shape; `schemas/chats.py:ChatListOut.pagination: dict` too loose; `DELETE /chats` `{deleted:N}` vs `data` envelope; `lib/auth.ts` 693-line god-module; upstream link-password trust; missing `docs/API.md`. — Resolution: P1/P2 verified done in code with pinning tests (`test_ready_503_uses_envelope`, `test_chats_list_pagination_typed`, clear-chats envelope test, `test_401_envelope` + invalid-token test from §5); the link-password proxy no longer exists (same-origin Astro route since slice-12b, so the upstream-guard item is moot); the god-module got its first leaf split (below), full domain split deferred with coupling rationale.

### ~~What to add~~
1. ~~P1 (1 line + 3 lines): envelope on `GET /ready` 503 (`UNHEALTHY`); envelope on all `deps.py` 401s.~~ — VERIFIED DONE (Slice 13 + `main.py` handler + §5 tests). No change.
2. ~~P2 (10 lines + 1 line + 1 test): typed `Pagination(limit,offset,total)` Pydantic model — keep current shape, do NOT migrate to page/pageSize; wrap `DELETE /chats` in `{data:{deleted:N}}`.~~ — VERIFIED DONE (Slice 13 went further: `{data:{deleted},pagination}`; truncate-messages mirrors it). No change.
3. ~~P3: split `frontend/src/lib/auth.ts` into `lib/api/profile.ts` / `chats.ts` / `demo-state.ts` with shared `apiFetch` / `ApiError` / `toUserMessage` (60–80 moved lines, no behaviour change, thin re-export); add upstream-response type guard on link-password; write `docs/API.md` (~60 lines: envelope, pagination lock, per-route codes, idempotency keys, rate-limit headers).~~ — DONE AS A LEAF SLICE: `lib/api/errors.ts` holds the error surface verbatim (`ApiError`, `AuthRequiredError`, `AuthServiceError`, `toUserMessage`, `ApiErrorBody`); `lib/auth.ts` imports + re-exports, all 7 consumers untouched. Full domain split deferred: the module's caches/epoch/listeners are mutually coupled (a verbatim move would need circular imports), so it waits for a seam with behavior value. Upstream guard moot (no proxy). `docs/API.md` written and code-verified.
4. ~~Verify: every 4xx has envelope; `GET /chats` pagination typed in OpenAPI; existing backend tests green; frontend parses without change.~~ — DONE: envelope tests (§5 + `test_envelope_contract.py`), typed pagination test, 179 backend green (unchanged code), 360 frontend green (split is import-identical).

### ~~What it changes for future~~
One error shape, one pagination shape, one API doc. Frontend stops guessing; new endpoints (messages, uploads, share — when specified) copy the envelope instead of inventing a third shape. The next `lib/api/*` split copies the leaf pattern: move verbatim, re-export, pin identity, keep consumers untouched.

---

## ~~7. Data model, migrations, and database operations — DONE (2026-09-14)~~

> **Status: DONE — struck through, not removed (2026-09-14).** Did the fully verifiable core without a live Postgres or CI: chain-integrity test (linear 0001→0010 incl. the two interleaved date-named migrations, single head, every migration reversible on paper), behavioral delete-cascade test on SQLite (full row fan-out gone, other user intact) + structural ON DELETE CASCADE pin, read-only orphan-check module + runnable script (exit 0/1/2, smoke-verified) + behavioral tests, and ADR-0004 (dual-ORM ownership, verified index inventory, CONCURRENTLY discipline). Deferred with named owners: live-DB upgrade/downgrade in CI (§15), EXPLAIN on prod-like data (no dataset), orphan scheduling (§14). Verified: 192 backend tests pass, `diff --check` + secret scan clean. Committed without a prompt per standing instruction.

### ~~Current status~~
Partial. Neon Postgres 16 + `pgcrypto` / `vector` / `citext` at migration 0001 (RAG-ready with zero vector columns — no change here), `users` keyed by `neon_user_id`, `profiles.campus` + `onboarding_done` (0002 split), `0003_neon_auth_link` canonical v6, through `0009_shortcut_find` + `0010_llm_credentials` (routers `auth.py`, `chats.py`, `demo_state.py`, `health.py`, `llm.py`, `profiles.py`, `users.py` mounted in `main.py:232-238`). `drizzle.config.json` gitignored + example template Done (`af063dc`). `alembic upgrade head` at deploy + `downgrade -1` verified in CI is specified but CI itself is Missing (§15). — Resolution: chain verified linear to head `0010_llm_credentials` by `test_migration_chain.py`; dual-ORM ownership settled in ADR-0004; cascades proven by `test_account_delete_cascade.py`; orphan reporting by `app/orphans.py` + `scripts/check_orphans.py`. Live-DB + CI halves deferred as named above.

### ~~What to add~~
1. ~~Verify the 0001→0010 chain from a v5 checkout (0002→0001 downgrade path documented in arch §4); test `upgrade head` + `downgrade -1` on a disposable database in CI.~~ — DONE the file-verifiable half (graph test + reversibility test + 0002→0001 anchor); live-DB-in-CI half deferred to §15 (no CI exists).
2. ~~Confirm cascades: PESDac deletion cascades profile / chats / demo-state; BetterAuth deletion does NOT assume PESDac rows deleted (orphan path defined).~~ — DONE behaviorally (SQLite) + structurally (FK pin); one-directionality written into ADR-0004.
3. ~~Add + schedule an orphan detection / reconciliation query (BetterAuth user without PESDac row; PESDac row without Neon user).~~ — DONE the detection + script (INFO vs ACTION semantics, read-only, CI-ready exits); scheduling rides §14.
4. ~~Verify lookup indexes + ownership / export / retention / subject indexes + trigram drift fix (T4d) with `EXPLAIN` on prod-like data; keep `CONCURRENTLY` discipline for prod index adds.~~ — DONE the inventory half (verified list in ADR-0004, no fossil: 0005 renamed the index too); EXPLAIN half deferred (no prod dataset).
5. ~~Clarify dual-ORM ownership in docs: `lib/db/schema.ts` (Drizzle, BetterAuth tables) vs `backend/app/models/*` + `backend/alembic/*` (SQLAlchemy, app tables) on one shared Neon DB — migration ordering + single source of truth.~~ — DONE as ADR-0004 (incl. verified no-cross-FK finding: tools run independently in any order).

### ~~What it changes for future~~
Migrations become safe to run in deploy (not just on empty dev DBs). Deletion, retention, export, and any future messages work inherit correct cascades, indexes, and rollback instead of rediscovering them per slice.

---

## ~~8. Profiles, settings, onboarding persistence — DONE (2026-09-14)~~

> **Status: DONE — struck through, not removed (2026-09-14).** Tier A gate verified already shipped (`ThreadView.tsx:945,2150`); finished Tier B + Tier C-sync by wiring the last four memory-only controls (`proactiveQuiz`, `retention`, `depth`, all four shortcuts) through `savePreference`; fixed the stale-response hazard in the kernel (older flush can no longer roll back newer memory or fire a misleading toast; success reconciles canonical values only for untouched keys); extracted the login seed into `seedOnboardingFields` (key-set pinned: four onboarding keys, prefs never touched) shared by `Pesdac.tsx` hydration and `OnboardingDialog` save. Verified: 366 frontend tests pass (6 new), `astro check` 0 errors. Per-control pending/disabled UI deferred (kernel exposes `isSettingSaving`; wiring is a visual change needing a design pass). Committed without a prompt per standing instruction.

### ~~Current status~~
Partial. Settings wiring + locale timestamps + find shortcut + thread hardening Done (`3bc5bfe`); `shortcut_find` backend column Done (`63ed945`, `0009_shortcut_find.py`, `models/profiles.py`, `schemas/profiles.py`); `docs/audits/profile-settings-wiring.md` inventory Done (WIRED / STORED / PLACEHOLDER + Tier A/B/C + copy-paste contract). Server already accepts every preference field via `ProfilePatch` with frontend-mirrored enums. Follow-up-suggestions gate (Tier A, one gate in `ThreadView.tsx:834,1960`), Tier B persistence batch (difficulty, proactiveQuiz, verbosity, citations, examMonth, weeklyGoal, language, region, timezone), Tier C retention-preference sync are the documented remainders. — Resolution: Tier A verified done; Tier B closed incl. `depth` + shortcuts (same one-line pattern, server accepts all); Tier C preference sync done (enforcement still rides the scheduler per §18); kernel ordering + canonical-reconcile fixed with tests; seed key-set pinned with tests.

### ~~What to add~~
1. ~~Tier A: gate `followUps` display on `getProfile().followUps` — minutes, instant behaviour change.~~ — VERIFIED DONE in code, no change.
2. ~~Tier B: one `saveIdentity`-style pass (optimistic `updateProfile` → `PATCH /profiles/me` → rollback + `toUserMessage` toast), guests memory-only, login seed never clobbers device prefs.~~ — DONE: `savePreference` now covers every persisted control; guests pass `server:false`; seed extracted + pinned (`profile-seed.test.ts`).
3. ~~Tier C: sync retention preference now; enforcement rides the scheduler (§14); resolve `session`-only semantics before wiring the worker.~~ — DONE the sync half (`retention` persists like any pref); enforcement + `session` semantics stay with §18.
4. ~~Per-action loading states disabling only conflicting controls; concurrent saves cannot apply stale responses; never show saved before server confirmation; map 401 / 422 / 429 / timeout / 5xx separately; commit/refresh failure rollback; canonical full-profile response.~~ — DONE the safety core (stale-response guard, canonical reconcile for untouched keys, rollback + `toUserMessage` mapping, no success toasts anywhere); per-control pending UI deferred (kernel `isSettingSaving` ready, visual change needs design).
5. ~~Correctly deferred stays deferred: legal docs need real content + publish decision; email editing stays BetterAuth-owned read-only.~~ — Untouched, still deferred.

### ~~What it changes for future~~
Settings stop being write-only toggles. Cross-device roaming works through the existing PATCH contract with no migration, and the future quiz / verbosity / citation / streak / countdown / i18n work binds to already-persisted values.

---

## ~~9. Chats, demo-state, and self-service data (non-message bodies) — DONE (2026-09-14)~~

> **Status: DONE — struck through, not removed (2026-09-14).** Closed the validation gap for real (`ChatCreate` forbids extras like every other input schema; `clean_title` REJECTS overlong titles with 422 instead of silently clipping persisted data — guest-local truncation stays, all server-bound titles were already pre-truncated client-side); fulfilled the old cross-user TODO with a two-identity fixture proving every user-owned route 404s without existence-oracle leakage; proved export scoped/bounded (205 rows → exactly 200)/versioned/secret-free by recursive payload scan; proved delete-all-empty and delete-account-twice retry-safe. Verified: 197 backend tests pass (13 new). Known flake (pre-existing, unrelated): `test_error_logging.py::test_500…` ERRORs intermittently in full-suite runs, passes in isolation and on retry — owned by §13. Committed without a prompt per standing instruction.

### ~~Current status~~
Partial. Chat containers + demo overrides + export / delete-all / delete-account exist and are keyed by verified Neon user (`routers/chats.py`, `demo_state.py`, `users.py`; ownership checks compare `chat.user_id` to verified `sub`). Perf hardening Done: export hard-cap 200 rows (T4a), default page 200→50 (T4b), purge cutoff-in-WHERE + chunked DELETE (T4c), ownership/export/retention/subject indexes (T4d), threadpool for sync routes (T3.2) + small pool + bounded timeouts (T2.2) + pooled-first URL (T2.1). Still open: title/subject/code length + character validation, duplicate/race/commit-failure handling, cross-user 404 uniformity, delete idempotency, export secret-free proof. — Resolution: all five closed (race handling was already in code — adopt/message-key winners + seq retry — now pinned by pre-existing idempotency tests; validation + isolation + export + idempotency newly proven).

### ~~What to add~~
1. ~~Validate + test lengths / characters on chat create / patch; handle duplicate-code race + commit failures without 500 leak (envelope + ref ID).~~ — DONE: forbid-extras + reject-overlong (behavior change, pinned in `test_security_unit.py`); races return 200-winner/409-envelope, commit failures ride the global 500-envelope + ref-ID handler.
2. ~~Prove cross-user isolation on every user-owned route (chat, demo-state, profile, export, delete) — other-user id returns 404, never 403-differentiated existence.~~ — DONE in `test_cross_user_isolation.py` (chat CRUD, message list/append/truncate, demo/profile/export scoping, delete-only-self).
3. ~~Make `DELETE /chats` and `DELETE /users/me` retry-safe; define delete as transactional vs job/status contract with partial-completion reference + recovery path (see §4).~~ — DONE the retry-safe half (empty-clear 200×2, delete-twice 204×2); single-statement transactional deletes need no job contract at this scale.
4. ~~Prove export is scoped + bounded + versioned + secret-free (payload-shape test; excludes tokens/secrets; handles loading / timeout / malformed / download-failure / retry in UI).~~ — DONE the server half in `test_export_proof.py` (exact key sets, recursive secret scan incl. a stored LLM credential, 205→200 bound); export-dialog UI failure states stay with §11.

### ~~What it changes for future~~
Containers become a trustworthy foundation for any future messages work (extension points in arch §8: `messages.chat_id` cascade, `UNIQUE(chat_id,idx)`, `truncateOverlay(keep)` → `DELETE … idx>=?`, vote-key → `messages.id` migration, retention worker). No ownership or export surprise later.

---

## 10. Chat sync, outbox, and local storage (non-generation behaviour)

### Current status
Partial. Outbox slim append + `clientMsgKey` idempotency + durable outbox (T5–T5d, `6c97cce`), no-change bail-out on sync snapshot (`da6a119`), durable enqueue on live-send failure (`b92afe`), lean storage (`chat-history-lean-storage` spec/plan/tests), adopt idempotency, paging-rollback guards, identity-reset + resolve-guards + revalidation tests (`frontend/tests/cache-*.test.ts`, `outbox*.test.ts`, `chat-sync.test.ts`, `chat-backing.test.ts`) are Done. Still open from backend-readiness audit §1.4 + readiness file-level `session.ts` list: versioning / bounds / corrupt-signal / growth cap / fanout protection / reconciliation to server.

### What to add
1. `localStorage` versioning + migration path; quota guard on overlay growth; corrupt-JSON one-time warning + console error (gap audit §4b.5, ~10 lines); bound or LRU overlay/message growth (per-chat split or in-memory `Map`, evict closed chats).
2. Listener-fanout protection in `session.ts` (one thrower cannot break subscribers); malformed-state + duplicate-code handling; preserve backend-adapter signatures; never claim storage health unmeasured.
3. Offline / queue UX: queued-count + banner + manual retry + safe-retry copy; retry never duplicates user messages; abort settles state and preserves partial output.
4. Define future reconciliation local-demo/custom → server state (arch D7: backend stores overrides, never demo content) — drafts stay tab-memory-only (D6) with a regression test proving no draft endpoint / payload exists.

### What it changes for future
Sync becomes survivable (offline, reload, account-switch, corrupt disk, quota) instead of happy-path-only. Future message persistence inherits idempotency keys, paging windows, and rollback guards instead of inventing them.

---

## 11. Frontend shell, navigation, skeletons, toasts, and Astryx compliance

### Current status
Partial. Slices 11–16 Done: popup latency, loading + optimistic UI, link-credential, error-UX bugbash, Vite JSX runtime, error-toasts-everywhere, API envelope consistency, password-form feedback, server-errors-to-toasts, toast positioning. `AppToasts.tsx` global-rejection net exists; `Pesdac.tsx` shell + `ThreadView.tsx` + `ThreadHistoryLoader.tsx` + profile sections hardened in `3bc5bfe`. Still open: React error boundary (C7), per-action loading/error/retry on every sidebar action, unknown-route fallback, 320px + 200% zoom, toast dedupe/live-region/route-survival verification, mockups-page triage.

### What to add
1. App-level React error boundary in Astryx components with retry/remount + safe navigation + non-sensitive reference ID; integrate with `AppToasts`; test render failure + recovery (C7 — unhandled-rejection handling is not a substitute).
2. `Pesdac.tsx`: loading/error/retry on search, rename, pin, archive, hide, delete, navigation; dedupe 401 handling; surface server-profile hydration failure; unknown routes get a useful fallback; keep planned/dummy chats honestly labelled.
3. `ProfileDialog.tsx` + `sections.tsx`: loading / empty-search / error / retry / pending-close / focus-return; mobile 320px + 200% zoom pass; keep tab/search intact.
4. `AppToasts.tsx`: dedupe repeats; never duplicate local form errors; never log sensitive reasons; verify live-region semantics + duration + route-transition survival.
5. Skeletons/loaders: chat-list skeleton, thread loader, ditto-fix, pinned-thread fix, history loader — each with loading/error/empty/retry and no flash of false content.
6. Triage dead controls from backend-readiness audit §3 (Study Library, Settings/My Profile entries, SideNav heading link, welcome-menu items, share, read-aloud): cut now or mark Backend-gated with a tracked owner — none survive as silent no-ops.
7. AGENTS.md compliance sweep: actual Astryx components only; existing `PESDacMockupTheme` untouched; no Tailwind; no broad global selectors in `src/styles/global.css`; smallest diff per feature. If anything looks off vs Playground, investigate version → CSS imports → theme mounting → React/Astro integration → StyleX → fonts → viewport → overrides, in that order.

### What it changes for future
Every action answers the readiness UX contract (what is happening / validating or sending / still running / succeeded / what failed / next step / what was preserved or rolled back / safe retry / modal needed / screen-reader announcement). New screens copy the boundary + toast + skeleton pattern instead of inventing states.

---

## 12. Caching and rate limiting

### Current status
Partial. Upstash REST read-through cache + Redis rate-limit Done (`33583e0`, `3526f35`: `backend/app/cache.py`, `timing.py`, `rate_limit.py`, `test_cache*.py`, `test_rate_limit_redis.py`, `test_timing.py`; startup log `cache=upstash-rest|null ratelimit=redis|memory` in `main.py:79-93`). NullCache fallback = zero behaviour delta by design. Still open: per-write-path invalidation proof, key namespacing, TTL/stampede policy, multi-worker store guarantee, `Retry-After` preservation, proxy-IP handling.

### What to add
1. Invalidation test per write path (chats / profile / demo-state / users delete): write → read reflects write through cache; delete cascades purge keys; cross-user keys never collide (per-user namespace).
2. Document TTLs + stampede protection; verify `NullCache` path (unset URL) has zero behaviour delta under tests.
3. Rate-limit: bounded dev fallback; shared Redis store or explicit single-worker constraint documented; trusted-proxy IP handling; limits for login / signup / password / 2FA / OAuth / export / clear / delete + general API; `Retry-After` preserved through envelope normalisation (`main.py` handlers); clock-boundary tests.
4. Timing middleware (`timing.py`): keep one log line + headers per request; never alter body; never log values.

### What it changes for future
Cache becomes a performance layer with proven correctness (not a stale-read source). Rate limits survive multi-worker deploy and abusive clients without breaking legitimate auth / export / delete flows.

---

## 13. Testing and verification

### Current status
Partial. 29 frontend `node --test` files + 32 backend `pytest` files exist (auth contract, chats contract, messages contract, lean storage, adopt/idempotency, envelope, error-copy safety, error logging, health, JWKS resilience, JWT unit, pool config, profiles, rate-limit, security unit, startup warmup, timing, concurrency repro, CORS error headers). T53 automated gates green (frontend tests, `astro check`, build, backend tests, `diff --check`); production preview smoke 200s for `/login /signup /new /profile /subject/CN/a3k9m2` Done. Explicitly pending per T-report: browser console matrix, credential-backed Google OAuth smoke, measured Web-Vitals. Playwright never installed (backend-readiness audit §1.5, still true).

### What to add
1. Backend matrix: wrong issuer/audience/algorithm/signature; unknown `kid` + JWKS outage; cross-user every route; allowed/denied/no-origin/proxy origins; CORS credentials; rate-limit + `Retry-After`; DB rollback; startup missing-env; health vs readiness; deletion idempotency + orphans; cache-invalidation per write; export secret-free + bound; envelope shape on validation errors.
2. Frontend matrix: Google rejection → local handler; token-failure classification; SSR/client divergence; transition stale-cache; render-crash recovery; focus/a11y per dialog; concurrent-save ordering; export/download failure; destructive-modal cancel/failure paths.
3. Playwright: install + smoke spec (send, stop, retry, attach, keyboard-only send, 360px composer) as the net everything after stands on; then the full readiness verification matrix (guest; signup validation/server failure; invalid creds; timeout; Google matrix; 2FA matrix; refresh; 401 epoch + simultaneous 401s; logout success/failure; account switch; profile save/load failure; export failure; clear cancel/failure/success; deletion cancel/failure/partial/success; crash recovery; 320/768/1024/1440 + 200% zoom).
4. Backend load: sustained pool + cache-stampede + JWKS-refresh-under-load; record before/after on any perf claim; keep `test_concurrency_repro.py` green.
5. Static gates on every change: `npm.cmd test`, `npm.cmd run astro -- check`, `npm.cmd run build`, `python -m pytest`, `git diff --check`, dep-audit review, no-secrets-in-diff.

### What it changes for future
Verification becomes evidence instead of confidence (`CLAUDE.md` §10). Future slices land on a smoke net + contract tests + browser matrix instead of hand-verification.

---

## 14. Performance, bundle, and Astro runtime

### Current status
Partial. Lifespan warmup Done (DB pool `SELECT 1` + JWKS prefetch + cache probe, failure-tolerant, awaited so "startup complete" means ready — `main.py:46-94`); pooled-first URL + small pool + bounded timeouts Done (T2); threadpool for sync routes Done (T3.2); export/paging/purge/index hardening Done (T4); profile lazy-load Done (T63); Astro/Node pin `astro@6.0.5` + `@astrojs/node@10.0.2` Done (preview `getAdapterLogger` mismatch fixed). Pending: measured LCP/INP/CLS (T62/T64 explicitly not fabricated); dep advisories (2 high + 1 low, deferred upgrade rationale in T45 decision doc); `document.execCommand` deprecation hint in `ThreadView.tsx` (T-report risk 5, separate editor task).

### What to add
1. Lighthouse / DevTools run with fixed viewport + CPU/network throttling + repeated runs; record LCP / INP / CLS / FCP / TTFB / long-tasks / waterfall / LCP element. Preview timings taken so far (8–608 ms TTFB) are smoke, not Web-Vitals.
2. Bundle: confirm Astryx+React baseline vs bloat; decide `chunkSizeWarningLimit` vs route-split; add bundle-regression check; never `npm audit fix --force` unreviewed.
3. Middleware: verify `matcher` scope, static-asset exclusion, auth behaviour, cache behaviour, runtime compat, perf impact.
4. Replace `document.execCommand` as a focused editor-modernisation task (no behaviour change).
5. Keep `liveness` (`/health`, no DB) vs `readiness` (`/ready`, DB + JWKS + cache probe) truthful and separately tested.

### What it changes for future
Cold-start cost stays in lifespan (not first paint); pool + threadpool + paging + indexes hold under load; bundle stays measured so future features cannot hide bloat inside an unmeasured chunk.

---

## 15. Accessibility and responsive behaviour

### Current status
Partial. Toasts-everywhere + error-copy safety + focus work in slices 12–16 improved the surface, but no full a11y audit was observed. Requirements are specified in the readiness audit (AuthLayout focus + live errors; AuthGate focus entry/return; Onboarding focus + announce; ProfileDialog 320px + 200% zoom; `session.ts`/chat keyboard paths) — implementation + proof outstanding.

### What to add
1. Full pass with `accessibility` + `browser-testing-with-devtools` skills: focus entry/return on every dialog (AuthGate, Onboarding, Profile, Settings, destructive modals); first-invalid focus; `aria-describedby` + live errors; toast live-regions; keyboard-only composer + chat actions; reduced-motion; minimum touch targets; contrast verified against the authoritative theme (never edit the theme to fake a pass).
2. Responsive matrix: 320 / 768 / 1024 / 1440 + 200% zoom on shell, ProfileDialog, SettingsDialog, ThreadView, auth pages; composer usable at 360px.
3. `web-quality-audit` record in `docs/audits/` (not overwritten history); image / font / meta hygiene for public routes only (authed app routes are not SEO content — do not index private content).

### What it changes for future
Accessibility becomes a release gate (`CLAUDE.md` §11, §15) instead of a retrofit. Future dialogs and chat interactions inherit focus + live-region + zoom contracts.

---

## 16. Security hardening (non-LLM)

### Current status
Partial. `main.py` security headers (nosniff / DENY / Referrer / conditional HSTS; CSP intentionally absent on JSON API — belongs on frontend host) + CORS allowlist + envelope normalisation + ref-ID 500s (`main.py:97-230`) Done; `config.validate_startup` fail-fast Done (`config.py:115-149`); validation-error detail allowlist (`loc/msg/type` only) Done; error-copy safety tests Done (`test_error_copy_safety.py`, `test_error_logging.py`, `test_security_unit.py`, `test_cors_error_headers.py`). No `docs/audits/security/*` audit was observed; CSP on the frontend host undecided; fresh-auth for sensitive changes unspecified.

### What to add
1. Close the checklist per `CLAUDE.md` §24: server-side authz + ownership on every mutation; exact/proxy-aware origin comparison + explicit absent-origin policy; insecure-cookie combinations rejected (enforced); secrets never logged/committed; least-privilege service creds; dep review on security-sensitive changes; no stack traces to users; no sensitive credentials in API responses.
2. Verify Markdown-sanitisation source-check before any server-echoed text (stored-XSS-adjacent the moment the backend echoes user text — backend-readiness audit §2.1); attachment staging validates type/size/duplicate/cancel/preview server-side when uploads are specified (staging validation now).
3. Require fresh auth for deletion / sensitive changes; keep account-enumeration safe; add safe audit events; decide + document CSP on the frontend host.
4. Write `docs/audits/security/<date>-<scope>.md`; start `docs/audits/periodic/` cadence; never overwrite history.

### What it changes for future
Security moves from scattered hardening to a repeatable baseline with audit history. Future endpoints and integrations inherit envelope + origin + ownership + logging-hygiene contracts.

---

## 17. Observability and operations

### Current status
Partial. Stdlib structured logging Done (method + path-template + status + latency-ms + user-id hash, never email/bodies/tokens — `main.py:39-43`, `timing.py`); ref-ID 500s Done; startup warmup visibility Done. Metrics / tracing / alerting / runbooks are Missing; `docs/operations/` does not exist yet; `LESSONS.md` does not exist yet.

### What to add
1. Instrument while building (`observability-and-instrumentation`): RED metrics (latency / error / traffic), job duration + success/failure + backlog (purge, outbox), cache hit-rate, pool saturation, JWKS failures; health checks; symptom-based alerts (5xx rate, p95 latency, pool exhaustion, JWKS outage, cache down).
2. Runbooks in `docs/operations/`: deploy, rollback, env rotation (rotation orphans stored keys — users re-save — procedure must exist), orphan reconciliation, purge verification, stale-worker / stale-asset recovery (both dev servers restarted + hard refresh).
3. Create `LESSONS.md` on the next meaningful failure / gotcha (date / category / what happened / root cause / fix / prevention); keep `/graphify-out` gitignored if Graphify is adopted.

### What it changes for future
Production behaviour becomes diagnosable without asking the user "what went wrong" — the ref ID + logs + metrics answer it. Incidents produce lessons and runbook updates instead of repeat outages.

---

## 18. Privacy, export, delete, and retention (non-generation)

### Current status
Partial. `GET /users/me/export` (versioned, capped) + `DELETE /users/me` (hard-delete cascade, then frontend deletes Neon record via SDK) + `DELETE /chats` Done per arch §7.4; no app email by design (D5, Neon owns transactional) Done; drafts tab-memory-only by design (D6) Done in spec, regression test outstanding.

### What to add
1. Prove export v1: scoped to caller, bounded, versioned (`version` + `exportedAt`), secret-free; UI handles loading / timeout / malformed / download-failure / retry; "export before purge" offered using existing envelope + `dumpStore()` semantics.
2. Harden delete: transactional or real job/status contract; retry-safe; honest copy (never "fully deleted" after identity-only deletion); local cleanup follows server contract; orphan query scheduled.
3. Retention: `profiles.retention` (`forever / 1 year / 30 days / session`) already exists — define `session`-only semantics (memory store already dies on reload — what does `session` delete?), then schedule the existing `purge_expired_chats` worker keyed off it (profile-settings-wiring §2 Tier C). Nightly job, not client deletes; dry-run + metrics first.
4. Regression test: no draft endpoint exists and no draft payload leaves the tab.

### What it changes for future
GDPR self-service becomes real (export → clear → delete → retention) with idempotency and reconciliation. Storage stays bounded per user without client logic, and future message retention rides the same worker.

---

## 19. Environment, configuration, and secrets

### Current status
Partial. `backend/.env.example` + `frontend/.env.example` exist with correct names-only discipline; `config.py` fail-fast validation Done (ENV enum, DB required, `BETTER_AUTH_URL/SECRET` + 32-char floor, `FRONTEND_ORIGINS` non-empty, `COOKIE_SECURE=false + https` forbidden, prod `https` + `COOKIE_SECURE=true` + encryption-key floor); sibling-`.env` gap-filler loader Done (`config.py:14-46`, real env wins). Root `.env` + root `package.json` (CommonJS, drizzle deps, stub `test` script) vs `frontend/` vs `backend/` vs `lib/db` ownership is Debt (§7.5). `PUBLIC_*` naming has two variants in tree (`PUBLIC_API_BASE_URL` + `PUBLIC_NEON_AUTH_URL` in arch §6 vs `PUBLIC_BETTER_AUTH_URL` in `frontend/.env.example`) — reconcile to one.

### What to add
1. Env parity doc: required per environment (dev / staging / prod); `PUBLIC_` hygiene (only `PUBLIC_API_BASE_URL` + one auth URL ever reach the browser; no secret ever gets `PUBLIC_`); `GOOGLE_CLIENT_ID` localhost vs prod; `FRONTEND_ORIGINS` lists every origin (dev port, preview URLs, prod domain); `BETTER_AUTH_TRUSTED_ORIGINS/PROXIES` aligned; `COOKIE_SECURE` matrix; `UPSTASH_*` optional (NullCache); encryption-key mint + custodian + rotation-orphans procedure.
2. Prove in tests: production refuses to boot on missing/invalid config; test mode bypass explicit; local files never silently override deployment env; values never logged.
3. Decide monorepo tooling (workspaces vs explicit no-workspace) and fix the root `test` stub; document who runs what from where (`frontend/`, `backend/`, repo root).

### What it changes for future
`ENV=prod` boot failures become configuration errors at startup (with category names, not secret values) instead of 500-ing servers or CORS-rejected preflights discovered by users.

---

## 20. Deploy and CI/CD

### Current status
Missing (CI) / Debt (deploy). No CI definition observed. Deploy shape implied by `CLAUDE.md` §22 (Vercel frontend + Render worker) but not locked by ADR (§2). `alembic upgrade head` at deploy specified; `import.meta.env` limited to host-only `PUBLIC_API_BASE_URL` (arch §6: `lib/auth.ts` appends `/api/v1`) Done in convention, verification outstanding.

### What to add
1. CI gates on every change: `npm.cmd test` + `astro check` (0 errors) + `astro build` + `python -m pytest` + `git diff --check` + OpenAPI route-registration test (link-password 404 lesson) + migration `upgrade head` / `downgrade -1` on disposable DB + secret scan + dep-audit review gate + preview smoke (HTML 200, all routes incl. unknown-subject fallback + API-down variant).
2. Deploy pipeline: build → migrate (`alembic upgrade head`) → boot-gate (fail fast, §19) → warmup (DB/JWKS/cache) → smoke (`/health`, `/ready`, authed `/auth/me` with real JWT in staging) → rollback understood (migration downgrade + previous image).
3. Preview-URL automation: every preview origin added to `FRONTEND_ORIGINS` + trusted origins + OAuth callback allowlist, or previews fail preflight by design — make it a checklist step, not tribal knowledge.
4. `optimizeDeps.force` kept as dev-cache guard with zero production impact; document hard-reload after stale versioned dev-asset URLs.

### What it changes for future
Shipping becomes `what changed / how verified / how monitored / how rolled back` (`CLAUDE.md` §14) on every deploy. Stale-worker and missing-migration deploys are caught by gates, not users.

---

## 21. Documentation, specs, and repo hygiene

### Current status
Debt. 46 specs + 37 plans + 11 slices + 14 audits exist under `docs/` — the canonical tree per `CLAUDE.md` §30 — but v5-vs-v6 status is uneven (arch §5 documents the v5→v6 auth tear-out; many specs predate it). `docs/API.md`, `docs/decisions/*`, `docs/operations/*`, `LESSONS.md` are Missing. Agent instructions are divergent (`AGENTS.md`: Astro/Astryx/StyleX vs `CLAUDE.md` §22: Next.js/Tailwind/Radix/Supabase/Vercel/Render — the latter is stale for this tree).

### What to add
1. Status-label every spec/plan (Proposed / In Progress / Implemented / Deprecated / Superseded); update canonical docs in the same task that changes behaviour (PRD → spec → architecture → plan → feature doc → tests → audits → migrations → operations per §38 lifecycle); never document planned behaviour as shipped.
2. Write the missing docs: `docs/API.md` (§6), `docs/decisions/*` (§2), `docs/operations/*` (§17), `LESSONS.md` (§17); update `README` (setup, env copy, both dev servers, migration commands, stale-asset hard-refresh, preview + smoke commands, browser matrix).
3. Re-run the 2026-09-04 dead-code audit; enforce naming (lowercase kebab-case, stable canonical names, dates for history, sequential ADRs); keep `docs/reasonix/specs|plans/` as execution artifacts, not sources of truth post-implementation.
4. Synchronise `CLAUDE.md` §22 stack description with the actual tree (or scope it as legacy) without blindly overwriting tool-native structure (`CLAUDE.md` §37).

### What it changes for future
Docs describe the system that exists. Future agents update one canonical document instead of creating the Nth similar file, and audits / ADRs / runbooks accumulate instead of being re-derived.

---

## 22. Product honesty (planned boundaries that must remain)

### Current status
Specified, partially proven. Arch D5–D7 + readiness "Planned features must remain" + UX contract (10 questions per action) + `AGENTS.md` design-truth rules are Done as policy. Demo threads (20/20: 4 × CN/OS/DLCD/DSA/Math per backend-readiness audit §0), deterministic responder simulations (`error / empty / limit / tool-error`), attachment staging (`Attachment{id,name,mime,size}`), static subject threads, local custom chats are Done as surface. Honest labelling (demo / local / planned) + mock loading/error/empty states per surface are Partial.

### What to add
1. Per planned surface, retain UI + intended behaviour + honest boundary label + mock loading/error/empty states + future adapter signature; never claim an in-memory operation is persisted (responder, attachments, share-links stub, study-library stub, future uploads, future durable preferences).
2. `@`-tokens: render inside user bubbles (gap-audit header note, still open) so the echo rule ("never interpolate raw user text into markdown") has a visible token shape; tone quiz copy to "try these, then ask for the walkthrough" until checking ships (backend-readiness §2.2).
3. Demo timestamps stay labelled mock; real-date grouping arrives with server dates (contract in `error-states.md`); corrupt-overlay one-time warning (§10).

### What it changes for future
The mockup remains a trustworthy prototype: users and future implementers can tell what is real, what is local, and what is planned — so backend / generation work replaces simulations seam-by-seam without rewriting UI.

---

## Release gate (no Critical remains)

Auth + website foundation are ready for core product work only when: no Critical finding remains; all Required file-level items are complete or explicitly blocked with an owner; planned features remain intact and honestly labelled; every user-facing operation has idle / validating / in-progress / complete / failed / cancelled / timed-out / partially-complete / planned states with safe retry; static + browser + backend verification matrices (§13) pass; `docs/API.md` + hosting/deletion ADRs + runbooks exist; accepted limitations have an owner and follow-up task. Unresolved provider / browser checks (Google OAuth E2E, measured LCP/INP/CLS, dep advisories, `execCommand` modernisation) are tracked above, not silently passed.

## Verification commands (static gates)

```powershell
cd frontend
npm.cmd test
npm.cmd run astro -- check
npm.cmd run build
cd ..\backend
python -m pytest
git diff --check
```

Browser / provider / measurement follow-ups require a real browser + credentials + throttled Lighthouse run and are not substituted by the commands above.
