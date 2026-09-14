# Cache + rate limits (audit §12)

Date: 2026-09-14. Code: `backend/app/cache.py`, `backend/app/rate_limit.py`,
`backend/app/timing.py`. Proofs: `test_cache*.py`,
`test_cache_invalidation.py`, `test_rate_limit_contract.py`,
`test_rate_limit_redis.py`, `test_timing.py`.

## Cache

- Backend: Upstash REST (`UPSTASH_REDIS_REST_URL/TOKEN`) or disabled.
  Disabled (unset URL, down/slow Redis, bad payload) fails OPEN to the
  DB path with one category-only warn line — never bodies, keys, or
  tokens. `NullCache` zero-delta vs a cold cache is proven by
  `test_null_cache_zero_delta_vs_first_miss` (identical bodies; only
  the `X-Cache` outcome differs).
- Key schema: everything under `pesdac:v1:{u:<users.id>}:…` — a missing
  scope would be a wrong-user leak (D3). Search text is hashed into
  the key (raw queries never in key names; case variants share keys —
  hit-safe under `ilike`).
- TTLs: chats-list 30 s, messages 60 s, profile 60 s, demos 120 s.
  Envelopes over 1 MB are never stored (SKIP).
- Invalidation is router-owned and proven per write path in
  `test_cache_invalidation.py`: profile/demos exact-key DEL;
  chats/msgs/user-prefix SCAN MATCH + DEL. `invalidate_prefix("")`
  is a guarded no-op (a bare call can never wipe the database).
- Account wipe (`DELETE /users/me`) purges the whole user prefix —
  including `rl:` buckets (see below), so a recreated account starts
  un-throttled.
- Stampede position (accepted limitation): `read_through` has NO
  single-flight — a cold key under burst builds N times. Bounded by
  short TTLs + cheap indexed queries. Add single-flight if listings
  ever get expensive; do not claim protection that isn't there.
- Observability: every response carries `X-Cache: HIT|MISS|OFF|SKIP`
  plus `X-Response-Time-Ms` / `X-Db-Time-Ms` / `X-Db-Queries`. Bodies
  are never altered, values never logged.

## Rate limits (per route-key + client IP, envelope `RATE_LIMITED`)

| Key | Limit | Routes |
|---|---|---|
| `profiles-patch` | 60 / 60 s | `PATCH /profiles/me` |
| `demo-put` | 60 / 60 s | `PUT /demo-state/{label}` |
| `chats-create` | 60 / 60 s | `POST /chats` |
| `chat-messages-append` | 60 / 60 s | `POST /chats/{code}/messages` |
| `chat-messages-truncate` | 60 / 60 s | `DELETE /chats/{code}/messages` |
| `llm-key-delete` | 60 / 60 s | `DELETE /llm/key` |
| `chats-clear` | 10 / 300 s | `DELETE /chats` |
| `users-delete` | 10 / 300 s | `DELETE /users/me` |
| `llm-key-save` | 10 / 300 s | `PUT /llm/key` |
| link-password | 5 attempts then 429 + `Retry-After` | Astro `POST /api/link-password` (own bucket, see `link-password-server.test.ts`) |

Reads are unlimited. 429s carry `Retry-After` (Redis TTL on the
Redis path, computed remainder on the memory path) straight through
the envelope normalisation — proven at HTTP level, including the
window-boundary release (`test_window_boundary_releases_the_bucket`).

## Trust + deploy notes

- `X-Forwarded-For` is honored ONLY when the direct connection IP is
  in `TRUSTED_PROXY_HOSTS` (exact match; first XFF entry wins).
  Unset (the default) = never trust = spoofing class eliminated.
  Proven by the proxy unit tests.
- Redis configured → its fixed-window counter is authoritative and
  shared across processes. Redis unset/down/slow → per-process memory
  buckets (bounded: 50k entries, swept, oldest-evicted). Consequence:
  multi-worker WITHOUT Redis under-enforces limits — acceptable for
  abuse-protection limits, not for quota. If limits ever become
  quota, Redis becomes required (fail closed, not open).
- Memory buckets key on the resolved IP: behind a proxy WITHOUT
  `TRUSTED_PROXY_HOSTS`, every client shares the proxy's IP and one
  bucket — set the env var or throttle the proxy itself.
