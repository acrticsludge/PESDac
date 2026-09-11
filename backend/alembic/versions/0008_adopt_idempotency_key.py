"""0008 adopt idempotency key (caching Phase 5, spec §5 Fix 5 + §10.2).

Adds nullable `chats.client_adopt_key` with per-user unique constraint
`uq_chats_user_adopt_key`. NULL keys (ordinary creates) never conflict —
only keyed adopt rows participate in conflict-200. Reversible.

Run with the DIRECT url (DATABASE_URL_UNPOOLED), never pooled.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0008_adopt_idempotency_key"
down_revision = "0007_chat_preview_counts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "chats",
        sa.Column("client_adopt_key", sa.String(64), nullable=True),
    )
    op.create_unique_constraint(
        "uq_chats_user_adopt_key",
        "chats",
        ["user_id", "client_adopt_key"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_chats_user_adopt_key", "chats", type_="unique")
    op.drop_column("chats", "client_adopt_key")
