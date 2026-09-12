# P5 — Optimistic outbox (session prompt)

```text
You are running Phase 5 of docs/reasonix/plans/api-latency-outbox-plan.md (T5-pre, T5a, T5b, T5c, T5d).
Context: docs/reasonix/specs/api-latency-outbox-build-spec.md §5. Repo root: C:\Anubhav\Web Dev Projects\PESDac.

Branch: create `sess/p5-outbox` from current main. Never pull/merge any other sess/* branch. You merge LAST: after P4 merges, rebase onto main, re-point your migration's down_revision onto `20260912_perf_indexes`, re-run everything, then report.

SKILLS TO USE: using-agent-skills, api-and-interface-design, test-driven-development, deprecation-and-migration (you ship a migration), frontend-ui-engineering, browser-testing-with-devtools, security-and-hardening (XSS/durable-storage review — non-negotiable), performance-optimization, incremental-implementation.

OWNERSHIP (exclusive):
- OWN (backend): the append_message function in backend/app/routers/chats.py ONLY; client-key column in backend/app/models/chats.py; backend/app/schemas/chats.py; ONE migration with revision id exactly `20260912_msg_client_key`; ONE new test file backend/tests/test_message_idempotency.py (use explicit limit= in requests so P4's default change can't break you).
- OWN (frontend): new frontend/src/lib/outbox*.ts files; minimal wiring in frontend/src/lib/chat-sync.ts and frontend/src/components/chat/ThreadView.tsx (extend existing optimistic paint + retryText patterns — NO visual redesign, per AGENTS.md the exported UI is source of truth).
- FORBIDDEN: all other backend files/routes, all existing backend test files (additive-only), all other frontend files. No tokens in durable storage; document the chat-body persistence tradeoff.

TASKS (in order; T5b parallelizable with T5-pre/T5a inside your session):
- T5-pre: slim append path (collapse MAX+COUNT+double-refresh, keep seq race safety). Correct with or without P4's index.
- T5a: clientMsgKey idempotency (unique per chat, return-existing on conflict; key optional so old clients keep working). NOTHING below ships before this.
- T5b: in-memory optimistic queue + per-item pending/sent/failed-retryable/failed-fatal states, inline retry, toasts.
- T5c: durable pending-ops-only outbox in IndexedDB (never localStorage for payloads, never a data mirror); FIFO per chat; create-acks-before-messages; paced flush honoring rate limits/Retry-After and the auth.ts retry taxonomy; flush on online/focus/interval.
- T5d: cross-tab single-flusher, outbox cap + eviction, visible "N unsynced" state.

DONE GATE (ALL must hold, else NOT DONE):
- Backend: `python -m pytest -q` (workdir backend/) → 0 failed, 0 errors, no tracebacks, no new warnings. Drop-connection-mid-append + retry → row count == 1. Migration upgrades AND downgrades cleanly (after re-pointing onto P4's head).
- Frontend: `npm test` green, `npx astro check` → 0 errors, `npm run build` green, browser console → 0 errors on exercised flows (optimistic send, failed send + retry, offline→online drain, reload recovery, two tabs).
- `git status` shows ONLY your owned files. No envelope/status changes.

REPORT BACK exactly: Implemented / Skills activated / Verification (exact commands + results) / Security notes (storage review) / Remaining risks / READY TO MERGE or NOT READY.
```
