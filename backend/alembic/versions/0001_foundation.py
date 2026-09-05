"""0001 foundation: extensions, users, tokens, subjects, profiles, chats, demo_state.

PG-idiomatic DDL per arch doc §5 (citext attempt with text+lower() fallback,
text[] for profile subjects, vector extension with no vector columns yet).
Downgrade drops everything in reverse order. Reserved names NOT created here
(messages, turn_feedback, uploads, documents, chunks, embeddings) belong to
the deferred messages/RAG specs.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001_foundation"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    try:
        op.execute('CREATE EXTENSION IF NOT EXISTS citext')
        email_type: sa.types.TypeEngine = postgresql.CITEXT()
    except Exception:
        email_type = sa.Text()  # fallback: case-insensitive unique index below

    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("email", email_type, nullable=False, unique=True),
        sa.Column("password_hash", sa.Text(), nullable=True),
        sa.Column("display_name", sa.String(80), nullable=False, server_default=""),
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("email ~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'", name="users_email_format"),
    )
    if not isinstance(email_type, postgresql.CITEXT):
        op.create_index("ix_users_email_lower", "users", [sa.text("lower(email)")], unique=True)

    op.create_table(
        "oauth_accounts",
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.Text(), nullable=False, server_default="google", primary_key=True),
        sa.Column("provider_sub", sa.Text(), nullable=False, primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("user_id", "provider", name="uq_oauth_user_provider"),
    )
    op.create_table(
        "refresh_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_refresh_tokens_user_active", "refresh_tokens", ["user_id"],
                    postgresql_where=sa.text("revoked_at IS NULL"))
    op.create_table(
        "password_reset_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_table(
        "subjects",
        sa.Column("code", sa.Text(), primary_key=True),
        sa.Column("display_name", sa.Text(), nullable=False),
    )
    op.bulk_insert(
        sa.table("subjects", sa.column("code"), sa.column("display_name")),
        [
            {"code": "CN", "display_name": "Computer Networks"},
            {"code": "OS", "display_name": "Operating Systems"},
            {"code": "DLCD", "display_name": "Digital Logic"},
            {"code": "DSA", "display_name": "Data Structures"},
            {"code": "Math", "display_name": "Mathematics"},
        ],
    )
    op.create_table(
        "profiles",
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("display_name", sa.String(80), nullable=False, server_default=""),
        sa.Column("email", sa.String(254), nullable=False, server_default=""),
        sa.Column("institution", sa.String(120), nullable=False, server_default=""),
        sa.Column("semester", sa.String(8), nullable=False, server_default=""),
        sa.Column("branch", sa.String(16), nullable=False, server_default=""),
        sa.Column("subjects", postgresql.ARRAY(sa.Text()), nullable=False, server_default="{}"),
        sa.Column("exam_month", sa.String(120), nullable=False, server_default=""),
        sa.Column("weekly_goal", sa.String(16), nullable=False, server_default="5 days"),
        sa.Column("difficulty", sa.String(16), nullable=False, server_default="medium"),
        sa.Column("depth", sa.String(16), nullable=False, server_default="auto"),
        sa.Column("verbosity", sa.String(16), nullable=False, server_default="balanced"),
        sa.Column("proactive_quiz", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("follow_ups", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("citations", sa.String(16), nullable=False, server_default="on request"),
        sa.Column("retention", sa.String(16), nullable=False, server_default="forever"),
        sa.Column("language", sa.String(16), nullable=False, server_default="en-US"),
        sa.Column("region", sa.String(16), nullable=False, server_default="IN"),
        sa.Column("timezone", sa.String(16), nullable=False, server_default="IST"),
        sa.Column("shortcut_new_chat", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("shortcut_cancel", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("shortcut_focus", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("weekly_goal IN ('3 days','5 days','7 days')", name="profiles_weekly_goal"),
        sa.CheckConstraint("difficulty IN ('easy','medium','hard')", name="profiles_difficulty"),
        sa.CheckConstraint("depth IN ('auto','ask','deep')", name="profiles_depth"),
        sa.CheckConstraint("verbosity IN ('concise','balanced','thorough')", name="profiles_verbosity"),
        sa.CheckConstraint("citations IN ('always','on request')", name="profiles_citations"),
        sa.CheckConstraint("retention IN ('forever','1 year','30 days','session')", name="profiles_retention"),
    )
    op.create_table(
        "chats",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("code", sa.Text(), nullable=False, unique=True),
        sa.Column("subject", sa.Text(), sa.ForeignKey("subjects.code"), nullable=False),
        sa.Column("title", sa.String(34), nullable=False),
        sa.Column("is_pinned", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("code ~ '^[a-z0-9]{6}$'", name="chats_code_format"),
        sa.CheckConstraint("char_length(title) BETWEEN 1 AND 34", name="chats_title_len"),
    )
    op.create_index("ix_chats_user_list", "chats", ["user_id", "is_archived", "is_pinned", "updated_at"])
    op.create_table(
        "demo_state",
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("demo_label", sa.Text(), primary_key=True),
        sa.Column("display_title", sa.String(34), nullable=True),
        sa.Column("is_hidden", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_pinned", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )


def downgrade() -> None:
    op.drop_table("demo_state")
    op.drop_index("ix_chats_user_list", table_name="chats")
    op.drop_table("chats")
    op.drop_table("profiles")
    op.execute("DELETE FROM subjects")
    op.drop_table("subjects")
    op.drop_table("password_reset_tokens")
    op.drop_index("ix_refresh_tokens_user_active", table_name="refresh_tokens")
    op.drop_table("refresh_tokens")
    op.drop_table("oauth_accounts")
    op.execute("DROP INDEX IF EXISTS ix_users_email_lower")  # only exists on the non-citext fallback path
    op.drop_table("users")
