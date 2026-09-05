"""0003 neon_auth_link — our `users` table keyed by Neon user id.

`neon_user_id` is the verified `sub` claim from the Neon access_token
JWT (Ed25519). Unique not null. Email + display_name are pulled from
the verified claims at first /me and never re-trusted from the client
after that. The cascading FK from profiles.user_id is preserved by
recreating the fk against this new table.

Reversible. Downgrade drops the table (the foreign keys from
`profiles.user_id` and `chats.user_id` are removed first).
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0003_neon_auth_link"
down_revision = "0002_campus_onboarding"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # v5 → v6: the v5 users table held password_hash / email / etc.
    # Neon Auth now owns identity, so we drop it along with the v5
    # auth-side tables and create a minimal users table keyed by
    # the Neon JWT `sub` claim.
    op.execute("DROP TABLE IF EXISTS password_reset_tokens CASCADE")
    op.execute("DROP TABLE IF EXISTS refresh_tokens CASCADE")
    op.execute("DROP TABLE IF EXISTS oauth_accounts CASCADE")
    # profiles and chats reference users; drop and re-add the FK after
    # the new users table exists. (Use CASCADE to break the FK cleanly.)
    op.execute("ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_user_id_fkey")
    op.execute("ALTER TABLE chats DROP CONSTRAINT IF EXISTS chats_user_id_fkey")
    op.execute("DROP TABLE IF EXISTS users CASCADE")
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("neon_user_id", sa.Text(), nullable=False, unique=True),
        sa.Column("email", sa.String(254), nullable=False),
        sa.Column("display_name", sa.String(80), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_users_neon_user_id", "users", ["neon_user_id"], unique=True)
    # Re-add the FKs from the existing profiles + chats tables.
    op.execute(
        "ALTER TABLE profiles ADD CONSTRAINT profiles_user_id_fkey "
        "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"
    )
    op.execute(
        "ALTER TABLE chats ADD CONSTRAINT chats_user_id_fkey "
        "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE chats DROP CONSTRAINT IF EXISTS chats_user_id_fkey")
    op.execute("ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_user_id_fkey")
    op.drop_index("ix_users_neon_user_id", table_name="users")
    op.drop_table("users")
