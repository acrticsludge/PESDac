"""Unit contract: codegen, titles, email, passwords, JWT, refresh hashing."""

from __future__ import annotations

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


def test_password_roundtrip_and_wrong_reject():
    stored = security.hash_password("correct-horse-12345")
    assert security.verify_password("correct-horse-12345", stored)
    assert not security.verify_password("wrong-password-00000", stored)


def test_jwt_roundtrip_and_tamper():
    token = security.create_access_token("user-123")
    assert security.decode_access_token(token) == "user-123"
    assert security.decode_access_token(token + "tampered") is None
    assert security.decode_access_token("") is None


def test_refresh_token_hash_is_stable():
    token, digest = security.new_refresh_token()
    assert security.hash_token(token) == digest
    assert len(digest) == 64
