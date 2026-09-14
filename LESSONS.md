# LESSONS.md (audit §17)

Date / category / what happened / root cause / fix / prevention.
New entries append at the top. Operational AND dev-pipeline lessons
both belong here if they cost more than 15 minutes.

## 2026-09-14 — e2e: `fill()` does not drive the Astryx tokenized editor

- Category: testing / Playwright.
- What happened: smoke tests filled the composer and pressed Enter;
  nothing sent, repeatedly, with no error.
- Root cause: the tokenized `ChatComposerInput` ignores programmatic
  `fill()` (no input pipeline runs). Tests must type trusted
  keystrokes (`pressSequentially`) like a user.
- Fix: `typeAndSend` helper in `e2e/smoke.spec.ts`.
- Prevention: any future composer-driving test copies `typeAndSend`;
  never `fill()` a contenteditable editor.

## 2026-09-14 — e2e: builds bake `PUBLIC_*`; serving port must match

- Category: testing / env.
- What happened: smoke run failed with CORS-blocked `get-session` —
  looked like an app bug.
- Root cause: spec used `127.0.0.1` while the app was built for
  `localhost` (and later, preview port ≠ baked origin). `PUBLIC_*`
  bake at build time; a mismatch is always a rebuild, never headers.
- Fix: `test:e2e` pins `PUBLIC_BETTER_AUTH_URL` to the preview origin
  (`test:e2e:build`); config documents the invariant.
- Prevention: `docs/operations/stale-recovery.md` step 4.

## 2026-09-14 — backend: TestClient default re-raises handled 500s

- Category: testing / FastAPI.
- What happened: a commit-outage test asserting the 500 envelope got
  the raw exception instead.
- Root cause: `TestClient(raise_server_exceptions=True)` (the default)
  re-raises even though the global handler converts to a response.
  The route was correct; the harness was wrong.
- Fix: module-local non-raising `soft_client` fixture for
  handler-shape assertions; default client stays raising (unhandled
  bugs must keep failing loudly).
- Prevention: 500-envelope tests always use a non-raising client.

## 2026-09-14 — backend: sqlite cannot thread, full stop

- Category: testing / infra limits.
- What happened: a 20-thread read-burst test failed with
  `InterfaceError` on the shared sqlite connection.
- Root cause: by construction (single shared connection) — not a bug,
  a harness limit. Pool/stampede proof needs staging Postgres.
- Fix: deleted the test; recorded the limit in §13.
- Prevention: no threaded tests against sqlite, ever.

## 2026-09-14 — backend: silent truncation is a validation bug

- Category: correctness.
- What happened: a 35-char chat title returned 201 — `clean_title`
  clipped to 34 while the schema message promised rejection.
- Root cause: trim-then-clip helper written for guest-local (memory)
  use got reused on the server path, where persistence makes silence
  into data loss.
- Fix: server rejects overlong (422); guest-local truncation stays.
- Prevention: helpers shared across persistence boundaries get a
  comment stating which side's contract they serve.

## 2026-09-14 — flake watch: `test_error_logging.py::test_500…`

- Category: flaky gate.
- What happened: intermittent ERROR in full-suite runs (~1 in 3),
  always green alone and on retry; predates all backend changes.
- Root cause: UNKNOWN (under investigation — suspected
  lifespan/warmup timing under load).
- Fix: none yet; behavior redundantly pinned by the deterministic
  commit-outage test.
- Prevention: quarantine-or-fix when CI (§20) shows whether it is
  machine-specific. Do not mask it.
