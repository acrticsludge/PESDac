# Purge verification (audit §17, §18 retention)

Worker body: `purge_expired_chats(db)` in `backend/app/routers/chats.py`
(no scheduler wired — call it from the nightly runner when one lands).

## Windows

Per `profiles.retention`: `1 year` → 365 d, `30 days` → 30 d,
`forever` → skipped. `session` is RESOLVED (§18): 24h of inactivity —
the stateless backend cannot observe logout/reload, so a nightly wipe
of everything (window 0) would cliff users who chatted hours before
the run; a day untouched approximates "last session". Pinned by
`test_retention_session_means_a_day_of_inactivity`.

## What it does

Per `profiles.retention` window (`1 year` → 365 d, `30 days` → 30 d,
`session` → 0 d, `forever` → skipped): chunked bulk DELETEs of messages
then chats with the cutoff in the WHERE clause. Returns
`{retention: deleted}` for windows that had users. Single-runner lock
via `cache.acquire_lock("purge", …)` / release (see the function
docstring — plain DEL is safe here, do not copy the pattern to
high-contention paths).

## Verifying a run (dry-run + metrics first, per §18)

1. Dry-run: run with a disposable read replica or transaction rollback
   and record `{retention: would-delete}` per window — never first-run
   against prod.
2. Real run: capture the returned counts + `db_queries`/latency from
   the timing line; alert if a window deletes 10× its trailing average
   (likely a retention-misconfiguration wave, not organic expiry).
3. Post-run: `GET /users/me/export` for one account per window still
   returns 200 with coherent data; orphan script exits 0 (purge must
   not strand message rows — the worker deletes messages first for
   exactly this reason).
4. `session` means 24h of inactivity (resolved §18 — see Windows
   above). Schedule it like any other window; no special-casing.
