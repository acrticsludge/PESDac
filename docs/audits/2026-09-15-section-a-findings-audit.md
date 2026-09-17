# Section A findings audit (forced backend errors, E1–E22)

Date: 2026-09-15. Scope: `frontend/e2e/section-a-authed.spec.ts` (23 passed,
1 fixme) + guest shapes in `frontend/e2e/section-a.spec.ts` (8 passed).
No app code was changed to get here — every deviation below is pinned by a
passing test that asserts actual behavior, with the plan mismatch cited
inline (D1–D4 in the spec header). Nothing here blocks Section B work;
the fix list at the end is explicitly for after the full run.

Related: `docs/operations/browser-break-it-plan.md` (Section A fully
slashed), `frontend/src/lib/session.ts`, `frontend/src/lib/auth.ts`,
`frontend/src/lib/auth-cache.ts`, `frontend/src/lib/llm.ts`,
`frontend/src/components/profile/sections.tsx`.

Severity legend: **stop-ship** (data loss / security / dead app),
**release-blocker** (broken promise, must fix before release),
**polish** (wrong copy / rough edge, ship-able with a note),
**test-gap** (app is fine, our proof is thin — harden later),
**ops** (process/seed fragility, not product behavior).

---

## A. App bugs (real, filed for after the full run)

### B1 — Welcome→thread handoff drops the first message (release-blocker)
The 350ms autoSend timer dies in the SPA-transition remount; the fresh
thread mounts with `autoSend=null`, the message never posts (`messagesPost`
stays 0, thread shows only the day divider). Pinned by `E1b` (`test.fixme`).
This also blocks plan item C1 (welcome happy path) — nothing depending on
the handoff can be proven until it is fixed. Un-fixme E1b with the fix.

### B2 — Create-transport failures show the 5xx-identical fixed copy (polish)
`createChatBacked` notifies `"Couldn't create that chat. Try again."` for
*every* failure class (`session.ts:1146`), so an aborted POST is
indistinguishable from a 500 — the offline copy (`api/errors.ts:68`) never
surfaces on this leg. The plan's E2 expects the offline copy. Either branch
the copy on `TypeError`/abort or amend the plan; E2 currently pins actual.

### B3 — Thread pages throw hydration mismatch #418 on every load (polish)
Minified React error #418 on `[subject]/[code]` loads (SSR HTML vs client
first paint — guest thread shapes, sidebar state). The app recovers and
stays fully interactive (proven by every thread test), so this is debt, not
danger — but it fires on *every* thread navigation and our clean-env gate
now allowlists it, which means the gate can no longer catch a *second*,
real hydration bug on those pages. Fixing it un-blocks removing the
allowlist. Guest specs keep the strict gate (they never load threads).

### B4 — `notifyFailure` fixed bodies swallow mapped errors on some legs (polish)
`notifyFailure(error, notify, fixedBody)` shows the leg's fixed string, so
the `toUserMessage` mapping never reaches the user on the hydrate, create,
and history legs. Concretely: a token-mint `AuthServiceError` during
hydrate surfaces as "Couldn't load your chats…" (E22 pins this), while the
*same* failure during a campus save surfaces the authored
"Authentication service is temporarily unavailable…" (`toUserMessage` path
in `saveIdentity`). Both are honest, but the inconsistency means the
auth-service copy is leg-dependent. Decide per leg which copy owns the
surface and pin it — E22 documents the current split.

### B5–B8 — Plan-vs-code deviations (spec calls, not crashes)
Each is already pinned by its test; after the full run, either change the
code or change the plan — don't leave them as silent D-notes:
- **B5 / D1 (E4):** `apiFetch` honors `min(Retry-After, 5s)` (`auth.ts:984-988`
  via `chatWriteRetryDelayMs`, retry at `auth.ts:1163`) then *still* does its
  one bounded retry. Plan says NO auto-retry for `Retry-After: 30`.
- **B6 / D3 (E12):** backend-OK + identity-delete-fail yields
  `identity-pending` — info toast, NO heap drop, NO navigation
  (`sections.tsx:237-247`). Plan says heap fully dropped + guest gate.
- **B7 / D2 (E9):** `llm/status` failure degrades OPEN (`llm.ts:40-43,191-193`)
  — sends proceed, backend decides. Plan says sends blocked.
- **B8 / D4 (E16):** chats-503 surfaces the hydrate copy
  (`session.ts:1775`), not the generic 5xx copy, attempts stay at 1.

---

## B. Test-suite weaknesses (app is fine, proofs are thin)

### T1 — E6's session death is mock choreography (test-gap)
`me` flips to 401 only once `c.messagesPost >= 1`. A real expiry is
server-driven and can land mid-flight; our flip can't reproduce races
between the flip and in-flight legs (it took two iterations to stop the
flip from breaking thread open). Acceptable simulation — but if session
handling is ever reworked, E6 is the test most likely to lie.

### T2 — E8/E22 prove stability, not retry-pairing (test-gap, deliberate)
Concurrent mint chains overlap transiently (odd `tokenHits` observed under
full-suite load), so both tests assert "≥2 attempts, then zero growth over
6s" instead of exact pairing. The single-retry bound itself is unit-proven
(`auth-cache.test.ts`); the browser proof covers the stop-ship property
(no infinite loop) and nothing more.

### T3 — Clean-env allowlist is growing (test-gap, watch item)
`expectCleanEnv` now filters: failed-resource noise, the 404-navigation
log, hydration #418 (thread tests), and "Transition was skipped" (E6 only).
Each entry is commented and scoped, but four filters is the most this gate
can carry before it stops meaning "clean". B3's fix removes the biggest
one; audit the rest when touching navigation.

### T4 — E3/E4 elapsed lower bounds are timing-sensitive (test-gap)
`>1500ms` (E3, honors `Retry-After: 2`) and `>4000ms` (E4, honors the 5s
cap) will flake on a machine fast or loaded enough to break the
assumption — and E4's `<25000ms` upper bound is generous for the same
reason. If either flakes in CI, convert to attempt-count + header-honored
proofs rather than widening the windows.

### T5 — E5's success signal is a proxy (test-gap)
The failure toast lingers by design, so `HISTORY_COPY` never reaches zero
after retry — the test asserts the Retry button clears instead. Correct
proxy (composer error clears with it), but a future change that decouples
the button from the error signal would fool it.

### T6 — E18 never crosses the real 5→6 bucket edge (test-gap)
The mock 429s from attempt 1; the 5-attempt bucket transition stays
unit-covered (`link-password-server.test.ts`). Resubmit-bypass is proven
with 2 submits, not sustained spam. Enough for the client contract
(429 honored, cooldown toasted, button re-enables); not a server proof.

### T7 — E20 covers PATCH only (test-gap)
POST (create) and DELETE (clear-all) pending states are untested — the
"no double-submit while pending" claim holds for the campus Selector only.
Candidates: E1-style double-Send on a delayed `chatsPost`, clear-all on a
delayed DELETE.

### T8 — E10 covers chats-list garbage only (test-gap)
A `200 not-json` on the messages leg (`loadChatMessages` parse path) is
untested. Expected shape per code: HISTORY_COPY + Retry, no crash — one
small test to close it.

### T9 — The delete-complete path is intentionally untested (test-gap)
E12 faults `delete-user` precisely because a real success would destroy the
shared seed identity (the sign-out guard exists for the same reason).
A true end-to-end delete needs an isolated throwaway user + real backend —
flagged for the staging phase, not mockable here.

### T10 — E17's no-download proof is indirect (test-gap)
"No corrupt partial file" is inferred (no success toast + dialog open);
`downloadJson` only runs on success by code inspection
(`sections.tsx:1422-1439`), not browser-proven. A `download`-event
assertion would close it if the path ever becomes load-bearing.

### T11 — Onboarding 429 path untested in browser (test-gap)
`onboardingRetryDecision` retries a first-attempt 429 once (capped 5s,
`auth.ts:916-927`), but E7 only exercises 500s and E19 only the PATCH leg.
One test (profileGet 429 → Retry-After: 60 → form appears after ≤5s wait)
would pin the cap end-to-end.

### T12 — Token terminal reasons untested in browser (test-gap)
E8/E22 cover transient paths (timeout, 500). `client-error`/`malformed`
are terminal-by-design (no retry, `auth-cache.ts:141-150`) with unit
coverage only. Low value per-test, but the "no retry on 400/401/403"
claim (T40/T49) has no browser witness.

### T13 — `section-a.spec.ts` Phase-2 fixmes are stale (test-gap, tidy-up)
Nineteen `test.fixme` stubs describe the authed shapes now implemented in
`section-a-authed` (E1–E22). They should become pointers ("proven in
`section-a-authed` E-n"), not parallel specifications — otherwise the next
reader will "implement" them twice and diverge the copies.

---

## C. Ops risks (not product behavior)

### O1 — Seed fragility
Sessions are 7-day; cookie files live in `$TEMP/opencode` (wiped by OS
cleanup — already bitten once this week); the Google-only seeder lives
*only* in TEMP (`seed-googleonly.mts`, hand-signed HMAC-SHA256 per
better-call's `signCookieValue`). If that file is lost, E18 cannot run and
re-deriving the cookie format costs an hour. Recommendation: check both
seeders into `scripts/` (they touch only e2e addresses + local `.env`)
and re-run them from the spec header instructions.

### O2 — The sign-out guard blinds real logout paths
`mockBackend` force-200s `**/api/auth/sign-out*` so no test kills the
shared seed. Correct tradeoff — but it means no Section A test exercises a
real sign-out, and E6/E12 navigate *around* session teardown rather than
through it. The F-section auth tests (A2/A3/A10) must stay real; don't let
their authors copy this guard.

### O3 — Runtime shape
~2.5 min single-worker green run (E8 alone is ~35s of 8s-timeout theater,
E3/E4 ~25s each of honored backoff). Splitting slow-token tests into their
own file would let the rest run in half the time and in parallel later.

---

## D. Checked and cleared (reviewed during implementation, no issue)

- **Toast XSS via server-authored messages:** bodies flow as React text
  through Astryx Toast (`AppToasts.tsx`); E15 asserts hostile `code`
  strings never render, E19's server message renders as inert text.
  No `dangerouslySetInnerHTML` anywhere on these paths.
- **E13a route precedence:** the `**/api/auth/**` abort is registered
  *after* `mockBackend` (most-recent-first wins, no conflict — different
  path space). Convention documented inline.
- **E21 OPTIONS theater:** same-origin never preflights, so the test
  faults the leg the way fetch actually sees a CORS failure (TypeError →
  offline copy). Honest simulation, documented in the test.
- **E4 lower bound vs cap:** `chatWriteRetryDelayMs` caps at exactly
  5000ms; the `>4000ms` bound has 1s of slack by construction (see T4 for
  the residual risk).
- **E11 archived leg:** both `archived=true/false` branches return empty;
  no hidden live dependency.
- **E6 silent-toast claim:** `notifyFailure` early-returns on
  `isAuthFailure`, so no persist-error toast can stack on the expiry —
  asserted, not assumed.

---

## E. Recommended fix order (after the full run)

1. **B1** (handoff) — blocks C1 and un-fixmes E1b; biggest unlock.
2. **B3** (hydration) — removes the widest allowlist entry (T3).
3. **B5–B8** (spec calls) — code-or-plan decisions; each is a one-line
   plan edit or a small behavior change, but they must stop drifting.
4. **B2 + B4** (copy consistency) — single pass over failure copy per leg.
5. **T13 + O1** (tidy + seeds) — ten minutes, prevents repeat work.
6. **T6–T12** (gap tests) — in plan order as staging allows; T9 needs a
   throwaway user, the rest are mock-only.
