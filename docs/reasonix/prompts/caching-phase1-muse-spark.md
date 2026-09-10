# Muse Spark implementation prompt: caching Phase 1 — identity-scoped reset (single stream)

You are Muse Spark 1.3, running on medium reasoning, implementing in the
PESDac repository. Read these first, in order:

- `AGENTS.md` (Astryx/UI rules in full — no redesign, no theme/CSS changes,
  smallest diff; this stream touches no UI at all)
- `docs/reasonix/specs/caching-audit.md` (§2 principles + §4 P0-1…P0-5 +
  §5 Fix 1 + §10 locked decisions + §11 no-new-dependencies; FROZEN —
  defects become reports, never unilateral spec edits)
- `docs/reasonix/plans/caching-plan.md` (Phase 1 is your ONLY scope; your
  owned files + branch + why you never touch `chat-sync.ts`/backend/theme)

Key source files (open before editing):

- `frontend/src/lib/session.ts:44-45` (store key names), `:94` (mem map),
  `:132-143` (`dumpStore`), `:219-238` (`deleteCustomChat`),
  `:426` (`DRAFTS_KEY`), `:669-680` (`clearLocalProfileSeed` — device prefs
  stay byte-identical), `:760` (`chatHydratedKey`), `:766` (`messageStates`),
  `:789-791` (error signals), `:1189-1216` (`adoptGuestChats`),
  `:1301-1302` (pending merge — the P0-1 leak site),
  `:1318-1330` (`__resetChatBackingForTesting` — reuse this seam pattern)
- `frontend/src/lib/auth.ts:1097-1136` (token mint + `inFlightToken :1101`),
  `:1139-1145` (`clearAuthCache` — your choke point),
  `:1281-1301` (`apiLogout`), `:1386-1393` (`__resetAuthCachesForTesting`)
- `frontend/src/components/Pesdac.tsx:860-871` (unscoped snapshots),
  `:865-997` (snapshot read/write — wipe + age-cap lines only)
- `frontend/tests/chat-backing.test.ts` (your style guide: stubbed fetch,
  state-based assertions, DAMP self-contained cases — imitate, don't import)

Before touching code, run `git status --short`. Existing modified/untracked
files belong to the user or another run. Do not reset, clean, checkout,
overwrite, or commit them. Work on branch `fix/cache-identity-reset`
(create once with `git checkout -b`). Never touch main. Do not commit,
push, or reset files.

## Mission

Chat memory, overlays, drafts, and skeleton snapshots survive logout and
paint into the next identity (spec P0-1…P0-5). Add one
`resetChatStoreForIdentity()` choke-point reset so every identity transition
starts from a clean store, while genuine guest→login adoption keeps working
exactly as today.

## Hard constraints

- Touch ONLY: `session.ts` (new reset fn + hydrate adopt-ordering),
  `auth.ts` (choke-point calls + `inFlightToken` clear), `Pesdac.tsx`
  (snapshot wipe/age-cap lines), `frontend/tests/cache-identity-reset.test.ts`
  (new). NEVER edit `chat-sync.ts`, `lib/chat.ts`, `AppToasts.tsx`,
  `ThreadHistoryLoader.tsx`, `backend/`, theme, global CSS, send/stream/edit
  logic, skeleton predicates, or toast bridge/copy.
- TDD mandatory (Prove-It per slice): RED repro test → fails → minimal
  GREEN → next slice. A test that passes before the fix proves nothing.
  NEVER weaken existing tests to pass; all 197 stay green.
- Reset clears identity data: `CHATS_KEY`, `OVERLAY_KEY`, `c:` pin/archive
  refs, `messageStates`, `chatHydratedKey` + pending markers, all three
  error signals, drafts, three snapshot keys. Device prefs in
  `clearLocalProfileSeed` stay byte-identical.
- Hydrate ordering: capture guest adopt-candidates BEFORE reset; rows with
  server flags are post-logout leftovers ⇒ never adoptable; true guest rows
  (`updatedAt === undefined`, no flags) adopt exactly as today.
- No timers, no observers, no polling, no auto-retry, no `typeof window`
  additions, no random values. `git diff --check` clean.

## Required working method

Work in plan §"Build order — Phase 1" slice order (1→4). Report after each
with:

```text
Task: slice_
Evidence observed:
Files inspected:
Files changed:
Acceptance criteria completed:
Commands/tests run:
Failures or warnings:
Next action:
```

If blocked, report the exact blocker and smallest safe options.

## Guardrails

- Drafts ARE identity data (P0-5) — they go. Device prefs stay.
- Genuine-guest adoption pinned by tests before and after — no P1-2
  backend/idempotency work (Phase 5 only).
- One thing per slice; compilable + tests green between slices; no
  scope-expanding "cleanups" (note them instead).

## Commands

From `frontend/`: `npm.cmd test`, `npm.cmd run astro -- check`,
`npm.cmd run build`. From repo root: `git diff --check`,
`git status --short`. Paste exact failures; never weaken tests to pass.

## Acceptance checklist

- Seed-as-A → transition → zero A rows/overlays/drafts/signals paint for B;
  `dumpStore` clean; B list === server list only.
- Mint-during-transition never caches; deferred cross-identity message
  resolve drops; post-logout leftovers produce zero adopt POSTs.
- Guest creates chats → login → adopted once, no duplicates, no lost flags.
- Regressions: guest + demo zero fetches; 401 → global re-login only;
  device prefs preserved across logout.
- Full gates green; diff confined to owned files.
- Final report: files changed + why, test results.
