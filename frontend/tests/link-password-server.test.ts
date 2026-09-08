// handleLinkPassword unit tests: every branch with a fake setPassword.
// No env, no DB, no BetterAuth import — the handler takes its only
// dependency (the serverOnly setPassword call) as an argument.

import test from "node:test";
import assert from "node:assert/strict";

import {
  handleLinkPassword,
  LINK_PASSWORD_MAX_LENGTH,
  LINK_PASSWORD_MIN_LENGTH,
  __clearLinkPasswordAttemptsForTesting,
  type LinkPasswordRequest,
  type SetPasswordFn,
} from "../src/lib/link-password-server.ts";

const SELF = "http://localhost:4321";

function req(overrides: Partial<LinkPasswordRequest> = {}): LinkPasswordRequest {
  return {
    selfOrigin: SELF,
    origin: `${SELF}`,
    referer: `${SELF}/profile`,
    clientIp: "10.0.0.1",
    body: { newPassword: "passwordpassword" },
    headers: new Headers({ cookie: "better-auth.session_token=abc" }),
    ...overrides,
  };
}

function okSetPassword(calls: Array<{ password: string; headers: Headers }>): SetPasswordFn {
  return async ({ body, headers }) => {
    calls.push({ password: body.newPassword, headers });
    return { status: true };
  };
}

function throwingSetPassword(error: unknown): SetPasswordFn {
  return async () => {
    throw error;
  };
}

function apiError(statusCode: number, code: string, message: string): unknown {
  return { statusCode, body: { code, message } };
}

test("success forwards the password + headers and returns ok:true", async () => {
  __clearLinkPasswordAttemptsForTesting();
  const calls: Array<{ password: string; headers: Headers }> = [];
  const headers = new Headers({ cookie: "better-auth.session_token=abc" });
  const res = await handleLinkPassword(req({ headers, clientIp: "10.0.0.2" }), {
    setPassword: okSetPassword(calls),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].password, "passwordpassword");
  assert.equal(calls[0].headers.get("cookie"), "better-auth.session_token=abc");
});

test("length boundaries: 8 and 128 pass, 7 and 129 reject without calling", async () => {
  __clearLinkPasswordAttemptsForTesting();
  const calls: Array<{ password: string; headers: Headers }> = [];
  const deps = { setPassword: okSetPassword(calls) };
  assert.equal(LINK_PASSWORD_MIN_LENGTH, 8);
  assert.equal(LINK_PASSWORD_MAX_LENGTH, 128);

  const ok8 = await handleLinkPassword(req({ body: { newPassword: "12345678" }, clientIp: "10.0.1.1" }), deps);
  assert.equal(ok8.status, 200);
  const ok128 = await handleLinkPassword(req({ body: { newPassword: "x".repeat(128) }, clientIp: "10.0.1.2" }), deps);
  assert.equal(ok128.status, 200);

  const short = await handleLinkPassword(req({ body: { newPassword: "1234567" }, clientIp: "10.0.1.3" }), deps);
  assert.equal(short.status, 400);
  const long = await handleLinkPassword(req({ body: { newPassword: "x".repeat(129) }, clientIp: "10.0.1.4" }), deps);
  assert.equal(long.status, 400);
  const missing = await handleLinkPassword(req({ body: {}, clientIp: "10.0.1.5" }), deps);
  assert.equal(missing.status, 400);
  const malformed = await handleLinkPassword(req({ body: null, clientIp: "10.0.1.6" }), deps);
  assert.equal(malformed.status, 400);
  assert.equal(calls.length, 2);
});

test("cross-origin request is rejected before touching setPassword", async () => {
  __clearLinkPasswordAttemptsForTesting();
  const calls: Array<{ password: string; headers: Headers }> = [];
  const evil = await handleLinkPassword(
    req({ origin: "http://localhost:4321.evil.com", clientIp: "10.0.0.3" }),
    { setPassword: okSetPassword(calls) },
  );
  assert.equal(evil.status, 403);
  assert.equal(calls.length, 0);
});

test("referer-only mismatch is rejected; match and headerless pass", async () => {
  __clearLinkPasswordAttemptsForTesting();
  const calls: Array<{ password: string; headers: Headers }> = [];
  const deps = { setPassword: okSetPassword(calls) };
  const badRef = await handleLinkPassword(
    req({ origin: null, referer: "https://evil.test/x", clientIp: "10.0.2.1" }),
    deps,
  );
  assert.equal(badRef.status, 403);
  const goodRef = await handleLinkPassword(
    req({ origin: null, referer: `${SELF}/profile`, clientIp: "10.0.2.2" }),
    deps,
  );
  assert.equal(goodRef.status, 200);
  const headerless = await handleLinkPassword(
    req({ origin: null, referer: null, clientIp: "10.0.2.3" }),
    deps,
  );
  assert.equal(headerless.status, 200);
  assert.equal(calls.length, 2);
});

test("rate limit: 5 attempts pass, the 6th is rejected with 429", async () => {
  const attempts = new Map<string, number[]>();
  const calls: Array<{ password: string; headers: Headers }> = [];
  const deps = { setPassword: okSetPassword(calls), attempts, now: () => 1_000_000 };
  for (let i = 0; i < 5; i++) {
    const res = await handleLinkPassword(req({ clientIp: "10.0.3.9" }), deps);
    assert.equal(res.status, 200);
  }
  const limited = await handleLinkPassword(req({ clientIp: "10.0.3.9" }), deps);
  assert.equal(limited.status, 429);
  assert.equal(calls.length, 5);
});

test("setPassword 401 becomes a 401 UNAUTHORIZED envelope (re-login flow)", async () => {
  __clearLinkPasswordAttemptsForTesting();
  const res = await handleLinkPassword(req({ clientIp: "10.0.0.4" }), {
    setPassword: throwingSetPassword(apiError(401, "UNAUTHORIZED", "Unauthorized")),
  });
  assert.equal(res.status, 401);
  assert.deepEqual(res.body, { error: { code: "UNAUTHORIZED", message: "Sign in to continue." } });
});

test("setPassword 400 surfaces its code and message (already-set, policy)", async () => {
  __clearLinkPasswordAttemptsForTesting();
  const deps = {
    setPassword: throwingSetPassword(apiError(400, "PASSWORD_ALREADY_SET", "Password already set")),
  };
  const res = await handleLinkPassword(req({ clientIp: "10.0.0.5" }), deps);
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, {
    error: { code: "PASSWORD_ALREADY_SET", message: "Password already set" },
  });
});

test("setPassword 5xx and foreign throws become generic 500s (no leak)", async () => {
  __clearLinkPasswordAttemptsForTesting();
  const boom = await handleLinkPassword(req({ clientIp: "10.0.0.6" }), {
    setPassword: throwingSetPassword(apiError(500, "DATABASE_ERROR", "pg connection string exploded")),
  });
  assert.equal(boom.status, 500);
  assert.deepEqual(boom.body, {
    error: { code: "AUTH_ERROR", message: "Couldn't link password. Try again." },
  });
  const foreign = await handleLinkPassword(req({ clientIp: "10.0.0.7" }), {
    setPassword: throwingSetPassword(new Error("weird")),
  });
  assert.equal(foreign.status, 500);
  assert.deepEqual(foreign.body, {
    error: { code: "AUTH_ERROR", message: "Couldn't link password. Try again." },
  });
});
