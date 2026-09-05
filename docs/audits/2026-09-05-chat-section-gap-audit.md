# Chat section gap audit — ChatGPT parity + error coverage

> Implementation status (2026-09-05): §8 slices 1–7 built and committed;
> slice 8 (backend-gated) captured as `docs/reasonix/specs/error-states.md`.
> Still open: share links, interactive quiz checking, context-meter wiring,
> truncation notices, @-token rendering inside user bubbles, Markdown
> sanitization source-check, keyboard-only + Playwright verification.

Date: 2026-09-05. Scope: everything inside the conversation experience —
`ThreadView.tsx`, the welcome composer in `Pesdac.tsx`, `session.ts`,
`responder.ts`, thread content model. Method: static end-to-end trace of
every send/render/persist path + Astryx 0.5.2 API check
(`ChatComposer`, `ChatComposerInput`, `ChatMessageList`, `ChatMessageMetadata`
`.d.ts`). No browser run: Playwright is not installed in this repo, so
runtime behavior below is code-derived, not console-verified.

Status labels: **Missing** (no path exists), **Half-built** (UI exists, path
broken), **Dead control** (renders, does nothing), **Latent bug** (works
until an edge hits), **Backend-gated** (needs the real API first).

## 0. Already at parity (do not rebuild)

Send/stop streaming, word pacing, tool-call chips, follow-up chips,
mode menu ↔ subject chips sync, day divider, rename/delete/pin/archive/
search with confirms, study-note panel + mobile dialog, PDF dialog,
lightbox, @ reference tokens on welcome, dictation on welcome,
scroll-to-bottom + auto-scroll via `ChatLayout`, grouped user bubbles.

## 1. Composer gaps (thread view is behind welcome)

Thread composer (`ThreadView.tsx:555-603`) is a bare `ChatComposer` +
bare `ChatComposerInput`. The welcome composer (`Pesdac.tsx:1078-1208`)
already has the features below — thread view needs the same shelf:

1. **Attachments — Half-built.** `UserBlock.attachments` renders as
   `Token`s (`ThreadView.tsx:435-441`) and demo threads use it
   (`cn.ts:20`, `os.ts:138`, `math.ts:75`), but no live path ever sets
   it: thread input has no `onFiles`, no attach button, no `drawer`.
   Astryx supports all of it (`drawer` + `ChatComposerDrawer` +
   `ChatComposerInput.onFiles` for drop/paste).
2. **Dictation missing in thread.** Welcome wires `useChatDictation` +
   `ChatDictationButton` (`Pesdac.tsx:625-627,1207`); thread has neither.
   Same one-line shape, just needs an `inputRef` handle.
3. **@ mention trigger missing in thread.** Welcome passes
   `triggers={[referenceTrigger]}`; thread renders `<ChatComposerInput />`
   bare, so its "Reference" dropdown is a **Dead control**
   (`onClick: () => {}`, `ThreadView.tsx:576-580`) and typed `@` does
   nothing. `MentionBubble`/`ChatTokenizedText` render paths exist but are
   unreachable from live input.
4. **`status` slot unused everywhere.** `ChatComposerStatus`
   (`error | warning`, top/bottom) is the Astryx home for send failures —
   neither composer wires it. See §4.
5. **`isDisabled`, `headerContext` unused.** No composer lock during
   send (guarded by `if (!text || live) return` instead — works, but the
   input still looks live while streaming) and no context-window meter.

## 2. Message / turn gaps vs ChatGPT

1. **No copy on assistant messages — Missing.** ChatGPT's most-used
   message action. (Study-note Copy in `StudyNoteActions` is a **Dead
   control**: no `onClick`, `ThreadView.tsx:134-143`. Same for Share.)
2. **No regenerate / retry — Missing.** After stop-with-no-text the user
   message sits answerless with no recovery affordance. Pairs with §4:
   every error state below needs a retry entry point.
3. **No edit-and-resend on user messages — Missing.**
4. **No feedback (like/dislike) — Missing.** `ChatMessageMetadata.footer`
   explicitly supports "model info, ratings, reactions" — the slot is
   there, nothing uses it.
5. **Read-aloud — Missing** (ChatGPT has it; low priority, note only).
6. **Quiz is markdown, not interactive — Half-built.** `QuizBubble`
   renders identical to markdown (`ThreadView.tsx:359-364`); no
   selectable options, no answer checking, and the mock responder *cannot*
   check answers despite promising to ("I will check them step by step").
   Interactive quiz is **Backend-gated**; until then the copy overpromises.
7. **No share / export thread — Missing.** All Share buttons are dead
   controls. Share links are **Backend-gated**; copy-transcript (markdown
   export) is not and could ship now.
8. **In-conversation search — Missing** (sidebar search filters chats,
   not messages). ChatGPT parity is weak here too; low priority.
9. **Timestamps static.** Demo `time` fields are fixed strings; live turns
   use real ISO. No relative-time grouping beyond the day divider.

## 3. Attachments end-to-end (the full hole)

- Welcome: files dropped/pasted land in `attachments` state and show in
  the drawer — then `handleWelcomeSend` (`Pesdac.tsx:780-789`) **drops
  them on the floor**: `createCustomChat` + `makeDraftThread` take no
  attachments, and the drawer state is never cleared (stale chips if you
  return to `/new`). **Latent bug.**
- Thread: no upload affordance at all (see §1.1).
- Render path (`Token` chips) only ever shows demo-seeded names; there is
  no preview (image thumbnail via existing `ImageBubble`+`Thumbnail`
  path would be free), no size/type validation, no upload progress, no
  remove-after-send.
- Backend contract missing: attachment shape is `string[]` (names only —
  no id, mime, size, URL). Backend-gated, but the type should grow before
  the API lands so content + session agree.

## 4. Error taxonomy — what can fail, and what the UI does today

Today's answer for every row: **nothing renders**. `handleSend` has no
failure branch, `finalizeTurn` always succeeds, no `status` is ever set.

### 4a. LLM / stream errors (backend stage, design now)

| Failure | ChatGPT behavior | PESDac today | Needs |
|---|---|---|---|
| Network drop mid-stream | stops, error + retry | impossible in mock; no UI designed | composer `status="error"` + Retry button re-sending last user text |
| HTTP 429 rate limit | "too many requests, wait X" | — | warning status with backoff countdown; send disabled meanwhile (`isDisabled`) |
| HTTP 5xx / timeout | error + regenerate | — | error status + retry affordance (§2.2) |
| Empty model response | fallback text, retry offered | `finalizeTurn` silently drops empty text (`trimmed` guard) leaving an answerless user message | keep the guard, but render a "no response — retry" block instead of nothing |
| Stream disconnect with partial text | keeps partial + retry | mock keeps partial only via Stop; disconnect path doesn't exist | persist partial with `status`-flagged metadata (`ChatMessageMetadata.status: 'error'` exists for this) |
| Content-filter refusal | refusal message as normal turn | `planResponse` has no refusal shape | refusal as a normal assistant turn (no special UI), responder/backend contract item |
| Context overflow (long thread) | truncation notice / summarize prompt | overlays grow unbounded in localStorage | `headerContext` meter + backend truncation notice block |
| Tool failure (retrieve/search errors) | "search failed", answer without sources | `ToolCall.status` is only `running \| complete` — **no `failed` state** | extend type + render failed chip; answer turn still finalizes |

### 4b. Client / session errors (fixable now, no backend)

1. **Stop during tool-running phase persists `running` tools forever —
   Latent bug.** `handleStop` finalizes with `live.tools`, which during
   the first 700ms are `{status:"running", duration:""}`. The saved block
   renders a perpetually-"running" tool chip. Fix: mark tools complete
   (or drop durations) in `finalizeTurn`.
2. **SSR/client divergence with stored chats — Latent bug, resolved by
    reverting the first fix.** `session.ts` reads `localStorage` during
    render; SSR emits empty sidebar/overlays, first client render emits
    stored data. A mount-gate was tried (slice 6) and reverted the same
    day: gating makes pinned/renamed chats visibly jump sections on first
    paint and on every chat switch/refresh — strictly worse than the
    theoretical hydration warning. Direct reads stay; React patches the
    SSR mismatch invisibly, and no hydration issue has ever been observed
    (only the benign #418 autofill warning).
3. **Multi-tab divergence.** Store listeners are in-memory only; no
   `storage` event handling. Two tabs silently fork. Cheap fix, low
   priority.
4. **localStorage quota / private mode.** `writeJSON` swallows failures —
   correct to not crash, but the user gets zero signal that history
   stopped persisting. Composer `status="warning"` (persistent, not
   per-send) is the Astryx-shaped fix.
5. **Corrupt overlay JSON.** `readJSON` falls back to empty — a single bad
   write wipes a conversation's history display with no signal. Consider a
   one-time warning status + console error.
6. **`genCode` unbounded loop.** Collision odds are negligible (36⁶ space
   minus ~20 taken); note only, do not fix.
7. **Stale `autoSend` on unmount.** Timer cleanup exists; `handleSend` in
   the mount effect closes over first-render `blocks` — fine for once-only
   use. Note only.
8. **Day-divider `NaN` path.** Blocks without parseable `time` always
   trigger a divider. Demo content always has `time`; live turns always
   set it. Note only.

### 4c. Content / rendering hazards

1. **User input echoed into assistant markdown — injection surface.**
   `planResponse` interpolates raw `short` into `answer` markdown, rendered
   by Astryx `Markdown`. A user typing `**x**`, `![x](...)`, or link
   syntax gets it rendered inside the assistant turn. Mock-stage impact is
   cosmetic; when the backend echoes user text the same way it becomes a
   stored-XSS-adjacent concern. Rule for backend contract: **never
   interpolate raw user text into markdown** — escape it or put it in a
   `text` bubble. Verify Astryx `Markdown` sanitization before backend
   wiring (source check still open).
2. **No markdown failure state.** over-long/code-heavy answers render
   unbounded; no collapse for long code (Astryx `CodeBlock` behavior
   unverified). Cosmetic; verify during backend wiring.

## 5. Accessibility gaps

1. **`ChatMessageList.isStreaming` never set.** The list is
   `role="log"`/`aria-live="polite"`; without `isStreaming`, screen
   readers re-announce accumulating partial text on every mutation during
   streaming. One-prop fix: `isStreaming={live != null}`.
2. Focus after send not verified (does the contentEditable keep/lose
   focus on submit?); focus-visible on follow-up chips presumed from
   Astryx `Button`. Verify with keyboard-only pass — no keyboard audit has
   been run (Playwright absent, §7).
3. Reduced-motion: streaming + fade animations have no
   `prefers-reduced-motion` handling (Astryx default unknown). Note only.

## 6. Dead controls inventory (render, do nothing)

- Thread "Reference" dropdown items (`ThreadView.tsx:576-580`).
- Study-note Copy + Share (`ThreadView.tsx:134-151`).
- Welcome Settings menu: "Study preferences / Knowledge sources / About
  PESDac" (`Pesdac.tsx:1190-1203`).
- Quiz "checking" promise (`responder.ts:44`, copy overpromises).

## 7. Verification gaps (this audit's own limits)

- No browser run: Playwright + browsers are not installed; console errors,
  focus behavior, keyboard flow, and mobile composer were **not**
  runtime-verified. Recommend `npx playwright install` + a smoke spec
  covering: send/stop/retry, attach flow, dictation, keyboard-only send,
  360px composer, `isStreaming` announcement.
- Astryx `Markdown` sanitization + `CodeBlock` long-content behavior not
  source-verified (only `.d.ts` surface read).

## 8. Suggested build order (smallest slices first)

1. One-prop + micro-fixes: `isStreaming`, stop-phase tool completion
   (§4b.1), clear attachments on welcome-send (§3).
2. Thread composer parity with welcome: `onFiles`+drawer, dictation,
   `@` trigger (all Astryx-native, no new components).
3. Retry/regenerate + composer `status` error shape using a simulated
   failure (e.g. capped-length trigger) so the UI exists before backend.
4. Copy-message + copy-transcript export.
5. `ToolCall.status: "failed"` + refusal/empty-response block shapes in
   the content model (contract-first, backend implements later).
6. Mounted-gate for session reads (§4b.2); storage-quota warning (§4b.4).
7. Attachment type growth (`{id,name,mime,size,url?}`) ahead of backend.
8. Backend-gated: share links, interactive quiz checking, context meter
   wiring, truncation notices.
