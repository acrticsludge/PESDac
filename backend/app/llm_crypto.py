"""Fernet envelope for LLM BYOK keys (spec llm-byok-settings §4).

Thin wrapper, fail-closed: every failure raises `LlmCryptoError` with
a category message (never key material, never the env value). Callers
map it to 500-ref / `configured:false` — the raw exception text never
leaves the process.
"""

from __future__ import annotations

from app import config


class LlmCryptoError(RuntimeError):
    """Typed crypto failure (missing key, bad token, undecryptable row)."""


def _fernet():
    raw = (config.LLM_KEY_ENCRYPTION_KEY or "").strip()
    if not raw:
        raise LlmCryptoError("llm_crypto_unconfigured")
    try:
        from cryptography.fernet import Fernet
        return Fernet(raw.encode("utf-8"))
    except Exception as exc:
        raise LlmCryptoError(f"llm_crypto_init_{type(exc).__name__}") from exc


def encrypt(raw_key: str) -> str:
    """Encrypt one API key. Returns the Fernet token (base64 str)."""
    if not raw_key:
        raise LlmCryptoError("llm_crypto_empty")
    try:
        return _fernet().encrypt(raw_key.encode("utf-8")).decode("utf-8")
    except LlmCryptoError:
        raise
    except Exception as exc:
        raise LlmCryptoError(f"llm_crypto_encrypt_{type(exc).__name__}") from exc


def decrypt(token: str) -> str:
    """Decrypt one Fernet token. Raises `LlmCryptoError` on any failure
    (wrong env key, tampered row, rotation orphan) — callers treat this
    as "re-enter your key", never as a crash."""
    if not token:
        raise LlmCryptoError("llm_crypto_empty")
    try:
        return _fernet().decrypt(token.encode("utf-8")).decode("utf-8")
    except LlmCryptoError:
        raise
    except Exception as exc:
        raise LlmCryptoError(f"llm_crypto_decrypt_{type(exc).__name__}") from exc
