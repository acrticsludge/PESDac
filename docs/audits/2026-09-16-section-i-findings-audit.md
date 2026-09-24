# Section I findings audit (keyboard & a11y, K1–K13)

Date: 2026-09-16. Scope: `frontend/e2e/section-i.spec.ts` (14 tests,
14 passed, 1.5 min) with real BetterAuth + Neon on `[staging]` legs
and mocked FastAPI throughout (incl. the offline flag for the pill
leg). Axe via the a11y.spec.ts bar (serious/critical). No app code
changed; TEMP probes deleted. K12 is `[manual]` — procedure, not a
test.

Numbering continues the Section H audit: app bugs B39+, test gaps
T92+ (the I audit's original T83–T90 collided with the H fix round's
T83–T91 and were renumbered), ops O24+. Section I deviations D55–D62
live in the spec header.

Related: `frontend/src/components/Pesdac.tsx` (shortcut bus, Esc
yield, substring filter), `frontend/src/components/chat/
ThreadView.tsx` (CANCEL_EVENT order, composer combobox, tool-call
chips), `frontend/src/lib/responder.ts` (deterministic ask/deep/quiz
branches), `frontend/src/lib/session.ts` (mem-only store),
`frontend/e2e/a11y.spec.ts` (base suite, still green),
`docs/operations/browser-break-it-plan.md` (§I slashed).

Severity legend: **stop-ship** / **release-blocker** / **polish** /
**test-gap** / **ops** (same as prior audits).

---

## B. App bugs (real, filed for after the full run)

### B45 — Composer `aria-multiline` on role=combobox (release-blocker)
K5's axe run flags it critical (1 node, exact):
`<div aria-multiline="true" aria-label="Message input"
contenteditable="true" role="combobox" ...>`. `aria-multiline` is
textbox-only — disallowed on combobox. Every thread page carries it,
which is why the static-route a11y suite never caught it. Fix is
one attribute (drop it — the element is genuinely single-line
visually... or move multiline semantics properly). K5 pins it as a
tripwire: the blocking-ID list must read exactly
`["aria-allowed-attr", "color-contrast"]` until fixed.

### B46 — Tool-call metadata fails color-contrast (release-blocker)
K5's axe run flags it serious (4 nodes, all inside the second
assistant turn's `.astryx-chat-tool-calls` row): the target name
("CN course slides") and duration ("43ms") spans. Secondary metadata
gray-on-dark under 4.5:1. Same tripwire as B45. (Both fail K5's
explicit serious/critical-zero bar — that bar is the reason for
release-blocker rather than polish.)

### B39 — Dialog traps leak one BODY stop per cycle (polish)
Gate: deterministic 3-cycle [Log in → BODY → Create account] (9
Tabs = 3 BODY stops — not wrap, filed). Profile: 1 BODY escape per
30 Tabs. Onboarding: 1 per 15. Same sentinel-leak signature in all
three traps. Both gate actions stay reachable and nothing strands,
but SR users hit a void stop every cycle. K3/K13g pin the counts;
fix the sentinels and the counts go to zero.

### B40 — Composer shows no focus ring (polish, not WCAG-failing)
The only ringless stop on either shell tour (26-stop cycles fully
ringed otherwise). Downgraded from blocker on purpose: the blinking
text caret satisfies 2.4.7's visible-indicator requirement for text
fields — this is a consistency gap (every other control rings
`solid/2px`), not a criterion failure. K13 asserts "only the
composer lacks a ring" so any second gap fails loudly.

### B41 — Dismiss paths drop focus to BODY (polish)
Keyboard-closing the profile dialog (Enter on Close) lands on BODY,
not the invoking My Profile link; Esc-stop and Esc-find-close do the
same (find-close was already filed as D15 — this extends the family,
doesn't duplicate it). Edit-cancel is the counterexample that works
(back in the composer). Restore invoker/composer focus on all three.

### B42 — Dictation denial is silent everywhere (polish)
"Start dictation" is labelled (good); denying the mic is an honest
no-op that announces nothing — sighted or SR (C17's pointer half +
K8's live-log comparison, both unchanged). A denial toast (which
would ride the existing aria-live toast region) closes it.

### B43 — No reduced-motion handling exists (polish)
Zero `reduced-motion` references in src: word-chunk streaming +
blinking caret run full-animation under `reduce` (WCAG 2.3.3).
Content completes identically (K7 pins parity: deep closer, no
stranded caret), so this is purely the calming branch, missing.

### B44 — Touch targets 28–32px under the 44px bar (polish)
Send 32×32, Attach 28×28, Dictation 32×32, row-menu ≥24 at 360px —
all under the plan's 44px, all over WCAG 2.2 AA's 24px floor (which
is met, hence polish not blocker). K9 pins `<44` as a tripwire: flip
to `≥44` when the controls grow.

### (Not bugs — closed during implementation)
- **K1's articles=0 was probe timing.** Enter and click both post
  identically once the auto-send timer + stream are awaited (rows=1,
  articles=2 either way). Full keyboard cycle green.
- **K11's missing ring was a .focus() artifact.** Programmatic
  focus doesn't match `:focus-visible`; real Tabs ring under
  forced-colors. No bug.
- **K10's missing gate was a shared-context cookie.** Second pages
  inherit the seed session (authed, no gate) — guest legs need fresh
  contexts. Same trap bit K2's gate leg mid-build.
- **K4's inLog=false was the wrong oracle.** The pill announces via
  its own role=status, not the thread log — all three paths proven.

---

## T. Test-suite weaknesses (app is fine, proofs are thin)

### T92 — Containment needs role-based `contains`, not `closest` (bitten)
My first trap metric (`closest('[role=dialog]')`) reported 40/40
"escapes" on a correctly-trapped dialog — focus sat on tab buttons
outside the inner role node. `dialog.evaluate(d =>
d.contains(document.activeElement))` is the honest check (K3).

### T93 — Icon-only buttons are text-invisible (bitten)
The profile Close is an icon button (aria-label "Close", empty
text) — textContent matching loops past it forever. Match
`aria-label` for closer discovery (K3).

### T94 — Enter/click equivalence needs settle-waits (bitten)
Reading the journal instantly after Enter showed zero rows — the
350ms auto-send + stream hadn't run, not a lost message. Poll for
the post, then assert (K1).

### T95 — Fresh contexts for guest legs (bitten twice)
Second pages inherit the seed cookie (K2-gate and K10-gate legs
both failed authed before moving to `browser.newContext()`).
Any test with guest + authed halves needs two contexts — never one
shared page sequence.

### T96 — Wrap-BODY vs trap-hole BODY (pattern, promoted to verdict)
Headless Tabs past the last stop land on BODY (no chrome to continue
into) — 1–2 per 30-stop tour, non-consecutive, restarting at the
skip link. K13 allows exactly that and fails anything else. The
gated every-3rd pattern turned out to be the same transient at
dialog scale (2 stops + 1 wrap), not a trap hole — B39 closed as
non-bug in the fix round (see Resolution).

### T97 — Know the responder's branches (bitten)
"teach me TCP in detail" matches DEEP_RE (deep answer, closer "test
you on it") — asserting the ask closer ("Quote it first") fails on a
perfectly correct stream. Marker asserts must name the branch the
input selects (responder.ts:132-138).

### T98 — Axe failures need node-level logging (pattern)
IDs alone aren't actionable (two runs to identify B45/B46). K5
permanently logs targets + outerHTML slices for blocking nodes —
keep that shape for every future axe test.

### T99 — `.focus()` ≠ `:focus-visible` (bitten)
See K11 above. Any focus-visibility assert must Tab for real.

---

## O. Ops risks

### O24 — Section I: 14/14 in 1.5 min
Fastest green section per test. Full e2e now ~36 min with the soak,
~26 min without.

### O25 — K12 manual pass is a calendar item, not a test
NVDA + Chrome quarterly over login → send → stop → retry → profile
save; K4's three announcement paths are the automation base to
promote stable observations into. Owner + schedule still to assign.

---

## Checked and cleared (reviewed, no issue)

- **K1:** `/` focuses the composer from body; typed Enter-posts
  (rows=1, articles 1+1 after settle); Ctrl+K back to a live /new.
  Zero pointer, clean.
- **K2:** streaming→Esc stops into the composer (B41 fixed);
  edit→Esc cancels into the composer; Ctrl+F opens find focused; Esc
  closes into the composer (was already fine — B14); guest-gate Esc
  yields with focus unmoved. Exact order, clean.
- **K3:** profile 29/30 + onboarding 14/15 contained (the single BODY
  stop per tour is the wrap transient — B39 closed as non-bug);
  keyboard Close restores the My Profile invoker (B41 fixed);
  onboarding ignores Esc (required, by design). Clean.
- **K4:** role=log grows through stream and error ("interrupted
  before it finished. Retry" present); "1 unsynced — will send
  automatically when online." carries its own role=status. Clean.
- **K5:** 28 axe passes, zero blocking (B45+B46 fixed this round —
  the tripwire now pins `[]`); clean console.
- **K6:** staged chip visible; 200% zoom (640 CSS px) no overflow;
  composer live after. Clean.
- **K7:** `reduce` active in-page; deep closer lands inside 6s
  (single-settle calming, B43 fixed — the chunked path needs ~13s);
  1+1 articles; no stranded caret. Clean.
- **K8:** labelled; headless denial silent (B42 closed by B18 — real
  denial toasts via onError, the rig has no recognizer); composer
  sends fine after. Clean.
- **K9:** Send/Attach/Dictation 44×44 (B44 fixed); row menu 28px
  (AA floor, no tripwire). Clean.
- **K10:** 800×360 composer live, no overflow; fresh-context guest
  gate fits. Clean.
- **K11:** forced-colors active; heading + buttons readable;
  real-Tab button stop ringed. Clean.
- **K13:** 26-stop shell cycles fully ringed, zero unringed (B40
  fixed); BODY ≤2 non-consecutive (wrap only); gated 2-stop cycle
  routes wrap through BODY every 3rd stop (B39: same transient at
  dialog scale). Clean.

---

## Recommended fix order (after the full run)

All five items below were fixed in the I fix round (this commit) —
kept as the work log; the tripwires now pin the fixed state:

1. **B45** (composer aria-multiline) — stripped at the boundary in
   ThreadView + Pesdac (vendor hardcodes it; trigger menu owns the
   combobox role). K5 re-run: critical gone, tripwire now `[]`.
2. **B46** (tool-call contrast) — `--color-text-disabled` promoted to
   secondary scoped to each ChatToolCalls subtree via its own style
   prop (4 sites: thread history + live, history loader, mockups).
   No theme-token change; K5 serious gone.
3. **B40** (composer ring) + **B41** (focus restore) — one
   keyboard-focus pass: the standard Astryx ring on the editable
   (`:focus-visible` only, narrow selectors in global.css); stop
   focuses the composer; profile close refocuses the My Profile
   invoker (conditional render bypasses the vendor trigger-restore).
   Find-close was re-probed already-fine (B14) — D15 superseded. K2
   asserts all three landings, K3 asserts the invoker, K13 asserts
   zero unringed.
4. **B44** (target sizes) — Send/Attach/Dictation 44×44 (Attach via
   its own style prop; Send/Dictation via narrow global.css rules —
   vendor sizes top out at 36px). K9 tripwire flipped to ≥44.
   Row menu intentionally untouched (AA floor only, no tripwire).
5. **B42** (denial feedback) — already closed by the B18 fix
   (section-b round): real denial fires onError → error toast on the
   aria-live region. K8 notes the mechanism; the headless silence
   stands (no recognizer). **B43** (reduced-motion calming) —
   single-settle branch in startTurn under `reduce`; K7 proves it
   (closer ≤6s vs ~13s chunked) plus parity.
6. Closed elsewhere before this round: **B31** (origins env),
   **B33** (2FA enroll), **B36** (return-to-target), **B32**
   (selfOrigin) — F commit; **B37** (mockup routes) — G commit.
   Still open: **B38** (Slow-3G gate) + **O14** (staging).

---

## Resolution (fix round, this commit)

- **B39 closed as non-bug (evidence, no code):** the vendor Dialog
  is native `showModal` — there are no JS sentinels to leak. The
  gated probe shows containment is perfect (focus never leaves the
  2-button cycle in 9 Tabs); the every-3rd BODY is the D59/T96 wrap
  transient at dialog scale (headless has no chrome to continue
  into). K3's 1/30 + 1/15 and K13g's 3/9 are all the same
  phenomenon. Pins kept as documentation.
- **B45/B46/B40/B41/B44/B43 fixed, B42 verified closed** (see the
  fix-order log above for the mechanism of each).
- **Full visual scope was explicitly approved** for this round
  (B40/B44/B46 touch ring, sizing, and tone): no theme tokens were
  changed — every visual is scoped to the component subtree (style
  props) or narrow stable selectors (global.css Section I block).
- **Verify (final tree, preview rig):** tsc clean except
  pre-existing (section-e `update` prop, section-h
  `Performance.memory`, db `pg` types — plus foreign untracked
  `audit-auth.ts`, not ours); units 385/385; section-i 14/14.
