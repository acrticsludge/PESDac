# Backend audit — `backend/` (FastAPI API surface)

Date: 2026-09-28. Scope: every Python file under `backend/app`,
`backend/alembic`, `backend/scripts`, plus the backend half of
`.github/workflows/ci.yml`. Method: full read of the app tree
(routers → schemas → models → migrations → lib), env-var reachability
scan, OpenAPI route enumeration, and an executed test-suite run.
**No live database, no live provider, no browser.**

Severity legend: **stop-ship** / **release-blocker** / **security** /
**test-gap** / **ops** / **polish**.

Prior audits this builds on: `2026-09-06-backend-readiness-audit.md`
(the pre-backend gap census — items 1–7 are all closed),
`api-design-audit.md` (envelope + pagination decisions),
`docs/audits/security/2026-09-14-non-llm-baseline.md`.

---

## 0. Verdict

The backend is in unusually good shape. 25 route operations across 9
routers, one error envelope enforced globally, JWT verification with a
genuine algorithm allow-list and JWKS single-flight, per-user scoping on
every query, idempotency keys on every write that can be retried, and a
read-through cache that is fail-open by construction. The security
posture I could attack from the outside, I could not break.

**No stop-ship. No release-blocker. No security finding.**

The material problems are all in the *gates around* the code, not the
code: a test suite that is not hermetic (B1), a rate-limit trust
setting that no setup path can set (O1), and an API contract document
that predates four live routers (D1).

---

## 1. Gates — measured, not assumed

| Gate | Command | Result |
|---|---|---|
| Backend unit + contract | `python -m pytest` | **301 passed, 2 failed**, 247.7 s |
| Frontend unit | `npm run test` | 449/449 passed, 14.0 s |
| Frontend types | `astro check` | **38 errors**, 0 warnings, 16 hints, 153 files |
| Frontend build | `astro build` | passes |
| Route enumeration | `app.openapi()` | 25 operations |

Test-suite runtime is 4 min for 303 tests. The `retrieval_contract` /
`chunkstore_pg` / `jwks_resilience` files dominate; nothing pathological,
but it is close to the CI `timeout-minutes: 20` ceiling only if a
provider stub ever starts making real network attempts (see B1).

---

## 2. B. Backend defects

**None found.** Every route I traced is correctly scoped, and the two
concurrency-sensitive paths (chat code allocation, message `seq`
assignment) converge on the winner rather than 500ing or duplicating.
See *Checked and cleared* for the specific paths I tried to break.

### B1 — The suite is not hermetic: `.env` credentials leak into tests (test-gap)

`python -m pytest` on this machine reports **2 failures**:

```
tests/test_embeddings_providers.py::test_workers_ai_missing_creds_is_misconfigured
tests/test_embeddings_providers.py::test_selection_is_explicit_with_no_chain
```

Both fail with `DID NOT RAISE EmbedMisconfigured`. Root cause is a
falsy-`or` credential fallback in `app/retrieval/embeddings.py:164-167`:

```python
account_id = account_id or os.environ.get("CF_ACCOUNT_ID")
api_token = api_token or os.environ.get("CF_API_TOKEN")
if not (account_id or "").strip() or not (api_token or "").strip():
    raise EmbedMisconfigured(...)
```

The tests pass `account_id=""` — intended as "no credential" — but `""`
is falsy, so the `or` falls through to the environment. `app/config.py`'s
`_load_dotenv()` runs at import time and populates `CF_ACCOUNT_ID` /
`CF_API_TOKEN` from `backend/.env`, so the constructor succeeds and the
`pytest.raises` never fires. Verified directly: with those two variables
absent, `NvidiaProvider(api_key="")` correctly raises while
`WorkersAiProvider("", "")` does not.

This is a **test bug masking a code smell**, and it has two consequences:

1. **The suite's verdict is environment-dependent.** Green on CI (no
   `.env` on the runner), red on every developer machine with a populated
   `.env`. A gate that changes colour based on untracked local state is
   not a gate. Worse, the inverse is true: a *real* regression in the
   Workers AI path would also be masked on CI, where the same test
   passes for the wrong reason.
2. **The code smell is real on its own.** "Explicitly empty credential"
   and "unset credential" are different intents, and the `or` collapses
   them. If an operator deliberately blanks `CF_API_TOKEN` to disable the
   provider, the fallback to a *different* source is not reachable here
   — but the pattern is repeated in `NvidiaProvider` (line 216/221) and
   `LocalProvider`, and the same shape is repeated across
   `select_provider`. The fix is `is None` checks, not truthiness.

The codebase already knows this failure class. `app/cache.py:288-298`
has an explicit hermeticity guard for exactly this reason:

> "Hermetic suite: under ENV=test the real backend is never touched,
> even when the developer's own `.env` carries a live URL — otherwise
> contract tests would populate real keys and observe HITs."

That guard was never extended to the embedding providers, and
`backend/tests/conftest.py` only `setdefault`s seven variables — it does
not clear `CF_*` / `NVIDIA_*` / `R2_*` / `RETRIEVAL_*`.

Fix: `conftest.py` should blank the whole provider env surface for the
session, and the constructors should use `is None` rather than truthiness
so the test's intent is expressible. Until then, treat a local `pytest`
run as **non-authoritative** — 2 of 303 results are `.env` artefacts.

---

## 3. O. Ops risks

### O1 — `TRUSTED_PROXY_HOSTS` is unreachable from any setup path (ops)

`app/rate_limit.py:37-41` reads `TRUSTED_PROXY_HOSTS` to decide whether
`X-Forwarded-For` may be believed:

```python
if direct and direct.lower() in _trusted_proxy_hosts:
    forwarded = request.headers.get("x-forwarded-for")
```

Unset ⇒ the header is never trusted, which is the safe default. But the
variable is **absent from `backend/.env.example`**, and the README setup
path is `Copy-Item backend/.env.example backend/.env`. A production
deploy that follows the documented path behind a reverse proxy or CDN
therefore leaves it unset, so `_client_ip` returns the *proxy's* IP for
every request.

The blast radius is exactly the abuse-protection budget: every user
shares one bucket per route key, so `chats-create` (60/60),
`chat-messages-append` (60/60), `llm-key-save` (10/300) and
`users-delete` (10/300) become either globally-blocking (one busy user
locks out everyone) or globally-useless (the first 60 requests per
minute succeed for whoever arrives). `docs/operations/cache-and-rate-limits.md:70`
names this exact failure — "every client shares the proxy's IP and one
[shared bucket]" — so the risk is understood and the setting is still not
reachable from setup.

It is read at **import time** into a module-level `set`, so it also
cannot be changed without a process restart. That is defensible, but it
should be stated where the variable is declared.

Fix: add `TRUSTED_PROXY_HOSTS=` to `backend/.env.example` next to
`FRONTEND_ORIGINS`, with the exact-match and CIDR caveat.

### O2 — `/ready` does not exercise the pool the requests use (ops)

`app/routers/health.py:21-35` runs `SELECT 1` on a fresh session from
`get_db`. That proves a connection can be opened, not that the
`QueuePool` (5 + 5 overflow, `pool_timeout=10`) can serve a burst. A
readiness probe that passes while every request times out on checkout
is worse than no probe, because the orchestrator will not drain the pod.
Low severity at current scale (single host, `pool_recycle=300`), but it
is the probe a load balancer is being pointed at.

### O3 — Route count in the boot log is now wrong (polish)

`app/main.py:243-247` logs `routes=%d` from `len(app.routes)`. Under
FastAPI 0.141.1, `include_router` installs a lazy `_IncludedRouter`
wrapper, so this reports **13** (4 docs routes + 9 wrappers) instead of
the real 25 operations. Verified by enumerating both. Harmless, but it is
the one number an operator would use to confirm a router loaded, and it
is now actively misleading. Use `len(app.openapi()["paths"])`.

### O4 — No scheduler exists for the retention purge (ops, known)

`purge_expired_chats` in `app/routers/chats.py:88-131` is fully
implemented — chunked bulk deletes, per-window cutoffs, correct lean-column
recompute — and **nothing calls it**. The docstring says so plainly
("No scheduler is wired — there is no job infra in this repo"). The
`retention` profile field is therefore user-visible and inert: every user
who picks "30 days" keeps their data forever. The lock recipe
(`acquire_lock`/`release_lock`) is written in the comment and ready.

This is honest, not hidden, but it is a **user-facing promise the system
does not keep**, and the same applies to the cache note in the same
docstring: until a runner exists, prefix-wipes never happen and the 30 s /
60 s / 120 s TTLs are the only invalidation.

### O5 — The suite takes 4 minutes, and the CI ceiling is 20 (ops, watch)

`ci.yml:67` sets `timeout-minutes: 20` for pytest. At 247 s there is 5×
headroom. The risk is not the current suite but B1: the two failing tests
are the only ones that currently *touch* real environment state, and if a
future test does so with a live provider URL it will pay a network
timeout inside that budget.

---

## 4. D. Documentation drift

### D1 — `docs/API.md` predates four live routers (release-blocker for the contract, not the code)

`docs/API.md` is dated 2026-09-14 and states its scope as "scanned from
`backend/app/routers/*`". It documents 16 operations. The app serves 25.
Missing entirely:

- `GET /api/v1/retrieval/health`
- `POST /api/v1/retrieval/search`
- `POST /api/v1/ingest/manifest`
- `POST /api/v1/ingest/validate`
- `GET|PUT /api/v1/llm/status`, `PUT|DELETE /api/v1/llm/key`

The file even points at this itself, in a way that now reads as stale:
"`/llm/*` … belongs to the LLM phase — contract in
`docs/reasonix/specs/llm-byok-settings.md`, not here." Those endpoints
are implemented, migrated, and tested.

This matters because `docs/API.md` is the artifact a frontend
integration is written against, and it is also the only place the
retrieval error codes (`EMBED_MISCONFIGURED`, `EMBED_UNREACHABLE`,
`EMBED_SPACE_MISMATCH`) — which the frontend *does* branch on — are
documented outside a spec. The frontend↔backend audit filed this as an
integration finding too (see that report, D1).

### D2 — Response shapes are undocumented in OpenAPI (test-gap)

**No router declares `response_model`.** Every handler hand-builds a dict
(`_out`, `_msg_out`, `profile_to_out`, `_out` in `demo_state`), and
`/api/docs` therefore shows no response schema for any of the 25
operations. The `ChatOut`, `ChatListOut`, `MessageOut`, `MessageListOut`,
`ProfileOut`, `LlmStatusOut`, and `UserOut` models in
`backend/app/schemas/` are **declared and never used** — including
`Pagination`, which `docs/API.md` calls "typed".

Consequence: there is no server-side response validation and no
machine-checkable contract. A field rename in `_out` propagates to the
frontend as a silent `undefined` at runtime, caught only by whichever
unit test happens to pin it. The frontend compensates by hand-writing
`ServerChat` / `ServerMessage` in `frontend/src/lib/chat-sync.ts`, with
the two sides agreeing by convention rather than by enforcement.

This is a deliberate-looking trade-off (portable dicts keep SQLite and
Postgres identical), but nothing records that it *is* a trade-off, and
the unused schema modules read as if the wiring is simply missing. Either
wire `response_model` on the read paths or delete the dead models and
generate the OpenAPI types from the frontend side.

### D3 — `security.py` docstring describes removed behaviour (polish)

`app/security.py:1-5` says the module holds "the email
normalization/validation used by the profile PATCH". The profile PATCH
no longer accepts `email` (T20 moved identity fields to BetterAuth —
`app/schemas/profiles.py:50-54`), so `normalize_email` and `valid_email`
are referenced **only by `tests/test_security_unit.py`**. Same for
`CHAT_CODE_RE` (`security.py:14`): defined, never imported, never tested.
Three dead exports behind a stale docstring.

---

## 5. Checked and cleared (attacked, found sound)

- **Auth bypass.** `get_current_user` requires a `Bearer` header, verifies
  via JWKS with `algorithms=["RS256","EdDSA"]` (`none` and HS256 rejected,
  so no algorithm confusion), requires `exp`/`iat`/`sub`, and rejects
  tokens without a verified `email`. Unknown `kid` triggers exactly one
  forced refresh. JWKS failures return `None` → 401, never 500.
- **Cross-user access.** Every chat/message query is scoped
  `(user_id, code)` or `(user_id, id)`; cross-user, unknown, and
  demo-code reads all return the identical 404 body, so there is no
  existence oracle. `_get_owned` is the only read path.
- **CSRF on mutations.** `check_mutation_origin` compares reduced
  origins for **exact** equality, explicitly rejecting prefix matching
  (`http://localhost:4321.evil.com`). Origin-less requests are allowed
  for non-browser clients — documented, and the session token is still
  the identity proof.
- **Error-body leakage.** The 422 handler allowlists `loc`/`msg`/`type`
  and drops `input` and `ctx` — an allowlist, so future Pydantic keys fail
  closed. 500s are generic plus an 8-char ref that is only in the log.
- **Log hygiene.** `timing._log_label` logs route *templates* and query
  param *names* only — never ids, never search text. `db.safe_db_host`
  strips userinfo. `_cors_error_headers` does not leak. `llm.py` never
  logs a key; `key_hint` is minted at save time from the last 4 chars.
- **LLM key handling.** Fernet at rest, validate-before-persist against
  OpenRouter `/auth/key` (not the public `/models`), `503` on provider
  outage so nothing is half-saved, rotation-orphans degrade to
  `configured:false` rather than crashing, and account delete cascades
  through `User.llm_credentials` **and** the DB FK.
- **Rate limiting.** Redis fixed-window when configured (2 RTTs, not 4),
  fail-open to bounded in-memory buckets, 50 000-bucket cap with
  oldest-first eviction, and `Retry-After` on both paths.
- **Cache safety.** Every key embeds `{u:<id>}`; retrieval keys are
  deliberately user-free (all authenticated users share a corpus) and
  the ingest-wipe prefix is disjoint from `user_prefix` by construction.
  `invalidate_prefix` refuses an empty prefix, so a future bare call is
  a no-op instead of `SCAN *`.
- **Concurrency.** Chat-code allocation and message `seq` both retry on
  `IntegrityError` and adopt the winner's row; the `clientAdoptKey` /
  `clientMsgKey` unique constraints make replays safe. `_insert_or_select`
  handles the parallel-`/auth/me`-plus-`/profiles/me` race.
- **Pool sizing.** `statement_timeout` is set with a `connect` listener
  rather than `connect_args["options"]` — the transaction pooler rejects
  `options` as a startup parameter, which the comment records as
  probe-proven. Correct and well documented.
- **Retrieval space integrity.** `EMBED_SPACE_MISMATCH` compares
  `(embed_provider, embed_model)` stamps across the scoped slice *before*
  the ANN query, so a post-ingest provider switch fails closed instead of
  silently returning cross-space garbage.
- **Migration chain.** 16 revisions, single head, `test_migration_chain`
  green, and the model metadata declares the trigram-GIN index that
  migration 0007 created (drift repaired deliberately, with a comment).
- **Import-time config.** `main.py` refuses to build a half-configured
  app; `serve.py` always calls `create_app(validate=True)`. Prod requires
  https origins, `COOKIE_SECURE=true`, and a Fernet key.

---

## 6. This audit's own limits

Static plus a SQLite-backed suite. **Not** verified: the Postgres ANN /
FTS / `vector(1024)` legs (`chunkstore.ann_statement` / `fts_statement` /
`space_statement` are compile-asserted only — they have never been
executed in the suite, by design), the 16-migration chain against a real
Neon instance, `scripts/r2_sync.py` and `scripts/enrich.py` (both require
AWS/R2 credentials), and `scripts/reindex.py` beyond its dry-run test.
The `.env`-leak finding in B1 is reproducible on this machine; the
inverse claim (that CI is green) is an inference from the absence of
`.env` on a GitHub runner and should be confirmed by reading an actual
CI run rather than assumed.

---

## 7. Recommended order

1. **B1** — make the suite hermetic (`conftest.py` env surface +
   `is None` in the provider constructors). Nothing else in the backend
   report is worth doing first, because until the gate is trustworthy
   no other fix can be verified locally.
2. **O1** — one line in `backend/.env.example`.
3. **D1** — bring `docs/API.md` to the 25 operations it is missing.
4. **O3, D3, D2** — the housekeeping tail.
5. **O4** — decide whether `retention` ships as inert. If yes, copy that
   into the profile UI; if no, the purge needs a runner.
