"""Upstash REST read-through cache (spec `redis-read-through-cache`).

Envelope caching over the existing `httpx` dependency (no new deps):
hot GET envelopes are stored as JSON strings under per-user keys and
served byte-identical on hits. Routers own write-through invalidation.

Fail-open everywhere: unset URL, slow/down Redis, or bad payloads all
fall back to the DB path with one warn line (category only — never
bodies, keys, or tokens in logs). SQLite tests run with no URL
(NullCache: same protocol, all miss).

Client protocol (shared by the Null, Upstash REST, and test-fake
clients — the tests' FakeRedis speaks exactly this):
`get(key) -> str | None`, `setex(key, ttl_s, value) -> bool`,
`delete(*keys) -> int`, `scan(cursor, match, count) -> (cursor, [keys])`,
`incr(key) -> int | None` (None when disabled), `expire(key, ttl_s) -> bool`,
`ttl(key) -> int` (-2 missing, -1 no expiry), `set_nx(key, value, ttl_s) -> bool`.
"""

from __future__ import annotations

import hashlib
import json
import logging
from urllib.parse import quote

import httpx

from app import config
from app import timing

logger = logging.getLogger("pesdac.cache")

CACHE_PREFIX = "pesdac:v1"
CACHE_MAX_BYTES = 1_000_000

TTL_CHATS_LIST = 30
TTL_MESSAGES = 60
TTL_PROFILE = 60
TTL_DEMOS = 120

# Outcomes: HIT/MISS on the store path, OFF on any transport failure or
# when disabled, SKIP when the envelope is served but never stored.
HIT, MISS, OFF, SKIP = "HIT", "MISS", "OFF", "SKIP"

_SCAN_COUNT = 100


# Key schema (spec §6) — every key embeds our users.id (D3: a missing
# scope would be a wrong-user leak).
def user_prefix(user_id) -> str:
    return f"{CACHE_PREFIX}:{{u:{user_id}}}"


def chats_list_key(user_id, archived: bool, subject, q, limit: int, offset: int) -> str:
    # ilike is case-insensitive, so lowercasing is hit-safe; hashing
    # keeps keys bounded and user search text out of key names.
    raw = (
        f"a={1 if archived else 0}"
        f"|s={subject or ''}"
        f"|q={(q or '').strip().lower()}"
        f"|l={limit}|o={offset}"
    )
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]
    return f"{user_prefix(user_id)}:chats:list:{digest}"


def chats_list_prefix(user_id) -> str:
    return f"{user_prefix(user_id)}:chats:list:"


def msgs_key(user_id, code: str, limit: int, offset: int) -> str:
    return f"{user_prefix(user_id)}:msgs:{code}:{limit}:{offset}"


def msgs_prefix(user_id, code: str | None = None) -> str:
    base = f"{user_prefix(user_id)}:msgs:"
    return base if code is None else f"{base}{code}:"


def profile_key(user_id) -> str:
    return f"{user_prefix(user_id)}:profile"


def demos_key(user_id) -> str:
    return f"{user_prefix(user_id)}:demos"


class _NullClient:
    """Disabled-cache client: every read misses, writes vanish."""

    def get(self, key: str):
        return None

    def setex(self, key: str, ttl_s: int, value: str):
        return False

    def delete(self, *keys: str):
        return 0

    def scan(self, cursor="0", match="*", count=100):
        return "0", []

    def incr(self, key: str):
        return None

    def expire(self, key: str, ttl_s: int):
        return False

    def ttl(self, key: str):
        return -2

    def set_nx(self, key: str, value: str, ttl_s: int):
        return False


class _UpstashClient:
    """Upstash REST adapter behind the get/setex/delete/scan protocol.

    Shapes per spec §8, live-verified against the dev database
    (miss→None, SET→"OK", SCAN MATCH, DEL count, brace/colon keys
    round-tripping percent-encoded). Anything unexpected still fails
    closed to OFF by construction below.
    `GET {url}/get/{key}` → `{"result": str|null}`;
    `POST {url}` `["SET", k, v, "EX", ttl]` → `{"result":"OK"}`;
    `["SCAN", cursor, "MATCH", pat, "COUNT", n]` → `{"result":[cur,[ks]]}`;
    `["DEL", k…]` → `{"result":n}`. Bearer auth; 1 s timeouts; no retry.

    Rate-limit/lock shapes (live-probed 2026-09-13 against the dev DB):
    `["INCR", k]` → `{"result": int}`; `["EXPIRE", k, ttl]` → `{"result":1}`;
    `["TTL", k]` → `{"result": seconds|-1|-2}`;
    `["SET", k, v, "EX", ttl, "NX"]` → `{"result":"OK"|null}`.
    """

    def __init__(self, base_url: str, token: str | None):
        self._base = base_url.rstrip("/")
        self._headers = {"Authorization": f"Bearer {token}"} if token else {}
        self._client: httpx.Client | None = None

    def _http(self) -> httpx.Client:
        # Lazy singleton sync client with keep-alive (mirrors the JWKS
        # shared-client pattern). httpx never retries — fail fast to DB.
        if self._client is None:
            self._client = httpx.Client(
                timeout=httpx.Timeout(connect=1.0, read=1.0, write=1.0, pool=1.0)
            )
        return self._client

    def _check(self, payload: dict) -> object:
        if not isinstance(payload, dict) or "error" in payload:
            raise RuntimeError("upstash_error_shape")
        return payload.get("result")

    def get(self, key: str):
        # Percent-encode the path segment (keys carry `{u:…}` + colons).
        resp = self._http().get(
            f"{self._base}/get/{quote(key, safe='')}", headers=self._headers
        )
        if resp.status_code != 200:
            raise RuntimeError(f"upstash_status_{resp.status_code}")
        result = self._check(resp.json())
        return result if isinstance(result, str) or result is None else None

    def _pipeline(self, command: list) -> object:
        resp = self._http().post(self._base, json=command, headers=self._headers)
        if resp.status_code != 200:
            raise RuntimeError(f"upstash_status_{resp.status_code}")
        return self._check(resp.json())

    def setex(self, key: str, ttl_s: int, value: str):
        return self._pipeline(["SET", key, value, "EX", int(ttl_s)]) == "OK"

    def delete(self, *keys: str):
        if not keys:
            return 0
        result = self._pipeline(["DEL", *keys])
        return result if isinstance(result, int) else 0

    def scan(self, cursor="0", match="*", count=100):
        result = self._pipeline(
            ["SCAN", str(cursor), "MATCH", match, "COUNT", str(count)]
        )
        if (
            isinstance(result, (list, tuple))
            and len(result) == 2
            and isinstance(result[1], list)
        ):
            return str(result[0]), [k for k in result[1] if isinstance(k, str)]
        raise RuntimeError("upstash_scan_shape")

    def incr(self, key: str):
        # Fixed-window counter (rate-limiting skill `simpleRateLimit`).
        result = self._pipeline(["INCR", key])
        if isinstance(result, int):
            return result
        raise RuntimeError("upstash_incr_shape")

    def expire(self, key: str, ttl_s: int):
        result = self._pipeline(["EXPIRE", key, int(ttl_s)])
        return result == 1

    def ttl(self, key: str):
        result = self._pipeline(["TTL", key])
        return result if isinstance(result, int) else -2

    def set_nx(self, key: str, value: str, ttl_s: int):
        # Distributed-lock acquire (locks skill: SET NX EX). Returns True
        # only on {"result":"OK"}; {"result":null} means held elsewhere.
        result = self._pipeline(["SET", key, value, "EX", int(ttl_s), "NX"])
        return result == "OK"


_null = _NullClient()
_upstash: _UpstashClient | None = None
_test_client = None


def set_test_client(client) -> None:
    """Test seam: FakeRedis stands in for Upstash (no new test deps)."""
    global _test_client
    _test_client = client


def clear_test_client() -> None:
    global _test_client
    _test_client = None


def is_enabled() -> bool:
    """True when a backend exists (test fake) or a REST URL is set."""
    if _test_client is not None:
        return True
    # Hermetic suite: under ENV=test the real backend is never touched,
    # even when the developer's own .env carries a live URL — otherwise
    # contract tests would populate real keys and observe HITs.
    if config.ENV == "test":
        return False
    url = config.UPSTASH_REDIS_REST_URL
    return bool(url and url.strip())


def _get_client():
    if _test_client is not None:
        return _test_client
    if config.ENV == "test":
        return _null
    url = config.UPSTASH_REDIS_REST_URL
    if not (url and url.strip()):
        return _null
    global _upstash
    if _upstash is None:
        _upstash = _UpstashClient(url.strip(), config.UPSTASH_REDIS_REST_TOKEN)
    return _upstash


def _warn(category: str) -> None:
    # Category only — never bodies, keys, or tokens.
    logger.warning("cache_off category=%s", category)


def get_json(key: str) -> tuple[str, object | None]:
    """Read one envelope. Returns (HIT, value) | (MISS, None) | (OFF, None)."""
    if not is_enabled():
        return OFF, None
    try:
        raw = _get_client().get(key)
    except Exception as exc:
        _warn(type(exc).__name__)
        return OFF, None
    if raw is None:
        return MISS, None
    try:
        return HIT, json.loads(raw)
    except (ValueError, TypeError) as exc:
        _warn(f"decode_{type(exc).__name__}")
        return MISS, None


def set_json(key: str, value: object, ttl_s: int) -> str:
    """Store one envelope. Returns STORED | SKIP | OFF."""
    # Disabled first: no serialization work and no misleading SKIP when
    # the cache is off — OFF is the honest outcome there.
    if not is_enabled():
        return OFF
    try:
        payload = json.dumps(value)
    except (TypeError, ValueError) as exc:
        _warn(f"unserializable_{type(exc).__name__}")
        return SKIP
    if len(payload.encode("utf-8")) > CACHE_MAX_BYTES:
        _warn("oversize")
        return SKIP
    try:
        ok = _get_client().setex(key, int(ttl_s), payload)
    except Exception as exc:
        _warn(type(exc).__name__)
        return OFF
    return "STORED" if ok else OFF


def invalidate_exact(*keys: str) -> int:
    """Delete exact keys (K3/K4 single-key DELs). Fail-open: warn, 0."""
    if not keys or not is_enabled():
        return 0
    try:
        return int(_get_client().delete(*keys) or 0)
    except Exception as exc:
        _warn(type(exc).__name__)
        return 0


def invalidate_prefix(prefix: str) -> int:
    """SCAN MATCH + DEL loop for one user's key scope. Fail-open."""
    # Empty-prefix guard: SCAN "*" + DEL would wipe the whole database.
    # All callers pass a per-user prefix; this makes a future bare call
    # a no-op instead of a catastrophe.
    if not prefix or not is_enabled():
        return 0
    client = _get_client()
    pattern = prefix + "*"
    total = 0
    cursor: object = "0"
    try:
        while True:
            cursor, found = client.scan(cursor, match=pattern, count=_SCAN_COUNT)
            if found:
                total += int(client.delete(*found) or 0)
            if str(cursor) == "0":
                break
    except Exception as exc:
        _warn(type(exc).__name__)
    return total


def note_miss() -> None:
    """Record a MISS for a live-only response (e.g. uncacheable 404s).

    The store was not at fault — there was simply nothing cacheable —
    so OFF would misreport health in hit-rate sampling.
    """
    timing.note_cache_outcome(MISS)


def rate_limit_key(route_key: str, client_ip: str) -> str:
    """Fixed-window counter key for the distributed rate limiter.

    Scoped under the same `pesdac:v1` prefix so account wipe
    (`DELETE /users/me` → whole-prefix invalidate) cannot leak buckets
    across a recreated account, and so `v1` bumps invalidate them too.
    IP octets/colons are safe in Redis keys; route keys are enum-like
    (`chats-create`, …) so the keyspace stays bounded.
    """
    return f"{CACHE_PREFIX}:rl:{route_key}:{client_ip}"


def lock_key(name: str) -> str:
    """Distributed-lock key (locks skill: `lock:<name>` namespaced)."""
    return f"{CACHE_PREFIX}:lock:{name}"


def acquire_lock(key: str, token: str, ttl_s: int) -> bool:
    """Try to acquire a lock (SET NX EX). Fail-closed to False on any
    transport error or when disabled — callers treat False as "busy" and
    skip the guarded work, never as permission to run it twice."""
    if not key or not is_enabled():
        return False
    try:
        return bool(_get_client().set_nx(key, token, int(ttl_s)))
    except Exception as exc:
        _warn(type(exc).__name__)
        return False


def release_lock(key: str) -> None:
    """Release a lock (plain DEL). Fail-open: warn and move on.

    Limitation (per the locks skill): without EVAL compare-and-delete, a
    DEL after TTL expiry could remove a *new* holder's lock. Safe here
    because the only wired user (nightly purge, when scheduled) holds the
    lock for seconds under a 60 s TTL — single runner, no contention. Do
    not reuse for high-contention paths without adding EVAL.
    """
    if not key or not is_enabled():
        return
    try:
        _get_client().delete(key)
    except Exception as exc:
        _warn(type(exc).__name__)


def read_through(key: str, ttl_s: int, build):
    """Thin wrapper for the GET handlers: HIT serves the stored dict,
    otherwise `build()` runs exactly as today (DB path) and populates.
    Records the final outcome for timing/X-Cache. Never raises for
    cache reasons — a dead backend just means (fresh_value, OFF)."""
    outcome, cached = get_json(key)
    if outcome == HIT:
        timing.note_cache_outcome(HIT)
        return cached, HIT
    first = outcome  # MISS or OFF
    value = build()
    if not isinstance(value, dict):
        # Only plain-dict 200s are cached (D7) — JSONResponse branches
        # (404s/conflict-200s/429s) execute live and keep their outcome.
        timing.note_cache_outcome(first)
        return value, first
    stored = set_json(key, value, ttl_s)
    final = MISS if (first == MISS and stored == "STORED") else (
        SKIP if stored == SKIP else OFF if first == OFF or stored == OFF else MISS
    )
    timing.note_cache_outcome(final)
    return value, final
