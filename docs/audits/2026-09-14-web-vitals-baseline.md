# Web-Vitals baseline (audit §14 item 1)

Date: 2026-09-14. Tool: Lighthouse 12 (desktop preset, devtools
throttling) against local `astro preview` (production build) on this
machine — lab numbers, not field data. Guest view (login gate showing;
no backend staging needed for these routes).

## /new (guest gate over the welcome shell)

| Metric | Value |
|---|---|
| Performance score | 0.94 |
| FCP | 0.3 s |
| LCP | 0.3 s |
| TBT | 0 ms |
| CLS | 0.001 |
| TTI | 2.6 s |
| Speed Index | 2.6 s |
| TTFB (server-response-time) | 20 ms |
| Long tasks | 2 |
| Network requests | 14 |
| JS bootup total | 537 ms (`client.*` 217 ms, page 216 ms) |

Reading: paint is instant (SSR shell); interactivity waits on island
hydration (~1 MB client JS, see `npm run bundle:check`). TTI/SI 2.6 s
is the hydration cost — the single biggest lever left.

## /login (static auth page)

Score 1.0 — FCP/LCP 0.4 s, TBT 0 ms, CLS 0, TTI 0.4 s. Nothing to do.

## Bundle (same build, `npm run bundle:check`)

Client JS total ~1020 KB uncompressed (cap 1200 KB); no chunk over
500 KB. Biggest: AppLayout (~372 KB, Astryx + React baseline),
PESDac island (~222 KB), client runtime (~176 KB), auth (~121 KB).
Raw JSON: `lh-new.json` / `lh-login.json` (kept locally, not committed).

## Still pending (needs staging + real throttling rig)

- Mobile emulation + Moto-G-class CPU throttling (desktop numbers
  above flatter everything).
- INP (needs scripted interaction; the e2e net is the harness — add
  an interaction audit when the authed matrix lands).
- Field data (RUM) once deployed.
- Re-run after any chunk crosses its cap (`bundle:check` gates it).
