// Neon Auth client (singleton, browser only). Phase 2 of the v6 plan.
//
// Neon owns the user table, the session cookie, and the OAuth/email
// flows. Our app only needs:
//   - the React client (for useSession / useUser hooks in components),
//   - a getAccessToken() helper that the API adapter uses to mint
//     `Authorization: Bearer <jwt>` for our FastAPI backend, and
//   - signOut() / deleteUser() helpers that the danger-zone + account
//     row call.
//
// Cookie is on Neon's origin, so it is NOT sent to our API; the
// access token from getJWTToken() is the only thing the browser shares
// with us. SSR-safe: any direct property access during render reads
// from a frozen default; the live client only exists after hydration.

import { createAuthClient } from "@neondatabase/auth";
import { BetterAuthReactAdapter } from "@neondatabase/auth/react/adapters";

const url = import.meta.env.PUBLIC_NEON_AUTH_URL;
if (!url) {
  // Surface a clear build/runtime error if the env is missing rather
  // than letting the SDK throw an opaque "URL is required" later.
  throw new Error(
    "PUBLIC_NEON_AUTH_URL is not set. Add it to frontend/.env (see .env.example).",
  );
}

export const authClient = createAuthClient(url, {
  adapter: BetterAuthReactAdapter(),
});

export type AuthClient = typeof authClient;

/**
 * Return the current access token (JWT) or null when signed out.
 *
 * The Neon cookie lives on Neon's origin and is not sent to our API,
 * so the browser has to read the JWT from the client and forward it
 * as `Authorization: Bearer <token>` on every request. The token
 * arrives in `getSession().session.token` (Better Auth session shape).
 */
export async function getAccessToken(): Promise<string | null> {
  const result = await authClient.getSession();
  const token = result?.data?.session?.token;
  return typeof token === "string" && token.length > 0 ? token : null;
}

/** Sign out of Neon and clear the session cookie. */
export async function apiLogout(): Promise<void> {
  await authClient.signOut();
}

/**
 * Render a Neon SDK failure as user-safe copy. The SDK *throws* on
 * HTTP errors (it does not resolve `{error}`): the thrown error
 * carries the server body (`{code, message}`) with `.message` set to
 * the server's message — e.g. "User already exists. Use another
 * email." Swallowing it behind a generic string hides the exact rule
 * that fired, so prefer it. Bare TypeErrors never reached the server
 * (DNS/refused/offline) → connection copy instead.
 */
export function sdkMessage(error: unknown, fallback: string): string {
  if (error instanceof TypeError) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  const err = error as {
    message?: unknown;
    body?: { message?: unknown } | null;
  } | null;
  const body = err?.body;
  const bodyMessage =
    typeof body === "object" && body !== null ? body.message : undefined;
  if (typeof bodyMessage === "string" && bodyMessage) return bodyMessage;
  if (typeof err?.message === "string" && err.message) return err.message;
  return fallback;
}

/**
 * Delete the Neon user account. Returns true on success. If the SDK
 * does not expose this method — or the server rejects the delete
 * (feature disabled, stale session, verification-email flow) — returns
 * false so the caller falls back to signOut and a support banner
 * (see auth plan §23).
 */
export async function deleteNeonUser(): Promise<boolean> {
  const client = authClient as unknown as {
    deleteUser?: () => Promise<unknown>;
  };
  if (typeof client.deleteUser !== "function") return false;
  try {
    await client.deleteUser();
  } catch {
    return false;
  }
  return true;
}
