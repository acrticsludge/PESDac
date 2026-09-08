// Logout-transition guard (logout + Google relogin flow fix).
//
// The logout click flips the visible session to guest BEFORE navigation to
// /login commits: clearAuthCache() bumps the auth epoch immediately
// (epoch-invalidating in-flight apiGetMe/apiGetProfile/listAccounts
// promises), then BetterAuth signOut resolves and useAuth() reads guest
// while still on the app route. Without this window the app reacts
// truthfully to the transient guest state — AuthGate opens on the app
// route and epoch-killed fetches surface account-data errors — and only
// then does navigate("/login") dismiss the just-opened gate.
//
// Every suppression gated on this window covers transition noise ONLY:
// logout's own server-failed/catch toasts and genuine 401s outside the
// window are untouched. New module (not a shared-file hunk) so the
// parallel link-password fix cannot collide with it.

export const LOGOUT_TRANSITION_EVENT = "pesdac:logout-transition";

let logoutTransition = false;

/** True from logout click until navigation to /login commits. */
export function isLogoutTransition(): boolean {
  return logoutTransition;
}

function emitTransition(): void {
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new CustomEvent(LOGOUT_TRANSITION_EVENT));
    } catch {
      // SSR / no-window fallback (only test harness reaches here).
    }
  }
}

/** Open the window at logout click (also used by the expiry-logout flow). */
export function beginLogoutTransition(): void {
  logoutTransition = true;
  emitTransition();
}

/** Close the window once navigation to /login has committed. */
export function endLogoutTransition(): void {
  logoutTransition = false;
  emitTransition();
}

/**
 * Transition noise vs genuine failure. Epoch-invalidated fetches reject
 * with "identity-changed" (see lib/auth.ts TaggedCache guards) exactly
 * when the session intentionally changed under them — inside the logout
 * window that rejection is expected, never an error worth surfacing.
 * Anything else (ApiError, AuthRequiredError, TypeError, …) is a real
 * outcome and must keep its existing handling.
 */
export function isTransitionNoise(error: unknown): boolean {
  return error instanceof Error && error.message === "identity-changed";
}

/** Test seam: reset without emitting (mirrors __resetAuthCachesForTesting). */
export function __resetLogoutTransitionForTesting(): void {
  logoutTransition = false;
}
