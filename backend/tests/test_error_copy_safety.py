"""Error-copy safety audit (LEAK fix pin): 422 `details` redaction.

Site #4 (`app/main.py::_validation`): the raw `exc.errors()` payload
echoed `input` (unbounded verbatim replay of the request value) and `ctx`
(validator internals such as constraint bounds). Only the structural keys
`loc`/`msg`/`type` ship to the client now. Same status (422), code
(VALIDATION_ERROR), message ("Invalid request."), envelope.

Synthetic fixtures only — no real user data.
"""

from __future__ import annotations


def _assert_redacted_shape(body) -> None:
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert body["error"]["message"] == "Invalid request."
    details = body["error"].get("details")
    assert isinstance(details, list) and details, body
    for item in details:
        assert isinstance(item, dict), item
        # Redacted keys must be ABSENT (never snapshot the whole payload).
        assert "input" not in item, item
        assert "ctx" not in item, item
        # Structural keys the UI needs to name the failing field stay.
        assert "loc" in item and "msg" in item and "type" in item, item


def test_422_details_redact_input_echo(client):
    """Body-type error: `input` echo of the bad value must not ship."""
    r = client.put(
        "/api/v1/demo-state/TCP%20vs%20UDP",
        json={"isHidden": "not-a-bool"},
    )
    assert r.status_code == 422, r.text
    _assert_redacted_shape(r.json())


def test_422_details_redact_ctx_internals(client):
    """Constraint error (`limit > 100`): `ctx` bound + `input` must not ship."""
    r = client.get("/api/v1/chats?limit=9999")
    assert r.status_code == 422, r.text
    _assert_redacted_shape(r.json())
