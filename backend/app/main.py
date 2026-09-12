"""App factory: CORS from FRONTEND_ORIGINS, versioned routers, security headers,
envelope normalization for validation errors. No UI, no frontend changes.
"""

from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import config
from app.routers import auth, chats, demo_state, health, profiles, users
from app.schemas.common import error_body

# Map HTTP status → error code used in the standard envelope. Covers
# every status our routers raise (via HTTPException or via the
# check_mutation_origin / rate_limit JSONResponse paths). 404 has no
# generic code here because each router constructs its own
# NOT_FOUND payload.
_HTTP_CODE_BY_STATUS: dict[int, str] = {
    400: "BAD_REQUEST",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    409: "CONFLICT",
    422: "VALIDATION_ERROR",
    429: "RATE_LIMITED",
}

# Server-side visibility (the user only ever sees the generic envelope
# below). Stdlib logging, no deps: uvicorn configures the root handler,
# pytest captures via caplog. Never log tokens, claims, or request
# bodies here — method + path + reason only.
logger = logging.getLogger("pesdac")


async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Boot warmup: pay cold-start costs here instead of on the first user
    request. Fresh boots otherwise burn ~5s on TLS + Postgres auth for the
    first pooled connection (measured) plus ~3s on the first JWKS fetch —
    all of it landing inside the user's first paint. Awaited (not
    background) so "startup complete" means genuinely ready; every leg is
    failure-tolerant — a failed warmup only logs, and the first request
    pays the cold cost exactly as before (no new failure mode)."""
    try:
        from sqlalchemy import text

        from app.db import get_engine

        engine = get_engine()
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        logger.info("startup warmup: db pool connected")
    except Exception as exc:
        logger.warning(
            "startup warmup: db connect skipped category=%s",
            type(exc).__name__,
        )
    try:
        from app.auth.betterauth import warm_jwks_cache

        if await warm_jwks_cache():
            logger.info("startup warmup: jwks prefetched")
    except Exception as exc:
        logger.warning(
            "startup warmup: jwks prefetch skipped category=%s",
            type(exc).__name__,
        )
    yield


def _cors_error_headers(request: Request) -> dict[str, str]:
    """CORS headers for error responses, mirroring CORSMiddleware.

    Reproduced cause (TestClient, allowlisted Origin): success/4xx legs
    built by routes carry `Access-Control-Allow-Origin`, but responses
    built by these exception handlers intermittently do not — the
    BaseHTTPMiddleware security-headers layer sits outside
    CORSMiddleware and re-sends the collected response, which can drop
    the injected ACAO on the exception path. Without these headers the
    browser masks every 4xx/5xx as a CORS failure ("No
    'Access-Control-Allow-Origin' header"), hiding the real status plus
    the 500 reference the frontend needs. Non-browser callers (no
    Origin) and disallowed origins get no headers — identical to the
    middleware's own behavior.
    """
    origin = request.headers.get("origin")
    if not origin or origin not in config.FRONTEND_ORIGINS:
        return {}
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Vary": "Origin",
    }


def create_app(validate: bool = True) -> FastAPI:
    if validate:
        config.validate_startup(require_db=True)

    app = FastAPI(title="PESDac API", version="0.1.0", docs_url="/api/docs", openapi_url="/api/openapi.json", lifespan=_lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.FRONTEND_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization"],
        max_age=600,
    )

    @app.middleware("http")
    async def _security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        # HSTS only on https deployments (browsers ignore it over http,
        # so gating on COOKIE_SECURE keeps local dev untouched). No
        # Content-Security-Policy here by intent: /api/docs (Swagger UI)
        # needs inline + CDN scripts, and this API serves no HTML of its
        # own — CSP belongs on the frontend host, not these JSON routes.
        if config.COOKIE_SECURE:
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return response

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError):
        import json

        logger.info("422 %s %s", request.method, request.url.path)
        # Pydantic ctx values hold exception objects (not JSON-serializable).
        details = json.loads(json.dumps(exc.errors(), default=str))
        # User-facing redaction (error-copy audit): `input` echoes the raw
        # request value verbatim (unbounded replay of user data) and `ctx`
        # carries validator internals (constraint values, str()-coerced
        # exceptions). Keep only the structural keys the UI needs to say
        # *which field* failed and why. Allowlist, not denylist, so future
        # Pydantic keys fail closed (dropped) instead of shipping.
        details = [
            {k: v for k, v in item.items() if k in ("loc", "msg", "type")}
            for item in details
            if isinstance(item, dict)
        ]
        return JSONResponse(
            status_code=422,
            content=error_body("VALIDATION_ERROR", "Invalid request.", details=details),
            headers=_cors_error_headers(request),
        )

    @app.exception_handler(HTTPException)
    async def _http_exception(request: Request, exc: HTTPException):
        # FastAPI's default HTTPException body is {detail: ...}; every
        # other error in this app uses {error: {code, message}}.
        # Translate here so the consumer parses one shape regardless
        # of which dependency or route produced the failure.
        #
        # Detail may be a string (most calls) or any other JSON-serializable
        # value (rare). Coerce to a string message; preserve the status.
        detail = exc.detail
        if isinstance(detail, str):
            message = detail
        else:
            message = str(detail) if detail is not None else "Request failed."
        code = _HTTP_CODE_BY_STATUS.get(exc.status_code, "ERROR")
        headers = _cors_error_headers(request)
        if exc.headers:
            headers.update(exc.headers)
        return JSONResponse(
            status_code=exc.status_code,
            content=error_body(code, message),
            headers=headers,
        )

    @app.exception_handler(StarletteHTTPException)
    async def _starlette_http_exception(request: Request, exc: StarletteHTTPException):
        # Starlette's router raises its own HTTPException for unmatched
        # paths (404) and disallowed methods (405). FastAPI's handler
        # only catches FastAPI's variant, so a 404 on `/api/v1/nope` would
        # still ship as `{detail: "Not Found"}`. Re-wrap here.
        return await _http_exception(request, exc)  # type: ignore[arg-type]

    @app.exception_handler(Exception)
    async def _internal(request: Request, exc: Exception):
        # Generic by design (never leak internals), but quoted with a
        # reference the server log carries: "what went wrong" is
        # answerable by grepping the ref, without asking the user.
        ref = uuid.uuid4().hex[:8]
        logger.exception("500 %s %s ref=%s", request.method, request.url.path, ref)
        return JSONResponse(
            status_code=500,
            content=error_body(
                "INTERNAL", f"Something went wrong. Reference: {ref}."
            ),
            headers=_cors_error_headers(request),
        )

    app.include_router(health.router, prefix="/api/v1")
    app.include_router(auth.router, prefix="/api/v1")
    app.include_router(profiles.router, prefix="/api/v1")
    app.include_router(chats.router, prefix="/api/v1")
    app.include_router(demo_state.router, prefix="/api/v1")
    app.include_router(users.router, prefix="/api/v1")
    logger.info(
        "PESDac API ready (env=%s, routes=%d)",
        config.ENV,
        len(app.routes),
    )
    return app


app = None
# T16: production must fail fast on invalid configuration. We only build
# the validated `app` when ENV is set, the required config is present,
# AND the validate_startup call succeeds. Tests build their own via
# create_app(validate=False) with SQLite + dummy env; nothing here
# silently boots a half-configured server.
if (
    config.ENV != "test"
    and config.DATABASE_URL
    and config.FRONTEND_ORIGINS
    and config.BETTER_AUTH_URL
    and config.BETTER_AUTH_SECRET
):
    try:
        app = create_app(validate=True)
    except RuntimeError:
        # Re-raise so the process exits with a meaningful trace. The
        # previous "unvalidated fallback" boot was silently masking
        # missing-config deployments behind a 500-ing server.
        raise
else:
    # No env / test env: no module-level app. Uvicorn entry-points
    # must run from a script that calls create_app(validate=...) with
    # full config — never the import-time `app`.
    if config.ENV not in ("test", None) and not config.DATABASE_URL:
        logger.warning(
            "PESDac API not built: missing DATABASE_URL. "
            "Set ENV=test for tests, or supply DATABASE_URL."
        )
