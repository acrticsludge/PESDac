# Dependency audit decision — T45/T52

Recorded: 2026-09-08 after the Astro runtime compatibility fix.

## Command

```text
cd frontend
npm.cmd audit --omit=dev --audit-level=high
```

Current result: exit code 1; 3 vulnerabilities reported: 1 low and 2 high.

## Current dependency decision

The frontend is intentionally pinned to the compatible Astro 6.0.5 and Node adapter 10.0.2 pair:

- `astro`: `6.0.5`
- `@astrojs/node`: `10.0.2`

The previous range resolved Astro 6.4.8 with the older adapter runtime API. `astro preview` crashed with `app.getAdapterLogger is not a function`. Astro 6.0.5 restores the method expected by the adapter without moving to Astro 7.

## Audit findings

The current audit reports Astro advisories including:

- GHSA-j687-52p2-xcff — `define:vars` XSS;
- GHSA-xr5h-phrj-8vxv — server-island encrypted-parameter replay;
- GHSA-jrpj-wcv7-9fh9 and GHSA-f48w-9m4c-m7f5 — spread-prop XSS;
- GHSA-7pw4-f3q4-r2p2 — hydrated-island `transition:*` XSS;
- GHSA-4g3v-8h47-v7g6 — view-transition animation XSS;
- GHSA-2pvr-wf23-7pc7 — Host header SSRF in prerendered error pages;
- GHSA-8hv8-536x-4wqp — slot-name XSS.

It also reports:

- GHSA-g7r4-m6w7-qqqr — high-severity Windows dev-server file-read issue in esbuild 0.27.3–0.28.0;
- GHSA-f88m-g3jw-g9cj — high-severity sharp/libvips issues below 0.35.0.

The audit recommends `npm audit fix --force`, which would move Astro outside the pinned dependency range. Do not run it in T47–T65.

## Decision and mitigation

Defer the framework upgrade to a separate Astro security migration. This is an accepted risk, not a claim that the advisories are low severity.

- Never expose `astro dev` or its Vite server publicly.
- Deploy the built Node output through the supported adapter.
- Do not add user-controlled `transition:*`, view-transition, `define:vars`, spread-attribute, or slot-name values.
- Schedule Astro 6 → 7 migration with lockfile review, security regression tests, hydration/browser checks, and visual comparison.

Owner: PESDac frontend maintainer.
Follow-up: Astro 6 → 7 security migration.
