"""0007 chat preview/counts + lean-list indexes (chat-history-lean-storage FR2).

Adds `chats.preview` (<=280-char latest-turn snippet), `chats.msg_count`,
`chats.last_seq` with a nullable -> backfill -> NOT NULL deploy for
`preview` (counts carry a server default so existing rows fill on add).
Backfills once from `messages`; going forward routers/chats.py maintains
all three in the same txn that touches `updated_at` on append/truncate.

Indexes: supersedes 0001's `ix_chats_user_list` with the spec-named
`ix_chats_user_updated (user_id, is_archived, is_pinned DESC,
updated_at DESC)` + `pg_trgm` `ix_chats_title_trgm` for `q` search.
Prod note: prefer `CONCURRENTLY` index builds on a live deploy (this
migration builds inline — safe on branch deploys and small tables;
for prod use CREATE INDEX CONCURRENTLY out-of-band, then stamp).
Reversible (downgrade drops indexes + columns, restores the 0001 index).

Run with the DIRECT url (DATABASE_URL_UNPOOLED), never pooled.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0007_chat_preview_counts"
down_revision = "0006_messages"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Nullable-safe column add (preview nullable first; counts default 0).
    op.add_column("chats", sa.Column("preview", sa.Text(), nullable=True))
    op.add_column(
        "chats",
        sa.Column("msg_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "chats",
        sa.Column("last_seq", sa.Integer(), nullable=False, server_default="0"),
    )

    # 2. One-time backfill from messages (counts + current max seq; preview
    # is the latest turn's serialized payload truncated to 280 chars —
    # render-only keys are stripped client-side going forward per FR1, so
    # old rows keep a best-effort snippet, never NULL after step 3).
    op.execute(
        """
        UPDATE chats c SET
            msg_count = COALESCE((SELECT count(*) FROM messages m WHERE m.chat_id = c.id), 0),
            last_seq = COALESCE((SELECT max(seq) FROM messages m WHERE m.chat_id = c.id), 0)
        """
    )
    op.execute(
        """
        UPDATE chats c SET preview = LEFT((
            SELECT m.content::text FROM messages m
            WHERE m.chat_id = c.id ORDER BY m.seq DESC LIMIT 1
        ), 280)
        WHERE EXISTS (SELECT 1 FROM messages m WHERE m.chat_id = c.id)
        """
    )
    op.execute("UPDATE chats SET preview = '' WHERE preview IS NULL")
    op.alter_column("chats", "preview", existing_type=sa.Text(), nullable=False)

    # 3. Lean-list indexes. `ix_chats_user_list` (0001) covers the same key
    # prefix — supersede it with the DESC-ordered spec name so EXPLAIN
    # shows one canonical list index.
    op.drop_index("ix_chats_user_list", table_name="chats")
    op.execute(
        "CREATE INDEX ix_chats_user_updated "
        "ON chats (user_id, is_archived, is_pinned DESC, updated_at DESC)"
    )
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute(
        "CREATE INDEX ix_chats_title_trgm ON chats USING gin (title gin_trgm_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_chats_title_trgm")
    op.execute("DROP INDEX IF EXISTS ix_chats_user_updated")
    op.create_index("ix_chats_user_list", "chats", ["user_id", "is_archived", "is_pinned", "updated_at"])
    op.drop_column("chats", "last_seq")
    op.drop_column("chats", "msg_count")
    op.drop_column("chats", "preview")
