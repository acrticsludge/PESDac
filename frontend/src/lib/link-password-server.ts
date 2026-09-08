/**
 * Server-side link-password handler (Astro, same origin).
 *
 * Why this exists: attaching a first password to a Google-only account
 * requires BetterAuth's `auth.api.setPassword`, which is declared
 * `createAuthEndpoint.serverOnly()` — in-process only, with NO HTTP path.
 * The old backend route proxied to `POST {BETTER_AUTH_URL}/api/auth/set-password`
 * over HTTP, which BetterAuth 1.7.3 answers with 404 (proven live: the
 * endpoint exists nowhere in the installed package; `/change-password`
 * exists but rejects passwordless users with CREDENTIAL_ACCOUNT_NOT_FOUND).
 * So the call must happen inside the Astro server, which already hosts the
 * BetterAuth instance (see `src/pages/api/auth/[...slug].ts`).
 *
 * This module is intentionally dependency-free: the BetterAuth call is an
 * injected `setPassword` so node:test can exercise every branch with fakes
 * (no env, no DB, no BetterAuth import). The thin Astro route in
 * `src/pages/api/link-password.ts` wires the real `auth.api.setPassword`.
 *
 * Protections mirror the old backend route: same-origin check (allowlist
 * of one — our own origin; CSRF control since the session cookie rides
 * along), 5 attempts / 5 min per IP, and the 8-128 length policy the
 * server re-validates authoritatively.
 */

/** Must match BetterAuth's emailAndPassword policy (lib/auth.ts). */
export const LINK_PASSWORD_MIN_LENGTH = 8;
export const LINK_PASSWORD_MAX_LENGTH = 128;

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;

/** Structural subset of `auth.api.setPassword` used here. */
export type SetPasswordFn = (args: {
  body: { newPassword: string };
  headers: Headers;
}) => Promise<{ status: boolean }>;

export type LinkPasswordRequest = {
  /** Exact-match allowlist of one: our own origin (e.g. http://localhost:4321). */
  selfOrigin: string;
  origin: string | null;
  referer: string | null;
  clientIp: string;
  /** Raw parsed body (null when the JSON was missing or malformed). */
  body: unknown;
  /** Forwarded verbatim — BetterAuth reads the session cookie off these. */
  headers: Headers;
};

export type LinkPasswordDeps = {
  setPassword: SetPasswordFn;
  now?: () => number;
  /** Overrideable bucket store; defaults to a module-level Map. */
  attempts?: Map<string, number[]>;
};

const defaultAttempts = new Map<string, number[]>();

/** Test seam: reset the module-level rate-limit buckets between tests. */
export function __clearLinkPasswordAttemptsForTesting(): void {
  defaultAttempts.clear();
}

function errorBody(code: string, message: string): {
  error: { code: string; message: string };
} {
  // Same nested envelope as the FastAPI backend (app/schemas/common.py)
  // so the frontend parses one shape for both origins.
  return { error: { code, message } };
}

function originOf(value: string): string {
  try {
    const url = new URL(value);
    if (!url.protocol || !url.host) return "";
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return "";
  }
}

/** Unknown-safe extraction of better-call's APIError ({statusCode, body:{code,message}}). */
function apiErrorParts(e: unknown): {
  status: number;
  code: string;
  message: string;
} | null {
  if (typeof e !== "object" || e === null) return null;
  const status = (e as { statusCode?: unknown }).statusCode;
  if (typeof status !== "number") return null;
  const body = (e as { body?: unknown }).body;
  if (typeof body === "object" && body !== null) {
    const { code, message } = body as { code?: unknown; message?: unknown };
    if (typeof code === "string" && typeof message === "string") {
      return { status, code, message };
    }
  }
  return { status, code: "AUTH_ERROR", message: "" };
}

export async function handleLinkPassword(
  req: LinkPasswordRequest,
  deps: LinkPasswordDeps,
): Promise<{ status: number; body: unknown; headers?: Record<string, string> }> {
  const self = req.selfOrigin.toLowerCase();
  // Same rule as the backend's check_mutation_origin with the allowlist
  // reduced to self: non-browser clients (no Origin AND no Referer) pass;
  // any present header must match our own origin exactly.
  if (req.origin !== null || req.referer !== null) {
    if (req.origin !== null && originOf(req.origin) !== self) {
      return { status: 403, body: errorBody("FORBIDDEN", "Origin not allowed.") };
    }
    if (req.origin === null && req.referer !== null && originOf(req.referer) !== self) {
      return { status: 403, body: errorBody("FORBIDDEN", "Origin not allowed.") };
    }
  }

  const password =
    typeof req.body === "object" && req.body !== null
      ? (req.body as { newPassword?: unknown }).newPassword
      : undefined;
  if (typeof password !== "string" || password.length < LINK_PASSWORD_MIN_LENGTH) {
    return {
      status: 400,
      body: errorBody("AUTH_VALIDATION", "Password must be at least 8 characters."),
    };
  }
  if (password.length > LINK_PASSWORD_MAX_LENGTH) {
    return {
      status: 400,
      body: errorBody("AUTH_VALIDATION", "Password must be at most 128 characters."),
    };
  }

  const now = deps.now?.() ?? Date.now();
  const store = deps.attempts ?? defaultAttempts;
  // Opportunistic sweep: drop expired hits (and empty buckets) on every
  // call so the store cannot grow without bound on distinct IPs. Uses
  // the same clock as the check below, so injected fake clocks in tests
  // stay deterministic.
  for (const [key, stamps] of store) {
    const live = stamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (live.length > 0) {
      store.set(key, live);
    } else {
      store.delete(key);
    }
  }
  const hits = store.get(req.clientIp) ?? [];
  if (hits.length >= RATE_LIMIT_MAX) {
    return {
      status: 429,
      body: errorBody("RATE_LIMITED", "Too many attempts. Try again later."),
      // Contract parity with the old backend route (Retry-After on 429).
      headers: { "Retry-After": String(RATE_LIMIT_WINDOW_MS / 1000) },
    };
  }
  hits.push(now);
  store.set(req.clientIp, hits);

  try {
    await deps.setPassword({ body: { newPassword: password }, headers: req.headers });
  } catch (e) {
    const parts = apiErrorParts(e);
    if (!parts) {
      return {
        status: 500,
        body: errorBody("AUTH_ERROR", "Couldn't link password. Try again."),
      };
    }
    if (parts.status === 401) {
      // No/invalid session. The frontend maps 401 to the re-login flow,
      // exactly like a backend 401 — the session is genuinely dead.
      return { status: 401, body: errorBody("UNAUTHORIZED", "Sign in to continue.") };
    }
    if (parts.status >= 500) {
      // Never leak internal failure detail; the server log carries it.
      return {
        status: 500,
        body: errorBody("AUTH_ERROR", "Couldn't link password. Try again."),
      };
    }
    // 4xx (PASSWORD_ALREADY_SET, PASSWORD_TOO_SHORT/LONG): BetterAuth's
    // message is user-safe — surface it so the modal can say WHY.
    return {
      status: parts.status,
      body: errorBody(parts.code, parts.message || "Couldn't link password. Try again."),
    };
  }
  return { status: 200, body: { ok: true } };
}
