# Chat Route Spec — `/subject/[subject]/[code]`

Status: Implemented (build + HTTP verified 2026-09-04)
Supersedes: previous `/chat/[subject]/[code]` proposal and label-slug navigation.
Related audit: `docs/audits/2026-09-04-monolith-to-backend-audit.md` (§3.1)

## Objective

Give every conversation a shareable URL in the form `/subject/[subject]/[code]`
(e.g. `/subject/CN/x7k2m9`), so links can be copied/shared today (mockup phase)
and backed by real conversation records later without changing the URL scheme.

Users: study-assistant users opening a sidebar conversation or a shared link.
Success: clicking any sidebar conversation lands on its `/subject/.../...` URL;
reloading or pasting that URL restores the same subject context + selection;
`astro build` passes (currently broken — see Problem).

## Problem

- `Pesdac.tsx:openConversation` navigates to `/chat/${workspace}/${code}`,
  a route that does not exist (404 after full-page reload).
- `data/index.ts` generates `code` via `randCode()` at module load — IDs change
  every reload/hydration, so deep links can never be stable.
- `pages/subject/[subject].astro` has no `getStaticPaths()`, which Astro's
  static output requires for every dynamic route — `astro build` fails with
  `[GetStaticPathsRequired]`.
- Both `.astro` pages ignore `Astro.params` and render the same unparameterized
  `<AppLayout client:load />`, so URL and UI state are disconnected.

## Tech Stack

- Astro 6 (static output, no adapter) + `@astrojs/react` 6 + React 19
- Astryx 0.5.2 (`PESDacMockupTheme`, `AppShell`, `SideNav`, `Chat*`) — unchanged
- TypeScript via `frontend/tsconfig.json`; StyleX (no Tailwind, no global CSS)

## Commands

```powershell
# from frontend/
& "C:\Program Files\nodejs\npm.cmd" run build   # static build (must pass)
& "C:\Program Files\nodejs\npm.cmd" run dev      # manual nav check
```

## Project Structure

```text
frontend/src/
├── lib/chat.ts                    # NEW — route registry (subjects, stable codes, helpers)
├── data/index.ts                  # demo content; codes now reference lib/chat.ts
├── components/
│   ├── Pesdac.tsx                 # canonical UI; accepts initialSubject/initialCode
│   └── layout/AppLayout.tsx       # forwards route props to Pesdac
└── pages/
    ├── index.astro                # / (unchanged — welcome, no props)
    ├── subject/[subject].astro    # /subject/CN … (subject welcome filter)
    └── subject/[subject]/[code].astro  # NEW — /subject/CN/x7k2m9 (thread)
```

## Code Style

Route registry is UI-neutral (no Astryx imports). Components keep existing
Playground-exported hierarchy; route params enter only as initial `useState`
values:

```tsx
// AppLayout.tsx
export default function AppLayout({
  initialSubject,
  initialCode,
}: {
  initialSubject?: string;
  initialCode?: string;
} = {}) {
  return <Pesdac initialSubject={initialSubject} initialCode={initialCode} />;
}
```

```astro
---
// subject/[subject]/[code].astro
import { getAllChatPaths } from "../../../lib/chat";
export function getStaticPaths() {
  return getAllChatPaths().map(({ subject, code }) => ({
    params: { subject, code },
  }));
}
const { subject, code } = Astro.params;
---
<AppLayout client:load initialSubject={subject} initialCode={code} />
```

## Testing Strategy

No test runner exists in `frontend/package.json` (no `test` script, no
framework). Per risk-based escalation this is medium-risk frontend-only mockup
work with no backend/auth/payments, so verification is:

1. `npm run build` passes (regression guard for the `getStaticPaths` failure).
2. `dist/` contains `subject/CN/x7k2m9/index.html` + all 20 conversation paths.
3. Prerendered HTML serializes the route props (`initialCode`) for hydration.
4. Manual `npm run dev`: sidebar click → URL change → reload restores state.

Automated tests are deferred until backend wiring (recorded as known limitation).

## Boundaries

- Always: preserve existing Astryx hierarchy/tokens (`AGENTS.md`); validate
  URL params at the trust boundary (`isSubject`/`getChatByCode`, never render
  raw params); smallest diff that fixes build + routing.
- Ask first: switching to SSR adapter, changing the URL scheme again,
  touching `PESDacMockupTheme` or `global.css`.
- Never: redesign UI; add Tailwind/another CSS framework; commit secrets;
  use title-derived slugs as identity (titles rename, codes don't).

## Data requirements

- 20 stable 6-char alphanumeric codes, one per demo conversation
  (`lib/chat.ts:CHAT_CODES`), e.g. `TCP vs UDP → x7k2m9`. Constants, never
  generated at runtime. Backend will issue codes later; scheme is unchanged.
- Unknown `code` → welcome state with subject filter (mockup phase), never a
  crash. Only `TCP vs UDP` renders the full thread until other threads exist.

## Success Criteria

- [ ] `astro build` passes with 5 subject + 20 conversation static paths.
- [ ] Sidebar click navigates to `/subject/[subject]/[code]` (no `/chat/...`).
- [ ] Reload/paste of any conversation URL restores subject + selection.
- [ ] `New chat` returns to `/subject/[subject]` (or `/` from home).
- [ ] No visual change to any existing component.

## Open Questions

- None blocking. Future: real thread content per code, 404 vs welcome for
  unknown codes once backend owns IDs, SSR vs static when sharing needs
  unlisted codes.
