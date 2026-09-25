// Section F — auth & session [staging] with real BetterAuth + Neon.
// Destructive tests use FRESH users per run (timestamp emails) or an
// idempotent seed reset — the shared seeds are never mutated without
// a reset path. Mocked FastAPI (`**/api/v1/**`) only; BetterAuth
// `[...slug]` stays REAL (passthrough) except per-test faults.
// Same base harness as section-e (lazy-thunk fallbacks, counters,
// journal + meta, live-ref error gates).
//
// Vendor/app facts pinned while implementing (cited, not guessed):
// - Routes: /login + /signup (AuthLayout); NO /forgot-password (no
//   email sender — password changes live in Profile > Authentication).
// - Post-login returns to the carried ?returnTo target (gate sets
//   it); bare /login falls back to /new. Google redirect is
//   untouched (lands wherever the callback puts it).
// - Google is a REDIRECT (signIn.social), not a popup.
// - Logout: sidebar footer "Logout" (no confirm) → clearIdentityHeap
//   FIRST, then POST /api/v1/auth/logout (backend 204 no-op), then
//   best-effort authClient.signOut(); always lands /login.
// - Sibling logout: storage event "pesdac:logout-ping" → receiver
//   only clearAuthCache() (NOT the seed clear) and NEVER navigates.
// - Authed /login bounce is a client effect (navigate to the
//   returnTo target, else /new).
// - Signup taken-email is a FORM Banner, not field-level.
// - Login has no visible throttle; wrong-password copy is
//   non-enumerating; no ×5 lockout.
// - 2FA enroll shows the secret as TEXT ("Setup key", no QR).
// - Delete-account: backend-first (DELETE /users/me → deleteUser →
//   heap drop → /signup); identity-pending keeps heap + stays put.
// - Link-password is same-origin POST /api/link-password (no /v1).
// - Display-name PATCH 401 rides the silent global re-auth.
//
// Deviations from browser-break-it-plan.md (evidence over text):
//   D34 (A4): no popup exists (redirect) — abandon = leave mid-hang.
//   D35 (A13): no reset flow exists at all — pins absence (no link,
//     /forgot-password 404s).
//   D36 (A3): no "login over session" UI exists (/login bounces when
//     authed) — sequential switch (logout → form login) is the only
//     UI path; the heap-wipe half is what's proven.
//   D37 (A8): taken-email is a form Banner, not field-level on email.
//   D38 (A12): no lockout at ×5 — pins actual (same copy ×5, then
//     correct password works).
//   D39 (A9): localStorage writes are nearly unread by boot (purge +
//     warn-once) — garbage boots trivially; pins actual.
//   D40 (A5, cleared 2026-09-18): B32 was a probe artifact — the
//     route derives selfOrigin from the request Host (live-probed:
//     :4323-Origin passes), so A5 is the full link → logout → login
//     flow, not the blocked-failure pin.

import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import * as fs from "node:fs";
import { createHmac } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TEMP = "C:\\Users\\anubh\\AppData\\Local\\Temp\\opencode";
const ROOT = "C:\\Anubhav\\Web Dev Projects\\PESDac";
const PASS_COOKIES = `${TEMP}\\seed-cookies.json`;
const GOOGLE_COOKIES = `${TEMP}\\seed-google-cookies.json`;

const SEED_EMAIL = "e2e.sectiona@example.com";
const SEED_PASSWORD = "E2e-SectionA-9x7q!Test";
const GOOGLE_EMAIL = "e2e.googleonly@example.com";
const GOOGLE_NEW_PASSWORD = "E2e-Link-9x7q!Test";
const SWITCH_EMAIL = "e2e.switch@example.com";
const SWITCH_PASSWORD = "E2e-Switch-9x7q!Test";
const SWITCH_NAME = "E2E Switch";

type NamedCookie = { name: string; value: string };

function loadCookie(file: string): NamedCookie {
  if (!fs.existsSync(file)) {
    throw new Error(
      `missing seed cookies ${file} — run the seed step first (see header).`,
    );
  }
  const raw: string[] = JSON.parse(fs.readFileSync(file, "utf8"));
  const first = raw[0].split(";")[0];
  const eq = first.indexOf("=");
  return { name: first.slice(0, eq), value: first.slice(eq + 1) };
}

async function addSession(context: BrowserContext, file: string) {
  const c = loadCookie(file);
  await context.addCookies([
    {
      name: c.name,
      value: c.value,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

// Hermetic sessions: several tests log out / revoke the shared seed
// (server-side row death — one context's signOut kills the cookie for
// everyone). Every cookie test mints its own session FIRST. (~4s.)
async function ensureSeed() {
  await execFileAsync("npx.cmd", ["tsx", "seed-e2e.local.mts"], {
    cwd: ROOT,
    timeout: 60000,
    shell: true,
  });
}

async function collectErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  return errors;
}

const HYDRA_FINGERPRINTS = [
  "Minified React error #418",
  "Hydration failed because the server rendered HTML",
];
async function expectCleanEnv(errors: string[], allowHydraMismatch = false, extraAllow: string[] = []) {
  const app = errors.filter((e) => {
    if (
      e.includes("Failed to load resource") ||
      e.includes("status of 404")
    )
      return false;
    if (
      allowHydraMismatch &&
      HYDRA_FINGERPRINTS.some((f) => e.includes(f))
    )
      return false;
    if (extraAllow.some((f) => e.includes(f))) return false;
    return true;
  });
  expect(app, `expected zero app errors, got:\n${app.join("\n")}`).toEqual([]);
}

const EXPIRY_COPY = "Your session expired. Please log in again.";
const TAKEN_COPY = "That email is already registered. Log in instead.";
const WRONG_CREDS_COPY =
  "Couldn't sign in with those details. Check your email and password and try again.";

// ---- mock shapes (mocked FastAPI only; BetterAuth passes through) ----------

const iso = () => new Date().toISOString();
const json = (data: unknown, status = 200, headers?: Record<string, string>) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(data),
  ...(headers ? { headers } : {}),
});
const errBody = (code: string, message: string) => ({
  error: { code, message },
});
const ME = (over: Record<string, unknown> = {}) => ({
  user: {
    id: "e2e",
    email: "e2e.sectionf@example.com",
    displayName: "E2E SectionF",
    onboardingDone: true,
    ...over,
  },
});
const DEFAULT_PROFILE_ROW = {
  institution: "",
  semester: "",
  branch: "",
  subjects: [],
  campus: "",
  onboardingDone: true,
};
const LLM_READY = {
  configured: true,
  provider: "openrouter",
  keyHint: "abcd",
  model: "openai/gpt-4o-mini",
  validatedAt: null,
};

type Counters = {
  me: number;
  profileGet: number;
  profilePatch: number;
  llm: number;
  chatsGet: number;
  chatsPost: number;
  chatPatch: number;
  chatDelete: number;
  chatsDelete: number;
  messagesGet: number;
  messagesPost: number;
  messagesDelete: number;
  exportGet: number;
  token: number;
  authed: number;
};
const newCounters = (): Counters => ({
  me: 0,
  profileGet: 0,
  profilePatch: 0,
  llm: 0,
  chatsGet: 0,
  chatsPost: 0,
  chatPatch: 0,
  chatDelete: 0,
  chatsDelete: 0,
  messagesGet: 0,
  messagesPost: 0,
  messagesDelete: 0,
  exportGet: 0,
  token: 0,
  authed: 0,
});

type Fulfill =
  | { status: number; body: unknown; headers?: Record<string, string> }
  | "abort";
type Leg = (attempt: number, req: import("@playwright/test").Request) => Fulfill | Promise<Fulfill>;

type BackendOv = {
  me?: Leg;
  profileGet?: Leg;
  profilePatch?: Leg;
  llm?: Leg;
  chatsGet?: Leg;
  chatsPost?: Leg;
  chatPatch?: Leg;
  chatDelete?: Leg;
  chatsDelete?: Leg;
  messagesGet?: Leg;
  messagesPost?: Leg;
  messagesDelete?: Leg;
  exportGet?: Leg;
  logoutPost?: Leg;
};

const ok = (body: unknown): Fulfill => ({ status: 200, body });

type JournalRow = {
  id: string;
  seq: number;
  role: string;
  content: unknown;
  createdAt: string;
};

type ChatMeta = {
  code: string;
  title: string;
  subject: string;
  isPinned: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
};

type MockOpts = {
  seedChats?: Array<{ code: string; title: string; subject?: string }>;
  msgBodies?: Array<{ code: string; body: unknown }>;
  journal?: Map<string, JournalRow[]>;
  journalSeed?: Array<{ code: string; rows: JournalRow[] }>;
  meta?: Map<string, ChatMeta>;
  profileRow?: Record<string, unknown>;
  meRow?: Record<string, unknown>;
  flags?: { offline: boolean };
};

const metaRow = (m: ChatMeta) => ({ ...m });

async function mockBackend(
  target: Page | BrowserContext,
  c: Counters,
  ov: BackendOv = {},
  opts: MockOpts = {},
) {
  const journal = opts.journal ?? new Map<string, JournalRow[]>();
  for (const s of opts.journalSeed ?? []) journal.set(s.code, [...s.rows]);
  const meta = opts.meta ?? new Map<string, ChatMeta>();
  if (meta.size === 0) {
    for (const s of opts.seedChats ?? []) {
      meta.set(s.code, {
        code: s.code,
        title: s.title,
        subject: s.subject ?? "CN",
        isPinned: false,
        isArchived: false,
        createdAt: iso(),
        updatedAt: iso(),
      });
    }
  }
  const profileRow = opts.profileRow ?? { ...DEFAULT_PROFILE_ROW };
  const meRow = opts.meRow ?? ME();
  const flags = opts.flags ?? { offline: false };
  let chatSeq = 0;
  const msgSeq = new Map<string, number>();
  for (const [code, rows] of journal) msgSeq.set(code, rows.length);
  await target.unrouteAll({ behavior: "wait" });
  // NOTE: sign-out/update-user/token are NOT faked here (unlike
  // sections a–e) — BetterAuth stays real. Only per-test faults add
  // auth routes.
  await target.route("**/api/v1/**", async (r) => {
    const req = r.request();
    const u = new URL(req.url());
    const m = req.method();
    const p = u.pathname;
    const run = async (
      leg: Leg | undefined,
      fallback: () => Fulfill,
      key: keyof Counters,
    ) => {
      c[key] += 1;
      const out = leg ? await leg(c[key], req) : fallback();
      if (out === "abort") await r.abort("connectionreset");
      else if (out.status === 204) await r.fulfill({ status: 204, body: "" });
      else await r.fulfill(json(out.body, out.status, out.headers));
    };
    const offlineAbort = (): Fulfill => "abort";
    if (p === "/api/v1/auth/me" && m === "GET")
      return run(ov.me, () => ok(meRow), "me");
    if (p === "/api/v1/auth/logout" && m === "POST")
      return run(ov.logoutPost, () => ({ status: 204, body: {} }), "authed");
    if (p === "/api/v1/profiles/me" && m === "GET")
      return run(ov.profileGet, () => ok(profileRow), "profileGet");
    if (p === "/api/v1/profiles/me" && m === "PATCH") {
      if (flags.offline) return run(ov.profilePatch, offlineAbort, "profilePatch");
      try {
        Object.assign(profileRow, req.postDataJSON() as Record<string, unknown>);
      } catch {
        // Non-JSON bodies never occur here; ignore defensively.
      }
      return run(ov.profilePatch, () => ok(profileRow), "profilePatch");
    }
    if (p === "/api/v1/llm/status")
      return run(ov.llm, () => ok(LLM_READY), "llm");
    if (p === "/api/v1/chats" && m === "GET") {
      const rows = [...meta.values()].filter((row) =>
        u.searchParams.get("archived") === "true" ? row.isArchived : !row.isArchived,
      );
      return run(ov.chatsGet, () => ok({
        data: rows.map(metaRow),
        pagination: { limit: 50, offset: 0, total: rows.length },
      }), "chatsGet");
    }
    if (p === "/api/v1/chats" && m === "POST") {
      if (flags.offline) return run(ov.chatsPost, offlineAbort, "chatsPost");
      const fb = (): Fulfill => {
        chatSeq += 1;
        const posted = req.postDataJSON() as { subject: string; title: string };
        const code = `f${String(chatSeq).padStart(5, "0")}`;
        meta.set(code, {
          code,
          title: posted.title,
          subject: posted.subject,
          isPinned: false,
          isArchived: false,
          createdAt: iso(),
          updatedAt: iso(),
        });
        return ok(metaRow(meta.get(code)!));
      };
      return run(ov.chatsPost, fb, "chatsPost");
    }
    const msgMatch = p.match(/^\/api\/v1\/chats\/([^/]+)\/messages/);
    if (msgMatch && m === "GET") {
      const code = msgMatch[1];
      const fb = (): Fulfill => ok({
        data: journal.get(code) ?? [],
        pagination: {
          limit: 50,
          offset: 0,
          total: (journal.get(code) ?? []).length,
        },
      });
      return run(ov.messagesGet, fb, "messagesGet");
    }
    if (msgMatch && m === "POST") {
      if (flags.offline) return run(ov.messagesPost, offlineAbort, "messagesPost");
      const fb = (): Fulfill => {
        const code = msgMatch[1];
        if (!meta.has(code))
          return { status: 404, body: errBody("NOT_FOUND", "nope") };
        const posted = req.postDataJSON() as {
          role: string;
          content: unknown;
          clientMsgKey?: string;
        };
        opts.msgBodies?.push({ code, body: posted });
        const seq = (msgSeq.get(code) ?? 0) + 1;
        msgSeq.set(code, seq);
        const row: JournalRow = {
          id: `m${seq}`,
          seq,
          role: posted.role,
          content: posted.content,
          createdAt: iso(),
        };
        journal.set(code, [...(journal.get(code) ?? []), row]);
        return ok(row);
      };
      return run(ov.messagesPost, fb, "messagesPost");
    }
    return r.continue();
  });
  return { journal, meta, profileRow };
}

// ---- auth helpers -----------------------------------------------------------

const composerBox = (page: Page) =>
  page.getByRole("combobox", { name: "Message input" });
const sidebar = (page: Page) => page.locator("nav, aside").first();
const gateDialog = (page: Page) =>
  // purpose="required" renders role=alertdialog, not dialog (probed).
  page.getByRole("alertdialog", { name: "Log in to continue" });

async function openSeededThread(
  page: Page,
  c: Counters,
  code: string,
  ov: BackendOv = {},
  extra: MockOpts = {},
) {
  const seeds = extra.seedChats ?? [{ code, title: `Seeded thread ${code}` }];
  const { journal, meta } = await mockBackend(page, c, ov, { ...extra, seedChats: seeds });
  await page.goto(`/subject/CN/${code}`);
  await page
    .getByText("Ask anything about CN...", { exact: false })
    .first()
    .waitFor({ timeout: 25000 });
  await expect
    .poll(
      async () => composerBox(page).getAttribute("contenteditable"),
      { timeout: 25000 },
    )
    .toBe("true");
  return { journal, meta };
}

// Real email/password login through the UI (real BetterAuth).
async function realLogin(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByPlaceholder("name@college.com").fill(email);
  await page.getByPlaceholder("Enter your password").fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL(/\/new/, { timeout: 25000 });
}

async function openProfileDialog(page: Page) {
  await sidebar(page).getByRole("link", { name: "My Profile" }).click();
  await expect(page.getByRole("dialog").first()).toBeVisible({ timeout: 15000 });
}

// Non-circular identity proof: the REAL BetterAuth session endpoint
// (never mocked — […] passthrough), read from page context.
async function realSessionEmail(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    try {
      const res = await fetch("/api/auth/get-session", {
        credentials: "same-origin",
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        user?: { email?: string } | null;
      };
      return data?.user?.email ?? null;
    } catch {
      return null;
    }
  });
}

async function pesdacKeys(page: Page): Promise<string[]> {
  // Both separators: data keys are pesdac-*, the logout ping and the
  // outbox lease are colon-form (never swept by the purge, by design).
  return page.evaluate(() =>
    Object.keys(window.localStorage).filter(
      (k) => k.startsWith("pesdac-") || k.startsWith("pesdac:"),
    ),
  );
}

// RFC 6238 TOTP (SHA1, 30s, 6 digits) for the 2FA enroll/verify flow.
function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.replace(/[\s=]/g, "").toUpperCase();
  let bits = "";
  for (const ch of clean) {
    const val = alphabet.indexOf(ch);
    if (val === -1) throw new Error(`bad base32 char: ${ch}`);
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function totpNow(secret: string): string {
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 30000);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(code % 1_000_000).padStart(6, "0");
}

// ---- A1 ---------------------------------------------------------------------
// Expiry mid-chat (E6 shape, run once here as the section pointer):
// me 401s from now on, send → expiry copy, composer locked, /login.

test("A1 — session expiry mid-chat locks composer and routes to login", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await ensureSeed();
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  // Boot alive; kill the REAL session server-side (real sign-out —
  // cookie revoked, no mocks involved in the death). The mocked
  // backend stands in for the real one's JWT rejection (which is
  // what would 401 the append): messagesPost 401s from the start,
  // but no append fires before the kill.
  await openSeededThread(page, c, "a1aa11", {
    messagesPost: () => ({
      status: 401,
      body: errBody("UNAUTHORIZED", "revoked"),
    }),
  });
  expect(await realSessionEmail(page)).not.toBeNull();
  // JSON content-type required — bare POSTs trip the CSRF guard
  // ("Cross-site POST form submissions are forbidden", probed).
  await page.evaluate(() =>
    fetch("/api/auth/sign-out", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
  );
  await expect
    .poll(() => realSessionEmail(page), { timeout: 20000 })
    .toBeNull();
  await composerBox(page).click();
  await page.keyboard.type("are you still there", { delay: 5 });
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(EXPIRY_COPY).first()).toBeVisible({
    timeout: 15000,
  });
  await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
  await expectCleanEnv(errors, true, ["Transition was skipped"]);
});

// ---- A2 ---------------------------------------------------------------------
// Sibling-tab logout: same-context pages share storage; B logs out,
// A flips to guest via logout-ping WITHOUT navigating — gate on /new,
// rows gone, identity keys wiped (logout-ping itself survives).

test("A2 — sibling-tab logout flips the other tab to guest in place", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const context = await browser.newContext();
  try {
    await ensureSeed();
    await addSession(context, PASS_COOKIES);
    const c = newCounters();
    // Logged-out reproof must come back EMPTY: the ping wipes p1's
    // store and it reproves immediately — a static list would
    // re-serve the rows and mask the wipe (probed).
    let loggedOut = false;
    const a2row = {
      code: "a2aa11",
      title: "A2 thread",
      subject: "CN",
      isPinned: false,
      isArchived: false,
      createdAt: iso(),
      updatedAt: iso(),
    };
    await mockBackend(
      context,
      c,
      {
        chatsGet: (_n, req) =>
          ok({
            data:
              loggedOut ||
              new URL(req.url()).searchParams.get("archived") === "true"
                ? []
                : [a2row],
            pagination: { limit: 50, offset: 0, total: loggedOut ? 0 : 1 },
          }),
      },
      { seedChats: [{ code: "a2aa11", title: "A2 thread" }] },
    );
    const p1 = await context.newPage();
    const p2 = await context.newPage();
    const errorsA = await collectErrors(p1);
    const errorsB = await collectErrors(p2);
    for (const p of [p1, p2]) {
      await p.goto("/new");
      await p
        .getByText("Ask anything", { exact: false })
        .first()
        .waitFor({ timeout: 25000 });
      await expect
        .poll(
          async () =>
            p
              .getByRole("combobox", { name: "Message input" })
              .getAttribute("contenteditable"),
          { timeout: 25000 },
        )
        .toBe("true");
    }
    await expect(
      p1.getByRole("link", { name: "A2 thread" }),
    ).toBeVisible({ timeout: 15000 });
    // B logs out (real heap wipe + /login). Flip the list FIRST so
    // p1's immediate reproof (post-wipe) sees the logged-out world.
    loggedOut = true;
    await sidebar(p2).getByRole("link", { name: "Logout" }).click();
    await expect(p2).toHaveURL(/\/login/, { timeout: 25000 });
    // A never navigates but flips to guest: gate opens ON /new
    // (in place — no navigation, per the receiver contract).
    await expect(p1).toHaveURL(/\/new/, { timeout: 15000 });
    await expect(gateDialog(p1)).toBeVisible({ timeout: 20000 });
    // No stale rows: the custom thread link is gone for the guest.
    await expect(
      p1.getByRole("link", { name: "A2 thread" }),
    ).toHaveCount(0, { timeout: 15000 });
    // Footer flips to the guest entry.
    await expect(
      sidebar(p1).getByRole("link", { name: "Login" }),
    ).toBeVisible({ timeout: 15000 });
    // Identity keys wiped (shared store — assert once). The ping key
    // itself is colon-form and never swept, by design.
    const keys = await pesdacKeys(p1);
    expect(keys).toContain("pesdac:logout-ping");
    for (const gone of [
      "pesdac-custom-chats-v1",
      "pesdac-overlays-v1",
      "pesdac-drafts-v1",
      "pesdac-profile-v1",
    ]) {
      expect(keys, `expected ${gone} wiped`).not.toContain(gone);
    }
    // Real session is dead for both (best-effort signOut ran).
    expect(await realSessionEmail(p1)).toBeNull();
    await expectCleanEnv(errorsA, true);
    await expectCleanEnv(errorsB, true, ["Transition was skipped"]);
  } finally {
    await context.close();
  }
});

// ---- A3 ---------------------------------------------------------------------
// Account A→B switch: no "login over session" UI exists (/login
// bounces when authed — D36), so the UI path is logout → form login.
// Proves the heap wipe across identities: B's list only, B's session.

test("A3 — logout then form-login as B shows only B state", async ({
  page,
  context,
}) => {
  test.setTimeout(180000);
  const errors = await collectErrors(page);
  await ensureSeed();
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await mockBackend(
    page,
    c,
    {},
    {
      seedChats: [{ code: "a3aa11", title: "A3 A-thread" }],
      meRow: ME({ email: SEED_EMAIL, displayName: "E2E SectionA" }),
    },
  );
  await page.goto("/new");
  await page
    .getByText("Ask anything", { exact: false })
    .first()
    .waitFor({ timeout: 25000 });
  await expect(
    page.getByRole("link", { name: "A3 A-thread" }),
  ).toBeVisible({ timeout: 15000 });
  expect(await realSessionEmail(page)).not.toBeNull();
  // Log A out through the UI.
  await sidebar(page).getByRole("link", { name: "Logout" }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 25000 });
  // Re-mock as B's world BEFORE the form login (identity change
  // rehydrates → refetch serves B's list).
  await mockBackend(
    page,
    c,
    {},
    {
      seedChats: [{ code: "a3bb22", title: "A3 B-thread" }],
      meRow: ME({ email: SWITCH_EMAIL, displayName: SWITCH_NAME }),
    },
  );
  // B: signup if fresh, else form login (idempotent across runs).
  await page.goto("/signup");
  await page.getByPlaceholder("Your name").fill(SWITCH_NAME);
  await page.getByPlaceholder("name@college.com").fill(SWITCH_EMAIL);
  await page.getByPlaceholder("Choose your password").fill(SWITCH_PASSWORD);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  const tookSignup = await Promise.race([
    page.waitForURL(/\/new/, { timeout: 25000 }).then(() => true),
    page
      .getByText(TAKEN_COPY, { exact: false })
      .waitFor({ timeout: 25000 })
      .then(() => false),
  ]);
  if (!tookSignup) await realLogin(page, SWITCH_EMAIL, SWITCH_PASSWORD);
  // Non-circular identity proof: the REAL session is B.
  await expect
    .poll(() => realSessionEmail(page), { timeout: 20000 })
    .toBe(SWITCH_EMAIL);
  // Heap wipe: B's rows only, A's thread gone.
  await expect(
    page.getByRole("link", { name: "A3 B-thread" }),
  ).toBeVisible({ timeout: 20000 });
  await expect(
    page.getByRole("link", { name: "A3 A-thread" }),
  ).toHaveCount(0, { timeout: 15000 });
  await expectCleanEnv(errors, true, ["Transition was skipped"]);
});

// ---- A4 ---------------------------------------------------------------------
// Google redirect abandoned (D34: redirect, not popup — no popup to
// abandon). Social endpoint hangs → "Redirecting…" → leave for /new:
// stays put, calm, no half-session minted.

test("A4 — Google redirect abandoned leaves no half-session", async ({
  page,
  _context,
}) => {
  test.setTimeout(120000);
  const errors = await collectErrors(page);
  const c = newCounters();
  await mockBackend(page, c);
  let socialHits = 0;
  // Hang the social handshake forever (E8 shape for the OAuth leg).
  await page.route("**/api/auth/sign-in/social*", async () => {
    socialHits += 1;
    await new Promise(() => {});
  });
  await page.goto("/login");
  await expect(
    page.getByRole("button", { name: "Google" }),
  ).toBeVisible({ timeout: 25000 });
  await page.getByRole("button", { name: "Google" }).click();
  // Redirect leg engaged but never resolves — still on /login…
  await expect
    .poll(() => socialHits, { timeout: 20000 })
    .toBeGreaterThan(0);
  await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
  // …abandon it: back to /new, guest gate, zero session minted.
  await page.goto("/new");
  await expect(gateDialog(page)).toBeVisible({ timeout: 25000 });
  expect(await realSessionEmail(page)).toBeNull();
  await expect(
    sidebar(page).getByRole("link", { name: "Login" }),
  ).toBeVisible({ timeout: 15000 });
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await expectCleanEnv(errors);
});

// ---- A5 ---------------------------------------------------------------------
// Google-only user links a password, then signs in with it. The seed
// reset runs first (idempotent, drops any credential) so the "Add"
// path exists every run.
//
// (B32, fixed: the route derived selfOrigin from Astro's url.origin,
// which under `astro preview` reports the baseURL port (:4321) even
// when the request Host is :4323 — server-logged as
// self=:4321/origin=:4323/host=:4323. Self now derives from the
// request Host header. The audit's matrix stands; only the mechanism
// note is corrected.)

test("A5 — Google-only links a password, then signs in with it", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await execFileAsync("npx.cmd", ["tsx", `${TEMP}\\seed-googleonly.mts`], {
    cwd: ROOT,
    timeout: 60000,
    shell: true,
  });
  await addSession(context, GOOGLE_COOKIES);
  const c = newCounters();
  await mockBackend(page, c, {}, {
    meRow: ME({ email: GOOGLE_EMAIL, displayName: "E2E GoogleOnly" }),
  });
  await page.goto("/new");
  await page
    .getByText("Ask anything", { exact: false })
    .first()
    .waitFor({ timeout: 25000 });
  expect(await realSessionEmail(page)).toBe(GOOGLE_EMAIL);
  // Profile → Authentication → Add a password.
  await openProfileDialog(page);
  const dialog = page.getByRole("dialog").first();
  await dialog.getByRole("button", { name: "Authentication" }).click();
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await dialog.getByPlaceholder("Choose a password").fill(GOOGLE_NEW_PASSWORD);
  await dialog.getByPlaceholder("Type the password again").fill(GOOGLE_NEW_PASSWORD);
  await dialog.getByRole("button", { name: "Link password" }).click();
  // Success flips the row (accounts refresh): Add out, Change in,
  // session intact throughout.
  await expect(
    dialog.getByRole("button", { name: "Change", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await expect(
    dialog.getByRole("button", { name: "Add", exact: true }),
  ).toHaveCount(0);
  expect(await realSessionEmail(page)).toBe(GOOGLE_EMAIL);
  await page.keyboard.press("Escape");
  // The linked password really works: logout → email login with it.
  await sidebar(page).getByRole("link", { name: "Logout" }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 25000 });
  await page.getByPlaceholder("name@college.com").fill(GOOGLE_EMAIL);
  await page.getByPlaceholder("Enter your password").fill(GOOGLE_NEW_PASSWORD);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL(/\/new/, { timeout: 25000 });
  expect(await realSessionEmail(page)).toBe(GOOGLE_EMAIL);
  await expectCleanEnv(errors, true);
});

// ---- A6 ---------------------------------------------------------------------
// Authed /login bounce: client effect to /new. Pins actual (the
// 2026-09-14 finding said the gate stayed open over /new).

test("A6 — authed /login bounces to /new with gate closed", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await ensureSeed();
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await mockBackend(page, c);
  await page.goto("/new");
  await expect
    .poll(
      async () => composerBox(page).getAttribute("contenteditable"),
      { timeout: 25000 },
    )
    .toBe("true");
  await page.goto("/login");
  // Bounce (effect-after-paint — the form may flash, the gate must
  // never open over /new).
  await expect(page).toHaveURL(/\/new/, { timeout: 25000 });
  await expect(gateDialog(page)).toHaveCount(0, { timeout: 15000 });
  await expect
    .poll(
      async () => composerBox(page).getAttribute("contenteditable"),
      { timeout: 25000 },
    )
    .toBe("true");
  await expectCleanEnv(errors, true);
});

// ---- A7 ---------------------------------------------------------------------
// Delete account with the backend DOWN (this box is backend-down by
// the plan's own Phase-1 definition; the complete path needs
// staging): backend-first ordering fails honestly — calm toast, NO
// heap touch, still authed. Fixed email + taken-fallback so reruns
// reuse one row instead of littering (the row can never be deleted
// here — deletion IS what's under test).
//
// NOTE: an earlier revision proved the failure modes around a live
// backend one by one (unreachable :8000 → toast; :: + CORS env →
// request leaves; then /login via the global 401 flow because the
// backend's JWKS (at :4321) is unreachable here so it can't verify
// the minted JWT). All backend-up behavior belongs to staging.

test("A7 — delete with backend down fails honestly, touches nothing", async ({
  page,
  _context,
}) => {
  test.setTimeout(180000);
  const errors = await collectErrors(page);
  const c = newCounters();
  await mockBackend(page, c);
  const email = "e2e.doomed@example.com";
  const password = "E2e-Doomed-9x7q!Test";
  // Fresh if possible, login if taken (idempotent across runs).
  await page.goto("/signup");
  await page.getByPlaceholder("Your name").fill("E2E Doomed");
  await page.getByPlaceholder("name@college.com").fill(email);
  await page.getByPlaceholder("Choose your password").fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  const tookSignup = await Promise.race([
    page.waitForURL(/\/new/, { timeout: 25000 }).then(() => true),
    page
      .getByText(TAKEN_COPY, { exact: false })
      .waitFor({ timeout: 25000 })
      .then(() => false),
  ]);
  if (!tookSignup) await realLogin(page, email, password);
  expect(await realSessionEmail(page)).toBe(email);
  // Delete → backend unreachable → backend-failed branch.
  await openProfileDialog(page);
  const dialog = page.getByRole("dialog").first();
  await dialog.getByRole("button", { name: "Delete account" }).click();
  await expect(
    page.getByRole("heading", { name: "Delete your account?" }),
  ).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  // Honest failure, no navigation, heap untouched, still authed.
  await expect(
    page.getByText("Couldn't reach the server", { exact: false }).first(),
  ).toBeVisible({ timeout: 25000 });
  await expect(page).not.toHaveURL(/\/signup/, { timeout: 15000 });
  expect(await realSessionEmail(page)).toBe(email);
  await expect(gateDialog(page)).toHaveCount(0, { timeout: 15000 });
  await expectCleanEnv(errors, true);
});

// ---- A8 ---------------------------------------------------------------------
// Taken-email signup: the server answers 422
// USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL and the form shows the
// specific Banner (D37 — Banner, not field-level). NOTE: this needs
// BETTER_AUTH_TRUSTED_ORIGINS to include the preview origin —
// without it every browser signup 403s (filed separately) and the
// generic copy shows instead.

test("A8 — taken-email signup explains, keeps password", async ({
  page,
  _context,
}) => {
  const errors = await collectErrors(page);
  const c = newCounters();
  await mockBackend(page, c);
  await page.goto("/signup");
  await page.getByPlaceholder("Your name").fill("E2E Taken");
  await page.getByPlaceholder("name@college.com").fill(SEED_EMAIL);
  await page.getByPlaceholder("Choose your password").fill("E2e-Taken-9x7q!Test");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(
    page.getByText(TAKEN_COPY, { exact: false }).first(),
  ).toBeVisible({ timeout: 25000 });
  // Still on /signup, password kept (never cleared on error).
  await expect(page).toHaveURL(/\/signup/, { timeout: 15000 });
  await expect(page.getByPlaceholder("Choose your password")).not.toBeEmpty({
    timeout: 15000,
  });
  expect(await realSessionEmail(page)).toBeNull();
  await expectCleanEnv(errors);
});

// ---- A9 ---------------------------------------------------------------------
// Corrupt localStorage keys: garbage in → reload → boots every time
// (purge + warn-once; nearly nothing reads them at boot — D39).

test("A9 — corrupt pesdac-* keys never block boot", async ({
  page,
  context,
}) => {
  test.setTimeout(180000);
  const errors = await collectErrors(page);
  await ensureSeed();
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await mockBackend(
    page,
    c,
    {},
    { seedChats: [{ code: "a9aa11", title: "A9 thread" }] },
  );
  const keys = [
    "pesdac-custom-chats-v1",
    "pesdac-overlays-v1",
    "pesdac-drafts-v1",
    "pesdac-profile-v1",
    "pesdac-feedback-v1",
    "pesdac-pins-v1",
  ];
  for (const key of keys) {
    await page.goto("/new");
    await expect
      .poll(
        async () => composerBox(page).getAttribute("contenteditable"),
        { timeout: 25000 },
      )
      .toBe("true");
    await page.evaluate(
      (k) => window.localStorage.setItem(k, "not json{{{"),
      key,
    );
    await page.reload();
    // Boots every time, composer live.
    await expect
      .poll(
        async () => composerBox(page).getAttribute("contenteditable"),
        { timeout: 25000 },
      )
      .toBe("true");
  }
  // Store still functional after the purge loop: thread opens.
  await page.goto("/subject/CN/a9aa11");
  await page
    .getByText("Ask anything about CN...", { exact: false })
    .first()
    .waitFor({ timeout: 25000 });
  await expectCleanEnv(errors, true);
});

// ---- A10 --------------------------------------------------------------------
// Logout POST fails: honest toast, local session STILL cleared
// (fail-safe direction), lands /login, gate on /new.

test("A10 — failed logout POST still clears local session", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const errors = await collectErrors(page);
  await ensureSeed();
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await mockBackend(
    page,
    c,
    {
      logoutPost: () => ({
        status: 500,
        body: errBody("SERVER_FAIL", "logout down"),
      }),
    },
    { seedChats: [{ code: "a0aa10", title: "A10 thread" }] },
  );
  await page.goto("/new");
  await expect
    .poll(
      async () => composerBox(page).getAttribute("contenteditable"),
      { timeout: 25000 },
    )
    .toBe("true");
  // Toast-watcher BEFORE the click (see below).
  await page.evaluate(() => {
    (window as unknown as { __toasts?: string[] }).__toasts = [];
    new MutationObserver((muts) => {
      const box =
        (window as unknown as { __toasts?: string[] }).__toasts ?? [];
      for (const m of muts) {
        for (const n of m.addedNodes) {
          const t = (n as HTMLElement).innerText;
          if (t) box.push(t.slice(0, 200));
        }
      }
      (window as unknown as { __toasts?: string[] }).__toasts = box;
    }).observe(document.body, { childList: true, subtree: true });
  });
  await sidebar(page).getByRole("link", { name: "Logout" }).click();
  // 5xx maps to the generic server copy (toUserMessage — the plan's
  // literal "Couldn't tell the server…" fallback only surfaces for
  // non-5xx failures). What matters: honest failure + fail-safe.
  // NOTE: observed via MutationObserver, not a locator — handleLogout
  // toasts and navigates in the same tick, so the toast may never
  // survive to a poll (probed: locator polls miss it reliably).
  const seenToasts = await page.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 3000));
    return ((window as unknown as { __toasts?: string[] }).__toasts ?? []).join("\n");
  });
  expect(seenToasts).toContain("That didn't work on our end.");
  await expect(page).toHaveURL(/\/login/, { timeout: 25000 });
  await page.goto("/new");
  await expect(gateDialog(page)).toBeVisible({ timeout: 25000 });
  await expectCleanEnv(errors, true, ["Transition was skipped"]);
});

// ---- A11 --------------------------------------------------------------------
// 2FA: (1) password users confirm their password, then enroll end to
// end (B33 fixed — enable used to send no password and die on raw
// "Invalid password"; now a confirm step mints the secret, a wrong
// password reads as authored copy, and the full cycle completes);
// (2) on a passwordless Google-only user the full enroll → verify →
// disable cycle works (TOTP computed in-spec). The login-challenge
// half is untestable here (no password login exists for Google-only).
// Both halves reset first (seed-2fa / seed-googleonly clear 2FA), so
// every run starts clean even if a previous run died mid-enroll
// (a stale ON state would challenge the next login for a lost
// secret).

test("A11 — 2FA enroll asks password users to confirm, full cycle works", async ({
  page,
  context,
}) => {
  test.setTimeout(300000);
  const errors = await collectErrors(page);
  const c = newCounters();
  await mockBackend(page, c);

  // Part 1: password user (fixed email + taken-fallback, one row).
  // Reset first: a run that died between verify and disable leaves
  // 2FA on, and the next login would challenge for a lost secret.
  const email = "e2e.2fa@example.com";
  const password = "E2e-2fa-9x7q!Test";
  await execFileAsync("npx.cmd", ["tsx", `${TEMP}\\seed-2fa.mts`], {
    cwd: ROOT,
    timeout: 60000,
    shell: true,
  });
  await page.goto("/signup");
  await page.getByPlaceholder("Your name").fill("E2E 2FA");
  await page.getByPlaceholder("name@college.com").fill(email);
  await page.getByPlaceholder("Choose your password").fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  const tookSignup = await Promise.race([
    page.waitForURL(/\/new/, { timeout: 25000 }).then(() => true),
    page
      .getByText(TAKEN_COPY, { exact: false })
      .waitFor({ timeout: 25000 })
      .then(() => false),
  ]);
  if (!tookSignup) await realLogin(page, email, password);
  await openProfileDialog(page);
  let dialog = page.getByRole("dialog").first();
  await dialog.getByRole("button", { name: "Authentication" }).click();
  // Self-heal: a previous run that died mid-enroll leaves 2FA on —
  // disable first (credential users confirm too) so every run starts
  // from the Enable state.
  if (
    await dialog
      .getByRole("button", { name: "Disable 2FA" })
      .count()
  ) {
    await dialog.getByRole("button", { name: "Disable 2FA" }).click();
    await dialog.getByPlaceholder("Your current password").fill(password);
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "Enable 2FA" }),
    ).toBeVisible({ timeout: 20000 });
  }
  await dialog.getByRole("button", { name: "Enable 2FA" }).click();
  // B33: credential users confirm their password before the secret
  // mints — no setup card yet.
  await expect(
    dialog.getByText("Confirm your password", { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    dialog.getByText("Set up your authenticator", { exact: false }),
  ).toHaveCount(0);
  // Wrong password → authored field copy (never raw server text),
  // still no setup card.
  await dialog.getByPlaceholder("Your current password").fill("Wrong-9x7q!Test");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    dialog.getByText("That password didn't match. Try again.", { exact: true }).first(),
  ).toBeVisible({ timeout: 20000 });
  await expect(
    dialog.getByText("Set up your authenticator", { exact: false }),
  ).toHaveCount(0);
  // Right password → secret mints; complete the cycle like part 2,
  // then disable so the seed user is left clean.
  await dialog.getByPlaceholder("Your current password").fill(password);
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    dialog.getByText("Set up your authenticator", { exact: false }).first(),
  ).toBeVisible({ timeout: 20000 });
  const keyText1 = await dialog
    .getByText("Setup key", { exact: true })
    .locator("..")
    .innerText({ timeout: 15000 });
  const secret1 = keyText1.replace(/setup key/i, "").replace(/[\s=]/g, "");
  expect(secret1.length).toBeGreaterThan(10);
  await dialog.getByPlaceholder("6-digit code").fill(totpNow(secret1));
  await dialog.getByRole("button", { name: "Verify and enable" }).click();
  await expect(
    dialog.getByText("Backup codes", { exact: false }).first(),
  ).toBeVisible({ timeout: 20000 });
  await page.keyboard.press("Escape");
  await openProfileDialog(page);
  dialog = page.getByRole("dialog").first();
  await dialog.getByRole("button", { name: "Authentication" }).click();
  await dialog.getByRole("button", { name: "Disable 2FA" }).click();
  await dialog.getByPlaceholder("Your current password").fill(password);
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  // Password-user cycle complete and cleaned: Enable is back.
  await expect(
    dialog.getByRole("button", { name: "Enable 2FA" }),
  ).toBeVisible({ timeout: 20000 });
  await page.keyboard.press("Escape");
  await sidebar(page).getByRole("link", { name: "Logout" }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 25000 });

  // Part 2: passwordless Google-only — full enroll/verify/disable.
  await execFileAsync("npx.cmd", ["tsx", `${TEMP}\\seed-googleonly.mts`], {
    cwd: ROOT,
    timeout: 60000,
    shell: true,
  });
  await addSession(context, GOOGLE_COOKIES);
  await page.goto("/new");
  await page
    .getByText("Ask anything", { exact: false })
    .first()
    .waitFor({ timeout: 25000 });
  expect(await realSessionEmail(page)).toBe(GOOGLE_EMAIL);
  await openProfileDialog(page);
  dialog = page.getByRole("dialog").first();
  await dialog.getByRole("button", { name: "Authentication" }).click();
  await dialog.getByRole("button", { name: "Enable 2FA" }).click();
  await expect(
    dialog.getByText("Set up your authenticator", { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  const keyText = await dialog
    .getByText("Setup key", { exact: true })
    .locator("..")
    .innerText({ timeout: 15000 });
  const secret = keyText.replace(/setup key/i, "").replace(/[\s=]/g, "");
  expect(secret.length).toBeGreaterThan(10);
  await dialog.getByPlaceholder("6-digit code").fill(totpNow(secret));
  await dialog.getByRole("button", { name: "Verify and enable" }).click();
  await expect(
    dialog.getByText("Backup codes", { exact: false }).first(),
  ).toBeVisible({ timeout: 20000 });
  await page.keyboard.press("Escape");
  // Disable restores plain state.
  await openProfileDialog(page);
  dialog = page.getByRole("dialog").first();
  await dialog.getByRole("button", { name: "Authentication" }).click();
  await dialog.getByRole("button", { name: "Disable 2FA" }).click();
  await expect(
    dialog.getByRole("button", { name: "Enable 2FA" }),
  ).toBeVisible({ timeout: 20000 });
  await expectCleanEnv(errors, true, ["Transition was skipped"]);
});

// ---- A12 --------------------------------------------------------------------
// Wrong password ×5 (D38): same non-enumerating copy every time, no
// lockout UI — then the correct password still works.

test("A12 — wrong password x5 never locks out, right one works", async ({
  page,
  _context,
}) => {
  test.setTimeout(180000);
  const errors = await collectErrors(page);
  const c = newCounters();
  await mockBackend(page, c);
  await page.goto("/login");
  await page.getByPlaceholder("name@college.com").fill(SEED_EMAIL);
  for (let i = 0; i < 5; i++) {
    await page.getByPlaceholder("Enter your password").fill(`Wrong-Pass-${i}!`);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(
      page.getByText(WRONG_CREDS_COPY, { exact: false }).first(),
    ).toBeVisible({ timeout: 25000 });
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
  }
  // No lockout: the correct password lands /new immediately.
  await page.getByPlaceholder("Enter your password").fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL(/\/new/, { timeout: 25000 });
  expect(await realSessionEmail(page)).toBe(SEED_EMAIL);
  await expectCleanEnv(errors);
});

// ---- A13 --------------------------------------------------------------------
// Password reset does not exist (D35): no entry point on /login,
// /forgot-password is a 404. Pins absence (server has no sender).

test("A13 — no password-reset flow exists to break", async ({
  page,
  _context,
}) => {
  const errors = await collectErrors(page);
  const c = newCounters();
  await mockBackend(page, c);
  await page.goto("/login");
  await expect(
    page.getByRole("button", { name: "Log in", exact: true }),
  ).toBeVisible({ timeout: 25000 });
  await expect(page.getByText(/forgot/i)).toHaveCount(0);
  const res = await page.goto("/forgot-password");
  expect(res?.status()).toBe(404);
  await expectCleanEnv(errors);
});

// ---- A14 --------------------------------------------------------------------
// Second browser session: separate storage, same user. Logout in A
// doesn't kill B (no revocation list; backend logout is a no-op).

test("A14 — logout in one session leaves the other alive", async ({
  browser,
}) => {
  test.setTimeout(180000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    await ensureSeed();
    await addSession(ctxA, PASS_COOKIES);
    await addSession(ctxB, PASS_COOKIES);
    const c = newCounters();
    await mockBackend(ctxA, c, {}, {
      meRow: ME({ email: SEED_EMAIL, displayName: "E2E SectionA" }),
    });
    await mockBackend(ctxB, c, {}, {
      meRow: ME({ email: SEED_EMAIL, displayName: "E2E SectionA" }),
    });
    const pA = await ctxA.newPage();
    const pB = await ctxB.newPage();
    const errorsA = await collectErrors(pA);
    const errorsB = await collectErrors(pB);
    for (const p of [pA, pB]) {
      await p.goto("/new");
      await expect
        .poll(
          async () =>
            p
              .getByRole("combobox", { name: "Message input" })
              .getAttribute("contenteditable"),
          { timeout: 25000 },
        )
        .toBe("true");
    }
    expect(await realSessionEmail(pA)).toBe(SEED_EMAIL);
    expect(await realSessionEmail(pB)).toBe(SEED_EMAIL);
    // Logout in A (separate storage — no ping crosses contexts).
    await sidebar(pA).getByRole("link", { name: "Logout" }).click();
    await expect(pA).toHaveURL(/\/login/, { timeout: 25000 });
    // B alive: no gate, footer still Logout, session intact, can act.
    await expect(gateDialog(pB)).toHaveCount(0, { timeout: 15000 });
    await expect(
      sidebar(pB).getByRole("link", { name: "Logout" }),
    ).toBeVisible({ timeout: 15000 });
    expect(await realSessionEmail(pB)).toBe(SEED_EMAIL);
    await openProfileDialog(pB);
    // Profile opens and acts (identity itself is proven by the real
    // session endpoint above — the dialog renders the mocked me row).
    await expect(
      pB.getByRole("dialog").first().getByRole("heading", { name: "My Profile" }),
    ).toBeVisible({ timeout: 20000 });
    await expectCleanEnv(errorsA, true, ["Transition was skipped"]);
    await expectCleanEnv(errorsB, true);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

// ---- A15 --------------------------------------------------------------------
// Login brute-force throttle [mock]: sign-in 429 → calm Banner, no
// spinner leak, nothing credential-ish in the message.

test("A15 — sign-in 429 surfaces calmly, no spinner leak", async ({
  page,
  _context,
}) => {
  const errors = await collectErrors(page);
  const c = newCounters();
  await mockBackend(page, c);
  await page.route("**/api/auth/sign-in/email", (r) =>
    r.fulfill(
      json(
        { error: { code: "RATE_LIMITED", message: "slow down" } },
        429,
        { "Retry-After": "30" },
      ),
    ),
  );
  await page.goto("/login");
  await page.getByPlaceholder("name@college.com").fill(SEED_EMAIL);
  await page.getByPlaceholder("Enter your password").fill(SEED_PASSWORD);
  const submit = page.getByRole("button", { name: "Log in", exact: true });
  await submit.click();
  // Some Banner appears (pin actual copy below on first run)…
  await expect(page.locator("[role='alert']").first()).toBeVisible({
    timeout: 25000,
  });
  // …never spinning forever, never echoing the password.
  await expect(submit).toBeEnabled({ timeout: 25000 });
  const bannerText =
    (await page.locator("[role='alert']").first().innerText()) ?? "";
  expect(bannerText, "banner must not echo the password").not.toContain(
    SEED_PASSWORD,
  );
  expect(await realSessionEmail(page)).toBeNull();
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await expectCleanEnv(errors);
});

// ---- A16 --------------------------------------------------------------------
// Post-login return-to-target (B36 fixed): guest deep link → gate →
// login carries ?returnTo → lands back ON the thread, not /new.

test("A16 — guest deep link logs in back onto the thread", async ({
  page,
  _context,
}) => {
  test.setTimeout(120000);
  const errors = await collectErrors(page);
  const c = newCounters();
  await mockBackend(
    page,
    c,
    {},
    { seedChats: [{ code: "a6aa16", title: "A16 thread" }] },
  );
  await page.goto("/subject/CN/a6aa16");
  // Guest on a deep link: gate (wherever it lands, login first).
  await expect(gateDialog(page)).toBeVisible({ timeout: 25000 });
  await gateDialog(page).getByRole("button", { name: "Log in" }).click();
  // The gate carries the target through.
  await expect(page).toHaveURL(/\/login\?returnTo=/, { timeout: 25000 });
  await page.getByPlaceholder("name@college.com").fill(SEED_EMAIL);
  await page.getByPlaceholder("Enter your password").fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  // Lands back on the deep target with a live session + live thread.
  await page.waitForURL(/\/subject\/CN\/a6aa16/, { timeout: 25000 });
  expect(await realSessionEmail(page)).toBe(SEED_EMAIL);
  await page
    .getByText("Ask anything about CN...", { exact: false })
    .first()
    .waitFor({ timeout: 25000 });
  await expect(
    page.getByRole("link", { name: "A16 thread" }),
  ).toBeVisible({ timeout: 15000 });
  await expectCleanEnv(errors, true, ["Transition was skipped"]);
});
