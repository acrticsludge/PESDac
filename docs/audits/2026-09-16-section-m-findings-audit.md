# Section M findings audit (regression & live quality — M1–M4)

Date: 2026-09-16. Scope: `frontend/e2e/section-m.spec.ts`
(M1/T01–T20 — 17 passed at baseline, 3 spec-side failures fixed in
verification, 20/20 at commit, ~5 min) + M2/M3/M4 process
annotations in the plan. Real BetterAuth session, `/api/v1`
mocked, deterministic responder — no live backend, no app code
changed.

Numbering continues the Section L audit: app bugs B50+, test gaps
T120+ (the M audit's original T111–T113 collided with the K fix
round's T111–T113 and were renumbered), ops O32+. No M-section
deviations (the suite follows the plan's must/must-not shape
exactly).

Related: `frontend/src/lib/responder.ts` (branch markers),
`frontend/src/lib/references.ts:35-75` (sourceTarget, token
stripping), `docs/operations/browser-break-it-plan.md` (§M slashed).

Severity legend: **stop-ship** / **release-blocker** / **polish** /
**test-gap** / **ops** (same as prior audits).

---

## B. App bugs

**None.** All 20 transcripts route as specified. The responder's
branch contract (ask/deep/quiz/simulate-* ×4, references,
truncation) holds end to end through the UI, including per-turn
intent switches and post-abuse service.

Verification-round note: the baseline run failed T12/T13/T15, and
each failure exonerated the app — the spec asserted pre-B10/B11
behavior that C5/C6/C8 (green) already pin the other way. The
spec, not the app, was fixed (see Resolution). No B filed.

---

## T. Test-suite weaknesses (app is fine, proofs are thin)

### T120 — Thread codes must be 6 `[a-z0-9]` (bitten, all 20 at once)
7-char codes (`m01aa01`) strand on welcome per N1/D41 — the shell
wait times out with zero signal about the cause. The suite uses
`g01aa1`–`g20aa1`. Any future spec seeding threads must mint
6-char codes; the failure mode (welcome + live composer, no
error) never suggests the code is the problem.

### T121 — Golden turns need branch-marker completion, not Stop-gone (pattern)
`waitStreamSettled` alone proves the stream ended, not that the
answer landed before the next send. `runTurn` polls the branch
marker count +1 (I12 pattern) — overlapping turns can never wedge
the stream state. Empty/limit intents carry no marker; those tests
use their own completion signals (empty copy, pill clearing).

### T122 — PowerShell eats `|` in `-g` patterns (ops-adjacent, bitten)
`playwright test -g 'A|B'` never reaches the runner (pipe parsed
by the shell despite quoting). Run the full file or a single `-g`
fragment — no alternations from this shell.

---

## O. Ops risks

### O32 — Section M1: 20/20 in ~5 min
Fast enough to be the per-prompt-edit smoke (M2): single intent
turns settle in 3–18s, two-turn switches in ~22s, the abuse triple
in ~19s. Full e2e now ~36 min without soak, ~46 with P7.

---

## Checked and cleared (reviewed, no issue)

- **T01/T02 (ask):** short branch with marker + subject definition
  ("CN definition"), cross-subject excluded. Wording edits that
  keep the branch stay green by construction (substring pins).
- **T03–T07 (deep):** all five depth cues (`in detail`, `step by
  step` + derive, `compare and contrast`, `elaborate` +
  derivation, `full chapter`) route deep with section headers;
  short/quiz markers absent every time.
- **T08–T10 (quiz + switches):** quiz branch with worked example
  + checking note; T09/T10 prove per-turn switching both
  directions with 2Q+2A article counts.
- **T11–T14 (simulate-*):** error Retry appends with exactly one
  user bubble; empty says so then Retry escapes with the real
  answer below the empty block (B10 — one user, two assistant,
  single empty copy); limit pill → forceOk Retry plans the real
  answer, pill clears, zero empty blocks (B10); tool error names
  the failed search + single source + Regenerate offered.
- **T15 (stop):** Stop gated on words flowing (heading first) —
  partial persists as an INTERRUPTED turn (B11 — failed error
  block + Retry, never a normal turn), heading still visible.
- **T16/T17 (injection/abuse):** echo pinned (`system prompt`,
  `DAN`, `damn`, `useless` in first assistant articles), three
  abuse turns complete, topic change gets full service — D20
  actual, no guard invented.
- **T18 (@textbook):** `CN textbook` retrieval target renders,
  `@textbook` literal absent from the echo (tokens stripped).
- **T19 (pill):** follow-up click sends as user message #2 and
  the deep branch answers (2Q+2A).
- **T20 (truncation):** 200-char question → answer carries `…`,
  the 60-char tail appears nowhere in the assistant article.

---

## M2/M3/M4 — process standing

- **M2:** fast smoke = M1/T01–T20 on every prompt/model/keybase
  change (~5 min); full suite weekly (~36 min). Red blocks
  release. Owner: on-call.
- **M3:** monthly sample → anonymize → new transcripts as
  M1/T21+ in the same must/must-not shape. The suite file is the
  intake form: a sampled failure with clear must-haves becomes a
  test in one edit.
- **M4:** change PRs record intent accuracy (M1 must stay
  green), containment, hallucination rate (≤5% target on
  grounded Qs), fallback success rate. Regression = revert-or-fix.

---

## Whole-plan close-out

All break-it sections A–M are now slashed: 24 + 26 + 26 + 17 + 10
+ 16 + 11 + 12 + 14 + 9 + 10 + 5 + 20 ≈ 200 browser proofs, plus
the K12 quarterly manual pass (process). Open code items
remaining: **B38** (Slow-3G gate) and **B37** (`/mockup*` ships in
prod) — everything else the audits filed (B48/B47/B45/B46/
B39–B41/B43/B44/B31/B33/B36) closed in the F–K fix rounds. No
stop-ship items open.

---

## Resolution (verification round, this commit)

- **No app-code change.** T12/T13/T15 failed at baseline because
  the spec asserted superseded behavior: T12/T13 expected retry to
  replay the contentless intent (B10 fixed the opposite — forceOk
  retry escapes with the real answer, pinned by green C5/C6), and
  T15 expected a normal turn on stop (B11 fixed the opposite —
  stop persists an interrupted turn, pinned by green C8). The
  three tests + the spec header were rewritten to the B10/B11
  contracts as C5/C6/C8 mirrors; each passes alone and the file
  is 20/20.
- **T111–T113 → T120–T122** (K owns T111–T113); O32 uncontested.
- **Verify (final tree):** tsc clean except pre-existing +
  foreign; units 385/385; section-m 20/20; e 10/10 (O5 stable).
