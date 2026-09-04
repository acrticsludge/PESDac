# PESDac Modular Plan

## Tasks (vertical slices)

### T1: Split component (independent)
Objective: Break `Pesdac.tsx` into 3 files without changing data.
Files: `components/chat/ChatArea.tsx`, `components/nav/SideNavArea.tsx`, `components/layout/AppLayout.tsx`
Acceptance: `astro build` passes; same visual output; demo data untouched.
Verification: `npm run build`

### T2: Add page routing (independent)
Objective: Create `pages/subject/[subject].astro` template.
Files: `pages/index.astro`, `pages/subject/[subject].astro`
Acceptance: Routes exist, load correctly with `client:load`.
Verification: `npm run dev`, navigate `/subject/CN`

### T3: Lazy load + hydration fix (independent)
Objective: Change `client:only` → `client:load`; lazy load non-critical sections.
Files: `pages/index.astro`, `components/layout/AppLayout.tsx`
Acceptance: Performance improves; no hydration errors.
Verification: Lighthouse audit shows 80+

### T4: Performance audit (independent)
Objective: Verify bundle size, lazy loading, build output.
Files: `docs/audits/periodic/`
Acceptance: Performance 80+, modular structure documented.
Verification: `astro build`, `ls dist/_astro/`

Dependencies: T1 before T2; T2 before T3.

Rollback: Each task is atomic — git checkout previous file restores.
