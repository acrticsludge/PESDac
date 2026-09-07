"""Unit contract: codegen, titles, email."""

import re

from app import security


def test_chat_codes_are_valid_and_never_reserved():
    seen = set()
    for _ in range(500):
        code = security.gen_chat_code()
        assert re.fullmatch(r"[a-z0-9]{6}", code)
        assert code not in security.RESERVED_CODES
        seen.add(code)
    assert len(seen) > 400  # randomness sanity


def test_clean_title_mirrors_session_rules():
    assert security.clean_title("  OSI model  ") == "OSI model"
    assert security.clean_title("x" * 100) is not None
    assert len(security.clean_title("x" * 100)) == 34
    assert security.clean_title("   ") is None
    assert security.clean_title("@slides   ") == "@slides"


def test_email_normalize_and_validate():
    assert security.normalize_email("  YOU@Example.COM ") == "you@example.com"
    assert security.valid_email("you@example.com")
    assert not security.valid_email("not-an-email")
    assert not security.valid_email("a@b")
