# Spec: onboarding profile pre-fetch (slice-11 Step 2, measurement-gated)

Status: Proposed
Audit basis: `docs/slices/slice-11-popup-latency.md` §Step 2; slice-11 Step 1 (instant session) is implemented — this step is explicitly conditional ("biggest win", "optional") and MUST NOT be built unless T1 measurement clears the GO threshold below.
Stack: Astro middleware + React 19 + BetterAuth 1.7.3 + FastAPI (`/auth/me`, `/profiles/me`).

## 1. Problem (conditional)

After Step 1, `OnboardingDialog` for a signed-in user still pays, serially: live `useSession` convergence -> token mint (`GET /api/auth/token`, JWT creation reads JWKS state) -> `apiGetMe()` + `apiGetProfile()` (two backend round-trips to :8000, sharing one minted token via the 5-min client cache). If that chain measures slow (> ~1s after Step 1 on the user's machine/devtools), the dialog still opens late. If it measures fast, this entire spec is correctly abandoned — record the NO-GO and close it.

## 2. Users

- New signed-in users awaiting the onboarding wizard (campus/semester/branch/subjects).
- Returning not-yet-onboarded users (form pre-fill from the profile row).
- Already-onboarded users must see ZERO behavior change (dialog stays shut; no extra work may delay first paint).

## 3. Goals

1. Decide GO/NO-GO on real post-Step-1 timings (user's DevTools, not estimates): GO iff session-converged -> dialog-open exceeds ~1s attributable to token+me+profile.
2. On GO: move `apiGetMe` + `apiGetProfile` server-side into the Astro middleware for authenticated requests only, embed the results as JSON tags (same `<InitialSession />` pattern), and have the dialog consume-then-verify: render instantly from embedded data, revalidate lazily against the live endpoints, never show stale data as final.
3. Preserve every existing guard: identity-scoped caches (`TaggedCache` user-id checks), 401 -> global auth-required flow, onboarding completion routing, guest behavior (no prefetch, no tags beyond the session one).
4. No slower first paint: the middleware prefetch MUST run parallel to response streaming where the adapter allows, and MUST have a tight timeout (proposed 800ms, matching the existing middleware session guard) after which the page renders without embedded profile and the client chain runs as today.

## 4. Non-goals

- Slice-11 Step 4 (pre-minted token) stays deferred independently ("only if 1+2 aren't enough") — this spec does not mint-or-embed tokens. If the token mint itself dominates T1 timings, the GO decision routes to Step 4's spec instead (write it then; not here).
- No prefetch for guests (nothing to fetch; no tag).
- No change to what `/auth/me` or `/profiles/me` return; no backend change of any kind.
- No service worker, no new client cache, no public API change.
- No Astryx/theme/CSS change (logic + data plumbing only; dialog JSX untouched unless a loading-state prop is strictly required — prefer none).

## 5. User flows

### F1: New user, GO built (T2 design A or B)

1. Authenticated page load; middleware prefetch resolves within budget; HTML carries embedded me+profile.
2. Dialog opens on first post-hydration render with empty form instantly (no profile row exists yet).
3. Lazy revalidation confirms empty; no flicker (embedded and live agree).

### F2: Returning not-onboarded user

1. Dialog opens instantly with saved picks pre-filled from embedded profile.
2. Lazy revalidation: agreement -> silent; disagreement (changed elsewhere) -> update to live values (live wins; embedded is a hint, same doctrine as the session tag).

### F3: Prefetch timeout / failure / guest

1. Middleware over budget or any fetch throws -> page renders exactly as today (no tags); client chain runs unmodified. Failure is invisible and unmeasured-blameless: log server-side at most (method + path + timeout, no PII).

### F4: NO-GO outcome

1. T1 timings show the chain comfortably under threshold -> spec closed with a dated note in slice-11; zero code changed. This is a SUCCESS outcome, not a failure.

## 6. Functional requirements

### FR1: Measurement gate (T1, read-only, load-bearing)

- Measure on the CURRENT tree (Step 1 merged) in the user's real browser+network: from `useSession`-resolved to dialog-open, split into token-mint / `apiGetMe` / `apiGetProfile` via DevTools Network + Performance. Three runs each for: new user, returning not-onboarded, returning onboarded (dialog must not open; record wasted work = ~zero).
- GO iff attributable chain time p50 > ~1s. Marginal calls (±200ms) default to NO-GO — complexity must earn its place.
- If the token mint alone dominates, verdict is "ROUTE TO STEP 4", not GO.

### FR2: Server prefetch design (T2, only on GO)

Two candidate designs; T2 picks one with written justification, no hybrids without approval:

- **Design A (middleware direct):** middleware, for authenticated requests only, calls BetterAuth `auth.api.getSession` (already in-process), then HTTP `GET /api/auth/token` + backend `/auth/me` + `/profiles/me` server-to-server with a shared 800ms budget; embeds `{ me, profile }` JSON tags; client readers (`apiGetMe`, `apiGetProfile`) check tags first (identity-scoped: tag carries user-id, must equal live session user-id or be ignored), then revalidate in background.
- **Design B (route-local, no middleware):** the `/new`+`/profile` page frontmatters do the same fetch+embed; middleware untouched. Narrower blast radius (only onboarding routes pay), duplicated fetch code unless factored into a shared server helper.
- Either way: timeout -> render without tags (F3); 401 from any leg -> NO tag (never embed an error as data; client chain handles auth-loss as today); embedded payload NEVER includes tokens (Step 4 stays separate — a token in HTML is a deliberate future decision, not a side effect).

### FR3: Consume-then-verify doctrine

- Embedded data renders immediately AND schedules background revalidation on mount. Live response wins on disagreement. A revalidation that fails (offline/5xx) keeps embedded values with no error UI (they were server-fresh seconds ago) — except 401, which flows global as today.
- Identity scoping: embedded user-id MUST equal the live session user-id at consume time, else ignore the tags entirely (user-switch mid-flight). Reuse the `TaggedCache` guard philosophy; do not invent a parallel identity scheme.

## 7. Acceptance criteria

- [ ] AC1: T1 timings recorded (3 user classes × 3 runs, split by leg) with a written GO/NO-GO/ROUTE-TO-4 verdict. On NO-GO: slice-11 note appended, zero code diff. On ROUTE-TO-4: Step 4 spec requested, zero code diff here.
- [ ] AC2 (GO only): new user dialog opens with empty form on first post-hydration render with zero `profiles/me`+`auth/me` client requests before open (Network proof); returning user sees saved picks instantly.
- [ ] AC3 (GO only): forced slow/failed prefetch (middleware timeout stubbed low / backend down) renders exactly today's behavior; no error UI, no hang, console clean.
- [ ] AC4 (GO only): user-switch and 401 mid-flight cases resolve to live truth, never stale embedded data (tests + reasoned walkthrough; browser where feasible).
- [ ] AC5: already-onboarded users show zero new requests and zero timing regression vs pre-change (Network comparison).
- [ ] AC6: `npm.cmd test` + `astro check` + `astro build` + `git diff --check` pass; backend suite green with zero backend diffs.

## 8. Constraints

- `AGENTS.md` UI rules apply (logic-only change expected; dialog JSX untouched).
- Server-side fetch budget 800ms shared; never delay first paint past today's timing on timeout.
- No tokens in embedded HTML. No PII in logs (method + path + timeout only). No secrets in tests/docs.
- Max five touched source files on GO (expected: middleware OR page frontmatters + shared helper, `auth.ts` readers, one test file, slice note).
- Work on `fix/onboarding-prefetch` from main; no commit/push unless asked.

## 9. API / interface requirements

- No new routes, no envelope change, no backend change. Reuses `GET /api/auth/token`, `/api/v1/auth/me`, `/api/v1/profiles/me` exactly as the client calls them today (same headers semantics, server-side).
- Reader functions keep signatures (`apiGetMe(userId)`, `apiGetProfile`-equivalent); tag consumption is an internal fast path, not a new public API.

## 10. Data requirements

- None. No schema/migration. Embedded tags are transient HTML, never persisted.

## 11. Security requirements

- 401 on any prefetch leg -> no tags (fail closed; client handles auth-loss through existing flows).
- Embedded user-id checked against live session before use (identity-switch guard).
- No token material embedded (Step 4 separation is a security boundary, not just phasing).
- Origin story unchanged for the browser; server-to-server legs use explicit backend origin config, never request-derived hosts.

## 12. Testing requirements

- node:test for: tag consume/ignore matrix (matching/mismatched/absent user-id), timeout-fallback rendering path (injectable clock/fetch stub), revalidation-wins-on-disagreement logic. No DOM library; stub fetch + document as existing harnesses do.
- Existing suites unmodified and green (proves reader-contract stability).
- Browser (user-assisted on GO): AC2/AC3/AC5 Network proofs + timings; desktop + narrow; clean console.

## 13. Rollout / rollback

- Rollout: frontend-only. No flag (or a trivial kill-switch const if the implementer prefers — optional, default-on).
- Rollback: revert branch; client chain is untouched and resumes fully. No data impact.
