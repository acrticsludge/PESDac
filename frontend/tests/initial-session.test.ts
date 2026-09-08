// Initial-session tri-state + resolver regression tests (auth-gate guest fix).
// Covers spec §6 FR2: the pending branch must resolve present-guest to
// `guest` instantly, fail absent/malformed hints closed to `loading`,
// and ignore stale tags after an in-page identity transition (epoch
// mismatch). No DOM library — a minimal `globalThis.document` stub in
// the same style as the fake-window harness in link-password.test.ts.
// Fixture users are synthetic (`u-test-*`), never real.

import test from "node:test";
import assert from "node:assert/strict";

import {
  bumpAuthEpoch,
  getAuthEpoch,
  readInitialSessionTag,
  resolveInitialAuth,
} from "../src/lib/auth.ts";

function userFixture(id: string) {
  return {
    id,
    email: `${id}@example.com`,
    name: "Test User",
    twoFactorEnabled: false,
  };
}

/** Stub `document.getElementById`; `tagText: null` means the tag is missing. */
function installDocumentStub(tagText: string | null): () => void {
  const doc = {
    getElementById: (elementId: string) => {
      if (elementId !== "pesdac:initial-session") return null;
      if (tagText === null) return null;
      return { textContent: tagText };
    },
  };
  (globalThis as Record<string, unknown>).document = doc;
  return () => {
    delete (globalThis as Record<string, unknown>).document;
  };
}

// ---- Resolver truth table (spec §6 FR2) ------------------------------------

test("resolver: present-user + unchanged epoch -> authenticated", () => {
  const epoch = getAuthEpoch();
  assert.equal(
    resolveInitialAuth(
      { present: true, user: userFixture("u-test-1") },
      epoch,
      epoch,
    ),
    "authenticated",
  );
});

test("resolver: present-guest + unchanged epoch -> guest (the fix)", () => {
  const epoch = getAuthEpoch();
  assert.equal(
    resolveInitialAuth({ present: true, user: null }, epoch, epoch),
    "guest",
  );
});

test("resolver: absent + unchanged epoch -> loading (fail closed)", () => {
  const epoch = getAuthEpoch();
  assert.equal(
    resolveInitialAuth({ present: false, user: null }, epoch, epoch),
    "loading",
  );
});

test("resolver: epoch mismatch -> loading for every tag kind", () => {
  const latched = getAuthEpoch();
  const current = latched + 1;
  assert.equal(
    resolveInitialAuth(
      { present: true, user: userFixture("u-test-2") },
      latched,
      current,
    ),
    "loading",
  );
  assert.equal(
    resolveInitialAuth({ present: true, user: null }, latched, current),
    "loading",
  );
  assert.equal(
    resolveInitialAuth({ present: false, user: null }, latched, current),
    "loading",
  );
});

// ---- Tag reader -------------------------------------------------------------

test("tag reader: present user object validates and normalizes", () => {
  const restore = installDocumentStub(
    JSON.stringify(userFixture("u-test-3")),
  );
  try {
    const tag = readInitialSessionTag();
    assert.equal(tag.present, true);
    assert.equal(tag.user?.id, "u-test-3");
    assert.equal(tag.user?.email, "u-test-3@example.com");
  } finally {
    restore();
  }
});

test("tag reader: literal null is present-guest (not absent)", () => {
  const restore = installDocumentStub("null");
  try {
    assert.deepEqual(readInitialSessionTag(), {
      present: true,
      user: null,
    });
  } finally {
    restore();
  }
});

test("tag reader: missing tag is absent (fail closed)", () => {
  const restore = installDocumentStub(null);
  try {
    assert.deepEqual(readInitialSessionTag(), {
      present: false,
      user: null,
    });
  } finally {
    restore();
  }
});

test("tag reader: malformed JSON is absent (fail closed, never throws)", () => {
  const restore = installDocumentStub("{not-json-u-test-4");
  try {
    assert.deepEqual(readInitialSessionTag(), {
      present: false,
      user: null,
    });
  } finally {
    restore();
  }
});

test("tag reader: wrong-shape JSON is absent (fail closed)", () => {
  for (const raw of [
    JSON.stringify({ email: "u-test-5@example.com" }),
    JSON.stringify({ id: 123, email: "u-test-5@example.com" }),
    JSON.stringify("just-a-string"),
    JSON.stringify([1, 2, 3]),
    "",
  ]) {
    const restore = installDocumentStub(raw);
    try {
      assert.deepEqual(readInitialSessionTag(), {
        present: false,
        user: null,
      });
    } finally {
      restore();
    }
  }
});

test("tag reader: no document (SSR) is absent", () => {
  assert.equal(typeof document, "undefined");
  assert.deepEqual(readInitialSessionTag(), {
    present: false,
    user: null,
  });
});

// ---- Mount-epoch latch semantics --------------------------------------------

test("latch: bumped epoch forces loading for stale user AND stale guest tags", () => {
  const latched = getAuthEpoch();
  const staleUser = { present: true, user: userFixture("u-test-6") };
  const staleGuest = { present: true, user: null };
  // Control: before any transition the same tags resolve per kind.
  assert.equal(resolveInitialAuth(staleUser, latched, getAuthEpoch()), "authenticated");
  assert.equal(resolveInitialAuth(staleGuest, latched, getAuthEpoch()), "guest");
  // Simulate an in-page identity transition (sign-in/out, 401, delete).
  bumpAuthEpoch();
  const now = getAuthEpoch();
  assert.equal(resolveInitialAuth(staleUser, latched, now), "loading");
  assert.equal(resolveInitialAuth(staleGuest, latched, now), "loading");
});

test("latch: a fresh mount after a transition trusts the current tag again", () => {
  const fresh = getAuthEpoch();
  assert.equal(
    resolveInitialAuth({ present: true, user: null }, fresh, getAuthEpoch()),
    "guest",
  );
  assert.equal(
    resolveInitialAuth(
      { present: true, user: userFixture("u-test-7") },
      fresh,
      getAuthEpoch(),
    ),
    "authenticated",
  );
});
