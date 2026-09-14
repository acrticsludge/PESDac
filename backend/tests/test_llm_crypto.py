"""Unit contract for app/llm_crypto.py (spec llm-byok-settings §4).

No new test deps. Fernet keys minted in-test; the real env value is
never read (monkeypatched) and never asserted on.
"""

from __future__ import annotations

import pytest
from cryptography.fernet import Fernet

from app import config
from app import llm_crypto


@pytest.fixture()
def env_key(monkeypatch):
    key = Fernet.generate_key().decode("utf-8")
    monkeypatch.setattr(config, "LLM_KEY_ENCRYPTION_KEY", key)
    return key


def test_round_trip(env_key):
    token = llm_crypto.encrypt("sk-or-v1-secret-value")
    assert token != "sk-or-v1-secret-value"
    assert "sk-or-v1-secret-value" not in token
    assert llm_crypto.decrypt(token) == "sk-or-v1-secret-value"


def test_wrong_key_fails_closed(env_key):
    token = llm_crypto.encrypt("sk-or-v1-secret-value")
    other = Fernet.generate_key().decode("utf-8")
    monkeypatch_other = pytest.MonkeyPatch()
    monkeypatch_other.setattr(config, "LLM_KEY_ENCRYPTION_KEY", other)
    try:
        with pytest.raises(llm_crypto.LlmCryptoError):
            llm_crypto.decrypt(token)
    finally:
        monkeypatch_other.undo()


def test_tampered_token_fails_closed(env_key):
    token = llm_crypto.encrypt("sk-or-v1-secret-value")
    with pytest.raises(llm_crypto.LlmCryptoError):
        llm_crypto.decrypt(token[:-4] + "AAAA")


def test_missing_env_key_fails_closed(monkeypatch):
    monkeypatch.setattr(config, "LLM_KEY_ENCRYPTION_KEY", None)
    with pytest.raises(llm_crypto.LlmCryptoError):
        llm_crypto.encrypt("sk-or-v1-x")
    with pytest.raises(llm_crypto.LlmCryptoError):
        llm_crypto.decrypt("anything")


def test_empty_inputs_rejected(env_key):
    with pytest.raises(llm_crypto.LlmCryptoError):
        llm_crypto.encrypt("")
    with pytest.raises(llm_crypto.LlmCryptoError):
        llm_crypto.decrypt("")


def test_error_messages_carry_no_secrets(env_key, monkeypatch):
    secret = "sk-or-v1-ultra-secret-abcdef"
    token = llm_crypto.encrypt(secret)
    monkeypatch.setattr(config, "LLM_KEY_ENCRYPTION_KEY",
                        Fernet.generate_key().decode("utf-8"))
    try:
        llm_crypto.decrypt(token)
        raise AssertionError("should have raised")
    except llm_crypto.LlmCryptoError as exc:
        assert secret not in str(exc)
        assert token not in str(exc)
