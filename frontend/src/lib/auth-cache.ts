// Pure, framework-free cache and token helpers used by `lib/auth.ts`.
// This module exists so the node test suite can exercise identity-scoped
// caching, request dedupe, and token failure classification without
// pulling in React, BetterAuth, or Astro's `import.meta.env`. The
// React-facing facade (lib/auth.ts) wraps these primitives.

export type TokenReason =
  | "ok"
  | "missing-config"
  | "network"
  | "timeout"
  | "rate-limited"
  | "server"
  | "malformed"
  | "client-error"
  | "unexpected-status";

export type TokenResult =
  | { reason: "ok"; token: string }
  | { reason: Exclude<TokenReason, "ok"> };

/**
 * Build the protected-request headers only after token minting succeeded.
 * Keeping this boundary pure makes the security invariant testable: every
 * non-ok token outcome produces no Authorization header.
 */
export function withBearerToken(
  headers: Record<string, string>,
  result: TokenResult,
): Record<string, string> | null {
  if (result.reason !== "ok") return null;
  return { ...headers, Authorization: `Bearer ${result.token}` };
}

export type TaggedCache<T> = {
  promise: Promise<T>;
  userId: string;
};

export function isStaleTagged<T>(
  entry: TaggedCache<T> | null,
  userId: string,
): boolean {
  return entry == null || entry.userId !== userId;
}

/**
 * Shared identity-scoped cache helper. Concurrent calls for the same
 * userId share one in-flight promise; a rejection clears the cache
 * so the next caller retries; a successful resolution is retained
 * until the userId changes (T41).
 *
 * `onReject` receives the entry that just rejected; if it still
 * matches the module's stored cache, the helper clears it so the
 * next call can retry. Callers pass the clear closure because each
 * module has its own cache slot.
 */
export function sharedTaggedFetch<T>(
  current: TaggedCache<T> | null,
  next: () => Promise<T>,
  userId: string,
  setCurrent: (entry: TaggedCache<T> | null) => void,
  isCurrent: (entry: TaggedCache<T>) => boolean,
): { entry: TaggedCache<T>; result: Promise<T> } {
  if (current && current.userId === userId) {
    return { entry: current, result: current.promise };
  }
  const promise = next();
  const entry: TaggedCache<T> = { promise, userId };
  setCurrent(entry);
  void promise.catch(() => {
    if (isCurrent(entry)) setCurrent(null);
  });
  return { entry, result: promise };
}

/**
 * Pure token-mint logic (T39/T40). One attempt with timeout, no
 * network. The wrapper in auth.ts adds the dedupe, retry, and cache.
 * Errors are classified by reason so the caller can decide whether
 * the session is invalid (which it never is from this endpoint) or
 * whether the auth service is merely unreachable.
 */
export async function mintTokenOnce(
  base: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<TokenResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${base}/api/auth/token`, {
      credentials: "include",
      signal: controller.signal,
    });
    if (!res.ok) {
      // 429 and 5xx should be treated as transient and retried later.
      if (res.status === 429) return { reason: "rate-limited" };
      if (res.status >= 500) return { reason: "server" };
      // 400, 401, 403 are non-retryable client errors.
      if (res.status >= 400 && res.status < 500) return { reason: "client-error" };
      // Any other non-2xx response (for example an unexpected 3xx) is
      // terminal. It is not evidence of a transient auth outage.
      return { reason: "unexpected-status" };
    }
    const data: unknown = await res.json().catch(() => null);
    const token =
      typeof data === "object" && data !== null
        ? (data as { token?: unknown }).token
        : null;
    if (typeof token !== "string" || !token) return { reason: "malformed" };
    return { reason: "ok", token };
  } catch (err) {
    if (
      typeof DOMException !== "undefined" &&
      err instanceof DOMException &&
      err.name === "AbortError"
    ) {
      return { reason: "timeout" };
    }
    return { reason: "network" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One bounded retry on transient failures only (timeout / network /
 * rate-limited / server). Never retries confirmed-ok, missing-config,
 * client-error, or malformed responses — those outcomes are terminal.
 * (T40/T49): 400/401/403 must not retry; retrying them just repeats a
 * request the server has already answered authoritatively. The second
 * attempt's outcome is returned as-is.
 */
export async function mintTokenWithRetry(
  base: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  backoffMs: number = 200,
): Promise<TokenResult> {
  const first = await mintTokenOnce(base, fetchImpl, timeoutMs);
  if (
    first.reason === "ok" ||
    first.reason === "missing-config" ||
    first.reason === "client-error" ||
    first.reason === "unexpected-status" ||
    first.reason === "malformed"
  ) {
    return first;
  }
  await new Promise((r) => setTimeout(r, backoffMs));
  return mintTokenOnce(base, fetchImpl, timeoutMs);
}
