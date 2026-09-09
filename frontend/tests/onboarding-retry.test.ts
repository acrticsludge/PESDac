// Onboarding-check silent-retry policy tests (auth-loading-flash fix, S2).
// Covers spec §6 FR2: the closed retryable set (TypeError / AbortError /
// 5xx / AuthServiceError / 429-once-capped-5s), terminal fast-paths (401,
// identity-changed, 400/403/404, unknown errors), exhaustion after exactly
// 3 attempts, and the 300/900ms backoff. No real timers anywhere — the
// runner takes an injected sleep. Fixture errors are synthetic.

import test from "node:test";
import assert from "node:assert/strict";

import {
  ApiError,
  AuthRequiredError,
  AuthServiceError,
  ONBOARDING_CHECK_MAX_ATTEMPTS,
  ONBOARDING_CHECK_RETRY_AFTER_CAP_MS,
  onboardingRetryDecision,
  runWithOnboardingRetry,
} from "../src/lib/auth.ts";

function abortError(): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException("Aborted", "AbortError");
  }
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}

// ---- Retryable matrix -------------------------------------------------------

test("retryable: TypeError retries with 300ms then 900ms", () => {
  assert.deepEqual(onboardingRetryDecision(new TypeError("fetch failed"), 1), {
    retry: true,
    delayMs: 300,
  });
  assert.deepEqual(onboardingRetryDecision(new TypeError("fetch failed"), 2), {
    retry: true,
    delayMs: 900,
  });
});

test("retryable: AbortError retries with backoff", () => {
  assert.deepEqual(onboardingRetryDecision(abortError(), 1), {
    retry: true,
    delayMs: 300,
  });
  assert.deepEqual(onboardingRetryDecision(abortError(), 2), {
    retry: true,
    delayMs: 900,
  });
});

test("retryable: 5xx ApiError retries with backoff", () => {
  for (const status of [500, 502, 503]) {
    assert.deepEqual(
      onboardingRetryDecision(new ApiError(status, null, "err"), 1),
      { retry: true, delayMs: 300 },
      `status ${status} attempt 1`,
    );
    assert.deepEqual(
      onboardingRetryDecision(new ApiError(status, null, "err"), 2),
      { retry: true, delayMs: 900 },
      `status ${status} attempt 2`,
    );
  }
});

test("retryable: AuthServiceError retries (session alive, mint side down)", () => {
  for (const reason of ["network", "timeout", "server", "rate-limited"] as const) {
    assert.deepEqual(
      onboardingRetryDecision(new AuthServiceError(reason), 1),
      { retry: true, delayMs: 300 },
      `reason ${reason}`,
    );
  }
});

test("retryable: 429 retries ONCE, honoring Retry-After capped at 5s", () => {
  // With a server-asked wait inside the cap.
  assert.deepEqual(
    onboardingRetryDecision(new ApiError(429, null, "slow down"), 1, {
      retryAfterMs: 2000,
    }),
    { retry: true, delayMs: 2000 },
  );
  // Over the cap: clamped.
  assert.deepEqual(
    onboardingRetryDecision(new ApiError(429, null, "slow down"), 1, {
      retryAfterMs: 30000,
    }),
    { retry: true, delayMs: ONBOARDING_CHECK_RETRY_AFTER_CAP_MS },
  );
  // apiFetch surfaces no Retry-After header: backoff slot, still once.
  assert.deepEqual(
    onboardingRetryDecision(new ApiError(429, null, "slow down"), 1),
    { retry: true, delayMs: 300 },
  );
  // A second 429 is terminal — exactly one rate-limit wait per check.
  assert.deepEqual(
    onboardingRetryDecision(new ApiError(429, null, "slow down"), 2, {
      retryAfterMs: 1000,
    }),
    { retry: false },
  );
});

// ---- Terminal fast-paths ----------------------------------------------------

test("terminal: 401 fails fast to current handling", () => {
  assert.deepEqual(
    onboardingRetryDecision(new AuthRequiredError(null), 1),
    { retry: false },
  );
  assert.deepEqual(
    onboardingRetryDecision(new ApiError(401, null, "unauthorized"), 1),
    { retry: false },
  );
});

test("terminal: identity-changed fails fast (stale resolve, never a failure)", () => {
  assert.deepEqual(
    onboardingRetryDecision(new Error("identity-changed"), 1),
    { retry: false },
  );
});

test("terminal: 400/403/404 fail fast (retry won't help)", () => {
  for (const status of [400, 403, 404]) {
    assert.deepEqual(
      onboardingRetryDecision(new ApiError(status, null, "err"), 1),
      { retry: false },
      `status ${status}`,
    );
  }
});

test("terminal: unknown error shapes fail fast", () => {
  assert.deepEqual(onboardingRetryDecision(new Error("boom"), 1), {
    retry: false,
  });
  assert.deepEqual(onboardingRetryDecision("boom", 1), { retry: false });
  assert.deepEqual(onboardingRetryDecision(null, 1), { retry: false });
});

test("exhaustion: every retryable class stops after 3 total attempts", () => {
  const retryables: unknown[] = [
    new TypeError("fetch failed"),
    abortError(),
    new ApiError(503, null, "down"),
    new AuthServiceError("server"),
    new ApiError(429, null, "slow down"),
  ];
  for (const error of retryables) {
    assert.deepEqual(onboardingRetryDecision(error, 3), { retry: false });
    assert.deepEqual(onboardingRetryDecision(error, 4), { retry: false });
  }
  assert.equal(ONBOARDING_CHECK_MAX_ATTEMPTS, 3);
});

// ---- Bound proof: attempt counting with an injected clock (no timers) -------

test("runner: persistent failure makes exactly 3 attempts, sleeps [300, 900], rethrows", async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const failure = new TypeError("fetch failed");
  await assert.rejects(
    runWithOnboardingRetry(
      () => {
        calls += 1;
        return Promise.reject(failure);
      },
      (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    ),
    (err: unknown) => err === failure,
  );
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [300, 900]);
});

test("runner: transient-once resolves after one silent retry (no dialog path)", async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const value = await runWithOnboardingRetry(
    () => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new TypeError("cold backend"))
        : Promise.resolve("wizard-lands");
    },
    (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  );
  assert.equal(value, "wizard-lands");
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [300]);
});

test("runner: terminal failure throws after 1 attempt with no sleep", async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const terminal = new AuthRequiredError(null);
  await assert.rejects(
    runWithOnboardingRetry(
      () => {
        calls += 1;
        return Promise.reject(terminal);
      },
      (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    ),
    (err: unknown) => err === terminal,
  );
  assert.equal(calls, 1);
  assert.deepEqual(sleeps, []);
});
