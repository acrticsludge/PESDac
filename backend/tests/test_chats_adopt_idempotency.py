"""Adopt idempotency (caching Phase 5, spec §5 Fix 5 + §10.2 locked contract).

`clientAdoptKey`: client generates one UUID per guest chat, sent in
`POST /chats` body; server stores it with a per-user unique constraint;
on conflict returns `200` with the existing row instead of creating
a duplicate. Retry after a 2nd-leg failure therefore creates exactly
one server row.
"""

from __future__ import annotations

from fastapi.testclient import TestClient


def _create(client: TestClient, title: str, key: str | None = None):
    body: dict[str, str] = {"subject": "CN", "title": title}
    if key is not None:
        body["clientAdoptKey"] = key
    return client.post("/api/v1/chats", json=body)


def test_adopt_retry_same_key_returns_200_existing_row_zero_new_rows(client):
    first = _create(client, "Guest chat", key="11111111-1111-4111-8111-111111111111")
    assert first.status_code == 201, first.text
    first_row = first.json()

    # Retry after a 2nd-leg failure: same key → 200 with the SAME row.
    second = _create(client, "Guest chat", key="11111111-1111-4111-8111-111111111111")
    assert second.status_code == 200, second.text
    assert second.json() == first_row

    total = client.get("/api/v1/chats").json()["pagination"]["total"]
    assert total == 1


def test_adopt_conflict_200_keeps_exact_row_shape(client):
    first = _create(client, "Guest chat", key="22222222-2222-4222-8222-222222222222")
    assert first.status_code == 201, first.text
    second = _create(client, "Guest chat", key="22222222-2222-4222-8222-222222222222")
    assert second.status_code == 200, second.text
    assert set(second.json().keys()) == set(first.json().keys())


def test_adopt_distinct_keys_create_distinct_rows(client):
    a = _create(client, "Guest one", key="33333333-3333-4333-8333-333333333333")
    b = _create(client, "Guest two", key="44444444-4444-4344-8344-444444444444")
    assert a.status_code == 201, a.text
    assert b.status_code == 201, b.text
    assert a.json()["code"] != b.json()["code"]
    total = client.get("/api/v1/chats").json()["pagination"]["total"]
    assert total == 2


def test_create_without_key_unchanged_two_201s(client):
    a = _create(client, "Plain one")
    b = _create(client, "Plain two")
    assert a.status_code == 201, a.text
    assert b.status_code == 201, b.text
    assert a.json()["code"] != b.json()["code"]
