# Spec: Retrieval frontend display (F1–F3 display binding)

Status: Draft — unimplemented. Branch: `feat/retrieval-f1-display`
(new branch; `feat/retrieval-p1-backend` stays backend-only per its
branch rule). Backend contract: P1 retrieval API as shipped
(`POST /ingest/manifest`, `POST /ingest/validate`,
`POST /retrieval/search`, `GET /retrieval/health`, `X-Request-ID` on
all responses). This spec binds the P1 §13 display contract to real
files. It changes no retrieval logic, no API shapes, no theme.

## 1. Constraints (AGENTS.md — non-negotiable)

- The Playground-exported UI is the visual source of truth. No
  redesign, no spacing/typography/color/radius changes, no custom
  HTML/CSS approximations of Astryx components.
- Astryx only (`@astryxdesign/core` 0.5.2): `Banner`, `Button`,
  `StatusDot`, existing `ChatToolCalls` chips, `Markdown`,
  `Thumbnail`+`Lightbox`, `PdfPreviewBody`, artifact cards. No new UI
  library, no Tailwind, no global CSS, no theme edits
  (`src/theme/PESDacMockupTheme.js` is authoritative).
- Smallest diff that binds the contract. New files only where listed
  in §7. No SMS-style scope growth: inline player, cursor pagination,
  ETag, and the admin ingest panel are named futures, not this spec.

## 2. Goals / non-goals

Goals:

- Every P1 search outcome has exactly one specified surface (loading,
  results, empty, 502/503, 429, 401) using existing components.
- Retrieval health is ambiently visible (sidebar dot, mirroring the
  `showKeyDot` pattern) with a retry affordance.
- Dismissal/re-show behavior is specified and tested.

Non-goals (deferred with exit criteria):

- Admin ingest panel (curator form). Exit: curator uploads outgrow the
  curl flow (§6.1 presign exit). P1 has no admin UI; F1 binds then.
- Inline video player. Exit: "Open at mm:ss" button proves
  insufficient in §9-style usage. P1 seeks `mp4#t=` in a new view.
- Answer generation / SSE / `planResponse` replacement. Separate
  completions spec (needs Recall@5 cleared first).

## 3. Backend inputs used verbatim (no new endpoints)

- Search 200: `{data: [{chunk_id, kind, page, bbox, text, latex,
  table_md, caption, concepts[], thumb_url, page_url, video null |
  {url, start, end}, score}], pagination: {limit, offset, total}}`.
- Errors: `{error: {code, message}}` with codes `VALIDATION_ERROR`,
  `RATE_LIMITED`, `EMBED_UNREACHABLE` (502),
  `EMBED_MISCONFIGURED` (503), `EMBED_SPACE_MISMATCH` (503),
  plus 401 via `AUTH_REQUIRED_EVENT`.
- Health: `{ok, provider, dims, sources, chunks,
  neurons_24h_estimate}` — no auth, pollable.
- Copy rule: render the envelope `error.message` when present
  (backend copy is UI-ready by contract); §5 titles are fallbacks
  for unreadable bodies (network failure).

## 4. Surfaces

### 4.1 Surface rules (every feature)

| Backend outcome | Surface | Why |
|---|---|---|
| 200 with results | Thread bubbles (§4.3 F2) + settled chips; no banner, no toast | Normal path |
| 200 empty bundle | Assistant message + action pills (§4.3), no banner | Empty is content, not failure |
| 422 `VALIDATION_ERROR` | Inline/composer-adjacent copy + one error toast (`AppToasts`) | User-fixable; app healthy |
| 429 `RATE_LIMITED` | Composer `status` warning + inline Retry (`sendError`/`handleRetry` idiom, `ThreadView.tsx:1102,1414,2032-2040`); one toast max | Transient; retry is the action |
| 401 | Existing global re-login flow (`AUTH_REQUIRED_EVENT`) | Identity, not retrieval — no new UI |
| 502/503 on search | Site-wide downtime bar (§4.2) + composer `status` line | Blocks the core loop |
| 502/503 on ingest | Toast + inline form error only (no admin UI exists to host a bar) | Curator flow, binds fully when the panel lands |

### 4.2 Site-wide downtime bar (search 502/503 only)

Mount in the `AppShell` banner slot (`Pesdac.tsx:1863` hosts
`<AppShell …>`; confirm the vendor banner-slot prop against
`@astryxdesign/core` 0.5.2 — full-width system bar above sidebar and
thread alike):

```tsx
<Banner
  status="error"            // 502; "warning" for first-seen 503
  container="section"       // full-width bar, no card radius
  title="Search is temporarily unavailable"
  description="Your course material can't be reached right now. Your chats and settings still work — new questions will wait until search is back."
  isDismissable
  dismissLabel="Dismiss search outage notice"
  onDismiss={recordRetrievalBannerDismissal}  // §4.4
  endContent={<Button label="Retry" variant="ghost" onClick={retryLastSearch} />}
/>
```

Rules:

- ONE retrieval banner at a time (newest incident replaces; never
  stack 502 over 503). Coexists with unrelated banners (auth expiry
  etc.) — no shared dismissal state (§4.4 keys per incident class).
- `error` exposes `role="alert"`, `warning` `role="status"` (vendor
  `statusRole` map) — announce without focus theft; focus stays in
  the composer.
- Reduced motion: mounted-or-not, no entrance-animation dependency
  (same doctrine as `ThreadView` B43).

### 4.3 F2 — search states in the thread

States, in order (all inside existing `ThreadView` structure):

1. *Loading*: existing `ChatToolCalls` running chip (`retrieve —
   course slides`, `status="running"`, `ThreadView.tsx:1812,2313`
   idiom); composer shows its pending affordance. If no first
   evidence within ~800 ms, mount bubble skeleton rows (existing
   skeleton idiom — see `ThreadHistoryLoader.tsx` / `ThreadLoaderMockups.tsx`;
   gray blocks, not a spinner).
2. *Results*: bubbles from existing parts (`Markdown` /
   `Thumbnail`+`Lightbox` / `PdfPreviewBody` / artifact cards) +
   settled duration chips + a collapsible `Banner container="card"
   status="info"` listing sources ("Answered from Unit 1 slides
   p.42, lecture 14:32") — default ON (provenance is the product),
   honoring the profile `citations` setting
   (`sections.tsx:1091-1098`) when changed; never a top bar. Video
   hits render an "Open at mm:ss" button (seeks `mp4#t=`, tooltip
   shows the segment text).
3. *Empty*: assistant message "Nothing in your course material
   covers this yet." + action pills ("Try rephrasing", "Search a
   different source", "Quiz me on what we've covered") — never a
   dead end, no banner, no toast.
4. *502/503*: downtime bar (§4.2) + composer `status` line with the
   same copy + the failed turn keeps its Retry (existing error-block
   path — retry replays the search, never duplicates the user
   message). Dismissing the bar never clears the composer status;
   resolving the incident clears both. `EMBED_SPACE_MISMATCH` copy:
   "Search index needs a refresh. Let your instructor know."
5. *429*: composer status + Retry only — deliberately NOT the top
   bar (transient, per-IP, self-resolving).

Evidence crops carry `alt` = caption, click opens `Lightbox`, every
card links "View full page" (`page_url`).

### 4.4 Dismissal + re-show policy

- `onDismiss` writes `{code, dismissedAt}` to localStorage under
  `pesdac:retrieval-banner` (device-local like drafts — never server
  state, never cross-identity; cleared on identity transition per
  the session-store doctrine).
- Hidden until: a *different* code arrives (502→503 or reverse), or
  **1 h** elapses since dismissal (quiet window — a dismissed
  persistent outage must resurface), or the next failed search for
  that class occurs after a success (flap = new incident).
- Retry re-fires the last search; success unmounts the bar and
  clears the stored dismissal. Failure keeps the bar (no toast
  spam — the bar IS the notice).

### 4.5 F3 — ambient health dot

Mirror the `showKeyDot` pattern on the sidebar Settings row
(`Pesdac.tsx:545,557,632,742,1684,1891,2217-2224`): a `StatusDot
variant="warning"` appears while `GET /retrieval/health` reports
degraded/unreachable. Tooltip: last-check time + provider + Retry
affordance re-firing the health read. Click lands on Settings. Dot
without bar = "flaky, retries working"; bar = "blocked now".

Polling: reuse the existing sidebar polling cadence (no new timer
infrastructure); every poll is one cheap cached GET.

## 5. Copy table (fallbacks; envelope message wins when present)

| Code | Title fallback | Notes |
|---|---|---|
| 502 `EMBED_UNREACHABLE` | "Search is temporarily unavailable" | `status="error"` bar + composer line |
| 503 `EMBED_MISCONFIGURED` | "Search isn't available right now" | `warning` until first failure, then `error` if persistent; student-safe, never internal roles |
| 503 `EMBED_SPACE_MISMATCH` | "Search index needs a refresh. Let your instructor know." | Never the word "curator" in student strings |
| 429 `RATE_LIMITED` | Composer status only | No title, no bar |
| Empty bundle | "Nothing in your course material covers this yet." | Assistant message + pills, §4.3 |

## 6. Test plan (frontend conventions: `npm test` node:test units + Playwright e2e sections)

- Unit (`tests/*.test.ts` style): dismissal-policy pure module
  (quiet-window math, flap detection, per-class keys); copy
  fallback selection (envelope message preferred, title fallback on
  unreadable body); scope→kind mapping reuse if duplicated.
- E2E (new `section-n` spec, mocked `/retrieval/*` at the network
  seam — never a live backend): each §4.1 row renders its surface
  and no other; bar Retry replays the search; dismissed bar
  re-shows on code change and after 1 h (clock stubbed); empty
  bundle shows pills, never a banner; 429 shows composer status
  only; focus never leaves the composer on bar mount (a11y spec
  assertions); reduced-motion bar mounts without animation
  dependency.
- Zero new sleeps; follow the existing section-spec idioms (the
  385-test suite stays green throughout — run `npm test` focused
  per task, full + e2e at checkpoints only).

## 7. File change list (this branch, frontend + docs only)

| File | Change |
|---|---|
| `frontend/src/components/retrieval/RetrievalBanner.tsx` | NEW — downtime bar (§4.2), Astryx `Banner` only |
| `frontend/src/lib/retrieval-banner.ts` | NEW — dismissal store (§4.4), pure + unit-tested |
| `frontend/src/components/chat/ThreadView.tsx` | F2 states (§4.3) around existing chips/composer/skeletons |
| `frontend/src/components/Pesdac.tsx` | Banner slot wiring + health dot (§4.5, `showKeyDot` mirror) |
| `frontend/src/components/AppToasts.tsx` | 422/429 toast bridges only if missing (reuse first) |
| `frontend/src/components/profile/sections.tsx` | Read `citations` for sources-banner default (no shape change) |
| `frontend/e2e/section-n-retrieval-display.spec.ts` | NEW — §6 e2e |
| `frontend/tests/retrieval-banner.test.ts` | NEW — §6 units |
| `docs/reasonix/specs/retrieval-frontend-display.md` | THIS file |

`src/theme/`, global CSS, and non-listed components are untouched.
Backend changes: none (needs a seeded backend to test against —
run P1 ingest first).

## 8. Definition of done

- Every §4 surface renders per the table with green runs behind it.
- Full frontend suite green (`npm test` + build + e2e section),
  zero new sleeps, no theme/global-CSS diff.
- Manual pass against seeded backend: loading skeleton visible on
  slow embed; results show provenance banner + video seek button;
  empty shows pills; forced 502 (bad provider creds) shows the bar;
  dismissal + 1 h re-show verified with stubbed clock.
- No merge until human approves (same rule as P1).
