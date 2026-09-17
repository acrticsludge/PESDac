# Section B findings audit (chat create / send / stop / retry, C1–C26)

Date: 2026-09-15. Scope: `frontend/e2e/section-b.spec.ts` (26 passed,
5.1 min single-worker) + `section-a-authed` E1b un-fixmed (24 passed) +
smoke/section-a/a11y regression (18 passed). Two app bugs were fixed
during implementation (F1–F2 below) because the suite could not exist
without them; everything else is pinned-as-actual and filed for after
the full run.

Numbering continues the Section A audit (`docs/audits/2026-09-15-
section-a-findings-audit.md`): app bugs B9+, test gaps T14+, ops O4+.
Section B deviations D5–D15 live in the spec header.

Related: `docs/operations/browser-break-it-plan.md` (§B fully slashed),
`frontend/src/components/chat/ThreadView.tsx`,
`frontend/src/components/Pesdac.tsx`, `frontend/src/lib/responder.ts`,
`frontend/src/lib/session.ts`, `frontend/src/lib/chat-sync.ts`.

Severity legend: **stop-ship** / **release-blocker** / **polish** /
**test-gap** / **ops** (same as the Section A audit).

---

## F. Fixed during implementation (shipped, with regression pins)

### F1 — Welcome→thread handoff persisted the first turn memory-only (was: release-blocker)
Corrected root cause (the Section A audit's "timer dies in remount"
was wrong — instrumentation proved otherwise): ThreadView's `useAuth()`
starts in a per-instance first-render `"loading"` window (hydration
latch, `auth.ts:259-274`), and the old `[]`-deps autoSend effect froze
that mount closure. The 350ms timer fired fine — with `chatAuth=null` —
so `appendAndStream` took the memory-only branch: bubble painted,
answer streamed, `messagesPost` stayed 0, server never saw the turn.
Fix (`ThreadView.tsx` autoSendReady): consume + schedule only after
identity settles (authenticated OR guest), with the timer owned by the
component-lifetime `timers` registry — a first attempt with an
effect-owned `setTimeout` was eaten by React running the effect cleanup
when `llm` resolving flipped the dep back to false mid-window (second
order of the same bug class). Side benefit: the history-load skip now
works as designed (`messagesGet` is 0 on handoff). Pinned by E1b
(`section-a-authed`) + C1 (`section-b`).

### F2 — Keyless send cleared the composer despite "Text stays" (polish)
`ChatComposer.handleSubmit` calls `onSubmit` THEN `onChange('')`, so the
synchronous `setWelcomeText(text)` restore lost last-write-wins (vendor
code, `ChatComposer.js:145-152`). Both gates (welcome `Pesdac.tsx`,
thread `ThreadView.tsx`) now restore via `queueMicrotask`, matching the
documented intent. Pinned by C3.

---

## B. App bugs (real, filed for after the full run)

### B9 — Bubble-Retry appends instead of replacing (polish, D9)
`startTurn` has no pop — only Regenerate pops (`ThreadView.tsx:1368+`).
Retrying a failed/empty turn streams the fresh answer BELOW the failed
turn; the failed history stays. The plan's "error bubble replaced (not
appended)" does not match. Pinned by C4/C5. Fix-or-plan decision: the
current shape (visible failure history) is arguably better UX than the
plan — decide, don't drift.

### B10 — Retrying a contentless intent loops empty forever (polish, D10)
The responder carries no answer payload for `simulate limit`
(`answer:""`) or `simulate empty`, so forceOk replays the same outcome:
limit→empty block, empty→second empty block. Retry can never escape;
only rephrasing works. Mockup-stage only (a real backend re-runs the
model), but the empty→empty loop has no exit affordance even in
principle. Pinned by C5/C6.

### B11 — Stopped partials are indistinguishable from complete turns (polish, D6)
`handleStop` → `finalizeTurn`: the partial persists as a normal turn
with no "interrupted" marker anywhere on the stop path (only the
simulate-error path renders one). A user cannot tell a stopped answer
from a finished one; reload makes it permanent. Pinned by C8.

### B12 — In-flight streams do not survive reload (release-blocker-adjacent, D11)
The server owns turns only at persist (finalize); the in-flight
assistant turn never persisted, so reload mid-stream restores exactly
one Q and no A. No duplication, no resurrection — honest, but the
plan's "exactly one copy of Q and A" is unachievable until backend SSE
owns the turn. Pinned by C12. Backend-phase work, not a mockup fix.

### B13 — Thread depth mode is session-only, not per-chat (polish, D13)
Ask/Auto/Deep Study is `useState` per mount defaulting from the
profile; reload resets to default. The plan asks to "document actual:
global vs per-chat" — actual is neither (per-mount). Pinned by C15.

### B14 — Find-Esc drops focus to the page (polish/a11y, D15)
`closeFind` has no restore: Esc closes the panel, `activeElement` lands
on the page, not the composer. Keyboard users lose their place on
every find. Pinned by C18. Small fix (focus `composerInputRef` on
close), good a11y win.

### B15 — Copy-transcript confirms inline only, no toast (polish, D8)
"Copied!" flips on the menu item for 1500ms; with the menu closed on
select, the confirmation is nearly invisible. The plan's "toast
confirms" does not match. Pinned by C19.

### B16 — Feedback votes are memory-only (polish, D14)
`pesdac-feedback-v1` is a memory Map: reload clears votes. The plan's
"survives reload" does not match. Pinned by C20. Persuasively
arguable either way (local-only signal by design?) — needs the same
decide-don't-drift treatment as B9/B13.

### B17 — Ordinary creates omit clientAdoptKey (spec call, D5)
The key is adopt-path-only (`chat-sync.ts:99-113`); welcome creates
send `{subject, title}`. The plan's "bodies carry subject,
clientAdoptKey, clientMsgKey" is wrong for the welcome leg. Pinned by
C1. One-line plan fix (or a conscious adopt-everywhere decision).

### B18 — No dictation-denied branch exists (polish)
Denied microphone → honest no-op, composer unaffected, zero errors
(proven by C17) — but also zero signal: the user gets no denial
message. Fine for mockup stage; needs a denial affordance when
dictation goes real.

---

## T. Test-suite weaknesses (app is fine, proofs are thin)

### T14 — Mock must default the archived leg to empty (trap, bitten once)
`listAllChats` merges the live leg with the `?archived=true` leg. An
unbranched mock serves seeds to both → every chat double-lists (both
visible, same tree — a real-looking duplication that cost a full probe
to clear; see "Checked and cleared"). The branch now lives in
`mockBackend` itself with a comment. Archive tests must override
explicitly via `ov.chatsGet`.

### T15 — C13 dominates runtime (~1.6 of 5.1 min)
20 serialized turns × ~4.5s pacing. Inherent to fixed 80ms/word demo
pacing; splitting C13 (or the slow-token tests per A-audit O3) into
their own file would let the rest parallelize later.

### T16 — C8's stop window is pacing-coupled
Stop lands ~2.5s into a ~10s deep stream. If demo pacing changes, the
"meaty partial" assumption shifts (the `firstLine>10` guard catches it
loudly rather than flaking silently — acceptable).

### T17 — C20's active-vote proof is theme-coupled
No accessible name for vote state, so the test compares computed icon
color before/after. If the theme ever equates accent with default, the
assertion breaks with zero behavior change. Revisit if Astryx adds
`aria-pressed` to icon buttons.

### T18 — C11 can't name which guard won
Disabled-while-empty UI vs empty-submit guard both no-op the extra
submits; the test proves the outcome (one POST) not the mechanism.
Fine — outcome is the contract.

### T19 — C19's "Copied!" flip races a 1500ms window
Reopen-immediately has passed reliably, but it is the tightest timing
in the file after E3/E4's bounds. Clipboard content is the primary
proof; the flip is secondary.

### T20 — Responder-copy coupling (C4 tail, C7 chip, C16 chip, C13 echo)
Several assertions quote responder strings ("we will dig into it
together", "Search timed out after 8s", "CN textbook"). Responder
rewording breaks them loudly — intended (they pin honest-rendering),
but expect touch-ups with copy changes.

### T21 — Trigger-text fragility
`simulate error please` must keep matching `simulate (an )?error`
without tripping the tool-error branch (order-dependent in
`responder.ts:39-101`). Same class as T20 — loud on change.

### T22 — E1b overlaps C1 by design
E1b (`section-a-authed`) is the narrow handoff regression (message
POSTs); C1 (`section-b`) is the full happy-path contract. Intentional
duplication, documented in both.

### T23 — C12's `postsAtReload===1` assumes no divider block
True for empty seeded threads; a day-divider change would shift the
count while article assertions stay green. The poll+freeze carries the
real proof (no post-reload POSTs).

### T24 — C10's mid-rerun Stop check is timing-sensitive
The rerun must still be streaming at check time (answer ~2.5s+). Passed
reliably; widen the answer (longer prompt) if it ever flakes.

---

## O. Ops risks

### O4 — Full e2e is now ~8 min single-worker
section-b 5.1 + section-a-authed 2.4 + rest 0.5. The plan's "runs on
schedule" section (M) should budget this; per T15/O3, splitting slow
tests into a second file unblocks parallel workers later.

### O5 — Seeds still TEMP-only (repeats A-audit O1, now sharper)
All 26 section-b tests run on the password-user cookies; the
Google-only seeder went unused. Both seeders still live outside the
repo (`seed-e2e.local.mts` repo-root-untracked, `seed-googleonly.mts`
TEMP-only). The O1 recommendation stands: check both into `scripts/`.

---

## Checked and cleared (reviewed, no issue)

- **Sidebar double-listing → mock artifact, not app bug.** Both links
  visible in one CN group; root-caused to `listAllChats` merging the
  archived leg with an unbranched mock (T14). No store/render defect.
- **C22 auto-retry scare → no auto-retry.** `apiFetch` retries only
  chat-path 429s (`auth.ts:1157-1168`); the 500 surfaces the mapped
  5xx copy (mapping wins over the "Couldn't save" fallback) and the
  manual retry lands attempt 2. Exactly the closed-retry-set design.
- **Multiple Edit pencils → intentional.** `isLast` is per-bubble, and
  editing a non-final turn truncates everything after it
  (truncate-from-index + resend) — supported, pinned by C9 leg 2.
- **C1's missing clientAdoptKey → by design** (adopt path only), filed
  as B17 for the plan text, not the code.
- **C21 short codes (RR/3/CSE(Core)) → values, not labels** — correct
  per `profile-options`; pinned as-is.
- **C17's silent denial → no repo branch to test** — honest no-op
  proven; messaging filed as B18.
- **F2's fix verified by C3** (text kept, zero posts, still on /new).

---

## Resolution (2026-09-17)

- **B9 kept (decision: visible failure history wins):** bubble-Retry
  keeps appending below the failed turn; no app change — the plan
  already records append-not-replace (C4 line). Pin: C4 unchanged.
- **B10 fixed:** `planResponse` takes `ignoreSimulation`; forced
  retries plan the real answer for contentless intents instead of
  looping empty forever. Payload branches (stream-failed, tool error)
  untouched. Pins: C5/C6 rewritten (retry escapes with a real answer).
- **B11/B14 verified:** shipped earlier, proven by C8/C18 in the full
  B run below (no new changes this pass).
- **B13 fixed:** thread toggle persists the global default to an
  exempt localStorage cell (`pesdac-composer-depth-v1` — the
  memory-backed profile cannot survive reload, and the boot purge
  wipes `pesdac-*`). Reload keeps the last choice. Pin: C15 rewritten.
- **B15 fixed:** info toast ("Transcript copied to clipboard.") via
  `useToast` + existing inline flip (notify bridge is error-only, so a
  direct info toast avoids a contract change). Pin: C19 asserts toast.
- **B16 fixed for real:** votes were still memory-only in practice (the
  store migrated to a memory Map post-audit AND the boot purge wipes
  `pesdac-*`). Votes now live in a guarded localStorage cell with an
  in-memory mirror (private-mode safe); the purge exempts
  `pesdac-feedback-v1`. The old C20 passed vacuously (it toggled to
  down before reloading) — rewritten to assert survival + toggle-clear.
- **B17/B12 no change:** plan already records adopt-path-only (C1
  line); stream resume stays backend-phase (SSE ownership).
- **B18 fixed:** vendor `useChatDictation` exposes `onError` — both
  call sites toast denial ("Microphone is blocked…") or generic
  failure. Headless ships no SpeechRecognition, so C17 fault-injects
  a denying constructor via init script (proves vendor→app→toast
  wiring with the exact denial copy).
- **Deferred:** T15/O4 (suite-time split — process), O5 (seeders stay
  out-of-repo; the runs prove the flow as-is).
- Verify: `tsc` clean (3 pre-existing errors elsewhere), unit 378/378,
  section-b 26/26, section-a-authed 24/24, section-a + smoke 12/12,
  section-c re-run 26/26 (shared-file changes).

## Recommended fix order (after the full run)

1. **B11** (interrupted marker) — honesty of stopped turns; small.
2. **B14** (find focus restore) — small a11y win, same area as B11's
   turn-rendering code.
3. **B9 / B13 / B16** (retry-pop, mode persist, feedback persist) —
   three decide-don't-drift calls; each is a one-line plan edit OR a
   small behavior change. Batch the decisions.
4. **B17** (adopt-key plan line) + **B15** (transcript toast) — trivial.
5. **B10** (contentless-retry loop) + **B18** (dictation denial) —
   mockup-stage polish; B10 dissolves in the backend phase.
6. **B12** (stream resume) — backend-phase work (SSE ownership).
7. **T15/O4 + O5** (split slow files, check in seeders) — process.
