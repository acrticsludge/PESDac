"""Auth schemas (BetterAuth migration).

Our API shapes the /me response.
"""

from __future__ import annotations

from pydantic import BaseModel


class UserOut(BaseModel):
    id: str
    email: str
    displayName: str
    onboardingDone: bool = False
