"""Phase 4 (T4d) endpoint H-fix indexes (api-latency-outbox spec §4).

Adds btree indexes for the ownership lookup, the export sort, the
purge window scan, and the subject filter:

- `ix_chats_user_code ON chats (user_id, code)` — `_get_owned`.
- `ix_chats_user_created ON chats (user_id, created_at)` — export sort.
- `ix_profiles_retention ON profiles (retention)` — purge window scan.
- `ix_chats_user_subject ON chats (user_id, subject)` — `?subject=` filter.

Trigram-GIN drift note: migration 0007 already created
`ix_chats_title_trgm ... USING gin (title gin_trgm_ops)`; this migration
does NOT recreate it — models now declare the same index (GIN/trgm
options render on Postgres only) so metadata matches the migration.
Reversible.

Run with the DIRECT url (DATABASE_URL_UNPOOLED), never pooled.
"""

from __future__ import annotations

from alembic import op

revision = "20260912_perf_indexes"
down_revision = "0008_adopt_idempotency_key"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_chats_user_code", "chats", ["user_id", "code"])
    op.create_index("ix_chats_user_created", "chats", ["user_id", "created_at"])
    op.create_index("ix_profiles_retention", "profiles", ["retention"])
    op.create_index("ix_chats_user_subject", "chats", ["user_id", "subject"])


def downgrade() -> None:
    op.drop_index("ix_chats_user_subject", table_name="chats")
    op.drop_index("ix_profiles_retention", table_name="profiles")
    op.drop_index("ix_chats_user_created", table_name="chats")
    op.drop_index("ix_chats_user_code", table_name="chats")
