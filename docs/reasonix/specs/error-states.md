# Error states — backend contract

Status: Proposed. The mockup UI in `ThreadView.tsx` already implements every
consumer below against `planResponse` simulations (`simulate error`,
`simulate empty`, `simulate limit`, `simulate tool error`); the backend
replaces the simulations with real events in the same shapes.

## 1. Transport

`POST /api/.../messages` with SSE. Terminal events per turn:

| Event | Meaning | Mockup equivalent today |
|---|---|---|
| `turn.done` | full answer received | `finalizeTurn` success path |
| `turn.failed` `{ code, message, partial? }` | abort with optional partial text | `failTurn` (`simulate error`) |
| `turn.empty` | model returned no content | empty error block (`simulate empty`) |
| `turn.rate_limited` `{ retryAfterMs }` | HTTP 429 | composer warning + Retry (`simulate limit`) |

`partial` (already-streamed markdown) persists visibly above the failure
notice — never discard delivered content. Retry re-sends the same prompt
without duplicating the user message (`startTurn` re-entry, not
`handleSend`).

## 2. Turn-level mapping (implemented in mockup)

- `turn.failed` → `AssistantBlock.error = { kind: "failed", retryText }`
  with partial bubbles when present; inline notice + Retry (`forceOk`).
- `turn.empty` → `AssistantBlock.error = { kind: "empty", retryText }`.
  The UI must never go silent on an answerless user message.
- `turn.rate_limited` → no assistant block; composer
  `status = { type: "warning", message }` + Retry row. `retryAfterMs`
  drives a countdown label when provided; the composer stays enabled in
  the mockup (backend may pass `isDisabled` while cooling down).
- Stop (client abort) keeps existing settle-tools behavior; a stop with
  zero streamed words leaves the user message answerable via Regenerate.

## 3. Tool-call mapping (implemented in mockup)

`ToolCall.status` admits `"error"` with `errorMessage?: string`, rendered
by Astryx as the failed row (tooltip + icon) with no app code. A failed
tool must not fail the turn: answer from surviving sources and say which
source was skipped (`simulate tool error` demonstrates this). `settleTools`
semantics stay: persisted turns never show `running`.

## 4. Refusals and truncation (backend-owned content, no new UI)

- Content-filter refusal → a normal assistant turn (no `error` flag, no
  special chrome), short + actionable.
- Context overflow → backend truncates server-side and appends a
  one-line notice inside the answer markdown (`_Earlier messages were
  trimmed to fit._` or a summarize prompt). The `headerContext` composer
  slot is reserved for the context meter when budgets are known.

## 5. User-text echo rule (security)

Never interpolate raw user text into assistant markdown. The mockup
strips `@id` tokens for echoes/titles (`stripReferenceTokens`) but still
renders the raw question inside the user bubble as `Text` (safe). Backend
answers that quote the user must escape markdown or use `text` bubbles —
see audit `2026-09-05-chat-section-gap-audit.md` §4c. Verify Astryx
`Markdown` sanitization before wiring model output.

## 6. Attachments upload contract

Client stages metadata only (`Attachment { id, name, mime, size }` —
`frontend/src/lib/attachments.ts`); `previewUrl`/File handles never
persist. Backend upload flow:

1. `POST /api/uploads` (multipart) → `{ id, name, mime, size, url }`
   per file; failures return per-file errors, staged chips show the
   failure and the message still sends without that file.
2. Message send references uploaded `id`s; the persisted user block keeps
   the same `Attachment` shape with `url` populated for image rendering.
3. Limits (count, per-file MB, total MB, allowed mimes) are backend-owned;
   the client enforces nothing beyond staging, and surfaces backend
   rejections as composer `status = { type: "error", message }`.

## 7. Observability (backend)

Log per turn: prompt id, model, tool calls with durations, terminal event,
time-to-first-token, total latency. Never log message content alongside
user identity in the same record; keep `errorMessage` user-safe (it
renders in tooltips).
