"""Auth primitives: password hashing, JWT access tokens, opaque refresh tokens,
chat-code generation. Argon2id required in prod; pbkdf2 fallback for dev/test
only when argon2-cffi is absent (never in prod — enforced at startup).
"""

from __future__ import annotations

import hashlib
import re
import secrets
import string
from datetime import datetime, timedelta, timezone

from app import config

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
CHAT_CODE_RE = re.compile(r"^[a-z0-9]{6}$")
_CODE_ALPHABET = string.ascii_lowercase + string.digits

# Demo codes reserved server-side (frontend/src/lib/chat.ts CHAT_CODES values
# plus TAKEN collisions). A generated code must never equal one of these.
RESERVED_CODES = frozenset({
    "a3k9m2", "x7k2m9", "b8l4n1", "c9m5p3", "d2n6q7", "e4p8r2", "f6q1s5",
    "g8r3t9", "h1s5u2", "j3t7v4", "k5u9w6", "l7v2x8", "m9w4y1", "n2x6z3",
    "p4y8a5", "q6z1b7", "r8a3c9", "s1b5d2", "t3c7e4", "u5d9f6",
})

try:  # argon2-cffi (prod path)
    from argon2 import PasswordHasher as _Argon2Hasher
    from argon2.exceptions import VerifyMismatchError as _Mismatch

    _argon2 = _Argon2Hasher()
    _HAS_ARGON2 = True
except Exception:  # ImportError etc. — dev/test fallback only
    _argon2 = None
    _Mismatch = Exception  # type: ignore[assignment,misc]
    _HAS_ARGON2 = False


def argon2_available() -> bool:
    return _HAS_ARGON2


def _pbkdf2_hash(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 210_000)
    return f"pbkdf2$210000${salt.hex()}${dk.hex()}"


def _pbkdf2_verify(password: str, stored: str) -> bool:
    try:
        _, iters, salt_hex, dk_hex = stored.split("$")
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salt_hex), int(iters)
        )
        return secrets.compare_digest(dk.hex(), dk_hex)
    except Exception:
        return False


def hash_password(password: str) -> str:
    if _HAS_ARGON2:
        assert _argon2 is not None
        return _argon2.hash(password)
    if config.ENV == "prod":
        raise RuntimeError("argon2-cffi is required in prod")
    return _pbkdf2_hash(password)


def verify_password(password: str, stored: str) -> bool:
    if stored.startswith("pbkdf2$"):
        return _pbkdf2_verify(password, stored)
    if not _HAS_ARGON2:
        return False
    assert _argon2 is not None
    try:
        return _argon2.verify(stored, password)
    except _Mismatch:
        return False
    except Exception:
        return False


def normalize_email(email: str) -> str:
    return email.strip().lower()


def valid_email(email: str) -> bool:
    return len(email) <= 254 and EMAIL_RE.match(email) is not None


def _jwt() -> object:
    try:
        import jwt as pyjwt  # type: ignore[import-not-found]

        return pyjwt
    except Exception as exc:
        raise RuntimeError("pyjwt is required") from exc


def create_access_token(user_id: str) -> str:
    pyjwt = _jwt()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=config.ACCESS_TTL_MIN)).timestamp()),
    }
    assert config.JWT_SECRET is not None
    return pyjwt.encode(payload, config.JWT_SECRET, algorithm="HS256")  # type: ignore[union-attr]


def decode_access_token(token: str) -> str | None:
    pyjwt = _jwt()
    assert config.JWT_SECRET is not None
    try:
        payload = pyjwt.decode(token, config.JWT_SECRET, algorithms=["HS256"])  # type: ignore[union-attr]
        sub = payload.get("sub")
        return str(sub) if sub else None
    except Exception:
        return None


def new_refresh_token() -> tuple[str, str]:
    """Return (opaque_token, sha256_hex) — only the hash is stored."""
    token = secrets.token_urlsafe(32)
    digest = hashlib.sha256(token.encode()).hexdigest()
    return token, digest


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def gen_chat_code() -> str:
    for _ in range(100):
        code = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(6))
        if code not in RESERVED_CODES:
            return code
    raise RuntimeError("Failed to generate a chat code")


def clean_title(title: str) -> str | None:
    """Trim + enforce 1..34 chars (mirrors session.ts rename/create rules)."""
    clean = title.strip()[:34].strip()
    if not clean:
        return None
    return clean
