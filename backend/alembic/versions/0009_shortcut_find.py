"""0009 find-in-thread shortcut toggle.

Adds `profiles.shortcut_find` (default true), mirroring the existing
`shortcut_new_chat` / `shortcut_cancel` / `shortcut_focus` columns from
0001_foundation. The frontend Shortcuts section owns the toggle; the
backend phase binds it later. Reversible.

Chain: applies after `20260912_msg_client_key` (current head).

Run with the DIRECT url (DATABASE_URL, unpooled), never pooled.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0009_shortcut_find"
down_revision = "20260912_msg_client_key"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "profiles",
        sa.Column("shortcut_find", sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    op.drop_column("profiles", "shortcut_find")
