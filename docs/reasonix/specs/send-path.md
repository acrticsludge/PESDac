# Send-Path Spec — live composer (mockup stage, no backend)

Status: Implemented (build + HTTP verified 2026-09-04; interactive send/stop/reload needs manual browser QA — no runner in repo).
Note: `astro build` does NOT typecheck — a `plan.tools` vs `plan.toolCalls` mismatch shipped green and broke every send (fixed 2026-09-04). Run `tsc --noEmit` before calling any response-path work done.
Related: `chat-route.md`, `demo-threads.md`, backend audit §3.3 (contracts)

## Objective

Typing in any composer does something ChatGPT-like: user bubble appears
instantly, assistant "works" (tool calls run → answer streams in), stop button
halts it, welcome composer starts a real sidebar conversation. All client-side;
one swappable seam (`planResponse`/`session.ts`) becomes the backend later.

## Assumptions

1. No backend yet: assistant turns are deterministic templates
   (`lib/responder.ts`), clearly demo logic.
2. Static export can't serve unknown codes → custom chats live under `/new`
   (view state) + `localStorage` (persistence), NOT new URLs. Demo-thread URLs
   unchanged. Documented limitation, not a bug.
3. SSR/prerender safety: store reads return empty on server; client hydrates
   via `useEffect`. No `Math.random` in render paths.
4. Astryx-only; no new deps.

## Behavior

- **Any thread composer**: send non-empty text → user block appended instantly
  → `running` tool calls (~700ms) → answer streams word-by-word with cursor →
  final block persisted (overlay keyed by conversation code) → composer live.
  While streaming: send becomes stop (`isStopShown`); stop keeps partial text
  as the final answer. Empty sends ignored; sends while streaming ignored.
- **Welcome (`/new`) composer**: send → `createCustomChat(subject, title)` →
  view switches to `ThreadView` on a synthetic thread; sidebar gains the chat
  under its subject (title = first 34 chars). Subject =
  `category ?? (mode if subject) ?? "CN"` (mockup default, documented).
- **Sidebar customs**: click loads thread from store (no navigation, stays on
  current page). `New chat` clears to `/new` everywhere (no-op if already there).
- **Reload**: demo overlays restore (keyed by static code); `/new` always
  starts fresh welcome; customs persist in sidebar.

## Contracts (backend-ready seams)

```ts
// lib/session.ts — later: same signatures over fetch/SSE
listCustomChats(): CustomChat[]            // GET /api/conversations
createCustomChat(subject, title): CustomChat // POST /api/conversations
getOverlay(code): Block[]                  // GET messages
appendBlocks(code, blocks): void           // POST message + stream
// lib/responder.ts — later: replaced by POST /api/.../messages (SSE)
planResponse(question, subject): { toolCalls, answer }
```

## Success Criteria

- [ ] Send in any thread → user bubble + running tools + streamed answer + persisted overlay (reload keeps it).
- [ ] Stop mid-stream keeps partial text; composer usable immediately after.
- [ ] `/new` send → sidebar gains chat under subject; thread view; reload → welcome, chat still listed, clickable.
- [ ] Empty/whitespace sends ignored; no crashes with storage disabled (try/catch).
- [ ] Build passes; no visual change to shell/theme; docs updated.

## Open Questions

- None blocking. Later: real streaming, error/retry states, share URLs for
  customs (needs SSR adapter), multi-modal uploads.
