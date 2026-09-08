import type { APIRoute } from "astro";
import { auth } from "../../../../lib/auth";
import { handleLinkPassword } from "../../lib/link-password-server";

export const prerender = false;

// Same-origin link-password route. Calls BetterAuth's serverOnly
// `auth.api.setPassword` IN PROCESS — it has no HTTP path, so the old
// backend proxy to /api/auth/set-password could only ever 404. The
// browser's BetterAuth session cookie arrives same-origin; it is
// forwarded verbatim so BetterAuth verifies the session server-side.
// Only POST is exported — other methods fall through to Astro's 404.
export const POST: APIRoute = async ({ request, clientAddress, url }) => {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const result = await handleLinkPassword(
    {
      selfOrigin: url.origin,
      origin: request.headers.get("origin"),
      referer: request.headers.get("referer"),
      // Per-IP rate-limit key. clientAddress is the direct peer: behind a
      // proxy without trusted forwarding every client collapses into one
      // bucket (or "unknown"). Do NOT read X-Forwarded-For without a
      // trusted-proxy allowlist (cf. BETTER_AUTH_TRUSTED_PROXIES in
      // lib/auth.ts) — it is client-spoofable. Local/dev serving is direct,
      // so the key is exact there.
      clientIp: clientAddress ?? "unknown",
      body,
      headers: request.headers,
    },
    {
      setPassword: async (args) => {
        await auth.api.setPassword(args);
        return { status: true };
      },
    },
  );
  return Response.json(result.body, { status: result.status, headers: result.headers });
};
