"""0004 subjects text[] -> jsonb.

0001 created profiles.subjects as text[] ("PG-idiomatic"), but the v6
model maps it as JSONB (JsonType -> JSONB on postgresql). Every profile
INSERT on live Postgres 500s with DatatypeMismatch (SQLite never caught
it — typeless affinity). Convert in place: to_jsonb(text[]) preserves
values as a JSON array ('{}' -> '[]', '{CN,OS}' -> '["CN","OS"]').
"""

revision = "0004_subjects_jsonb"
down_revision = "0003_neon_auth_link"

from alembic import op


def upgrade() -> None:
    # The 0001 server_default '{}' (text[]) cannot auto-cast to jsonb,
    # so drop it first and re-add the equivalent jsonb default after.
    op.execute("ALTER TABLE profiles ALTER COLUMN subjects DROP DEFAULT")
    op.execute(
        "ALTER TABLE profiles ALTER COLUMN subjects TYPE jsonb "
        "USING to_jsonb(subjects)"
    )
    op.execute(
        "ALTER TABLE profiles ALTER COLUMN subjects SET DEFAULT '[]'::jsonb"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE profiles ALTER COLUMN subjects DROP DEFAULT")
    op.execute(
        "ALTER TABLE profiles ALTER COLUMN subjects TYPE text[] "
        "USING (ARRAY(SELECT jsonb_array_elements_text(subjects)))"
    )
    op.execute("ALTER TABLE profiles ALTER COLUMN subjects SET DEFAULT '{}'")
