# Section J findings audit (security probes, S1–S12)

Date: 2026-09-16. Scope: `frontend/e2e/section-j.spec.ts` (9 tests,
9 passed, 1.4 min) — S1/S2/S4 by reference to their home sections
(I6+I13, I7, E14), S3/S5/S6/S7/S8/S9/S10/S11/S12 live here. Real
BetterAuth + Neon throughout; the REAL FastAPI backend on :8000 for
the server-contract legs (S5/S6/S11), booted with FRONTEND_ORIGINS
including :4323 and BETTER_AUTH_URL pointing at :4323 for JWKS.
No app code changed.

Numbering continues the Section I audit: app bugs B47+, test gaps
T100+ (the J audit's original T91–T97 collided with the H fix round's
T82–T91 and the I round's T92–T99 and were renumbered), ops O26+.
Section J deviations D63–D66 live in the spec header.

Related: `frontend/src/lib/api/errors.ts` (toUserMessage),
`frontend/src/lib/toast-policy.ts` (redactForLog),
`frontend/src/lib/chat-sync.ts` (adopt key, messages path),
`backend/tests/test_chats_adopt_idempotency.py` (server contract),
`docs/operations/browser-break-it-plan.md` (§J slashed).

Severity legend: **stop-ship** / **release-blocker** / **polish** /
**test-gap** / **ops** (same as prior audits).

---

## B. App bugs (real, filed for after the full run)

### B47 — Send-failure toast uses its own fallback, not the 5xx copy (polish, FIXED this round)
S3's append-500 surfaced `"Couldn't save that message. Try again."`
— the send path's private fallback — instead of the toUserMessage
5xx copy (`"That didn't work on our end…"`) that the profile/settings
surfaces show for the same status (S12b proves that path). Calm and
honest, but inconsistent: the same server condition reads as "our
end" everywhere except the send path, which also loses the
server-vs-connection distinction E2/A-steps pin elsewhere. Route the
send-failure toast through toUserMessage like every other surface.
Fix: `persistAppendedBlock` (session.ts) passes a
toUserMessage-resolved body into notifyFailure + resolveFailureCopy
— scoped to the send leg, so B4's fixed-copy rule stands everywhere
else. 500s read the 5xx copy, transport reads the connection copy
(the B2 distinction the send leg never had), known 4xx pass the
server message through, 401s stay silent. S3's assert flipped to the
5xx copy; the offline legs in sections D/E/I now pin the connection
copy; two unit files updated to the 5xx copy.

### (Not bugs — closed during implementation)
- **S9's "invalid email" was my regex, not an oracle.** Both halves
  return byte-identical 401
  `{"message":"Invalid email or password","code":"INVALID_EMAIL_OR_PASSWORD"}`.
  The shared opaque verdict IS the indistinguishability proof.
- **S7's "user data" was my oracle, not a leak.** The stranded
  welcome renders the shell with the signed-in user's OWN identity —
  legitimate N1 behavior, not traversal output. Reframed to
  not-a-data-page (no redirect, no profile markers) and it holds.
- **S3's HAR "leaks" were minified source, not secrets.** The words
  password/Bearer/email in `/_astro/*.js` are field labels, the
  withBearerToken template, and validation copy. API-response-only
  sweeping is the honest scope (D63).
- **S6's hydra #418 is the known SSR pattern**, not a regression —
  real backend rows hydrate like thread turns. Same allowance as the
  thread legs.

---

## T. Test-suite weaknesses (app is fine, proofs are thin)

### T100 — Composer is combobox, never textbox (bitten 5×)
Every S-leg that waited on `getByRole("textbox", /message/i)` failed;
the composer is `role=combobox` named "Message input"
(section-i:471). `composer(page)` helper now centralizes it — any
future textbox-wait is instantly suspect.

### T101 — Transient toasts need snapshot polling (bitten)
Astryx auto-dismisses: S3's append toast lived ~seconds and a single
end-of-test read misses it. `snapUntil` (poll status/alert roles
into a set) is the pattern; point-asserts on toast copy are flaky by
construction unless the toast is proven persistent.

### T102 — HAR sweeps must exclude static bundles (bitten)
See S3 above. API-traffic-only (`/api/` URLs); request headers
excluded (Bearer by design); session/mint identity carriers scoped
(JWT only in mint bodies, emails only in `/api/auth/*`).

### T103 — getByLabel matches across label styles (bitten)
`getByLabel("Display name")` matched BOTH the input and the "Save
display name" button (aria-label containment). Prefer
`getByRole("textbox", { name })` for inputs.

### T104 — Toggled controls must be opened first (bitten)
The sidebar search input mounts only after the "Search
conversations" SideNavItem toggle (Pesdac.tsx:1890). Closed-drawer /
unopened-toggle controls read as absent — click the toggle, then
fill.

### T105 — Backend liveness is per-invocation (bitten, procedure)
The detached backend died between shells twice (000, then
`Failed to fetch` in-page). Live legs must boot + verify
(`GET /chats` → 401) + run the suite in ONE invocation — never
assume a prior shell's daemon survived.

### T106 — Oracle tests need vacuity guards (pattern)
An origin-blocked 403 pair would also be "indistinguishable" — S9
asserts the bodies contain no `origin` verdict AND pins the exact
opaque message. Any equality-oracle over server responses needs the
equivalent guard against the degenerate equal case.

---

## O. Ops risks

### O26 — Preview origin must be trusted or auth POSTs 403 (env)
Without `BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:4323` the
preview's BetterAuth rejects its OWN origin's POSTs (a ~2Hz
`Invalid origin` storm in the server log) — and S9-style oracle
tests go vacuous. Same class as B31 (origins env). The uniformly
green run sets it; any future runner/CI must too.

### O27 — Synthetic secret rejections echo raw via pageerror (note)
The redaction unit covers the APP's log line (proven: `[redacted]`,
raw absent). But Chromium's uncaught-error channel echoes the
synthetic rejection raw — no app code can redact another channel's
echo. No app path throws secret-carrying rejections today, so this
is defense-in-depth context, not a bug: keep secrets out of
rejection reasons and the question never arises.

### O28 — Section J: 9/9 in 1.4 min, backend procedure
Boot backend with the two overrides (FRONTEND_ORIGINS + :4323,
BETTER_AUTH_URL → :4323 for JWKS), verify 401, run. Kill the daemon
after (it does not survive shells reliably — T105 — so orphan risk is
low but verify :8000 is closed). S5/S6 create + DELETE their rows
(record → cleanup → assert); a mid-test abort could leave
`s5-adopt-*`/`s6 *` rows on the seed account — harmless, titled for
grep-ability.

---

## Checked and cleared (reviewed, no issue)

- **S1/S2/S4 (stop-ship trio):** I6+I13 (XSS inert, file-backed too),
  I7 (injection echoed, no leak), E14 (403/404, zero foreign bytes).
  No change since their audits; still green in their files.
- **S3:** append-500 + profile-500 swept — 4 console lines, 5 toast
  snapshots, 26 API response bodies, zero secret shapes (mock
  fixture address exempt, real seed address forbidden); injected
  Bearer/password rejection logs `[redacted]` with raw absent. The
  append-500 toast reads the toUserMessage 5xx copy (B47 fixed).
- **S5:** live `first=201 replay=200 sameCode=true rows=1
  cleanup=204` — the exact server contract from a real browser
  session + real JWT.
- **S6:** `' OR '1'='1` and `; DROP TABLE chats;--` filter to zero
  rows literally; both rows survive server-side; cleanup 204/204.
- **S7:** encoded traversal 200s into the N1-stranded welcome (live
  composer, URL preserved, no profile markers) — router normalizes
  safely.
- **S8:** evil-origin (`:4873`) POST preflight-blocked (TypeError);
  no session minted (guest gate after); same-origin control 200.
- **S9:** oracle identical down to the byte; no enumeration half
  named. Two attempts total — no lockout engagement (A12's ×5
  already proved that absence).
- **S10:** 8k path → 404, app alive, single console line (no spam).
- **S11:** logged-out `GET /chats` → 401 + `UNAUTHORIZED` envelope,
  zero data rows — with zero mocks and a probe that sends no auth
  and reads no secrets.
- **S12:** 400-empty → `"Couldn't save. Try again."`, 500-hostile →
  generic 5xx (server text suppressed), 404 → 404 copy, known 400 →
  server message passthrough; `ZZ_UNKNOWN_CODE_9` never in the DOM;
  dialog open after all four; exactly 4 PATCHes.

---

## Recommended fix order (after the full run)

B47 (the only app bug) is fixed in the J fix round (this commit) —
kept as the work log:

1. **B47** (send toast via toUserMessage) — one call site
   (`persistAppendedBlock`); S3 re-run with the 5xx-copy assert.
   Ripple (same commit): sections D/E/I offline legs now pin the
   connection copy; `chat-backing` + `chat-error-display` unit files
   updated to the 5xx copy. 401-silence and B4 elsewhere untouched.
2. Closed elsewhere before this round: **B31** (origins env),
   **B33** (2FA enroll), **B36** (return-to-target) — F commit;
   **B37** (mockup routes) — G commit; **B45** (composer aria),
   **B46** (tool-call contrast), **B39–B41/B43/B44** (focus, motion,
   targets; B42 verified) — I commit. Still open: **B38**
   (Slow-3G gate).
3. Process: **O25** (K12 quarterly pass — owner + schedule),
   **O14** (staging), **O28** (J backend procedure into CI docs).

---

## Resolution (fix round, this commit)

- **B47 fixed** (see the B47 entry + item 1 above for the mechanism
  and ripple).
- **S5/S6 BLOCKED on a backend env issue (no app change):** the
  FastAPI backend 401s (`UNAUTHORIZED — Invalid or expired session`)
  frontend-minted JWTs even with the preview up and a 200 JWKS
  endpoint — every authed backend call fails, so the app's
  401-handler bounces S5/S6 to /login before they start. Probed
  end-to-end (mint 200 → chats 401). The audit-day 9/9 ran against
  a backend that validated; something in the backend/JWKS path has
  drifted since (warmup logs `ConnectError`, no per-request
  recovery observed). Backend-owned investigation, not frontend.
  S11 (expects 401) still passes against the same backend.
- **Verify (final tree):** tsc clean except pre-existing + foreign
  (`section-e` update prop, `section-h` Performance.memory, db `pg`
  types, foreign `section-f`/`section-h` `_context` renames,
  foreign `src/middleware/auth.ts` + `audit-auth.ts`);
  units 385/385; section-j 6/6 backend-free legs (S3/S7/S8/S9/S10/
  S12); S11 green in the live run; S5/S6 blocked per above;
  smoke+a-authed 28/28; b+c+g 63/63; d 19/19; e 10/10; i 14/14.
