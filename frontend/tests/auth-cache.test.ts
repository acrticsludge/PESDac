// Regression tests for the auth cache primitives (T38, T39, T40, T41,
// T42). Run with: `npm run test --prefix frontend`.
//
// Node's built-in test runner with `--test`; the runner is configured
// to strip TS syntax (`--experimental-transform-types` is set in the
// npm script). The auth-cache module is pure (no React, no
// import.meta.env, no BetterAuth) so it loads under Node directly.

import test from "node:test";
import assert from "node:assert/strict";

import {
  isStaleTagged,
  mintTokenOnce,
  mintTokenWithRetry,
  sharedTaggedFetch,
  type TaggedCache,
} from "../src/lib/auth-cache.ts";

function makeOkTokenResponse(token: string): Response {
  return new Response(JSON.stringify({ token }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function makeHttpResponse(status: number): Response {
  return new Response("", { status });
}

function makeMalformedResponse(): Response {
  return new Response("not-json", {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function makeFetch(
  queue: Array<() => Response | Promise<Response>>,
): { fn: typeof fetch; calls: number } {
  const calls = { value: 0 };
  const fn: typeof fetch = async () => {
    calls.value += 1;
    const next = queue.shift();
    if (!next) throw new Error("fetch called with no queued response");
    return next();
  };
  return { fn, get calls() { return calls.value; } } as { fn: typeof fetch; calls: number };
}

// ---------------------------------------------------------------------------
// T38 / T41 — Identity-scoped cache: dedupe, stale, retry safety
// ---------------------------------------------------------------------------

test("sharedTaggedFetch returns the same promise for concurrent callers", async () => {
  let slot: TaggedCache<number> | null = null;
  let resolveFn: (v: number) => void = () => {};
  const promise = new Promise<number>((r) => {
    resolveFn = r;
  });
  let calls = 0;
  const fetcher = () => {
    calls += 1;
    return promise;
  };
  const a = sharedTaggedFetch<number>(slot, fetcher, "user-1", (e) => (slot = e), (e) => slot === e);
  const b = sharedTaggedFetch<number>(slot, fetcher, "user-1", (e) => (slot = e), (e) => slot === e);
  assert.equal(a.result, b.result, "concurrent callers share the same promise");
  assert.equal(calls, 1, "fetcher ran exactly once");
  resolveFn(42);
  assert.equal(await a.result, 42);
});

test("rejected promise clears the cache so the next caller retries", async () => {
  let slot: TaggedCache<string> | null = null;
  let attempts = 0;
  const fetcher = () => {
    attempts += 1;
    if (attempts === 1) return Promise.reject(new Error("network"));
    return Promise.resolve("ok");
  };
  const first = sharedTaggedFetch<string>(slot, fetcher, "user-1", (e) => (slot = e), (e) => slot === e);
  await assert.rejects(first.result, /network/);
  // After rejection, the catch handler clears the slot.
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(slot, null, "rejection cleared the cache");
  const second = sharedTaggedFetch<string>(slot, fetcher, "user-1", (e) => (slot = e), (e) => slot === e);
  assert.equal(await second.result, "ok");
  assert.equal(attempts, 2, "fetcher ran twice after rejection");
});

test("a stale user-A promise resolves but cannot paint user-B state", async () => {
  let slot: TaggedCache<{ id: string }> | null = null;
  let resolveA: (v: { id: string }) => void = () => {};
  const aPromise = new Promise<{ id: string }>((r) => {
    resolveA = r;
  });
  const fetcher = (): Promise<{ id: string }> => aPromise;
  const a = sharedTaggedFetch<{ id: string }>(slot, fetcher, "user-A", (e) => (slot = e), (e) => slot === e);
  // User switch happens before A resolves.
  sharedTaggedFetch<{ id: string }>(slot, fetcher, "user-B", (e) => (slot = e), (e) => slot === e);
  resolveA({ id: "user-A" });
  // The A caller awaits the same promise; the consumer-side stale guard
  // is the responsibility of the apiGet* wrapper. sharedTaggedFetch
  // resolves the promise as written; the wrapper rejects stale results.
  const aResult = await a.result;
  assert.deepEqual(aResult, { id: "user-A" });
  assert.equal(
    (slot as TaggedCache<{ id: string }> | null)?.userId,
    "user-B",
    "slot is now scoped to user-B",
  );
});

test("isStaleTagged detects user-id mismatch and cleared cache", () => {
  const entry: TaggedCache<unknown> = { promise: Promise.resolve(), userId: "user-1" };
  assert.equal(isStaleTagged(entry, "user-1"), false);
  assert.equal(isStaleTagged(entry, "user-2"), true);
  assert.equal(isStaleTagged(null, "user-1"), true);
});

// ---------------------------------------------------------------------------
// T39 / T40 — Token failure classification + bounded retry
// ---------------------------------------------------------------------------

test("mintTokenOnce returns ok for a 200 with a token field", async () => {
  const { fn } = makeFetch([() => makeOkTokenResponse("abc")]);
  const result = await mintTokenOnce("https://auth.test", fn, 1000);
  assert.deepEqual(result, { reason: "ok", token: "abc" });
});

test("mintTokenOnce classifies 5xx as server (retryable)", async () => {
  const { fn } = makeFetch([() => makeHttpResponse(503)]);
  const result = await mintTokenOnce("https://auth.test", fn, 1000);
  assert.equal(result.reason, "server");
});

test("mintTokenOnce classifies malformed body as malformed", async () => {
  const { fn } = makeFetch([() => makeMalformedResponse()]);
  const result = await mintTokenOnce("https://auth.test", fn, 1000);
  assert.equal(result.reason, "malformed");
});

test("mintTokenOnce classifies AbortError as timeout", async () => {
  const fn: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("aborted", "AbortError"));
      });
    });
  const result = await mintTokenOnce("https://auth.test", fn, 5);
  assert.equal(result.reason, "timeout");
});

test("mintTokenOnce classifies TypeError as network", async () => {
  const fn: typeof fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  const result = await mintTokenOnce("https://auth.test", fn, 1000);
  assert.equal(result.reason, "network");
});

test("mintTokenOnce classifies 429 as rate-limited (retryable)", async () => {
  const { fn } = makeFetch([() => makeHttpResponse(429)]);
  const result = await mintTokenOnce("https://auth.test", fn, 1000);
  assert.equal(result.reason, "rate-limited");
});

test("mintTokenOnce classifies 400 as client-error (non-retryable)", async () => {
  const { fn } = makeFetch([() => makeHttpResponse(400)]);
  const result = await mintTokenOnce("https://auth.test", fn, 1000);
  assert.equal(result.reason, "client-error");
});

test("mintTokenOnce classifies 401 as client-error (non-retryable)", async () => {
  const { fn } = makeFetch([() => makeHttpResponse(401)]);
  const result = await mintTokenOnce("https://auth.test", fn, 1000);
  assert.equal(result.reason, "client-error");
});

test("mintTokenOnce classifies 403 as client-error (non-retryable)", async () => {
  const { fn } = makeFetch([() => makeHttpResponse(403)]);
  const result = await mintTokenOnce("https://auth.test", fn, 1000);
  assert.equal(result.reason, "client-error");
});

test("mintTokenOnce classifies an unexpected non-2xx status as terminal", async () => {
  const { fn } = makeFetch([() => makeHttpResponse(302)]);
  const result = await mintTokenOnce("https://auth.test", fn, 1000);
  assert.equal(result.reason, "unexpected-status");
});

test("mintTokenWithRetry runs exactly two attempts on transient failure", async () => {
  let calls = 0;
  const queue = [
    () => {
      calls += 1;
      return makeHttpResponse(502);
    },
    () => {
      calls += 1;
      return makeOkTokenResponse("retry-token");
    },
  ];
  const fn: typeof fetch = async () => {
    const next = queue.shift();
    if (!next) throw new Error("exhausted");
    return next();
  };
  const result = await mintTokenWithRetry("https://auth.test", fn, 1000, 10);
  assert.deepEqual(result, { reason: "ok", token: "retry-token" });
  assert.equal(calls, 2, "ran two attempts (initial + one retry)");
});

test("mintTokenWithRetry does not retry on ok (single attempt)", async () => {
  let calls = 0;
  const queue = [() => makeOkTokenResponse("first-shot")];
  const fn: typeof fetch = async () => {
    calls += 1;
    const next = queue.shift();
    if (!next) throw new Error("exhausted");
    return next();
  };
  await mintTokenWithRetry("https://auth.test", fn, 1000, 10);
  assert.equal(calls, 1, "no retry when first attempt succeeds");
});

test("mintTokenWithRetry does not retry a second time when both fail", async () => {
  let calls = 0;
  const fn: typeof fetch = async () => {
    calls += 1;
    return makeHttpResponse(502);
  };
  const result = await mintTokenWithRetry("https://auth.test", fn, 1000, 10);
  assert.equal(result.reason, "server");
  assert.equal(calls, 2, "ran exactly two attempts then stopped");
});

test("mintTokenWithRetry retries 429 then returns rate-limited", async () => {
  let calls = 0;
  const fn: typeof fetch = async () => {
    calls += 1;
    return makeHttpResponse(429);
  };
  const result = await mintTokenWithRetry("https://auth.test", fn, 1000, 10);
  assert.equal(result.reason, "rate-limited");
  assert.equal(calls, 2, "retried once on 429 then stopped");
});

test("mintTokenWithRetry does not retry 400 client-error", async () => {
  let calls = 0;
  const fn: typeof fetch = async () => {
    calls += 1;
    return makeHttpResponse(400);
  };
  const result = await mintTokenWithRetry("https://auth.test", fn, 1000, 10);
  assert.equal(result.reason, "client-error");
  assert.equal(calls, 1, "no retry for non-retryable 400");
});

test("mintTokenWithRetry does not retry 401 client-error", async () => {
  let calls = 0;
  const fn: typeof fetch = async () => {
    calls += 1;
    return makeHttpResponse(401);
  };
  const result = await mintTokenWithRetry("https://auth.test", fn, 1000, 10);
  assert.equal(result.reason, "client-error");
  assert.equal(calls, 1, "no retry for non-retryable 401");
});

test("mintTokenWithRetry does not retry 403 client-error", async () => {
  let calls = 0;
  const fn: typeof fetch = async () => {
    calls += 1;
    return makeHttpResponse(403);
  };
  const result = await mintTokenWithRetry("https://auth.test", fn, 1000, 10);
  assert.equal(result.reason, "client-error");
  assert.equal(calls, 1, "no retry for non-retryable 403");
});

test("mintTokenWithRetry does not retry an unexpected status", async () => {
  let calls = 0;
  const fn: typeof fetch = async () => {
    calls += 1;
    return makeHttpResponse(302);
  };
  const result = await mintTokenWithRetry("https://auth.test", fn, 1000, 10);
  assert.equal(result.reason, "unexpected-status");
  assert.equal(calls, 1);
});

// ---------------------------------------------------------------------------
// T42 — Concurrent callers share one in-flight request (token dedupe by
// extension: a sharedTaggedFetch over the same key dedupes regardless of
// call site).
// ---------------------------------------------------------------------------

test("five concurrent apiGet-style calls collapse to one fetch", async () => {
  let slot: TaggedCache<number> | null = null;
  let fetches = 0;
  let resolveFn: (v: number) => void = () => {};
  const promise = new Promise<number>((r) => {
    resolveFn = r;
  });
  const fetcher = () => {
    fetches += 1;
    return promise;
  };
  const calls = Array.from({ length: 5 }, () =>
    sharedTaggedFetch<number>(slot, fetcher, "user-1", (e) => (slot = e), (e) => slot === e),
  );
  for (const c of calls) assert.equal(c.result, calls[0].result);
  resolveFn(99);
  for (const c of calls) assert.equal(await c.result, 99);
  assert.equal(fetches, 1, "concurrent callers deduped to one underlying fetch");
});

test("mintTokenWithRetry retries timeout then returns timeout", async () => {
  let calls = 0;
  const fn: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      calls += 1;
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("aborted", "AbortError"));
      });
    });
  const result = await mintTokenWithRetry("https://auth.test", fn, 20, 10);
  assert.equal(result.reason, "timeout");
  assert.equal(calls, 2, "retried once on timeout then stopped");
});

test("mintTokenWithRetry retries network failure then returns network", async () => {
  let calls = 0;
  const fn: typeof fetch = async () => {
    calls += 1;
    throw new TypeError("Failed to fetch");
  };
  const result = await mintTokenWithRetry("https://auth.test", fn, 1000, 10);
  assert.equal(result.reason, "network");
  assert.equal(calls, 2, "retried once on network failure then stopped");
});

test("mintTokenWithRetry does not retry malformed body", async () => {
  let calls = 0;
  const fn: typeof fetch = async () => {
    calls += 1;
    return makeMalformedResponse();
  };
  const result = await mintTokenWithRetry("https://auth.test", fn, 1000, 10);
  assert.equal(result.reason, "malformed");
  assert.equal(calls, 1, "no retry for terminal malformed response");
});
