"""X-Request-ID header (spec §5 shared contracts)."""

from __future__ import annotations

import uuid


def test_every_api_response_carries_request_id(client):
    for path in ("/api/v1/health", "/api/v1/ready", "/api/openapi.json"):
        r = client.get(path)
        rid = r.headers.get("X-Request-ID")
        assert rid, path
        uuid.UUID(rid)


def test_request_ids_are_unique_per_request(client):
    seen = {
        client.get("/api/v1/health").headers["X-Request-ID"] for _ in range(3)
    }
    assert len(seen) == 3
