import { defineMiddleware } from "astro:middleware";
import { brotliCompressSync, gzipSync } from "node:zlib";

// B37: dev-only showcases (/mockup, /mockups) must not ship. An early
// return in those pages' frontmatter breaks this Astro version's build
// (frontmatter control flow + is:inline styles with quoted font names
// fail the vite transform), so the gate lives here instead: in
// production builds both routes answer a bare 404 (no redirect, no
// flash, no content); `astro dev` (DEV) passes them through untouched.
const DEV_ONLY_ROUTES = new Set(["/mockup", "/mockups"]);

// B38: the standalone Node server (and `astro preview`) serves every
// byte uncompressed — ~1.2MB of JS+CSS at Slow-3G's 50KB/s is the
// whole ~26s gate number. Compress compressible responses here so the
// fix rides every deployment without a CDN in front. Deliberately
// conservative: text types only, identity fallback always available,
// streams (event-stream — the chat path must never be buffered) and
// HEAD/204/304 pass through untouched, and a Vary header keeps shared
// caches honest.
const COMPRESSIBLE =
  /^(text\/|application\/(javascript|json|.*\+xml)|image\/svg\+xml)/;
const MIN_BYTES = 1024;

export const onRequest = defineMiddleware(async (context, next) => {
  if (!import.meta.env.DEV && DEV_ONLY_ROUTES.has(context.url.pathname)) {
    return new Response(null, { status: 404 });
  }
  const res = await next();
  if (context.request.method === "HEAD") return res;
  if (res.status === 204 || res.status === 304) return res;
  const type = res.headers.get("content-type") ?? "";
  // Never buffer a stream: event-stream responses must flow, not compress.
  if (type.includes("text/event-stream")) return res;
  if (!COMPRESSIBLE.test(type)) return res;
  if (res.headers.get("content-encoding") != null) return res;
  const accept = context.request.headers.get("accept-encoding") ?? "";
  const wantBr = accept.includes("br");
  const wantGzip = accept.includes("gzip");
  if (!wantBr && !wantGzip) return res;
  // NOTE: arrayBuffer() CONSUMES res — after this point the original
  // must never be returned (a consumed body sends as a corpse: Astro
  // 500s "Internal server error"). Every path below builds a FRESH
  // Response from the buffered bytes. (Bitten: every sub-MIN_BYTES
  // API response 500d until this was rebuilt — get-session is 531B.)
  const input = Buffer.from(await res.arrayBuffer());
  const passthrough = () =>
    new Response(input, { status: res.status, headers: res.headers });
  if (input.length < MIN_BYTES) return passthrough();
  try {
    const out = wantBr ? brotliCompressSync(input) : gzipSync(input);
    // Brotli can (rarely) inflate pathological inputs — never ship
    // bigger than what arrived.
    if (wantBr && !wantGzip && out.length >= input.length)
      return passthrough();
    const headers = new Headers(res.headers);
    headers.set("content-encoding", wantBr ? "br" : "gzip");
    headers.set("content-length", String(out.length));
    headers.append("vary", "Accept-Encoding");
    return new Response(out, { status: res.status, headers });
  } catch {
    return passthrough();
  }
});
