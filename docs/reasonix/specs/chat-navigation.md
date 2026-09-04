# PESDac Chat Navigation Spec

Status: Implemented (aligned with `chat-route.md` — `/subject/[subject]/[code]`)

Problem: Clicking a sidebar conversation navigated to `/chat/...` (nonexistent)
or stayed on `/`. User expects `/subject/[subject]/[code]`.

Solution: Central registry `frontend/src/lib/chat.ts` (`CHAT_CODES`,
`CHAT_SUBJECTS`, `buildChatPath`). `openConversation(label)` resolves
subject + stable code and navigates with
`window.location.href = buildChatPath(subject, chatCode)`.
`AppLayout`/`Pesdac` accept `initialSubject`/`initialCode` so Astro route
params rehydrate the same selection on reload/paste.

Files:
- `frontend/src/lib/chat.ts` (new — single source of truth)
- `frontend/src/data/index.ts` (stable codes via `CHAT_CODES`, `randCode` removed)
- `frontend/src/components/Pesdac.tsx` (`openConversation`, `startNewChat`, initial props)
- `frontend/src/components/layout/AppLayout.tsx` (prop forwarding)
- `frontend/src/pages/subject/[subject].astro` (`getStaticPaths` + subject prop)
- `frontend/src/pages/subject/[subject]/[code].astro` (new route)
