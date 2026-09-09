"""0006 messages table for chat turn bodies (spec §3.1).

`seq` is per-chat order, server-assigned; UNIQUE(chat_id, seq) lets
concurrent append losers retry instead of 500ing. Deleting a chat
purges its turns (FK ondelete=CASCADE, mirroring the ORM
delete-orphan on Chat.messages). Reversible.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0006_messages"
down_revision = "0005_rename_auth_user_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "messages",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "chat_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("chats.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column(
            "content",
            sa.JSON().with_variant(postgresql.JSONB(), "postgresql"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("chat_id", "seq", name="uq_messages_chat_seq"),
        sa.CheckConstraint(
            "role IN ('user','assistant','system')", name="messages_role_check"
        ),
    )
    op.create_index("ix_messages_chat_seq", "messages", ["chat_id", "seq"])


def downgrade() -> None:
    op.drop_index("ix_messages_chat_seq", table_name="messages")
    op.drop_table("messages")
