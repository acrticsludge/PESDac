# PESDac Modular Audit — 2026-09-04

Category: Architecture / Performance / Modularization

## What happened
- Original mockup: single `Pesdac.tsx` (46.8KB) with all UI, data, interaction logic inline
- Single Astro page `index.astro` imports it directly (`client:only="react"`)
- Theme `PESDacMockupTheme.js` (17.1KB) is fine but loaded globally
- No component decomposition; everything in one file
- Performance score 56 (target 80+)

## Root cause
- Monolithic component = large JS bundle, slow hydration, no lazy-loading
- `client:only="react"` forces full React hydration for entire page
- No code-splitting by route/section
- No lazy loading for non-critical UI sections

## Fix plan
1. Decompose `Pesdac.tsx` → modular components (`layout/`, `chat/`, `nav/`)
2. Create `pages/` routes (`/`, `/subject/[subject]`) for backend-ready routing
3. Change `client:only` → `client:load` with selective hydration
4. Lazy-load non-critical sections
5. Keep all demo data untouched

## Prevention
- Use modular page architecture from start
- Audit bundle size before shipping
