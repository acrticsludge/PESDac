"""Phase 5 T5a message idempotency key (mirrors 0008 adopt-key precedent).

Adds nullable `messages.client_msg_key` with per-chat unique constraint
`uq_messages_chat_client_key`. NULL keys (appends without a key) never
conflict — only keyed retries participate in conflict-200. Reversible.

Chain: applies after `20260912_perf_indexes` (P4's head).

Run with the DIRECT url (DATABASE_URL, unpooled), never pooled.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260912_msg_client_key"
down_revision = "20260912_perf_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("client_msg_key", sa.String(64), nullable=True),
    )
    op.create_unique_constraint(
        "uq_messages_chat_client_key",
        "messages",
        ["chat_id", "client_msg_key"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_messages_chat_client_key", "messages", type_="unique")
    op.drop_column("messages", "client_msg_key")
