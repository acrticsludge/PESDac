"""Security primitives (v6 — Neon Auth).

- No password hashing (Neon owns passwords).
- No JWT minting (we only verify the Neon JWT).
- No opaque refresh tokens (Neon owns sessions).
- Kept here: chat-code generation, title cleaning, and the
  email normalization/validation used by the profile PATCH.
"""

from __future__ import annotations

import re
import secrets
import string

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


def normalize_email(email: str) -> str:
    return email.strip().lower()


def valid_email(email: str) -> bool:
    return len(email) <= 254 and EMAIL_RE.match(email) is not None


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
