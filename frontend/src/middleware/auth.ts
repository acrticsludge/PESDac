import { defineMiddleware } from "astro:middleware";
import { auth } from "../../../lib/auth";

export const onRequest = defineMiddleware(async (context, next) => {
  // Load the session for SSR pages (gate, onboarding). Guests get
  // null locals; the facade (useAuth/useProfile) reads the cookie
  // client-side independently. A short-timeout guard prevents
  // hangs when the auth server is unreachable.
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
    // Timeout or auth server unreachable — fall back to guest.
    context.locals.session = null;
    context.locals.user = null;
  }
  return next();
});
