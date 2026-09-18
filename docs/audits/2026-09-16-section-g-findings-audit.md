# Section G findings audit (routing & nav, N1–N12)

Date: 2026-09-16. Scope: `frontend/e2e/section-g.spec.ts` (11 tests,
11 passed, ~40s single-worker) with real BetterAuth + Neon for the two
`[staging]` tests (N5, N11) and mocked FastAPI throughout; plus the
N7 keeper (`smoke.spec.ts` 404 test, re-run green — kept, never
deleted). No app code changed; TEMP probes deleted.

Numbering continues the Section F audit: app bugs B37+, test gaps
T66+, ops O17+. Section G deviations D41–D45 live in the spec header.

Related: `frontend/src/pages/index.astro` (root redirect),
`frontend/src/pages/subject/[subject].astro` (bare-subject
redirect), `frontend/src/pages/subject/[subject]/[code].astro`,
`frontend/src/pages/404.astro`, `frontend/src/pages/mockup.astro`,
`frontend/src/pages/mockups.astro`, `frontend/src/lib/chat.ts`
(`isChatCodeFormat`), `frontend/src/lib/session.ts`
(`pesdac-custom-chats-v1`, reconcile),
`frontend/src/components/Pesdac.tsx` (dead-link effect),
`docs/operations/browser-break-it-plan.md` (§G slashed).

Severity legend: **stop-ship** / **release-blocker** / **polish** /
**test-gap** / **ops** (same as prior audits).

---

## B. App bugs (real, filed for after the full run)

### B37 — Dev-only /mockup + /mockups ship in the prod build (release-blocker — FIXED this round)
Both pages returned 200 with zero errors in the PRODUCTION `test:e2e`
build — neither file had any dev gate. Fix applied: both routes
`return new Response(null, { status: 404 })` unless
`import.meta.env.DEV` (frontmatter top, before imports — no
redirect, no flash; `astro dev` keeps both showcases live). N8 now
asserts 404 + no-redirect for both. The DEV gate (not deletion) was
chosen deliberately: smallest behavioral delta, dev tooling intact.

### (Not bugs — closed during implementation)
- **N1 strand: by design.** Bad-format codes never enter the
  custom-thread path (no draftCode, so the dead-link effect can't
  fire) — the welcome view renders on the chat URL with a live
  composer when authed. No skeleton, no bounce, no crash. Pinned.
- **N6 trio: defined behavior.** `/new/` serves 200 in place (Astro
  default `trailingSlash: "ignore"` — no normalization); `/LOGIN`
  and `/Subject/OS/abc` both honest-404 (router case-sensitive
  throughout, dynamic segments included). Pinned, all three.
- **N9/N10 ignore: by design.** Query params ride along encoded but
  nothing reads them; hash is inert and preserved; the gate keeps its
  Create-account autofocus. `<script>` in `foo` never executes
  (dialog listener stays empty), layout holds. Pinned.

---

## T. Test-suite weaknesses (app is fine, proofs are thin)

### T66 — Reseed in beforeAll when the previous file logs out (bitten)
Section F's tail (A14) revokes the shared seed row, so Section G
inherited a dead cookie — and the mocked me leg masked the corpse
(T55 again, new file): N5 stayed on `/login`, N11 never armed, both
misread as app behavior until the reseed proved otherwise.
`test.beforeAll(ensureSeed)` now covers the file (no G test logs
out, so one mint suffices). Cross-file lesson: any spec whose
predecessor logs out must mint first, not trust the committed file.

### T67 — offsetParent lies for position:fixed (bitten)
My "visible dialog" filter used `offsetParent !== null` and counted
ZERO dialogs on a plainly-gated page — fixed-position elements have
no offsetParent. Honest visibility = bounding rect + computed style
(`width/height > 0`, not `display:none`/`visibility:hidden`). N4
uses that now.

### T68 — Pin the reconcile, not the fetch, on dead deep links (CORRECTED — the "reconcile" premise was wrong)
I asserted `messagesGet ≥ 1` to prove the 404 leg engaged — it stayed
0. Server-list sync reconciles the dead local row out of
`pesdac-custom-chats-v1` BEFORE any message fetch fires, so the
dead-link effect does the bouncing, not the thread loader. N2 now
asserts the store no longer contains the code (poll, 15s) — a
stronger pin than the counter would have been.

**Correction (Section G fix round, verified in code):** there is no
reconcile. The store is memory-only — boot purges every `pesdac-*`
localStorage key except the two `PERSISTED_KEYS` cells
(`session.ts:87-112`), so the N2 `addInitScript` seed dies before
the app reads anything, and nothing fetches because there is no
row to fetch for. The actual mechanism, end to end: the valid-format
URL code seeds `draftCode`, the store goes live with empty customs,
and the dead-link effect fires `navigate("/new")`
(`Pesdac.tsx:1308-1321`). N2's localStorage assertion pins the
purge (dead by design); the `/new` landing pins the bounce. The
spec header already says this (D53); the plan's N2 line is corrected
alongside. Lesson inside the lesson: name the mechanism from the
code path, not from the backend metaphor that feels right.

### T69 — Welcome-sends need the full mockBackend (bitten)
My trimmed probe mock had no chats-POST leg, so the send fell through
(`r.continue()`) to the dead `:8000` and stranded on `/new` —
misread as a nav problem for one round. N11 uses the complete
journal+meta router (section-d copy), where the minted code +
`journal == [user]` carry the R4-grade proof.

### T70 — The gate view always mounts 2 alertdialogs (bitten in probes)
Gate ("Log in to continue") + a hidden Delete-chat? template. DOM
counts prove nothing; N4 asserts exactly one VISIBLE alertdialog +
focus inside it, and zero dialogs after Forward to `/login`.

### T71 — Assert the redirect CHAIN, not just the landing (pattern)
N3/N12 assert `redirectedFrom()` — a future client-side bounce can't
silently replace the server 302 while keeping the test green. Cheap,
do it for every redirect pin from here on.

### T72 — Hostile query strings go through raw (pattern)
`page.goto` encodes `<script>` itself; asserting `subject=`/`foo=`
survive in the URL plus an empty dialog listener plus the gate is the
whole XSS-routing proof. No special encoding harness needed.

### T73 — Early `return` in .astro frontmatter breaks this Astro build (bitten, twice)
The obvious B37 fix — `return new Response(null, {status: 404})`
(and then the documented `return Astro.redirect("/404", 404)`) in
both pages' frontmatter — kills `astro build`: frontmatter control
flow plus the pages' `<style is:inline>` blocks (quoted font names)
fails the vite transform ("Unterminated string literal" pointed at
a CSS brace, twice, both variants). The gate lives in
`src/middleware.ts` instead (two-pathname equality check, prod
only) — no template involvement, builds clean. Rule: never gate a
route from inside its own frontmatter on this Astro version
(6.1.10); middleware is the route-gate mechanism.

### T74 — The password seed lives in the REPO ROOT, not TEMP (bitten hard)
`seed-e2e.local.mts` is untracked repo-root; every other seed helper
is TEMP. My regression "re-mint" pointed tsx at TEMP, which errored —
and because I only kept the last 2 output lines, the failure was
silent while the corpse cookie file stayed put. Two full a-authed
runs then hung on the guest gate (10-min timeouts each). Worse: the
seed script writes the cookie file even on non-200, so a failed mint
actively plants a corpse. Rule: capture the STATUS line of every
seed run, and know which directory each script lives in before
invoking it.

### T75 — WinPS IWR silently drops the Cookie header (bitten)
`Invoke-WebRequest -Headers @{ Cookie = ... }` against
`/api/auth/get-session` returned 200/null and sent me hunting a
server-side session bug that didn't exist — Windows PowerShell 5.1
doesn't transmit the restricted Cookie header that way. `curl.exe -H
"Cookie: ..."` is the honest probe, and check `HTTP:%{http_code}`
first (one of my probes ran against a dead port).

### T76 — Sub-minute UNRESOLVED_ENTRY build failures are transient lock fallout (SUPERSEDED — see H-audit T90)
Right after killing preview servers and deleting `dist/` in one
command, `astro build` failed in <1s with "Cannot resolve entry
module astro/entrypoints/prerender" — three times, with and without
the middleware file. Zero tree change later it went green and stayed
green. I burned 20 minutes "bisecting" the middleware for it (the
middleware-off detour proved nothing). Rule: a build that fails
faster than compilation should take, right after process kills,
gets ONE clean retry before any theorizing.

**Correction (H round): wrong diagnosis.** Every one of those
failures ran with CWD=repo-root instead of `frontend/` (the log
head shows `output: "static"` + `Missing pages directory`); the
"transient" was my workdir flip-flopping between seed runs
(root) and builds (frontend). T90 in the H audit replaces this
rule: build CWD is ALWAYS `frontend/`, read the log HEAD.

## Resolution (fix round, this commit)

- **B37 fixed:** `frontend/src/middleware.ts` (new) answers bare 404
  for `/mockup` + `/mockups` unless `import.meta.env.DEV`; both
  showcases stay live under `astro dev`. N8 flipped to the 404
  assertion the plan originally asked for (status + no-redirect,
  both routes).
- **N2 narrative corrected:** T68's "reconcile" premise was wrong —
  verified in code (`session.ts:87-112` boot-purge,
  `Pesdac.tsx:1308-1321` dead-link effect). Plan §G N2 line
  corrected; spec header already said it (D53).
- **Verify (final tree):** tsc clean except the 3 pre-existing;
  units 385/385; section-g 11/11; smoke+a 12/12; b+c 52/52; d 19/19;
  e 10/10; f 16/16; a-authed 24/24.

---

## O. Ops risks

### O17 — Section G: 11/11 in ~40s; G + smoke 15/15 in 41s
Fastest section yet (no streams except N11, no sleeps except the
2.5s zombie watch). Full e2e stays ~23 min single-worker.

### O18 — "Prod build" assertions need no special build
`test:e2e` already builds + serves production, so N8 tests the real
ship artifact. Any future prod-only pin (headers, route pruning,
B37's fix) rides the same command.

### O19 — Seed hygiene: one beforeAll mint covers Section G
No G test logs out or enrolls 2FA, so a single `ensureSeed()` holds
for the file. (The google seed is untouched by G.)

---

## Checked and cleared (reviewed, no issue)

- **N1 strand:** URL stays `/subject/os/ZZZ9`, welcome headings +
  live composer when authed, no gate, no 404 copy, clean (hydra
  allowance like all thread-surface tests).
- **N2 double bounce:** local-seeded row the server 404s →
  reconciled out of the store → `/new`; valid-format absent code →
  same `/new`; welcome live, identity intact (personalized heading
  off the mock user), clean.
- **N3 redirect:** server chain `/subject/os` → `/new`, gate renders.
- **N4 history:** `/new` gate → Log in → `/login` → Back → gate
  (1 visible alertdialog, focus on Create account inside it) →
  Forward → `/login` (gate gone, zero dialogs), clean.
- **N5 triple bounce:** goto, re-goto, and hard reload of `/login`
  while authed all land `/new` with live composer and no gate
  (pairs A6, reload flavor).
- **N6 trio:** `/new/` 200 in place + gate on the slashed URL;
  `/LOGIN` 404; `/Subject/OS/abc` 404; clean throughout.
- **N7 keeper:** smoke 404 test re-run green (status 404, heading,
  Fresh-chat link → `/new`); no new test, never delete.
- **N8 ship:** `/mockup` + `/mockups` both 200, no crash — filed B37.
- **N9 inert:** params preserved-encoded, zero dialogs, gate live,
  no horizontal overflow, clean.
- **N10 hash:** `#composer` preserved, no crash, focus on Create
  account, clean.
- **N11 cancel:** welcome send → thread → Stop → Back → `/new`
  (Stop gone, journal `[user]`) → Forward → thread Q-only, 2.5s
  zombie watch clean, journal still length 1, clean.
- **N12 chain:** `/` 302-chain → `/new`, gate renders.

---

## Recommended fix order (after the full run)

1. **B37** (mockup routes in prod) — FIXED: DEV gate on both pages;
   N8 is now the 404 assertion the plan originally asked for.
2. Section F leftovers — ALL CLOSED in the F commit (`c776a72`):
   **B31** (origins env), **B33** (2FA password-confirm both halves),
   **B36** (return-to-target), **B32** (Host-derived selfOrigin).
