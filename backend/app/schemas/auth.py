"""Auth schemas (v6 — Neon Auth).

The v5 signup/login/password/reset schemas are gone. Auth is Neon-owned;
our API only verifies the JWT and shapes the /me response.
"""

from __future__ import annotations

from pydantic import BaseModel


class UserOut(BaseModel):
    id: str
    email: str
    displayName: str
    onboardingDone: bool = False
