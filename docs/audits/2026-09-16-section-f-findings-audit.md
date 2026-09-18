# Section F findings audit (auth & session, A1–A16)

Date: 2026-09-16. Scope: `frontend/e2e/section-f.spec.ts` (16 tests,
16 passed, 3.8 min single-worker) with REAL BetterAuth + Neon
(mocked FastAPI only, except A7 which meets the real backend).
No app code changed; one TEMP seed helper extended
(`seed-googleonly.mts` now also clears 2FA).

Numbering continues the Section E audit: app bugs B31+, test gaps
T52+, ops O12+. Section F deviations D34–D40 live in the spec header.

Related: `frontend/src/components/auth/AuthLayout.tsx` (forms,
bounce), `frontend/src/components/auth/AuthGate.tsx` (gate),
`frontend/src/components/Pesdac.tsx` (`handleLogout`),
`frontend/src/lib/auth.ts` (client actions), `frontend/src/lib/auth-errors.ts`
(copy), `frontend/src/lib/cache-revalidation.ts` (logout ping),
`frontend/src/lib/link-password-server.ts` (origin check),
`frontend/src/pages/api/link-password.ts` (selfOrigin),
`PESDac/lib/auth.ts` (trustedOrigins, baseURL),
`frontend/src/components/profile/sections.tsx` (Authentication,
danger zone), `docs/operations/browser-break-it-plan.md` (§F slashed).

Severity legend: **stop-ship** / **release-blocker** / **polish** /
**test-gap** / **ops** (same as prior audits).

---

## B. App bugs (real, filed for after the full run)

### B31 — Test/preview env can't do browser email auth at all (release-blocker, env)
`BETTER_AUTH_URL=http://localhost:4321` with no
`BETTER_AUTH_TRUSTED_ORIGINS`, while the suite serves preview on
`:4323`. BetterAuth trusts only its base origin → EVERY browser
sign-up/sign-in POST 403s `INVALID_ORIGIN` (probed raw). The whole
section runs only with `BETTER_AUTH_TRUSTED_ORIGINS=
http://localhost:4323` in the runner env. Same drift in a deployment
= total auth outage behind a generic banner (A8's copy proved the
masking: 403 → "Couldn't create your account"). Fix: set the var
wherever the preview port is :4323 (one line, additive, dev-safe).

FIXED 2026-09-18: `webServer.env.BETTER_AUTH_TRUSTED_ORIGINS=
http://localhost:4323` in `frontend/playwright.config.ts` (committed,
scoped to the server under test — dev :4321 needs nothing), plus
`.env.example` documents `:4321,:4323`. Full section F runs green on
it with zero per-run env setup.

### B32 — link-password selfOrigin is fixed :4321 on the :4323 server (release-blocker)
Host-spoof matrix against `/api/link-password` (no session, so the
403/401 line is the pure origin verdict): `:4321`/`:4321` → 401
(pass), evil/evil → 403, `:4323`/`:4323` → 403, `[::1]` → 403,
`:4323`-Host + `:4321`-Origin → 401 (pass). `self` is NOT the
request Host — it is fixed `http://localhost:4321`. Consequence: on
any server where the public origin isn't :4321, Google-only users
cannot link a password ("Origin not allowed."). A5 pins the honest
403 + unchanged-state; the positive path is proven (direct 200
{ok:true} on an origin-aligned server), so the feature logic is
fine. Staging must prove which origin `url.origin` takes in prod
before this is called prod-safe — same env-origin family as B31.

FIXED 2026-09-18, mechanism corrected: the code passed Astro's
`url.origin` — which under `astro preview` reports the baseURL port
(:4321) even when the request Host is :4323 (server-logged as
self=:4321/origin=:4323/host=:4323; raw `node entry.mjs` does NOT do
this — launcher-dependent URL construction). Self now derives from
the request Host header (`selfOriginFromRequest`, XFP-aware scheme,
fail-closed — spoofing analysis in the doc comment). A5 rewritten
as the full link → logout → email-login-with-new-password flow and
green; unit pins for the helper added. The audit's matrix stands;
only the "fixed :4321" mechanism note is superseded by this.

### B33 — 2FA enroll is broken for password users (release-blocker)
`enableTwoFactor()` sends no password; the server demands one when a
credential exists. The UI has no password-confirmation step, so
"Enable 2FA" always fails with the RAW server string "Invalid
password" (4xx passthrough — server wording leaks to users, too).
A11 pins it on a fresh password user (no setup card, button stays).
Passwordless (Google-only) enroll/verify/disable works end to end
with in-spec TOTP — same test, green half. Fix: password-confirm
step in the enroll card (or send the session proof the server
wants); map the failure to authored copy.

FIXED 2026-09-18, scope widened: `/two-factor/disable` demands the
password too (same schema), so BOTH halves got the confirm step —
one mode-aware "Confirm your password" card (enable/disable),
`enableTwoFactor(password?)` / `disableTwoFactor(password?)`
plumbing, and authored copy for the wrong-password case
(`toTwoFactorEnrollMessage` / `toTwoFactorDisableMessage` — the raw
"Invalid password" never surfaces now). A11 rewritten: password-user
wrong-password copy + full enroll→verify→disable cycle, then the
passwordless cycle unchanged. New TEMP `seed-2fa.mts` resets the 2FA
user first — a run that dies between verify and disable would
otherwise challenge the NEXT login for a lost secret.

### B36 — Post-login drops the deep target silently (release-blocker — the plan's designated catch)
Guest deep-link → gate → login lands hardcoded `/new`
(`navigate("/new")`, no `returnTo` anywhere). A16 pins it: session
proven, composer live, target gone without a word. Either carry the
target through login or state the policy in UI.

FIXED 2026-09-18, three parts: (1) the gate carries
`?returnTo=<deep target>` on both buttons; (2) AuthLayout honors it
(email, 2FA-verify, and authed-bounce navigations) with a tight
allowlist (same-origin app paths; auth pages, absolutes, and
`//` tricks fall back to /new) and preserves it across the
login↔signup swap link; (3) the guest deep-link bounce is deferred
— it fired for guests (whose store never holds customs) and moved
the gate to /new BEFORE the gate could capture the target, which
made returnTo faithfully useless. Two racy doubles were caught
along the way: the authed-bounce now skips off-auth-path renders so
it can't yank a fresh login back to /new. A16 rewritten (lands back
on the thread, live session). Google redirect untouched (lands
wherever the callback puts it — residual, documented).

### (Not bugs — closed during implementation)
- **A6 2026-09-14 overlay finding: FIXED.** Authed `/login`
  bounces to `/new`, gate shut, composer live (5s, green).
- **A2 split-state scare: retracted.** The gate DOES open on
  sibling logout — the "absence" was my wrong role (`dialog` vs
  `alertdialog`, T52). Ping wipe + empty reproof + in-place gate
  all hold; the plan is vindicated as written.
- **A8 taken-copy: works.** Real 422
  `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` → specific Banner +
  password kept. (An early "dead copy" theory was wrong — it was
  the B31 403 masking it.)
- **A13/A4 deltas are design, not bugs:** no reset flow (no email
  sender — absence pinned: no link, `/forgot-password` 404s);
  Google is a redirect, not a popup (abandon pinned via hung leg).

---

## T. Test-suite weaknesses (app is fine, proofs are thin)

### T52 — The gate is `alertdialog`, not `dialog` (bitten twice)
`purpose="required"` renders role=alertdialog. A2's absence assert
passed vacuously and A4's presence assert failed spuriously until
the helper was fixed. Read the a11y snapshot before theorizing.

### T53 — Sidebar Logout/Login are LINKS (bitten: 2-min timeout)
`getByRole("button")` never resolves; the click just burns the test
timeout. (Gate buttons ARE buttons — scope the lesson to the
sidebar footer.)

### T54 — Every cookie test must mint its own session (bitten repeatedly)
Any UI logout/sign-out revokes the SHARED seed row server-side, so
one test's logout murders the cookie for all later tests (and the
mocked `/auth/me` masks the corpse — composer-ready ≠ authed,
T55). `ensureSeed()` at the start of every cookie test (~4s each);
fixed emails + taken-fallback for non-deletable users (T61).

### T55 — Mocked identity masks dead sessions (bitten in A6 diagnosis)
With a dead cookie + mocked me, `/new` looks perfectly authed; only
the real `get-session` (or a bounce that never comes) tells the
truth. Non-circular identity proof: `realSessionEmail()` against
the never-mocked `[...slug]` endpoint.

### T56 — Same-tick toast+nav needs a MutationObserver (bitten)
`handleLogout` toasts then navigates in one tick — the toast paints
(≥1 frame, observer-caught) but locator polls miss it reliably.
A10 installs the observer BEFORE the click and reads after.

### T57 — Profile nav items are BUTTONS, not tabs (bitten)
`Authentication` et al. are `getByRole("button")` despite living in
a tab-like rail.

### T58 — Post-wipe reproof must come back empty (bitten)
The ping wipes p1's store and it reproves IMMEDIATELY — a static
chats list re-serves the rows and masks the wipe (mutable
`loggedOut` leg in A2).

### T59 — Bare POSTs trip BetterAuth CSRF (probed)
`fetch(..., {method:"POST"})` without JSON content-type →
"Cross-site POST form submissions are forbidden". Sign-out-from-
evaluate needs `Content-Type: application/json` + `{}`.

### T60 — In-spec TOTP works against the real server (enabler)
base32 decode + RFC 6238 (SHA1/30s/6-digit) verified end to end in
A11 (enroll + verify on-class). Reuse for any future challenge test.

### T61 — Fixed emails + taken-fallback beat timestamp emails (pattern)
For users that can't be deleted here (backend-down), timestamp
emails litter Neon; fixed email + signup-or-login is hermetic with
exactly one row ever (A3/A7/A11).

### T62 — Google reset now also clears 2FA (coupling note)
`seed-googleonly.mts` extended (`two_factor_enabled=false` +
`DELETE FROM two_factor`) because A11 enrolls on that seed — the
next A5 self-heals even if A11 dies mid-enroll.

### T63 — Multi-nav auth tests need the transition allowance (A16)
Rapid Astro transitions fire "Transition was skipped" pageerrors —
same `extraAllow` shape as A1/A2.

### T64 — Read error-context.md FIRST (section discipline)
A5/A8/A11 were each solved in one step from the a11y snapshot
(actual roles, actual copies) after costlier theories failed. The
snapshot is cheaper than any hypothesis.

### T65 — Backend :8000 is down on this box (env fact)
IPv4-only bind + `:4321`-only FRONTEND_ORIGINS. Backend-first flows
(A7) pin their failure branches here; the complete path is
staging-only (O14). A started backend also needs its JWKS source
(`:4321`) alive or every JWT 401s — verified the hard way.

---

## O. Ops risks

### O12 — Section F: 16/16 in 3.8 min
Full e2e is now ~22 min single-worker. No split needed (A9's 6×
reload loop and A11's full cycle are the long poles, both inherent).

### O13 — Section F REQUIRES the origins envvar (CI blocker)
`BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:4323` (or whatever
serves preview) must be in the runner env — without it every
form-auth test 403s with misleading generic copy. B31 is the fix;
this is the process half.

### O14 — A7-complete + live-backend proofs need staging
This box is backend-down by the plan's Phase-1 definition. Staging
needs: backend up + dual-stack/aligned bind + FRONTEND_ORIGINS
covering the preview origin + JWKS reachable (its BETTER_AUTH_URL
host alive) — each link was observed breaking independently.

### O15 — Seed/session hygiene rules (follow them)
Password seed: `ensureSeed()` per cookie test (each sign-in leaves a
Neon session row — dev only). Google seed: reset-first in A5/A11
(now 2FA-clearing). Fresh-user tests use fixed emails (T61). Probe
scripts must reseed too — three separate dead-cookie wild-goose
chases this section, all the same cause.

### O16 — Stray processes (disclose + clean)
Killed during investigation: a node process believed to be my dev
server (PID 26972 — if that was YOUR dev server, sorry; restart
`npm run dev`), A5-spawned :4321 previews (taskkill-verified
gone), a manual :8000 backend (killed after use). :4321/:8000
confirmed free at section end. Orphaned `e2e.del.*` Neon rows from
failed A7 runs: deleted (3 rows).

---

## Checked and cleared (reviewed, no issue)

- **A1 real-kill expiry:** server-side sign-out + mocked 401 leg →
  expiry copy, locked composer, `/login`. (Mocked-only death
  doesn't trip — nothing revalidates mid-turn; the mock leg stands
  in for the real backend's JWT rejection.)
- **A2 sibling logout:** ping → wipe → empty reproof → gate opens
  in place, Login footer, rows gone, keys swept (ping key survives
  by design), real session null for both.
- **A3 switch:** logout → signup-or-login as B → real B session,
  B-list only, A-thread gone.
- **A4 abandon:** hung social leg → still `/login` → goto `/new`
  → gate, zero session minted, Login footer.
- **A5 link (fixed B32):** full link → logout → email-login-with-
  the-new-password flow, session proven at each step. (The old
  honest-403 pin stood on the url.origin mechanism, corrected above.)
- **A6 bounce:** fixed (see above).
- **A7 failure branch:** backend-first ordering fails honestly —
  calm toast, no nav, heap + session intact.
- **A8 taken:** specific Banner, URL stays, password kept, no session.
- **A9 corrupt keys:** 6/6 garbage keys boot clean; thread opens after.
- **A10 fail-safe:** observer-caught generic toast, `/login`,
  gate on `/new` (local cleared despite server failure).
- **A11 cycle (fixed B33):** password-user wrong-password authored
  copy + full enroll → verify → disable (password-confirmed both
  halves), then the passwordless cycle unchanged — both green with
  in-spec TOTP, seed users left clean.
- **A12 no-lockout:** identical copy ×5, 6th (correct) lands `/new`.
- **A13 absence:** no forgot copy on `/login`, `/forgot-password` 404.
- **A14 alive:** B shows no gate, Logout footer, live session,
  profile acts after A's logout (separate storage — no ping crosses).
- **A15 429:** calm Banner, button re-enabled (no spinner leak),
  password absent from the message, no session.
- **A16 return (fixed B36):** gate carries ?returnTo, login lands
  back on the deep thread with live session + live composer.

---

## Resolution (2026-09-18)

- **B31(env), B32, B33, B36 all fixed** (see per-finding notes).
  Section F is fully closed: 16/16 green on the final tree.
- **B34 (E's Astro-transition race) corroborated here:** A3/A11/A16
  carry the same `["Transition was skipped"]` extraAllow (T63) — the
  double-navigation shape (form login + authed bounce, gate + login)
  trips it ~25% of runs, gate-only noise, functional pins hold.
- Verify:   `tsc` clean (same 3 pre-existing errors elsewhere), unit
  385/385 (incl. 2 link-password helper + 5 auth-errors mapper pins),
  section-f 16/16, plus full regression: section-e 10/10,
  section-d 19/19, section-b 26/26, section-c 26/26,
  section-a-authed 24/24, section-a + smoke 12/12.

### T66 — Stale preview servers silently poison runs (bitten hard)
`reuseExistingServer:false` does NOT protect you: if an orphaned
`astro preview`/`node entry.mjs` still holds :4323, the new server
dies EADDRINUSE while the `url` health-check passes against the
STALE one — every test then runs against the wrong build with zero
signal (an hour was spent chasing "impossible" 403s served by a
ghost). Before any suite: `Get-Process node | Stop-Process`, then
confirm connection-refused. Never leave Start-Process servers alive
across tool calls (jobs don't survive; wrappers orphan grandchildren
— kill by process, verify the port).

### T67 — `url.origin` is launcher-dependent (bitten, B32)
Under `astro preview`, Astro's API-route `url.origin` reported the
baseURL port while Host said otherwise; raw `node entry.mjs` on the
same dist reported Host faithfully. Never use `url.origin` for a
security decision — derive self from the Host header (B32's
`selfOriginFromRequest`).

### T68 — 2FA-off state must be reset server-side, not just UI-clicked (bitten)
A run dying between TOTP-verify and disable leaves 2FA ON, and the
next login challenges for a secret nobody has — no UI flow recovers
(`seed-2fa.mts` resets first; the in-test Disable self-heal only
covers the logged-in half).

### T69 — Real-logout suites murder static cookie files cross-suite (bitten: E 8/10 red, A-authed E18 red)
The F campaign revoked the shared seeds as a side effect: E's
`seed-cookies.json` died (8/10 red with zero code change — every
test timed out guest-gated) and the Google seed died (A11-disable
and/or A5-logout; E18 went guest-gate). Which exact test is moot —
any suite that really logs out is incompatible with any suite that
reads a static cookie file. Fix applied at the victims (T54/O15
doctrine extended): section-e mints per-test via `ensureSeed()`,
section-a-authed's E18 via `ensureGoogleSeed()`. Rule: NO committed
suite may depend on a cookie file it doesn't mint itself.

### T70 — Neon reaps idle connections; the preview has no pool guard (observed, out of scope)
One a-authed run died wholesale when Neon sent `terminating
connection due to administrator command` and the pg Pool's unhandled
'error' event crashed the whole preview server (every remaining
test cascade-failed). Transient infra (rerun green), but the pool
wants an error listener before this box ever hosts anything shared.
Not fixed here — app-behavior suites shouldn't own pool plumbing.

## Recommended fix order (after the full run)

1. **B31** (origins env for preview/test) — one additive line;
   unblocks the suite and removes a deployment footgun class.
2. **B33** (2FA enroll password step) — feature dead for password
   users; also map the raw "Invalid password" to authored copy.
3. **B36** (return-to-target) — the plan's designated catch; carry
   `returnTo` through login or state the drop.
4. **B32** (selfOrigin fixed `:4321`) — determine the mechanism
   (adapter base vs config), prove staging behavior, align the
   preview port or derive from Host; A5 becomes the full flow then.
5. **O14** (staging) — rerun A7-complete (wipe → heap drop →
   recreate-clean) plus backend-backed appends with real JWTs.
