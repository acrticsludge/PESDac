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
 * Link the Google identity to the currently signed-in Neon user.
 * The user must already be authenticated (e.g. via email+password):
 * Neon returns the Google authorization URL, we redirect there and
 * back — then future Google sign-ins land on the same account instead
 * of `account_not_linked`.
 *
 * SDK truth: the Neon wrapper's narrowed type hides the link route, so
 * this calls the underlying Better Auth endpoint directly
 * (POST /link-social — same contract the SDK's own adapters use:
 * session cookie via credentials:include, JSON body, `{url,redirect}`
 * response). Failures throw SDK-shaped errors (see sdkMessage).
 */
export async function linkGoogleAccount(): Promise<void> {
  // /link-social validates callbackURL as an absolute URL server-side
  // (relative "/new" → ERR_INVALID_URL), so build it from the origin.
  const origin = window.location.origin;
  const res = await fetch(`${url.replace(/\/+$/, "")}/link-social`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "google",
      callbackURL: `${origin}/new`,
      errorCallbackURL: `${origin}/new?error=linking-failed`,
    }),
  });
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const body =
      typeof parsed === "object" && parsed !== null
        ? (parsed as { message?: unknown; code?: unknown })
        : null;
    const message =
      typeof body?.message === "string" && body.message
        ? body.message
        : "Couldn't link Google. Try again.";
    throw new Error(message);
  }
  const redirectUrl =
    typeof parsed === "object" && parsed !== null
      ? (parsed as { url?: unknown }).url
      : undefined;
  if (typeof redirectUrl !== "string" || !redirectUrl) {
    // Already linked (status:true, no URL): nothing further to do.
    return;
  }
  window.location.assign(redirectUrl);
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
