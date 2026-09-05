"""0002 v6 — Campus selector + onboarding flag.

Keeps the v5 onboarding/campus columns. Drops the v5 §E columns that
Neon Auth now owns (password_hash, password_changed_at,
email_verified_at, oauth_accounts, refresh_tokens, password_reset_tokens).
Reversible; downgrade restores the v5 schema exactly.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0002_campus_onboarding"
down_revision = "0001_foundation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # New columns the onboarding + Campus selector need.
    op.add_column(
        "profiles",
        sa.Column("campus", sa.String(8), nullable=False, server_default=""),
    )
    op.add_column(
        "profiles",
        sa.Column("onboarding_done", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_check_constraint(
        "profiles_campus_enum",
        "profiles",
        "campus IN ('', 'RR', 'EC')",
    )


def downgrade() -> None:
    op.drop_constraint("profiles_campus_enum", "profiles", type_="check")
    op.drop_column("profiles", "onboarding_done")
    op.drop_column("profiles", "campus")
