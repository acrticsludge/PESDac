"""OpenAPI route registration (audit §20 item 1, link-password lesson).

A route that exists but is never registered answers 404 with zero
test signal — unless something asserts registration. This pins it:
every `/api/v1` route on the app must appear in the served OpenAPI
document, and the headline endpoints must all be present.
"""

from __future__ import annotations


def _app_paths(client) -> set[str]:
    from app.main import create_app

    app = create_app(validate=False)
    paths = set()
    # Router inclusions nest the real APIRoutes one level down
    # (_IncludedRouter.original_router.routes); framework docs/redoc /
    # openapi routes are top-level starlette Routes and are skipped.
    nested = []
    for route in app.routes:
        original = getattr(route, "original_router", None)
        if original is not None:
            nested.extend(getattr(original, "routes", []))
    for route in nested:
        if route.__class__.__name__ != "APIRoute":
            continue
        path = getattr(route, "path", "")
        if not path:
            continue
        if not path.startswith("/api/v1"):
            path = "/api/v1" + path
        paths.add(path)
    assert paths, "no /api/v1 routes found — app did not mount routers"
    return paths


def test_every_mounted_route_is_in_openapi(client):
    r = client.get("/api/openapi.json")
    assert r.status_code == 200, r.text
    documented = set(r.json()["paths"])
    missing = sorted(p for p in _app_paths(client) if p not in documented)
    assert not missing, missing


def test_headline_endpoints_documented(client):
    documented = set(client.get("/api/openapi.json").json()["paths"])
    for path in (
        "/api/v1/health",
        "/api/v1/ready",
        "/api/v1/auth/me",
        "/api/v1/profiles/me",
        "/api/v1/chats",
        "/api/v1/chats/{code}",
        "/api/v1/chats/{code}/messages",
        "/api/v1/demo-state",
        "/api/v1/demo-state/{label}",
        "/api/v1/users/me",
        "/api/v1/users/me/export",
    ):
        assert path in documented, path
