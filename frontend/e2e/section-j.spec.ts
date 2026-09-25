// Section J — security probes (S1–S12), staging unless noted.
// S1/S2/S4 are done-by-reference (I6+XSS-file I13, I7, E14) — no new
// tests; the plan slash points at the existing proofs. This file holds
// S3, S5, S6, S7, S8, S9, S10, S11, S12.
//
// Harness: lean copy of the section-i base (real BetterAuth session via
// seed cookies, reseed in beforeAll, one router per test, zero
// pageerror + zero console.error gate). Two backend shapes:
// - [mock] legs (S3, S7, S10, S12): only the endpoints the UI needs to
//   render are routed (me/profile/llm/token/chats as needed).
// - [staging-live] legs (S5, S6, S11): the REAL FastAPI backend on
//   :8000 (booted with FRONTEND_ORIGINS including :4323 and
//   BETTER_AUTH_URL pointing at :4323 for JWKS). Surgical mock routes
//   ONLY the non-chat endpoints (me/profile/llm) so the page renders;
//   /chats traffic passes through to the real server. Created rows are
//   deleted before the final asserts (record → cleanup → assert).
//
// Vendor/app facts pinned while implementing (cited, not guessed):
// - toUserMessage (lib/api/errors.ts:55-81): 404 → fixed copy, 5xx →
//   fixed copy (server text NEVER rendered), other 4xx → server message
//   (server-authored user-safe by contract) else fallback; TypeError /
//   AbortError → connection copy; AuthServiceError → authored message.
//   No code→copy map exists — "maps known" means the server message
//   passes through; the only code-ish guard is message !== "Not Found".
// - Sidebar search is client-side substring
//   (Pesdac.tsx:1409-1411 label.toLowerCase().includes(query)) — no SQL
//   near it; the server list endpoint also takes `q` (chat-sync.ts).
// - Adopt contract (backend tests/test_chats_adopt_idempotency.py):
//   first POST with clientAdoptKey → 201; replay same key → 200 with
//   the SAME row; distinct keys → distinct rows.
// - Mint shape: GET /api/auth/token → {token} (auth-cache.ts:92).
// - Unhandled rejections surface once via AppToasts as
//   console.error("Unhandled rejection:", redactForLog(reason))
//   (toast-policy.ts:35-69) — the S3 redaction proof injects one and
//   exempts exactly that prefix from the gate.
//
// Deviations from browser-break-it-plan.md (evidence over text):
//   D63 (S3): no full-HAR blob committed — the HAR is recorded to TEMP
//     and its API RESPONSE bodies are swept in-test (request headers
//     carry the Bearer token by design and are excluded from the token
//     sweep; static /_astro/* bundles are excluded — they contain the
//     words password/Bearer/email in source, a false-positive machine). Session/mint identity carriers are scoped: JWT allowed
//     only in /api/auth/token bodies, emails only in /api/auth/*
//     bodies; the mock fixture address is allow-listed, the REAL seed
//     address is forbidden everywhere.
//   D64 (S5/S6): surgical mock (non-chat endpoints routed, chats live)
//     instead of full-live pages — the onboarding/profile/llm legs have
//     no bearing on the server contract under test and would couple it
//     to seed-profile state.
//   D65 (S8): stronger than the spec's route.continue/curl options — a
//     real evil-origin page (node:http on :4873) performs the forged
//     POST in a genuine cross-origin browser context, with a same-
//     origin control leg proving the endpoint itself is live.
//   D66 (S7/S10): router-only legs run [mock] per the Section G
//     precedent — no backend behavior is under test, only Astro route
//     normalization + crash-freedom.

import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import * as fs from "node:fs";
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TEMP = "C:\\Users\\anubh\\AppData\\Local\\Temp\\opencode";
const ROOT = "C:\\Anubhav\\Web Dev Projects\\PESDac";
const PASS_COOKIES = `${TEMP}\\seed-cookies.json`;
const API = "http://localhost:8000/api/v1";
const SEED_EMAIL = "e2e.sectiona@example.com";
const MOCK_EMAIL = "e2e.sectionj@example.com";

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

test.beforeAll(async () => {
  await execFileAsync("npx.cmd", ["tsx", "seed-e2e.local.mts"], {
    cwd: ROOT,
    timeout: 60000,
    shell: true,
  });
});

function collectAll(page: Page): { errors: string[]; consoleText: string[] } {
  const errors: string[] = [];
  const consoleText: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    consoleText.push(`${msg.type()}: ${msg.text()}`);
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  return { errors, consoleText };
}

async function expectCleanEnv(
  errors: string[],
  allowHydraMismatch = false,
  extraAllow: string[] = [],
) {
  const app = errors.filter((e) => {
    if (e.includes("Failed to load resource") || e.includes("status of 404"))
      return false;
    if (
      allowHydraMismatch &&
      (e.includes("Minified React error #418") ||
        e.includes("Hydration failed because the server rendered HTML"))
    )
      return false;
    if (extraAllow.some((f) => e.includes(f))) return false;
    return true;
  });
  expect(app, `expected zero app errors, got:\n${app.join("\n")}`).toEqual([]);
}

// ---- lean mock shapes -------------------------------------------------------

const iso = () => new Date().toISOString();
const json = (data: unknown, status = 200) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(data),
});
const ME = {
  user: {
    id: "e2e",
    email: MOCK_EMAIL,
    displayName: "E2E SectionJ",
    onboardingDone: true,
  },
};
const PROFILE_ROW = {
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

/** Surgical router: ONLY non-chat endpoints. /chats traffic (and the
 *  same-origin /api/auth/* mint) passes through to the live servers. */
async function mockNonChat(
  target: Page | BrowserContext,
  counters: { me: number; profileGet: number; llm: number },
) {
  await target.unrouteAll({ behavior: "wait" });
  await target.route("**/api/v1/auth/me", (r) => {
    counters.me += 1;
    return r.fulfill(json(ME));
  });
  await target.route("**/api/v1/profiles/me", async (r) => {
    counters.profileGet += 1;
    if (r.request().method() === "PATCH") {
      const posted = r.request().postDataJSON() as Record<string, unknown>;
      Object.assign(PROFILE_ROW, posted);
    }
    return r.fulfill(json(PROFILE_ROW));
  });
  await target.route("**/api/v1/llm/status", (r) => {
    counters.llm += 1;
    return r.fulfill(json(LLM_READY));
  });
}

type FullCounters = {
  me: number;
  profileGet: number;
  profilePatch: number;
  llm: number;
  chatsGet: number;
  chatsPost: number;
  messagesPost: number;
  token: number;
};

/** Full mock router for the [mock] legs. */
async function mockBackend(
  target: Page | BrowserContext,
  c: FullCounters,
  ov: {
    profilePatch?: (attempt: number) => { status: number; body: unknown };
    messagesPost?: (attempt: number) => { status: number; body: unknown };
    chatsPost?: (attempt: number) => { status: number; body: unknown };
  } = {},
) {
  await target.unrouteAll({ behavior: "wait" });
  await target.route("**/api/auth/sign-out*", (r) =>
    r.fulfill(json({}, 200)),
  );
  await target.route("**/api/auth/update-user*", (r) =>
    r.fulfill(json({ status: true }, 200)),
  );
  await target.route("**/api/auth/token*", (r) => {
    c.token += 1;
    return r.fulfill(json({ token: `e2e-jwt-${c.token}` }, 200));
  });
  await target.route("**/api/v1/**", async (r) => {
    const req = r.request();
    const u = new URL(req.url());
    const m = req.method();
    const p = u.pathname;
    if (p === "/api/v1/auth/me" && m === "GET") {
      c.me += 1;
      return r.fulfill(json(ME));
    }
    if (p === "/api/v1/profiles/me" && m === "GET") {
      c.profileGet += 1;
      return r.fulfill(json(PROFILE_ROW));
    }
    if (p === "/api/v1/profiles/me" && m === "PATCH") {
      c.profilePatch += 1;
      const out = ov.profilePatch
        ? ov.profilePatch(c.profilePatch)
        : { status: 200, body: PROFILE_ROW };
      return r.fulfill(json(out.body, out.status));
    }
    if (p === "/api/v1/llm/status") {
      c.llm += 1;
      return r.fulfill(json(LLM_READY));
    }
    if (p === "/api/v1/chats" && m === "GET") {
      c.chatsGet += 1;
      return r.fulfill(
        json({
          data: [],
          pagination: { limit: 50, offset: 0, total: 0 },
        }),
      );
    }
    if (p === "/api/v1/chats" && m === "POST") {
      c.chatsPost += 1;
      const out = ov.chatsPost
        ? ov.chatsPost(c.chatsPost)
        : {
            status: 201,
            body: {
              code: "s3mock",
              subject: "CN",
              title: "s3",
              isPinned: false,
              isArchived: false,
              createdAt: iso(),
              updatedAt: iso(),
            },
          };
      return r.fulfill(json(out.body, out.status));
    }
    if (/\/api\/v1\/chats\/[^/]+\/messages$/.test(p) && m === "POST") {
      c.messagesPost += 1;
      const out = ov.messagesPost
        ? ov.messagesPost(c.messagesPost)
        : { status: 201, body: { ok: true } };
      return r.fulfill(json(out.body, out.status));
    }
    if (/\/api\/v1\/chats\/[^/]+\/messages/.test(p) && m === "GET") {
      return r.fulfill(
        json({
          data: [],
          pagination: { limit: 50, offset: 0, total: 0 },
        }),
      );
    }
    return r.fulfill(json({ error: { code: "NOT_FOUND", message: "x" } }, 404));
  });
}

const newFullCounters = (): FullCounters => ({
  me: 0,
  profileGet: 0,
  profilePatch: 0,
  llm: 0,
  chatsGet: 0,
  chatsPost: 0,
  messagesPost: 0,
  token: 0,
});

const sidebar = (page: Page) => page.locator("nav, aside").first();

// The composer is role=combobox (section-i:471), never role=textbox.
const composer = (page: Page) =>
  page.getByRole("combobox", { name: "Message input" });

async function openProfileDialog(page: Page) {
  await sidebar(page).getByRole("link", { name: "My Profile" }).click();
  await expect(page.getByRole("dialog").first()).toBeVisible({
    timeout: 15000,
  });
}

async function toastTexts(page: Page): Promise<string[]> {
  return page
    .locator('[role="status"], [role="alert"]')
    .allInnerTexts()
    .catch(() => []);
}

// ---- S3 — secret redaction --------------------------------------------------

test("S3 — failures leak no secrets into console, toasts, or response bodies", async ({
  browser,
}) => {
  const harPath = `${TEMP}\\s3-sweep.har`;
  try {
    fs.unlinkSync(harPath);
  } catch {
    /* fresh */
  }
  const context = await browser.newContext({ recordHar: { path: harPath } });
  try {
    await addSession(context, PASS_COOKIES);
    const page = await context.newPage();
    const { errors, consoleText } = collectAll(page);
    const c = newFullCounters();
    await mockBackend(page, c, {
      messagesPost: () => ({
        status: 500,
        body: { error: { code: "SERVER_ERROR", message: "kaboom" } },
      }),
      profilePatch: () => ({
        status: 500,
        body: { error: { code: "SERVER_ERROR", message: "db blew up" } },
      }),
    });
    await page.goto("/new");
    await expect(
      page.getByText("Ask anything about your course...", { exact: false }).first(),
    ).toBeVisible({ timeout: 25000 });

    // Transient toasts are snapshot-polled: the sweep must see them
    // even if Astryx auto-dismisses before a single read.
    const seenToasts = new Set<string>();
    const snap = async () => {
      for (const t of await toastTexts(page)) seenToasts.add(t);
    };
    const snapUntil = async (cond: () => Promise<boolean>, label: string) => {
      const t0 = Date.now();
      for (;;) {
        await snap();
        if (await cond()) return;
        if (Date.now() - t0 > 20000)
          throw new Error(`S3: timed out waiting for ${label}`);
        await page.waitForTimeout(500);
      }
    };

    // (a) failing send: the append POST fires and fails; the failure
    // surfaces as a (transient) toast — the sweep below is the assert,
    // so soak snapshots instead of point-asserting a dismissed toast.
    const box = composer(page);
    await box.click();
    await page.keyboard.type("s3 secret-sweep probe", { delay: 10 });
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect
      .poll(() => c.messagesPost, { timeout: 20000 })
      .toBeGreaterThanOrEqual(1);
    for (let i = 0; i < 12; i++) {
      await snap();
      await page.waitForTimeout(500);
    }
    console.log(
      `[S3] chatsPost=${c.chatsPost} messagesPost=${c.messagesPost} toastsSeen=${seenToasts.size}`,
    );
    // Pinned fixed behavior (B47): the send path resolves through
    // toUserMessage like every other surface — the append-500 toast
    // reads the 5xx copy ("That didn't work on our end…"), not the
    // old leg-fixed fallback. S12's profile leg pins the same copy.
    expect(
      [...seenToasts].some((t) => /didn't work on our end/i.test(t)),
      `S3: append-500 5xx toast missing; seen: ${[...seenToasts].join(" | ")}`,
    ).toBe(true);

    // (b) failing profile save → toast, dialog stays open. Vehicle: the
    // Campus select PATCHes /api/v1/profiles/me on every pick (E19).
    await openProfileDialog(page);
    const dlg = page.getByRole("dialog");
    await dlg.getByRole("combobox", { name: "Campus" }).click();
    await page.getByRole("option", { name: "RR Campus" }).click();
    await snapUntil(
      async () =>
        [...seenToasts].some((t) => /didn't work on our end/i.test(t)),
      "profile-failure toast",
    );
    await expect(page.getByRole("dialog").first()).toBeVisible();
    expect(c.profilePatch).toBeGreaterThanOrEqual(1);

    // (c) direct redaction proof: an unhandled rejection carrying
    // Bearer + password-shaped secrets must log redacted, never raw.
    // NOTE: Chromium ALSO reports the synthetic rejection itself via
    // the browser's uncaught-error channel (pageerror, raw by nature —
    // no app code can redact another channel's echo). The gate exempts
    // exactly this synthetic marker; the asserts below prove the APP's
    // own log line is redacted. No app path throws secret-carrying
    // rejections today (filed as O-note, not a bug).
    const fakeBearer = "Bearer e2e-fake-jwt-0123456789abcdef-sees3";
    const fakePw = "password= hunter2-s3-should-redact";
    await page.evaluate(
      ([b, p]) => {
        setTimeout(() => {
          void Promise.reject(
            new Error(`flush failed, header ${b} and login ${p}`),
          );
        }, 0);
      },
      [fakeBearer, fakePw] as const,
    );
    await expect
      .poll(
        () =>
          consoleText.filter((l) => l.includes("Unhandled rejection:")).length,
        { timeout: 15000 },
      )
      .toBeGreaterThanOrEqual(1);
    const rejLines = consoleText.filter((l) =>
      l.includes("Unhandled rejection:"),
    );
    console.log(`[S3] rejection lines=${rejLines.length}`);
    for (const line of rejLines) {
      expect(line).toContain("[redacted]");
      expect(line).not.toContain("hunter2-s3-should-redact");
      expect(line).not.toContain("e2e-fake-jwt-0123456789abcdef-sees3");
    }

    // (d) sweep console + toast text: no secret shapes at all. The mock
    // fixture address is synthetic (allowed); the REAL seed address is
    // forbidden everywhere. Toasts come from the snapshot set (they
    // auto-dismiss; a single end-of-test read would miss them).
    await snap();
    const toasts = [...seenToasts];
    const surfaces = [...consoleText, ...toasts];
    const forbidden: Array<[string, RegExp]> = [
      ["bearer", /Bearer\s+\S+/],
      ["sk-key", /sk-[A-Za-z0-9-_]{8,}/],
      ["ghp", /ghp_[A-Za-z0-9_]{8,}/],
      ["jwt", /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
      ["password", /password\s*[:=]\s*\S+/i],
      ["real-seed-email", new RegExp(SEED_EMAIL.replace(".", "\\."))],
    ];
    for (const [name, re] of forbidden) {
      const hits = surfaces.filter((t) => re.test(t));
      expect(hits, `S3: ${name} leaked into console/toast: ${hits[0]}`).toEqual(
        [],
      );
    }
    console.log(
      `[S3] swept console=${consoleText.length} toastRegions=${toasts.length} clean`,
    );

    // (e) sweep HAR RESPONSE bodies (request headers carry Bearer by
    // design — excluded). JWT only in the mint body, emails only in
    // /api/auth/* bodies, mock fixture address exempt.
    await context.close();
    const har = JSON.parse(fs.readFileSync(harPath, "utf8")) as {
      log: {
        entries: Array<{
          request: { url: string };
          response: { content: { text?: string; encoding?: string } };
        }>;
      }
    };
    let bodyCount = 0;
    const violations: string[] = [];
    for (const e of har.log.entries) {
      const url: string = e.request.url;
      // API traffic only: static bundles (/_astro/*.js) legitimately
      // contain the WORDS "password"/"Bearer"/"email" in source (field
      // labels, the withBearerToken template, validation copy) — sweeping
      // minified source for secret shapes is a false-positive machine.
      if (!url.includes("/api/")) continue;
      const text = e.response.content?.text ?? "";
      if (!text || e.response.content?.encoding === "base64") continue;
      bodyCount += 1;
      const isMint = url.includes("/api/auth/token");
      const isAuth = url.includes("/api/auth/");
      const scrubbed = text.split(MOCK_EMAIL).join("");
      const checks: Array<[string, RegExp, boolean]> = [
        ["bearer", /Bearer\s+\S+/, false],
        ["sk-key", /sk-[A-Za-z0-9-_]{8,}/, false],
        ["jwt", /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, isMint],
        ["password", /password\s*[:=]\s*\S+/i, false],
        [
          "email",
          /[A-Za-z0-9_.+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9-.]+/,
          isAuth,
        ],
      ];
      for (const [name, re, allowed] of checks) {
        if (!allowed && re.test(scrubbed))
          violations.push(`${name} in ${url}: ${scrubbed.slice(0, 120)}`);
      }
    }
    console.log(`[S3] swept harBodies=${bodyCount}`);
    expect(violations, `S3: leaks in HAR bodies:\n${violations.join("\n")}`).toEqual(
      [],
    );

    await expectCleanEnv(errors, false, [
      "Unhandled rejection:",
      "e2e-fake-jwt-0123456789abcdef-sees3",
    ]);
  } finally {
    await context.close().catch(() => {});
  }
});

// ---- S5 — adopt-key replay (staging-live) -----------------------------------

test("S5 — replayed clientAdoptKey returns 200 + same row, exactly one chat", async ({
  page,
}) => {
  const { errors } = collectAll(page);
  const counters = { me: 0, profileGet: 0, llm: 0 };
  await mockNonChat(page, counters);
  await addSession(page.context(), PASS_COOKIES);
  await page.goto("/new");
    await expect(composer(page)).toBeVisible({ timeout: 20000 });

  const out = await page.evaluate(async (api: string) => {
    const mintRes = await fetch("/api/auth/token", {
      credentials: "include",
    });
    if (!mintRes.ok)
      return { fatal: `mint ${mintRes.status}`, s1: 0, s2: 0 };
    const { token } = (await mintRes.json()) as { token: string };
    const key =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `s5-${Date.now()}-key`;
    const title = `s5-adopt-${Date.now()}`;
    const auth = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const post = (body: unknown) =>
      fetch(`${api}/chats`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify(body),
      });
    const r1 = await post({ subject: "CN", title, clientAdoptKey: key });
    const b1 = (await r1.json()) as { code?: string };
    const r2 = await post({ subject: "CN", title, clientAdoptKey: key });
    const b2 = (await r2.json()) as { code?: string };
    const listRes = await fetch(`${api}/chats`, { headers: auth });
    const list = (await listRes.json()) as {
      data: Array<{ code: string; title: string }>;
    };
    const matches = list.data.filter((ch) => ch.title === title);
    let delStatus = 0;
    if (b1.code) {
      const del = await fetch(`${api}/chats/${b1.code}`, {
        method: "DELETE",
        headers: auth,
      });
      delStatus = del.status;
    }
    return {
      s1: r1.status,
      s2: r2.status,
      c1: b1.code ?? null,
      c2: b2.code ?? null,
      n: matches.length,
      delStatus,
    };
  }, API);
  console.log(
    `[S5] first=${out.s1} replay=${out.s2} sameCode=${out.c1 === out.c2} rows=${out.n} cleanup=${out.delStatus}`,
  );
  expect(out.fatal, "token mint must succeed for the live leg").toBeUndefined();
  expect(out.s1).toBe(201);
  expect(out.s2).toBe(200);
  expect(out.c1).toBeTruthy();
  expect(out.c2).toBe(out.c1);
  expect(out.n).toBe(1);
  expect(out.delStatus).toBe(204);
  await expectCleanEnv(errors);
});

// ---- S6 — search-box SQLi (staging-live) ------------------------------------

test("S6 — SQLi payloads filter literally, backend rows survive", async ({
  page,
}) => {
  const { errors } = collectAll(page);
  const counters = { me: 0, profileGet: 0, llm: 0 };
  await mockNonChat(page, counters);
  await addSession(page.context(), PASS_COOKIES);
  await page.goto("/new");
    await expect(composer(page)).toBeVisible({ timeout: 20000 });

  const stamp = Date.now();
  const titles = [`s6 alpha ${stamp}`, `s6 beta ${stamp}`];
  const seeded = await page.evaluate(async ({ api, ts }: { api: string; ts: string[] }) => {
    const { token } = (await (
      await fetch("/api/auth/token", { credentials: "include" })
    ).json()) as { token: string };
    const auth = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const codes: string[] = [];
    for (const title of ts) {
      const r = await fetch(`${api}/chats`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ subject: "CN", title }),
      });
      const b = (await r.json()) as { code: string };
      codes.push(b.code);
    }
    return { codes, token };
  }, { api: API, ts: titles });
  expect(seeded.codes).toHaveLength(2);

  await page.reload();
    await expect(composer(page)).toBeVisible({ timeout: 20000 });
  const row = (t: string) => sidebar(page).getByText(t, { exact: false });
  await expect(row(titles[0]).first()).toBeVisible({ timeout: 20000 });
  await expect(row(titles[1]).first()).toBeVisible({ timeout: 20000 });

  // The search input mounts only after opening it (SideNav toggle).
  await sidebar(page)
    .getByRole("link", { name: "Search conversations" })
    .click();
  const box = page.getByPlaceholder("Search conversations...");
  await expect(box).toBeVisible({ timeout: 10000 });

  for (const payload of [`' OR '1'='1`, `; DROP TABLE chats;--`]) {
    await box.fill(payload);
    await expect(row(titles[0])).toHaveCount(0, { timeout: 10000 });
    await expect(row(titles[1])).toHaveCount(0, { timeout: 10000 });
    console.log(`[S6] payload literal, zero rows: ${payload}`);
  }
  await box.fill("");
  await expect(row(titles[0]).first()).toBeVisible({ timeout: 10000 });
  await expect(row(titles[1]).first()).toBeVisible({ timeout: 10000 });

  // Backend rows intact (no DROP), then clean up before asserting.
  const after = await page.evaluate(async ({ api, token, ts }: { api: string; token: string; ts: string[] }) => {
    const auth = { Authorization: `Bearer ${token}` };
    const list = (await (
      await fetch(`${api}/chats`, { headers: auth })
    ).json()) as { data: Array<{ code: string; title: string }> };
    const present = ts.filter((t) => list.data.some((ch) => ch.title === t));
    const dels: number[] = [];
    for (const ch of list.data.filter((ch) => ts.includes(ch.title))) {
      const d = await fetch(`${api}/chats/${ch.code}`, {
        method: "DELETE",
        headers: auth,
      });
      dels.push(d.status);
    }
    const list2 = (await (
      await fetch(`${api}/chats`, { headers: auth })
    ).json()) as { data: Array<{ title: string }> };
    const gone = ts.every((t) => !list2.data.some((ch) => ch.title === t));
    return { present, dels, gone };
  }, { api: API, token: seeded.token, ts: titles });
  console.log(
    `[S6] rowsSurvived=${after.present.length}/2 cleanup=${after.dels.join(",")} gone=${after.gone}`,
  );
  expect(after.present).toEqual(titles);
  expect(after.dels).toEqual([204, 204]);
  expect(after.gone).toBe(true);
  // Hydra #418 allowed: real backend rows SSR-hydrate like thread turns
  // (same pre-existing pattern as the thread legs — server HTML vs
  // client list, content identical, app fully alive).
  await expectCleanEnv(errors, true);
});

// ---- S7 — path traversal chat code ------------------------------------------

test("S7 — encoded traversal strands on welcome, never a data page", async ({
  page,
}) => {
  const { errors } = collectAll(page);
  const c = newFullCounters();
  await mockBackend(page, c);
  await addSession(page.context(), PASS_COOKIES);
  const res = await page.goto("/subject/os/..%2f..%2fusers%2fme", {
    waitUntil: "domcontentloaded",
    timeout: 20000,
  });
  const status = res?.status() ?? -1;
  console.log(`[S7] status=${status} url=${page.url()}`);
  // Not a data page: no redirect into /profile, no profile-page
  // markers (the sidebar's OWN signed-in identity is legitimate shell
  // state — the N1-stranded welcome, not a leak).
  expect(page.url()).toContain("..%2f");
  await expect(composer(page)).toBeVisible({ timeout: 20000 });
  const bodyText = await page.locator("body").innerText();
  expect(bodyText).not.toContain("Display name");
  expect(bodyText).not.toContain("Export");
  await expectCleanEnv(errors);
});

// ---- S8 — cross-origin auth POST --------------------------------------------

test("S8 — forged cross-origin sign-in is rejected, no session minted", async ({
  browser,
}) => {
  let server: Server | null = null;
  const evilPort = 4873;
  const evilHtml = `<!doctype html><html><body><div id="out">PENDING</div><script>
fetch('http://localhost:4323/api/auth/sign-in/email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'s8-unknown@example.test',password:'wrong-s8-nope'}),credentials:'include'}).then(async r=>{const t=await r.text();document.getElementById('out').textContent='STATUS:'+r.status+':'+t.slice(0,200)}).catch(e=>{document.getElementById('out').textContent='BLOCKED:'+e.name});
</script></body></html>`;
  server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(evilHtml);
  });
  await new Promise<void>((resolve) => server!.listen(evilPort, "localhost", resolve));
  const context = await browser.newContext();
  try {
    const evil = await context.newPage();
    const collected: string[] = [];
    evil.on("pageerror", (err) => collected.push(`pageerror: ${err.message}`));
    await evil.goto(`http://localhost:${evilPort}/`, { timeout: 20000 });
    await expect
      .poll(async () => evil.locator("#out").innerText(), { timeout: 20000 })
      .not.toBe("PENDING");
    const outcome = await evil.locator("#out").innerText();
    console.log(`[S8] evil-origin outcome=${outcome.slice(0, 120)}`);
    expect(outcome).not.toMatch(/^STATUS:2\d\d/);
    expect(outcome.toLowerCase()).not.toContain("session_token");
    // Rejected (403 envelope) or preflight-blocked (TypeError) — both
    // prove the forged origin gets no session.
    expect(outcome).toMatch(/^(STATUS:403|BLOCKED:TypeError)/);

    // No session was minted: the app still shows the guest gate.
    const app = await context.newPage();
    const { errors } = collectAll(app);
    await app.goto("/new", { timeout: 20000 });
    await expect(app.getByText(/log in/i).first()).toBeVisible({
      timeout: 20000,
    });

    // Control: the endpoint itself is live same-origin.
    const live = await app.evaluate(async () => {
      const r = await fetch("/api/auth/get-session", {
        credentials: "same-origin",
      });
      return r.status;
    });
    console.log(`[S8] same-origin control get-session=${live}`);
    expect(live).toBeLessThan(500);
    await expectCleanEnv(errors);
    expect(collected).toEqual([]);
  } finally {
    await context.close().catch(() => {});
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
});

// ---- S9 — login oracle ------------------------------------------------------

test("S9 — unknown-email and wrong-password responses are indistinguishable", async ({
  page,
}) => {
  const { errors } = collectAll(page);
  const c = newFullCounters();
  await mockBackend(page, c);
  await addSession(page.context(), PASS_COOKIES);
  await page.goto("/new");
    await expect(composer(page)).toBeVisible({ timeout: 20000 });

  const out = await page.evaluate(async (seedEmail: string) => {
    const attempt = async (email: string) => {
      const r = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, password: "wrong-pw-s9-nope" }),
      });
      return { status: r.status, text: await r.text() };
    };
    const a = await attempt(seedEmail);
    const b = await attempt(`s9-unknown-${Date.now()}@example.test`);
    return { a, b };
  }, SEED_EMAIL);
  console.log(
    `[S9] known=${out.a.status}:${out.a.text.slice(0, 120)} unknown=${out.b.status}:${out.b.text.slice(0, 120)}`,
  );
  expect(out.a.status).toBe(out.b.status);
  expect(out.a.text).toBe(out.b.text);
  // Vacuity guard: an origin-blocked 403 pair would also be "equal" —
  // the bodies must be credential verdicts, not origin verdicts.
  expect(out.a.text.toLowerCase()).not.toContain("origin");
  // The shared opaque verdict: one message for both halves (this exact
  // string IS the indistinguishability proof — it names neither half).
  expect((JSON.parse(out.a.text) as { message: string }).message).toBe(
    "Invalid email or password",
  );
  await expectCleanEnv(errors);
});

// ---- S10 — overlong URL -----------------------------------------------------

test("S10 — 8k-char path is handled, no crash, no log-spam", async ({
  page,
}) => {
  const { errors, consoleText } = collectAll(page);
  const c = newFullCounters();
  await mockBackend(page, c);
  await addSession(page.context(), PASS_COOKIES);
  const res = await page.goto(`/${"a".repeat(8000)}`, {
    waitUntil: "domcontentloaded",
    timeout: 20000,
  });
  const status = res?.status() ?? -1;
  await page.waitForTimeout(1500);
  console.log(`[S10] status=${status} consoleLines=${consoleText.length}`);
  expect(status).toBeGreaterThanOrEqual(400);
  const alive = await page
    .evaluate(() => document.querySelector("main, body") !== null)
    .catch(() => false);
  expect(alive).toBe(true);
  // No log-spam DoS: the giant URL must not flood the console.
  const urlEchoes = consoleText.filter((l) => l.length > 2000);
  expect(urlEchoes).toEqual([]);
  await expectCleanEnv(errors);
});

// ---- S11 — logged-out API fetch (staging-live) ------------------------------

test("S11 — logged-out chats fetch is 401 + empty, never data", async ({
  browser,
}) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const { errors } = collectAll(page);
    // Fully live page, zero mocks: guests are memory-only (E13b).
    await page.goto("/new", { timeout: 20000 });
    await expect(page.getByText(/log in/i).first()).toBeVisible({
      timeout: 20000,
    });
    const out = await page.evaluate(async (api: string) => {
      const r = await fetch(`${api}/chats`);
      return { status: r.status, text: (await r.text()).slice(0, 500) };
    }, API);
    console.log(`[S11] status=${out.status} body=${out.text.slice(0, 160)}`);
    expect(out.status).toBe(401);
    expect(out.text.toLowerCase()).toContain("error");
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(out.text);
    } catch {
      /* non-JSON still must not be data */
    }
    if (parsed && typeof parsed === "object" && parsed !== null) {
      const data = (parsed as Record<string, unknown>).data;
      expect(Array.isArray(data) ? data.length : 0).toBe(0);
    }
    // Probe policy: the fetch above sends no Authorization header and
    // reads no cookies/storage — status + envelope only.
    await expectCleanEnv(errors);
  } finally {
    await context.close().catch(() => {});
  }
});

// ---- S12 — envelope shape discipline ----------------------------------------

test("S12 — unknown error codes degrade to generic, never raw", async ({
  page,
}) => {
  const { errors } = collectAll(page);
  const c = newFullCounters();
  await mockBackend(page, c, {
    profilePatch: (attempt) => {
      if (attempt === 1)
        return {
          status: 400,
          body: { error: { code: "ZZ_UNKNOWN_CODE_9", message: "" } },
        };
      if (attempt === 2)
        return {
          status: 500,
          body: {
            error: {
              code: "ZZ_UNKNOWN_CODE_9",
              message: "server exploded: ZZ_UNKNOWN_CODE_9",
            },
          },
        };
      if (attempt === 3)
        return {
          status: 404,
          body: {
            error: { code: "ZZ_UNKNOWN_CODE_9", message: "gone: ZZ_UNKNOWN_CODE_9" },
          },
        };
      return {
        status: 400,
        body: {
          error: { code: "BAD_REQUEST", message: "That campus is not available." },
        },
      };
    },
  });
  await addSession(page.context(), PASS_COOKIES);
  await page.goto("/new");
    await expect(composer(page)).toBeVisible({ timeout: 20000 });
  await openProfileDialog(page);

  // Vehicle: the Campus select PATCHes /api/v1/profiles/me on every
  // pick and reverts locally on failure (E19) — re-pickable per leg.
  const legs: Array<{ name: string; expectCopy: string; forbidCode: boolean }> = [
    {
      name: "S12a",
      expectCopy: "Couldn't save. Try again.",
      forbidCode: true,
    },
    {
      name: "S12b",
      expectCopy: "That didn't work on our end. Please try again later.",
      forbidCode: true,
    },
    {
      name: "S12c",
      expectCopy: "That didn't work. Please try again later.",
      forbidCode: true,
    },
    {
      name: "S12d",
      expectCopy: "That campus is not available.",
      forbidCode: false,
    },
  ];
  const dlg = page.getByRole("dialog");
  for (const leg of legs) {
    await dlg.getByRole("combobox", { name: "Campus" }).click();
    await page.getByRole("option", { name: "RR Campus" }).click();
    await expect(page.getByText(leg.expectCopy).first()).toBeVisible({
      timeout: 15000,
    });
    console.log(`[S12] ${leg.name} surfaced: "${leg.expectCopy}"`);
    if (leg.forbidCode) {
      const bodyText = await page.locator("body").innerText();
      expect(bodyText).not.toContain("ZZ_UNKNOWN_CODE_9");
    }
    // Never a dead-end: the dialog stays open after every failure.
    await expect(page.getByRole("dialog").first()).toBeVisible();
  }
  // Known-code leg renders the SERVER message (pass-through contract),
  // unknown legs never render server text (S12b/c) or raw codes.
  const finalBody = await page.locator("body").innerText();
  expect(finalBody).not.toContain("server exploded");
  expect(c.profilePatch).toBe(4);
  await expectCleanEnv(errors);
});
