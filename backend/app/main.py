"""App factory: CORS from FRONTEND_ORIGINS, versioned routers, security headers,
envelope normalization for validation errors. No UI, no frontend changes.
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import config
from app.routers import auth, chats, demo_state, health, profiles, users
from app.schemas.common import INTERNAL_ERROR, error_body


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

        # Pydantic ctx values hold exception objects (not JSON-serializable).
        details = json.loads(json.dumps(exc.errors(), default=str))
        return JSONResponse(
            status_code=422,
            content=error_body("VALIDATION_ERROR", "Invalid request.", details=details),
        )

    @app.exception_handler(Exception)
    async def _internal(request: Request, exc: Exception):
        return JSONResponse(status_code=500, content=INTERNAL_ERROR)

    app.include_router(health.router, prefix="/api/v1")
    app.include_router(auth.router, prefix="/api/v1")
    app.include_router(profiles.router, prefix="/api/v1")
    app.include_router(chats.router, prefix="/api/v1")
    app.include_router(demo_state.router, prefix="/api/v1")
    app.include_router(users.router, prefix="/api/v1")
    return app


app = None
try:
    # Import-time creation is skipped when env is absent (tests build their own
    # app via create_app(validate=False) with an SQLite override).
    if config.DATABASE_URL and config.NEON_AUTH_JWKS_URL and config.FRONTEND_ORIGINS:
        app = create_app(validate=True)
    else:
        app = create_app(validate=False)
except RuntimeError:
    app = create_app(validate=False)
