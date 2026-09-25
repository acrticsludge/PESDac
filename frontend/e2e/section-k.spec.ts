// Section K — data integrity (D1–D12), all [mock] unless noted.
// D4/D5 are done-by-reference (C26 draft-loss pin, R10 rename/pin/
// archive reload-proof) — no new tests; the plan slash points at the
// existing proofs. This file holds D1, D2, D3, D6, D7, D8, D9, D10,
// D11, D12.
//
// Harness: the section-j lean base (real BetterAuth session via seed
// cookies, reseed in beforeAll, one mock router per test, zero
// pageerror + zero console.error gate) extended with a journal-backed
// messages mock (section-b shape: POST appends, DELETE truncates by
// from_seq), meta-applying chatPatch, clearing chatsDelete, and an
// exportGet leg. D6 also drives the REAL preview BetterAuth (logout +
// form login — needs BETTER_AUTH_TRUSTED_ORIGINS=:4323 per O26);
// /api/v1 stays mocked throughout.
//
// Vendor/app facts pinned while implementing (cited, not guessed):
// - Real export shape (backend/app/routers/users.py:42-63): {profile,
//   chats, demoState, exportedAt, version: 1}; chat rows are containers
//   (code/subject/title/flags/preview/msgCount/lastSeq —
//   chats.py:140-150), capped at EXPORT_MAX_ROWS=200.
// - Clear-all (sections.tsx:1447-...): server DELETE /chats FIRST, local
//   wipe only on success; confirm copy "This cannot be undone."
//   (sections.tsx:1558); success toast "All chats deleted." (R8).
// - Truncate (chat-sync.ts:177-185): DELETE messages?from_seq=N;
//   edit = truncate-from-index (ThreadView.tsx:1221-1231).
// - updateDisplayName (auth.ts:581-610): trims client-side; empty →
//   "Enter a display name."; >80 → "Display name must be at most 80
//   characters."; 401 → AuthRequiredError + exactly-once global signal
//   (display-name.test.ts:202-233), the dialog swallows it silently
//   (sections.tsx:324).
// - Greeting (Pesdac.tsx:853-862): firstName = displayName up to the
//   first space; "What are you studying today, {firstName}?"
// - Pinned-count snapshot (Pesdac.tsx:1122-1169): write-if-changed
//   "pesdac:lastKnownPinnedCount" on every live list (zero clears it);
//   skeletons cap at 3 rows.
// - Quiz overrides are MEMORY-only (sections.tsx:665-672 comment):
//   setScopeOverride writes a module Map, no server call — reload
//   resets them by v1 design. No per-chat UI writer exists anywhere
//   (only subject scope). D11 pins this reality (D67).
// - Outbox IDB (outbox-db.ts): DB "pesdac-outbox", store "ops",
//   keyPath "id"; list() drops malformed rows (isValidOutboxOp);
//   payloads are POSTed back, never rendered.
// - Search/composer/row-menu/profile selectors follow sections B/D/F:
//   combobox "Message input", Send exact, "Edit message" buttons,
//   rowMenu hover → "Conversation options" → menuitem, Privacy tab →
//   "Export my data" / "Delete all chats", ASK_MARKER "Quote it first".
//
// Deviations from browser-break-it-plan.md (evidence over text):
//   D67 (D11): no per-chat override UI exists and scope overrides are
//     memory-only by documented v1 design — reload CANNOT preserve
//     them. The test proves the in-session resolver order instead
//     (OS override vs CN default isolation) and pins the reload reset.
//   D68 (D3): from_seq is recorded + bounded (≥2) rather than pinned
//     exact — the keep-index arithmetic is internal; the UI clauses
//     (earlier intact / later gone / edited streams / next send works)
//     carry the correctness proof.
//   D69 (D6): same-context cookie wipe instead of a second browser
//     context — routes + profileRow persist in-test, which is exactly
//     the reseed fidelity under test (server state, not local).

import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import * as fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TEMP = "C:\\Users\\anubh\\AppData\\Local\\Temp\\opencode";
const ROOT = "C:\\Anubhav\\Web Dev Projects\\PESDac";
const PASS_COOKIES = `${TEMP}\\seed-cookies.json`;
const SEED_EMAIL = "e2e.sectiona@example.com";
const SEED_PASSWORD = "E2e-SectionA-9x7q!Test";
const ASK_MARKER = "Quote it first";
const EXPIRY_COPY = "Your session expired. Please log in again.";
const PIN_SNAPSHOT_KEY = "pesdac:lastKnownPinnedCount";

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

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  return errors;
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

// ---- mock shapes ------------------------------------------------------------

const iso = () => new Date().toISOString();
const json = (data: unknown, status = 200) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(data),
});

type ChatMeta = {
  code: string;
  title: string;
  subject: string;
  isPinned: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
};

type JournalRow = {
  id: string;
  seq: number;
  role: string;
  content: unknown;
  createdAt: string;
};

type Counters = {
  me: number;
  profileGet: number;
  profilePatch: number;
  llm: number;
  chatsGet: number;
  chatsPost: number;
  chatPatch: number;
  chatsDelete: number;
  messagesGet: number;
  messagesPost: number;
  messagesDelete: number;
  exportGet: number;
  token: number;
  updateUser: number;
};
const newCounters = (): Counters => ({
  me: 0,
  profileGet: 0,
  profilePatch: 0,
  llm: 0,
  chatsGet: 0,
  chatsPost: 0,
  chatPatch: 0,
  chatsDelete: 0,
  messagesGet: 0,
  messagesPost: 0,
  messagesDelete: 0,
  exportGet: 0,
  token: 0,
  updateUser: 0,
});

export type MockOpts = {
  meRow?: Record<string, unknown>;
  profileRow?: Record<string, unknown>;
  seedChats?: Array<{ code: string; title: string; subject?: string }>;
  journal?: Map<string, JournalRow[]>;
  meta?: Map<string, ChatMeta>;
  patchBodies?: unknown[];
  chatBodies?: unknown[];
  chatPatchBodies?: Array<{ code: string; body: unknown }>;
  truncateQueries?: string[];
  updateUserBodies?: unknown[];
  exportBody?: unknown;
  updateUserLeg?: (attempt: number) => { status: number; body: unknown };
};

const ME_DEFAULT = {
  user: {
    id: "e2e",
    email: "e2e.sectionk@example.com",
    displayName: "E2E SectionK",
    onboardingDone: true,
  },
};
const PROFILE_DEFAULT = {
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

async function mockBackend(
  target: Page | BrowserContext,
  c: Counters,
  opts: MockOpts = {},
) {
  const journal = opts.journal ?? new Map<string, JournalRow[]>();
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
  const meRow = opts.meRow ?? { ...ME_DEFAULT };
  const profileRow = opts.profileRow ?? { ...PROFILE_DEFAULT };
  let chatSeq = 0;
  const msgSeq = new Map<string, number>();
  for (const [code, rows] of journal)
    msgSeq.set(code, rows.reduce((m, r) => Math.max(m, r.seq), 0));
  await target.unrouteAll({ behavior: "wait" });
  await target.route("**/api/auth/sign-out*", (r) =>
    r.fulfill(json({}, 200)),
  );
  await target.route("**/api/auth/update-user*", async (r) => {
    c.updateUser += 1;
    try {
      opts.updateUserBodies?.push(r.request().postDataJSON());
    } catch {
      opts.updateUserBodies?.push(null);
    }
    const out = opts.updateUserLeg
      ? opts.updateUserLeg(c.updateUser)
      : { status: 200, body: { status: true } };
    return r.fulfill(json(out.body, out.status));
  });
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
      return r.fulfill(json(meRow));
    }
    if (p === "/api/v1/profiles/me" && m === "GET") {
      c.profileGet += 1;
      return r.fulfill(json(profileRow));
    }
    if (p === "/api/v1/profiles/me" && m === "PATCH") {
      c.profilePatch += 1;
      try {
        const posted = req.postDataJSON() as Record<string, unknown>;
        opts.patchBodies?.push(posted);
        Object.assign(profileRow, posted);
      } catch {
        opts.patchBodies?.push(null);
      }
      return r.fulfill(json(profileRow));
    }
    if (p === "/api/v1/llm/status") {
      c.llm += 1;
      return r.fulfill(json(LLM_READY));
    }
    if (p === "/api/v1/users/me/export" && m === "GET") {
      c.exportGet += 1;
      return r.fulfill(
        json(
          opts.exportBody ?? {
            profile: { ...profileRow },
            chats: [],
            demoState: [],
            exportedAt: iso(),
            version: 1,
          },
        ),
      );
    }
    if (p === "/api/v1/chats" && m === "GET") {
      c.chatsGet += 1;
      const rows = [...meta.values()].filter((row) =>
        u.searchParams.get("archived") === "true"
          ? row.isArchived
          : !row.isArchived,
      );
      return r.fulfill(
        json({
          data: rows.map((x) => ({ ...x })),
          pagination: { limit: 50, offset: 0, total: rows.length },
        }),
      );
    }
    if (p === "/api/v1/chats" && m === "POST") {
      c.chatsPost += 1;
      chatSeq += 1;
      const posted = req.postDataJSON() as { subject: string; title: string };
      opts.chatBodies?.push(posted);
      const code = `k${String(chatSeq).padStart(5, "0")}`;
      meta.set(code, {
        code,
        title: posted.title,
        subject: posted.subject,
        isPinned: false,
        isArchived: false,
        createdAt: iso(),
        updatedAt: iso(),
      });
      return r.fulfill(json({ ...meta.get(code)! }, 201));
    }
    const chatMatch = p.match(/^\/api\/v1\/chats\/([^/]+)$/);
    if (chatMatch && m === "PATCH") {
      c.chatPatch += 1;
      const code = decodeURIComponent(chatMatch[1]);
      const body = req.postDataJSON() as Record<string, unknown>;
      opts.chatPatchBodies?.push({ code, body });
      const row = meta.get(code);
      if (row) Object.assign(row, body);
      return r.fulfill(json(row ? { ...row } : { code }));
    }
    if (p === "/api/v1/chats" && m === "DELETE") {
      c.chatsDelete += 1;
      const n = meta.size;
      meta.clear();
      journal.clear();
      return r.fulfill(
        json({
          data: { deleted: n },
          pagination: { limit: 50, offset: 0, total: n },
        }),
      );
    }
    const msgMatch = p.match(/^\/api\/v1\/chats\/([^/]+)\/messages$/);
    if (msgMatch && m === "GET") {
      c.messagesGet += 1;
      const code = decodeURIComponent(msgMatch[1]);
      const rows = journal.get(code) ?? [];
      return r.fulfill(
        json({
          data: rows,
          pagination: { limit: 50, offset: 0, total: rows.length },
        }),
      );
    }
    if (msgMatch && m === "POST") {
      c.messagesPost += 1;
      const code = decodeURIComponent(msgMatch[1]);
      const posted = req.postDataJSON() as {
        role: string;
        content: unknown;
        clientMsgKey?: string;
      };
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
      return r.fulfill(json(row, 201));
    }
    if (msgMatch && m === "DELETE") {
      c.messagesDelete += 1;
      const code = decodeURIComponent(msgMatch[1]);
      opts.truncateQueries?.push(u.search);
      const fromSeq = Number(u.searchParams.get("from_seq") ?? "0");
      const kept = (journal.get(code) ?? []).filter(
        (row) => row.seq < fromSeq,
      );
      const deleted = (journal.get(code) ?? []).length - kept.length;
      journal.set(code, kept);
      return r.fulfill(
        json({
          data: { deleted },
          pagination: { limit: 50, offset: 0, total: kept.length },
        }),
      );
    }
    return r.fulfill(json({ error: { code: "NOT_FOUND", message: "x" } }, 404));
  });
  return { journal, meta };
}

// ---- shared UI helpers ------------------------------------------------------

const sidebar = (page: Page) => page.locator("nav, aside").first();
const composer = (page: Page) =>
  page.getByRole("combobox", { name: "Message input" });
const stopBtn = (page: Page) =>
  page.getByRole("button", { name: "Stop", exact: true });

async function welcomeReady(page: Page) {
  await page
    .getByText("Ask anything about your course...", { exact: false })
    .first()
    .waitFor({ timeout: 25000 });
}

async function welcomeSend(page: Page, text: string) {
  const box = composer(page);
  await box.click();
  await page.keyboard.type(text, { delay: 10 });
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

async function threadSend(page: Page, text: string) {
  await composer(page).click();
  await page.keyboard.type(text, { delay: 10 });
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

async function waitStreamSettled(page: Page) {
  await expect(stopBtn(page)).toHaveCount(0, { timeout: 30000 });
}

async function openProfileDialog(page: Page) {
  await sidebar(page).getByRole("link", { name: "My Profile" }).click();
  await expect(page.getByRole("dialog").first()).toBeVisible({
    timeout: 15000,
  });
}

async function rowMenu(page: Page, title: string, item: string) {
  await sidebar(page).getByRole("link", { name: title }).hover();
  await page
    .getByRole("button", { name: "Conversation options" })
    .first()
    .click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}

async function realLogin(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByPlaceholder("name@college.com").fill(email);
  await page.getByPlaceholder("Enter your password").fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL(/\/new/, { timeout: 25000 });
}

function textBlock(from: string, text: string) {
  return { from, bubbles: [{ type: "text", text }] };
}

// Controlled inputs can drop a fill that races a post-save re-render
// (the value reverts, Save stays disabled — bitten in D7 leg 3).
// Refill until the value lands, and settle on the saved value after
// each save before the next fill.
async function fillSettled(
  field: import("@playwright/test").Locator,
  value: string,
) {
  for (let i = 0; i < 3; i++) {
    await field.fill(value);
    if ((await field.inputValue()) === value) return;
  }
  throw new Error(
    `fill never settled for ${JSON.stringify(value).slice(0, 40)}`,
  );
}

// ---- D1 — export round-trip -------------------------------------------------

test("D1 — export downloads complete, schema-valid, own data only", async ({
  page,
  context,
}) => {
  const errors = collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const stamp = iso();
  const servedBody = {
    profile: { ...PROFILE_DEFAULT, onboardingDone: true },
    chats: [
      {
        code: "d1aa01",
        subject: "CN",
        title: "D1 first thread",
        isPinned: false,
        isArchived: false,
        createdAt: stamp,
        updatedAt: stamp,
        preview: "d1 q",
        msgCount: 2,
        lastSeq: 1,
      },
      {
        code: "d1bb02",
        subject: "OS",
        title: "D1 second thread",
        isPinned: true,
        isArchived: false,
        createdAt: stamp,
        updatedAt: stamp,
        preview: "d1 a",
        msgCount: 4,
        lastSeq: 3,
      },
    ],
    demoState: [],
    exportedAt: stamp,
    version: 1,
  };
  await mockBackend(page, c, {
    seedChats: [
      { code: "d1aa01", title: "D1 first thread", subject: "CN" },
      { code: "d1bb02", title: "D1 second thread", subject: "OS" },
    ],
    exportBody: servedBody,
  });
  await page.goto("/new");
  await welcomeReady(page);
  // Server+UI agree before export: both seeded rows render.
  await expect(
    sidebar(page).getByRole("link", { name: "D1 first thread" }),
  ).toBeVisible({ timeout: 15000 });
  await openProfileDialog(page);
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("button", { name: "Privacy", exact: true }).click();
  const dlPromise = page.waitForEvent("download", { timeout: 15000 });
  await dlg.getByRole("button", { name: "Export my data" }).click();
  const dl = await dlPromise;
  expect(dl.suggestedFilename()).toBe("pesdac-data.json");
  await expect(
    page.getByText("Your data export is ready.", { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  expect(c.exportGet).toBe(1);
  const path = await dl.path();
  const file = JSON.parse(fs.readFileSync(path!, "utf8"));
  console.log(
    `[D1] downloaded chats=${file.chats.length} version=${file.version}`,
  );
  // Byte-fidelity: the file IS the served body (complete, actually saved).
  expect(file).toEqual(servedBody);
  // Schema spot-checks: version, timestamp, own profile, full chat rows.
  expect(file.version).toBe(1);
  expect(typeof file.exportedAt).toBe("string");
  expect(file.profile.onboardingDone).toBe(true);
  expect(file.chats.map((ch: { code: string }) => ch.code)).toEqual([
    "d1aa01",
    "d1bb02",
  ]);
  for (const ch of file.chats) {
    for (const k of [
      "code",
      "subject",
      "title",
      "isPinned",
      "isArchived",
      "preview",
      "msgCount",
      "lastSeq",
    ])
      expect(ch, `chat row missing ${k}`).toHaveProperty(k);
  }
  await expect(page.getByRole("dialog").first()).toBeVisible();
  await expectCleanEnv(errors);
});

// ---- D2 — clear-all honesty -------------------------------------------------

test("D2 — clear-all states irreversibility, empties server+UI, next send works", async ({
  page,
  context,
}) => {
  const errors = collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await mockBackend(page, c, {
    seedChats: [
      { code: "d2aa01", title: "D2 keep-one" },
      { code: "d2bb02", title: "D2 keep-two" },
    ],
  });
  await page.goto("/subject/CN/d2aa01");
  await expect(
    page.getByRole("article", { name: "Message from user" }),
  ).toHaveCount(0, { timeout: 20000 });
  await openProfileDialog(page);
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("button", { name: "Privacy", exact: true }).click();
  await dlg.getByRole("button", { name: "Delete all chats" }).click();
  const confirm = page.getByRole("alertdialog");
  // Irreversibility is stated (no undo exists — pin the copy).
  await expect(
    confirm.getByText("Delete all chats?", { exact: false }),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    confirm.getByText("This cannot be undone.", { exact: false }),
  ).toBeVisible({ timeout: 15000 });
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    page.getByText("All chats deleted.", { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  expect(c.chatsDelete).toBe(1);
  // Dead-link bounce (R8) + UI empty: both rows gone.
  await expect(page).toHaveURL(/\/new/, { timeout: 15000 });
  await welcomeReady(page);
  await expect(
    sidebar(page).getByRole("link", { name: "D2 keep-one" }),
  ).toHaveCount(0);
  await expect(
    sidebar(page).getByRole("link", { name: "D2 keep-two" }),
  ).toHaveCount(0);
  // Server empty too: after reload the cleared mock serves zero rows.
  await page.reload();
  await welcomeReady(page);
  await expect(
    sidebar(page).locator("a", { hasText: "D2 keep" }),
  ).toHaveCount(0);
  console.log(`[D2] chatsDelete=${c.chatsDelete} chatsGet=${c.chatsGet}`);
  // Next send works (fresh create proves the app isn't wedged).
  await page.keyboard.press("Escape");
  await welcomeSend(page, "fresh after clear");
  await expect(page).toHaveURL(/\/subject\/CN\/[a-z0-9]{6}/, {
    timeout: 15000,
  });
  console.log(`[D2] chatsDelete=${c.chatsDelete} chatsPost=${c.chatsPost}`);
  // "Transition was skipped" allowed: the clear-all bounce → Escape →
  // send sequence interrupts an Astro view transition (known-benign,
  // same family as the 401/logout allowance in the plan gate).
  await expectCleanEnv(errors, true, ["Transition was skipped"]);
});

// ---- D3 — truncate from_seq -------------------------------------------------

test("D3 — editing an earlier turn truncates later ones, thread streams on", async ({
  page,
  context,
}) => {
  const errors = collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const journal = new Map<string, JournalRow[]>();
  const code = "d3tr01";
  const t = (seq: number, role: string, text: string): JournalRow => ({
    id: `d3m${seq}`,
    seq,
    role,
    content: textBlock(role, text),
    createdAt: iso(),
  });
  journal.set(code, [
    t(1, "user", "d3 turn one alpha"),
    t(2, "assistant", "d3 answer one"),
    t(3, "user", "d3 turn two beta"),
    t(4, "assistant", "d3 answer two"),
    t(5, "user", "d3 turn three gamma"),
    t(6, "assistant", "d3 answer three"),
  ]);
  const truncateQueries: string[] = [];
  await mockBackend(page, c, {
    seedChats: [{ code, title: "D3 truncate thread" }],
    journal,
    truncateQueries,
  });
  await page.goto(`/subject/CN/${code}`);
  const userArticle = page.getByRole("article", { name: "Message from user" });
  await expect(userArticle).toHaveCount(3, { timeout: 20000 });
  // Edit turn TWO: earlier intact, edited replaces, later truncated.
  await page.getByRole("button", { name: "Edit message" }).nth(1).click();
  await expect(
    page.getByText("Editing message", { exact: false }).first(),
  ).toBeVisible({ timeout: 10000 });
  await composer(page).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("d3 turn two EDITED", { delay: 10 });
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(ASK_MARKER, { exact: false }).first()).toBeVisible({
    timeout: 30000,
  });
  await waitStreamSettled(page);
  expect(c.messagesDelete).toBe(1);
  console.log(`[D3] truncate query=${truncateQueries[0]}`);
  const fromSeq = Number(
    new URL(`http://x/${truncateQueries[0]}`).searchParams.get("from_seq") ??
      "0",
  );
  // Truncation happened at/after turn two (D68: exact keep-index is
  // internal — the UI clauses below prove correctness).
  expect(fromSeq).toBeGreaterThanOrEqual(2);
  const bodyText = await page.locator("body").innerText();
  expect(bodyText).toContain("d3 turn one alpha");
  expect(bodyText).toContain("d3 turn two EDITED");
  expect(bodyText).not.toContain("d3 turn three gamma");
  expect(bodyText).not.toContain("d3 answer three");
  await expect(userArticle).toHaveCount(2);
  // Thread streams fine after the truncate: one more full turn.
  await threadSend(page, "d3 after edit");
  await expect(
    page.getByText(ASK_MARKER, { exact: false }).last(),
  ).toBeVisible({ timeout: 30000 });
  await waitStreamSettled(page);
  await expect(userArticle).toHaveCount(3);
  await expectCleanEnv(errors, true);
});

// ---- D6 — profile seed round-trip -------------------------------------------

test("D6 — profile values reseed from server across logout+login", async ({
  page,
  context,
}) => {
  const errors = collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const patchBodies: unknown[] = [];
  const meRow: Record<string, unknown> = {
    user: {
      id: "e2e",
      email: "e2e.sectionk@example.com",
      displayName: "E2E SectionK",
      onboardingDone: false,
    },
  };
  const profileRow: Record<string, unknown> = {
    institution: "",
    semester: "",
    branch: "",
    subjects: [],
    campus: "",
    onboardingDone: false,
  };
  await mockBackend(page, c, { meRow, profileRow, patchBodies });
  await page.goto("/new");
  const dialog = page.getByRole("alertdialog", {
    name: "Set up your profile",
  });
  await expect(dialog).toBeVisible({ timeout: 25000 });
  await dialog.getByRole("radio", { name: "RR Campus" }).check();
  await dialog.getByRole("combobox", { name: "Semester" }).click();
  await page.getByRole("option", { name: "Semester 3" }).click();
  await dialog.getByRole("combobox", { name: "Branch" }).click();
  await page.getByRole("option", { name: "CSE (Core)" }).click();
  await dialog.getByRole("checkbox", { name: "Select all" }).check();
  await dialog.getByRole("button", { name: "Start studying" }).click();
  await expect(dialog).toBeHidden({ timeout: 15000 });
  expect(c.profilePatch).toBe(1);
  const saved = patchBodies[0] as Record<string, unknown>;
  expect(saved).toMatchObject({
    campus: "RR",
    semester: "3",
    branch: "CSE(Core)",
    onboardingDone: true,
  });
  // From now on the "server" knows the profile (and onboarding done).
  (meRow.user as Record<string, unknown>).onboardingDone = true;
  // Logout through the UI, back in through the REAL form (O26 env).
  // The actor tab navigates to /login on logout (A2: heap wipe +
  // /login; the in-place gate dialog is the SIBLING-tab contract).
  await sidebar(page).getByRole("link", { name: "Logout" }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 25000 });
  await realLogin(page, SEED_EMAIL, SEED_PASSWORD);
  await welcomeReady(page);
  // Onboarding stays done: no setup dialog, values reseeded.
  await expect(
    page.getByRole("alertdialog", { name: "Set up your profile" }),
  ).toHaveCount(0);
  await openProfileDialog(page);
  const dlg = page.getByRole("dialog");
  await expect(
    dlg.getByRole("combobox", { name: "Campus" }),
  ).toContainText("RR Campus", { timeout: 15000 });
  expect((profileRow.subjects as unknown[]).length).toBeGreaterThan(0);
  console.log(
    `[D6] reseeded campus=${profileRow.campus} semester=${profileRow.semester} branch=${profileRow.branch}`,
  );
  await expectCleanEnv(errors);
});

// ---- D7 — display-name boundaries -------------------------------------------

test("D7 — display-name trims, caps at 80, rejects empty, greets first-token", async ({
  page,
  context,
}) => {
  const errors = collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const updateUserBodies: unknown[] = [];
  await mockBackend(page, c, { updateUserBodies });
  await page.goto("/new");
  await welcomeReady(page);
  // {name}-only template: greeting interpolates the FIRST token.
  await expect(
    page.getByText("What are you studying today, E2E?", { exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await openProfileDialog(page);
  const dlg = page.getByRole("dialog");
  const field = dlg.getByLabel("Display name").first();
  const save = dlg.getByRole("button", { name: "Save display name" });

  // Trimmed client-side: the wire carries "spaced", never the padding.
  await fillSettled(field, "  spaced  ");
  await save.click();
  await expect(
    page.getByText("Display name saved.", { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  await expect(field).toHaveValue("spaced", { timeout: 10000 });
  expect(updateUserBodies).toHaveLength(1);
  expect(updateUserBodies[0]).toMatchObject({ name: "spaced" });

  // 80 chars ok…
  await fillSettled(field, "n".repeat(80));
  await save.click();
  await expect(
    page.getByText("Display name saved.", { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  await expect(field).toHaveValue("n".repeat(80), { timeout: 10000 });
  expect(updateUserBodies).toHaveLength(2);

  // …81st rejected with copy, zero new requests…
  await fillSettled(field, "x".repeat(81));
  await save.click();
  await expect(
    page
      .getByText("Display name must be at most 80 characters.", {
        exact: false,
      })
      .first(),
  ).toBeVisible({ timeout: 15000 });
  expect(updateUserBodies).toHaveLength(2);

  // …empty rejected with copy, zero new requests. (The copy renders
  // twice — field status + assertive live region, the R8 strict-dupe
  // pattern — so first().)
  await fillSettled(field, "   ");
  await save.click();
  await expect(
    page.getByText("Enter a display name.", { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  expect(updateUserBodies).toHaveLength(2);
  console.log(`[D7] updateUser calls=${c.updateUser} (2 sends, 2 local rejects)`);
  await expect(page.getByRole("dialog").first()).toBeVisible();
  await expectCleanEnv(errors);
});

// ---- D8 — display-name 401 path ---------------------------------------------

test("D8 — display-name 401 rides the silent global re-auth, never a form error", async ({
  page,
  context,
}) => {
  const errors = collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await mockBackend(page, c, {
    updateUserLeg: () => ({
      status: 401,
      body: { code: "UNAUTHORIZED", message: "Session expired." },
    }),
  });
  await page.goto("/new");
  await welcomeReady(page);
  await openProfileDialog(page);
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Display name").first().fill("D8 Name");
  await dlg.getByRole("button", { name: "Save display name" }).click();
  // Global flow, not a form error: the expiry copy surfaces…
  await expect(
    page.getByText(EXPIRY_COPY, { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  // …and no name-error UI ever appears (unit truth: AuthRequiredError
  // is swallowed by the dialog, exactly-once signal).
  await expect(
    page.getByText("Couldn't save your name", { exact: false }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Enter a display name.", { exact: false }),
  ).toHaveCount(0);
  expect(c.updateUser).toBe(1);
  await page.waitForTimeout(3000);
  expect(c.updateUser).toBe(1);
  console.log(`[D8] updateUser calls=${c.updateUser}, dialogOpen=${await dlg.count()}`);
  // The global re-auth signal drives a navigation transition; if a
  // second transition interrupts it Astro logs the benign skip (same
  // family as D2's allowance).
  await expectCleanEnv(errors, false, ["Transition was skipped"]);
});

// ---- D9 — export with zero chats --------------------------------------------

test("D9 — export with zero chats is a valid empty file, not a 500", async ({
  page,
  context,
}) => {
  const errors = collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const stamp = iso();
  await mockBackend(page, c, {
    exportBody: {
      profile: { ...PROFILE_DEFAULT, onboardingDone: true },
      chats: [],
      demoState: [],
      exportedAt: stamp,
      version: 1,
    },
  });
  await page.goto("/new");
  await welcomeReady(page);
  await openProfileDialog(page);
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("button", { name: "Privacy", exact: true }).click();
  const dlPromise = page.waitForEvent("download", { timeout: 15000 });
  await dlg.getByRole("button", { name: "Export my data" }).click();
  const dl = await dlPromise;
  expect(dl.suggestedFilename()).toBe("pesdac-data.json");
  const path = await dl.path();
  const file = JSON.parse(fs.readFileSync(path!, "utf8"));
  console.log(`[D9] empty export version=${file.version} chats=${file.chats.length}`);
  expect(file.version).toBe(1);
  expect(typeof file.exportedAt).toBe("string");
  expect(file.chats).toEqual([]);
  expect(file.profile.onboardingDone).toBe(true);
  await expect(
    page.getByText("Your data export is ready.", { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("dialog").first()).toBeVisible();
  await expectCleanEnv(errors);
});

// ---- D10 — pin count snapshot -----------------------------------------------

test("D10 — pinned count snapshot holds 3 across reload, matches server", async ({
  page,
  context,
}) => {
  const errors = collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const titles = ["D10 pin one", "D10 pin two", "D10 pin three"];
  await mockBackend(page, c, {
    seedChats: [
      { code: "d10a01", title: titles[0] },
      { code: "d10b02", title: titles[1] },
      { code: "d10c03", title: titles[2] },
    ],
  });
  await page.goto("/new");
  await welcomeReady(page);
  for (const t of titles) {
    await expect(
      sidebar(page).getByRole("link", { name: t }),
    ).toBeVisible({ timeout: 15000 });
  }
  for (const t of titles) await rowMenu(page, t, "Pin");
  expect(c.chatPatch).toBe(3);
  // Snapshot writes on render after the PATCHes resolve — poll, never
  // instant-read (same discipline as the reload half below).
  let pinnedWrites: string | null = null;
  await expect
    .poll(
      async () => {
        pinnedWrites = await page.evaluate(
          (key) => window.localStorage.getItem(key),
          PIN_SNAPSHOT_KEY,
        );
        return pinnedWrites;
      },
      { timeout: 15000 },
    )
    .toBe("3");
  console.log(`[D10] snapshot after pins=${pinnedWrites}`);
  // Reload: skeleton first, then the server list revalidates (60s
  // coalesce per cache-revalidation — poll, never assert instant).
  await page.reload();
  await welcomeReady(page);
  for (const t of titles) {
    await expect(
      sidebar(page).getByRole("link", { name: t }),
    ).toBeVisible({ timeout: 25000 });
  }
  expect(c.chatsGet).toBeGreaterThanOrEqual(2);
  const after = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    PIN_SNAPSHOT_KEY,
  );
  console.log(`[D10] snapshot after reload=${after} chatsGet=${c.chatsGet}`);
  expect(after).toBe("3");
  // Hydra #418 (text) allowed: the reloaded sidebar hydrates the pinned
  // rows like thread turns (same benign SSR pattern as S6/D2).
  await expectCleanEnv(errors, true);
});

// ---- D11 — per-subject override isolation -----------------------------------

test("D11 — subject override isolates per subject, reload resets (memory-only by design)", async ({
  page,
  context,
}) => {
  const errors = collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await mockBackend(page, c);
  await page.goto("/new");
  await welcomeReady(page);
  await openProfileDialog(page);
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("button", { name: "Study", exact: true }).click();
  // The quiz Subject selector is gated on customEnabled for the
  // CURRENT subject (sections.tsx:857) — and so is the switch value.
  // Each scope needs its own toggle: enable for CN first (unlocks the
  // selector), pick OS, enable again (now scoped to OS).
  const customSwitch = dlg.getByRole("switch", {
    name: "Custom quiz format",
  });
  await customSwitch.click();
  const subjectSel = dlg.getByRole("combobox", { name: "Subject" }).nth(1);
  await expect(subjectSel).toBeEnabled({ timeout: 10000 });
  await subjectSel.click();
  // Selector options carry full labels (profile-options SUBJECTS).
  await page.getByRole("option", { name: "Operating Systems" }).click();
  await customSwitch.click();
  // Resolver order, same session: OS takes the overrides…
  // (SegmentedControl = radiogroup semantics per vendor source.)
  // Markers are scope-filtered to the selected subject: with OS
  // selected exactly OS-switch + OS-format show (the CN-switch marker
  // from click #1 hides — first isolation signal).
  await dlg.getByRole("radio", { name: "Multi" }).click();
  await expect(
    dlg.getByRole("button", { name: "Use default", exact: true }),
  ).toHaveCount(2, { timeout: 10000 });
  // …CN keeps its own state (switch marker only) and the DEFAULT
  // format — OS overrides never leak across the resolver boundary…
  await subjectSel.click();
  await page.getByRole("option", { name: "Computer Networks" }).click();
  await expect(
    dlg.getByRole("button", { name: "Use default", exact: true }),
  ).toHaveCount(1);
  await expect(dlg.getByRole("radio", { name: "Single" })).toBeChecked();
  console.log(`[D11] isolation holds: OS overridden, CN default`);
  // …and reload resets the memory-only kernel (D67, v1 design — the
  // switch is off and no marker shows for OS anymore).
  await page.reload();
  await welcomeReady(page);
  await openProfileDialog(page);
  const dlg2 = page.getByRole("dialog");
  await dlg2.getByRole("button", { name: "Study", exact: true }).click();
  await expect(
    dlg2.getByRole("button", { name: "Use default", exact: true }),
  ).toHaveCount(0);
  await expectCleanEnv(errors);
});

// ---- D12 — corrupt IndexedDB outbox row -------------------------------------

test("D12 — corrupt outbox row is dropped, app boots, valid ops flush", async ({
  page,
  context,
}) => {
  const errors = collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const chatBodies: unknown[] = [];
  await mockBackend(page, c, { chatBodies });
  await page.goto("/new");
  await welcomeReady(page);
  // Plant an untrusted-shape row DIRECTLY (bypasses put() validation —
  // the app never writes such rows itself; list() must drop it). The
  // store may not exist yet (lazy open) — create it like the app does.
  await page.evaluate(async () => {
    const openReq = indexedDB.open("pesdac-outbox", 1);
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      openReq.onupgradeneeded = () => {
        if (!openReq.result.objectStoreNames.contains("ops")) {
          openReq.result.createObjectStore("ops", { keyPath: "id" });
        }
      };
      openReq.onsuccess = () => resolve(openReq.result);
      openReq.onerror = () => reject(openReq.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("ops", "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore("ops").put({ id: "evil-row", garbage: true });
    });
    db.close();
  });
  // One valid op via the real flow: offline send queues durably.
  await context.setOffline(true);
  await welcomeSend(page, "d12 valid op");
  await context.setOffline(false);
  // Let the reconnect flush + its navigation settle BEFORE reloading:
  // reloading mid-navigation detaches the frame (bitten in RUN8).
  await expect
    .poll(() => c.chatsPost, { timeout: 20000 })
    .toBeGreaterThanOrEqual(1);
  await expect(page).toHaveURL(/\/subject\/CN\/[a-z0-9]{6}/, {
    timeout: 15000,
  });
  // Reload with the corrupt row present: boot must succeed. The offline
  // welcome send optimistically entered a thread, so the shell to await
  // is the thread composer (not the welcome text).
  await page.reload();
  await expect(composer(page)).toBeVisible({ timeout: 25000 });
  // The valid op flushed through the real flush path (exactly-once).
  await expect
    .poll(() => c.chatsPost, { timeout: 20000 })
    .toBeGreaterThanOrEqual(1);
  expect(
    (chatBodies as Array<{ title: string }>).filter(
      (b) => b.title === "d12 valid op",
    ),
  ).toHaveLength(1);
  // The corrupt row is gone; only live state remains.
  const rows = await page.evaluate(async () => {
    const openReq = indexedDB.open("pesdac-outbox", 1);
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      openReq.onsuccess = () => resolve(openReq.result);
      openReq.onerror = () => reject(openReq.error);
    });
    const all: unknown[] = await new Promise((resolve, reject) => {
      const tx = db.transaction("ops", "readonly");
      const rq = tx.objectStore("ops").getAll();
      rq.onsuccess = () => resolve(rq.result as unknown[]);
      rq.onerror = () => reject(rq.error);
    });
    db.close();
    return all;
  });
  console.log(
    `[D12] chatsPost=${c.chatsPost} rowsAfter=${JSON.stringify(rows.map((r) => (r as { id: string }).id))}`,
  );
  // The corrupt row is filtered from reads (the flush above sent ONLY
  // the valid op while evil-row sat in the store) — and compacted from
  // disk on the next list() (B48 fixed).
  const ids = rows.map((r) => (r as { id: string }).id);
  // Empty store: the valid op flushed + was ack-removed, the invalid
  // row was compacted (B48) instead of lingering forever.
  expect(ids).toEqual([]);
  await expectCleanEnv(errors, true);
});
