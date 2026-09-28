// Section N — retrieval display matrix (spec §4.1 + §4.4 + §6).
// Real BetterAuth session (seed users in Neon) + mocked FastAPI
// (`**/api/v1/**`). Every `/retrieval/*` leg is route-mocked per test;
// the search delay fixture simulates a slow embed (no sleeps in test
// code — all waits are expect() with timeouts).
//
// Seed prerequisites (machine-local, 7-day sessions — re-run to refresh):
//   node seed-e2e.local.mts            # password user sign-in cookies
// (seed helper is TEMP-only — never committed; see section-a header.)
//
// Conventions (from section-a): one `**/api/v1/**` router per test
// (registered after unrouteAll), exactly one terminal action per
// handler, never assert inside a handler. 422/429 toast assertions
// belong to T7 (AppToasts bridges) — this spec pins the surfaces T5
// built and notes the T7 follow-up inline.

import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import * as fs from "node:fs";

const TEMP = "C:\\Users\\anubh\\AppData\\Local\\Temp\\opencode";
const PASS_COOKIES = `${TEMP}\\seed-cookies.json`;

type NamedCookie = { name: string; value: string };

function loadCookie(file: string): NamedCookie {
  if (!fs.existsSync(file)) {
    throw new Error(`missing seed cookies ${file} — run the seed step first (see header).`);
  }
  const raw: string[] = JSON.parse(fs.readFileSync(file, "utf8"));
  const first = raw[0].split(";")[0];
  const eq = first.indexOf("=");
  return { name: first.slice(0, eq), value: first.slice(eq + 1) };
}

async function addSession(context: BrowserContext) {
  const c = loadCookie(PASS_COOKIES);
  await context.addCookies([
    { name: c.name, value: c.value, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" },
  ]);
}

async function collectErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  return errors;
}

const HYDRA_FINGERPRINTS = ["Minified React error #418", "Hydration failed because the server rendered HTML"];
async function expectCleanEnv(errors: string[], extraAllow: string[] = []) {
  const app = errors.filter((e) => {
    if (e.includes("Failed to load resource") || e.includes("status of 404")) return false;
    if (HYDRA_FINGERPRINTS.some((f) => e.includes(f))) return false;
    if (extraAllow.some((f) => e.includes(f))) return false;
    return true;
  });
  expect(app, `expected zero app errors, got:\n${app.join("\n")}`).toEqual([]);
}

// ---- mock shapes -----------------------------------------------------------

const iso = () => new Date().toISOString();
const json = (data: unknown, status = 200) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(data),
});
const errBody = (code: string, message: string) => ({ error: { code, message } });
const ME = () => ({
  user: { id: "e2e", email: "e2e.sectionn@example.com", displayName: "E2E SectionN", onboardingDone: true },
});
const PROFILE_ROW = { institution: "", semester: "", branch: "", subjects: [], campus: "", onboardingDone: true };
const LLM_READY = { configured: true, provider: "openrouter", keyHint: "abcd", model: "openai/gpt-4o-mini" };
const HEALTH_OK = { ok: true, provider: "workers-ai", dims: 768, sources: 3, chunks: 120, neurons_24h_estimate: 5 };
const EXPIRY_COPY = "Your session expired. Please log in again.";

function bundleItem(over: Record<string, unknown> = {}) {
  return {
    chunk_id: "c1",
    kind: "slides",
    page: 42,
    bbox: null,
    text: "The mitochondria is the powerhouse of the cell.",
    latex: null,
    table_md: null,
    caption: null,
    concepts: ["mitochondria"],
    thumb_url: null,
    page_url: "https://cdn.test/u1/p42",
    video: null,
    score: 0.9,
    ...over,
  };
}
const bundle = (items: unknown[]) => ({
  data: items,
  pagination: { limit: 10, offset: 0, total: items.length },
});

type Fulfill = { status: number; body: unknown };
type SearchLeg = (n: number) => Fulfill | Promise<Fulfill>;

async function mockBackend(
  page: Page,
  counters: { search: number; me: number; messagesPost: number },
  ov: {
    search?: SearchLeg;
    meFlipping?: boolean;
    messagesPostStatus?: number;
  } = {},
) {
  await page.unrouteAll({ behavior: "wait" });
  await page.route("**/api/auth/sign-out*", (r) => r.fulfill(json({}, 200)));
  await page.route("**/api/v1/**", async (r) => {
    const req = r.request();
    const u = new URL(req.url());
    const p = u.pathname;
    const m = req.method();
    if (p === "/api/v1/auth/me" && m === "GET") {
      counters.me += 1;
      if (ov.meFlipping && counters.messagesPost >= 1)
        return r.fulfill(json(errBody("UNAUTHORIZED", "nope"), 401));
      return r.fulfill(json(ME()));
    }
    if (p === "/api/v1/profiles/me" && m === "GET") return r.fulfill(json(PROFILE_ROW));
    if (p === "/api/v1/llm/status") return r.fulfill(json(LLM_READY));
    if (p === "/api/v1/retrieval/health") return r.fulfill(json(HEALTH_OK));
    if (p === "/api/v1/retrieval/search" && m === "POST") {
      counters.search += 1;
      bodies.push(safePostData(req));
      const out = await (ov.search ? ov.search(counters.search) : { status: 200 as const, body: bundle([bundleItem()]) });
      return r.fulfill(json(out.body, out.status));
    }
    if (p === "/api/v1/chats" && m === "GET")
      return r.fulfill(
        json({
          data: [{ code: "t3s1e4", subject: "CN", title: "seed", isPinned: false, isArchived: false, createdAt: iso(), updatedAt: iso() }],
          pagination: { limit: 50, offset: 0, total: 1 },
        }),
      );
    if (/\/api\/v1\/chats\/[^/]+\/messages/.test(p) && m === "GET")
      return r.fulfill(json({ data: [], pagination: { limit: 50, offset: 0, total: 0 } }));
    if (/\/api\/v1\/chats\/[^/]+\/messages/.test(p) && m === "POST") {
      counters.messagesPost += 1;
      if (ov.messagesPostStatus != null) return r.fulfill(json(errBody("UNAUTHORIZED", "nope"), ov.messagesPostStatus));
      let posted: { role?: string; content?: unknown } = {};
      try {
        posted = req.postDataJSON() as { role?: string; content?: unknown };
      } catch {
        posted = {};
      }
      return r.fulfill(json({ id: "m1", seq: 1, role: posted.role ?? "user", content: posted.content ?? {}, createdAt: iso() }));
    }
    if (p === "/api/v1/auth/logout") return r.fulfill(json({}));
    return r.continue();
  });
}

function safePostData(req: import("@playwright/test").Request): unknown {
  try {
    return req.postDataJSON();
  } catch {
    return null;
  }
}
const bodies: unknown[] = [];

function newCounters() {
  return { search: 0, me: 0, messagesPost: 0 };
}

async function openThread(page: Page) {
  await page.goto("/subject/CN/t3s1e4");
  await page.getByText("Ask anything about CN...", { exact: false }).first().waitFor({ timeout: 25000 });
}

async function threadSend(page: Page, text: string) {
  await page.getByRole("combobox", { name: "Message input" }).click();
  await page.keyboard.type(text, { delay: 10 });
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

// Retry pill for the failed search (composer status row). The pill only
// renders once the mock turn settles (live == null), so wait for it.
async function searchRetry(page: Page) {
  const pill = page.getByRole("button", { name: "Retry" }).first();
  await expect(pill).toBeVisible({ timeout: 30000 });
  await pill.click();
}

// ---- N1 --------------------------------------------------------------------

test("N1 — 200 with results renders bubbles, chips, sources banner, video seek; no banner, no toast", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context);
  const c = newCounters();
  bodies.length = 0;
  await mockBackend(page, c, {
    search: () => ({
      status: 200,
      body: bundle([
        bundleItem(),
        bundleItem({
          chunk_id: "c2",
          kind: "lectures",
          page: null,
          text: "Krebs cycle walkthrough.",
          thumb_url: "https://cdn.test/l14.png",
          caption: "Krebs cycle",
          video: { url: "https://cdn.test/l14.mp4", start: 852, end: 900 },
        }),
      ]),
    }),
  });
  await openThread(page);
  await threadSend(page, "@textbook what is mitochondria");
  // Sources banner paints (opaque ancestor — the title div itself is
  // transparent by vendor construction).
  const banner = page.getByText("Answered from your course material");
  await expect(banner).toBeVisible({ timeout: 30000 });
  const paintedBg = await banner.evaluate((el) => {
    let node: HTMLElement | null = el as HTMLElement;
    while (node && node !== document.body) {
      const bg = getComputedStyle(node).backgroundColor;
      if (bg && !/^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/.test(bg) && bg !== "transparent") return bg;
      node = node.parentElement;
    }
    return null;
  });
  expect(paintedBg, "sources banner must paint an opaque background").not.toBeNull();
  // Info banners announce politely (alert is reserved for the outage bar).
  expect(await banner.evaluate((el) => el.closest('[role="status"]') != null)).toBe(true);
  await expect(page.getByText("The mitochondria is the powerhouse", { exact: false })).toBeVisible();
  await expect(page.getByText("View full page")).toHaveCount(2);
  const seek = page.getByRole("link", { name: "Open at 14:12" });
  await expect(seek).toBeVisible();
  expect(await seek.getAttribute("href")).toBe("https://cdn.test/l14.mp4#t=852");
  // Segment text surfaces as the vendor hover tooltip (role=tooltip),
  // not a title attribute.
  await seek.hover();
  await expect(page.getByRole("tooltip", { name: "Krebs cycle walkthrough." })).toBeVisible({ timeout: 15000 });
  // Question shaping at the seam: tokens stripped, scope mapped.
  await expect.poll(() => bodies.length, { timeout: 15000 }).toBeGreaterThanOrEqual(1);
  const sent = bodies[0] as { query: string; scope: string[] };
  expect(sent.query).toBe("what is mitochondria");
  expect(sent.scope).toEqual(["textbook"]);
  // No other surface: no outage bar, no expiry toast.
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await page.getByText(EXPIRY_COPY).count()).toBe(0);
  await expectCleanEnv(errors, true);
});

// ---- N2 --------------------------------------------------------------------
// The skeleton bar is gone: the tool-call row IS the loading signal. These
// pin the three states the vendor renders from `status` alone — spinner
// while in flight, green tick with the real duration on success, red x on
// failure — and that no skeleton is left behind.

/** The turn's tool-call group (the collapsed header is role=button). */
const toolGroup = (page: Page) => page.locator(".astryx-chat-tool-calls").last();

/**
 * The `search` row's status icon, read off the PAINT, not presence.
 * ChatToolCalls puts the semantic status colour on the icon span (the
 * inner circle paints currentColor at 15%), so that colour is the proof
 * a state actually rendered.
 */
async function searchRowPaint(page: Page) {
  return page.evaluate(() => {
    const groups = Array.from(document.querySelectorAll(".astryx-chat-tool-calls"));
    const group = groups[groups.length - 1];
    if (group == null) return { missing: true as const };
    // Match on text only (computed styles are StyleX-hashed and brittle),
    // then take the DEEPEST match so we get the row, not a wrapper.
    const hits = Array.from(group.querySelectorAll("div")).filter((el) =>
      (el.textContent ?? "").replace(/\s+/g, " ").trim().startsWith("search"),
    );
    const row = hits.find((el) => !hits.some((other) => other !== el && el.contains(other)));
    if (row == null)
      return {
        missing: true as const,
        groupText: (group.textContent ?? "").replace(/\s+/g, " ").trim(),
      };
    const icon = row.firstElementChild as HTMLElement | null;
    const circle = icon?.firstElementChild as HTMLElement | null;
    return {
      missing: false as const,
      text: (row.textContent ?? "").replace(/\s+/g, " ").trim(),
      iconColor: icon == null ? null : getComputedStyle(icon).color,
      circleBg: circle == null ? null : getComputedStyle(circle).backgroundColor,
      // Astryx Spinner renders role="status" aria-label="Loading"; a glyph
      // (check/close) has neither.
      isSpinner: row.querySelector('[role="status"]') != null,
    };
  });
}

const ERROR_TOKEN = "rgb(255, 198, 193)"; // --color-error, dark scheme

test("N2 — slow search spins the tool-call row, then the tick lands", async ({ page, context }) => {
  const errors = await collectErrors(page);
  await addSession(context);
  const c = newCounters();
  await mockBackend(page, c, {
    // 2500 ms slow-embed fixture (the delay is the mock's, not a test
    // sleep): the spinner must be up well inside the window.
    search: async () => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      return { status: 200, body: bundle([bundleItem()]) };
    },
  });
  await openThread(page);
  await threadSend(page, "what is mitochondria");

  // The group opens itself while searching, so the spinner is readable in
  // context rather than hidden behind a collapsed summary.
  const group = page.getByRole("button", { name: /tool calls/i });
  await expect(group).toBeVisible({ timeout: 15000 });
  await expect(group).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("status", { name: "Loading" }).first()).toBeVisible({ timeout: 15000 });

  // The skeleton bar is definitively gone (it used to appear here, under a
  // chip that had already ticked "searched").
  await expect(page.locator(".astryx-skeleton")).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Searching course material" })).toHaveCount(0);

  await expect(page.getByText("Answered from your course material")).toBeVisible({ timeout: 30000 });
  // Settled: the spinner is gone and the record carries a REAL duration.
  await expect(page.getByRole("status", { name: "Loading" })).toHaveCount(0);
  await expect(toolGroup(page)).toContainText(/\d+ms/);
  await expectCleanEnv(errors, true);
});

test("N2b — the row never ticks before the search ran", async ({ page, context }) => {
  const errors = await collectErrors(page);
  await addSession(context);
  const c = newCounters();
  await mockBackend(page, c, {
    search: async () => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      return { status: 200, body: bundle([bundleItem()]) };
    },
  });
  await openThread(page);
  await threadSend(page, "what is mitochondria");
  // While in flight the search row must be the spinner with no duration:
  // the old chip showed a green tick with a number seeded off the question
  // length, before any request had been made.
  await expect(page.getByRole("status", { name: "Loading" }).first()).toBeVisible({ timeout: 15000 });
  const inFlight = await searchRowPaint(page);
  expect(inFlight.missing, "search row is present while in flight").toBe(false);
  expect(inFlight.isSpinner, "in-flight row shows the spinner").toBe(true);
  expect(inFlight.text, "in-flight row reports no duration").not.toMatch(/\d+ms/);
  await expectCleanEnv(errors, true);
});

// ---- N3 --------------------------------------------------------------------

test("N3 — 200 empty renders the message plus pills; never a banner", async ({ page, context }) => {
  const errors = await collectErrors(page);
  await addSession(context);
  const c = newCounters();
  await mockBackend(page, c, { search: () => ({ status: 200, body: bundle([]) }) });
  await openThread(page);
  await threadSend(page, "question with no coverage anywhere");
  await expect(page.getByText("Nothing in your course material covers this yet.")).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("button", { name: "Try rephrasing" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Search a different source" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Quiz me on what we've covered" })).toBeVisible();
  await expect(page.getByText("Answered from your course material")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expectCleanEnv(errors, true);
});

// ---- N4 --------------------------------------------------------------------

test("N4 — 422 shows composer copy; never the bar (toast lands in T7)", async ({ page, context }) => {
  const errors = await collectErrors(page);
  await addSession(context);
  const c = newCounters();
  await mockBackend(page, c, {
    search: () => ({ status: 422, body: errBody("VALIDATION_ERROR", "Query too short — ask in a few more words.") }),
  });
  await openThread(page);
  await threadSend(page, "hi");
  // The copy lands twice on purpose: on the failed tool-call row (as the
  // vendor's visually-hidden error text) and in the composer status. Scope
  // to the composer so this stays a test of the composer surface.
  await expect(
    page.getByRole("status").filter({ hasText: "Query too short — ask in a few more words." }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("Query too short — ask in a few more words.")).toHaveCount(2);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("Answered from your course material")).toHaveCount(0);
  // T7 adds the one error toast beside this inline copy.
  await expectCleanEnv(errors, true);
});

// ---- N5 --------------------------------------------------------------------

test("N5 — 429 is composer status plus Retry only; never the bar (one-toast-max lands in T7)", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context);
  const c = newCounters();
  await mockBackend(page, c, {
    search: () => ({ status: 429, body: errBody("RATE_LIMITED", "Slow down a little") }),
  });
  await openThread(page);
  await threadSend(page, "what is mitochondria");
  // Row + composer, as in N4 (see there for why the copy appears twice).
  await expect(
    page.getByRole("status").filter({ hasText: "Slow down a little" }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("Slow down a little")).toHaveCount(2);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("Search is temporarily unavailable")).toHaveCount(0);
  await expectCleanEnv(errors, true);
});

test("N5b — a failed search leaves a red cross on the row, never a tick", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context);
  const c = newCounters();
  await mockBackend(page, c, {
    // Slow enough that the turn is still streaming when it fails, so the
    // live row is the surface the user was watching.
    search: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return { status: 502, body: errBody("EMBED_UNREACHABLE", "Search is down for maintenance") };
    },
  });
  await openThread(page);
  await threadSend(page, "what is mitochondria");
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("status", { name: "Loading" })).toHaveCount(0);

  const failed = await searchRowPaint(page);
  if (failed.missing) {
    // The turn settled before the failure landed, so the live row is gone;
    // the bar + composer copy + Retry pill own the surface instead.
    expect(failed.groupText ?? "").not.toMatch(/search[^.]*\d+ms/);
  } else {
    // Glyph (no spinner) painted in the error token, with the failure copy
    // as real text — not a duration.
    expect(failed.isSpinner, "failed row must not spin forever").toBe(false);
    expect(failed.iconColor, "failed row paints the error token").toBe(ERROR_TOKEN);
    expect(failed.text, "failed row reports no duration").not.toMatch(/\d+ms/);
  }
  await expectCleanEnv(errors, true);
});

// ---- N6 --------------------------------------------------------------------

test("N6 — 502 mounts the bar plus composer status; Retry replays without duplicating", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context);
  const c = newCounters();
  await mockBackend(page, c, {
    search: (n) =>
      n === 1
        ? { status: 502, body: errBody("EMBED_UNREACHABLE", "Search is down for maintenance") }
        : { status: 200, body: bundle([bundleItem()]) },
  });
  await openThread(page);
  await threadSend(page, "what is mitochondria");
  const bar = page.getByRole("alert");
  await expect(bar.getByText("Search is temporarily unavailable")).toBeVisible({ timeout: 30000 });
  await expect(bar.getByText("Search is down for maintenance")).toBeVisible();
  // Composer status carries the same copy; the bar never steals focus.
  await expect(page.getByText("Search is down for maintenance").nth(1)).toBeVisible();
  const inBar = await page.evaluate(() => (document.activeElement?.closest('[role="alert"]') ?? null) !== null);
  expect(inBar, "bar mount must not steal focus").toBe(false);
  await expect(page.getByRole("article", { name: "Message from user" })).toHaveCount(1);
  // Bar Retry replays the search (attempt 2); the bar stands down, the
  // user message is still exactly one.
  await bar.getByRole("button", { name: "Retry" }).click();
  await expect.poll(() => c.search, { timeout: 15000 }).toBe(2);
  await expect(page.getByText("Answered from your course material")).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("article", { name: "Message from user" })).toHaveCount(1);
  await expectCleanEnv(errors, true);
});

// ---- N7 --------------------------------------------------------------------

test("N7 — dismissal matrix: different code re-shows, same code stays quiet, 1 h re-shows", async ({
  page,
  context,
}) => {
  test.setTimeout(180000);
  const errors = await collectErrors(page);
  await addSession(context);
  const c = newCounters();
  // Mutable leg: phases flip the failure under the same router.
  const mode: { current: "502" | "503-misconfigured" | "503-mismatch" | "ok" } = { current: "502" };
  await mockBackend(page, c, {
    search: () => {
      switch (mode.current) {
        case "503-misconfigured":
          return { status: 503, body: errBody("EMBED_MISCONFIGURED", "Search backend lost its credentials") };
        case "503-mismatch":
          return { status: 503, body: errBody("EMBED_SPACE_MISMATCH", "Search index was rebuilt") };
        case "ok":
          return { status: 200, body: bundle([bundleItem()]) };
        default:
          return { status: 502, body: errBody("EMBED_UNREACHABLE", "Search is down for maintenance") };
      }
    },
  });
  await openThread(page);
  const bar = page.getByRole("alert");

  // Phase 1 — 502 error bar, then dismiss.
  await threadSend(page, "what is mitochondria");
  await expect(bar.getByText("Search is temporarily unavailable")).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Dismiss search outage notice" }).click();
  await expect(bar).toHaveCount(0);

  // Phase 2 — the same code inside the quiet window stays hidden
  // (composer status still shows — dismissing the bar never clears it).
  await searchRetry(page);
  await expect(page.getByText("Search is down for maintenance").first()).toBeVisible({ timeout: 30000 });
  await expect(bar).toHaveCount(0);

  // Phase 3 — the 1 h quiet window elapses (time-travel the stored
  // dismissal, the clock-stub without freezing the turn timers) and the
  // same code re-shows on the next failure.
  await page.evaluate(() => {
    window.localStorage.setItem(
      "pesdac:retrieval-banner",
      JSON.stringify({ code: "EMBED_UNREACHABLE", dismissedAt: Date.now() - 3600000 - 1000 }),
    );
  });
  await searchRetry(page);
  await expect(bar.getByText("Search is temporarily unavailable")).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Dismiss search outage notice" }).click();
  await expect(bar).toHaveCount(0);

  // Phase 4 — a different code (space mismatch) re-shows immediately;
  // copy stays student-safe (never the word "curator").
  mode.current = "503-mismatch";
  await searchRetry(page);
  await expect.poll(() => c.search, { timeout: 15000 }).toBeGreaterThanOrEqual(4);
  const mismatchBar = page.getByRole("alert");
  await expect(mismatchBar.getByText("Search index needs a refresh. Let your instructor know.")).toBeVisible({
    timeout: 30000,
  });
  expect(await mismatchBar.getByText(/curator/i).count()).toBe(0);
  await page.getByRole("button", { name: "Dismiss search outage notice" }).click();
  await expect(bar).toHaveCount(0);

  // Phase 5 — another code (misconfigured, first-seen warning) re-shows
  // with its own title and the envelope description.
  mode.current = "503-misconfigured";
  await searchRetry(page);
  await expect(bar.getByText("Search isn't available right now")).toBeVisible({ timeout: 30000 });
  await expect(bar.getByText("Search backend lost its credentials")).toBeVisible();

  // Phase 6 — resolving clears both: success unmounts the bar and the
  // composer warning together.
  mode.current = "ok";
  await bar.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Answered from your course material")).toBeVisible({ timeout: 30000 });
  await expect(bar).toHaveCount(0);
  expect(await page.getByText("Search is down for maintenance").count()).toBe(0);
  await expectCleanEnv(errors, true);
});

// ---- N8 --------------------------------------------------------------------

test("N8 — 401 on search joins the global re-login flow; no retrieval surface", async ({ page, context }) => {
  const errors = await collectErrors(page);
  await addSession(context);
  const c = newCounters();
  // Mirror E6: the identity flips to 401 once the send fires, so /login
  // does not bounce back on the still-valid seed session.
  await mockBackend(page, c, {
    meFlipping: true,
    messagesPostStatus: undefined,
    search: () => ({ status: 401, body: errBody("AUTH_REQUIRED", "sign in") }),
  });
  await openThread(page);
  await threadSend(page, "are you still there");
  await expect(page.getByText(EXPIRY_COPY).first()).toBeVisible({ timeout: 15000 });
  await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
  // Retrieval adds nothing on top of the global flow.
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("Answered from your course material")).toHaveCount(0);
  // The 401 handler navigates mid-transition by design; Astro can log
  // "Transition was skipped" (same environmental class as section-a E6).
  await expectCleanEnv(errors, ["Transition was skipped"]);
});

// ---- N9 --------------------------------------------------------------------

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("N9 — reduced motion still mounts the bar and completes the turn", async ({ page, context }) => {
    const errors = await collectErrors(page);
    await addSession(context);
    const c = newCounters();
    await mockBackend(page, c, {
      search: (n) =>
        n === 1
          ? { status: 502, body: errBody("EMBED_UNREACHABLE", "Search is down for maintenance") }
          : { status: 200, body: bundle([bundleItem()]) },
    });
    await openThread(page);
    await threadSend(page, "what is mitochondria");
    // Mounted-or-not: no entrance-animation dependency.
    const bar = page.getByRole("alert");
    await expect(bar.getByText("Search is temporarily unavailable")).toBeVisible({ timeout: 30000 });
    await bar.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByText("Answered from your course material")).toBeVisible({ timeout: 30000 });
    await expectCleanEnv(errors, true);
  });
});
