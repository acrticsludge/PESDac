"""Phase 5 T5a message idempotency key (mirrors 0008 adopt-key precedent).

Adds nullable `messages.client_msg_key` with per-chat unique constraint
`uq_messages_chat_client_key`. NULL keys (appends without a key) never
conflict — only keyed retries participate in conflict-200. Reversible.

Rebase note: this migration was authored against `0008_adopt_idempotency_key`.
After P4 merges, re-point `down_revision` onto `20260912_perf_indexes`
(P4's head) before merging — upgrade/downgrade re-verified after the move.

Run with the DIRECT url (DATABASE_URL_UNPOOLED), never pooled.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260912_msg_client_key"
down_revision = "0008_adopt_idempotency_key"
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
