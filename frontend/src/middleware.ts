import { defineMiddleware } from "astro:middleware";

// B37: dev-only showcases (/mockup, /mockups) must not ship. An early
// return in those pages' frontmatter breaks this Astro version's build
// (frontmatter control flow + is:inline styles with quoted font names
// fail the vite transform), so the gate lives here instead: in
// production builds both routes answer a bare 404 (no redirect, no
// flash, no content); `astro dev` (DEV) passes them through untouched.
const DEV_ONLY_ROUTES = new Set(["/mockup", "/mockups"]);

export const onRequest = defineMiddleware((context, next) => {
  if (!import.meta.env.DEV && DEV_ONLY_ROUTES.has(context.url.pathname)) {
    return new Response(null, { status: 404 });
  }
  return next();
});
