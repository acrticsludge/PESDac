# Orphan reconciliation (audit §17, §7 item 3)

Source of truth: `backend/app/orphans.py` + `backend/scripts/check_orphans.py`.

## Run

`cd backend && python scripts/check_orphans.py` with `DATABASE_URL` set
(read-only — the module never issues DDL). Exits 0 clean, 1 true
orphans, 2 config/connection failure. Until the §14 scheduler exists,
run on demand (and from CI in §20).

## Reading the report

- `INFO identity-without-app-row` — transient by design (backend-first,
  identity-second delete leaves this gap; next login re-provisions via
  the `/auth/me` upsert). Action: none, unless the SAME id persists
  across weeks (then the upsert path is broken — escalate to an
  incident, do not hand-fix rows).
- `ACTION app-row-without-identity` — no valid JWT can ever map to
  these rows again. Action: confirm the BetterAuth user is really gone
  (dashboard), then delete the app row(s) by `auth_user_id` manually
  (auto-delete needs a product decision — the script reports only).
  Verify after: re-run the script (exit 0) + spot-check the export for
  a sibling account is unaffected.

## Scheduling

Nightly when the §14 scheduler lands (dry-run + metrics first). The
exit codes are CI-ready today.
