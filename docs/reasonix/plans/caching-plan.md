# Plan: caching correctness — zero stale data (5 phases, Phase 1 executable)

Spec: `docs/reasonix/specs/caching-audit.md` (FROZEN — streams build against
it; defects become reports, never unilateral edits). §10 decisions locked,
§11 (no new dependencies) holds for all phases.
Status: Proposed.
Branch rule: one branch per phase from main; never commit to main; do not
push/commit unless the user explicitly asks.

## Phases (sequential — each merges before the next cuts)

| Phase | Branch | Owns (ONLY these) | Must NEVER touch |
|---|---|---|---|
| 1. Identity-scoped reset | `fix/cache-identity-reset` | `frontend/src/lib/session.ts` (new `resetChatStoreForIdentity()` + hydrate adopt-ordering only), `frontend/src/lib/auth.ts` (choke-point calls + `inFlightToken` clear only), `frontend/src/components/Pesdac.tsx` (snapshot wipe/age-cap lines only), `frontend/tests/cache-identity-reset.test.ts` (new P0 regression tests only) | `chat-sync.ts`, `lib/chat.ts`, `AppToasts.tsx`, `ThreadHistoryLoader.tsx`, `backend/`, theme, global CSS, send/stream/edit/vote/turn logic, skeleton predicates, toast bridge/copy |
| 2. Resolve guards | `fix/cache-resolve-guards` | `session.ts` (load/message resolve + container-op reconcile guards), `auth.ts` (mint-write epoch guard) + race tests | same as above + Phase-1 reset function semantics |
| 3. Rollback + paging | `fix/cache-rollback-paging` | `session.ts` (rename per-row rollback), `chat-sync.ts` callers in `session.ts` (page loops via existing `*Page` helpers) + tests | `chat-sync.ts` wrapper contracts, envelope shapes |
| 4. Revalidation | `feat/cache-revalidation` | foreground/pageshow hook + storage logout ping + tests | fetch-once-per-identity semantics outside the hook |
| 5. Backend idempotency | `feat/adopt-idempotency` | `backend/app/routers/chats.py` (`clientAdoptKey` contract), `session.ts` adopt sender, `chat-sync.ts` create signature | rate-limit policy, unrelated routes |

Rationale for sequential phases: every phase meets in `session.ts` and the
identity choke point. Parallel streams would manufacture merge conflicts in
exactly the resolve paths being guarded. Phase 1 first (risk-first): it kills
all five P0 wrong-user leaks and every later phase assumes the reset exists.

## Build order — Phase 1 (the executable stream, TDD per slice)

TDD is mandatory: failing repro test first (Prove-It), minimal GREEN, then
next slice. Existing seams: `__resetChatBackingForTesting`
(`session.ts:1318-1330`), `__resetAuthCachesForTesting`
(`auth.ts:1386-1393`); existing style: stubbed-fetch tests in
`frontend/tests/` (see `chat-backing.test.ts`), state-based assertions
(inputs → store contents), DAMP self-contained cases.

1. Slice 1 — reset function + P0-1/P0-5 tests: `resetChatStoreForIdentity()`
   clears `CHATS_KEY`, `OVERLAY_KEY`, `c:` pin/archive refs, `messageStates`,
   `chatHydratedKey` + pending markers, hydrate/create/per-chat signals,
   drafts. RED: seed store as A → reset → assert B-visible store contains
   zero A rows/overlays/drafts; `dumpStore` empty of A data.
2. Slice 2 — choke-point wiring + P0-2 test: call reset from
   `clearAuthCache()` (covers login/signup/social/logout/401 via
   `auth.ts:1139-1145` callers) and `apiLogout()` (profile-seed parity);
   clear `inFlightToken` in `clearAuthCache`. RED: start mint (deferred
   fetch) → `clearAuthCache()` → resolve mint → assert cache write dropped.
3. Slice 3 — hydrate adopt-ordering + P0-3/P0-4 tests: capture guest
   adopt-candidates BEFORE reset; reset drops post-logout leftovers (server
   flags present ⇒ never adoptable); adopt → list-replace unchanged after.
   RED: A-rows-in-memory + `hydrateChats(B)` → zero adopt POSTs, B list ===
   server list; deferred A `loadChatMessages` resolve after identity switch
   → overlay untouched.
4. Slice 4 — snapshots + gates: wipe the three `localStorage` snapshot keys
   (`Pesdac.tsx:865-997`) on transition + 24 h age cap on writes; run full
   gates (all 197 existing tests green, `astro check`, build,
   `git diff --check`).

Guest→login upgrade is the protected path: true guest rows
(`updatedAt === undefined`, no server flags) must still adopt exactly as
today — Slice 3's tests pin this alongside the leak tests.

## My merge procedure (lead reviewer = me)

1. Cut `fix/cache-identity-reset` from current `main`.
2. Land Phase 1; re-run full gates on the merge: frontend `npm.cmd test`,
   `npm.cmd run astro -- check`, `npm.cmd run build`, `git diff --check`
   from repo root.
3. User-assisted browser matrix (shared browser, no reload between steps):
   - B1: login A → logout → login B → sidebar/threads/drafts contain zero A
     data; B's welcome composer empty.
   - B2: guest creates chats → login → chats adopted once, no duplicates.
   - B3: regressions — guest + demo zero fetches; 401 → global re-login
     only; rate-limit/storage/corrupt warnings unchanged.
4. Cut Phase 2 only after Phase 1 merges.

## File touch budget

- Phase 1: max four touched source files (expected: two edits + one test
  file + snapshot lines in `Pesdac.tsx`). Exceeding it means mis-scoping —
  split and report.

## Risks

- Reset-too-much (wiping device prefs/drafts the user expects kept):
  forbidden — reset clears identity data only; `clearLocalProfileSeed`
  device-pref preservation stays byte-identical. Drafts ARE identity data
  (P0-5) — they go.
- Adopt regression (guest upgrade stops adopting): forbidden — Slice 3 pins
  genuine-guest adoption before and after.
- Auto-retry/revalidation smuggling: forbidden — Phase 1 adds no timers,
  no observers, no polling; Retry behavior untouched.
- Unilateral `clientAdoptKey`/backend work: forbidden — Phase 5 contract
  only; Phase 1 duplicates-on-retry stays a known gap (P1-2).
- A concurrent run editing `session.ts`/`auth.ts`/`Pesdac.tsx`: the prompt
  carries the courtesy rule — `git status --short` first, touch only
  spec-owned lines, report collisions instead of overwriting.
