# Audit: My Profile link-password 404 + toast behind modal

Date: 2026-09-08
Status: Proposed (evidence from source inspection; live browser/worker state not yet re-verified in this run)
Scope: `POST /api/v1/auth/link-password` 404 + error toast rendering behind `ProfileDialog`, plus trailing failures in the same flow.

## 1. Reported symptoms

1. In My Profile > Authentication > Email + password > Add, submitting the link-password form reports `POST` endpoint 404.
2. The error toast that should inform the user paints behind the modal, so it looks blurry (dialog backdrop blur applied over it).
3. Reporter suspects trailing errors in the same feature.

## 2. Code path traced (current source)

Frontend form:

- `frontend/src/components/profile/sections.tsx:1370-1403` `handleLinkPassword()` validates length (`MIN_PASSWORD_LENGTH = 8`, `frontend/src/lib/auth.ts:27`) and confirm-match, then calls `linkPassword(linkNewPassword)`.
- Field errors paint inline via `TextInput status` (`linkFieldError`, `linkConfirmError`); server errors go to `toast({ body: toUserMessage(e, fallback), type: "error" })`.
- `frontend/src/lib/auth.ts:487-496` `linkPassword()` calls `apiFetch("/auth/link-password", { method: "POST", body: { newPassword } })`, throws when `!res?.ok`, then `refreshAccounts()`.

Request construction:

- `frontend/src/lib/auth.ts:659-670,745-795` `apiFetch` joins `currentApiRoot()` (`PUBLIC_API_BASE_URL`, `frontend/.env:9` = `http://localhost:8000`) + `API_PREFIX = "/api/v1"` + `path`. Correct call resolves to `POST http://localhost:8000/api/v1/auth/link-password`.
- Before the API call it mints a BetterAuth JWT via `GET {PUBLIC_BETTER_AUTH_URL}/api/auth/token` (`frontend/.env:10` = `http://localhost:4321`, `auth.ts:705-734`), attaches `Authorization: Bearer`, uses `credentials: "include"` and 15s abort timeout.
- 401 from the backend clears caches and dispatches `pesdac:auth-required` (`auth.ts:804-826`); other non-OK statuses throw `ApiError(status, envelope)`.
- `toUserMessage` (`auth.ts:116-135`): 404 -> `"That didn't work. Please try again later."`; >=500 -> `"That didn't work on our end. Please try again later."`; other 4xx -> server envelope message unless it is `"Not Found"`; `TypeError`/`AbortError` -> connection copy.

Backend route:

- `backend/app/routers/auth.py:60-135` defines `@router.post("/link-password")` with `get_current_user` JWT auth, `check_mutation_origin`, per-IP rate limit `5/300s`, then proxies to `{BETTER_AUTH_URL}/api/auth/set-password` with `{ newPassword }` and the incoming `Cookie` header.
- `backend/app/main.py:130-131` mounts `auth.router` at `prefix="/api/v1"`, so the assembled path is `POST /api/v1/auth/link-password`.
- Request schema `backend/app/schemas/auth.py:21-22` enforces `min_length=8, max_length=128`.
- Upstream non-success is forwarded with the upstream status code and `{error:{code,message}}` (`AUTH_VALIDATION` for upstream 422 else `AUTH_ERROR`); unreachable upstream -> 502 `AUTH_UNREACHABLE`; missing `BETTER_AUTH_URL` -> 500 `INTERNAL`.
- Existing regression test `backend/tests/test_auth_contract.py:54-64` asserts OpenAPI contains `POST /api/v1/auth/link-password`; happy-path/422/403/429/502 cases at lines 109-219.

Modal + toast layering:

- `frontend/src/components/Pesdac.tsx:1071` wraps the whole shell (including all dialogs) in `<LayerProvider toast={{ position: "topEnd", maxVisible: 3 }}>`.
- `LayerProvider` (`frontend/node_modules/@astryxdesign/core/src/Layer/LayerProvider.tsx:52-60`) renders `<ToastViewport>` with default `isTopLayer=true`.
- `ToastViewport` (`.../Toast/ToastViewport.tsx:44-71,160-172,415-428,485-501`) uses `position: fixed; zIndex: 500` plus `popover="manual"` promoted to the CSS top layer via `el.showPopover()` once on mount.
- `ProfileDialog` (`frontend/src/components/profile/ProfileDialog.tsx:183-190`) renders Astryx `<Dialog>`, which calls native `dialog.showModal()` on open (`.../Dialog/Dialog.tsx:528-529`) with `::backdrop { backdropFilter: blur(2px) }` (`Dialog.tsx:193-197`).
- The link-password form itself is `AuthenticationSection` inside `ProfileDialog` (`ProfileDialog.tsx:125`, `sections.tsx:1170-1701`); its `useToast()` (`sections.tsx:1173`) resolves to the same root viewport.

## 3. Root-cause analysis

### 3.1 The 404 is not a missing route in current source

Current source and the assembled FastAPI app both define the route. The prior full-stack audit (`docs/audits/2026-09-07-pesdac-full-stack-readiness-audit.md:498-515`) already verified: OpenAPI lists the route and an unauthenticated request returns 401, not 404. Conclusion then and now:

> The 404 comes from a stale runtime, not from current code.

Concrete stale-runtime candidates, in likelihood order:

1. Stale backend worker still bound to port 8000 started before slice 12B landed (or started from the wrong directory so `backend/.env` was not loaded). The old process has no `/auth/link-password` route, so the exact same frontend call 404s.
2. Wrong `PUBLIC_API_BASE_URL` at the time of the report (e.g. Astro dev server not restarted after `.env` edit, or preview pointing at a different host/port). `apiFetch` has a single join point, so any drift in that one env var 404s every call, not just link-password.
3. Astro dev-server stale module / cached `auth.ts` without the `/api/v1` prefix join (comment at `auth.ts:659-663` explicitly calls this out as a known 404 class).
4. Router prefix regression (`main.py:130-131` changed or `auth.py:33` prefix changed). Covered by `test_link_password_route_is_registered`, but that test only checks the in-process OpenAPI, not the live worker on :8000.

Why this matters for the fix: changing the route path or adding a duplicate route would mask the real problem and create two contracts. The fix must keep the contract (`POST /api/v1/auth/link-password`) and add runtime verification (OpenAPI probe + unauthenticated 401-vs-404 probe + stale-worker check), not a second endpoint.

Verification required before any route edit (do this live during implementation):

```powershell
# from backend/
python -m pytest tests/test_auth_contract.py -q
# live worker probe (backend running):
Invoke-RestMethod http://localhost:8000/api/openapi.json | Select-Object -ExpandProperty paths | Select-String "link-password"
Invoke-WebRequest -Method POST -Uri http://localhost:8000/api/v1/auth/link-password -Body '{}' -ContentType 'application/json' | Select-Object StatusCode
# Expected on current code: 401 envelope (JWT missing), NEVER 404.
# 404 here proves a stale worker or wrong process, not a code bug.
Get-NetTCPConnection -LocalPort 8000 -State Listen | Select-Object OwningProcess
```

Also confirm only one listener on 8000, restart uvicorn from `backend/`, hard-refresh Astro (`frontend/.env` host-only, no trailing `/api/v1`), and re-test.

### 3.2 Toast behind modal: top-layer ordering, not z-index

`zIndex: 500` on the toast viewport is a red herring once both elements are in the CSS top layer. Ordering facts:

- Toast viewport calls `showPopover()` once on mount (app start).
- `ProfileDialog` calls `showModal()` later (when the user opens My Profile).
- In the CSS top layer, later-shown entries paint above earlier ones. The dialog (and its `::backdrop` with `blur(2px)`) therefore paints above the earlier-promoted toast viewport.
- Result: the error toast (and the success toast `"Email + password linked."`) renders underneath the backdrop blur, appearing blurry/dimmed. This matches the report exactly.

Astryx's own prop comment anticipates the class of problem: `isTopLayer` defaults to `true`, with guidance to set it `false` "when inside a dialog or other top-layer element" (`ToastViewport.tsx:163-171`). Our viewport is at the app root, not inside the dialog, so the default keeps it in its own top-layer entry that loses the recency race to every later `showModal()`.

Fix direction (do not restyle the dialog or add global CSS): re-assert the toast viewport's top-layer recency after a dialog opens and/or whenever a toast is enqueued, using only public DOM APIs on the existing viewport element (e.g. re-`showPopover()` sequencing), or render the toast dispatch through a viewport instance that is already inside the dialog's top-layer context. Either approach must preserve Astryx 0.5.2, `PESDacMockupTheme`, `position: topEnd`, `maxVisible: 3`, auto-hide semantics (error toasts persist, info auto-hide 5s), and screen-reader announcement via the existing live regions. Verify visually in a real browser with the profile dialog open; a build-only check is insufficient.

Additional check: `frontend/src/components/chat/ThreadView.tsx:1444` sets `zIndex: 20` on an unrelated overlay; confirm it does not create a competing stacking context for the profile flow. No change expected, but include it in the browser pass.

## 4. Trailing errors found in the same flow (ranked)

| # | Finding | Location | Effect |
|---|---|---|---|
| T1 | `refreshAccounts()` drops the cache but `useAccounts()` never refetches (effect depends only on `auth.status`/`user.id`) | `auth.ts:364-367,376-403,495`; `sections.tsx:1230-1246` | After successful link, `hasCredential` stays false until reload; the Add row remains and a second link attempt fails confusingly. Same staleness affects unlink. |
| T2 | `handleLinkGoogle` never refreshes accounts and shows no success toast | `sections.tsx:1248-1260`; `auth.ts:305-307` | After linking Google the row still shows Link until reload; user cannot tell it worked. |
| T3 | Accounts error state is a dead end: `canLinkCredential` requires `ready`, so on `accounts.status === "error"` neither Add nor Change renders | `sections.tsx:1426-1429,1489,1509` | A transient `listAccounts()` failure removes both password rows with only row-description copy as feedback. |
| T4 | Upstream BetterAuth failure status is forwarded verbatim, including 401, which `apiFetch` then treats as session-invalid and dispatches global logout | `auth.py:129-132`; `auth.ts:802-828` | A BetterAuth cookie problem on the link call logs the user out to `/login` instead of showing a recoverable toast in the still-open modal. |
| T5 | Entire incoming `Cookie` header is forwarded upstream | `auth.py:87,101-105` | Over-broad credential forwarding; prior audit already flagged "forward only intended session cookie" (`2026-09-07` audit:400). |
| T6 | Upstream success/error body is trusted (`resp.is_success`, `resp.json()` without shape guard) | `auth.py:113-132` | A 5xx with unexpected JSON shape passes through or throws inside the handler; known P3 in `docs/api-design-audit.md:57,101`. |
| T7 | Max-length drift: server enforces 8-128, frontend only enforces min 8 | `schemas/auth.py:22`; `auth.ts:27`; `sections.tsx:1374` | A >128-char password costs a 422 round trip with a toast instead of inline feedback. |
| T8 | `AuthServiceError` (missing config, token mint network/timeout/rate-limit/server) flows through `toUserMessage` via the generic `Error.message` branch | `auth.ts:636-652,758-776,116-135` | Works today because `AuthServiceError` messages are user-safe, but there is no explicit branch, so a future edit can regress it silently. No test pins it. |
| T9 | Rate-limit 429 surfaces only as a toast with no retry affordance or countdown | `auth.py:81`; `sections.tsx:1395-1399` | User hammering Add gets repeated toasts; `Retry-After` header is never read. |
| T10 | Origin 403 copy `"Origin not allowed."` reaches the toast for browser users | `deps.py:143-152`; `auth.ts:124-126` | Correct to block, but the copy is operator-oriented; confirm it is the intended user-facing string or map it. |
| T11 | Success path uses `type: "info"` toast (auto-hide 5s) while the modal is open | `sections.tsx:1394` | If the toast-under-modal bug is fixed without touching timing, success is still easy to miss; confirm info vs success type per current Astryx API before changing. |
| T12 | No link-password frontend test; backend tests stub `httpx` but never assert the forwarded `Cookie` header or the no-shape-guard case | `frontend/tests/auth-api.test.ts` (no link test); `backend/tests/test_auth_contract.py:84-219` | Regressions in T4-T6 have no automated guard. |

Security notes (no new vulnerability introduced by this audit): JWT verification stays server-side (`deps.py:64-103`), `get_current_user` runs before origin/rate-limit logic (FastAPI dependency order), mutations require origin allowlist (`deps.py:118-164`) plus per-IP rate limit, no secrets are logged (`main.py:36-40`, `auth.py:94,107,134`). The cookie-forwarding breadth (T5) and verbatim status forwarding (T4) are the two items to tighten.

## 5. What this audit does NOT claim

- The live worker state at report time was not captured (no `openapi.json` snapshot, no process list, no HAR). The stale-worker conclusion is inferred from code + prior audit, and must be re-proven live in T1 of the plan.
- BetterAuth `set-password` behavior when a credential already exists (update vs 4xx) was not probed against BetterAuth 1.7.3 docs/source in this pass; the plan includes a source-driven check before relying on it.
- Exact top-layer paint order was reasoned from Astryx source (`showPopover` on mount vs `showModal` on open), not from a live devtools capture; the plan requires a devtools capture before choosing the final toast fix.

## 6. Inputs used

`backend/app/routers/auth.py`, `backend/app/main.py`, `backend/app/deps.py`, `backend/app/schemas/auth.py`, `backend/app/config.py`, `frontend/src/lib/auth.ts`, `frontend/src/lib/auth-client.ts`, `frontend/src/components/profile/sections.tsx`, `frontend/src/components/profile/ProfileDialog.tsx`, `frontend/src/components/Pesdac.tsx`, `frontend/src/components/AppToasts.tsx`, `lib/auth.ts` (BetterAuth server), `frontend/.env`, `backend/.env`, Astryx `ToastViewport.tsx` / `LayerProvider.tsx` / `Dialog.tsx`, `docs/slices/slice-12b-link-credential.md`, `slice-12e-error-toasts-everywhere.md`, `slice-15-server-errors-to-toasts.md`, `docs/api-design-audit.md`, `docs/audits/2026-09-07-pesdac-full-stack-readiness-audit.md`, `backend/tests/test_auth_contract.py`, `frontend/tests/auth-api.test.ts`.
