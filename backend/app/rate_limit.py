"""In-memory sliding-window rate limiter for auth/abuse-prone routes (arch §9).

No extra dependency for v1. Limits are per (route-key, client-ip). Emits 429
with Retry-After. A Redis-backed limiter can replace this module without
touching routers (same `limit()` dependency signature).
"""

from __future__ import annotations

import logging
import time
from collections import deque

from fastapi import Request, Response
from fastapi.responses import JSONResponse

from app.schemas.common import error_body

logger = logging.getLogger("pesdac")

_buckets: dict[tuple[str, str], deque[float]] = {}


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def check(key: str, request: Request, max_hits: int, window_s: int) -> JSONResponse | None:
    now = time.monotonic()
    bucket_key = (key, _client_ip(request))
    bucket = _buckets.setdefault(bucket_key, deque())
    while bucket and bucket[0] <= now - window_s:
        bucket.popleft()
    if len(bucket) >= max_hits:
        retry_after = int(bucket[0] + window_s - now) + 1
        logger.warning(
            "429 %s key=%s ip=%s", request.url.path, key, _client_ip(request)
        )
        resp = JSONResponse(status_code=429, content=error_body("RATE_LIMITED", "Too many attempts. Try again later."))
        resp.headers["Retry-After"] = str(retry_after)
        return resp
    bucket.append(now)
    return None


def reset() -> None:
    """Test hook only."""
    _buckets.clear()


async def empty_ok() -> None:
    return None
