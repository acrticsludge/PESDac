# Frontend ↔ backend integration audit

Date: 2026-09-28. Scope: `frontend/src/lib/*` (API clients, stores,
outbox), the components that call them (`ThreadView.tsx`,
`Pesdac.tsx`, `profile/sections.tsx`), `astro.config.mjs`,
`frontend/.env.example`, and `.github/workflows/ci.yml`, diffed against
`backend/app/routers/*` and the 25 operations the backend actually
serves. Companion to `2026-09-28-backend-audit.md` (backend-internal
findings; cross-referenced, not repeated).

Method: route enumeration from `app.openapi()`, an exhaustive
`apiFetch`/`fetch` call-site census over every file in `frontend/src`,
env-var reachability scan, and executed gates (449 unit tests, `astro
check`, `astro build`). **No browser, no live backend, no live provider.**

Severity legend: **stop-ship** / **release-blocker** / **test-gap** /
**ops** / **polish** — same as the house audits.

---

## 0. Verdict

The integration layer is well built and the contract is respected
almost everywhere. `apiFetch` is a single choke point; `chat-sync.ts` is
a genuinely thin client with no caching, identity, or retry logic
leaking into it; the idempotency keys the backend offers are actually
used, with the same key replayed verbatim by the outbox; the 401 path
clears the whole identity heap and notifies one global listener; and the
retrieval error codes the backend emits are branched on by name.

**No stop-ship. No release-blocker.**

What is missing is narrower and more interesting: **the one thing a
frontend↔backend audit is most likely to be asked about does not exist
yet.** There is no inference path. `ThreadView.tsx:1408` still calls
`planResponse` — the deterministic mock responder — to produce every
assistant turn. The backend persists messages and can search course
material, but nothing generates an answer. That is a product decision
still in flight (I1), not a defect, and I flag it because every
"is the backend wired up?" question resolves to it.

The concrete defects are a **permanently red type gate** (G1) and two
**backend endpoints with no frontend consumer** (W1, W2).

---

## 1. G. Gate failures

### G1 — `astro check` is red in CI, and the README says it must not be (release-blocker)

`README.md:43` states: "Static gates on every change: unit tests,
`astro check` (0 errors), `astro build`, full pytest, `git diff
--check`, secret scan."

`ci.yml:27` runs `npm run astro -- check`. I ran that exact command:

```
Result (153 files):
- 38 errors
- 0 warnings
- 16 hints
EXITCODE=1
```

The gate is documented, wired into CI, and failing. The 38 break down by
file:

| Count | File | Tracked? |
|---|---|---|
| 8 | `src/components/layout/InitialSession.astro` | yes |
| 6 | `src/middleware/auth.ts` | yes |
| 7 | `e2e/section-f.spec.ts` | yes |
| 6 | `audit-auth.ts` (frontend root) | yes |
| 2 | `e2e/section-h.spec.ts` | yes |
| 1 | `e2e/section-e.spec.ts` | yes |
| 8 | `e2e/section-n-retrieval-display.spec.ts` | **no (uncommitted WIP)** |

**30 of the 38 are on committed files** — the `frontend` CI job is red on
a clean tree, independent of the in-progress retrieval work.

The dominant cluster is a single root cause: **there is no `env.d.ts`
anywhere under `frontend/src`.** `src/middleware/auth.ts:36-37,39-40,50-51`
assigns `context.locals.session` / `.user`, and
`src/components/layout/InitialSession.astro` reads them, but
`App.Locals` is never declared. Hence 14 errors of the form
`ts(2339): Property 'user'/'session' does not exist on type 'Locals'`
(9 + 5). This is not cosmetic: the middleware's whole design turns on
the **three-state** distinction — `session` set (proved user), `null`
(proved guest), `undefined` (unknown / timed out, fail closed to
`loading`). None of that is expressed in a type, so nothing stops a
future edit from collapsing `undefined` into `null` and re-opening the
gate over an unproved session — the exact bug the 800 ms race was built
to prevent.

The remaining committed errors are self-contained: stale Playwright
typing (`_context`, `ts(2345)` boolean-vs-`string[]` in 3 e2e specs, 10
total) and 6 in `audit-auth.ts`.

A gate that has been red long enough to become background noise is
worse than no gate, because the 8 *new* errors in the WIP retrieval spec
are indistinguishable from the 30 pre-existing ones.

Fix, in order: add `src/env.d.ts` with the `App.Locals` triple-state
declaration (clears 14, and pins the invariant); move or delete
`frontend/audit-auth.ts` (clears 6); fix the 10 e2e typing errors.

### G2 — `frontend/audit-auth.ts` is a committed scratch script holding a production dependency (ops)

`frontend/audit-auth.ts` is a 251-line one-off TypeSafe/Jev audit of the
auth flow, with a `#!/usr/bin/env npx tsx` shebang and instructions in a
comment ("Run: npx tsx --env-file=.env audit-auth.ts"). It lives at the
frontend root, outside `src/`, `tests/`, and `e2e/`, and it is tracked in
git.

It is the **only** importer of `@typesafe-ai/sdk` anywhere in
`frontend/src` (I checked every `.ts`/`.tsx`/`.astro` and
`astro.config.mjs` — zero references). So a 251-line audit script that
was run once is the sole justification for a **runtime** `dependency`
in `package.json`, rather than a `devDependency`. It reads `.env` and
`src/lib/auth.ts` off disk and posts source code to an external API when
run.

Two clean moves: relocate it under `scripts/` and make the SDK a
`devDependency`, or delete it and the dependency together. Either also
clears 6 of the G1 errors.

### G3 — Frontend unit suite is green (checked, not a finding)

`npm run test` → **449/449 passed, 14.0 s**. This is the one gate in the
repo that is both wired and trusted, and it is a good one: the output
shows behavioural names ("identical bodies collapse inside the window,
differ outside", "guest save is memory-only: zero fetches", "failed
older send keeps newer memory and stays silent when a newer save is
queued") rather than `it works`.

---

## 2. W. Wiring gaps

Enumerated by diffing the 25 backend operations against every
`apiFetch`/`fetch` call site in `frontend/src`. The client layer is
complete for what it covers — there is no path that hand-rolls a URL or
bypasses `apiFetch` except the two same-origin Astro routes, which is
correct.

**Wired (13 call sites, all through `apiFetch`):** `GET /auth/me`,
`POST /auth/logout`, `GET|PATCH /profiles/me`, `GET|POST|DELETE /chats`,
`PATCH|DELETE /chats/{code}`, `GET|POST|DELETE /chats/{code}/messages`,
`DELETE /users/me`, `GET /llm/status`, `PUT|DELETE /llm/key`,
`GET /retrieval/health`, `POST /retrieval/search`.

### W1 — `GET /api/v1/demo-state` and `PUT /api/v1/demo-state/{label}` have no consumer (polish, but a decision)

Backend-implemented, migrated (`demo_state` table, migration 0002),
rate-limited, contract-tested, cache-backed, exported in
`GET /users/me/export` — and **zero references anywhere in
`frontend/src`, `tests/`, or `e2e/`**.

The frontend handles the equivalent state entirely client-side:
`session.ts:367` reads overrides from `localStorage` under
`pesdac-demo-overrides-v1`, and demo threads are explicitly excluded
from server sync (`session.ts:1363`, `1425`:
`if (ref.kind === "demo" || auth == null || !isServerChat(ref.id))`).

So renaming, hiding, and pinning a **demo** thread is device-local and
does not follow the user to another browser, while doing the same to a
**custom** chat is server-backed. The `d:` vs `c:` ref split is
deliberate and well commented — the question is only whether demo
overrides are *meant* to persist. `docs/API.md:73-74` documents the
endpoints as live, which makes this look like an oversight rather than a
decision.

### W2 — `GET /api/v1/users/me/export` has no consumer (polish, same shape)

Same finding: no frontend reference to `me/export` or `exportedAt`. The
row cap (`EXPORT_MAX_ROWS = 200`, newest-window-truncated) and the
`version: 1` envelope are real work with no caller. GDPR export is
typically a settings-page action; there is none.

W1 and W2 together are one question, not two: **are the self-service
data endpoints (demo overrides, export) shipping without a UI, or is the
UI missing?** Right now the answer is ambiguous, and `docs/API.md`
implies the former while the code does the latter.

### W3 — Health checks are unconsumed (ops, correct)

`/api/v1/health` and `/ready` are never called from the frontend. That
is right — they are for the orchestrator, not the browser. Noted only so
the 13-vs-25 count in W1/W2 is not mistaken for a missing client.

---

## 3. I. Integration design — the one big open item

### I1 — There is no inference path; answers still come from the mock responder (decision, not a defect)

`frontend/src/components/chat/ThreadView.tsx:148` imports `planResponse`
from `../../lib/responder`, and line 1408 calls it to build the assistant
turn. `responder.ts:1` describes itself as "Deterministic demo
responder (mockup stage)". The in-code note at `ThreadView.tsx:1125` is
the honest marker:

> "until complete - backend will replace planResponse with SSE"

The backend has **no turn or stream endpoint** — 25 operations, none of
them produces a completion. So the current flow is:

```
user turn → planResponse (client, hardcoded study copy)
          → POST /chats/{code}/messages   (persistence only)
          → POST /retrieval/search        (real, server-side evidence)
          → evidence bubbles appended as a separate block
```

The retrieval path is genuinely real and correctly integrated (I
verified the wiring: `ThreadView.tsx:1281-1391` calls
`apiRetrievalSearch` → `toEvidenceItems` → `evidenceToBubbles`, with
`classifyRetrievalFailure` mapping each failure to exactly one surface
and `evidenceToBubbles` producing a markdown card plus an image bubble
from the persisted evidence). But the *answer* is still fixture text.

Two things follow that are worth writing down, because they will
otherwise be discovered late:

1. **The SSE turn-stream contract has no backend counterpart yet.** The
   2026-09-06 readiness audit listed it as contract #1, and the frontend
   still has no `EventSource`/`text/event-stream` consumer. The five
   documented event types (`turn.done` / `failed` / `empty` /
   `rate_limited`, plus tool transitions) have nowhere to be emitted.
2. **`stop`, `Retry`, and the interrupted-turn semantics are client-only
   today.** The Section-M audit (B10/B11) pinned "forceOk retry escapes
   with the real answer" and "stop persists an interrupted turn" against
   a client-side responder. When the responder is replaced, those ~200
   browser proofs will need re-pinning against real streaming, and some
   will legitimately change.

Nothing to fix here. Everything to decide, and the decision should be
recorded before the first streaming endpoint is written.

### I2 — Response contracts are enforced on neither side (test-gap)

Direct consequence of backend finding D2, viewed from here: **no router
declares `response_model`**, so `/api/docs` publishes no response shapes,
and the frontend hand-writes the mirror types —
`ServerChat` and `ServerMessage` in `frontend/src/lib/chat-sync.ts:9-32`.

The two sides currently agree, and they agree carefully: `ServerChat`
marks `preview` / `msgCount` / `lastSeq` **optional**, matching both the
`getattr` fallbacks in `app/routers/chats.py:147-149` (rollback-safe
against pre-0007 rows) and `ChatOut`'s defaults. That is correct
engineering — but it is correctness maintained by hand on both sides with
nothing to catch a future drift.

The specific risk: a rename in `_out` ships as `undefined` at runtime.
`preview` is the sharpest case — it feeds the sidebar snippet, so a
rename degrades silently to title-only rows rather than throwing. The
lean-storage tests (`tests/chat-history-lean.test.ts`, and the backend's
`test_chat_lean_storage.py`) pin the current names from both sides, which
is the right mitigation; the gap is that they are two separate test
files that have to be edited in lockstep by hand.

### I3 — Everything the frontend needs from the backend, it already has (checked, not a finding)

For the record, because the negative result is the useful one:

- **Auth:** the frontend never sends a session cookie to the API; it
  mints a service JWT from `GET /api/auth/token` and sends
  `Authorization: Bearer`. The backend verifies JWKS per request and
  takes identity from verified claims only — no user id crosses the
  wire. The two designs agree.
- **Envelopes:** `{data, pagination}` for lists, `{error: {code,
  message, details?}}` for failures, everywhere. `apiFetch` unwraps the
  nested envelope and tolerates the flat shape; 204 is special-cased
  before `res.json()` (`auth.ts:1181`), which is the bug the
  `apiDeleteChat` comment calls out.
- **Idempotency:** `clientAdoptKey` and `clientMsgKey` are sent by the
  outbox and **replayed verbatim** on retry (`outbox.ts:84-91`), matching
  the backend's unique-constraint dedupe. This is the part most systems
  get wrong and it is right here.
- **429:** the backend's `Retry-After` is honoured with a bounded
  `min(Retry-After, 5s)` single retry on chat writes only, and the
  outbox backs the whole round off a further 5 s. No retry storm.
- **401:** one `authRequiredError` choke point clears the identity heap
  (token, `/me`, profile, accounts, chat store, epoch) and dispatches
  `AUTH_REQUIRED_EVENT` exactly once per tick. The retrieval classifier
  correctly maps 401 to `surface: "none"` and defers to it.
- **Env parity:** `frontend/.env` `PUBLIC_API_BASE_URL=http://localhost:8000`
  matches `backend/.env` `FRONTEND_ORIGINS=http://localhost:4323,http://localhost:4321`,
  with `COOKIE_SECURE=false` consistent with the http origins — which
  `validate_startup` would otherwise reject. The prefix split is right:
  `PUBLIC_API_BASE_URL` is host-only and `apiFetch` appends `/api/v1`.

---

## 4. D. Documentation

### D1 — `docs/API.md` covers 16 of 25 operations (same finding as backend D1)

`docs/API.md` omits all four retrieval/ingest operations and all four
`/llm/*` operations. From this side it matters most for the **retrieval
error codes**: `frontend/src/lib/retrieval.ts:339-343` branches on
`EMBED_UNREACHABLE`, `EMBED_MISCONFIGURED`, and `EMBED_SPACE_MISMATCH` by
exact string, and `retrieval.ts:381-387` deliberately surfaces the
server's `error.message` for those three because the backend copy is
"UI-ready by contract". That contract is asserted in code and honoured
by the backend — but it is documented **only** in
`docs/reasonix/specs/`, not in the file a reader would actually open.
If a backend copy string is ever reworded without updating
`retrievalFailureMessage`'s expectations, nothing catches it.

### D2 — `RETRIEVAL_TOPK` is a dead config knob (polish)

Present in `backend/.env.example` (and in the developer's actual
`backend/.env`) but referenced by **nothing** — not `app/`, not
`scripts/`, not `tests/`, not `docs/`. `topK` is a request field
(`SearchIn.topK`, validated 1–20) that the frontend sets to `10` by
default (`retrieval.ts:253`), and `RETRIEVAL_MAX_CHARS` *is* read
(`routers/retrieval.py:43-47`). Either wire `RETRIEVAL_TOPK` as a
server-side default for requests that omit it, or drop it from the
template.

---

## 5. P. Polish

### P1 — 26 exports in `frontend/src/lib` have no external consumer (polish)

Cross-referencing every `export` in `lib/` against all of `src/`,
`tests/`, and `e2e/`: 26 names appear nowhere outside their defining
file. Several are used *internally* by their own module, so this is
surface hygiene rather than dead code — `retrieval.ts::RETRIEVAL_SCOPES`
is used by `retrievalScopeForText`, and `apiRetrievalHealth` by
`useRetrievalHealth`. The interesting subset is where a name is dead
*and* looks load-bearing:

- `chat-sync.ts::apiListChats`, `apiListMessages`, `apiClearChats` — the
  non-paged convenience wrappers. Only the `*Page` variants are called.
  Keeping both invites a caller to pick the one that cannot count.
- `session.ts::renameCustomChat`, `checkStorageHealth`,
  `clearChatSnapshotKeys`, `createCustomChat`
- `auth.ts::apiGetAccounts` — while `useAccounts()` is wired, the
  imperative fetch is not.
- `outbox.ts::requestOutboxFlush`, `OUTBOX_RATE_BACKOFF_MS`,
  `OUTBOX_LEASE_TTL_MS`, `OUTBOX_FLUSH_CHANNEL` — the last two are
  documented tuning constants; having them exported and unconsumed
  suggests a flush path reads them from somewhere I did not trace, or
  that they were tuned for a caller that never landed.

`docs/audits/2026-09-14-dead-code-rerun.md` is the prior run of this
check; the 2026-09-16 Section-M close-out lists **B37** and **B38** as
the only open app-code items, so this is the same backlog, not news.

### P2 — `read_through` stores dicts, so a `{data, pagination}` list is cached verbatim (polish, correct)

`app/cache.py:450-471` caches only plain-dict 200s. Both
`list_chats` and `list_messages` return exactly that, so the whole
envelope — including `pagination.total` — is cached for 30 s / 60 s. A
message appended in another tab is therefore invisible to this tab's
list for up to a minute, unless the append's own invalidation lands
(which it does for the writer, not for other readers). This is the
documented trade-off of the cache spec and the frontend already has
`shouldForegroundRefetch` to re-read on return. Noting it only so the
eventual "my message appeared late on another tab" report is traceable
to the 60 s TTL rather than to a lost write.

---

## 6. Checked and cleared

- **No hand-rolled URLs in the client.** Every backend call goes through
  `apiFetch`; the only raw `fetch` is the `/api/link-password`
  same-origin Astro route (correct — it needs BetterAuth's
  `serverOnly` `setPassword`, which the backend docstring explains a
  proxy can only ever 404) and `apiFetch` itself.
- **Casing and envelope discipline hold end to end.** `camelCase` out,
  `camelCase` in, `snake_case` only for `from_seq` and the retrieval
  bundle's deliberately verbatim fields — the frontend mirrors this in
  `RetrievalBundleItem` with a comment saying "verbatim".
- **Guest path makes zero fetches.** `tests/setting-shaping.test.ts`
  pins "guest save is memory-only: zero fetches, instant local value",
  and the unit output confirms it. The login-gate contract holds.
- **Retrieval error → surface mapping is total.** `classifyRetrievalFailure`
  returns exactly one of `bar` / `composer` / `none` for every input
  class, including the unexpected — no unhandled branch.
- **`outbox` is bounded and honest.** `MAX_OPS` 200 with visible
  `evicted` count, `MAX_ATTEMPTS` 5 before `failed-fatal`, a
  cross-tab lease that never holds across network I/O, and a stated
  rationale for why a concurrent double-flush is *safe* rather than
  merely unlikely (the idempotency key makes the server dedupe). Rarely
  is a race documented this well.
- **The 2026-09-28 backend audit's O1** (`TRUSTED_PROXY_HOSTS` missing
  from `backend/.env.example`) is a *backend* setup gap, but its blast
  radius lands here: shared rate-limit buckets mean a busy user can lock
  out every other user's chat writes. Tracked in the backend report.

---

## 7. This audit's own limits

Static plus unit tests and a production build. **Not** verified: any
request crossing a real network, any browser paint, any real Postgres
row, any real embedding provider. In particular I did not confirm that
`astro check` was ever green before the `Locals` errors were introduced
— I can only say it is red now, on 30 committed errors, and that CI
runs it as a required step. The uncommitted
`e2e/section-n-retrieval-display.spec.ts` (8 of the 38 errors) is
someone's in-flight work; I read it only to attribute the count and
changed nothing.

Two claims are inferences I could not close locally: that the CI
`frontend` job is therefore currently failing (it follows from
`npm run astro -- check` exiting 1, but an actual run is the proof), and
that `astro build` succeeding despite 30 type errors is expected (it is —
Astro does not typecheck during build — but it means the build gate
gives no type safety at all).

---

## 8. Recommended order

1. **G1** — add `src/env.d.ts` (14 errors, and it pins the
   three-state `Locals` invariant the gate depends on), then the e2e
   typings and `audit-auth.ts`. Until the type gate is green, a new
   error is invisible.
2. **G2** — relocate or delete `frontend/audit-auth.ts`; demote
   `@typesafe-ai/sdk` to `devDependency`.
3. **D1** — bring `docs/API.md` to 25 operations, and put the three
   retrieval incident codes plus their copy contract in it, since
   `retrieval.ts` depends on both by string.
4. **I1** — record the inference-path decision (SSE contract, what
   replaces `planResponse`, which of the ~200 Section-M proofs survive)
   before the first streaming endpoint is written.
5. **W1/W2** — answer the self-service question: ship the demo-override
   and export UIs, or mark both endpoints deferred in `docs/API.md`.
6. **D2, P1** — the housekeeping tail.
