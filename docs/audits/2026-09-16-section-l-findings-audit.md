# Section L findings audit (toasts, crash UI, recovery — L1–L5)

Date: 2026-09-16. Scope: `frontend/e2e/section-l.spec.ts` (5 tests,
5 passed, ~51s), all [mock] with a real BetterAuth session; L4 closes
a real page mid-stream (same context, headless per D55). No app code
changed.

Numbering continues the Section K audit: app bugs B49+, test gaps
T115+ (the L audit's original T106–T110 collided with the K fix
round's T107–T114 and were renumbered), ops O31+. Section L
deviations D70–D73 live in the spec header.

Related: `frontend/src/lib/toast-policy.ts:9-27` (repeat window),
`frontend/src/components/AppToasts.tsx:109-119` (global rejection
path), `frontend/src/components/AppErrorBoundary.tsx` (fallback),
`frontend/src/lib/session.ts:88-100` (boot purge), `:1102-1122`
(fail-closed message validation), `frontend/src/components/profile/
sections.tsx:1422-1466` (export/clear-all failure toasts),
`docs/operations/browser-break-it-plan.md` (§L slashed).

Severity legend: **stop-ship** / **release-blocker** / **polish** /
**test-gap** / **ops** (same as prior audits).

---

## B. App bugs

**None.** Section L is the first clean section since G: the storm
guard holds, the boundary correlates, the global path is a true
window, the kill boundary replays nothing, the purge sweeps. B48
(outbox compaction) was fixed in the K fix round after this audit
was written; no open data-layer item remains from this section.

### Observations (not bugs — calm + honest either way)
- **Same 500, different copy per wrapper.** L1's identical
  `{code: SERVER_ERROR}` 500 surfaces as the generic 5xx copy on the
  Campus/export/clear-all paths but as the local fallback
  ("Couldn't save your name. Try again.") on the display-name path —
  the wrappers classify differently. Both are calm, neither leaks,
  the dialog stays open. Unify only if copy-consistency becomes a
  product ask; do not "fix" the fallback into existence elsewhere.
- **Window-expiry re-fire while the elder toast is still visible**
  (L1 maxSimultaneous=4) is the documented window-not-latch design,
  not a stacking bug — L3 pins the semantics precisely (6
  rejections → 2 log lines).

---

## T. Test-suite weaknesses (app is fine, proofs are thin)

### T115 — `[role=status]` matches spinners, not just toasts (bitten)
A bare "Loading" region inflated L1's simultaneous count to 5. The
`toastTexts` snapshot helper must filter non-toast status text
(L1 filters exact "Loading"). Any future toast-counting test that
reuses the S3 selector raw will count skeletons as toasts.

### T116 — Prod React still console.errors caught render crashes (bitten)
`preview` is a production build, yet the poison's TypeError (with
component stack) lands in console.error twice — initial + Try-again
re-crash. The L2 gate exempts exactly `render failure ref=` (the
asserted operator channel) plus the poison's exact echo signature
(`reading 'map'`). A broad `TypeError` exemption would gut the
gate; keep poison-signature exemptions exact and few.

### T117 — Option values live in `profile-options.ts`, not in intuition (bitten)
Campuses are RR/EC only — the invented "CN Campus" would have
failed at option-click. Read the options module before scripting
selects (subjects/campuses/semesters all enumerated there).

### T118 — Drive multi-surface storms with navigation, not dismissal (pattern)
Closing the profile dialog mid-storm (Esc vs X vs click-outside) is
K3-owned behavior — asserting it inside a storm test couples two
contracts. `goto("/new")` unmounts deterministically; counters live
in-test so the storm accounting survives the navigation.

### T119 — "Try again" on a persistent poison re-crashes (correctly)
Assert ref-CHANGE (fresh render attempted, fresh ref minted), never
recovery — recovery additionally requires the poison to stop being
served. A test asserting recovery without flipping the mock would
fail against correct code.

---

## O. Ops risks

### O31 — Section L: 5/5 in ~51s
Second-cheapest section. Full e2e now ~41 min with the soak, ~31
without.

---

## Checked and cleared (reviewed, no issue)

- **L1:** 9 UI-driven 500s (Campus PATCH ×3, display-name ×2,
  export ×1, clear-all DELETE ×1, welcome create ×2) → exactly 3
  toast bodies (generic-5xx collapses patch/export/delete;
  "Couldn't create that chat" + the display-name fallback carry
  their own), max 4 simultaneously visible, composer live and
  contenteditable after, dialogs functional throughout, gate
  clean. No 10-stack, no layout breakage.
- **L2a:** `[null]` message rows paint an honest empty thread —
  zero articles, no boundary, no error. `messageToBlock`
  fail-closed works from the browser, not just in unit tests.
- **L2:** option-less mcq poison throws in render → boundary
  dialog (exact title + both buttons), `Reference: <8 hex>`,
  console `render failure ref=<same>` (operator correlation
  proven, not assumed), Try-again → fresh ref, Back-to-home →
  `/new` boots with live composer.
- **L3:** 5 identical rejections in-window → 1 toast + 1
  `Unhandled rejection:` line; +3.5s later the same body re-fires
  (2nd line) — window, not latch. Full welcome send completes
  after the storm (thread URL + settled stream).
- **L4:** `page.close()` ~1s into a deep stream → fresh page on
  the captured URL: exactly 1 user article, 0 assistant, zero new
  POSTs after 3s settle; follow-up send completes to 2Q+1A. The
  never-persisted answer is not resurrected (D11, browser-proven
  across a real page death, not just reload).
- **L5:** 5 parseable old-shape `pesdac-*` keys (chats without
  codes, drafts map, settings-v0, onboarding string, flat
  profile) all purged on boot; `pesdac:logout-ping` colon key
  survives byte-identical; seeded thread opens, composer live,
  gate clean.

---

## Recommended fix order (after the full run)

1. **Nothing to fix from this section** — L filed zero app bugs.
   **B48** (the audit's only open item at write time) was fixed in
   the K fix round (`6591916`): `list()` compacts invalid rows,
   D12 asserts `toEqual([])`.
2. Closed elsewhere since: **B47** (send toast via toUserMessage)
   — J commit; **B45/B46** (axe pair), **B39–B41/B43/B44** (focus,
   motion, targets) — I commit; **B31** (origins env), **B33**
   (2FA), **B36** (return-to-target) — F commit. Still open:
   **B38** (Slow-3G gate).
3. Process: **O25** (K12 quarterly pass), **O14** (staging),
   **O28** (J backend procedure), **O30** (webServer retry).
4. Only **Section M** (M1–M4, process docs) remains in the plan.

---

## Resolution (verification round, this commit)

- **No app-code change** — the L spec adopts the section-l suite
  as-written (L1–L5 green at baseline and at commit time); the only
  edits are this audit's T115–T119 renumber and the B48 status
  updates above.
- **Verify (final tree):** tsc clean except pre-existing + foreign;
  units 385/385; section-l 5/5; k 10/10; e 10/10 (O5 stable).
