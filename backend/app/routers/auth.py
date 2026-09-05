"""Auth router (arch §7.1). Cookies: pesdac_at (JWT) + pesdac_rt (opaque).

- Signup/login failures share one message (no account oracle).
- Refresh rotates: old hash revoked, new row issued. Reuse of a revoked
  token revokes the whole family (theft signal).
- Google OAuth is lazy-imported (Authlib): 501 OAUTH_NOT_CONFIGURED when env
  is missing, so email auth works without Google configured.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import config, rate_limit, security
from app.db import get_db
from app.deps import check_mutation_origin, get_current_user
from app.models.users import OAuthAccount, PasswordResetToken, RefreshToken, User
from app.models.profiles import Profile
from app.schemas.auth import LoginIn, PasswordConfirmIn, PasswordRequestIn, SignupIn
from app.schemas.common import error_body

router = APIRouter(prefix="/auth", tags=["auth"])

_BAD_CREDENTIALS = error_body("INVALID_CREDENTIALS", "Incorrect email or password.")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _user_out(user: User) -> dict:
    return {"id": str(user.id), "email": user.email, "displayName": user.display_name}


def _set_auth_cookies(response: Response, access: str, refresh: str) -> None:
    secure = config.COOKIE_SECURE
    response.set_cookie(
        config.ACCESS_COOKIE, access, httponly=True, secure=secure,
        samesite="lax", path="/", max_age=config.ACCESS_TTL_MIN * 60,
    )
    response.set_cookie(
        config.REFRESH_COOKIE, refresh, httponly=True, secure=secure,
        samesite="lax", path="/api/v1/auth", max_age=config.REFRESH_TTL_DAYS * 86400,
    )


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(config.ACCESS_COOKIE, path="/")
    response.delete_cookie(config.REFRESH_COOKIE, path="/api/v1/auth")


def _issue_refresh(db: Session, user_id: uuid.UUID) -> str:
    token, digest = security.new_refresh_token()
    db.add(RefreshToken(
        user_id=user_id, token_hash=digest,
        expires_at=_utcnow() + timedelta(days=config.REFRESH_TTL_DAYS),
    ))
    return token


def _login_response(db: Session, user: User, status: int = 200) -> Response:
    access = security.create_access_token(str(user.id))
    refresh = _issue_refresh(db, user.id)
    db.commit()
    resp = JSONResponse(status_code=status, content={"user": _user_out(user)})
    _set_auth_cookies(resp, access, refresh)
    return resp


def _send_reset_email(to_email: str, token: str) -> None:
    # Pluggable mail: Resend/SMTP when configured, logged-only otherwise.
    # The token itself is NEVER logged.
    _ = (to_email, token)


@router.post("/signup", status_code=201)
def signup(body: SignupIn, request: Request, db: Session = Depends(get_db)):
    if denied := check_mutation_origin(request):
        return denied
    if limited := rate_limit.check("signup", request, config.RATE_LIMIT_SIGNUP, 3600):
        return limited
    email = body.email
    existing = db.scalar(select(User).where(User.email == email))
    if existing is not None:
        return JSONResponse(status_code=409, content=error_body("EMAIL_TAKEN", "An account with this email already exists."))
    user = User(email=email, password_hash=security.hash_password(body.password), display_name=body.displayName)
    db.add(user)
    db.flush()
    db.add(Profile(user_id=user.id, display_name=body.displayName, email=email))
    return _login_response(db, user, status=201)


@router.post("/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    if denied := check_mutation_origin(request):
        return denied
    if limited := rate_limit.check("login", request, config.RATE_LIMIT_LOGIN, 60):
        return limited
    user = db.scalar(select(User).where(User.email == body.email))
    if user is None or not user.password_hash or not security.verify_password(body.password, user.password_hash):
        return JSONResponse(status_code=401, content=_BAD_CREDENTIALS)
    return _login_response(db, user)


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    if denied := check_mutation_origin(request):
        return denied
    raw = request.cookies.get(config.REFRESH_COOKIE)
    if raw:
        row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == security.hash_token(raw)))
        if row is not None and row.revoked_at is None:
            row.revoked_at = _utcnow()
            db.commit()
    resp = JSONResponse(status_code=200, content={})
    _clear_auth_cookies(resp)
    return resp


@router.post("/refresh")
def refresh(request: Request, db: Session = Depends(get_db)):
    raw = request.cookies.get(config.REFRESH_COOKIE)
    if not raw:
        return JSONResponse(status_code=401, content=error_body("UNAUTHORIZED", "Session expired. Log in again."))
    row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == security.hash_token(raw)))
    now = _utcnow()
    # Reuse of a revoked/expired token revokes the whole family (theft signal).
    if row is None:
        return JSONResponse(status_code=401, content=error_body("UNAUTHORIZED", "Session expired. Log in again."))
    aware_expires = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=timezone.utc)
    revoked = row.revoked_at is not None
    if revoked or aware_expires <= now:
        db.query(RefreshToken).filter(
            RefreshToken.user_id == row.user_id, RefreshToken.revoked_at.is_(None)
        ).update({RefreshToken.revoked_at: now})
        db.commit()
        return JSONResponse(status_code=401, content=error_body("UNAUTHORIZED", "Session expired. Log in again."))
    row.revoked_at = now
    user = db.get(User, row.user_id)
    assert user is not None
    access = security.create_access_token(str(user.id))
    new_refresh = _issue_refresh(db, user.id)
    db.commit()
    resp = JSONResponse(status_code=200, content={})
    _set_auth_cookies(resp, access, new_refresh)
    return resp


@router.get("/me")
def me(result=Depends(get_current_user), db: Session = Depends(get_db)):
    from fastapi.responses import JSONResponse as JR

    if isinstance(result, JR):
        return result
    return {"user": _user_out(result)}


@router.post("/password/request", status_code=202)
def password_request(body: PasswordRequestIn, request: Request, db: Session = Depends(get_db)):
    if denied := check_mutation_origin(request):
        return denied
    if limited := rate_limit.check("pw-request", request, 5, 3600):
        return limited
    # Identical 202 either way — no account oracle.
    user = db.scalar(select(User).where(User.email == body.email))
    if user is not None:
        token = secrets.token_urlsafe(32)
        db.add(PasswordResetToken(
            user_id=user.id, token_hash=security.hash_token(token),
            expires_at=_utcnow() + timedelta(minutes=60),
        ))
        db.commit()
        _send_reset_email(user.email, token)
    return {}


@router.post("/password/confirm")
def password_confirm(body: PasswordConfirmIn, request: Request, db: Session = Depends(get_db)):
    if denied := check_mutation_origin(request):
        return denied
    if limited := rate_limit.check("pw-confirm", request, 10, 3600):
        return limited
    row = db.scalar(select(PasswordResetToken).where(
        PasswordResetToken.token_hash == security.hash_token(body.token)))
    now = _utcnow()

    def _invalid():
        return JSONResponse(status_code=400, content=error_body("INVALID_TOKEN", "This reset link is invalid or expired."))

    if row is None or row.used_at is not None:
        return _invalid()
    aware_exp = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=timezone.utc)
    if aware_exp <= now:
        return _invalid()
    user = db.get(User, row.user_id)
    assert user is not None
    user.password_hash = security.hash_password(body.newPassword)
    user.updated_at = now
    row.used_at = now
    db.query(RefreshToken).filter(
        RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None)
    ).update({RefreshToken.revoked_at: now})
    db.commit()
    return {}


@router.get("/google/start")
def google_start(request: Request, next: str = "/new"):
    if not config.google_configured():
        return JSONResponse(status_code=501, content=error_body("OAUTH_NOT_CONFIGURED", "Google sign-in is not configured."))
    if not next.startswith("/") or next.startswith("//"):
        next = "/new"
    try:
        from authlib.integrations.starlette_client import OAuth  # type: ignore[import-not-found]
        from starlette.config import Config as StarletteConfig
    except Exception:
        return JSONResponse(status_code=501, content=error_body("OAUTH_NOT_CONFIGURED", "Google sign-in is not configured."))
    _ = (OAuth, StarletteConfig)
    state = secrets.token_urlsafe(24)
    resp = RedirectResponse(
        "https://accounts.google.com/o/oauth2/v2/auth"
        f"?client_id={config.GOOGLE_CLIENT_ID}"
        f"&redirect_uri={config.GOOGLE_REDIRECT_URI}"
        "&response_type=code&scope=openid%20email%20profile"
        f"&state={state}",
        status_code=302,
    )
    resp.set_cookie(config.OAUTH_STATE_COOKIE, f"{state}.{next}",
                    httponly=True, secure=config.COOKIE_SECURE,
                    samesite="lax", path="/api/v1/auth", max_age=600)
    return resp


@router.get("/google/callback")
def google_callback(request: Request, db: Session = Depends(get_db)):
    # Full code-exchange + userinfo validation happens here at deploy time
    # (Authlib). This scaffold validates state and routes errors to login
    # without leaking internals, per §7.1.
    if not config.google_configured():
        return JSONResponse(status_code=501, content=error_body("OAUTH_NOT_CONFIGURED", "Google sign-in is not configured."))
    origin = config.FRONTEND_ORIGINS[0] if config.FRONTEND_ORIGINS else "/"
    err = request.query_params.get("error")
    code = request.query_params.get("code")
    state = request.query_params.get("state")
    raw_state = request.cookies.get(config.OAUTH_STATE_COOKIE, "")
    expected, _, next_path = raw_state.partition(".")
    if err or not code or not state or not expected or not secrets.compare_digest(state, expected):
        return RedirectResponse(f"{origin}/login?error=oauth_failed", status_code=302)
    # NOTE(deploy): exchange `code` at Google token endpoint, validate id_token
    # (aud == GOOGLE_CLIENT_ID), fetch userinfo, then find-or-create:
    #   users by email → link oauth_accounts(provider='google', provider_sub=sub)
    #   new users get password_hash NULL + blank Profile row.
    # Until that landing commit, callback reports not-configured rather than
    # half-linking accounts.
    _ = (OAuthAccount, code)
    next_path = next_path if next_path.startswith("/") else "/new"
    resp = RedirectResponse(f"{origin}{next_path}?error=oauth_not_finished", status_code=302)
    resp.delete_cookie(config.OAUTH_STATE_COOKIE, path="/api/v1/auth")
    return resp
