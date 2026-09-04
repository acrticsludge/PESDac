# Demo Threads Spec — rich thread for all 20 conversations

Status: Implemented (20/20 verified 2026-09-04)
Related: `docs/reasonix/specs/chat-route.md`, `docs/audits/2026-09-04-monolith-to-backend-audit.md`

## Objective

Every sidebar conversation (`/subject/[subject]/[code]`, all 20) renders a
full demo thread — not just CN → TCP vs UDP. Collectively the 20 threads
must exercise every AI-chat display capability: text, markdown (tables,
lists), code, tool-call transcripts, @-mention tokens, attachment tokens,
timestamps/metadata, system dividers, sources lines, study-note artifacts
(panel + fullscreen dialog), quiz prompts, **images** (Thumbnail → Lightbox),
and **PDF preview** (file card → Dialog). Astryx-only (single documented
exception for the PDF embed element — no Astryx PDF renderer exists).

## Assumptions

1. Data-driven threads: one typed content model + one generic `ThreadView`
   renderer. The existing bespoke `CNConversationChat` becomes data + renderer
   with identical visuals (it is the parity reference).
2. Content lives in `src/content/threads/` (one file per subject), keyed by
   conversation label; lookup by code via `lib/chat.ts`.
3. Sample media is authored in-repo under `public/samples/` (offline-safe):
   educational SVG diagrams per subject + 1–2 hand-authored sample PDFs.
4. Any `selectedChat` with thread data renders `ThreadView`; unknown labels
   fall back to welcome (unchanged).
5. No backend, no new deps, no visual change to shell/composer/chrome.

## Tech Stack

Astro 6 static + React 19 + Astryx 0.5.2. New Astryx components used (all
already installed): `Thumbnail`, `Lightbox`, `FileInput`, `Citation`(if fits),
existing Chat/Markdown/Card/Dialog/Toolbar/Token/Timestamp set.

## Content model

```ts
// src/content/threads/types.ts
type TextBubble = { type: "text"; text: string };
type MarkdownBubble = { type: "markdown"; md: string };
type CodeBubble = { type: "code"; title: string; language: string; code: string };
type MentionBubble = { type: "mention"; tokens: { value: string; label: string }[]; text: string };
type ImageBubble = { type: "image"; src: string; alt: string; label: string };
type PdfBubble = { type: "pdf"; title: string; subtitle: string; file: string };
type ArtifactBubble = { type: "artifactCard"; artifactId: string };
type QuizBubble = { type: "quiz"; md: string };
type Bubble = TextBubble | MarkdownBubble | CodeBubble | MentionBubble | ImageBubble | PdfBubble | ArtifactBubble | QuizBubble;

type AssistantBlock = {
  from: "assistant"; bubbles: Bubble[];
  toolCalls?: { name: "retrieve" | "search" | "generate"; target: string; status: "complete"; duration: string }[];
  time: string; footer?: string;
};
type UserBlock = {
  from: "user"; bubbles: Bubble[];
  attachments?: string[]; time: string;
};
type SystemBlock = { from: "system"; text: string; variant?: "divider" };
type Block = UserBlock | AssistantBlock | SystemBlock;

type Artifact = { id: string; title: string; subtitle: string; markdown: string };
type Thread = {
  label: string; subject: Subject; mode: "ask" | "deep";
  placeholder: string; divider: string; blocks: Block[]; artifact?: Artifact;
};
```

## Renderer

`components/chat/ThreadView.tsx` — the current `CNConversationChat` layout
generalized: `ChatLayout` + message list + resizable artifact panel +
fullscreen `Dialog` fallback + composer (`Ask`/`Deep Study` from `mode`) +
`Lightbox` state for image bubbles + PDF `Dialog` for pdf bubbles. Study-note
card/dialog/toolbar patterns reused verbatim.

## Per-subject showcase plan (combos vary per thread)

- CN: TCP vs UDP (existing — parity), OSI Model (diagram image + table +
  PDF slides preview), IP Subnetting (code/worked calc + quiz), Routing
  Protocols (tool calls + comparison + artifact).
- OS: scheduling Gantt image + code, Deadlocks (markdown + quiz), Virtual
  Memory (artifact + diagram), File Systems (PDF textbook preview + table).
- DLCD: Boolean algebra (code + quiz), K-Maps (image grid + steps), Sequential
  Circuits (table + tool calls), Flip-Flops (artifact + markdown).
- DSA: Binary Trees (tree diagram image + code), Graphs (code + quiz),
  Sorting (table + artifact), DP (markdown + tool calls + code).
- Math: Matrices (code + table), Differential Equations (PDF notes preview +
  steps), Probability (distribution image + quiz), Fourier (artifact + code).

## Media assets (`public/samples/`)

SVGs (dark-theme, hand-authored): `osi-model.svg`, `tcp-handshake.svg`,
`binary-tree.svg`, `kmap.svg`, `gantt.svg`, `paging.svg`, `prob-dist.svg`,
`flipflop.svg`. PDFs (hand-authored minimal): `cn-slides-tcp-udp.pdf`,
`os-textbook-vm.pdf`, `math-notes-de.pdf`.

## Success Criteria

- [ ] All 20 `/subject/.../...` URLs render their thread (no welcome fallback).
- [ ] TCP-vs-UDP thread visually identical to today (parity reference).
- [ ] Every bubble kind above appears in at least one thread.
- [ ] `astro build` passes; 27+ pages; no new deps; Astryx-only (+1 PDF exception).
- [ ] Images open in Lightbox; PDFs open in Dialog preview.

## Open Questions

- None blocking. Later: replace static threads with backend messages (model
  already mirrors the §3.2 API shapes from the backend audit).
