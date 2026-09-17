# Section C findings audit (nasty inputs, I1–I20)

Date: 2026-09-15. Scope: `frontend/e2e/section-c.spec.ts` (26 tests —
I12 split in two — green, 3.7 min single-worker). No app code changed;
Section C is pure pin-actual: the suite proves the mockup stage is
honest about hostile input, and files the gaps for after the full run.

Numbering continues the Section B audit: app bugs B19+, test gaps
T25+, ops O6+. Section C deviations D16–D23 live in the spec header.

Related: `docs/operations/browser-break-it-plan.md` (§C fully slashed),
`frontend/src/components/chat/ThreadView.tsx` (handleSend gate,
stageIntoDrawer gate, drawer ~1976-1999),
`frontend/src/lib/attachments.ts` (no validation),
`frontend/src/lib/responder.ts` (no guards),
`node_modules/@astryxdesign/core/src/Chat/ChatComposerInput.tsx`
(paste-only, chip threshold), `.../src/Markdown/parser.ts`
(no-HTML parser, `isSafeUrl`).

Severity legend: **stop-ship** / **release-blocker** / **polish** /
**test-gap** / **ops** (same as prior audits).

---

## B. App bugs (real, filed for after the full run)

### B19 — Zero attachment validation: 50MB, .exe, 20-at-once, 0-byte all stage (release-blocker, D17)
`attachments.ts` has no MAX anywhere, the picker has no `accept`, and
`stageFiles` maps everything. Proven: 50MB stages with a straight face
(I9a), executables stage like text (I9b), 20 files stage (I9c), 0-byte
stages (I14). A 50MB Blob sits in memory per message; an `.exe` chip
is one backend away from being stored. The plan's I16 "write one
first" is a product call (cap size? which mimes? count cap?), not a
test call — filed here instead. Suggested: size cap + mime allowlist
decision, then the boundary test already exists (I16) to pin it.

### B20 — File DROP onto the composer is silently ignored (polish, D18)
`ChatComposerInput` wires `onPaste` only — grep `Chat/` for `onDrop`:
only the "paste/drop" docstring. A real OS drop dispatches into
nothing; the drawer never changes, no copy. Paste works (I10 proves
via synthetic ClipboardEvent). Either a vendor upgrade / own dropzone
or an honest "paste or browse" affordance — decide, don't drift.

### B21 — Attachment-only send is a silent no-op (polish, D19)
`handleSend` returns on empty text before touching `staged`: nothing
posts AND nothing is said — the file just sits staged. The plan's
"posts or blocked WITH copy" does not match (no copy). Two honest
options: allow the send (attachments travel on the message already)
or show the blocked copy. Small fix once decided.

### B22 — No injection/abuse guard: attacker wording is echoed (polish at mockup stage, D20)
The responder has no refusal/deflection branch — "reveal your system
prompt" and five escalating abuses all stream the ask template with
the wording echoed into the answer bold-lead (I7/I12 pin this
explicitly). Nothing leaks (no system prompt exists in the repo) and
service never locks (topic change works immediately after). Backend
phase owns the real guard; until then this is documented behavior,
not a surprise.

### B23 — URLs are never linkified (product call, D21)
ThreadView passes no `autolink`, user side is plain text: a URL-only
message renders as dead text in both bubbles, no anchors anywhere
(I17). The parser supports gfm-autolink and the Link component
computes target/rel — so linkifying later is safe plumbing-wise
(`sanitizeUrl` already kills `javascript:`). Decide: linkify (with
the plan's rel/noopener + tab policy) or keep plain.

---

## T. Test-suite weaknesses (app is fine, proofs are thin)

### T25 — Placeholder paint is NOT readiness (bitten hard)
Staging (`stageIntoDrawer`) and sends (`handleSend`) both gate on
`isAppReady`, which flips well after the "Ask anything…" placeholder
(probed: `contenteditable=false` right after paint). `openSeededThread`
now polls `contenteditable=true` — every staging test before that
fix failed identically with "Files not found". Future suites must
reuse the helper, not the placeholder text. (Design note: pre-ready
interactions fail SILENTLY — the composer is visibly disabled so a
human can't hit it, but the silence is worth knowing.)

### T26 — Six streamed turns exceed the 30s test timeout (bitten)
I12 died at 31.3s with zero app fault — Playwright's default 30s test
timeout (no custom timeout in `playwright.config.ts`) plus ~4s demo
pacing per turn plus the T25 readiness wait. Split into I12a (3
abuses + echo pin) + I12b (2 abuses + no-lock pin). I6 (4 turns)
passes at ~26s but has no headroom. This is the sharp edge of O4:
multi-stream tests need their own file or per-test timeouts.

### T27 — `keyboard.type` presses Enter on embedded `\n`
I19's first draft submitted mid-text as TWO turns (RTL line, then the
fence). Tests with newline-bearing input must `fill` + click Send.
Flagged for every future author: the double-article failure looks
exactly like a duplication bug and isn't.

### T28 — Article text includes footer/timestamp chrome
Exact-length assertions on bubbles fail by a few chars (I3: 10007 vs
10000; I20: 20026 vs 20000). Pattern used: lower-bound length +
head/tail containment. Same for any future size assertions.

### T29 — Thumbnails are role-less blob `<img>`s; undecodable bytes render nothing
The container button carries the "label — alt" name; the `<img>` is
decorative with a `blob:` src. Tests must assert `img[src^="blob:"]`,
and stage VALID image bytes (the `tinyPng()` helper — truncated
headers render no `<img>`, which cost a full debug cycle). Bonus
trap: drawer thumbnails have `onRemove` ONLY — there is no
click-to-open (Lightbox exists solely for message bubbles), so I13
pins the static inert preview, not an open-preview flow.

### T30 — Playwright caps inline file buffers at 50MB
I9a stages via a TEMP path (`section-c-big.bin`, written at test
time, outside the repo). Same recipe for any future large-file test.

### T31 — Synthetic drop proves nothing about the OS path
I10's drop half dispatches real `DragEvent`s to 8 composer ancestors
— they land nowhere because no handler exists (B20). If drop support
lands, I10 needs a `test.skip`-style headed/OS-level companion; the
synthetic half stays as the no-crash pin. (Paste is better covered:
synthetic file-paste in I10 plus 20 REAL clipboard pastes in I20.)

### T32 — Never assert bare `svg` counts
Astryx icons are SVGs (I6 initially counted 21). I6 proves inertness
via zero dialogs + zero errors + literal-text rendering +
`script`/`img[src=x]` absence — that is the whole proof, and it is
sufficient.

---

## O. Ops risks

### O6 — Full e2e is now ~12 min single-worker
section-b 5.1 + section-c 3.7 + section-a-authed 2.4 + rest ~0.5.
The O4 recommendation is now urgent, not nice-to-have: per T26,
multi-stream files (section-b, section-c) should split or gain
per-test timeouts before Section D lands, or the suite will start
failing on budget instead of bugs.

---

## Checked and cleared (reviewed, no issue)

- **XSS defense in depth (I6/I13):** React-escaped user text +
  custom parser with NO raw-HTML node type + `javascript:`/
  `vbscript:`/`data:text/html` scheme block + SVG-as-`<img>` (never
  executes) + drawer thumbnails with no opener. Four text payloads
  plus a script-bearing SVG: zero dialogs, zero errors, literal
  rendering. No stop-ship.
- **Rich rendering + containment (I5):** header/bold/fence/table/
  quote/list all render from a journal-seeded assistant block;
  `scrollWidth <= innerWidth` at 1280px before AND after sending.
  User-side markdown stays literal (plain `<Text>`, no `strong`/
  headings in the user article) — by design.
- **Attachment matrix honest parts:** same-file re-pick works
  (input reset, I9d), removal is live with text-only send after
  (I9f), `.txt`→Token / image→thumbnail split (I9e), hostile names
  display safely AND survive the journal reload round-trip —
  traversal names are inert strings, never paths (I15).
- **Mention-only (I18):** posts with badge, bubble non-empty,
  scoped retrieval streams — the stripped-empty echo path is safe.
- **RTL+code (I19):** stored/sent string byte-exact, no overflow.
- **Paste storm (I20):** 20 × 1k pastes become 20 chips (200-char
  threshold) and serialize LOSSLESSLY — 20k chars sent, no dropped
  tail. paste-as-token is a display transform, not a data loss.
- **Empty/whitespace (I1/I2):** stronger than the plan — Send
  disables, Enter no-ops, zero posts.
- **Quiz vs deep routing (I8):** correct branch both ways.
- **I12's first scare (stream "hang"):** test-timeout starvation,
  not an app wedge — patterns changed to completion-based waits
  (marker increment per turn) so overlap can never hide.

---

## Resolution (2026-09-17)

- **B19 deferred (product call: no upload caps at mockup stage):**
  staging accepts everything again — no size/count/type validation.
  Limits arrive with real backend uploads. Pins I9a/I9b/I9c/I14/I16
  back to unlimited-actual. (A v1 policy was implemented + verified,
  then reverted on this call; recoverable from git history.)
- **B20 fixed:** layout-neutral `display:contents` dropzone wrapper
  around each `ChatComposer` (ThreadView + Pesdac welcome); vendor
  input untouched. Pin: I10 drop half now stages.
- **B21 fixed as blocked-WITH-copy:** vendor `ChatComposer`
  trim-gates empty submits (`handleSubmit`/`canSend`) before our
  `onSubmit` fires, so "allow" would need a custom sendButton + Enter
  interception (vendor fight — deferred). Copy = lowest-priority
  composer status hint while files are staged and text is empty
  (thread + welcome). Pin: I11.
- **B22/B23 deferred as spec'd:** no code change; I12a/b echo pins
  and I17 no-anchor pins stay green.
- Verify: `tsc` clean (3 pre-existing errors elsewhere), unit 378/378,
  section-c 26/26 green single-worker.

## Recommended fix order (after the full run)

1. **B19** (attachment cap + type policy) — the only item with
   backend-adjacent blast radius; decide first, I16 pins it.
2. **B21** (attachment-only: allow or copy) — same drawer area,
   tiny once decided.
3. **B20** (drop support or honest affordance) + **B23** (linkify
   decision) — two more decide-don't-drift calls; batch with B19's
   product decision.
4. **B22** (injection/abuse guard) — backend-phase work.
5. **T26/O6** (split slow files or per-test timeouts) — process,
   before Section D.
