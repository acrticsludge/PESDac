"""Per-request latency + DB-time measurement (measure-first for caching).

One INFO line per request on the `pesdac.timing` logger::

    GET /api/v1/chats 200 total_ms=312.4 db_ms=298.1 db_queries=3

plus `X-Response-Time-Ms` / `X-Db-Time-Ms` / `X-Db-Queries` response
headers (visible in browser devtools with no log access needed).

How the DB split works: the middleware parks a MUTABLE stats dict in a
contextvar. The engine `before/after_cursor_execute` listeners (installed
once per engine via `install_engine_timing`) run in whatever thread the
query executes on and mutate that same dict — rebinding never crosses
the anyio threadpool boundary, but mutation of the shared dict does.
Queries are sequential per thread, so one in-flight span timestamp is
enough. Outside a request (lifespan warmup, workers) the var is None
and the listeners no-op: measurement can never break serving.

Stdlib + sqlalchemy/fastapi only — no new dependency. Cost is two
perf_counter calls per statement plus dict ops: noise next to RTT.
"""

from __future__ import annotations

import contextvars
import logging
import time

from fastapi import Request
from fastapi.responses import Response
from sqlalchemy import event

logger = logging.getLogger("pesdac.timing")
if not logger.handlers:
    # Uvicorn only configures its own loggers; the root logger stays at
    # WARNING with no handlers, which silently swallows these INFO lines
    # (same reason "PESDac API ready" never prints in dev). This logger
    # therefore carries its own stderr handler. Propagation stays on, so
    # pytest caplog and any future root handler still receive the records;
    # root has no handlers under uvicorn, so nothing prints twice.
    _console = logging.StreamHandler()
    _console.setFormatter(
        logging.Formatter("%(levelname)s %(name)s: %(message)s")
    )
    logger.addHandler(_console)
if logger.level == logging.NOTSET:
    logger.setLevel(logging.INFO)

# Parked per request by the middleware; the engine listeners mutate the
# dict in place (see module docstring for why rebinding would not work).
_stats_var: contextvars.ContextVar[dict | None] = contextvars.ContextVar(
    "pesdac_db_stats", default=None
)

# In-flight statement start (perf_counter). Per-context, and statements
# never interleave within one execution flow, so a single slot suffices.
_cursor_start_var: contextvars.ContextVar[float | None] = (
    contextvars.ContextVar("pesdac_cursor_start", default=None)
)


def new_stats() -> dict:
    """Fresh per-request accumulator (shape is part of the log contract)."""
    # `cache` is the read-through outcome for this request
    # (HIT/MISS/OFF/SKIP; default OFF so mutations and uncached paths
    # carry a value without touching this module).
    return {"db_ms": 0.0, "queries": 0, "cache": "OFF"}


def note_cache_outcome(outcome: str) -> None:
    """Record the cache outcome for the current request, if any.

    Fail-open: outside a request (or when the stats shape predates this
    field) this is a no-op — measurement can never break serving.
    """
    stats = _stats_var.get()
    if stats is None:
        return
    stats["cache"] = outcome


# Strong refs: prevents double-listening (double counting) if the same
# engine object is passed twice. One entry per engine ever created —
# production creates exactly one.
_instrumented_engines: set = set()


def install_engine_timing(engine) -> None:
    """Attach cursor listeners to an engine (idempotent per object).

    Called for the app engine in `app.db.get_engine`; tests install on
    their own SQLite engine. A strong-ref guard set prevents double
    counting if the same engine object is passed twice.
    """
    if engine in _instrumented_engines:
        return
    event.listen(engine, "before_cursor_execute", _before_cursor_execute)
    event.listen(engine, "after_cursor_execute", _after_cursor_execute)
    event.listen(engine, "handle_error", _on_db_error)
    _instrumented_engines.add(engine)


def _before_cursor_execute(
    conn, cursor, statement, parameters, context, executemany
) -> None:
    _cursor_start_var.set(time.perf_counter())


def _finish_span() -> None:
    """Attribute the in-flight statement to the current request, if any."""
    start = _cursor_start_var.get()
    if start is None:
        return
    _cursor_start_var.set(None)
    stats = _stats_var.get()
    if stats is None:
        return
    stats["db_ms"] += (time.perf_counter() - start) * 1000.0
    stats["queries"] += 1


def _after_cursor_execute(
    conn, cursor, statement, parameters, context, executemany
) -> None:
    _finish_span()


def _on_db_error(context) -> None:
    # Failed statements skip `after_cursor_execute` — their elapsed time
    # still counts (and the pending start must be cleared so the next
    # statement is not misattributed).
    _finish_span()


async def timing_middleware(request: Request, call_next) -> Response:
    """Time the request and its DB statements; log one line + set headers."""
    stats = new_stats()
    token = _stats_var.set(stats)
    query = request.url.query
    label = request.url.path + ("?" + query if query else "")
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except BaseException:
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        _stats_var.reset(token)
        logger.info(
            "%s %s ERR total_ms=%.1f db_ms=%.1f db_queries=%d",
            request.method,
            label,
            elapsed_ms,
            stats["db_ms"],
            stats["queries"],
        )
        raise
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    _stats_var.reset(token)
    response.headers["X-Response-Time-Ms"] = f"{elapsed_ms:.1f}"
    response.headers["X-Db-Time-Ms"] = f"{stats['db_ms']:.1f}"
    response.headers["X-Db-Queries"] = str(stats["queries"])
    response.headers["X-Cache"] = str(stats.get("cache", "OFF"))
    logger.info(
        "%s %s %s total_ms=%.1f db_ms=%.1f db_queries=%d cache=%s",
        request.method,
        label,
        response.status_code,
        elapsed_ms,
        stats["db_ms"],
        stats["queries"],
        stats.get("cache", "OFF"),
    )
    return response
