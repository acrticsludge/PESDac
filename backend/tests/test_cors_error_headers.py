"""CORS on error responses: exception-handler legs must carry ACAO.

Reproduced cause: with an allowlisted Origin, route-built responses
(200, route-level 404) carry `Access-Control-Allow-Origin`, but
responses built by the app exception handlers (422/500) intermittently
did not — the BaseHTTPMiddleware security-headers layer sits outside
CORSMiddleware and can drop the injected header on the exception path.
Browsers then mask the real status as a CORS failure ("No
'Access-Control-Allow-Origin' header"), hiding 500 references from the
frontend. main._cors_error_headers mirrors the middleware on every
handler leg; these tests pin it.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import create_app

ALLOWLISTED = {"Origin": "http://testserver"}
FOREIGN = {"Origin": "http://evil.example"}


def _cors_of(response):
    return {
        "allow_origin": response.headers.get("access-control-allow-origin"),
        "allow_credentials": response.headers.get("access-control-allow-credentials"),
        "vary": response.headers.get("vary"),
    }


def test_route_404_carries_allow_origin(client):
    r = client.get("/api/v1/chats/zzzzzz/messages", headers=ALLOWLISTED)
    assert r.status_code == 404, r.text
    assert _cors_of(r) == {
        "allow_origin": "http://testserver",
        "allow_credentials": "true",
        "vary": "Origin",
    }


def test_handler_500_carries_allow_origin():
    # A crashing route on the real app (same pattern as
    # test_error_logging): the generic Exception handler builds the 500.
    crashing = create_app(validate=False)

    @crashing.get("/boom")
    def boom():
        raise RuntimeError("cors-repro-boom")

    with TestClient(crashing, raise_server_exceptions=False) as c:
        r = c.get("/boom", headers=ALLOWLISTED)
    assert r.status_code == 500, r.text
    assert r.json()["error"]["code"] == "INTERNAL"
    assert "Reference:" in r.json()["error"]["message"]
    assert _cors_of(r) == {
        "allow_origin": "http://testserver",
        "allow_credentials": "true",
        "vary": "Origin",
    }


def test_handler_422_carries_allow_origin(client):
    code = client.post(
        "/api/v1/chats", json={"subject": "CN", "title": "cors"}
    ).json()["code"]
    r = client.get(
        f"/api/v1/chats/{code}/messages",
        params={"limit": 201},
        headers=ALLOWLISTED,
    )
    assert r.status_code == 422, r.text
    assert r.headers.get("access-control-allow-origin") == "http://testserver"


def test_no_origin_sends_no_cors_headers(client):
    r = client.get("/api/v1/chats/zzzzzz/messages")
    assert r.status_code == 404, r.text
    assert r.headers.get("access-control-allow-origin") is None


def test_disallowed_origin_sends_no_cors_headers(client):
    r = client.get("/api/v1/chats/zzzzzz/messages", headers=FOREIGN)
    assert r.status_code == 404, r.text
    assert r.headers.get("access-control-allow-origin") is None
