// User-safe copy mappers for the auth pages (error-ui.md E7).
//
// Pure functions — no React, no network — so the typed copy is unit
// tested here instead of behind a component render. `AuthLayout`
// renders whatever these return; it never invents copy inline.
// Raw provider/server messages are never returned: every branch ends
// in an authored string or the caller-supplied fallback.

import { toUserMessage } from "./auth.ts";

/**
 * Google sign-in rejection → typed message. Covers invalid_client,
 * redirect mismatch, user cancellation, stale state, and network
 * failure; anything unrecognized stays generic (never raw).
 */
export function toGoogleSignInMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  const haystack = `${raw}`.toLowerCase();
  if (
    haystack.includes("invalid_client") ||
    haystack.includes("client_id") ||
    haystack.includes("oauth_client")
  ) {
    return "Google sign-in isn't set up. Contact support.";
  }
  if (
    haystack.includes("redirect_uri") ||
    haystack.includes("redirect_mismatch")
  ) {
    return "Google sign-in redirect was blocked. Try again.";
  }
  if (
    haystack.includes("access_denied") ||
    haystack.includes("user_cancelled") ||
    haystack.includes("canceled") ||
    haystack.includes("cancelled")
  ) {
    return "Google sign-in was cancelled. Try again when you're ready.";
  }
  if (
    haystack.includes("state") ||
    haystack.includes("invalid_request") ||
    haystack.includes("expired")
  ) {
    return "Google sign-in link expired. Try again.";
  }
  if (
    haystack.includes("network") ||
    haystack.includes("failed to fetch") ||
    haystack.includes("timeout")
  ) {
    return "Couldn't reach Google. Check your connection and try again.";
  }
  return "Google sign-in failed. Try again.";
}

/**
 * Email sign-in/sign-up server failure → user-safe copy. Sign-in stays
 * non-enumerating (the server answers the same INVALID_EMAIL_OR_PASSWORD
 * for unknown email and wrong password, and the copy never distinguishes
 * them). Sign-up names the already-registered case because the server
 * itself reveals it — and "log in instead" is the fix.
 */
export function toEmailAuthMessage(error: unknown, isSignup: boolean): string {
  let haystack = "";
  if (typeof error === "object" && error !== null) {
    const e = error as { code?: unknown; message?: unknown };
    haystack = `${String(e.code ?? "")} ${String(e.message ?? "")}`;
  }
  if (isSignup && (/EXISTS/.test(haystack) || /already/i.test(haystack))) {
    return "That email is already registered. Log in instead.";
  }
  return isSignup
    ? "Couldn't create your account. Try again."
    : "Couldn't sign in with those details. Check your email and password and try again.";
}

/**
 * Second-factor verification failure → typed message. Rate-limit and
 * expiry get their own copy (the fix differs: wait vs fetch a fresh
 * code); everything else rides the shared funnel with the same
 * fallback the form used before.
 */
export function toTwoFactorMessage(error: unknown): string {
  const fallback = "That code didn't work. Try again.";
  let haystack = "";
  if (typeof error === "object" && error !== null) {
    const e = error as { code?: unknown; message?: unknown };
    haystack =
      `${String(e.code ?? "")} ${String(e.message ?? "")}`.toLowerCase();
  } else if (error instanceof Error) {
    haystack = error.message.toLowerCase();
  }
  if (
    haystack.includes("rate") ||
    haystack.includes("limit") ||
    haystack.includes("too many") ||
    haystack.includes("429")
  ) {
    return "Too many attempts. Wait a bit and try again.";
  }
  if (haystack.includes("expired")) {
    return "That code expired. Enter a fresh code from your app.";
  }
  return toUserMessage(error, fallback);
}
