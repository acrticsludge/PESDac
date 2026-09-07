"""Auth schemas (BetterAuth migration).

Our API shapes the /me response and the link-password request body.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class UserOut(BaseModel):
    id: str
    email: str
    displayName: str
    onboardingDone: bool = False


# Mirrors the BetterAuth server config (lib/auth.ts):
# emailAndPassword.minPasswordLength=8, maxPasswordLength=128. The frontend
# enforces the same limits, so drift only costs a 422, never a bad write.
class LinkPasswordIn(BaseModel):
    newPassword: str = Field(min_length=8, max_length=128)
