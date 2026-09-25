# Section K findings audit (data integrity, D1–D12)

Date: 2026-09-16. Scope: `frontend/e2e/section-k.spec.ts` (10 tests,
10 passed, 1.5 min) — D4/D5 by reference to their home sections
(C26, R10), D1/D2/D3/D6/D7/D8/D9/D10/D11/D12 live here. Real
BetterAuth + Neon throughout (D6 drives the real login form — needs
BETTER_AUTH_TRUSTED_ORIGINS=:4323 per O26); `/api/v1` mocked all
through. No app code changed.

Numbering continues the Section J audit: app bugs B48+, test gaps
T107+ (the K audit's original T98–T105 collided with the I fix
round's T92–T99 and the J round's T100–T106 and were renumbered),
ops O29+. Section K deviations D67–D69 live in the spec header.

Related: `backend/app/routers/users.py:42-63` (real export shape),
`frontend/src/lib/outbox-db.ts` (IDB validation), `frontend/src/lib/
session.ts:684-713` (scope overrides), `frontend/src/components/
profile/sections.tsx` (display-name flow, quiz overrides),
`frontend/src/lib/auth.ts:581-610` (updateDisplayName contract),
`docs/operations/browser-break-it-plan.md` (§K slashed).

Severity legend: **stop-ship** / **release-blocker** / **polish** /
**test-gap** / **ops** (same as prior audits).

---

## B. App bugs (real, filed for after the full run)

### B48 — Corrupt outbox rows are filtered but never compacted (polish, FIXED this round)
D12 proves both halves: the evil row never reaches reads (the valid
op flushed exactly once with it sitting in the store — `list()`
filters correctly), but after ack-removal of the valid op the store
holds exactly `["evil-row"]` — nothing ever deletes invalid rows.
The module doc says "malformed rows are dropped" (outbox-db.ts:20),
which a reader takes for removal. Impact is bounded (browser quota
manages the DB; one row per corruption event), but a `list()` that
also `remove()`s what it rejects closes it in ~5 lines. Re-run D12
with the `toEqual(["evil-row"])` flipped to `toEqual([])` when fixed.
Fix: `list()` deletes rejected rows that carry a string id via the
replay-safe `remove()` (rows without an id cannot exist — keyPath
store rejects them on write); module + method docs updated. D12
re-run: `rowsAfter=[]`, valid op exactly-once.

### (Not bugs — closed during implementation)
- **D11's reload reset is v1 design, not data loss.** Quiz scope
  overrides are documented memory-only (sections.tsx:665-672:
  "dedicated panels are v2"). No per-chat UI writer exists at all —
  the plan's "per-chat" leg is unprovable via UI (unit-only tier).
  Pinned as D67 instead of filed.
- **D7's disabled Save was a test race, not a stuck flag.** A fill
  landing mid post-save re-render reverts; the button correctly
  reflects the reverted (pristine) draft. `fillSettled` (T98).
- **D6's immortal session is mock design, not a logout bug.** The
  mocked sign-out endpoint cannot kill the real cookie (A10 owns the
  logout-POST failure path); local reset is what the reseed proof
  needs, and it holds.

---

## T. Test-suite weaknesses (app is fine, proofs are thin)

### T107 — fillSettled for controlled inputs after saves (bitten)
A `fill` racing a post-save re-render silently reverts (Save stays
disabled — misreads as a stuck `isSavingName`). Refill until
`inputValue()` lands + settle on the saved value before the next
fill. D7 helper; reuse anywhere a fill follows a mutation.

### T108 — Error copy renders twice (bitten)
Field status + assertive live region (the R8 strict-dupe pattern
extends beyond toasts). `.first()` on error-copy asserts.

### T109 — Logout contracts differ per tab (bitten twice)
The ACTOR tab navigates to `/login` (A2: heap wipe + /login); the
in-place gate dialog is the SIBLING-tab contract. D6 asserted the
wrong one, then the wrong text ("Login" vs "Log in"). Assert the
actor's URL, not a dialog, not a substring.

### T110 — Settle reconnect navigation before reloading (bitten)
`setOffline(false)` flushes → the app navigates to the adopted
thread; reloading mid-navigation detaches the frame
(`ERR_ABORTED`). Poll the request counter + thread URL first, then
reload. D12.

### T111 — Astryx roles that must not be guessed (bitten 3×)
Switch = `role=switch` ✓ (that guess held); SegmentedControl =
radiogroup + `role=radio` (not buttons); Selector options carry full
labels ("Operating Systems", not "OS" — profile-options SUBJECTS);
the quiz Subject selector is the SECOND "Subject" combobox (exam
block owns the first).

### T112 — Per-scope toggles need per-scope order (bitten)
The quiz Subject selector and format radios gate on
`customEnabled` of the CURRENT subject — enabling under CN then
switching to OS rightly disables everything. Toggle per scope in
scope order (CN on → pick OS → OS on → set format). The disabled
states probed along the way are correct behavior, not bugs.

### T113 — Override markers are scope-filtered (pattern)
"Use default" buttons show only for the selected subject's scopes
(2 under OS, 1 under CN, 0 after reload) — counts ARE the resolver
proof. A global count assert would have failed honestly; scope the
counts to the selected subject.

### T114 — Mocked sign-out makes session polls vacuous (bitten)
`get-session` stays alive after a mocked sign-out by construction —
polling it for "null" can never pass. Assert local effects (URL,
gate, heap) for logout; leave server-session death to A2/A10-style
legs with a live sign-out path.

---

## O. Ops risks

### O29 — Section K: 10/10 in 1.5 min
Cheapest full section since G. Full e2e now ~40 min with the soak,
~30 min without.

### O30 — webServer 120s timeout is transient, not fatal
One invocation failed to boot preview in 120s with the port free;
immediate rerun green. If CI hits this, retry-once the webServer
before investigating the app.

---

## Checked and cleared (reviewed, no issue)

- **D1:** file deep-equals the served body (byte-fidelity, not just
  shape): version 1, timestamped, own profile, 2 complete chat rows
  (code/subject/title/flags/preview/msgCount/lastSeq); toast +
  open dialog after.
- **D2:** "This cannot be undone." pinned (no undo exists);
  DELETE /chats → toast → /new bounce; both rows gone before AND
  after reload (server empty); next welcome send creates cleanly.
- **D3:** edit turn 2 of 3 → exactly one DELETE `?from_seq=2`;
  turn 1 byte-intact, edited turn streams, turn 3 fully gone
  (2 user articles); a further send completes to 3.
- **D4/D5:** C26 (draft memory-only) and R10 (burst reload-proof)
  still green in their files; untouched.
- **D6:** PATCH body exactly `{campus: RR, semester: 3, branch:
  CSE(Core), subjects×5, onboardingDone: true}`; UI logout →
  /login → real form login → no setup dialog, Campus "RR Campus"
  reseeded from the mock server row.
- **D7:** wire carries "spaced" (trim proven on the POST body, not
  the pixels); 80 in / 81 out with copy and zero requests; empty
  with copy and zero requests; greeting exactly "What are you
  studying today, E2E?" (first-token template).
- **D8:** update-user 401 → expiry copy via the global flow, zero
  name-error UI, exactly 1 request with no retry storm (unit truth
  display-name.test.ts:202, browser-proven).
- **D9:** empty export parses (version/timestamp/profile-ok),
  toasts, dialog stays open — no 500, no corrupt download.
- **D10:** 3 PATCHes → snapshot `"3"` → reload → 3 pinned rows =
  server (chatsGet 4, past the 60s-coalesce worry via polling) →
  snapshot still `"3"`.
- **D11:** OS shows 2 scope markers + Multi; CN shows 1 marker +
  Single checked (no leak either direction); reload shows 0
  (memory-only kernel, D67).
- **D12:** corrupt row planted raw (bypasses `put` validation, as a
  real disk-corruption would); boot clean on the thread shell;
  valid op flushed exactly once (`chatBodies` length 1 for its
  title); store converges to `[]` (B48 fixed — invalid row
  compacted, valid op ack-removed).

---

## Recommended fix order (after the full run)

B48 (the only app bug) is fixed in the K fix round (this commit) —
kept as the work log:

1. **B48** (compact invalid outbox rows) — `list()` deletes rejected
   id-carrying rows via `remove()`; D12's final assert flipped to
   `toEqual([])` and green (`rowsAfter=[]`).
2. Closed elsewhere before this round: **B47** (send toast via
   toUserMessage) — J commit; **B45/B46** (axe pair), **B39–B41/B43/
   B44** (focus, motion, targets) — I commit; **B31** (origins env),
   **B33** (2FA), **B36** (return-to-target) — F commit. Still open:
   **B38** (Slow-3G gate).
3. Process: **O25** (K12 quarterly pass), **O14** (staging),
   **O28** (J backend procedure), **O30** (webServer retry).

---

## Resolution (fix round, this commit)

- **B48 fixed** (see the B48 entry + item 1 above). No other app
  bug in the section; D11/D7/D6 closed during implementation stand.
- **E4 flake (not a regression):** section-a-authed E4
  (`elapsed > 4000` on the 429-cap leg) failed once in the matrix
  and passed alone + on full-file re-run. The B48 path is a no-op
  without invalid rows (zero extra awaits), so it is
  mechanistically unrelated — likely a live-retry/flush race on a
  loaded machine. Noted, not filed.
- **Verify (final tree):** tsc clean except pre-existing + foreign;
  units 385/385; section-k 10/10; e 10/10; d+i 33/33; smoke 4/4;
  a-authed 24/24; g 11/11; b+c 52/52.
