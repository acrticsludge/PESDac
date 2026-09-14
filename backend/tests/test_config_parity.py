"""Config parity (audit §19 item 2): prod refuses to boot loud, test
bypass is explicit, local files never override real env, and failure
messages name categories — never secret values."""

from __future__ import annotations

import pytest

from app import config


@pytest.fixture()
def prod_env(monkeypatch):
    """A complete, valid prod config; tests delete/break one piece."""
    monkeypatch.setattr(config, "ENV", "prod")
    monkeypatch.setattr(config, "DATABASE_URL", "postgresql://db/x")
    monkeypatch.setattr(config, "DATABASE_URL_POOLED", None)
    monkeypatch.setattr(config, "BETTER_AUTH_URL", "https://auth.example.com")
    monkeypatch.setattr(config, "BETTER_AUTH_SECRET", "s" * 32)
    monkeypatch.setattr(config, "FRONTEND_ORIGINS", ["https://app.example.com"])
    monkeypatch.setattr(config, "COOKIE_SECURE", True)
    monkeypatch.setattr(config, "LLM_KEY_ENCRYPTION_KEY", "k" * 32)


def test_valid_prod_boots(prod_env):
    config.validate_startup(require_db=True)


def test_prod_refuses_each_missing_piece(prod_env, monkeypatch):
    cases = {
        "DATABASE_URL": None,
        "BETTER_AUTH_URL": None,
        "BETTER_AUTH_SECRET": None,
        "LLM_KEY_ENCRYPTION_KEY": None,
    }
    for name in cases:
        monkeypatch.setattr(config, name, None)
        with pytest.raises(RuntimeError):
            config.validate_startup(require_db=True)
        monkeypatch.setattr(
            config,
            name,
            "x" * 32 if "SECRET" in name or "KEY" in name else "https://app.example.com"
            if name == "BETTER_AUTH_URL"
            else "postgresql://db/x",
        )


def test_prod_rejects_short_secret_without_type_error(prod_env, monkeypatch):
    # The old code path raised TypeError on a missing secret (len(None));
    # missing AND short both surface as clean RuntimeErrors.
    monkeypatch.setattr(config, "BETTER_AUTH_SECRET", None)
    with pytest.raises(RuntimeError, match="BETTER_AUTH_SECRET is required"):
        config.validate_startup(require_db=True)
    monkeypatch.setattr(config, "BETTER_AUTH_SECRET", "short")
    with pytest.raises(RuntimeError, match="at least 32 characters"):
        config.validate_startup(require_db=True)


def test_prod_requires_https_origins_and_secure_cookies(prod_env, monkeypatch):
    monkeypatch.setattr(config, "FRONTEND_ORIGINS", ["http://app.example.com"])
    with pytest.raises(RuntimeError, match="must be https"):
        config.validate_startup(require_db=True)
    monkeypatch.setattr(config, "FRONTEND_ORIGINS", ["https://app.example.com"])
    monkeypatch.setattr(config, "COOKIE_SECURE", False)
    with pytest.raises(RuntimeError, match="COOKIE_SECURE=true is required"):
        config.validate_startup(require_db=True)


def test_insecure_cookie_with_https_forbidden_everywhere(prod_env, monkeypatch):
    monkeypatch.setattr(config, "ENV", "dev")
    monkeypatch.setattr(config, "COOKIE_SECURE", False)
    with pytest.raises(RuntimeError, match="COOKIE_SECURE=false with https"):
        config.validate_startup(require_db=True)


def test_bad_env_rejected(prod_env, monkeypatch):
    monkeypatch.setattr(config, "ENV", "bogus")
    with pytest.raises(RuntimeError, match="ENV must be one of"):
        config.validate_startup(require_db=True)


def test_failure_messages_never_carry_secret_values(prod_env, monkeypatch):
    # Distinctive values that must never surface: a bad secret (short)
    # plus a valid-but-unique URL (proves even passing values are not
    # echoed). The message carries category names only.
    probe_host = "leak-probe-xyz-123.example.com"
    monkeypatch.setattr(config, "BETTER_AUTH_SECRET", "x")
    monkeypatch.setattr(config, "BETTER_AUTH_URL", f"https://{probe_host}")
    monkeypatch.setattr(config, "LLM_KEY_ENCRYPTION_KEY", None)
    with pytest.raises(RuntimeError) as exc:
        config.validate_startup(require_db=True)
    message = str(exc.value)
    assert probe_host not in message
    assert "BETTER_AUTH_SECRET" in message
    assert "LLM_KEY_ENCRYPTION_KEY" in message


def test_test_mode_bypass_is_explicit(monkeypatch):
    # require_db=False skips the DB check only — auth/origin rules still
    # apply. There is no blanket "skip everything" flag.
    monkeypatch.setattr(config, "DATABASE_URL", None)
    monkeypatch.setattr(config, "DATABASE_URL_POOLED", None)
    monkeypatch.setattr(config, "ENV", "test")
    monkeypatch.setattr(config, "BETTER_AUTH_URL", "http://localhost:4321")
    monkeypatch.setattr(config, "BETTER_AUTH_SECRET", "t" * 32)
    monkeypatch.setattr(config, "FRONTEND_ORIGINS", ["http://localhost:4321"])
    config.validate_startup(require_db=False)
    with pytest.raises(RuntimeError, match="DATABASE_URL is required"):
        config.validate_startup(require_db=True)


def test_dotenv_fills_gaps_but_never_overrides_real_env(tmp_path, monkeypatch):
    dotenv = tmp_path / ".env"
    dotenv.write_text(
        "FILL_ME=from-file\n"
        "WINNER=from-file\n"
        "# a comment\n"
        "export EXPORTED=yes\n"
        'QUOTED="spaced value"\n'
        "EMPTY=\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("WINNER", "from-env")
    monkeypatch.delenv("FILL_ME", raising=False)
    monkeypatch.delenv("EXPORTED", raising=False)
    monkeypatch.delenv("QUOTED", raising=False)
    config._load_dotenv(dotenv)
    import os

    assert os.environ["FILL_ME"] == "from-file"
    assert os.environ["WINNER"] == "from-env"
    assert os.environ["EXPORTED"] == "yes"
    assert os.environ["QUOTED"] == "spaced value"
    assert "EMPTY" not in os.environ
    for key in ("FILL_ME", "WINNER", "EXPORTED", "QUOTED"):
        monkeypatch.delenv(key, raising=False)
