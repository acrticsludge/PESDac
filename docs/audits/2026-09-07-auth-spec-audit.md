# Audit: auth surface spec v4 vs current site + backend

Date: 2026-09-07. Scope: `docs/reasonix/specs/login-signup.md` (v4) checked
claim-by-claim against `frontend/src`, `backend/app`, and CLI-verified
Astryx 0.5.2 props. Goal: no dummy residue, no unbuildable promises.
Method: static trace + template/CLI verification. No browser run.

## Verdict

Solid core, **not approvable as written**: 2 blockers, 4 factual errors,
plus dummy residue the gate makes worse. All fixable in the spec without
changing decisions D1–D12.

## A. Blockers (must fix before approval)

**B1. Google login cannot succeed — backend callback is a stub.**
Spec §B + Success #2 promise a Google round-trip, but
`backend/app/routers/auth.py:242-264` never exchanges the code, never
creates/links a user — it redirects to `?error=oauth_not_finished`, a
param the spec's error map doesn't even handle (only `oauth_failed`).
As specced, every Google login ends in a silent nothing. Fix: either add
the Authlib code-exchange + link to Phase 1 backend work and map
`oauth_not_finished` to the failure Banner, or cut the Google button to
disabled until a backend OAuth slice lands. (D1 says Google-only, so
option 1 is recommended — no decision change, just missing work.)

**B2. Logout never re-opens the gate under the specified mechanism.**
Spec §A re-opens the gate "via route-sync check", but logout happens on
`/new` with NO route change — the sync effect (`Pesdac.tsx:650-671`)
doesn't re-run, so a logged-out user keeps staring at an open,
ungated shell. Fix: drive the gate from auth state (`useAuth()`:
check on mount + explicit refresh after login/logout), keep route-sync
as backup, and navigate to `/login` on logout as belt-and-braces.
One-line spec amendment, no decision change.

## B. Factual errors in the spec

**F1. Page count is 30, not 29 (3 places: Commands, Testing, Success
#5).** Current `dist` holds 28 `index.html` files (verified); +login
+signup = 30. (No reset pages per D2 — that part is right.)

**F2. Sessions `region` contradicts Non-goals.** Spec §E promises
`region` in `GET /auth/sessions` and §G.2 renders "{region} · …", but
there is no geolocation (Non-goals explicitly exclude it) and privacy
rules forbid raw IPs in UI. There is no source for `region`. Fix: drop
the field; descriptions use relative last-used only ("Active now" for
current).

**F3. §C prefill doesn't say the mandatory local write.** Reads are
local-only per the sync policy, so "reads `apiGetProfile()` post-signup
so the dialog shows them" only works if that read SEEDS the local
store. As worded, an implementer could fetch-and-discard and the dialog
stays blank. Fix: "seed local store from the server response".

**F4. Two §E sections.** The fold-in amendment sits after §I while the
original §E sits mid-doc. Merge into one (editorial, avoids
implementation reading stale copy).

## C. Dummy residue (in the site today, untouched by the spec)

The gate makes these WORSE: today they're public dead ends; after the
gate they're dead ends you must log in to reach. Cut-or-gate each before
auth launch:

| # | Dummy | Location |
|---|---|---|
| D1 | Study Library nav item (`href="#"`, no handler) | `Pesdac.tsx:1037` |
| D2 | Settings sidebar item (`href="#"`, no handler) | `Pesdac.tsx:997` |
| D3 | Composer Settings menu: "Knowledge sources" + "About PESDac" no-op handlers | `Pesdac.tsx:1363-1371` (seen in prior read) |
| D4 | SideNav heading link `href="#"` | `Pesdac.tsx:546`, `992` |
| D5 | Static timestamps / day-divider labels (still mock) | `ThreadView.tsx:767` per prior audit — content-side, survives auth |
| D6 | `planResponse` mock responder (whole chat "brain" is fake) | `lib/responder.ts` — known, messages-spec-owned |

Recommendation: D1–D4 cut or honestly badge in this build (same
"Coming soon" precedent as 2FA); D5–D6 already owned by future specs,
no action.

## D. Consequences the spec should state

**C1. Demo browsability dies.** The 20 demo threads are today's showcase
and the gate walls them (every non-auth route, including
`/subject/...`). Intended per the gate decision — but record it, plus
the corollary: future share-links will also require login unless a
public-read exception list is specced later.

**C2. Pre-existing local users get forced onboarding.** §F triggers on
`onboarding_done == false` for logins too, not just signups. Correct
pre-launch (all data is dev), but after launch day this forces every
early account through the wizard once. Acceptable — just stated.

**C3. Gate is client-side; demo content ships in the JS bundle.**
SSR HTML is empty (safe), but the single island chunk contains all demo
threads — view-source on the JS reveals them. Low sensitivity (your own
course material), and the API remains the real boundary (spec already
says this). No action, stated for the record.

## E. Verified-clean (checked, no issue)

Backend profile-seed on signup (`auth.py:96`); export/delete-account/
clear-all endpoints exist as the spec claims (`users.py:25,42`,
`chats.py:125`); login/signup/pw-request/pw-confirm rate limits wired;
`Dialog purpose="required"` kills Esc+backdrop (CLI-verified);
`CheckboxList` + `CheckboxListItem(value,label)` props confirmed;
installed Astryx is exactly 0.5.2 (template pin matches);
`initialView` needs no change (auth pages skip `AppLayout`);
`hasPassword`/`googleConnected`/`onboarding_done`/session columns
confirmed absent (correctly planned, not assumed).

## F. Plan inputs (not spec gaps, for the build plan)

P1. Template-derived props never used in-repo (`Link type/size`,
`EmptyState`, `Button isLoading`, `Divider label`, per-field
`TextInput status`) are tsc-gated at build; risk low given the exact
0.5.2 pin. P2. `src/env.d.ts` for `PUBLIC_API_BASE_URL` is REQUIRED
(all `import.meta.env` refs today are zero). P3. Onboarding "Select all"
is a sentinel — strip before PATCH (server 422 on unknown subject is
the backstop). P4. Onboarding Selector empty-state must serialize to
`""` (sections.tsx `?? ""` idiom). P5. Mount onboarding above
`ProfileDialog` (z-order on `/profile#security` direct loads).

## G. Required spec edits (checklist for v5)

- [ ] B1: add OAuth exchange to Phase 1 + map `oauth_not_finished`.
- [ ] B2: auth-state-driven gate + navigate on logout.
- [ ] F1: 29 → 30 (×3). F2: drop `region`. F3: explicit local seed.
      F4: merge §E sections.
- [ ] C: D1–D4 decision (cut or badge) recorded.
- [ ] D: record C1–C2 as accepted consequences.
- [ ] Minor: §B "(unchanged)" leftover; §F "if the plan prefers" →
      directive; §B account-row logout behavior spelled out.
