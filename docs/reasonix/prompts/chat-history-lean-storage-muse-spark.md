# Muse Spark implementation prompt: chat history lean storage + ditto history skeletons (3 streams, parallel-safe)

You are Muse Spark implementing in the PESDac repository. Work on medium reasoning. Pick ONE stream below and implement ONLY it. Read these first, in order:

- `AGENTS.md` (Astryx/UI rules in full — Streams B/C touch components; A touches none)
- `docs/reasonix/specs/chat-history-lean-storage.md` (§6 FR1–FR5 is your build order; §9 API shapes are FROZEN)
- `docs/reasonix/plans/chat-history-lean-storage-plan.md` (your stream row + why you never touch other streams' files)
- Installed skills `neon` + `neon-postgres` for ANY database work (branch-first, pooled app vs direct migrations, `neon inspect db` verify). App traffic uses pooled (`DATABASE_URL`); Alembic/dumps use direct (`DATABASE_URL_UNPOOLED`), never pooled.

Before touching code, run `git status --short`. Existing modified/untracked files belong to the user or another run. Do not reset, clean, checkout, overwrite, or commit them. Create your stream branch once with `git checkout -b`. Never touch main. Do not commit, push, or reset files. Max five touched files.

---

## Stream A — backend lean columns + indexes + retention (`feat/chat-history-lean-backend`)

Key files (open before editing): `backend/app/models/chats.py:15-71`, `backend/app/routers/chats.py:32-70,147-228`, `backend/app/schemas/chats.py:14-95`, `backend/alembic/versions/0006_messages.py` (migration style to mirror), `backend/app/models/profiles.py` (retention values only).

Mission: add `preview/msg_count/last_seq` + trigram ordering index + `_out` extension + purge wiring. No frontend edits.

Hard constraints — touch ONLY: `backend/app/models/chats.py` (3 columns), `backend/alembic/versions/0007_chat_preview_counts.py` (new), `backend/app/routers/chats.py` (`_out` + append/truncate txn only), `backend/app/schemas/chats.py` (`ChatOut` only), retention purge in its existing job file (or report location — do NOT invent infra). NEVER touch `frontend/*`, theme, CSS. Migration runs on a Neon branch with the DIRECT url (`neon checkout feat-chat-history-lean`, `neon diff`, upgrade, backfill nullable→backfill→NOT NULL, `neon inspect db table-sizes/index-sizes/seq-scans`). Indexes `CONCURRENTLY` in prod. 100KB cap → 422 unchanged; `(user_id[, code])` scoping + same-404 oracle + origin/rate-limit checks unchanged.

Work in order: (1) migration + models, (2) `_out`/schemas + txn updates, (3) backfill + indexes + purge, (4) gates. Report after each:

```text
Task: A_
Evidence observed:
Files inspected:
Files changed:
Acceptance criteria completed:
Commands/tests run:
Failures or warnings:
Next action:
```

Gates: backend `pytest`, `EXPLAIN` (list hits `ix_chats_user_updated`/trigram, zero body reads), `neon inspect db`, `git diff --check`. Acceptance: AC1/AC2/AC5 + rollback-safe (frontend falls back when fields absent).

## Stream B — frontend write-less + windowed reads (`feat/chat-history-lean-reads`)

Key files (open before editing): `frontend/src/lib/session.ts` (`blockToMessage` strip point only), `frontend/src/lib/chat-sync.ts` (passthrough only), `frontend/src/components/chat/ThreadView.tsx` (history window lines only), `frontend/src/components/Pesdac.tsx` (sidebar/search query lines only).

Mission: strip render-only fields at write; page all history reads; add unit tests. No skeleton-component edits, no backend edits.

Hard constraints — touch ONLY the four files above + `frontend/tests/chat-history-lean.test.ts` (new). NEVER edit `backend/*`, `ChatListSkeleton.tsx`, `ComposerSkeleton.tsx`, `ThreadSkeleton.tsx`, `SkeletonBlock.tsx`, theme, CSS, or ThreadView send/stream/edit/regenerate/vote logic. Strip deletes `time`, `toolCallsExpanded`, `toolCallsAfter`, `error.retryText`, `footer` (render recomputes), empty `followUps[]`; asserts `artifactId`-only + metadata-only attachments. `chat-sync.ts` threads `limit/offset` + `q/subject/archived` through the same `{data, pagination}` envelope. Thread open `limit=50, offset=max(0,total-50)`, scroll-back prepends; sidebar/search use server params + `pagination.total`/`msgCount`; keep `preview` fallback (title-only + full-window) until Stream A lands — never stub backend. Predicates/hydrate/rollback/toast contracts untouched.

Work in order: (1) strip + tests, (2) passthrough, (3) window + query threading, (4) gates. Same `Task: B_` report block as Stream A.

Gates: `npm.cmd test` (new + existing unmodified), `npm.cmd run astro -- check`, `npm.cmd run build`, `git diff --check`. Acceptance: AC1/AC2/AC3 (≤50-body opens, zero-body lists).

## Stream C — ditto history skeletons, reuse only (`feat/chat-history-ditto-skeletons`)

Key files (open before editing): `frontend/src/components/chat/ChatListSkeleton.tsx` (read-only — label-only `140×14`, md slot, reuse as-is), `frontend/src/components/chat/ThreadSkeleton.tsx:19-66` (read-only — 3-turn template, reuse as-is), `frontend/src/components/profile/SkeletonBlock.tsx:17-86` (read-only — `SkeletonRow`/`SkeletonCard`/`SkeletonDivider`, reuse as-is), `frontend/src/components/Pesdac.tsx` (placement lines only), `frontend/src/components/chat/ThreadView.tsx:786-793,1835` (condition lines only), `frontend/src/components/profile/sections.tsx:1123-1153` (History lines only).

Mission: every history loading state lands in its real shell with zero shift — same method as the `/new` sidebar + composer fix. No new placeholders, no component-file edits.

Hard constraints — touch ONLY the three placement files' owned lines above; NEVER edit any skeleton component file, `session.ts`, `chat-sync.ts`, `backend/*`, theme, CSS, or test files. Sidebar: existing `skeletonRows` clamp + `ChatListSkeleton` inside each workspace collapsible `VStack`; never section-level block, never `workspaceCustoms.length`, never leading icon. Thread: `ThreadSkeleton` with `overlay.length === 0` memory-wins + `isHistoryLoading` OR, composer live, toolcall-shape only with proof. Profile: `SkeletonCard History rows=1` + `Your data rows=2` while loading, real `SettingsCard/CardRows/SettingsRow` byte-identical after. Forbidden: bare bars/circles, overlays, modals, spinners, skeletoned toggles/cards. No `typeof window`, no random values.

Work in order: (1) sidebar placement, (2) thread condition, (3) profile lines, (4) gates. Same `Task: C_` report block.

Gates: `npm.cmd test`, `astro check`, `build`, `git diff --check` (placement-only diff), throttled browser proof. Acceptance: AC4 + F5 (guests/demos/ready-empty zero skeletons).

---

## Global guardrails (all streams)

- Spec + plan are FROZEN — defects become file:line reports, never unilateral redesigns. Touching another stream's files → stop and report.
- Synthetic fixtures only; no PII. Cross-user code → same 404. Failure keeps memory paint + one existing toast.
- Paste exact command failures; never weaken tests to pass. Final report: files changed + why, fallback locations (Stream B), `neon inspect`/browser evidence.
