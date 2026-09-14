# Stale-worker / stale-asset recovery (audit §17)

## Symptoms

- Versioned `_astro/*` URLs 404 after a deploy (mixed builds).
- `504 "Outdated Optimize Dep"` from the Vite dev server (stale
  optimized-deps manifest after dependency/config changes).
- A previously-green e2e run suddenly fails on load with resource
  errors (stale preview build — `PUBLIC_*` bake at build time).

## Recovery (in order, stop when green)

1. Hard-refresh the browser (stale worker/asset URLs are usually local).
2. Dev: restart BOTH dev servers (frontend `astro dev` + backend) —
   `optimizeDeps.force` rebuilds the dev cache on startup; then
   hard-refresh again.
3. Preview/prod: rebuild cleanly (`npm run build` empties `dist/`) and
   redeploy — never patch asset files into a live deploy.
4. E2E: `npm run test:e2e` rebuilds with the e2e origin pinned; a
   session-host mismatch (CORS-blocked `get-session` in the console)
   always means the build's baked origin ≠ the serving origin —
   rebuild, don't chase headers.
5. Still red after 1–4: treat as an incident (LESSONS.md entry), not a
   cache problem — something actually broke.
