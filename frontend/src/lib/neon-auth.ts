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
 * Delete the Neon user account. Returns true on success. If the SDK
 * does not expose this method the caller should fall back to signOut
 * and a support banner (see auth plan §23).
 */
export async function deleteNeonUser(): Promise<boolean> {
  const client = authClient as unknown as {
    deleteUser?: () => Promise<unknown>;
  };
  if (typeof client.deleteUser !== "function") return false;
  await client.deleteUser();
  return true;
}
