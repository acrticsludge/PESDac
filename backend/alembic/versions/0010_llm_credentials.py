"""0010 LLM BYOK credentials table (spec llm-byok-settings §4.1).

New `llm_credentials`: one row per (user, provider). Stores only the
Fernet-encrypted key plus a last-4 hint — the raw key never lands in
any response or log. Account delete cascades (ORM + DB). Reversible.

Chain: applies after `0009_shortcut_find` (current head).

Run with the DIRECT url (DATABASE_URL, unpooled), never pooled.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0010_llm_credentials"
down_revision = "0009_shortcut_find"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "llm_credentials",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("provider", sa.String(32), nullable=False,
                  server_default="openrouter"),
        sa.Column("key_encrypted", sa.Text(), nullable=False),
        sa.Column("key_hint", sa.String(4), nullable=False,
                  server_default=""),
        sa.Column("model", sa.String(120), nullable=False,
                  server_default="openai/gpt-4o-mini"),
        sa.Column("validated_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("now()")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.UniqueConstraint("user_id", "provider",
                            name="uq_llm_credentials_user_provider"),
    )
    op.create_index("ix_llm_credentials_user_id", "llm_credentials",
                    ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_llm_credentials_user_id", table_name="llm_credentials")
    op.drop_table("llm_credentials")
