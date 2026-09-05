# Backend-readiness audit — what remains before backend work

Date: 2026-09-06. Scope: everything standing between today's mockup and a
backend integration that doesn't rewrite UI. Method: static trace of every
mockup-stage seam (`session.ts`, `responder.ts`, `attachments.ts`,
`references.ts`), content-model inventory, config check
(`astro.config.mjs`, `package.json`), dead-control census. No browser run
(Playwright still absent — see §6).

Status labels (inherited from the 2026-09-05 gap audit): **Missing**,
**Half-built**, **Dead control**, **Latent bug**, **Backend-gated** — plus
**Decision** (a choice the backend phase must make first) and **Contract**
(a spec the backend must implement, already written).

Prior audits: `2026-09-04-monolith-to-backend-audit.md` (migration plan —
Phases 0–2 are now done: stable codes, typed content, URL model, session
store), `2026-09-05-chat-section-gap-audit.md` (ChatGPT parity + errors —
§8 slices 1–7 shipped, plus edit/shortcuts/feedback/multitab/find/drafts
since). This audit covers only what is *still* open.

## 0. Already backend-shaped (do not rebuild)

`session.ts` is the seam: every mutator (`createCustomChat`,
`appendBlocks`, `truncateOverlay`, `togglePin`, `archiveChat`,
`setFeedback`, …) has a backend-shaped signature and emits on write;
`useSessionVersion` subscribers re-read, which is exactly the shape an
`api.ts` fetch adapter slots into. `responder.ts` isolates all fake
cognition (plus failure simulations) behind `planResponse`. Types in
`content/threads/types.ts` already carry `toolCalls.status: "error"`,
`AssistantBlock.error`, `Attachment{id,name,mime,size}`, `MentionToken`.
All 20 demo threads exist (4 × CN/OS/DLCD/DSA/Math) with tool calls,
quizzes, PDFs, and images. Error taxonomy + SSE shapes are specified in
`docs/reasonix/specs/error-states.md`; edit/shortcuts/feedback/find/drafts
in `docs/reasonix/specs/chat-power.md`.

## 1. Hard blockers (resolve before or with backend start)

1. **No backend seam exists in code — Missing.** Zero `fetch`,
   `EventSource`, or `import.meta.env` references in `src`. The seam is
   architectural (separate modules) but not yet an interface: there is no
   `src/lib/api.ts`, no `USE_API` flag, no request/response types. First
   backend slice must introduce the adapter *against the specs* without
   touching components — if a component has to change, the seam was drawn
   wrong.
2. **Static-only output — Decision.** `astro.config.mjs` is bare
   (`react()` integration only): 27 prerendered pages, no adapter, no API
   routes, no SSR. SSE streaming and uploads need either (a) `output:
   "hybrid"` + server endpoints, or (b) an external backend + CORS + env
   config (which itself is **Missing**: no `.env`, no config module).
   Decide before writing any endpoint code.
3. **No identity — Decision.** Customs, overlays, votes, drafts are keyed
   to the device (`localStorage`, no user id, no login, no session
   token). Backend scoping needs an answer first: anonymous device id
   (migrate local data on first contact?) vs real auth (login pages,
   route guards, token storage — all **Missing**).
4. **localStorage has no versioning or bounds — Latent bug.** Keys are
   `-v1` by convention only; no migration path, no quota guard on
   unbounded overlay growth, corrupt JSON silently falls back to empty
   with no signal (gap audit §4b.4/§4b.5, still open). Harmless in mockup;
   the backend migration must define export-or-drop per key (drafts and
   votes are safe to drop; customs/overlays/pins need a decision).
5. **Zero automated verification — Missing.** No test runner, no unit
   tests, no Playwright (`npx playwright install` never run). Backend
   wiring without a smoke net means every SSE/upload/auth change is
   hand-verified. Minimum before backend: Playwright smoke (send, stop,
   retry, attach, keyboard-only send, 360px composer) — spec'd in gap
   audit §7, never executed.

## 2. Should-fix pre-backend (frontend-only, cheap)

1. **Markdown sanitization source-check — still open** (gap audit §4c.1).
   Becomes stored-XSS-adjacent the moment the backend echoes user text.
   Verify Astryx `Markdown` sanitizes; if not, escape-at-render before
   any real wiring.
2. **Quiz copy overpromises — Half-built.** `responder.ts:103-113`
   answers "quiz me" with questions and ("I will check them step by
   step")-style promises; `QuizBubble` renders as plain markdown
   (`ThreadView.tsx:963`). Interactive checking is **Backend-gated**;
   until then, tone the copy down to "try these, then ask for the
   walkthrough" so the mockup doesn't demo a lie.
3. **@-tokens don't render inside user bubbles — still open** (gap audit
   header note). `MentionBubble`/`ChatTokenizedText` paths exist but live
   sends store plain `text` bubbles; the `@slides` token is invisible in
   the sent message. Small fix, do it before backend so the echo rule
   ("never interpolate raw user text into markdown") has a visible
   token shape to point at.
4. **Corrupt-overlay signal — still open** (gap audit §4b.5). One-time
   warning status + console error on JSON parse failure; ~10 lines.
5. **Bundle >500 kB warning, no splitting.** Every build prints the Vite
   chunk-size warning; the whole app ships in one island. Pre-backend:
   confirm it's the Astryx+React baseline and set
   `chunkSizeWarningLimit` or route-split — don't let backend code bloat
   hide inside an unmeasured bundle.
6. **Demo timestamps are static strings; day dividers are mock labels**
   (`ThreadView.tsx:767`). Backend sends real dates (contract already in
   `error-states.md`); frontend needs no change, but seed content should
   not be mistaken for real recency grouping later.

## 3. Dead controls — ship, cut, or gate (Decision each)

Still rendering with `href="#"` or no-op handlers: Study Library
(`Pesdac.tsx:1007`), Settings + My Profile (`Pesdac.tsx:971-976`),
SideNav heading link (`Pesdac.tsx:542`), welcome Settings menu items
("Study preferences / Knowledge sources / About PESDac"), study-note
Share, read-aloud (noted, low priority). None may survive backend start
as silent no-ops: either cut them now or mark each **Backend-gated**
with a tracked owner (share links and quiz checking already are).

## 4. Contract inventory (backend implements; specs exist)

| # | Capability | Spec | Frontend state |
|---|---|---|---|
| 1 | SSE turn stream (`turn.done/failed/empty/rate_limited`, tool transitions) | `error-states.md` | Mock `planResponse` + timers; swap only |
| 2 | Uploads (`POST /uploads` → `{id,name,url}`, quota, progress) | `error-states.md` §upload | Staging + drawer + `Attachment` type done |
| 3 | Turn feedback (`POST /turns/{id}/feedback`; voteKey → turn id) | `chat-power.md` §5 | Side-map votes done |
| 4 | Message edit = truncate + resend (server-side history rewrite) | `chat-power.md` §1 | `truncateOverlay` done |
| 5 | @-token parsing/scoping (never echo raw text into markdown) | gap audit §4c.1 | `references.ts` done |
| 6 | Real dates for dividers/recency | `error-states.md` | Mock labels done |
| 7 | Share links | gap audit §2.7 | **Missing** (no UI stub) |
| 8 | Interactive quiz checking | gap audit §2.6 | Markdown-only; copy fix in §2.2 |
| 9 | Context meter + truncation notices | gap audit §4a | **Missing** (`headerContext` unused) |
| 10 | Drafts | `chat-power.md` §9 | Local-only by design — no backend |

## 5. Suggested backend phase 0 (first slices, UI frozen)

1. **Decision record**: hosting/SSR shape (§1.2) + identity (§1.3) + per-key data fate (§1.4). One ADR, no code.
2. `src/lib/api.ts` implementing the `session.ts` signatures over `fetch`
   against same-origin stub endpoints; `USE_API` env flag defaulting off.
   Zero component changes is the acceptance test.
3. Playwright install + smoke spec (§1.5) — the net everything after
   stands on.
4. Uploads end-to-end (staging UI already done; smallest vertical slice
   with visible payoff).
5. SSE turn stream replacing `planResponse` timers (error taxonomy in
   `error-states.md` is the test matrix; `simulate *` triggers become
   the manual test rig).

## 6. This audit's own limits

Static only: no browser run, so runtime claims (persisted-shell
navigation, Highlight API coverage, dictation under controlled
composers) are code-derived. Markdown sanitization and CodeBlock
long-content behavior remain source-unverified. Numbers: 20/20 demo
threads present, 0 backend references in `src`, 0 test files, 27 static
pages, ~7 dead controls.
