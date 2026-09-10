# SPEC: PESDac Caching — proper caching with zero stale data

Status: **proposed, not implemented.** No code touched.
Rule: nothing below changes UI, theme, or copy (`AGENTS.md` holds).

Method: three parallel audit agents — (1) full cache-layer inventory with
file:line evidence, (2) mutation/sync/invalidation path mapping, (3) purely
adversarial stale-data review. All three corroborated independently.

## 1. Goal

Every pixel the app paints must be either (a) true on the server right now,
or (b) explicitly labeled as device-local/unsynced. Concretely: no
wrong-user data ever (P0), no silent truncation or stuck-stale screens (P1),
no cross-identity/cross-tab residue (P2). Memory-first paint stays (it's the
app's instant feel) — but every memory paint gets a proof-of-freshness rule.

Non-goals: no polling infrastructure, no realtime channel, no service
worker, no UI redesign.

## 2. Governing principles (the "never stale" contract)

1. **Identity choke point.** All cached state must be droppable in one call
   on every identity transition (login/logout/signup/401/delete-account).
   Anything that survives a transition must be provably device-level.
2. **Stale resolves are dropped, never painted.** Every async resolve
   re-checks identity/epoch AND entity membership before writing.
   Last-intent-wins, never last-resolver-wins.
3. **Optimistic updates are per-entity.** Snapshots and rollbacks touch one
   row, never the whole list.
4. **Server rows carry their own freshness proof.** Reconcile by comparing
   `updatedAt`/version, never blind overwrite.
5. **Truncation is explicit.** If `pagination.total` exceeds what was
   fetched, the UI either fetches the rest or refuses `ready` — never
   silently treats page 1 as truth.
6. **Fail closed on identity ambiguity.** Unknown/epoch-mismatched identity
   ⇒ loading, never a cached paint (already the rule in `resolveInitialAuth`,
   `frontend/src/lib/auth.ts:268-286` — extend it everywhere).

## 3. Current state (condensed)

| Layer | Location | Scope today | TTL | Verdict |
|---|---|---|---|---|
| Chat/message memory | `frontend/src/lib/session.ts:94` (`CHATS_KEY`, `OVERLAY_KEY`, pins/archives, drafts, profile) | global, unbounded, never cleared on logout | none | **P0 hole** — survives logout, paints into next identity |
| `messageStates` per-chat ready flags | `frontend/src/lib/session.ts:766` | identity-tagged at dispatch, unbounded | none | **P1 hole** — `ready` never revalidates; resolve path has no identity re-check |
| Hydrate/create/per-chat error signals | `frontend/src/lib/session.ts:789-791` | global + per-chat, no timer | none | stale flags gate the *next* identity's spinner/Retry |
| Skeleton snapshots | `frontend/src/components/Pesdac.tsx:865-997` (`localStorage`, 3 keys) | deliberately global, never cleared | none | **P0/P2 hole** — cross-identity by design |
| `/auth/me`, `/profiles/me`, accounts (`TaggedCache`) | `frontend/src/lib/auth.ts:759-760,419` | identity-tagged, stale-resolve throws | none | sound mechanism; `apiUpdateProfile` misses `refreshProfile()` |
| Bearer JWT | `frontend/src/lib/auth.ts:1097-1136` | **global, untagged**, 5-min client TTL | 5 min | **P0 hole** — `inFlightToken` not cleared on transition, mint resolves into wrong identity |
| Backend responses | FastAPI, zero `Cache-Control`/`ETag` | — | none | no HTTP caching at all; `limit/offset`, no cursor; frontend never sends paging args → silent first-page truncation (>50 chats, >200 turns, archived never listed) |
| Revalidation | — | — | — | **none**: no polling, no focus/`pageshow` refetch, no tab sync, no realtime |

Key structural fact everything follows from: the session store is a
module-level `Map` (`session.ts:94`) that survives Astro client-router
navigations and logout (JS heap is per-tab, not per-identity), while
`apiLogout` (`auth.ts:1281-1301`) clears only auth caches + profile seed —
never the chat stores.

## 4. Gaps, severity-ranked

**P0 (wrong-user leak, same browser):**

- P0-1: logout → login-as-B paints A's chats/titles/messages.
  `hydrateChats` never clears memory on identity change;
  `pending = listCustomChats().filter(c => !serverCodes.has(c.code))`
  (`session.ts:1301-1302`) carries every non-server row forward; overlays
  never dropped. The render gate (`chatReady`, `session.ts:655-661`) hides
  rows only until B's hydrate *succeeds* — then leaked rows paint as live.
- P0-2: mint started as A resolves after login and is cached/used as B.
  `clearAuthCache()` (`auth.ts:1139-1145`) clears `cachedToken` but **not
  `inFlightToken`** (`auth.ts:1101`); `mintBackendTokenWithRetry`
  (`auth.ts:1130-1136`) caches unconditionally with no epoch check.
- P0-3: A's in-flight `loadChatMessages` resolve runs `setOverlay` with no
  identity re-check (`session.ts:1126-1134`). Same hole covers the 404 case:
  failure "keeps memory paint" — which is A's paint.
- P0-4: tab 2 keeps A's heap after tab-1 logout; B's login **adopts A's
  ex-rows into B's account server-side** — irreversible by refresh
  (`adoptGuestChats`, `session.ts:1189-1216`, candidates keyed off flag
  absence, which post-logout leftovers satisfy). No `storage` /
  BroadcastChannel / visibility revalidation exists anywhere.
- P0-5: A's composer drafts + export dump surface in B's session
  (`DRAFTS_KEY`, `dumpStore` `session.ts:132-143`, never cleared).

**P1 (user-visible staleness requiring refresh):**

- P1-1: failed hydrate lies indefinitely; sidebar renders **nothing**
  (memory rows gated by `chatRowsLive`, `Pesdac.tsx:1807-1838`), no
  auto-retry ever fires. The pinned "failed hydrate keeps the memory paint"
  test asserts store contents, **not** what's rendered.
- P1-2: adopt partial-write duplicates chats on retry — acknowledged in
  code (`session.ts:1184-1188`), unhandled, no idempotency keys.
- P1-3: `renameChatBacked` snapshots/restores the **entire list**
  (`session.ts:913,928`), wiping concurrent confirmed ops on other chats.
  Pin/archive correctly restore per-row (`989-992,1048-1051`).
- P1-4: rename in flight + `deleteChatBacked` succeeds + rename 404s →
  rollback resurrects the deleted chat. Resolve paths never check code
  membership (`917-924,978-985,1032-1044`).
- P1-5: concurrent renames resolve out of order — last-resolver-wins, not
  last-intent-wins; success-reconcile stamps whichever resolved last with no
  `updatedAt` compare despite the field existing.
- P1-6: slow initial history load wholesale `setOverlay` (`session.ts:1130`)
  wipes a just-sent message from paint; user resends → duplicate. Same shape
  in edit/regenerate `fromSeq` derived from overlay length
  (`ThreadView.tsx:1104,1255`) vs server `seq=max+1` (`chats.py:246-280`).
- P1-7: hydrate fetches at most 50 unarchived chats; rest (and all archived)
  vanish with `ready` set. Bare `apiListChats()` (`session.ts:1283`) →
  server defaults `limit=50, archived=false` (`chats.py:140-144`); archived
  rows excluded from `serverCodes` so migrate never runs, then `c:`
  key-sets retired unconditionally (`session.ts:1259-1266`), dropping archive
  intent. Messages: bare `apiListMessages` → `limit=200, offset=0, seq asc`
  shows the **oldest** 200; newest turns invisible.
- P1-8: no revalidation within an identity — other-device/tab deletes and
  edits never arrive. `already` short-circuit (`session.ts:1274`) has no TTL
  or server-timestamp check; `loadChatMessages` early-returns on `ready`.
- P1-9: bfcache / back-forward restores logged-out paint with a
  live-looking shell. No `pageshow`/`visibility` revalidation anywhere.
- P1-10: chat-path 429s never retried, `Retry-After` never read
  (`auth.ts:1199-1215`); only the onboarding check has a bounded 429 policy,
  and its caller passes no `retryAfterMs` (`OnboardingDialog.tsx:156`).

**P2 (transient, still adversary-usable):**

- P2-1: skeleton shape leaks A's chat distribution to B (deliberately
  un-namespaced, `Pesdac.tsx:861-863`; accepted residue `970-971`).
- P2-2: token TTL is client-clock-only (`TOKEN_TTL_MS` vs `Date.now()`,
  `auth.ts:1097-1111`), no server `exp`.
- P2-3: unknown message payloads silently dropped from history
  (`messageToBlock` null-filter, `session.ts:851-871`) — looks like
  pre-delete messages, no signal.
- P2-4: persisted-island `epochAtMount` staleness
  (`transition:persist="pesdac-shell"` never remounts) — safe today only
  because the live session owns the post-pending branch.
- P2-5: `apiDeleteAccount` clears auth cache but not chat/profile-seed
  stores (`auth.ts:1369-1376`); re-signup in the same heap inherits the
  deleted account's paint and can adopt it (feeds P0-4).

## 5. Proposed architecture

**Fix 1 — identity-scoped store reset (kills all P0s + P2-1/P2-5).**
Add `resetChatStoreForIdentity()` in `session.ts`: clears `CHATS_KEY`,
`OVERLAY_KEY`, `c:` pin/archive refs, `messageStates`, `chatHydratedKey` +
pending markers, all three error signals, drafts, and the three
`localStorage` snapshot keys. Call it from the single choke point
`clearAuthCache()`/`apiLogout`. Ordering inside `hydrateChats` preserved:
capture guest adopt-candidates → reset → adopt → list-replace, so genuine
guest→login upgrades keep working while post-logout leftovers (which carry
server flags, so they're distinguishable from true guest rows) are never
adoptable. Skeleton snapshots: **wiped on every identity transition** (part
of the reset) plus a 24 h age cap on writes — decision locked (§10.1).
Namespacing was rejected: snapshots are read in the loading window when the
identity is unknowable by design, so a namespaced read would need a
last-user pointer that reintroduces the exact leak being fixed. Cost of the
wipe is one default-shape skeleton flash on next login — acceptable.

**Fix 2 — generation + identity guards on every resolve (kills
P0-2/P0-3, P1-4/5/6).** Extend the proven profile-seed pattern
(`getAuthEpoch() !== epochAtStart → return`, `Pesdac.tsx:575`) to:
`loadChatMessages` resolve (drop unless identity still current AND code
still in store; merge, don't wholesale-replace, against post-dispatch
appends); container-op reconciles (apply server row only if no newer local
intent — compare `updatedAt`; check membership before any rollback, so
delete-then-rename-404 can't resurrect); token-mint cache write (drop unless
epoch unchanged; minimum one-liner: clear `inFlightToken` in
`clearAuthCache`).

**Fix 3 — per-entity rollback + complete hydration (kills P1-3/5/7).**
Make rename snapshot/restore one row like pin/archive already do. Make
`hydrateChats` request archived rows explicitly and follow
`pagination.total` past `limit=50` (page loop, still fetch-once-per-identity
— no polling introduced); same for the >200-turn tail (wire the existing
`apiListMessagesPage` tail-window the spec comment already describes,
`chat-sync.ts:49`). If paging is deferred, refuse `ready` while truncated
and show the existing error affordance instead of a false-complete list.

**Fix 4 — foreground-gated revalidation, no polling (kills P1-8/9).**
`pageshow` always re-proves the session before painting rows;
`visibilitychange` → visible refetches hydrate (+ open thread messages) with
a 60 s coalesce floor so rapid tab-toggling can't storm the API. Decision
locked (§10.3): no 10-minute age bookkeeping — staleness only matters for
visible UI, and a hidden tab is unobservable by definition, so
refetch-on-foreground with a 60 s floor is effectively never-visible-stale.
Cross-tab logout broadcast via a single `storage`-event ping (tiny, one key,
written only on logout) so sibling tabs drop caches immediately. No
intervals, no realtime.

**Fix 5 — backend contract additions (small, server-side — approved, §10.2).**
(a) Adopt idempotency: client generates one UUID per guest chat
(`clientAdoptKey`), sent in `POST /chats` body; server stores it with a
per-user unique constraint; on conflict returns `200` with the existing row
instead of creating a duplicate — kills P1-2 permanently. Frontend-only
mitigations were rejected: exact-once adoption is unachievable without
server cooperation. Phased after frontend Fixes 1–4. (b) Honor `Retry-After`
client-side for chat 429s with one bounded retry (kills P1-10). (c) Wire or
remove the unwired retention-purge worker (`chats.py:78-103`) since
"deleted" rows that never purge are stale-by-policy.

## 6. TTL / eviction policy (proposed, per layer)

| Layer | Policy |
|---|---|
| Chat/message memory | no TTL within identity; **hard reset on every identity transition**; cap overlays per chat (keep tail ~500 turns, server is source for scrollback) |
| `messageStates` | `ready` valid within identity until foreground refetch (60 s coalesce floor) or any write to that chat, then refetch |
| Identity rows (`me`/`profile`/accounts) | no TTL; invalidate on `refresh*` + transition (today's mechanism, keep); add missing `refreshProfile()` after `apiUpdateProfile` PATCH |
| Bearer JWT | keep 5-min client TTL **plus** honor server `exp` with skew margin; mint cache write epoch-guarded; `inFlightToken` cleared on transition |
| Skeleton snapshots | wiped on every identity transition + 24 h age cap on writes (§10.1) |
| Backend JWKS/rate-limit buckets | keep; fix JWKS update-not-replace eviction of rotated-out keys |
| HTTP caching | still none for authenticated routes (correct — authenticated responses stay `Cache-Control: private, no-store`) |

## 7. Invalidation matrix (event → what dies)

| Event | Dies |
|---|---|
| login / signup / social / logout / 401 / delete-account | token (+inflight), me/profile/accounts, **entire chat store**, message states, hydrate markers, all error signals, drafts, snapshots |
| hydrate success | hydrate/create signals, `messageStates` (today's clear, keep) |
| per-chat write success | per-chat signal; reconcile row by `updatedAt` |
| per-chat write failure | nothing except the signal; rollback confined to that row |
| sibling-tab logout ping | same as logout row above, minus navigation |
| visibility/pageshow (foreground) | session re-proof; hydrate refetch (60 s coalesce floor) |

## 8. Acceptance criteria (each maps to a regression test in `frontend/tests/` style)

P0: B-login-after-A-logout paints server-list-only; mint-during-logout
never caches; cross-identity message resolve drops; post-logout leftovers
are never adopt-POSTed; drafts/export empty for new identity. P1: failed
hydrate renders retry affordance (not just store contents); adopt retry
creates exactly one server row; rename-fail preserves concurrent pin;
delete-then-rename-404 keeps chat gone; reverse-order renames end at last
intent; send-during-load keeps the sent turn; `total: 73` stub pages fully
or refuses `ready`; server-side delete surfaces on visibility refetch;
`pageshow persisted` re-proves before painting rows; 429 schedules one
bounded retry. All existing 197 tests stay green.

## 9. Rollout (smallest-diff order, no redesign)

1. Fix 1 (one new function + choke-point call + snapshot wipe/age-cap) +
   its 5 P0 tests.
2. Fix 2 (epoch/membership guards at ~4 resolve sites) + race tests.
3. Fix 3 (rename per-row rollback; paging loop behind existing helpers).
4. Fix 4 (pageshow/visibility hook + logout ping) + P1-8/9 tests.
5. Fix 5 (backend idempotency key + `Retry-After` consumption).

Never touch: `chat-sync.ts` thin wrappers' no-cache contract,
`ThreadHistoryLoader.tsx`, theme, global CSS.

## 10. Open questions — resolved (locked)

1. ~~Namespace vs wipe for skeleton snapshots?~~ → **Wipe on every
   identity transition + 24 h age cap.** Namespace rejected (§5 Fix 1):
   unreadable in the unknowable-identity window without a last-user pointer
   that reintroduces the leak.
2. ~~Frontend-only, or backend idempotency contract?~~ → **Approved.**
   `clientAdoptKey` UUID contract per §5 Fix 5, phased after frontend
   Fixes 1–4. Exact-once adoption is impossible frontend-only.
3. ~~10-min age vs every-foreground refetch?~~ → **Every foreground with a
   60 s coalesce floor + `pageshow` session re-proof** (§5 Fix 4). Hidden
   tabs are unobservable, so this is effectively never-visible-stale with
   no age bookkeeping and no fetch storms.

## 11. External dependency evaluation — recommendation: none

Evaluated, all rejected for now (all free/MIT — cost is not the issue,
correctness ownership is):

- **TanStack Query / SWR (client fetch-state):** solve ergonomics (dedup,
  retries, focus refetch, `useInfiniteQuery` paging) — not correctness. Our
  P0s need a transition choke-point `clear()`, identity-scoped keys, and
  resolve guards regardless of library; the library doesn't supply them.
  Adopting it means porting the entire hand-rolled store (customs, overlays,
  pins, drafts, optimistic rollbacks) — a large rewrite against the
  smallest-diff rule, for zero additional staleness guarantees.
- **Zustand + persist (client state):** persistence is the opposite of what
  we need — our residue bugs come from state surviving too long, not too
  little.
- **Redis / Upstash / any backend cache:** no evidence of DB pressure; every
  authenticated response must stay `private, no-store` anyway. A shared cache
  would add an invalidation-ownership problem we don't currently have.
- **CDN edge caching for API:** same reason — authenticated per-user
  responses are uncacheable by design. Static assets stay on the host CDN
  as today.

Revisit triggers: adopt TanStack Query for *new* query surfaces only (never
a store rewrite) if background-refetch needs outgrow Fix 4; add Redis only
on measured p95 latency evidence with a per-user key prefix + write-through
invalidation owned by the routers.
