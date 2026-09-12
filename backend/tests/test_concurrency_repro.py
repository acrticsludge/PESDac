"""T3.1 concurrency repro (spec §3, plan T3.1).

Proves the event-loop head-of-line block: N parallel DB-bound requests
against one artificially-slowed query must overlap in time. On current
code every DB-bound route is `async def` while using the sync SQLAlchemy
driver, so a blocking DB call parks the event loop and the N requests
serialize (wall ≈ N × delay). After T3.2 (routes flipped to sync `def`
so Starlette runs them in its threadpool) the same burst overlaps
(wall ≈ delay).

Mechanism notes:
- The artificial slowness is a blocking `time.sleep` wrapped around
  `Session.scalars` — faithful to a slow sync Neon query (sync drivers
  block the calling thread; on the event loop that blocks everything).
- Auth is stubbed with a no-DB user so the ONLY blocking call per
  request is the route's own DB access — pure route behavior.
- Requests run concurrently through `httpx.ASGITransport` in a single
  event loop, which is exactly the loop that `async def` routes would
  block and that sync `def` routes escape via Starlette's threadpool.

Permanent regression guard: fails (serialized) before T3.2, passes
(parallel) after. Any future `async def` regression on the measured
route re-serializes the burst and trips the timing bound.
"""

from __future__ import annotations

import asyncio
import inspect
import time
import types
import uuid

import httpx
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.models  # noqa: F401
import app.routers.chats as chats_router
from app import rate_limit
from app.db import Base, get_db
from app.deps import get_current_user
from app.main import create_app
from app.models.catalog import SUBJECT_SEEDS, Subject
from app.models.users import User

# Burst shape: large enough that serialized vs parallel separate cleanly,
# small enough to stay fast and stable on CI.
N_PARALLEL = 4
SLOW_QUERY_DELAY = 0.3  # seconds of blocking sleep per request
# Serialized wall ≈ N × delay (1.2s); parallel wall ≈ delay (0.3s).
# Bound sits between with margin on both sides.
WALL_BOUND = 0.8


def _build_app(db_path):
    # File-backed SQLite (NOT StaticPool :memory:): after T3.2 each request
    # runs on its own threadpool thread, and a single shared :memory:
    # connection cannot serve concurrent threads (sqlite3.InterfaceError).
    # A file DB gives every worker thread its own pooled connection —
    # the same one-connection-per-thread shape as prod Postgres — so the
    # burst measures loop-vs-threadpool behavior, not a SQLite artifact.
    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False, "timeout": 30},
    )
    TestingSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = TestingSession()
    for code, name in SUBJECT_SEEDS:
        db.add(Subject(code=code, display_name=name))
    user_id = uuid.uuid4()
    db.add(
        User(
            id=user_id,
            auth_user_id="repro-user",
            email="repro@example.com",
            display_name="Repro",
        )
    )
    db.commit()
    db.close()
    rate_limit.reset()

    app = create_app(validate=False)

    def _override_db():
        session = TestingSession()
        try:
            yield session
        finally:
            session.close()

    # No-DB auth stub: the repro measures the ROUTE's DB path, not the
    # dependency's. A SimpleNamespace carries just the id the route needs.
    stub_user = types.SimpleNamespace(id=user_id)

    def _override_user():
        return stub_user

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = _override_user
    return app


def test_parallel_slow_queries_overlap(tmp_path):
    """N parallel slow DB-bound requests must overlap, not serialize."""
    # Structural guard: the measured route must be sync `def` so Starlette
    # runs it in its threadpool (FastAPI docs, "Very Technical Details —
    # Path operation functions": normal `def` runs in an external
    # threadpool; `async def` with blocking I/O parks the event loop).
    # Source: https://fastapi.tiangolo.com/async/#very-technical-details
    assert not inspect.iscoroutinefunction(chats_router.list_chats), (
        "list_chats is async def with a sync DB driver: blocking queries "
        "serialize on the event loop (spec §3)"
    )

    app = _build_app(tmp_path / "repro.db")

    from sqlalchemy.orm import Session as _Session

    real_scalars = _Session.scalars

    def _slow_scalars(self, *args, **kwargs):
        time.sleep(SLOW_QUERY_DELAY)  # blocking: models a slow sync query
        return real_scalars(self, *args, **kwargs)

    _Session.scalars = _slow_scalars  # noqa: SLF001 — scoped repro patch
    try:
        wall = asyncio.run(_burst(app))
    finally:
        _Session.scalars = real_scalars  # noqa: SLF001 — restore

    assert wall < WALL_BOUND, (
        f"serialized on the event loop: {N_PARALLEL} parallel requests took "
        f"{wall:.2f}s (bound {WALL_BOUND}s for {SLOW_QUERY_DELAY}s queries)"
    )


async def _burst(app) -> float:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as ac:
        started = time.perf_counter()
        responses = await asyncio.gather(
            *[ac.get("/api/v1/chats") for _ in range(N_PARALLEL)]
        )
        wall = time.perf_counter() - started
    for r in responses:
        assert r.status_code == 200, r.text
        body = r.json()
        assert set(body.keys()) == {"data", "pagination"}
    return wall
