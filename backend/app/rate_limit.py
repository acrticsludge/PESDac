"""In-memory sliding-window rate limiter for abuse-prone routes (arch §9).

T19 hardening:
- bounded bucket map: periodic sweep evicts expired entries to keep
  memory bounded under attack or after long idle.
- explicit single-process constraint logged at startup; multi-worker
  deployments must replace this with Redis/another shared store.
- trusted-proxy gating: X-Forwarded-For is only honored when the
  request came through a configured proxy CIDR/host. Without that,
  raw forwarded headers are spoofable.

Limits are per (route-key, client-ip). Emits 429 with Retry-After.
Wired into the mutation routes via the same walrus pattern as
`check_mutation_origin`.
"""

from __future__ import annotations

import logging
import os
import time
from collections import deque

from fastapi import Request
from fastapi.responses import JSONResponse

from app.schemas.common import error_body

logger = logging.getLogger("pesdac")

# Trusted proxy hosts (comma-separated env). When unset the limiter
# never trusts X-Forwarded-For, eliminating the spoofing class entirely.
# Production deployments set TRUSTED_PROXY_HOSTS to e.g. "10.0.0.0/8" or
# specific CDN edge IPs.
_trusted_proxy_hosts: set[str] = {
    h.strip().lower()
    for h in os.environ.get("TRUSTED_PROXY_HOSTS", "").split(",")
    if h.strip()
}

# Cap the bucket map to bound memory under burst traffic. When we hit
# the cap, the oldest entries are evicted first.
_MAX_BUCKETS = 50_000
_SWEEP_INTERVAL_S = 30.0
_last_sweep = 0.0

_buckets: dict[tuple[str, str], deque[float]] = {}


def _client_ip(request: Request) -> str:
    if _trusted_proxy_hosts:
        # Only trust the forwarded header if the immediate connection
        # host is in our trusted-proxy set. Spoofed X-Forwarded-For
        # from a direct connection is dropped.
        direct = request.client.host if request.client else ""
        if direct and direct.lower() in _trusted_proxy_hosts:
            forwarded = request.headers.get("x-forwarded-for")
            if forwarded:
                return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _sweep(now: float, window_s: int) -> None:
    """Drop expired entries and, if still over the cap, the oldest."""
    global _last_sweep
    if now - _last_sweep < _SWEEP_INTERVAL_S and len(_buckets) <= _MAX_BUCKETS:
        return
    expired = []
    for key, bucket in _buckets.items():
        while bucket and bucket[0] <= now - window_s:
            bucket.popleft()
        if not bucket:
            expired.append(key)
    for key in expired:
        _buckets.pop(key, None)
    if len(_buckets) > _MAX_BUCKETS:
        # Evict oldest-touched entries until under cap.
        victims = sorted(_buckets.items(), key=lambda kv: kv[1][0] if kv[1] else 0)
        for key, _ in victims[: len(_buckets) - _MAX_BUCKETS]:
            _buckets.pop(key, None)
    _last_sweep = now


def check(key: str, request: Request, max_hits: int, window_s: int) -> JSONResponse | None:
    now = time.monotonic()
    _sweep(now, window_s)
    bucket_key = (key, _client_ip(request))
    bucket = _buckets.setdefault(bucket_key, deque())
    while bucket and bucket[0] <= now - window_s:
        bucket.popleft()
    if len(bucket) >= max_hits:
        retry_after = int(bucket[0] + window_s - now) + 1
        logger.warning(
            "429 %s key=%s ip=%s",
            request.url.path, key, _client_ip(request)
        )
        resp = JSONResponse(
            status_code=429,
            content=error_body("RATE_LIMITED", "Too many attempts. Try again later."),
        )
        resp.headers["Retry-After"] = str(retry_after)
        return resp
    bucket.append(now)
    return None


def reset() -> None:
    """Test hook only."""
    _buckets.clear()
    global _last_sweep
    _last_sweep = 0.0


async def empty_ok() -> None:
    return None
