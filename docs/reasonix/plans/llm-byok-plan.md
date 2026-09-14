# Plan: LLM BYOK — spec `llm-byok-settings.md`

## Source of truth

`docs/reasonix/specs/llm-byok-settings.md` (Status: Proposed).
What it mandates: `llm_credentials` table (Fernet, never return the
key), `GET /llm/status` + `PUT /llm/key` (validate via OpenRouter
`/models`) + `DELETE /llm/key`, separate `SettingsDialog`, onboarding
key slot (skippable, warning `Banner`), gating `Banner`s on `/new`
and in threads (drafts kept, guests get login CTA). Keys + gating
only — no completions wiring.

## Stack / commands (discovered — use exactly these)

- Backend: Python 3.12+, FastAPI + sync SQLAlchemy 2.x, pytest 9.
  No venv, no wrapper — plain `python`.
- Focused tests: `cd backend && python -m pytest tests/test_llm_contract.py`
- Full suite: `cd backend && python -m pytest` (currently ~154, must stay green).
- Frontend lib tests: `cd frontend && npm test`
  (`node --test --experimental-transform-types tests/*.test.ts`).
- **Do NOT commit.** Leave all changes uncommitted for human review
  (overrides any skill default about committing per increment).

## Pre-verified against installed deps (no tasks needed)

- `TextInput` supports `type="password"` (`TextInputType =
  'text'|'password'|'email'`, `@astryxdesign/core@0.5.2`).
- `Banner` actions go in `endContent?: ReactNode` (Astryx `Button`s),
  dismiss via `onDismiss` + `dismissLabel?`, `status` includes
  `warning`/`error`, `container: card|section`.
- There is **no `Drawer`** in core 0.5.2 — `Banner` is the agreed
  equivalent (spec §1).

## Dependency graph

```
pyproject (cryptography, httpx promotion) + config/env
    │
    ├── migration 0010 + models/llm.py
    │       │
    │       ├── llm_crypto.py ── unit tests
    │       │
    │       └── schemas/llm.py → routers/llm.py ── contract tests
    │               │
    │               └── frontend lib/llm.ts (client + useLlmStatus) ── lib tests
    │                       │
    │                       ├── SettingsDialog + sidebar rewire (+ dot)
    │                       ├── onboarding slot
    │                       └── gating banners (/new + thread + guest)
    │
    └── docs (.env.example wording, ops rotation note)
```

Order is bottom-up; slices stay vertical (each phase leaves the app
working, zero behavior delta until Phase 4 mounts UI).

## Phase 0 — risk-first probe (no app code)

### Task 0: prove OpenRouter shape + httpx runtime (XS, 0 repo files)

**Description:** Two unknowns underpin Phase 2: the live
`GET https://openrouter.ai/api/v1/models` success/error shapes, and
whether `httpx` (currently only in `pyproject.toml` test extras, yet
imported by `app/cache.py`) exists at runtime. Prove both with a
throwaway script in the OS temp dir (never in the repo): bogus-key
call must return 401 (proves error mapping without secrets), and
`import httpx` outside pytest must succeed or fail loudly.

**Acceptance criteria:**
- [ ] Bogus-key `/models` call observed: 401 shape recorded, timeout
  behavior sane (< 5 s cap viable).
- [ ] Runtime `httpx` present/absent verdict written back into Task 1
  (promote to main deps vs already fine).
- [ ] Any shape drift vs spec §4.2 written back into the spec BEFORE
  Phase 1 starts.

**Verification:** script exits 0; spec updated if drift found.
**Dependencies:** None.
**Files likely touched:** none in repo.
**Estimated scope:** XS.

### Checkpoint: probe green → external contract proven, else stop.

## Phase 1 — backend foundation (dark: no behavior change)

### Task 1: deps + config + `.env.example` (S, 3 files)

**Description:** Add `cryptography` to `pyproject.toml` main
dependencies (and promote `httpx` iff Task 0 says absent — it is
already imported by `cache.py`, so this is a latent fix, not scope
creep). Read optional `LLM_KEY_ENCRYPTION_KEY` in `config.py`;
`validate_startup` requires a 32-byte value only when `ENV=prod`.
Document the name only in `backend/.env.example`.

**Acceptance criteria:**
- [ ] Var readable via `config`, `None` when unset; prod validation
  rejects missing/short values, dev/test boot untouched.
- [ ] Full suite green with var unset.

**Verification:** full backend suite.
**Dependencies:** Task 0.
**Files likely touched:** `backend/pyproject.toml`,
`backend/app/config.py`, `backend/.env.example`.
**Estimated scope:** S.

### Task 2: migration 0010 + `models/llm.py` (S, 2 files)

**Description:** Alembic migration `0010_llm_credentials.py` creating
`llm_credentials` per spec §4.1 (`user_id` FK→users, unique per
provider; `provider TEXT`; `key_encrypted`; `key_hint CHAR(4)`;
`model`; `validated_at`; `updated_at`), plus the SQLAlchemy model
following the `models/users.py` FK idiom. No router imports this yet.

**Acceptance criteria:**
- [ ] `alembic upgrade head` applies cleanly on a scratch DB; downgrade
  drops the table.
- [ ] Full suite green, zero behavior delta (`git status` shows only
  Phase-1 files).

**Verification:** `alembic upgrade head` + `downgrade -1` + full suite.
**Dependencies:** Task 1.
**Files likely touched:** `backend/alembic/versions/0010_llm_credentials.py`,
`backend/app/models/llm.py` (+ `models/__init__.py` import).
**Estimated scope:** S.

### Task 3: `llm_crypto.py` + unit tests (S, 2 files)

**Description:** Thin Fernet wrapper (`encrypt->str`,
`decrypt->str`, fail-closed raising a typed error the router maps to
500-ref). Hand-rolled tests, no new test deps: round-trip, wrong-key
fails closed, empty input rejected, decrypt-failure path returns the
"re-enter your key" signal (never the exception text).

**Acceptance criteria:**
- [ ] Round-trip green; tampered token / wrong env key → typed failure,
  no secret material in the message.
- [ ] No router imports this yet.

**Verification:** `python -m pytest tests/test_llm_crypto.py` (new, green).
**Dependencies:** Task 1 (Task 2 not required — pure function).
**Files likely touched:** `backend/app/llm_crypto.py` (new),
`backend/tests/test_llm_crypto.py` (new).
**Estimated scope:** S.

### Checkpoint: foundation
- [ ] Full suite green; no endpoint or UI behavior changed.
- [ ] Human review before endpoints (crypto + migration are one-way doors).

## Phase 2 — endpoints, one route per task (TDD each: RED test → GREEN wiring)

Rule for all three: never log keys/hints; never return the key;
`error_body` envelopes; origin check + rate limit on mutations.

### Task 4: `GET /llm/status` (S, 2 files)

**Description:** Read-only status per spec §4.2 (`configured`,
`provider`, `keyHint`, `model`, `validatedAt`; `configured:false`
when absent or undecryptable). New `schemas/llm.py` (out-shape) and
`routers/llm.py` skeleton; include router in `main.py`. Uncached by
design (D5) — no cache imports.

**Acceptance criteria:**
- [ ] Empty → `configured:false`; seeded row → hint/model shown, key
  absent from body (assert `"sk-or" not in body`).
- [ ] Undecryptable row (wrong env key) → `configured:false`, no 500.

**Verification:** `python -m pytest tests/test_llm_contract.py` + full suite.
**Dependencies:** Tasks 2, 3.
**Files likely touched:** `backend/app/schemas/llm.py` (new),
`backend/app/routers/llm.py` (new), `backend/app/main.py`,
`backend/tests/test_llm_contract.py` (new).
**Estimated scope:** S.

### Task 5: `PUT /llm/key` + OpenRouter validation (M, 2 files)

**Description:** Strict bucket `llm-key-save` 10/300, origin check,
pre-call guards (provider==`openrouter`, key 1–500 chars, model
1–120 chars — zero outbound calls on rejection), then sync
`httpx.Client` (5 s timeout, mirrors `cache.py` singleton pattern)
`GET /models`. 200 → encrypt+upsert, return status shape. Map
401/403 → 400 `LLM_KEY_INVALID`; timeout/5xx → 502
`LLM_UNREACHABLE` (nothing stored); crypto-unset → 503
`LLM_CRYPTO_UNAVAILABLE`. Mock `httpx` at the boundary in tests.

**Acceptance criteria:**
- [ ] Invalid key → 400, **no row written** (asserted).
- [ ] Valid key → row written Fernet-encrypted (raw key absent from
  DB value), status shows `••••hint`.
- [ ] Oversize key → rejected with zero outbound calls (mock asserts
  uncalled).
- [ ] 11th call in 5 min → 429 `RATE_LIMITED` with `Retry-After`.

**Verification:** focused contract file + full suite.
**Dependencies:** Task 4 (same files, sequential to avoid merge pain).
**Files likely touched:** `backend/app/routers/llm.py`,
`backend/tests/test_llm_contract.py`.
**Estimated scope:** M.

### Task 6: `DELETE /llm/key` (S, 1–2 files)

**Description:** Idempotent delete (T22: 204 whether or not a row
existed), origin check + 60/60 bucket. Status flips to
`configured:false` immediately (no cache to invalidate by design).

**Acceptance criteria:**
- [ ] Delete twice → 204 both times; status empty after.
- [ ] Per-user isolation: A's delete never touches B's row.

**Verification:** focused contract file + full suite.
**Dependencies:** Task 5.
**Files likely touched:** `backend/app/routers/llm.py`,
`backend/tests/test_llm_contract.py`.
**Estimated scope:** S.

### Checkpoint: API complete
- [ ] Full suite green; `GET /profiles/me` body contains no key fields
  (regression test for D1).
- [ ] Live dev check with real key once: save → status hint → delete.
- [ ] Human review before frontend (contract frozen here — frontend
  builds against it).

## Phase 3 — frontend data layer

### Task 7: `lib/llm.ts` client + `useLlmStatus` (M, 2 files)

**Description:** `apiLlmStatus/Save/Delete` wrappers reusing `apiFetch`
conventions (credentials, `toUserMessage` errors — never the profile
cache path), plus the identity-scoped `useLlmStatus()` hook
(`unknown|ready|unconfigured|invalid|degraded`, `refresh()`),
auth-epoch-gated like `auth.ts` TaggedCaches. `unknown` passes gates
open (never block on a fetch). Pure helpers (hint masking, state
derivation) covered by lib tests.

**Acceptance criteria:**
- [ ] Hook returns `unknown` pre-fetch, converges on status, refreshes
  after save/delete; user-switch reseeds (no cross-identity leak).
- [ ] Key never held in hook state beyond the save call argument.

**Verification:** `cd frontend && npm test` + backend suite untouched.
**Dependencies:** Task 6 (contract frozen).
**Files likely touched:** `frontend/src/lib/llm.ts` (new),
`frontend/tests/llm.test.ts` (new).
**Estimated scope:** M.

### Checkpoint: data layer
- [ ] Frontend lib tests green; no visible UI change yet.

## Phase 4 — Settings dialog + sidebar

### Task 8: `SettingsDialog` (M, 3 files)

**Description:** New `components/settings/SettingsDialog.tsx` mirroring
the `ProfileDialog` shell (`Dialog` + `Layout` + `DialogHeader
title="Settings"`, single panel). Export `SettingsCard`/`SettingsRow`
from `sections.tsx` (no visual change to Profile) and reuse. Rows per
spec §5.1: fixed OpenRouter display, `type="password"` key input +
show/hide toggle (external `Button` if TextInput has no built-in
reveal — verify, don't customize Astryx), model input (default
`openai/gpt-4o-mini`), `Badge` status, inline failure text (dialog
stays open), toast + `refresh()` on success, `AlertDialog` remove
confirm, privacy note, OpenRouter link-out.

**Acceptance criteria:**
- [ ] Save-invalid → inline error, dialog open, nothing persisted.
- [ ] Save-valid → toast, `••••hint` row replaces input, hook refreshes.
- [ ] Remove → confirm → `configured:false`.
- [ ] No ProfileDialog pixel changes (screenshot-compare or review).

**Verification:** `npm test` + manual dialog pass + backend suite green.
**Dependencies:** Task 7.
**Files likely touched:**
`frontend/src/components/settings/SettingsDialog.tsx` (new),
`frontend/src/components/profile/sections.tsx` (exports only),
`frontend/src/lib/llm.ts` (if wrapper gaps appear).
**Estimated scope:** M.

### Task 9: sidebar rewire + ambient dot (S, 1 file)

**Description:** `Pesdac.tsx`: add `isSettingsOpen` beside
`isProfileOpen` (`:550`), point the Settings row (`:1720-1724`) at
`openSettings()`; My Profile row untouched. Add `StatusDot
status="warning"` beside Settings while `unconfigured`/`invalid`,
cleared by hook refresh.

**Acceptance criteria:**
- [ ] Settings row opens Settings (not Profile); My Profile unchanged.
- [ ] Dot visible when keyless, gone after connect, no layout shift.

**Verification:** `npm test` + manual sidebar pass.
**Dependencies:** Task 8.
**Files likely touched:** `frontend/src/components/Pesdac.tsx`.
**Estimated scope:** S.

### Checkpoint: settings complete
- [ ] End-to-end: sidebar → Settings → save invalid/valid → dot
  clears → status persists across reload.
- [ ] Human review before onboarding/gating (visible behavior starts here).

## Phase 5 — onboarding slot

### Task 10: optional key section in `OnboardingDialog` (M, 2 files)

**Description:** Key section after subjects, before Save: same key
input + "Get a key" link-out + Skip affordance. `canSave` unchanged
(key never blocks). Save flow: profile PATCH first, then best-effort
`PUT /llm/key` — key failure shows inline but still completes
onboarding. Skip/empty → complete + warning `Banner
status="warning"` (spec §5.2 copy). Prefill: `configured` → hint row,
not the input.

**Acceptance criteria:**
- [ ] Skip completes onboarding with warning banner; `/profiles/me`
  write identical to today.
- [ ] Key failure still completes onboarding (failure message shown,
  not swallowed).
- [ ] `canSave` independent of key field (existing tests unmodified).

**Verification:** `npm test` + backend suite + manual new-user pass.
**Dependencies:** Task 7 (Tasks 8–9 not required — dialog-independent).
**Files likely touched:**
`frontend/src/components/auth/OnboardingDialog.tsx`,
`frontend/tests/` (onboarding lib-level coverage as applicable).
**Estimated scope:** M.

## Phase 6 — gating banners

### Task 11: `/new` welcome-send gate (S, 1 file)

**Description:** In `handleWelcomeSend` (`Pesdac.tsx:1460`): when the
shared keyless signal is on, return early (text preserved — the input
is controlled) and show the composer's existing `status` warning
(`statusPosition="top"`), reusing the sync-error slot idiom — no new
UI forms per review. Guest/loading/degraded/ready paths untouched.

**Acceptance criteria:**
- [ ] Keyless send → warning status, draft kept, no chat created, no navigation.
- [ ] After connect (hook refresh) the same text sends normally.
- [ ] Ready-state welcome behavior byte-identical (existing tests unmodified).

**Verification:** `npm test` + backend suite + manual `/new` passes.
**Dependencies:** Tasks 7, 9 (needs hook + Settings entry point).
**Files likely touched:** `frontend/src/components/Pesdac.tsx`.
**Estimated scope:** S.

### Task 12: thread-send gate (S, 1 file)

**Description:** In `handleSend` (`ThreadView.tsx:1156`): same signal →
early return (input keeps the draft) + the thread composer's existing
`status` warning, slotted after `syncErrorMessage`, before the storage
advisories. **No optimistic paint** (spec D: a user bubble with no
possible reply is a lie) and the edit-resend path is gated identically
(no truncate lands while gated).

**Acceptance criteria:**
- [ ] Keyless thread send → warning status, zero new blocks, input text kept.
- [ ] Ready-state send byte-identical to today (existing thread tests
  unmodified).

**Verification:** `npm test` + backend suite + manual thread pass.
**Dependencies:** Task 11 (same banner copy/pattern, sequential).
**Files likely touched:** `frontend/src/components/chat/ThreadView.tsx`.
**Estimated scope:** S.

### Checkpoint: gating complete
- [ ] Full matrix from spec §5.3 exercised live (new/existing/guest ×
  unconfigured/invalid/ready).
- [ ] Drafts intact at every step, zero console errors.

## Phase 7 — rollout + proof (XS)

### Task 13: docs, env wording, proof metrics (XS, 2 files)

**Description:** Verify `.env.example` names only; add ops rotation
note (key change orphans rows → users re-save); flip spec Status to
Implemented with the measured table from §9 (skip→connect loop,
invalid-rejected-pre-persist, suite counts, 5xx delta).

**Acceptance criteria:**
- [ ] Spec §9 filled with real observations, not projections.
- [ ] Rollback verified once: dialog unmounted → baseline behavior.

**Verification:** full backend + frontend suites; manual rollback pass.
**Dependencies:** Task 12.
**Files likely touched:** `backend/.env.example`,
`docs/reasonix/specs/llm-byok-settings.md`.
**Estimated scope:** XS.

### Checkpoint: complete
- [ ] All spec §9 metrics true; no ProfileDialog/theme changes
  (`git status` shows backend LLM files + settings/onboarding/gating
  + the two docs only); changes uncommitted.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| OpenRouter `/models` shape drift | Med — wrong validation mapping | Task 0 probes pre-code; spec updated first |
| `cryptography` native build on target host | Med — install failure | Pure-Python fallback documented at Task 1 if wheel missing; pinned minimum version |
| Fernet key loss orphans all keys | High — users must re-enter | Accepted + documented (status flips to `configured:false`, never crash); rotation note in Task 13 |
| Validation endpoint as outbound oracle | Med — cost/abuse | Strict 10/300 bucket + origin check + pre-call length guards (Task 5) |
| Secret leak via logs/responses/tests | High | Category-only warnings; key absent from all responses (asserted); mock keys only in tests; `.env.example` names only |
| Banner crowding composer <640px | Low — layout | Task 11/12 verify narrow viewports; `BottomSheet` fallback only if observed (spec §5.3 note) |
| Scope creep into completions wiring | Med | Explicit non-goal; separate spec when keys land |

## Open questions

- Default model string (spec proposes `openai/gpt-4o-mini` — confirm).
- Show/hide key toggle: external `Button` vs TextInput built-in (verify at Task 8, no custom Astryx styling either way).
- `<640px` banner vs `BottomSheet` (decide on viewport evidence in Task 11).
- Prod `LLM_KEY_ENCRYPTION_KEY` custodian (who mints/stores the 32 bytes).

## Parallelization

Tasks 4–6 share `routers/llm.py` — sequential. Tasks 8/10 both need
only Task 7 — can parallelize after Task 7 (different files), then
11–12 sequential (same banner pattern, thread after welcome).
Contract tests for 4/5/6 may be drafted in parallel against the
frozen `schemas/llm.py` shapes, then wired sequentially. Default:
sequential.
