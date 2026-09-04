# Chat Navigation Plan — `/subject/[subject]/[code]`

Status: Implemented. Implements `docs/reasonix/specs/chat-navigation.md`.

1. Registry `src/lib/chat.ts`: stable codes + `buildChatPath` (done — Task 1).
2. `Pesdac.tsx`: `openConversation` → `buildChatPath(subject, code)`;
   `startNewChat` → `/new` always (done — Task 2, updated).
3. `AppLayout` prop forwarding (Task 3).
4. `pages/subject/[subject].astro`: `getStaticPaths` + `initialSubject` (Task 4).
5. `pages/subject/[subject]/[code].astro`: `getStaticPaths` (20 paths) +
   `initialSubject`/`initialCode` (Task 5).
6. Verify: build passes, 25 new static paths, reload restores demo state.
