// Shared API error surface (audit §6 leaf split).
//
// Leaf module by construction: imports only a type from auth-cache, so
// lib/auth.ts (and every consumer) can import from here with no import
// cycle. lib/auth.ts re-exports everything below — consumers keep their
// single `../../lib/auth` import path. Further domain splits
// (profile/chats/demo-state clients) follow this same leaf-first shape.

import type { TokenReason } from "../auth-cache.ts";

// Server's error envelope (see app/schemas/common.py + main.py).
export type ApiErrorBody = {
  code: string;
  message: string;
  details?: unknown;
};

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;
  constructor(status: number, body: ApiErrorBody | null, fallback: string) {
    super(body?.message ?? fallback);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/** 401: caller should open the gate (UX-only; the server enforces auth). */
export class AuthRequiredError extends ApiError {
  constructor(body: ApiErrorBody | null) {
    super(401, body, "Sign in to continue.");
    this.name = "AuthRequiredError";
  }
}

/**
 * Render any caught failure as user-safe copy (error surface F3).
 * ApiError carries the server envelope message (server-authored,
 * user-safe). A TypeError means the request never reached the server
 * (DNS/refused/offline) — the browser's "Failed to fetch" means
 * nothing to users, so map it to connection copy. Same for an
 * AbortError from the apiFetch timeout below.
 *
 * Status code mapping (per slice 15):
 * - 404: the URL the frontend asked for doesn't exist on the server.
 *   The user can't fix this and shouldn't be told to "restart the
 *   server" (they don't have access). Tell them to try again later;
 *   the operator's 404 surfaces in the server log.
 * - 5xx: server error. Same user-safe copy. The ref ID is logged
 *   server-side for the operator; the client never sees it.
 * - Other 4xx: server-authored user-safe message if it has one,
 *   else the fallback.
 */
export function toUserMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return "That didn't work. Please try again later.";
    }
    if (error.status >= 500) {
      return "That didn't work on our end. Please try again later.";
    }
    return error.message && error.message !== "Not Found"
      ? error.message
      : fallback;
  }
  if (error instanceof TypeError) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  if (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  if (error instanceof AuthServiceError) {
    // Token-mint outage/timeout/rate-limit: the message is authored
    // user-safe at construction. Pinned explicitly (not via the generic
    // Error branch) so a future edit to the fallback below cannot
    // regress auth-service copy silently.
    return error.message;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Typed recoverable error for auth-service outages (token-mint failures).
 * These are transient, non-session-invalidating failures that should use
 * existing toast/retry handling and keep the user in the current shell.
 * Distinguished from AuthRequiredError (backend 401) and ApiError (other status codes).
 */
export class AuthServiceError extends Error {
  readonly code: "auth-service-unavailable";
  readonly reason: TokenReason;
  readonly retry?: { afterMs: number };
  constructor(reason: Exclude<TokenReason, "ok">, retry?: { afterMs: number }) {
    const msg = reason === "missing-config" ? "Authentication service is not configured. Please contact your administrator." :
      reason === "network" ? "Couldn't reach the authentication service. Check your connection and try again." :
      reason === "timeout" ? "Authentication service timed out. Please try again." :
      reason === "rate-limited" ? "Too many authentication attempts. Please wait and try again." :
      reason === "server" ? "Authentication service is temporarily unavailable. Please try again later." :
      reason === "malformed" ? "Authentication service returned an invalid response. Please try again." :
      reason === "client-error" ? "Authentication failed. Please check your credentials." :
      reason === "unexpected-status" ? "Authentication service returned an unexpected response. Please try again." :
      "Authentication service failed.";
    super(msg);
    this.name = "AuthServiceError";
    this.code = "auth-service-unavailable";
    this.reason = reason;
    this.retry = retry;
  }
}
