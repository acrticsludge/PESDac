"""Auth schemas (BetterAuth migration placeholder).

Our API only shapes the /me response.
"""

from __future__ import annotations

from pydantic import BaseModel


class UserOut(BaseModel):
    id: str
    email: str
    displayName: str
    onboardingDone: bool = False
