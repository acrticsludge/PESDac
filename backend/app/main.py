"""App factory: CORS from FRONTEND_ORIGINS, versioned routers, security headers,
envelope normalization for validation errors. No UI, no frontend changes.
"""

from __future__ import annotations

import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import config
from app.routers import auth, chats, demo_state, health, profiles, users
from app.schemas.common import error_body

# Server-side visibility (the user only ever sees the generic envelope
# below). Stdlib logging, no deps: uvicorn configures the root handler,
# pytest captures via caplog. Never log tokens, claims, or request
# bodies here — method + path + reason only.
logger = logging.getLogger("pesdac")


def create_app(validate: bool = True) -> FastAPI:
    if validate:
        config.validate_startup(require_db=True)

    app = FastAPI(title="PESDac API", version="0.1.0", docs_url="/api/docs", openapi_url="/api/openapi.json")

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
        return response

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError):
        import json

        logger.info("422 %s %s", request.method, request.url.path)
        # Pydantic ctx values hold exception objects (not JSON-serializable).
        details = json.loads(json.dumps(exc.errors(), default=str))
        return JSONResponse(
            status_code=422,
            content=error_body("VALIDATION_ERROR", "Invalid request.", details=details),
        )

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
try:
    # Import-time creation is skipped when env is absent (tests build their own
    # app via create_app(validate=False) with an SQLite override).
    if config.DATABASE_URL and config.NEON_AUTH_JWKS_URL and config.FRONTEND_ORIGINS:
        app = create_app(validate=True)
    else:
        # Unvalidated boot (tests, or env missing entirely). With no
        # FRONTEND_ORIGINS every CORS preflight 400s — this warning is
        # the signal, not silent breakage.
        logger.warning(
            "PESDac API booting WITHOUT validated env "
            "(DATABASE_URL=%s, JWKS=%s, ORIGINS=%s)",
            bool(config.DATABASE_URL),
            bool(config.NEON_AUTH_JWKS_URL),
            config.FRONTEND_ORIGINS,
        )
        app = create_app(validate=False)
except RuntimeError:
    logger.warning("PESDac API misconfigured; booting unvalidated fallback")
    app = create_app(validate=False)
