# Section E findings audit (offline & slow network, O1–O9)

Date: 2026-09-15. Scope: `frontend/e2e/section-e.spec.ts` (10 tests:
O1, O2, O2b, O3, O4, O5, O6, O7, O8, O9 — all passed, 2.6 min
single-worker) + committed archive `frontend/e2e/hars/o9.har`
(~4MB, regenerated every O9 run). No app code changed.

Numbering continues the Section D audit: app bugs B28+, test gaps
T41+, ops O9+. Section E deviations D30–D33 live in the spec header.

Related: `frontend/src/lib/outbox.ts` (flush, cap, fatal, scheduler),
`frontend/src/lib/outbox-db.ts` (IDB shape), `frontend/src/lib/session.ts`
(persist paths, `chatSyncErrors`, skeleton predicates),
`frontend/src/components/chat/ThreadView.tsx` (status ternary, pill copy),
`frontend/src/components/Pesdac.tsx` (snapshot-gated skeletons).

Severity legend: **stop-ship** / **release-blocker** / **polish** /
**test-gap** / **ops** (same as prior audits).

---

## B. App bugs (real, filed for after the full run)

### B28 — "Couldn't save that message" goes stale after successful background sync (polish)
The worker flush never clears `chatSyncErrors` (only live persist /
truncate / full resets do — `session.ts`, verified by grep). O2 pins
it: three offline sends fail honestly, reconnect lands all three
(journal-proven, pill total back to 0) — and the composer status
still shows "Couldn't save that message. Try again." until the next
live send or reload. A persistent false error in the exact slot the
user looks at for sync state. Self-heals, but it is the kind of lie
that teaches users to ignore the status line.

### B29 — Eviction + fatal pill suffixes are nearly unobservable in the natural flow (polish)
The status ternary ranks sync-error above the pill, and the sync
error is set on exactly the sends that fill the outbox (O4) or doom
an op (O5). The only in-session clearer is a later live-send
success; reload clears the error but ALSO wipes the memory-only
`evictedCount` and rebuilds a record-less queue (fatal revives on
boot). So the two suffixes the plan cares about ("1 oldest dropped
(openbox full)", "1 failed and won't retry until reload") are hidden
by the error in precisely the sessions that earn them. O4/O5 prove
the counts and copy are correct via choreographed clears — the data
is right, the surfacing is starved. Fixing B28 (clear the sync error
on worker-flush success) likely fixes this too: the pill with its
suffixes would surface the moment the flush lands.

### B30 — Slow chats-list shows no pending signal on fresh profiles (polish, documented as designed)

`shouldShowChatListSkeleton` returns true while hydrating, but every
sidebar skeleton block renders `rows` from the localStorage snapshot
— and "first-timers see zero skeletons" by explicit design
(`Pesdac.tsx`). O7 proves the consequence: with the list delayed
2.5s on a fresh profile, no "Loading chats" ever renders; the
sidebar just sits on static demo rows until customs pop in. Returning
users (snapshot planted) get the skeleton. Deliberate anti-fake-row
trade-off, but the predicate says "show" while the row counts say
"nothing to show" — a decoupled list-level signal (or documenting
the gap) would close it.

Resolution (2026-09-18): documented as designed, no code change. Any
visible signal would alter the Playground-exported sidebar (the demo
rows already render disabled until user-ready, which is the loading
cue in the common case), and the pop-in is self-evident — rows
appearing is not a state that reads as "you have no chats". Revisit
only with an explicit sidebar loading pass.

### B34 — Superseded Astro transition leaks an unhandled rejection + bogus toast (polish, filed)

(Numbered B34: filed after the Section F audit had already claimed
B31–B33; B35 remains free.)

Two client navigations landing back-to-back (R8: clear-all bounce to
`/new` racing the next send's navigate-to-thread) make Astro skip the
in-flight transition, and the skip rejects unhandled:

console: Unhandled rejection: AbortError: Transition was skipped. skipTransition() called
pageerror: Transition was skipped. skipTransition() called

The user-visible half is real: the AppToasts unhandled-rejection net
fires a bogus "Something went wrong…" toast over a flow that worked
(R8's error-context snapshot proves toast + painted answer together).
R8 failed its clean-env gate 2–3 times in ~8 runs (~25–30%).

Not fixable at our call sites (proven): a `safeNavigate` wrapper
catching the skip-shaped AbortError rode the build for two full-D
runs and R8 still flaked 1/5 — the rejecting promise is
Astro-internal (`router.js`: the native `finished.finally(...)` /
`updateCallbackDone.finally(...)` chains have no catch, and
`navigate()` resolves the *new* transition, so the skipped
predecessor's rejection is unreachable from our code). The message
text is Chromium-native ("Transition was skipped" exists in neither
the Astro nor Astryx bundles). Serializing our navigations would not
fully close it either (`navigate()` resolves at DOM-update, while a
second navigate during the animation phase still skips). Reverted the
wrapper; no code change. Options when this is next touched: Astro
upgrade (may already handle `finished` rejections upstream — do NOT
upgrade without instruction), or a targeted swallow in AppToasts'
unhandledrejection listener (hides the noise but risks masking real
bugs; and whether preventDefault suppresses Playwright's pageerror is
unproven). R8's functional pin still holds — the race is gate-only
noise.

---

## T. Test-suite weaknesses (app is fine, proofs are thin)

### T41 — Status-ternary precedence hides the pill (bitten 3×)
`sendError` > `syncErrorMessage` > pill. O1/O4/O5 all failed first
by asserting pill copy while an error status outranked it. Rule: to
see the pill, first clear the error (live-send success) or reload
(memory-only errors) — and know which waiter each situation needs.

### T42 — Eager mock fallbacks apply side effects under failure legs (bitten, fixed)
`run(leg, fb)` evaluated the `fb` IIFE as an argument — so EVERY
append wrote a journal row even when the leg returned 500 (O5's
"journal stays empty" failed with a phantom row). Section-e's copy
now takes a lazy `() => Fulfill` thunk. Section-d's copy is STILL
eager — it never bit there (no failure-leg + journal-empty assert
coincides), but port the thunk if that file is ever touched.

### T43 — Journal content is a wire Block, seeded strings stay raw (bitten 2×)
Live appends store `toWireBlock` output (user text at
`bubbles[0].text`); IDB/journal seeds store whatever was put. The
`journalTexts` helper digs the Block path; O2b asserts its raw
string directly. Pick per-row-kind, never assume.

### T44 — Slow legs must sleep node-side + unroute at teardown (bitten)
`page.waitForTimeout` inside a route handler throws "Test ended"
when a late refetch (interval revalidation exists) outlives the body
— O6 died at teardown with every assert green. Node `setTimeout` in
legs + `unrouteAll({behavior:"ignoreErrors"})` after final asserts.

### T45 — `setOffline(true)` bricks doc nav under interception (probed)
`net::ERR_INTERNET_DISCONNECTED` even with fulfills registered —
route interception cannot save the initial navigation. Full-offline
shape is flags-abort on the legs (byte-identical TypeError at the
fetch layer, D30). Only `routeFromHAR` replay survives `setOffline`
(because it serves the document too).

### T46 — `routeFromHAR` serves first-match for duplicate URLs, never advances (proven)
HAR inspection showed two identical messagesGet recordings (1 row,
then 3); replay + reload still rendered the 1-row recording. The
archive's canonical state must be in the FIRST recording — O9 seeds
both rows upfront instead of depending on post-drill shape.

### T47 — Turn persists are void-fired; caret-clear ≠ durable (bitten, flaked 2×)
`appendAndPersist` fires `persistAppendedBlock` without awaiting —
reloading the instant Stop disappears can cut the appends mid-flight
(O9 showed 1 article instead of 2, intermittently). Gate
reload-after-stream on the messagesPost counter (2 appends + quiet
via `waitForPostsStable`), never on stream settle alone. O2/O3/O5
are immune by construction (rollback/error/success UI already waits
out the chain).

### T48 — Big-outbox flushes run seconds; gate reconnect flips on stability (bitten)
Send#1's 200-op offline flush (IDB write per op) was still running
when O4 flipped online — the tail delivered and moved the pill
(stale-200 snapshot passed, store read caught mid-drain at 171).
`waitForPostsStable` (1 live + 200 flush = 201) before the flip.

### T49 — Custom delayed legs must mirror the archived filter (bitten)
The sidebar fetches list + archived views; O7's unfiltered leg
double-rendered the row (strict-mode violation on 2 links).

### T50 — `messageToBlock` fails closed on non-Block payloads (bitten)
A journalSeed row with raw-string content renders NOTHING (0
articles, no error — fail-closed by design). Seeds must be wire
Blocks. Same family as T43, opposite direction.

### T51 — API base is :8000, page is :4323 (observed in HAR)
Route globs (`**/api/v1/**`) are host-agnostic, but the request-tape
listener must filter hostname deliberately, not assume one origin.

---

## O. Ops risks

### O9 (ops) — Section E is cheap: 2.6 min single-worker
Full e2e is now ~18 min (B ~12 + D 2.4 + E 2.6 + smoke/a11y). The
O4/O6 split recommendation stands; Section E needs none (O6's 60s
throttle + O8's 45s scheduler are the long poles and both are
inherent waits).

### O10 (ops) — `o9.har` (~4MB) is committed and self-refreshing
`update:true` regenerates it every O9 run, so it cannot go stale —
but every O9 run also REWRITES it (expect HAR diff noise on any
bundle change; don't hand-edit it). If bundle growth pushes it past
~10MB, switch recording to `urlFilter` + accept a thinner offline
proof.

### O11 (ops) — Section-d's mock still has the eager-fallback shape
See T42. No action until that file is edited; noted so the next
failure-leg test there doesn't re-bite.

---

## Checked and cleared (reviewed, no issue)

- **FIFO + exactly-once (O2):** 3 offline sends → one online kick →
  journal in send order, 3 unique `clientMsgKey`s, reload repaints
  all three once. The idempotency-key story holds end to end.
- **Create-before-append (O2b):** equal-`createdAt` seeded pair
  drains create-first on the wire tape (request-listener order, not
  legs — legs can't delegate to the fallback).
- **Reload survival (O3):** 2 ops durable in IndexedDB, boot-kick
  replays and fails honestly while offline (pill counts 2),
  reconnect delivers FIFO.
- **Cap (O4):** 201st op evicts `o4seed-0`, newest 200 kept
  (store-read proof), exact "200 unsynced — … 1 oldest dropped
  (outbox full)." copy.
- **Fatal lifecycle (O5):** 6th failed round settles fatal (bounded:
  live + rounds, then silence), exact "… 1 failed and won't retry
  until reload." copy, kicks frozen, reload revives and lands.
  (Revival appends at the end — chronological inversion vs send
  order is inherent to offline queueing, not filed.)
- **Slow-3G (O6):** real throttled transport (bundle genuinely
  slowed) + delayed boot legs: "Loading composer" → live composer,
  "Loading chat history" → settled thread, zero errors.
- **List-only slowness (O7):** composer live while the list hangs;
  skeleton → real row once the snapshot is planted (see B30 for
  the fresh-profile half).
- **Scheduler (O8):** the 30s interval auto-flushes with ZERO manual
  kicks (counter moves while still offline), reconnect delivers —
  no manual retry anywhere in the chain.
- **HAR replay (O9):** welcome + seeded thread render truly offline
  (`notFound:'abort'` + `setOffline`) — zero hidden live deps.

---

## Resolution (2026-09-18)

- **B28 fixed (by D's B26 effect, proven in E):** the drain-triggered
  messages reload succeeds → `loadChatMessages` success exits both
  delete the sync error — the stale "Couldn't save that message"
  clears with no live send and no reload. O2 rewritten to pin it:
  pill absent + 3 articles painted pre-reload (the repaint-without-
  reload is only reachable through the clearing load, so it IS the
  clearing proof — bare-text error absence is unassertable because
  the vendor toasts share the copy and outlive the flush), reload
  stays exactly-once.
- **B29 fixed as predicted:** with the error clearing on drain, the
  pill + eviction/fatal suffixes surface instead of hiding beneath
  it. O4/O5 unchanged and green (their choreographed clears still
  hold; fatal never drains so the effect correctly never fires).
- **B26 hardened (live-guard):** the drain-repaint skips while a live
  turn streams — the live path owns the paint then (its persist
  settles the error on success, re-arms on failure), and a
  concurrent reload could clobber its optimistic overlay blocks.
  Residuals documented in code: drain-while-streaming leaves
  delivered turns unpainted until the next load, and O3's
  no-error-at-drain shape still needs a reload to repaint (pill
  clears honestly; not a false signal).
- **B30 documented as designed** (see above) — no code change.
- **B34 filed** (see above) — Astro-internal, no code change.
- **O11 closed:** section-d mock ported to lazy-thunk fallbacks;
  section-d re-verified green on the ported mock.
- Post-commit hardening (rides the F commit): every cookie test now
  mints its own session first (`ensureSeed`) — the F campaign's real
  logouts murdered the shared seed row mid-week (8/10 red, zero code
  change; see F audit T69). Suite behavior unchanged, hermetic now.
- Post-commit hardening 2 (rides the H commit): O5's kick loop is
  now kick-until-count (≥6) plus 3 unconditional extra rounds. Two
  mechanisms from `outbox.ts`, both bitten: flushes coalesce under
  load (`flushInFlight` guard) so fixed 8×800ms under-attempts on
  slow full-run machines (count flake), and the fatal record paints
  on flush announcements (`announceFlush`) so stopping the instant
  the count hits 6 leaves the UI stale (deterministic no-suffix
  fail). No app change — test matches the worker's actual contract.
- Verify: `tsc` clean (same 3 pre-existing errors elsewhere), unit
  378/378, section-e 10/10, section-d 19/19 (plus R8 ×5 stress:
  4/5 — the one red is B34's Astro race, gate-only noise),
  section-b 26/26, section-c 26/26, section-a-authed 24/24,
  section-a + smoke 12/12.

## Recommended fix order (after the full run)

1. **B28** (stale sync error after background sync) — the only
   user-facing false signal in the section; fix in the worker
   success path (clear `chatSyncErrors` for drained codes).
2. **B29** (suffix observability) — re-verify after B28; likely
   fixed as a side effect, else surface the pill alongside the
   error instead of beneath it.
3. **B30** (fresh-profile list signal) — polish; batch with any
   sidebar loading pass.
4. **O11/T42** (lazy fallbacks in section-d) — process, before the
   next failure-leg test lands there.
