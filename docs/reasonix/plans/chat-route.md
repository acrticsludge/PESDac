# Chat Route Implementation Plan — `/subject/[subject]/[code]`

Status: Implemented. Spec: `docs/reasonix/specs/chat-route.md`.
Each task leaves `astro build` in a passing-or-better state. Smallest diff first.

## Task 1: Route registry + stable codes (done)

**Description:** New `frontend/src/lib/chat.ts` with `SUBJECTS`, stable
`CHAT_CODES`/`CHAT_SUBJECTS`, `getChatByCode`, `buildChatPath`,
`getAllChatPaths`. `data/index.ts` references `CHAT_CODES`; `randCode()` removed.

**Acceptance criteria:**
- [ ] No `randCode`/`Math.random` in `data/`
- [ ] All 20 conversations resolve via `getChatByCode`

**Verification:** `grep randCode` empty; `astro build` error changes from
hydration-relevant to only `getStaticPaths`-missing.
**Files:** `src/lib/chat.ts`, `src/data/index.ts`

## Task 2: Container accepts route params (done)

**Description:** `Pesdac.tsx` (`ShellSideNav`) accepts optional
`initialSubject`/`initialCode`, initializes `selectedChat`/`mode`/`category`
from validated registry lookup; `openConversation` navigates to
`buildChatPath`; `startNewChat` always opens `/new`.

**Acceptance criteria:**
- [ ] No `/chat/` references remain; no label-slug `codeMap`
- [ ] Unknown codes fall back to welcome (no crash)

**Verification:** grep `/chat/` empty in `src/`; TS props optional so
`index.astro` still compiles.
**Files:** `src/components/Pesdac.tsx`

## Task 3: Forward props through AppLayout

**Description:** `AppLayout` accepts and forwards `initialSubject`/`initialCode`
to `Pesdac`. UI-neutral passthrough.

**Acceptance criteria:**
- [ ] `<AppLayout client:load />` (no props) still renders welcome
- [ ] Props reach `Pesdac` unchanged

**Verification:** `astro build` (after Task 4 fixes static paths).
**Files:** `src/components/layout/AppLayout.tsx`

## Task 4: Subject route — static paths + param

**Description:** `pages/subject/[subject].astro` exports `getStaticPaths()`
from `SUBJECTS` and passes `Astro.params.subject` as `initialSubject`.
Unblocks the build (`GetStaticPathsRequired`).

**Acceptance criteria:**
- [ ] Build passes; `dist/subject/CN/index.html` (×5) emitted
- [ ] `/subject/CN` opens welcome pre-filtered to CN

**Verification:** `npm run build`; inspect `dist/subject/`.
**Files:** `src/pages/subject/[subject].astro`

## Task 5: Conversation route — new `[code].astro`

**Description:** New `pages/subject/[subject]/[code].astro` with
`getStaticPaths()` from `getAllChatPaths()` (20 paths), passing
`initialSubject` + `initialCode`. Demo data visible at every new URL;
only `TCP vs UDP` shows the full thread (per spec).

**Acceptance criteria:**
- [ ] 20 `dist/subject/*/*/index.html` files emitted
- [ ] `/subject/CN/x7k2m9` restores CN selection + thread after reload
- [ ] Unknown code renders welcome, no crash

**Verification:** `npm run build`; grep `initialCode` in dist HTML;
`npm run dev` click → URL → reload check.
**Files:** `src/pages/subject/[subject]/[code].astro` (new)

## Checkpoint: Complete

- [ ] `astro build` passes
- [ ] No visual change to existing components
- [ ] Stale `/chat/...` docs updated (specs + this plan)

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `[subject].astro` file vs `[subject]/` dir routing conflict | High | Build is the proof; Astro resolves by specificity — verified in Task 4–5 |
| Props not hydrating via `client:load` | Med | Grep serialized props in `dist` HTML |
| Scope creep into thread content per conversation | Med | Deferred per spec; only TCP vs UDP has thread data |

## Rollback

Each task is independently revertible (`git checkout <file>`); Tasks 1–2
already applied are UI-neutral without Tasks 3–5.
