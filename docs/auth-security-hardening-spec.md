# PESDac Auth Security Hardening — Implementation Spec

**Source:** TypeSafe/Jev Audit (2026-09-19)
**Priority:** High → Medium → Medium

---

## 1. Token Replay Protection (P=89% — HIGH)

### Problem
- JWTs issued by `/api/auth/token` lack `jti` (JWT ID) claim
- No server-side replay detection
- Client caches tokens for 5 min (`TOKEN_TTL_MS=300000`); server TTL ~15 min
- Attacker with captured token can replay within TTL window

### Solution Overview
| Layer | Change |
|-------|--------|
| **Backend (FastAPI)** | Add `jti` to JWT payload; store used `jti` in Redis with TTL; reject duplicates |
| **Frontend (auth-cache.ts)** | No change needed — backend enforces |
| **Token Mint** | `mintTokenOnce` unchanged — validation happens on protected endpoints |

### Backend Changes (FastAPI)

**File:** `backend/app/deps.py` (or wherever JWT verification lives)

```python
# Add to JWT payload during minting
import uuid
jti = str(uuid.uuid4())
payload = {
    "sub": user.id,
    "jti": jti,           # NEW
    "exp": ...,           # existing
    "iat": ...,           # existing
}

# In token verification dependency:
async def verify_token_no_replay(token: str = Depends(oauth2_scheme)):
    payload = decode_jwt(token)
    jti = payload.get("jti")
    if not jti:
        raise HTTPException(401, "Token missing jti")
    
    # Check Redis for replay
    key = f"jwt:replay:{jti}"
    if await redis.exists(key):
        raise HTTPException(401, "Token replay detected")
    
    # Mark as used with TTL matching token expiry
    ttl = payload["exp"] - int(time.time())
    await redis.setex(key, ttl, "1")
    
    return payload
```

**Redis key pattern:** `jwt:replay:{jti}` → TTL = token remaining lifetime

### Frontend Impact
- **Zero changes** to `auth-cache.ts` or `auth.ts`
- `mintTokenOnce` continues to cache token for 5 min
- Replay rejection surfaces as 401 → `authRequiredError` → re-login flow (already handled)

### Testing
```bash
# 1. Mint token
TOKEN=$(curl -b cookies -c cookies http://localhost:8000/api/auth/token | jq -r .token)

# 2. Use once (success)
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/v1/auth/me

# 3. Replay (should 401)
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/v1/auth/me
```

---

## 2. CSRF Protection on `/api/link-password` (P=65% — MEDIUM)

### Problem
- `POST /api/link-password` (Astro route) accepts credentials with cookies
- No CSRF token, no `Origin`/`Referer` check, no `SameSite=Strict`
- Attacker site can trick user into linking attacker-controlled password

### Solution Overview
| Layer | Change |
|-------|--------|
| **Astro Route** | Validate CSRF token from header + `SameSite=Strict` cookie |
| **Frontend (auth.ts)** | Fetch CSRF token on page load; include in `linkPassword` request |
| **Cookie Config** | Set `SameSite=Strict; Secure; HttpOnly` on CSRF cookie |

### Astro Route Changes

**File:** `frontend/src/pages/api/link-password.ts` (create if not exists)

```ts
// frontend/src/pages/api/link-password.ts
import type { APIRoute } from "astro";
import { verifyCsrf } from "../../../lib/csrf";

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  // 1. Verify CSRF
  const csrfToken = request.headers.get("x-csrf-token");
  const csrfCookie = cookies.get("csrf_token")?.value;
  
  if (!verifyCsrf(csrfToken, csrfCookie)) {
    return new Response(JSON.stringify({ ok: false, message: "Invalid CSRF token" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 2. Existing link-password logic (from BetterAuth setPassword)
  const body = await request.json();
  const { newPassword } = body;
  
  // ... existing implementation ...
  
  // 3. Rotate CSRF token after successful mutation
  const newCsrf = generateCsrfToken();
  cookies.set("csrf_token", newCsrf, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 24, // 24h
  });

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
};
```

**File:** `frontend/src/lib/csrf.ts` (new)

```ts
// frontend/src/lib/csrf.ts
import { randomBytes } from "crypto";

const CSRF_SECRET = import.meta.env.CSRF_SECRET || "dev-secret-change-in-prod";

export function generateCsrfToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashCsrf(token: string): string {
  return createHmac("sha256", CSRF_SECRET).update(token).digest("hex");
}

export function verifyCsrf(headerToken: string | null, cookieToken: string | null): boolean {
  if (!headerToken || !cookieToken) return false;
  return timingSafeEqual(
    Buffer.from(hashCsrf(headerToken)),
    Buffer.from(hashCsrf(cookieToken))
  );
}
```

### Frontend Changes

**File:** `frontend/src/lib/auth.ts` — `linkPassword` function

```ts
// Add CSRF token fetch + header
export async function linkPassword(newPassword: string): Promise<void> {
  // 1. Ensure CSRF token exists (fetch if missing)
  let csrfToken = getCsrfToken();
  if (!csrfToken) {
    csrfToken = await fetchCsrfToken();
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  
  try {
    const res = await fetch("/api/link-password", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken!,  // NEW
      },
      body: JSON.stringify({ newPassword }),
      credentials: "same-origin",
      signal: controller.signal,
    });
    // ... rest unchanged
  }
}
```

**File:** `frontend/src/lib/csrf-client.ts` (new)

```ts
// frontend/src/lib/csrf-client.ts
let csrfTokenCache: string | null = null;

export function getCsrfToken(): string | null {
  return csrfTokenCache;
}

export async function fetchCsrfToken(): Promise<string> {
  const res = await fetch("/api/csrf-token", { credentials: "include" });
  const data = await res.json();
  csrfTokenCache = data.csrfToken;
  return csrfTokenCache;
}

export function clearCsrfToken(): void {
  csrfTokenCache = null;
}
```

**File:** `frontend/src/pages/api/csrf-token.ts` (new)

```ts
// frontend/src/pages/api/csrf-token.ts
import type { APIRoute } from "astro";
import { generateCsrfToken } from "../../../lib/csrf";

export const GET: APIRoute = async ({ cookies }) => {
  const token = generateCsrfToken();
  const hashed = hashCsrf(token);
  
  cookies.set("csrf_token", hashed, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 24,
  });

  return new Response(JSON.stringify({ csrfToken: token }), {
    headers: { "Content-Type": "application/json" },
  });
};
```

### Cookie Hardening (BetterAuth Config)

**File:** `backend/lib/auth.ts` (BetterAuth config)

```ts
export const auth = betterAuth({
  // ... existing config
  cookies: {
    session_token: {
      name: "session_token",
      options: {
        httpOnly: true,
        secure: true,
        sameSite: "strict",  // CHANGE from "lax"
        path: "/",
        maxAge: 60 * 60 * 24 * 7, // 7 days
      },
    },
  },
});
```

### Testing
```bash
# 1. Get CSRF token
curl -b cookies -c cookies http://localhost:4321/api/csrf-token

# 2. Valid request (with token)
curl -b cookies -H "X-CSRF-Token: <token>" -H "Content-Type: application/json" \
  -d '{"newPassword":"newpass123"}' \
  http://localhost:4321/api/link-password

# 3. Missing token → 403
curl -b cookies -H "Content-Type: application/json" \
  -d '{"newPassword":"newpass123"}' \
  http://localhost:4321/api/link-password
```

---

## 3. Client-Side Rate Limiting on Auth Endpoints (P=62% — MEDIUM)

### Problem
- `signIn`, `signUp`, `changePassword`, `linkPassword` call BetterAuth directly
- No client-side throttling → brute-force, credential stuffing, password spray possible
- Server-side rate limiting exists but client should fail fast

### Solution Overview
| Endpoint | Limit | Window | Strategy |
|----------|-------|--------|----------|
| `signIn` | 5 req | 15 min | Token bucket per email + IP |
| `signUp` | 3 req | 1 hour | Token bucket per IP |
| `changePassword` | 3 req | 1 hour | Token bucket per user |
| `linkPassword` | 5 req | 1 hour | Token bucket per user |

### Implementation

**File:** `frontend/src/lib/rate-limiter.ts` (new)

```ts
// frontend/src/lib/rate-limiter.ts
interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  keyPrefix: string;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const memoryStore = new Map<string, RateLimitEntry>();

export function createRateLimiter(config: RateLimitConfig) {
  return {
    async check(key: string): Promise<{ allowed: boolean; retryAfterMs?: number }> {
      const fullKey = `${config.keyPrefix}:${key}`;
      const now = Date.now();
      const entry = memoryStore.get(fullKey);

      if (!entry || now > entry.resetAt) {
        // New window
        memoryStore.set(fullKey, { count: 1, resetAt: now + config.windowMs });
        return { allowed: true };
      }

      if (entry.count >= config.maxRequests) {
        return { allowed: false, retryAfterMs: entry.resetAt - now };
      }

      entry.count += 1;
      return { allowed: true };
    },

    async consume(key: string): Promise<void> {
      const result = await this.check(key);
      if (!result.allowed) {
        throw new RateLimitError(result.retryAfterMs!);
      }
    },
  };
}

export class RateLimitError extends Error {
  constructor(public retryAfterMs: number) {
    super("Rate limit exceeded");
    this.name = "RateLimitError";
  }
}

// Pre-configured limiters
export const signInLimiter = createRateLimiter({
  maxRequests: 5,
  windowMs: 15 * 60 * 1000,
  keyPrefix: "signin",
});

export const signUpLimiter = createRateLimiter({
  maxRequests: 3,
  windowMs: 60 * 60 * 1000,
  keyPrefix: "signup",
});

export const changePasswordLimiter = createRateLimiter({
  maxRequests: 3,
  windowMs: 60 * 60 * 1000,
  keyPrefix: "changepwd",
});

export const linkPasswordLimiter = createRateLimiter({
  maxRequests: 5,
  windowMs: 60 * 60 * 1000,
  keyPrefix: "linkpwd",
});
```

**File:** `frontend/src/lib/auth.ts` — wrap each function

```ts
import { 
  signInLimiter, signUpLimiter, changePasswordLimiter, linkPasswordLimiter,
  RateLimitError 
} from "./rate-limiter";

export async function signIn(email: string, password: string) {
  // Rate limit by email + IP (approximate via session)
  const key = `${email}:${getClientFingerprint()}`;
  await signInLimiter.consume(key);
  
  clearAuthCache({ preserveTrueGuests: true });
  return authClient.signIn.email({ email, password });
}

export async function signUp(email: string, password: string, name: string) {
  const key = getClientFingerprint();
  await signUpLimiter.consume(key);
  
  clearAuthCache({ preserveTrueGuests: true });
  return authClient.signUp.email({ email, password, name });
}

export async function changePassword(currentPassword: string, newPassword: string) {
  const auth = useAuth(); // Need to get current user ID
  // For non-hook context, pass userId from caller
  await changePasswordLimiter.consume(`user:${auth.user?.id}`);
  
  const res = await authClient.changePassword({ currentPassword, newPassword });
  // ... existing error handling
}

export async function linkPassword(newPassword: string) {
  const auth = useAuth();
  await linkPasswordLimiter.consume(`user:${auth.user?.id}`);
  
  // ... existing implementation with CSRF token
}
```

**Note:** For `changePassword`/`linkPassword`, the caller (React component) must pass `userId` since these aren't hooks.

**File:** `frontend/src/components/auth/RateLimitErrorToast.tsx` (new)

```tsx
// Toast for rate limit errors
import { useToast } from "./toast";

export function useRateLimitHandler() {
  const toast = useToast();
  
  return (error: unknown) => {
    if (error instanceof RateLimitError) {
      const mins = Math.ceil(error.retryAfterMs / 60000);
      toast.error(`Too many attempts. Try again in ${mins} minute(s).`);
      return true; // handled
    }
    return false;
  };
}
```

### Integration in Components

```tsx
// frontend/src/components/auth/SignInForm.tsx
const handleRateLimit = useRateLimitHandler();

const handleSubmit = async (e) => {
  try {
    await signIn(email, password);
  } catch (err) {
    if (handleRateLimit(err)) return;
    // ... other error handling
  }
};
```

### Testing
```bash
# Rapid sign-in attempts (should block after 5)
for i in {1..7}; do
  curl -X POST http://localhost:4321/api/auth/signin \
    -H "Content-Type: application/json" \
    -d '{"email":"test@test.com","password":"wrong"}'
done

# Should return 429 after 5th attempt
```

---

## Implementation Order

| Phase | Task | Files | Est. Time |
|-------|------|-------|-----------|
| **1** | Backend JWT `jti` + Redis replay check | `backend/app/deps.py`, `backend/app/main.py` | 2h |
| **2** | CSRF token generation/verification | `frontend/src/lib/csrf.ts`, `frontend/src/pages/api/csrf-token.ts` | 1h |
| **3** | Protect `/api/link-password` with CSRF | `frontend/src/pages/api/link-password.ts`, `frontend/src/lib/auth.ts` | 1h |
| **4** | BetterAuth cookie `SameSite=Strict` | `backend/lib/auth.ts` | 0.5h |
| **5** | Client-side rate limiter | `frontend/src/lib/rate-limiter.ts` | 1h |
| **6** | Wrap auth functions + UI toasts | `frontend/src/lib/auth.ts`, `frontend/src/components/auth/*.tsx` | 1.5h |
| **7** | E2E tests for all three | `frontend/e2e/auth-security.spec.ts` | 1h |

**Total: ~8 hours**

---

## Rollback Plan

| Feature | Rollback |
|---------|----------|
| JWT `jti` | Remove `jti` from payload; disable Redis check |
| CSRF | Remove `X-CSRF-Token` header check; revert cookie `SameSite=lax` |
| Rate limiting | Comment out `limiter.consume()` calls |

All changes are additive — no breaking changes to existing flows.

---

## Acceptance Criteria

- [ ] Token replay returns 401 within TTL window
- [ ] `/api/link-password` returns 403 without valid CSRF token
- [ ] `signIn` blocks after 5 attempts/15min per email+IP
- [ ] `signUp` blocks after 3 attempts/hour per IP
- [ ] `changePassword`/`linkPassword` block after 3/hour per user
- [ ] All existing auth flows work (login, signup, OAuth, 2FA, logout)
- [ ] E2E tests pass in CI