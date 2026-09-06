"""0002 v6 — Campus selector + onboarding flag.

Adds `profiles.campus` (constrained to '', 'RR', 'EC') and
`profiles.onboarding_done`. The v5 auth columns/tables that Neon Auth
now owns are dropped later in 0003. Reversible.
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
