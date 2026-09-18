# Section D findings audit (races & concurrency, R1–R17)

Date: 2026-09-15. Scope: `frontend/e2e/section-d.spec.ts` (17 passed,
2.4 min single-worker). No app code changed; Section D is pin-actual
with a heavier-than-usual haul of harness-corrected mistakes (each
below was evidence-led, snapshot- or probe-proven).

Numbering continues the Section C audit: app bugs B24+, test gaps
T33+, ops O7+. Section D deviations D24–D29 live in the spec header.

Related: `docs/operations/browser-break-it-plan.md` (§D fully slashed),
`frontend/src/components/chat/ThreadView.tsx` (timers, finalize,
startTurn guard, Retry wiring), `frontend/src/components/Pesdac.tsx`
(dead-link bounce, confirmDelete, Ctrl+K, handleLogout),
`frontend/src/lib/outbox.ts` (flush triggers, idempotent replay),
`frontend/src/lib/auth.ts` (token cache, 401 path).

Severity legend: **stop-ship** / **release-blocker** / **polish** /
**test-gap** / **ops** (same as prior audits).

---

## B. App bugs (real, filed for after the full run)

### B24 — Stop before the first streamed words silently drops the assistant turn (release-blocker)
`finalizeTurn` with empty `live.text` appends NOTHING (no partial, no
marker, no error block — `ThreadView.tsx:1130-1151`: empty text +
no retryText = pure `setLive(null)`). The user message persists, so
the thread shows a Q that will never get an A — and the
trailing-user regenerate fallback "has no button of its own"
(ThreadView comment), so the stranded question has no recovery
except retyping. R1 caught this red-handed twice (user×2, asst×1,
snapshot-proven full second answer, zero partial) before the test
was made deterministic by waiting for first words. The window is
small (~0.85s: 700ms tool beat + 150ms first step) but exactly the
window a fast "oops, wrong chat" Stop lands in. Fix shapes: persist
an interrupted marker even for empty partials, or give the stranded
Q a retry affordance. C8 never saw it (Stop at 2.5s, words flowing).

### B25 — Profile dialog goes stale cross-tab (polish)
The dialog reads the LOCAL profile store; nothing invalidates it
cross-tab. R13 proves: A writes RR, B writes EC (server LWW correct,
2 PATCHes), B reopens to EC, but A reopens to its own stale RR —
convergence only via reload (server re-seed). Same class as the
solved outbox cross-tab story (BroadcastChannel + lease), minus a
solution. Low stakes for campus, higher if display-name ever
disagrees across tabs.

### B26 — Reconnected outbox flush doesn't repaint (polish, D28)
R14 proves the honest half (offline send rolls back + toasts, one
`online` kick lands exactly one journal row, reload shows it once)
— but the delivered turn stays invisible until that reload. The
toast said "couldn't save"; the message IS saved now; the UI never
says so (the sync-error banner clears, nothing replaces it). Either
repaint the flushed turn or surface a "synced" signal.

### B27 — Sidebar lists format-invalid codes as dead-end links (polish)
Seeded `r10b1`/`r13p1`/`r16t1` (5 chars; the route requires 6 via
`isChatCodeFormat`) render as sidebar links that open the WELCOME
shell instead of the chat — no error, no bounce, wrong content.
Only reachable with corrupt data today (the server issues 6-char
codes), but the sidebar validates nothing while the route validates
strictly. Trivial hardening on either side; filed because it cost a
full bisect to clear (see T33).

---

## T. Test-suite weaknesses (app is fine, proofs are thin)

### T33 — Seed codes MUST be 6-char lowercase alnum (bitten hard)
`isChatCodeFormat` gates thread resolution; the sidebar lists
anything. Three tests (R10/R13/R16) failed identically on 5-char
codes before the isolated 3-code probe proved it. Convention from
here on: `r` + section letter + 4 alnum (e.g. `r10b11`).

### T34 — Streaming header markers are timing, not structure (bitten)
The incremental Markdown parser withholds partial blocks, so
"chapter view" presence mid-stream proves nothing stable; R1 failed
twice on `nth(1)` for a turn that was provably streaming. Pattern
used everywhere now: final-sentence closers ("test you on it",
"dig into it together" — a stopped prefix can never carry them) +
article counts + journal roles + reload.

### T35 — Know your responder templates
The simulate-error answer is its own template with NO "Quote it
first" marker. R2/R3 failed on the wrong marker for a rerun the
failure snapshot proved had completed. Fixed by asserting the
template's own closing line.

### T36 — Toasts render twice by design
Notification region + aria-live region (R8, R11, R12 use `.first()`).

### T37 — Selector listboxes may stay open (bitten)
An open listbox makes `getByLabel("Campus")` match 3 elements
(combobox + clear-button + listbox — the last literally labeled with
the selected value, which first looked like a value bug). R13 now
closes listboxes conditionally and reads the uniquely-roled
combobox's textContent. (Related: the value paints into an
aria-hidden span — assert text content, never visibility.)

### T38 — Open dialogs eat post-navigation clicks (bitten)
R8's welcome-send clicked for 90s into the still-open profile
dialog's backdrop (the Astro-transition-overlay theory was wrong;
the backdrop was the cause). Close dialogs before interacting with
what's behind them.

### T39 — `--grep R1` matches R10–R17
Substring matching makes "solo" runs lie. Use `--grep "R5 "`
(trailing space) or exact titles for single-test runs.

### T40 — `.then` snapshots of the error array are vacuous (bitten, fixed)
R5/R13 collected two-page errors via
`void collectErrors(p).then(e => errorsX.push(...e))` — the `.then`
runs on the just-returned (empty) array while listeners keep pushing
into the original, so both clean-env gates passed trivially. Fixed
to `await collectErrors(p)` (live ref); both re-run green WITH the
gates actually armed.

---

## O. Ops risks

### O7 — Full e2e is now ~15 min single-worker
section-d 2.4 + earlier ~12. Section D is cheap (few multi-stream
tests); the O4/O6 split recommendation stands unchanged for
section-b/c.

### O8 — Logout tests need the get-session kill (seed-guard consequence)
The mocked sign-out is force-200, so the real BetterAuth session
survives and `/login` bounces to `/new`. R6 kills
`**/api/auth/get-session*` after the click to simulate the
revocation the fake-200 skipped. Section F (auth) will reuse this
pattern — it belongs in a shared helper when the next suite lands.

---

## Checked and cleared (reviewed, no issue)

- **Retry concurrency (R2/R3):** the error block's Retry stays
  mounted during reruns, but `startTurn`'s `if (live) return`
  eats mid-rerun clicks and React re-renders between rapid clicks
  eat double-clicks — snapshot-proven single fresh answer both
  ways. The entire concurrency control is one guard; it holds.
- **Two-tab same-chat (R5):** shared localStorage overlay +
  shared journal, both tabs send within a second — 2 user + 2
  assistant rows, reload converges with zero dupes. (The "dupe"
  scare was the assistant bold echo double-matching `exact:true`
  — article-scope text queries, per the C1 lesson.)
- **Logout (R6):** gate holds (with the O8 simulation), stream
  dead (Q-only journal), FULL counter object frozen — the login
  shell is quiet post-settle.
- **Ctrl+K / navigate-away (R7/R4):** unmount-cancel drops the
  partial silently (D24 — only Stop keeps partials); old chat
  Q-only, new chat pristine, no late appends after 2.5s.
- **Delete open chat (R9):** confirm → /new, row gone, zero posts
  after (no zombie composer).
- **Rename/pin/archive burst (R10):** three PATCHes with exact
  payloads, last-wins, archive-unpins by design, reload-proof.
- **Offline profile/onboarding/export (R11/R12/R15):** honest
  errors with exact copies pinned (OFFLINE_COPY / "Couldn't save
  your name" fallback), drafts and wizard picks retained, retry
  on reconnect lands (incl. a real file download for export).
  R11's retry uses a crafted update-user 2xx — zero Neon writes.
- **Token dedupe (R16):** exactly the shape the plan allows
  (≤2 mints, Bearer observed in use).
- **Expired JWT (R17):** E6-shaped fast path, single doomed POST,
  writes+mint frozen (reads legitimately revalidate on /login).
- **Exactly-once flap (R14):** 5 toggles, one journal row, reload
  shows it once — idempotency keys do their job.

---

## Resolution (2026-09-17)

- **B24 fixed:** any Stop persists the interrupted marker with Retry —
  `handleStop` always `failTurn`s when live (empty partials render the
  marker with zero bubbles via the existing error path), so a stranded
  Q keeps its recovery. New pin R1b (pre-words stop → marker → Retry
  streams a real answer, journal Q/A/A); R1 unchanged (mid-stream).
- **B26 fixed:** reconnect flush repaints — new
  `invalidateChatMessages` (force-reload; plain loads no-op once
  ready) + a ThreadView effect: when the outbox unsynced count drops
  while this thread shows a sync error, clear via reload. The
  successful load clears the error itself, so banner and empty paint
  resolve together. R14 rewritten (repaint without reload, then
  reload-idempotent).
- **B25 fixed (reopen-converges):** ProfileDialog revalidates on open
  (authed only): `refreshProfile` + fresh `apiGetProfile` reseeds the
  local store, so a reopened dialog shows the server truth. An
  already-open dialog does not live-update (documented residual).
  R13 rewritten (p1 reopen shows EC, reload agrees).
- **B27 fixed:** sidebar list paths (`collectRows` + workspace
  customs) skip format-invalid custom codes instead of dead-linking
  to the welcome shell. New pin R10b (deliberate 5-char seed hides,
  valid row lists).
- **Deferred:** O8 (shared logout helper — lands with Section F),
  O7/O4 (suite-time splits — process).
- Verify: `tsc` clean (3 pre-existing errors elsewhere), unit 378/378,
  section-d 19/19 (incl. R1b/R10b), section-b 26/26, section-c 26/26,
  section-a-authed 24/24 ×2 (one timing flake, unreproduced on rerun),
  section-a + smoke 12/12.

## Recommended fix order (after the full run)

1. **B24** (early-Stop drop + stranded Q) — the only item with
   data-honesty bite; small fix (persist the interrupted marker
   even when empty, or afford retry on stranded Qs).
2. **B26** (flush repaint/signal) — same honesty family as B24,
   same area as the outbox UI.
3. **B25** (cross-tab profile staleness) — polish; consider with
   any broader store-invalidation pass.
4. **B27** (sidebar code validation) — trivial, batch with B25.
5. **O8** (shared logout/get-session helper) — process, before
   Section F.
