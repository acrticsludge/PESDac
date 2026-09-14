// Login-seed key discipline (audit §8 item 2).
// `seedOnboardingFields` is the ONLY writer the server→local seed path
// may use. These tests pin its key-set: the four onboarding keys seed
// from the server row, preference keys are never touched (a login can
// never clobber device prefs), and malformed server values fall back
// to blanks instead of entering the store.

import test from "node:test";
import assert from "node:assert/strict";

const snapshotStorage = new Map<string, string>();
const fakeLocalStorage = {
  getItem: (k: string) => (snapshotStorage.has(k) ? snapshotStorage.get(k)! : null),
  setItem: (k: string, v: string) => {
    snapshotStorage.set(k, String(v));
  },
  removeItem: (k: string) => {
    snapshotStorage.delete(k);
  },
  clear: () => snapshotStorage.clear(),
  get length() {
    return snapshotStorage.size;
  },
  key: (i: number) => [...snapshotStorage.keys()][i] ?? null,
};
if (typeof (globalThis as Record<string, unknown>).window === "undefined") {
  (globalThis as Record<string, unknown>).window = {
    dispatchEvent() {},
    addEventListener() {},
    removeEventListener() {},
    localStorage: fakeLocalStorage,
  };
}

import {
  getProfile,
  seedOnboardingFields,
  updateProfile,
} from "../src/lib/session.ts";

function resetState() {
  snapshotStorage.clear();
  updateProfile({
    institution: "",
    semester: "",
    branch: "",
    subjects: [],
    difficulty: "medium",
    verbosity: "balanced",
    retention: "forever",
  });
}

test("seed writes exactly the four onboarding keys from the server row", () => {
  resetState();
  seedOnboardingFields({
    campus: "RR",
    semester: "4",
    branch: "CSE",
    subjects: ["CN", "OS"],
  });
  const profile = getProfile();
  assert.equal(profile.institution, "RR");
  assert.equal(profile.semester, "4");
  assert.equal(profile.branch, "CSE");
  assert.deepEqual(profile.subjects, ["CN", "OS"]);
});

test("seed never touches device preference keys", () => {
  resetState();
  updateProfile({ difficulty: "hard", verbosity: "concise", retention: "30 days" });
  seedOnboardingFields({
    campus: "EC",
    semester: "2",
    branch: "ECE",
    subjects: [],
  });
  const profile = getProfile();
  assert.equal(profile.difficulty, "hard");
  assert.equal(profile.verbosity, "concise");
  assert.equal(profile.retention, "30 days");
});

test("malformed server values fall back to blanks", () => {
  resetState();
  updateProfile({ institution: "RR", semester: "4", branch: "CSE", subjects: ["CN"] });
  seedOnboardingFields({
    campus: "XX",
    semester: 42,
    branch: null,
    subjects: "nope",
  });
  const profile = getProfile();
  assert.equal(profile.institution, "");
  assert.equal(profile.semester, "");
  assert.equal(profile.branch, "");
  assert.deepEqual(profile.subjects, []);
});
