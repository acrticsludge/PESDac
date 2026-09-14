# Web-quality audit (audit §15 item 3)

Date: 2026-09-14. Harness: `frontend/e2e/a11y.spec.ts` (axe-core,
wcag2a/2aa + 21a/21aa + 22aa tags) against local preview; re-run with
`npx playwright test e2e/a11y.spec.ts` (needs the e2e build first —
see `npm run test:e2e`). History is append-only: add dated rows, never
rewrite this file.

## 2026-09-14 — baseline (all public routes)

| Route | State | Passes | Violations (any level) |
|---|---|---|---|
| `/new` | login gate open (the exact state guests meet) | 17 | 0 |
| `/login` | form | 24 | 0 |
| `/signup` | form | 24 | 0 |
| unknown path | `404.astro` | 10 | 0 |

- Gate focus: `document.activeElement` on open is a BUTTON inside the
  dialog — focus-trap entry works (Astryx Dialog).
- 200% zoom (CSS-zoom emulation on a 640px viewport): gate stays
  visible, `scrollWidth` 640 — no horizontal overflow.
- No `aria-*` hand-rolled anywhere on these routes; dialogs, inputs,
  and buttons are Astryx components with built-in semantics.

## Public-route hygiene (same date)

- `lang="en"`, charset, viewport, and per-route `<title>` on
  `login` / `signup` / `404` (verified by file read).
- No `<img>` on public routes (icons are inline SVG components — no
  alt text to miss).
- Fonts: Figtree first with a full system fallback stack; no webfont
  fetch in the chain (Lighthouse flags nothing) — no FOUT/FOIT lever
  to pull.
- Authed app routes are not SEO content: noindex decisions belong to
  the deploy step (§20), not to this audit. Do not index private
  content.

## Explicitly NOT covered (owners)

- Keyboard-only composer + chat actions past the gate, focus
  entry/return on Profile/Settings/destructive dialogs, toast
  live-region announcement timing, reduced-motion verification,
  minimum touch-target measurement: all need an authenticated staging
  session (authed matrix is `test.fixme` in `e2e/smoke.spec.ts`).
- Screen-reader pass (NVDA/VoiceOver) — human run, staging.
- Contrast beyond axe's static checks (state-dependent colors).
