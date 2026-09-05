"""Import all models so Base.metadata is complete (create_all, Alembic autogenerate)."""

from app.models.users import User, OAuthAccount, RefreshToken, PasswordResetToken  # noqa: F401
from app.models.catalog import Subject  # noqa: F401
from app.models.profiles import Profile  # noqa: F401
from app.models.chats import Chat, DemoState  # noqa: F401
