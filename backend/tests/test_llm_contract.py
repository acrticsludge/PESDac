"""LLM BYOK contract (spec llm-byok-settings §4/§7).

Self-contained app fixture (imitates conftest, adds a per-token user
override for isolation proof). DAMP by intent — stands alone.

OpenRouter is stubbed at the router boundary
(`_validate_openrouter_key`): no network in tests. Fernet key is
minted per-test; the real env value is never read.
"""

from __future__ import annotations

import uuid

import pytest
from cryptography.fernet import Fernet
from fastapi import Depends, Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
import app.routers.llm as llm_router
from app import config, rate_limit
from app.db import Base, get_db
from app.deps import get_current_user
from app.main import create_app
from app.models.catalog import SUBJECT_SEEDS, Subject
from app.models.users import User


@pytest.fixture()
def pair(monkeypatch):
    monkeypatch.setattr(config, "LLM_KEY_ENCRYPTION_KEY",
                        Fernet.generate_key().decode("utf-8"))
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(
        bind=engine, autoflush=False, expire_on_commit=False
    )
    db = TestingSession()
    for code, name in SUBJECT_SEEDS:
        db.add(Subject(code=code, display_name=name))
    db.commit()
    db.close()
    rate_limit.reset()

    def _override_db():
        session = TestingSession()
        try:
            yield session
        finally:
            session.close()

    def _override_user(request: Request, db: Session = Depends(get_db)):
        token = (request.headers.get("authorization") or "").replace("Bearer ", "").strip()
        sub = token or "user-a"
        user = db.query(User).filter(User.auth_user_id == sub).first()
        if not user:
            user = User(id=uuid.uuid4(), auth_user_id=sub,
                        email=f"{sub}@example.com", display_name=sub)
            db.add(user)
            db.commit()
            db.refresh(user)
        return user

    app = create_app(validate=False)
    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = _override_user
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()


def _h(who: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {who}"}


def _valid(monkeypatch):
    monkeypatch.setattr(llm_router, "_validate_openrouter_key",
                        lambda key: "valid")


def _invalid(monkeypatch):
    monkeypatch.setattr(llm_router, "_validate_openrouter_key",
                        lambda key: "invalid")


def test_status_empty(pair):
    r = pair.get("/api/v1/llm/status", headers=_h("user-a"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["configured"] is False
    assert "apiKey" not in body and "key" not in body


def test_put_invalid_key_rejected_nothing_stored(pair, monkeypatch):
    _invalid(monkeypatch)
    r = pair.put("/api/v1/llm/key", headers=_h("user-a"), json={
        "provider": "openrouter", "apiKey": "sk-or-v1-bogus", "model": "openai/gpt-4o-mini",
    })
    assert r.status_code == 400, r.text
    assert r.json()["error"]["code"] == "LLM_KEY_INVALID"
    assert pair.get("/api/v1/llm/status", headers=_h("user-a")).json()["configured"] is False


def test_put_valid_key_status_shows_hint_never_key(pair, monkeypatch):
    _valid(monkeypatch)
    raw = "sk-or-v1-abcdefghijklmnop"
    r = pair.put("/api/v1/llm/key", headers=_h("user-a"), json={
        "provider": "openrouter", "apiKey": raw, "model": "openai/gpt-4o-mini",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["configured"] is True
    assert body["keyHint"] == "mnop"
    assert body["model"] == "openai/gpt-4o-mini"
    assert raw not in r.text


def test_put_oversize_key_rejected_without_outbound_call(pair, monkeypatch):
    called: list[str] = []
    monkeypatch.setattr(llm_router, "_validate_openrouter_key",
                        lambda key: called.append(key) or "valid")
    r = pair.put("/api/v1/llm/key", headers=_h("user-a"), json={
        "provider": "openrouter", "apiKey": "x" * 501, "model": "m",
    })
    assert r.status_code in (400, 422), r.text
    assert called == []


def test_put_unknown_provider_rejected(pair, monkeypatch):
    _valid(monkeypatch)
    r = pair.put("/api/v1/llm/key", headers=_h("user-a"), json={
        "provider": "anthropic", "apiKey": "sk-ant-x", "model": "m",
    })
    assert r.status_code in (400, 422), r.text


def test_delete_idempotent(pair, monkeypatch):
    _valid(monkeypatch)
    pair.put("/api/v1/llm/key", headers=_h("user-a"), json={
        "provider": "openrouter", "apiKey": "sk-or-v1-abcdefghijklmnop", "model": "m",
    })
    assert pair.delete("/api/v1/llm/key", headers=_h("user-a")).status_code == 204
    assert pair.delete("/api/v1/llm/key", headers=_h("user-a")).status_code == 204
    assert pair.get("/api/v1/llm/status", headers=_h("user-a")).json()["configured"] is False


def test_per_user_isolation(pair, monkeypatch):
    _valid(monkeypatch)
    pair.put("/api/v1/llm/key", headers=_h("user-a"), json={
        "provider": "openrouter", "apiKey": "sk-or-v1-aaaaaaaaaaaaaaaa", "model": "m",
    })
    # B sees nothing of A's key and can save their own.
    assert pair.get("/api/v1/llm/status", headers=_h("user-b")).json()["configured"] is False
    pair.put("/api/v1/llm/key", headers=_h("user-b"), json={
        "provider": "openrouter", "apiKey": "sk-or-v1-bbbbbbbbbbbbbbbb", "model": "m",
    })
    assert pair.get("/api/v1/llm/status", headers=_h("user-a")).json()["keyHint"] == "aaaa"
    # B's delete leaves A intact.
    assert pair.delete("/api/v1/llm/key", headers=_h("user-b")).status_code == 204
    assert pair.get("/api/v1/llm/status", headers=_h("user-a")).json()["configured"] is True


def test_crypto_unset_degraded_503(pair, monkeypatch):
    monkeypatch.setattr(config, "LLM_KEY_ENCRYPTION_KEY", None)
    _valid(monkeypatch)
    r = pair.put("/api/v1/llm/key", headers=_h("user-a"), json={
        "provider": "openrouter", "apiKey": "sk-or-v1-x", "model": "m",
    })
    assert r.status_code == 503, r.text
    assert r.json()["error"]["code"] == "LLM_CRYPTO_UNAVAILABLE"


def test_unreachable_provider_502_nothing_stored(pair, monkeypatch):
    monkeypatch.setattr(llm_router, "_validate_openrouter_key",
                        lambda key: "unreachable")
    r = pair.put("/api/v1/llm/key", headers=_h("user-a"), json={
        "provider": "openrouter", "apiKey": "sk-or-v1-x", "model": "m",
    })
    assert r.status_code == 502, r.text
    assert pair.get("/api/v1/llm/status", headers=_h("user-a")).json()["configured"] is False


def test_profile_envelope_carries_no_key_fields(pair, monkeypatch):
    _valid(monkeypatch)
    pair.put("/api/v1/llm/key", headers=_h("user-a"), json={
        "provider": "openrouter", "apiKey": "sk-or-v1-abcdefghijklmnop", "model": "m",
    })
    body = pair.get("/api/v1/profiles/me", headers=_h("user-a")).json()
    assert "apiKey" not in body and "llm" not in " ".join(body.keys()).lower()
    for value in body.values():
        assert "sk-or-v1-abcdefghijklmnop" != value
