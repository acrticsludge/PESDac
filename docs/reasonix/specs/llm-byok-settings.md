# Spec: LLM BYOK — OpenRouter key settings, onboarding slot, and no-key gating

Status: Implemented — uncommitted, pending review + live pass (Phase 7
proof metrics in the plan still need a live session sample).

Supersedes the settings-dialog plan discussion (2026-09-13): separate
`Settings` dialog (server-side encrypted keys, OpenRouter-only v1,
validate-on-save). This spec adds the onboarding key slot and the
no-key/invalid-key gating on `/new` and in existing chats.

## 1. Background and evidence

- Sidebar has **two rows wired to the same dialog**: `Settings`
  (`frontend/src/components/Pesdac.tsx:1715-1725`) and `My Profile`
  (`:1727-1737`) both call `openProfile("profile")`. The Settings row
  is miswired — this spec repoints it at the new dialog.
- `ProfileDialog.tsx:140` is the settings-dialog idiom to mirror
  (Astryx `Dialog` + `Layout` + `DialogHeader`, `min(1120px, …)`,
  `80dvh`). Its `Assistant` tab (`sections.tsx:1033`) covers answer
  *behavior* (depth/verbosity/citations/follow-ups) — not providers —
  so a separate dialog does not collide with it.
- `OnboardingDialog.tsx:1-12` is a required-purpose single-screen
  wizard (campus/semester/branch/subjects) that PATCHes
  `/profiles/me` with `onboardingDone:true`. It is the slot for the
  optional key step.
- No LLM code exists anywhere (backend has zero openai/openrouter
  references; assistant turns are local `planResponse` mocks —
  `ThreadView.tsx:1117`). This spec covers **keys + gating only**.
  Wiring real completions is a named follow-up spec, not this one.
- Astryx 0.5.2 (installed) has **no `Drawer` component**. The
  equivalents are `Banner` (`status: info|warning|error|success`,
  `title`, `description?`, `actions?`, `onDismiss?`,
  `container: card|section`, `collapsible?`) and `BottomSheet`.
  Every "drawer" below means **`Banner`**, inline where the action
  happens. If the reviewer wants a floating drawer instead, that is
  custom UI and needs an explicit exception to AGENTS.md §2.

## 2. Goals / non-goals

Goals:

- User can connect an OpenRouter key in Settings, with the key
  verified before it is stored.
- Onboarding offers the same key slot, skippable, with an honest
  warning that chats need a key.
- No-key/invalid-key states gate gracefully: `/new` welcome send and
  existing-thread send both surface the composers' existing `status`
  warning naming Settings (drafts kept, no optimistic paint).
- Zero behavior change for configured users; guests keep today's
  memory-only behavior with a login CTA instead of a key form.

Non-goals (deferred with exit criteria):

- Multi-provider / custom OpenAI-compatible endpoints. Revisit when a
  second provider is requested — schema already stores `provider` as
  a string.
- Model picker (v1 = free-text model field with sane default).
  Revisit when OpenRouter model-list UX is asked for.
- Actual LLM completion wiring (`planResponse` → backend → OpenRouter).
  Separate spec; this one only stores, validates, and gates.
- Key sync across devices beyond "server-stored, works everywhere".

## 3. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | New `llm_credentials` table; **never** a profile column | Profile envelopes are cached (K3) and returned whole — secrets must never enter a cacheable envelope or the PATCH merge path |
| D2 | Fernet (`cryptography` pkg), key from `LLM_KEY_ENCRYPTION_KEY` env; required in `prod`, degraded 503 otherwise | One new dep, audited primitive; boot never breaks in dev/test |
| D3 | Store only `provider`, `key_encrypted`, `key_hint` (last 4), `model`, `validated_at` | `••••abcd` display without ever decrypting to the client |
| D4 | Validate server-side on save via `GET https://openrouter.ai/api/v1/models` (5 s timeout, existing `httpx`) | Client never touches OpenRouter — no CORS/key-leak surface; bad keys rejected before persist |
| D5 | Separate `SettingsDialog`, not a ProfileDialog tab | Reviewer decision; keeps provider secrets out of the profile component tree |
| D6 | Gating is a client-side `Banner`, not a route block or modal | `/new` and threads stay visible and readable; user keeps context and drafts; one click reaches Settings |
| D7 | API never returns the key — only `configured`, `keyHint`, `model`, `validatedAt` | Owner cannot read it back; rotation = overwrite |
| D8 | Single shared `useLlmStatus` hook (identity-scoped, auth-epoch-gated) | Mirrors `auth.ts` TaggedCache discipline; every gate reads one source, no per-component fetch storms |
| D9 | Guests get a login CTA banner, never a key form | Server-side keys need an identity; guest chats stay memory-only as today |

## 4. Backend: storage + API

### 4.1 Table `llm_credentials`

`user_id` FK→users (unique per provider), `provider TEXT`
(`openrouter` only in v1), `key_encrypted` (Fernet token),
`key_hint CHAR(4)`, `model TEXT`, `validated_at TIMESTAMPTZ`,
`updated_at`. Alembic migration + `Base` import. No cache keys for
this table (status reads are one indexed SELECT; §5 of the
redis-read-through-cache spec is untouched).

### 4.2 Endpoints (`routers/llm.py`)

| Method | Contract |
|---|---|
| `GET /llm/status` | `{configured, provider, keyHint, model, validatedAt}`. Authenticated read, no rate limit (reads are unlimited, per rate-limit contract). `configured:false` shape when absent or undecryptable. |
| `PUT /llm/key` `{provider:"openrouter", apiKey, model}` | Origin check (`check_mutation_origin`) + strict bucket (`llm-key-save`, 10/300 — outbound calls cost). Guards: provider must be `openrouter`, key 1–500 chars, model 1–120 chars (checked *before* any outbound call). Validate → Fernet encrypt → upsert → return status shape. |
| `DELETE /llm/key` | Idempotent delete (T22 idiom: 204 whether or not a row existed). Origin check + standard 60/60 bucket. |

Validation mapping (OpenRouter `GET /auth/key` with `Authorization:
Bearer <key>` — live-probed 2026-09-14: `/models` is public and
returns 200 even for bogus keys, so it cannot validate; `/auth/key`
returns 401 `{"error":{"message":"User not found.","code":401}}` for
bogus keys):

| Provider outcome | API result, nothing stored |
|---|---|
| 200 | persist, `validated_at=now` |
| 401/403 | 400 `LLM_KEY_INVALID` ("That key was rejected by OpenRouter.") |
| timeout / 5xx / network | 502 `LLM_UNREACHABLE` ("Couldn't reach OpenRouter. Nothing was saved.") |
| crypto unavailable (no env key, non-prod) | 503 `LLM_CRYPTO_UNAVAILABLE` |

Error envelope reuses `error_body(code, message)`; 429s reuse the
existing `RATE_LIMITED` shape. Keys never appear in logs (category
only, same rule as `cache.py:216`) or in any response.

### 4.3 Config

`LLM_KEY_ENCRYPTION_KEY` read in `config.py` (name only in
`.env.example`); `validate_startup` requires a 32-byte value when
`ENV=prod`, optional elsewhere. Rotation procedure (ops note):
changing the value orphans stored keys — status flips to
`configured:false` with a "re-enter your key" hint; users re-save,
nothing crashes.

## 5. Frontend

### 5.1 `SettingsDialog` (new `components/settings/SettingsDialog.tsx`)

Mirrors `ProfileDialog` shell: Astryx `Dialog` + `Layout` +
`DialogHeader title="Settings"`, single panel (no rail — one purpose;
add the rail only when a second settings area lands).

Providers render as one `Card` per provider (a list, so a second
provider slots in later): `Card` > `Collapsible` (the documented
Astryx pattern). The header shows a `StatusDot` (`success` =
connected, `neutral` = not) + name + `••••hint` · model, or "Not
connected — click to add your key." Clicking expands the key form
inline; the card starts expanded unless a working key is already
known. Form controls reuse the profile password-form idioms.

Rows (all existing Astryx inputs):

- Provider card header as above (v1: OpenRouter only)
- API key: `TextInput type="password"` (no reveal toggle, matching
  the password forms), placeholder `sk-or-v1-…`; after save the card
  collapses to the hint header, with Change/Remove inside. Save sends
  the server default model — model pick moves to the future
  chat-composer dropdown (backend keeps the column as-is)
- Status: `Badge` (`success` Connected / neutral Not configured /
  `error` Needs attention)
- Save: `Button primary` with `isLoading`; inline failure text under
  the form (OnboardingDialog idiom, not a toast — the dialog stays
  open). Success → toast + hook invalidation
- Remove: existing `AlertDialog` confirm idiom → `DELETE` → status
  refresh
- Privacy note (`Text supporting`): "Stored encrypted on our server.
  We never show it again — to rotate, save a new key."
- Link-out: "Get a key at OpenRouter" external link (new tab) to
  `https://openrouter.ai/workspaces/default/keys`

`Pesdac.tsx`: add `isSettingsOpen` beside `isProfileOpen` (`:550`);
Settings row `:1720-1724` calls `openSettings()`; My Profile row
untouched. `lib/auth.ts`-adjacent wrappers `apiLlmStatus/Save/Delete`
reuse `apiFetch` conventions — never the profile-cache path.

### 5.2 Onboarding key slot (extends `OnboardingDialog`)

- New optional section *after* subjects, *before* Save:
  `TextInput` (same key field) + "Get a key" link-out + `Skip for now`
  affordance. `canSave` (`:222-227`) is **unchanged** — the key never
  blocks onboarding.
- Skipped/empty + save → onboarding completes exactly as today, plus
  a `Banner status="warning"` inside the dialog:
  title "Chats need an API key", description
  "You skipped the OpenRouter key. You can browse and set up, but
  starting a chat will ask you to connect one — anytime in Settings."
- Key filled → `PUT /llm/key` *after* the profile PATCH lands; key
  failure never fails onboarding (inline message, user still proceeds
  via the same save — key is best-effort here, authoritative in
  Settings).
- Prefill: if status already `configured`, show the `••••hint` row
  instead of the input (returning user, no duplicate entry).

### 5.3 Gating matrix (composer `status` slot — the existing error surface)

One hook, `useLlmStatus()` (D8): `{state: unknown|ready|unconfigured|
invalid|degraded, hint, model, refresh}`. `unknown` while loading —
gates treat it as pass (never block on a fetch; same principle as the
auth-loading flash fix). `degraded` = status endpoint unreachable —
fail-open, sends proceed (backend is source of truth when completions
land; follow-up spec maps backend 502 `LLM_MISCONFIGURED` to the same
slot). Review note (2026-09-14): gates use the composers' existing
`status` slot (`{type:"warning",message}`, `statusPosition:"top"`) —
not a separate `Banner` — per "no new UI forms, stay in sync". The
sidebar `StatusDot` + message copy naming Settings is the path to
the dialog.

| Surface | Trigger | UI (existing composer status, non-modal) |
|---|---|---|
| `/new` welcome composer | `unconfigured` or `invalid`, authenticated | `status` warning above the composer: unconfigured → "Connect your OpenRouter key in Settings to start chatting."; invalid → "Your saved key was rejected — save a new one in Settings." Send no-ops with text preserved; nothing navigates away. |
| Existing thread composer | same states, `handleSend` | Same warning above the thread composer; optimistic paint does **not** run (unlike persist failures — there is nothing to roll back to, and a user bubble with no possible reply is a lie). Draft preserved in the input. |
| Guests (either surface) | — | No gate: the AuthGate owns guest routing and memory-only behavior is unchanged. |
| Sidebar Settings row (my addition) | `unconfigured`/`invalid` at shell render | `StatusDot variant="warning"` in the row's `endContent` — ambient signal so the status is never a surprise. Clears on `refresh()` after save. |

Drawer-vs-status note: no `Drawer` exists in Astryx 0.5.2 core
(verified in `node_modules/@astryxdesign/core/src`), and review
(2026-09-14) directed gates to reuse the composers' existing `status`
slot rather than introduce `Banner`s in the chat surfaces. `Banner`
remains only for the onboarding skip-confirm (a dialog-internal
moment with no composer present). `BottomSheet` is not used.

### 5.4 Copy deck (exact strings, reviewer-editable)

- Onboarding warn: "Chats need an API key — You skipped the
  OpenRouter key. You can browse and set up, but starting a chat will
  ask you to connect one — anytime in Settings."
- New-chat status: "Connect your OpenRouter key in Settings to start
  chatting."
- Thread status: "Connect your OpenRouter key in Settings to start
  chatting." (invalid variant: "Your saved key was rejected — save a
  new one in Settings.")

## 6. Observability

- Backend: one `logger.warning` category per validation failure
  (`llm_validate_rejected`, `llm_validate_unreachable`) — no keys,
  no hints, no user ids beyond what existing 429 lines carry.
- Frontend: no new telemetry; status hook exposes `state` for the
  sidebar dot only.
- Upstash/Neon impact: none (one indexed SELECT per status read,
  uncached by design; validation calls are user-paced under the
  strict bucket).

## 7. Testing

Backend (`tests/test_llm_contract.py`, SQLite + mocked `httpx`,
no new test deps):

- status empty → `configured:false`; PUT-invalid → 400
  `LLM_KEY_INVALID`, nothing stored; PUT-valid → stored Fernet,
  status shows hint/model, key in no response; DELETE → empty;
  per-user isolation (A's key never serves B); oversize key rejected
  with zero outbound calls; crypto-unset → 503; strict-bucket 429
  after 10/5min; `GET /profiles/me` envelope contains no key fields
  (regression guard for D1).
- Full backend suite stays green.

Frontend (existing `node --test` lib style + contract tests):

- Onboarding: skip path completes with warning banner; key path
  calls PUT after profile PATCH; key failure still completes
  onboarding; `canSave` independent of key field.
- Gating: matrix rows above (send with `unconfigured` → banner,
  draft kept, no optimistic bubble; `ready` → today's behavior
  byte-identical; guest → login banner).
- Settings: save-invalid shows inline error, dialog stays open;
  save-valid toasts + hook refresh clears sidebar dot; remove
  confirms via AlertDialog.

## 8. Rollout

1. Merge dark: migration + endpoints + dialog behind existing auth
   (no sidebar change yet); suites green; zero behavior delta for
   configured-key-less users (there are no configured users yet —
   every gate reads `unconfigured`, so step 2 matters).
2. Flip sidebar row + mount banners + onboarding slot; exercise as
   new user (skip → warn → `/new` banner → connect → chat path
   unblocked) and returning user (prefill hint row).
3. Prod: set `LLM_KEY_ENCRYPTION_KEY` (32 bytes, secrets manager —
   never `.env` in repo); verify validate-on-save latency tolerable
   (5 s cap) before announcing.
   Rollback: revert frontend mount (banners/dialog unmounted) —
   backend rows are inert without callers; no data migration to undo.

## 9. Proof metrics (done = all true)

- Skip→warn→banner→connect loop completable with zero console
  errors and drafts intact at every step.
- Invalid key rejected pre-persist (no row written — asserted in
  tests and once live).
- Full backend + frontend suites green.
- Zero 5xx delta on chat/profile/auth routes (new code paths only).

## 10. Explicitly out (reaffirmed)

Real completion wiring, model picker/list, custom endpoints,
multi-provider, per-model spend caps/usage display (natural v2:
surface `validatedAt` age + a "re-validate" action), `chat-sync.ts`
changes, any ProfileDialog visual change, any theme change.
