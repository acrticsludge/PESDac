# ADR 0001: Astro runs server-side on the Node standalone adapter

## Status
Accepted (2026-09-14). Supersedes the static-only direction in `docs/architecture/backend-foundation-auth-profiles-chats.md` D1 and the static-output option in `docs/audits/2026-09-06-backend-readiness-audit.md` §1.2.

## Date
2026-09-14

## Context
The architecture doc (D1) says "Astro stays static" to avoid a hybrid/SSR migration, and the T47–T65 report claims "static subject routes explicitly retain prerendering". The tree says otherwise:
- `frontend/astro.config.mjs:15-17` sets `output: 'server'` with `@astrojs/node` standalone adapter (comment: the Node preview/runtime handler is only valid for SSR output mode).
- Server endpoints exist and are load-bearing: the BetterAuth handler `frontend/src/pages/api/auth/[...slug].ts` and same-origin `POST /api/link-password` (`frontend/src/pages/api/link-password.ts:5-13`, in-process `auth.api.setPassword`, `prerender = false`).
- `frontend/src/middleware/auth.ts` runs an SSR session lookup on every page request (800 ms timeout; proved-guest vs unknown tri-state so the client fails closed to `loading`).
- Both subject routes are explicitly server-rendered (`frontend/src/pages/subject/[subject].astro:2`, `frontend/src/pages/subject/[subject]/[code].astro:7` — `prerender = false`). No prerendered routes were observed.

## Decision
Astro is a server-rendered app on the Node standalone adapter. The Python FastAPI service (`backend/`, `/api/v1`) remains a separate API service reached over CORS + env config (`PUBLIC_API_BASE_URL`, `apiFetch` appends `/api/v1`). Same-origin Astro endpoints are allowed only for operations that must run in-process with the session cookie (BetterAuth handler, link-password). There is no static-export target.

## Alternatives Considered

### Static export + external backend (arch D1 as written)
- Pros: simplest hosting, no Node runtime.
- Cons: contradicts the existing middleware, the in-process BetterAuth/link-password routes, and server-rendered subject pages — adopting it now means deleting working auth machinery.
- Rejected: the tree has already migrated; the doc is stale, not the code.

### Hybrid output (prerendered marketing/subject pages + server auth pages)
- Pros: cheaper serving for cacheable pages.
- Cons: the subject pages are currently `prerender = false` by intent (auth-gated content must never be baked into static HTML); re-enabling prerendering needs per-route auth review.
- Deferred: revisit only with a per-route prerender allowlist and auth review, as its own ADR.

## Consequences
- Deployments must provide the pinned Node runtime (`astro@6.0.5` + `@astrojs/node@10.0.2` per the T45 decision doc; do not upgrade casually).
- `src/middleware/auth.ts` matcher scope stays intentional — every invocation must have a reason to run; static-asset exclusion, cache behaviour, and perf impact are verified before middleware changes ship.
- CSP belongs on the frontend host (the FastAPI service intentionally serves JSON only and carries no CSP — `backend/app/main.py`).
- A future return to static export requires a new ADR plus migration of the in-process endpoints; it is not a config flip.
