# PESDac Monolith → Real Chat Audit — 2026-09-04

Category: Architecture / Migration to backend-backed AI chat
Status: Proposed
Scope: `frontend/src/components/Pesdac.tsx` (~48KB, ~1380 lines), `data/index.ts`, `components/chat/*`, `components/layout/AppLayout.tsx`, `pages/index.astro`, `pages/subject/[subject].astro`

Goal: keep the exact Playground-exported UI (per `AGENTS.md`), but slowly convert the demo mockup into a ChatGPT-like chat: URL-driven conversations, message lifecycle, streaming-ready, persistence-ready, backend-swappable.

Non-goals: visual redesign, theme change, Astryx upgrade, real LLM wiring in this audit.

---

## 1. What the monolith actually is (evidence)

`Pesdac.tsx` currently owns 7 responsibilities in one React tree:

1. **Theme + shell:** `Theme theme={PESDacMockupTheme} mode="dark"` + `AppShell contentPadding={0}` + `SideNav` (header `PESDac`, Menu section, Subjects section, Account footer).
2. **Demo data inline:** `WORKSPACES` (5 subjects × 4 chats, ~line 136), `CATEGORY_SUGGESTIONS` (5 × 4 prompts, ~line 295), `MODE_OPTIONS` (auto + 5 subjects, ~line 423), `REFERENCE_ITEMS` (slides/textbook/lectures, ~line 465), `CN_ARTIFACT_*` markdown (~line 514).
3. **Welcome state:** `selectedChat: string|null`, `mode`, `category`, `attachments: string[]`, `isModeMenuOpen`, `composerInputRef`, `useChatDictation` (~lines 1083-1095). `onSubmit={() => {}}` twice (welcome composer ~line 1320, CN composer ~line 682) — nothing sends.
4. **CN one-off conversation:** `CNConversationChat()` (~line 639) with its own `composerMode: ask|deep`, `isArtifactOpen`, `isArtifactDialogOpen`, `useResizable` study-note panel (520/420/760, `autoSaveId: pesdac-cn-study-note`), hardcoded `ChatMessageList` (user → assistant + `ChatToolCalls` retrieve/search ×3 → markdown table → `CodeBlock` 5-mark structure → revision-sheet card → quiz prompt).
5. **Navigation hack:** `openConversation(label)` (~line 1105) builds a slug map + workspace if-chain, then `window.location.href = /chat/${workspace}/${chatCode}` (~line 1135). No such route exists. Full-page reload, no Astro router, no state sync. `selectedChat === "TCP vs UDP"` (~line 1288) is the only branch that shows a conversation; every other label sets state then immediately leaves the page.
6. **Composer helpers:** `applySuggestion` (`insertText` + synthetic `input` event), `insertReference` (`insertToken @id`), attachment drawer storing only `file.name` strings — no upload, no IDs, no persistence.
7. **Sidebar item:** `ConversationItem` (~line 1026) with hover `MoreMenu` (Pin/Rename/Archive/Delete all `onClick: () => {}`).

`AppLayout.tsx` is a 7-line passthrough: `<Pesdac />`. It ignores the newer `WelcomeScreen.tsx` / `CNChat.tsx`, which are currently dead code and additionally broken (see §2).

`pages/index.astro` and `pages/subject/[subject].astro` both render `<AppLayout client:load />` and ignore params. There is no `/chat/...` route, no conversation Loader, no 404 handling.

## 2. Why the current modular attempt does not unblock backend

- **Fork, not split:** `WelcomeScreen.tsx` (~122 lines) and `CNChat.tsx` (~114 lines) duplicate `Pesdac.tsx` logic instead of extracting it. No shared types/store; fixing one leaves the other stale.
- **Broken imports (will fail build if wired):** `WelcomeScreen.tsx:36` imports `STATUS_DOT_VARIANTS` from `CNChat` (not exported); `WelcomeScreen.tsx:18` imports `{ Grid, Stack }` from `@astryxdesign/core/Grid` (original: `Grid` from `.../Grid`, `Stack` from `.../Stack`); `CNChat.tsx:9-10` imports `{ Card, Section }` from `.../Card` and `{ Markdown, CodeBlock }` from `.../Markdown` (original: `Section` from `.../Section`, `CodeBlock` from `.../CodeBlock`). `CNChat.tsx` also drops `ChatTokenizedText`, `Timestamps`, `Token` chips, `ChatSystemMessage` sources line, and the follow-up quiz turns present in the monolith.
- **Unstable IDs:** `data/index.ts:25-30` `randCode()` runs at module load. Every reload/hydration generates new codes. Deep links, sidebar selection, and any `/chat/:subject/:code` scheme cannot work. Codes must become stable constants (later: backend UUIDs).
- **Hydration/perf:** whole tree hydrates via `client:load` on `AppLayout`. The `.astro` files also inline a full `:root` token dump in `<style is:inline>` instead of relying on `Theme` + `PESDacMockupTheme.js`. That duplicates the authoritative theme, bloats HTML, and will drift.
- **Docs/stack mismatch:** `CLAUDE.md` §§22-23 describe Next.js/Tailwind/Supabase/Vercel; repo is Astro/Astryx/StyleX. Agents following `CLAUDE.md` literally will propose the wrong adapters.

None of this is visual — it is all structural. That is why it is safe to fix incrementally without violating `AGENTS.md`.

## 3. Target: ChatGPT-like behavior, PESDac skin

Keep every Astryx component, token, radius, spacing. Change only data flow.

### 3.1 URL model (one scheme — pick this and delete the others)

- `/` → redirect to `/new` (fresh chat; Claude-style).
- `/new` → new chat (welcome UI, Auto mode, no subject pre-selected).
- `/c/:conversationId` → existing conversation (message list + composer + optional study-note artifact).
- `/subject/:subject` → filtered new-chat view (sets `category`/`mode` from URL, same welcome UI). Keep only because the file already exists; otherwise redirect to `/?subject=CN`.
- Drop `/chat/:subject/:code` free-text slugs. `conversationId` is opaque (nanoid/UUID from backend later; stable slug constant until then). Subject stays as a field on the conversation, not part of the identity.

Why: ChatGPT keys on conversation ID, not on title slug. Titles rename; IDs do not. This also kills the `codeMap` + workspace if-chain in `openConversation`.

### 3.2 Domain model (minimal, backend-agnostic)

```ts
type Subject = "CN" | "OS" | "DLCD" | "DSA" | "Math";
type ConversationStatus = "active" | "idle" | "in_progress" | "needs_review"; // replaces StatusDotVariant in data layer; map to StatusDot at render only if design asks
type Conversation = { id: string; subject: Subject; title: string; status: ConversationStatus; createdAt: string; updatedAt: string; };
type MessageRole = "user" | "assistant" | "system";
type ToolCall = { name: "retrieve" | "search" | "generate"; target: string; status: "complete" | "running" | "error"; duration?: string; };
type Artifact = { id: string; kind: "study-note"; title: string; subtitle: string; markdown: string; };
type Message = {
  id: string; conversationId: string; role: MessageRole;
  text?: string; tokens?: { value: string; label: string; variant: "blue" }[];
  attachments?: { id: string; name: string }[];
  toolCalls?: ToolCall[]; artifactRef?: { artifactId: string };
  sources?: string[]; createdAt: string;
};
type Suggestion = { heading: string; body: string; prompt: string; };
```

Mapping notes:
- Current `WORKSPACES[].chats[].label` → `Conversation.title`; `status/statusLabel` → `ConversationStatus` (keep `StatusDot` rendering iff design re-adds it; the remove-statusdot spec stays respected by default).
- Current `CATEGORY_SUGGESTIONS[subject]` → `GET /api/suggestions?subject=` (static JSON first, backend later).
- Current `MODE_OPTIONS` auto+subjects → composer `subject` scope field, not a route.
- Current `REFERENCE_ITEMS` → `GET /api/sources` (id/label/type); `@` trigger stays identical visually.
- Current `CN_ARTIFACT_*` → `Artifact` row; the CN thread becomes `conversationId: "demo-cn-tcp-vs-udp"` with 6 seeded messages + 1 artifact, not a separate component.

### 3.3 Backend contracts (build UI against these now, mock first)

All under `/api` (Astro endpoints first as thin mocks, real service later — no UI change when swapping):

- `GET /api/conversations?subject=` → `Conversation[]` (sidebar).
- `POST /api/conversations { subject, title? }` → `Conversation` (New chat).
- `GET /api/conversations/:id` → `Conversation + Message[] + Artifact[]` (route loader for `/c/:id`).
- `PATCH /api/conversations/:id { title, subject, archived, pinned }` (MoreMenu actions; currently no-ops).
- `DELETE /api/conversations/:id` (MoreMenu Delete).
- `GET /api/suggestions?subject=` → `Suggestion[]`.
- `POST /api/conversations/:id/messages { text, subjectScope, mode: ask|deep, tokens, attachmentIds }` → `Message` (user) + stream `assistant` deltas via SSE (`GET /api/conversations/:id/stream?messageId=` or POST returning `text/event-stream`). UI must support: pending → streaming → complete/error, abort, retry.
- `POST /api/uploads` → `{ id, name, url }` (replaces `string[]` filenames).
- `GET /api/artifacts/:id` → `Artifact` (study-note panel + dialog share the same loader).

Streaming shape: server sends `{ delta }` events + terminal `{ done, message }` or `{ error }`. `ChatToolCalls` rows map from `toolCalls[]` with `running → complete` transitions — this preserves the current CN transparency UX with live data.

## 4. Incremental migration (smallest safe slices, UI frozen)

**Phase 0 — Freeze + extract (no visual change).**
- Move `WORKSPACES`, `CATEGORY_SUGGESTIONS`, `MODE_OPTIONS`, `REFERENCE_ITEMS`, `CN_*` out of `Pesdac.tsx` into `data/` + `content/cn-tcp-vs-udp.ts` as typed constants with **stable** ids (`demo-cn-tcp-vs-udp`, `artifact-cn-tcp-vs-udp`). Delete `randCode()`.
- Fix `WelcomeScreen`/`CNChat` imports or delete them if `Pesdac.tsx` remains canonical — never keep two live copies. Recommended: delete the forks, re-extract from the monolith once (see Phase 1).
- Remove the `:root` token dump from both `.astro` files; rely on `Theme` + `global.css`. Verify pixel parity via `astro build` + manual screenshot.
- Correct `CLAUDE.md` §§22-23 to Astro/Astryx/StyleX.

**Phase 1 — Split by responsibility behind the same UI.**
- `components/nav/SubjectNav.tsx` (props: `conversations, selectedId, onSelect, onNew`) — pure `SideNav` rendering, no data fetching.
- `components/chat/WelcomeComposer.tsx` (props: `subject, suggestions, onSubmit`) — composer + subject toggles + quick cards.
- `components/chat/ConversationView.tsx` (props: `messages, artifact, artifactOpen, onToggleArtifact`) — `ChatLayout` + list + resizable panel + dialog.
- `components/layout/AppShellView.tsx` — `Theme` + `AppShell`, composes nav + main.
- `Pesdac.tsx` becomes a thin container that holds the same `useState` and passes props down. Zero behavior change; `astro build` passes.

**Phase 2 — URL + client store (ChatGPT lifecycle, still no backend).**
- Add `src/lib/conversations.ts`: `loadConversation(id)`, `createConversation(subject)`, `postMessage(id, text)` against an in-memory + `localStorage` adapter implementing the §3.3 signatures. Seed it with the current welcome suggestions + the full CN thread (all turns, not the truncated `CNChat.tsx` version).
- Add `pages/c/[id].astro` (Astro loader reads `Astro.params.id`, passes to container with `client:load`). `/` stays welcome. `/subject/[subject]` becomes a filter that sets initial `category`/`mode` from params. Replace `window.location.href` with `<a href>` / Astro navigation.
- MoreMenu items (Pin/Rename/Archive/Delete), `New chat`, suggestion→composer, `@`→token, Ask/Deep Study toggle, attachment add/remove all mutate the store. `onSubmit` creates appends user message + fake assistant ack (no LLM yet).

**Phase 3 — Swap mock for HTTP (backend-ready).**
- Add `src/lib/api.ts` implementing the same interface via `fetch` + `EventSource`/SSE. Feature-flag `USE_API` (env). Astro `pages/api/*.ts` return the seeded JSON first; UI code does not change when real backend replaces those handlers.
- Uploads return real `{ id, name }`; composer sends `attachmentIds`, not bare names.
- Add loading/error/empty states per `CLAUDE.md` UX gates (pending bubble, stream cursor, retry button, sources line from `sources[]`).

**Phase 4 — Streaming + artifacts live.**
- Wire `toolCalls` progressive rendering, `artifactRef` card → panel/dialog via `GET /api/artifacts/:id`, `useResizable` + container query CSS stays as-is (move `CN_CHAT_CSS` into a scoped StyleX block or colocated CSS module, not a global `<style>` tag per render).
- Paginate `GET messages?before=` for long threads; lazy-load artifact panel (`client:visible` / dynamic import) to recover the perf audit's 80+ target.

## 5. Risks / what not to do

- Do not redesign, re-token, or add Tailwind/global overrides to "fix" layout — investigate Astryx version/CSS import/theme mount first (per `AGENTS.md` §4).
- Do not keep `randCode()` or title-derived slugs — they silently break deep links and hydration.
- Do not add a second state library yet — `useState` + a tiny store adapter is enough until streaming/concurrency demands it.
- Do not wire a real LLM before Phase 2 store + Phase 3 HTTP seams exist; otherwise every backend change rewrites UI.
- `dictation` (`useChatDictation`) and `useResizable(autoSaveId)` both touch browser APIs — keep them inside `client:load` islands, never in Astro server code.

## 6. Verification per phase

- `npm run build` (or `astro build` from `frontend/`) passes; no new TS errors; no Astryx import drift.
- Navigate `/` → pick subject → suggestion fills composer; `New chat` resets; sidebar select loads `/c/:id`; refresh preserves thread (localStorage in Phase 2, API in Phase 3).
- CN thread renders all current turns: user tokens + timestamps, assistant intro + 3 tool calls + comparison table + 5-mark `CodeBlock`, sources divider, revision-sheet card → panel/dialog, quiz prompt.
- Lighthouse/build audit after Phase 4: route-split bundles in `dist/_astro/`, artifact chunk lazy, no full `:root` dump in HTML.

## 7. Suggested first commit slice (if approved)

1. Stabilize `data/index.ts` ids (remove `randCode`), extract `CN_*` to `content/`.
2. Delete or quarantine broken `WelcomeScreen`/`CNChat` forks (or fix their 3 import errors) so only one implementation exists.
3. Strip inline `:root` dump from both `.astro` files.
4. Add `pages/c/[id].astro` shell + `src/lib/conversations.ts` type stubs (no behavior change yet).

All four are UI-neutral and independently revertible.
