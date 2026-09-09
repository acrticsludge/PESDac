# Plan: backend error-copy safety audit

Spec: `docs/reasonix/specs/error-copy-safety-audit.md`
Status: Proposed
Branch rule: create `fix/error-copy-safety` from main; never commit to main; do not push/commit unless the user explicitly asks.

## Task list (vertical slices, in order)

### T1 — Inventory (read-only)

- Objective: prove the §6 FR1 table is complete; capture exact strings + exposure.
- Areas: `backend/app/**` (grep `error_body\(`, `HTTPException(`, `details=`), `frontend/src/lib/auth.ts` (`toUserMessage` exposure mapping, read-only reference).
- Steps:
  1. `git status --short` (do not touch unrelated modifications).
  2. Repo-wide greps; diff the results against the spec table. Any 12th site -> amend the table in the task report (not the spec) and audit it too.
  3. For each site record: file:line, status, code, exact message, which UI path can surface it (toast via `toUserMessage` 4xx branch / field / never-exposed like #10?), and what the server log carries for the same event.
  4. Pay special attention to #4: capture a REAL `exc.errors()` payload shape for a representative bad body (test client, synthetic data) — the `details` verdict needs the true structure, not memory.
- Acceptance: complete site table with exposure + log columns; real 422 `details` sample pasted (synthetic input only).
- Verification: grep outputs + sample payload in the task report.
- Rollback: n/a (read-only).

### T2 — Classify + fix LEAKs

- Objective: apply the §6 FR2 rubric; fix LEAK findings with pinned tests.
- Files: only files containing LEAK findings (expected 0-3 files) + `backend/tests/` additions.
- Changes per LEAK site:
  1. Replace ONLY the `message` (and redact `details` keys for #4) — same code, status, envelope.
  2. Add/extend a contract test asserting exact code + message (+ redacted `details` key set; assert ABSENCE of the redacted keys, not a full snapshot).
  3. Confirm the server log for that path still carries diagnostics (read the logger call; no log edits unless a fix accidentally silences one — then restore).
- CONFUSING sites: write proposed replacement copy in the report; DO NOT apply without human approval.
- Acceptance: zero LEAK rows left open; every fix has a pinning test; AC4 proposals written.
- Verification: `python -m pytest -q` from `backend/`.
- Rollback: revert the touched app + test files; copy returns verbatim.
- Dependencies: T1 (no classification without the exposure column).

### T3 — Lock, report, optional site-count guard

- Objective: file the audit record; optionally future-proof it.
- Files: task report (chat) + optionally one guard test.
- Steps:
  1. Full `python -m pytest -q`; `git diff --check`; `git status --short` proving zero frontend diffs (or justifying any, which should be none).
  2. Optionally add the (path, code) site-count guard test — only if it can be written without mocking internals or snapshotting messages (brittle guards are worse than none; say no if unsure).
  3. Final report: per-site verdict table, fixes with before/after strings, log-parity notes, CONFUSING proposals, residual risks.
- Acceptance: AC1-AC6 checked; report filed.
- Rollback: revert guard test independently if added.
- Dependencies: T2.

## Dependency order

```text
T1 (inventory + exposure + real details sample)
 └─ T2 (classify + fix LEAKs + pinning tests)
     └─ T3 (full gates + report [+ optional guard])
```

Strictly serial; classification without exposure data is guessing.

## File touch budget

- Max five touched source files (expected: only LEAK-site files + tests). Copy-only. Any finding that wants a status/envelope/flow change exits to recommendations. Exceeding budget means the audit found a redesign — stop and report.

## Risks

- Over-fixing tone: CONFUSING vs LEAK is a judgment call; the plan biases to report-and-propose over rewrite. When in doubt, classify CONFUSING and let the human decide.
- `details` redaction breaking a UI consumer: grep frontend for `details` consumption before changing #4's shape (if any UI reads `error.details`, the redaction must preserve the consumed keys or the plan stops for approval).
- Brittle guard test: a site-count test that breaks on every legitimate addition trains people to delete it. Only add if robust.
