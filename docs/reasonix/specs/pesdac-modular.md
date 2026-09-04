# PESDac Modular Spec

Problem: Single 46.8KB `.tsx` file, single route, `client:only`, performance 56.

Users: Study-assistant users navigating subjects (CN, Math, DSA, DLCD, OS).

Goals:
- Break `Pesdac.tsx` into modular components without changing demo data
- Add page-level routing (`/subject/[subject]`) ready for backend
- Improve performance to 80+
- Keep theme intact

Non-goals:
- Modify demo data/content (subjects, messages, prompts)
- Change visual design/Astryx theme
- Add actual backend/API
- Change interactive behaviors

Functional requirements:
- `components/chat/` — chat UI only
- `components/nav/` — sidebar + subject selection only
- `components/layout/` — app shell + theme wrapper
- `pages/index.astro` — landing with lazy-loaded sections
- `pages/subject/[subject].astro` — subject-specific route (template, no backend yet)
- Theme stays `PESDacMockupTheme`

Performance targets:
- Build passes
- Bundle split by route
- Performance score 80+ (measured via Lighthouse/build audit)

Constraints:
- Keep Astro + React 19 + Astryx 0.5.2
- No Tailwind/custom CSS added
- No `node_modules` changes
