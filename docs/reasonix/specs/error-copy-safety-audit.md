# Spec: backend error-copy safety audit (post-R3 surfacing)

Status: Proposed
Audit basis: R3 fix in `3c442c7` follow-up (`apiFetch` now unwraps the nested `{error:{code,message}}` envelope) — backend 4xx messages display in-app for the first time instead of degrading to HTTP reason phrases. None of the ~10 `error_body` sites were ever reviewed for user-facing safety, because they were effectively invisible.
Stack: FastAPI backend (`app/schemas/common.py:error_body`); Astro/React frontend (`toUserMessage`, `ApiError`).

## 1. Problem

Every backend 4xx message now reaches users' eyes. These strings were authored as operator-facing copy with no safety review: they may leak internals (paths, table/column names, validation internals), confuse (raw Pydantic phrasing via `details`), or mislead (stale copy from an earlier design). One confirmed-adjacent smell already: `main.py` attaches raw `exc.errors()` as `details` on 422s.

## 2. Users

- All signed-in users hitting any backend 4xx (validation, origin-denied, rate-limited, not-found, conflicts, unhealthy).
- Operators (server logs must retain diagnosability after any copy change — never fix user copy by deleting log context).

## 3. Goals

1. Inventory all 11 user-reachable message sites (table in §6 FR1) with their codes, exact strings, HTTP statuses, and UI exposure paths.
2. Classify each against the §6 FR2 rubric: SAFE (user-actionable, no internals) / CONFUSING (shows but misleads) / LEAK (exposes internals).
3. Fix LEAK findings in-branch with regression tests pinning the new copy; file CONFUSING findings as recommendations with proposed replacement copy (no drive-by rewrites of merely-awkward strings without human approval — copy tone is a product decision).
4. Prove log-side diagnosability is unchanged for every touched site.

## 4. Non-goals

- No status-code, envelope-shape, or control-flow change. Copy strings only (plus tests).
- No frontend `toUserMessage`/fallback change (already correct: 404/5xx generic, 4xx server message).
- No 5xx copy change (generic by design; `main.py:_internal` ref-ID scheme stays).
- No new dependencies, schema, migration, or endpoint.

## 5. User flows

### F1: Representative 4xx exposure (unchanged mechanics, reviewed copy)

1. User triggers e.g. short password on a backend-validated route / cross-origin mutation / rate limit / missing chat.
2. Toast/field shows the reviewed string; nothing in it names tables, columns, file paths, exception types, SQL, or raw validator internals.

### F2: 422 details review

1. Invalid body -> 422 `VALIDATION_ERROR` "Invalid request." (message stays).
2. `details` payload is audited field-by-field: Pydantic `loc`/`msg`/`type` are structural, but `ctx` values and `input` echoes may repeat user input or internals — verdict + redaction per field, with a test pinning the redacted shape.

## 6. Functional requirements

### FR1: Inventory (exact sites; T1 confirms nothing missed via repo-wide `error_body` + `HTTPException(` grep)

| # | Site | Status | Code | Current message |
|---|---|---|---|---|
| 1 | `rate_limit.py:99` | 429 | RATE_LIMITED | "Too many attempts. Try again later." (+ `Retry-After` header) |
| 2 | `deps.py:151` | 403 | FORBIDDEN | "Origin not allowed." |
| 3 | `deps.py:162` | 403 | FORBIDDEN | "Origin not allowed." (referer leg) |
| 4 | `main.py:84` | 422 | VALIDATION_ERROR | "Invalid request." + `details=exc.errors()` |
| 5 | `main.py:104` | mapped | envelope translation of `HTTPException.detail` | caller-supplied detail string |
| 6 | `main.py:125` | 500 | INTERNAL | generic + ref (out of scope, control case) |
| 7 | `chats.py:82` | 409 | CODE_COLLISION | "Could not allocate a chat code. Retry." |
| 8 | `chats.py:91,113` | 404 | NOT_FOUND | "Chat not found." |
| 9 | `demo_state.py:42` | 422 | VALIDATION_ERROR | "Unknown demo conversation." |
| 10 | `health.py:33` | 503 | UNHEALTHY | "Database unavailable." (likely untriggered in UI; confirm exposure) |
| 11 | `common.py:15-16` | consts | INTERNAL / UNAUTHORIZED | "Something went wrong." / "Authentication required." (confirm each const's use sites) |

### FR2: Rubric

- LEAK: names a table/column/file/exception/SQL fragment/socket detail; echoes raw input beyond the user's own typed value; exposes a stack/ctx object. MUST fix in-branch.
- CONFUSING: technically safe but misleading or dead-wrong in context (e.g. operator copy like "restart the server" — banned by prior spec; stale references to removed flows). Propose replacement; fix only with human approval.
- SAFE: actionable, no internals, matches the UI situation. Pin with a test so future edits can't silently degrade it.

### FR3: Fix discipline (LEAK only, in-branch)

- Replacement copy stays in the same envelope/code/status; only the `message` (and `details` shape for #4) changes.
- Every changed string gets a contract test asserting exact code + message (+ redacted `details` shape where applicable).
- Server logs for the same paths keep full diagnostic context (assert log emission unchanged where a logger exists; where none exists, do NOT add logging infra — note it).

## 7. Acceptance criteria

- [ ] AC1: Inventory table complete; repo-wide grep proves no 12th site (document the grep + output).
- [ ] AC2: Every site classified SAFE/CONFUSING/LEAK with one-line justification each.
- [ ] AC3: Zero LEAK findings remain (fixed + test-pinned, or proven absent).
- [ ] AC4: CONFUSING findings have proposed replacement copy in the report; none applied without approval.
- [ ] AC5: `python -m pytest -q` green; no frontend diffs (audit is backend-copy-only unless a finding forces a UI note — then report, don't drift).
- [ ] AC6: Log-side diagnosability unchanged (per-site note).

## 8. Constraints

- Copy-only diffs. If a finding tempts a status/envelope/flow change, it becomes a recommendation, not a commit.
- Never paste real user data, secrets, or full log lines into docs/tests; synthetic fixtures only.
- Work on `fix/error-copy-safety` from main; no commit/push unless asked.
- This is an audit with tightly-scoped fixes: if LEAK fixes exceed ~5 files, split and report rather than sprawling.

## 9. API / interface requirements

- No status/code/envelope change. Response shapes byte-identical except reviewed `message` strings (and #4 `details` redaction, which is a documented shape change with a pinning test).

## 10. Data requirements

- None. No schema/migration.

## 11. Security requirements

- The audit IS the security control for this surface: fail closed (any doubtful string is LEAK until proven SAFE).
- `details` on 422 must not echo raw request bodies, headers, or cookies; Pydantic `input`/`ctx` get explicit verdicts.
- No test may assert on, print, or snapshot real request data.

## 12. Testing requirements

- Backend contract tests per changed string (exact code + message); a `details`-shape test for #4 (redacted keys enumerated, no open-ended snapshot).
- A repo-wide site-count test is encouraged (e.g. assert the inventoried set of (path, code) pairs) so future `error_body` additions force an audit entry — implement only if it stays robust, not brittle.
- Browser: none required (copy surfaces through existing toast paths already covered); a visual pass of one fixed string is nice-to-have, not acceptance.

## 13. Rollout / rollback

- Rollout: backend-only, copy strings. No flag/migration. Safe to ship with any frontend (older frontends already parse the envelope).
- Rollback: revert branch; previous strings return. No data impact.
