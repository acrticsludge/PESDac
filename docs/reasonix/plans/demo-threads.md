# Demo Threads Plan

Status: Implemented. Spec: `docs/reasonix/specs/demo-threads.md`.
Rule: every batch ends with green build; redundancy is deleted in the same
batch that replaces it (never keep bespoke + generic side by side).

## Task 1: Content model + registry (done)

**Description:** `src/content/threads/types.ts` (spec §Content model) +
`src/content/threads/index.ts` (`getThread(label)`, code lookup via
`lib/chat.ts`).
**Acceptance:** Types compile; unknown label → null.
**Files:** `src/content/threads/types.ts`, `src/content/threads/index.ts`

## Task 2: Generic ThreadView renderer (done)

**Description:** Generalize `CNConversationChat` → `components/chat/ThreadView.tsx`
(`{ thread: Thread }` prop). Same layout: `ChatLayout`, block renderer for all
bubble kinds, resizable artifact panel, fullscreen dialog fallback, composer
with Ask/Deep-Study, Lightbox + PDF dialog state. Study-note card/body/actions
become generic (props, not CN constants). `CN_CHAT_CSS` moves verbatim.
**Acceptance:** No visual change possible yet (no callers); file compiles.
**Files:** `src/components/chat/ThreadView.tsx` (new)

## Task 3: Migrate TCP-vs-UDP to data (done � parity verified)

**Description:** `src/content/threads/cn.ts` gets the full TCP-vs-UDP thread
(all turns: tokens, 3 tool calls, table, code, sources line, revision card,
quiz) + artifact. `Pesdac.tsx` branch becomes
`thread ? <ThreadView thread={thread}/> : welcome`.
**Acceptance:** `/subject/CN/x7k2m9` pixel-identical (HTTP grep: same markers,
no welcome); all other URLs unchanged.
**Files:** `src/content/threads/cn.ts`, `src/components/Pesdac.tsx`

## Task 4: Delete redundant bespoke code (done � 510 lines removed)

**Description:** Remove from `Pesdac.tsx`: `CNConversationChat`,
`CNStudyNoteCard`, `CNStudyNoteBody`, `CNStudyNoteActions`,
`CN_ARTIFACT_*`, `CN_MENTION_TOKENS`, `CN_CHAT_CSS`,
`cnArtifactPanelWidthVar`, now-unused imports (`ResizeHandle`,
`useResizable`, `Card`, `Section`, `Toolbar`, `Dialog`, `DialogHeader`,
`ClickableCard`(if unused), `CodeBlock`(if unused elsewhere) — verify each by
grep before deleting). **Keeps:** shared welcome/composer/sidebar code.
**Acceptance:** Build passes; grep zero hits for `CNConversationChat`,
`CNStudyNote`, `CN_ARTIFACT`, `CN_MENTION`, `CN_CHAT_CSS`; 27 pages emitted.
**Files:** `src/components/Pesdac.tsx`

## Task 5: Media assets

**Description:** Hand-author `public/samples/*.svg` (dark-theme diagrams) +
1–2 minimal sample PDFs. Referenced only by later content batches.
**Acceptance:** Files exist; served at `/samples/...` (preview check).
**Files:** `frontend/public/samples/*` (new)

## Tasks 6–10: Subject content batches (one per turn slice)

T6 CN-rest (OSI, Subnetting, Routing) · T7 OS (4) · T8 DLCD (4) · T9 DSA (4) ·
T10 Math (4). Each: append thread data, build, HTTP-check its 4 URLs.
**Acceptance per batch:** its URLs render threads; all bubble kinds in the
spec appear at least once by T10.

## Checkpoint: Complete

- [ ] 20/20 thread URLs render threads; TCP-vs-UDP unchanged
- [ ] No bespoke thread code in `Pesdac.tsx`; no `components/chat` forks
- [ ] Build green; Astryx-only (+1 documented PDF-embed exception)

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Parity drift in migrated thread | High | HTTP marker diff before/after; CSS moved verbatim |
| Import pruning breaks welcome view | Med | Grep each import before deleting; build after Task 4 |
| Turn-size overflow on content batches | Low | One subject per slice; registry makes batches independent |

## Rollback

Tasks 1–4 revertible via `git checkout` per file; content batches are
additive-only (new data files + registry lines).
