import { defineMiddleware } from "astro:middleware";
import { auth } from "../../../lib/auth";

export const onRequest = defineMiddleware(async (context, next) => {
  // Load the session for SSR pages (gate, onboarding). Three outcomes:
  // user locals (session proved), null locals (PROVED guest — getSession
  // affirmatively returned no session), undefined locals (UNKNOWN — the
  // 800ms race gave up or getSession threw; proved nothing). Unknown
  // stays null-safe for SSR consumers that can't wait (falsy reads as
  // guest); only InitialSession.astro distinguishes it so the client
  // fails closed to `loading` instead of flashing the gate. A
  // short-timeout guard prevents hangs when the auth server is
  // unreachable.
  try {
    const sessionRes = await Promise.race([
      auth.api.getSession({
        headers: context.request.headers,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("SESSION_TIMEOUT")), 800),
      ),
    ]);
    if (sessionRes?.session) {
      context.locals.session = sessionRes.session;
      context.locals.user = sessionRes.user;
    } else {
      context.locals.session = null;
      context.locals.user = null;
    }
  } catch {
    // Timeout or auth server unreachable — UNKNOWN, not guest. The
    // client must wait for the live session check (loading), never
    // open the gate over a session the server never disproved.
    // Method + path + outcome only (no PII/tokens).
    console.warn(
      `[auth] ${context.request.method} ${new URL(context.request.url).pathname} session=unknown`,
    );
    context.locals.session = undefined;
    context.locals.user = undefined;
  }
  return next();
});
