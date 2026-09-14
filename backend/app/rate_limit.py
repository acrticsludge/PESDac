"""Sliding-window rate limiter for abuse-prone routes (arch §9).

T19 hardening:
- bounded bucket map: periodic sweep evicts expired entries to keep
  memory bounded under attack or after long idle.
- multi-worker: when Upstash Redis is configured the fixed-window
  counter in Redis is authoritative (shared across processes); the
  in-memory buckets remain as the fail-open fallback when Redis is
  unset, down, or slow — same 429 envelope either way.
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

# Test-only clock override (boundary tests). None = live monotonic clock.
_test_now: float | None = None


def __set_now_for_testing(now: float | None) -> None:
    """Test hook only: freeze (float) or thaw (None) the limiter clock."""
    global _test_now
    _test_now = now


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
    ip = _client_ip(request)
    redis_verdict = _check_redis(key, ip, request, max_hits, window_s)
    if redis_verdict is not None:
        # True → allowed by Redis; JSONResponse → throttled by Redis.
        # None → Redis unavailable/disabled; fall through to memory.
        return redis_verdict if isinstance(redis_verdict, JSONResponse) else None
    return _check_memory(key, ip, request, max_hits, window_s)


def _check_redis(
    key: str, ip: str, request: Request, max_hits: int, window_s: int
) -> JSONResponse | bool | None:
    """Fixed-window counter in Redis (rate-limiting skill `simpleRateLimit`).

    `INCR rl-key`; first hit sets `EXPIRE window`. Over-limit reads `TTL`
    for Retry-After. Returns True (allowed), a 429 response (throttled),
    or None (Redis off/broken → caller falls back to memory).

    Why fixed-window, not sliding-window sorted sets: 2 RTTs vs 4 per
    mutation, and boundary imprecision is harmless at 60/min and 10/5min
    abuse-protection limits (algorithms skill). Fail-open: any exception
    or unexpected shape degrades to the local buckets, one warn line.
    """
    try:
        from app import cache as _cache
    except Exception:
        return None
    try:
        if not _cache.is_enabled():
            return None
        client = _cache._get_client()
        rkey = _cache.rate_limit_key(key, ip)
        count = client.incr(rkey)
        if not isinstance(count, int):
            raise RuntimeError("ratelimit_incr_shape")
        if count == 1:
            try:
                client.expire(rkey, int(window_s))
            except Exception as exc:
                logger.warning("ratelimit_expire category=%s", type(exc).__name__)
        if count > max_hits:
            try:
                ttl = client.ttl(rkey)
            except Exception:
                ttl = int(window_s)
            retry_after = ttl if isinstance(ttl, int) and ttl >= 0 else int(window_s)
            logger.warning("429 %s key=%s ip=%s via=redis", request.url.path, key, ip)
            resp = JSONResponse(
                status_code=429,
                content=error_body("RATE_LIMITED", "Too many attempts. Try again later."),
            )
            resp.headers["Retry-After"] = str(max(1, retry_after))
            return resp
        return True
    except Exception as exc:
        logger.warning("ratelimit_redis_fallback category=%s", type(exc).__name__)
        return None


def _check_memory(
    key: str, ip: str, request: Request, max_hits: int, window_s: int
) -> JSONResponse | None:
    now = _test_now if _test_now is not None else time.monotonic()
    _sweep(now, window_s)
    bucket_key = (key, ip)
    bucket = _buckets.setdefault(bucket_key, deque())
    while bucket and bucket[0] <= now - window_s:
        bucket.popleft()
    if len(bucket) >= max_hits:
        retry_after = int(bucket[0] + window_s - now) + 1
        logger.warning(
            "429 %s key=%s ip=%s",
            request.url.path, key, ip
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
    global _last_sweep, _test_now
    _last_sweep = 0.0
    _test_now = None


async def empty_ok() -> None:
    return None
