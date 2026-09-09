# Spec: editable display name in My Profile (BetterAuth `updateUser`)

Status: Proposed
Audit basis: `TODO(BetterAuth)` at `frontend/src/components/profile/sections.tsx:183`; T20 comment at `frontend/src/lib/auth.ts:47-54` (displayName/email are BetterAuth-owned; mutate through `updateUser`).
Stack: Astro + React 19 + Astryx 0.5.2 + StyleX + `PESDacMockupTheme` (per `AGENTS.md`; `CLAUDE.md` Next.js/Supabase references are stale for this repo and do not apply).

## 1. Problem

Authenticated users cannot change their display name. `IdentitySection` renders name and email as read-only `Text` whenever `authUser != null` (`sections.tsx:323-340,349-366`); only logged-out guests get editable inputs (local store). Google users stuck with an unwanted name (wrong Google profile name, nickname preference) have no recourse in-app.

## 2. Users

- Signed-in users (Google or credential) editing the name shown across PESDac.
- Email stays read-only for everyone: BetterAuth 1.7.3 rejects email in `updateUser` (`EMAIL_CAN_NOT_BE_UPDATED`, `update-user.mjs:51`), and we have no verification sender. The Email row keeps its "Managed by your account." copy unchanged.

## 3. Goals

1. Authenticated users edit display name from My Profile > Identity, inline, with field-level validation and a save affordance, following the slice-14 pattern (field `status` errors, `onEnter` submits).
2. The change persists in BetterAuth (`POST /api/auth/update-user { name }` — name-only updates need no verification, just a session: `sessionMiddleware`, `update-user.mjs:12-59`).
3. Backend `/auth/me` `displayName` converges without a reload (it mirrors BetterAuth `name` — T1 confirms the mirror cadence in `backend/app/deps.py`, then the UI refreshes `useProfile()` the same way onboarding saves do).
4. Guest (logged-out) local editing behavior is byte-identical.

## 4. Non-goals

- No email editing, no avatar/image editing (`updateUser` also takes `image`; out of scope — no upload/moderation story).
- No backend endpoint, schema, or migration (expected; T1 confirms, see §6 FR2).
- No Astryx upgrade, Tailwind, global CSS, theme edit, or row restyle. The row keeps its title/description/icon; only the control swaps Text -> input+save when authed.
- No display-name uniqueness, profanity filtering, or moderation.

## 5. User flows

### F1: Rename happy path

1. Signed-in user opens My Profile; Display name row shows current name.
2. Edits the field (prefilled with current name), presses Enter or Save.
3. Button shows saving state; success toast; row shows the new name; header/shell name updates without reload (profile refresh path).

### F2: Client validation

- Empty/whitespace-only -> inline `status` error on the field ("Enter a display name."), no request.
- Over-long (>80 chars, mirroring the backend `[:80]` mirror) -> inline error, no request.
- Unchanged value -> save is a no-op (no request; button may stay disabled until dirty).

### F3: Server failure

- 401 (session died mid-edit) -> existing global auth-required flow (NOT a form error).
- Other 4xx/5xx/network -> error toast (existing `useToast` path), value preserved, saving state clears. Form-level text only if no field owns the error (slice-12E/15 rule).

## 6. Functional requirements

### FR1: Mechanism (BetterAuth-owned, per T20)

- New facade `updateDisplayName(name: string): Promise<void>` in `frontend/src/lib/auth.ts` calling `authClient.updateUser({ name })`. It MUST send ONLY `{ name }` — never `email` (server rejects it; assert in tests).
- Trim client-side; validate non-empty + `<= 80` before any request (zero-request validation, slice-14 rule).
- On success, refresh the profile identity caches (`refreshProfile()` + equivalents so `useProfile`/`useAccounts`-adjacent readers converge; mirror the post-onboarding-save path, not a new mechanism).

### FR2: Backend mirror (verify, don't assume)

- T1 MUST confirm whether `get_current_user` re-mirrors BetterAuth `name` into `users.display_name` on every request or only at creation (`backend/app/deps.py` upsert region). If per-request: no backend work, UI refresh suffices. If creation-only: the spec's fallback is a backend re-mirror on `/auth/me` read (tiny, no schema change) — do NOT build it without human approval; report the finding first.

### FR3: UI wiring (slice-14 pattern)

- Authed control: `TextInput` (prefilled, `CONTRO L_WIDTH`, `isLabelHidden`, existing size) + explicit Save affordance (button; `onEnter` submits). Reuse `isSavingIdentity`-style busy/disable states if present, else a local busy flag — do not invent a new spinner language.
- Errors: length/empty -> field `status`; server/network -> toast via `toUserMessage(e, "Couldn't save your name. Try again.")`.
- Dirty tracking: no request when the trimmed value equals the current name.

## 7. Acceptance criteria

- [ ] AC1: Signed-in rename persists across reload (BetterAuth row changed; backend `/auth/me` agrees without manual refresh).
- [ ] AC2: Empty/over-long/unchanged inputs cost zero requests (Network proof); correct inline field errors.
- [ ] AC3: 401 mid-edit triggers the global session-expired flow exactly once; other failures toast recoverably with value preserved.
- [ ] AC4: Guest local editing untouched; email row untouched and still read-only when authed.
- [ ] AC5: `npm.cmd test` + `astro check` + `astro build` + `git diff --check` pass; new wrapper/validation tests (mocked `authClient.updateUser`, zero-network validation asserts).
- [ ] AC6: Astryx UI/theme/layout unchanged; desktop + <=640px; clean console.

## 8. Constraints

- `AGENTS.md` UI rules apply in full. Max five touched source files (expected: `auth.ts`, `sections.tsx`, one test file).
- Never log or toast the name value in diagnostics beyond what the UI already renders; no PII in test fixtures beyond synthetic (`"Test User"` style).
- Work on `fix/display-name-edit` from main; no commit/push unless asked.

## 9. API / interface requirements

- `authClient.updateUser({ name })` -> `POST /api/auth/update-user`; success `{ user }`. No new routes, no envelope change (BetterAuth native shape; facade throws `Error` with user-safe message on `res.error`, matching the existing `changePassword` wrapper style at `auth.ts:569-582`).
- `updateDisplayName(name: string): Promise<void>` keeps facade conventions (clear doc comment, no token mint involved).

## 10. Data requirements

- No schema change, no migration. (FR2 fallback, if ever approved, is a read-path mirror, not a column.)

## 11. Security requirements

- Session-gated server-side by BetterAuth (`sessionMiddleware`); no additional auth code needed client-side.
- Name length capped at 80 both layers (client pre-check + server mirror truncation already exists); no HTML/script interpretation — Astryx `Text` escapes by default (verify, don't assume, in T3 browser pass).
- Origin story unchanged (BetterAuth client, same-origin).

## 12. Testing requirements

- Unit (node:test, existing seams): trims input; rejects empty/over-long with zero `updateUser` calls; sends `{ name }` only (assert no `email` key); surfaces `res.error.message`; refreshes profile caches on success.
- Browser: F1/F2/F3 on desktop + narrow; reload persistence; guest path regression; clean console.

## 13. Rollout / rollback

- Rollout: frontend-only. No flag/env/migration.
- Rollback: revert branch; the row returns to read-only Text. A renamed user keeps the new name (data change is the feature, not residue).
