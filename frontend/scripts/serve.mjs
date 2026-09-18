// B38: edge compression for the standalone server.
//
// PARKED 2026-09-18 — DO NOT point the rig at this until T89 is
// resolved: buffering static assets through this proxy
// non-deterministically breaks Astro island hydration (handlers never
// attach, zero console errors; same dist on `astro preview` hydrates
// fine). The compression CODE is verified byte-perfect (br decode ==
// direct bytes for every chunk); the delivery SHAPE (store-and-forward
// vs streaming) is the suspect. Revival sketch in the H audit (T89):
// stream-through responses + compress via TransformStream, or serve
// precompressed statics, so the browser parses progressively as with
// preview. `npm run serve` script removed so nothing boots it by
// accident; the middleware (in-app, streaming-safe) is the live half
// of the compression work.
//
// Usage: `npm run serve` (needs dist/ from `npm run build`).
//   PORT/HOST      — this proxy's listen socket (default 4323/localhost)
//   UPSTREAM_PORT  — the standalone entry behind it (default 4324)

import http from "node:http";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(__dirname, "..");

const PORT = Number(process.env.PORT ?? 4323);
const HOST = process.env.HOST ?? "localhost";
const UPSTREAM_PORT = Number(process.env.UPSTREAM_PORT ?? 4324);

const COMPRESSIBLE =
  /^(text\/|application\/(javascript|json|.*\+xml)|image\/svg\+xml)/;
const MIN_BYTES = 1024;

function pickEncoding(accept) {
  if (accept.includes("br")) return "br";
  if (accept.includes("gzip")) return "gzip";
  return null;
}

// Forwarding upstream framing headers verbatim poisons the client
// socket: Astro's Node server chunk-encodes dynamic responses, so a
// piped writeHead that keeps `transfer-encoding` alongside (our)
// `content-length` is an HTTP violation — curl 000s, browsers fail
// the request (-1 in the trace; get-session died exactly this way).
// Strip hop-by-hop/framing headers everywhere; Node re-frames the
// socket itself (content-length when we set one, chunked otherwise).
function cleanHeaders(upHeaders) {
  const h = { ...upHeaders };
  delete h["transfer-encoding"];
  delete h["connection"];
  delete h["keep-alive"];
  delete h["upgrade"];
  return h;
}

const server = http.createServer((clientReq, clientRes) => {
  const up = http.request(
    {
      host: "127.0.0.1",
      port: UPSTREAM_PORT,
      path: clientReq.url,
      method: clientReq.method,
      // Forward headers verbatim — notably `host` and `origin`. The
      // first version rewrote host to 127.0.0.1:4324 and every
      // BetterAuth POST (signup/signin/link/2FA) died on origin
      // validation while GETs (no CSRF check) sailed through —
      // half of section-f went red with zero app change. The entry
      // has no vhosts; it doesn't care what Host says.
      headers: clientReq.headers,
    },
    (upRes) => {
      const type = upRes.headers["content-type"] ?? "";
      const enc = pickEncoding(clientReq.headers["accept-encoding"] ?? "");
      // Streams and friends pipe byte-identical — never buffered.
      if (
        type.includes("text/event-stream") ||
        upRes.headers["content-encoding"] != null ||
        upRes.statusCode === 204 ||
        upRes.statusCode === 304 ||
        clientReq.method === "HEAD" ||
        enc == null ||
        !COMPRESSIBLE.test(type)
      ) {
        clientRes.writeHead(upRes.statusCode, cleanHeaders(upRes.headers));
        upRes.pipe(clientRes);
        return;
      }
      const chunks = [];
      upRes.on("data", (c) => chunks.push(c));
      upRes.on("end", () => {
        try {
          const input = Buffer.concat(chunks);
          if (input.length < MIN_BYTES) {
            clientRes.writeHead(upRes.statusCode, cleanHeaders(upRes.headers));
            clientRes.end(input);
            return;
          }
          const out =
            enc === "br" ? brotliCompressSync(input) : gzipSync(input);
          if (out.length >= input.length) {
            clientRes.writeHead(upRes.statusCode, cleanHeaders(upRes.headers));
            clientRes.end(input);
            return;
          }
          clientRes.writeHead(upRes.statusCode, {
            ...cleanHeaders(upRes.headers),
            "content-encoding": enc,
            "content-length": String(out.length),
            vary: "Accept-Encoding",
          });
          clientRes.end(out);
        } catch {
          clientRes.writeHead(upRes.statusCode, cleanHeaders(upRes.headers));
          clientRes.end(Buffer.concat(chunks));
        }
      });
      upRes.on("error", () => clientRes.destroy());
    },
  );
  up.on("error", () => {
    clientRes.writeHead(502, { "content-type": "text/plain" });
    clientRes.end("upstream unavailable");
  });
  clientReq.pipe(up);
});

// Boot the standalone entry behind the proxy (same dist the rig
// measures). `ENTRY_ALREADY_RUNNING` lets producers run it separately.
let child = null;
if (!process.env.ENTRY_ALREADY_RUNNING) {
  child = spawn(
    "node",
    ["./dist/server/entry.mjs"],
    {
      cwd: FRONTEND,
      env: {
        ...process.env,
        PORT: String(UPSTREAM_PORT),
        HOST: "127.0.0.1",
        PUBLIC_BETTER_AUTH_URL: `http://localhost:${PORT}`,
      },
      stdio: "inherit",
    },
  );
  child.on("exit", (code) => {
    console.error(`[serve] entry exited ${code}`);
    process.exit(code ?? 1);
  });
}
server.listen(PORT, HOST, () => {
  console.log(`[serve] edge :${PORT} -> entry :${UPSTREAM_PORT} (br/gzip)`);
});
process.on("SIGTERM", () => {
  child?.kill();
  server.close(() => process.exit(0));
});
