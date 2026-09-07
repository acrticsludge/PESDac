"""0005 rename neon_user_id -> auth_user_id (BetterAuth migration).

Neon Auth was removed; Neon is now database-only. The users table keeps
the external provider id, now generically named for BetterAuth.
Reversible.
"""

from __future__ import annotations

from alembic import op

revision = "0005_rename_auth_user_id"
down_revision = "0004_subjects_jsonb"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users RENAME COLUMN neon_user_id TO auth_user_id")
    op.execute("ALTER INDEX IF EXISTS ix_users_neon_user_id RENAME TO ix_users_auth_user_id")


def downgrade() -> None:
    op.execute("ALTER TABLE users RENAME COLUMN auth_user_id TO neon_user_id")
    op.execute("ALTER INDEX IF EXISTS ix_users_auth_user_id RENAME TO ix_users_neon_user_id")
