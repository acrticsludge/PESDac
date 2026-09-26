"""0011 rename Math -> MFADS (Maths for AI and Data Science).

Curator decision: the 5 seeded subjects stay fixed, but the `Math` code
becomes `MFADS`. Migrates existing rows so no chat/profile orphans:
`chats.subject` FK values move first (MFADS row inserted before the
update), then `profiles.subjects` JSONB arrays swap the element, then
the old `Math` row is removed. Reversible.

Chain: applies after `0010_llm_credentials` (current head).

Run with the DIRECT url (DATABASE_URL, unpooled), never pooled.
"""

from __future__ import annotations

from alembic import op


revision = "0011_rename_math_mfads"
down_revision = "0010_llm_credentials"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. New catalog row first — chats.subject FK requires the target.
    op.execute(
        "INSERT INTO subjects (code, display_name) "
        "VALUES ('MFADS', 'Maths for AI and Data Science') "
        "ON CONFLICT (code) DO NOTHING"
    )
    # 2. Move existing chats (no-op on fresh deploys).
    op.execute(
        "UPDATE chats SET subject = 'MFADS' WHERE subject = 'Math'"
    )
    # 3. Swap the element inside profiles.subjects JSONB arrays.
    op.execute(
        "UPDATE profiles SET subjects = ("
        "SELECT jsonb_agg(CASE WHEN v = 'Math' THEN 'MFADS' ELSE v END) "
        "FROM jsonb_array_elements_text(subjects) AS v) "
        "WHERE subjects ? 'Math'"
    )
    # 4. Remove the old code last (FK rows already moved).
    op.execute("DELETE FROM subjects WHERE code = 'Math'")


def downgrade() -> None:
    op.execute(
        "INSERT INTO subjects (code, display_name) "
        "VALUES ('Math', 'Mathematics') "
        "ON CONFLICT (code) DO NOTHING"
    )
    op.execute(
        "UPDATE chats SET subject = 'Math' WHERE subject = 'MFADS'"
    )
    op.execute(
        "UPDATE profiles SET subjects = ("
        "SELECT jsonb_agg(CASE WHEN v = 'MFADS' THEN 'Math' ELSE v END) "
        "FROM jsonb_array_elements_text(subjects) AS v) "
        "WHERE subjects ? 'MFADS'"
    )
    op.execute("DELETE FROM subjects WHERE code = 'MFADS'")
