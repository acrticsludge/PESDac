"""Uvicorn entrypoint (deploy runbook step 2).

Usage: `cd backend && python serve.py` (env comes from real
environment + `backend/.env` gap-fill via `app.config`).

Builds the VALIDATED app (`create_app(validate=True)` — missing config
fails fast here, never as a 500-ing server). Never serve the
module-level `app.main:app` object directly: it is None outside
validated envs by design.
"""

from __future__ import annotations

import os

import uvicorn

from app.main import create_app


def main() -> None:
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(create_app(validate=True), host=host, port=port)


if __name__ == "__main__":
    main()
