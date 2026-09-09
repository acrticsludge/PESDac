# Muse Spark implementation prompt: backend error-copy safety audit

You are Muse Spark auditing in the PESDac repository. Work through the plan one task at a time on medium reasoning. Read these first, in order:

- `AGENTS.md`
- `docs/reasonix/specs/error-copy-safety-audit.md`
- `docs/reasonix/plans/error-copy-safety-audit-plan.md`
- `backend/app/schemas/common.py` (the envelope)
- `frontend/src/lib/auth.ts:107-151` (`toUserMessage` — read-only reference for exposure mapping)

Key source files (open them before classifying):

- `backend/app/rate_limit.py:84-105`, `backend/app/deps.py:106-164`, `backend/app/main.py:75-128`
- `backend/app/routers/chats.py:60-135`, `backend/app/routers/demo_state.py:30-50`, `backend/app/routers/health.py:20-40`

Before touching code, run `git status --short`. Existing modified/untracked files belong to the user or another run. Do not reset, clean, checkout, overwrite, or commit them.

## Mission

Inventory all user-reachable backend error strings, classify each SAFE/CONFUSING/LEAK, fix LEAKs with pinned tests, and report the rest with proposed copy. Start with T1 (read-only). After each task, stop and report; continue only when that task's acceptance criteria are satisfied.

## Hard constraints

- Copy-only diffs: same status, same code, same envelope. A finding that needs anything more becomes a written recommendation, never a commit.
- CONFUSING findings are proposals, not edits. Only LEAK gets fixed in-branch, and only after T1's exposure column justifies it.
- Never paste real user data, secrets, tokens, or full log lines into code, tests, or reports. Synthetic fixtures only.
- Do not touch the frontend (no `auth.ts`, no components, no tests). If a finding seems to need a UI change, report it and stop that thread.
- Do not add dependencies, migrations, endpoints, or logging infrastructure.
- Work on a new branch `fix/error-copy-safety` (create it once with `git checkout -b`). Never touch main. Do not commit, push, or reset files.
- Do not make a task larger than five touched files. Split it if necessary.
- Fail closed: any string you cannot prove SAFE is LEAK until proven otherwise — but LEAK fixes still only change copy, never flow.

## Required working method

Work in task order T1-T3 from the plan. T1 is read-only: no edits of any kind, only the task report. For every task use this report structure:

```text
Task: T_
Evidence observed:
Files inspected:
Files changed:
Acceptance criteria completed:
Commands/tests run:
Failures or warnings:
Next action:
```

If blocked, do not improvise. Report the exact blocker and the smallest safe options.

## Task-by-task guardrails

### T1 — inventory, no edits

- Grep `error_body\(`, `HTTPException(`, and `details=` across `backend/app`. Reconcile every hit against the spec §6 FR1 table; report any 12th site with file:line and audit it in T2.
- For the 422 `details` verdict, generate a REAL payload with the test client (synthetic bad body) and paste its structure. Judge `loc`/`msg`/`type`/`input`/`ctx` key by key.
- Trace each site to its UI exposure: which `toUserMessage` branch shows it (4xx message / 404 generic / 5xx generic / never). Site #10 (`UNHEALTHY`) needs an explicit reachable-or-not verdict.
- Check whether any frontend code reads `error.details` before T2 touches #4 (if yes: redaction preserves consumed keys, or T2 stops for approval).

### T2 — classify and fix LEAKs only

- One-line justification per site, using the rubric words (LEAK/CONFUSING/SAFE), no essays.
- Each LEAK fix: same code+status, new message only; contract test asserting exact code + message; for #4, assert redacted keys ABSENT (never snapshot the whole payload).
- Verify the server log path for each touched site still emits diagnostics (read, don't modify).
- CONFUSING proposals go in the report with before/after strings. Do not apply them.

### T3 — lock and report

- `python -m pytest -q` green; `git diff --check` clean; `git status --short` shows backend-only diffs.
- Optional site-count guard test ONLY if robust without snapshotting messages or mocking internals. When in doubt, skip it and say why.
- Final report is the deliverable: verdict table, before/after strings, log-parity notes, CONFUSING proposals, residual risks.

## Commands to run

From `backend/`:

```powershell
python -m pytest -q
```

From the repository root:

```powershell
git diff --check
git status --short
```

Paste exact failing command + error if anything fails; do not weaken tests or suppress warnings to pass. No frontend commands are expected (no frontend diffs); if `git status` shows any, stop and explain before proceeding.

## Acceptance checklist

- T1-T3 completed in order, or deviations explained.
- Inventory proven complete via documented greps; real 422 `details` sample captured.
- Zero LEAK rows open; every fix pinned by a contract test; log parity confirmed per touched site.
- CONFUSING findings proposed, not applied.
- Backend suite green; diff-check clean; frontend untouched.
- Final verdict table filed with residual risks.

## Final response format

Report:

1. per-site verdict table (site, code, verdict, one-line justification);
2. LEAK fixes with before/after strings and pinning tests;
3. CONFUSING proposals with replacement copy;
4. log-parity confirmation per touched site;
5. residual risks and recommended follow-ups.
