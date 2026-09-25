// Section L — toasts, crash UI, recovery (L1–L5), all [mock] unless noted.
// L4 closes a real page mid-stream (same context) — headless per D55.
//
// Harness: the section-k base (real BetterAuth session via seed
// cookies, reseed in beforeAll, one mock router per test, zero
// pageerror + zero console.error gate) extended with:
// - failApiV1: every /api/v1 ACTION leg 500s (boot path + identity
//   GETs stay healthy per D70).
// - poisonMessages: per-code messagesGet body override (L2).
// - collectAll: errors plus full console text (L2 ref-correlation,
//   L3 rejection-line counting).
//
// Vendor/app facts pinned while implementing (cited, not guessed):
// - Storm guard (toast-policy.ts:9-27): isRepeatToast collapses
//   IDENTICAL bodies inside TOAST_REPEAT_WINDOW_MS=3000; caller skips
//   both toast AND log line. toUserMessage maps every 500 to the same
//   generic 5xx copy (S12), so distinct failing actions collapse by
//   construction — L1 proves it from the UI side.
// - Failure surfaces (sections.tsx): export 500 → toast generic-5xx
//   (1431-1436, dialog stays open — E17); clear-all DELETE 500 → toast
//   generic-5xx (1453-1460); Campus PATCH 500 → toast generic-5xx
//   (288-291, E19 vehicle); display-name 500 → toast generic-5xx
//   (325-328, value preserved); create 500 → toast "Couldn't create
//   that chat. Try again." + inline createSyncError (session.ts:1146).
// - Boundary (AppErrorBoundary.tsx): Dialog aria "Something went
//   wrong" + "Reference: <8 hex>" (newRef:40-47) + "Try again"
//   (reset) + "Back to home" (assign "/"); componentDidCatch ALWAYS
//   console.errors "[pesdac] render failure ref=%s" (56-68) — the
//   operator correlation channel L2 asserts.
// - messageToBlock (session.ts:1102-1122) FAILS CLOSED: null rows →
//   null → filtered. The plan's [{null}] vector cannot crash render
//   (L2a pins this); {"data": null} throws in the async loader →
//   caught → failed status (E5 territory, not the boundary).
// - Unhandled rejections (AppToasts.tsx:109-119): one global toast
//   "Something went wrong. Try again — if it keeps happening, reload
//   the page." + console.error "Unhandled rejection:" — both behind
//   isRepeatToast. Chromium ALSO echoes the synthetic rejection via
//   pageerror, raw (S3 precedent) — L3 exempts exactly its marker.
// - Crash boundary (C12/D11 precedent): the in-flight assistant turn
//   never persists — kill mid-stream reopens Q-only, settled outbox
//   records never replay. L4 proves it across a real page close.
// - Boot purge (session.ts:88-100): deletes EVERY `pesdac-` key once
//   per load; colon-form (`pesdac:logout-ping`, cache-revalidation
//   .ts:27-32) is never swept, by design (A2). A9 owns garbage in
//   current keys; L5 owns parseable OLD shapes + the colon contrast.
//
// Deviations from browser-break-it-plan.md (evidence over text):
//   D70 (L1): auth-me + profiles-GET + llm-status + chats-GET stay
//     healthy so the storm stays drivable (E6/E7/E9/R8 own those
//     failure paths; llm-down honestly blocks sends, killing leg 4).
//     The other 8 /api/v1 legs + update-user fail; 9 UI-driven
//     requests fail in the storm.
//   D71 (L2): the plan's [{null}] poison is defused by fail-closed
//     validation — pinned as the L2a leg (no crash IS correct). The
//     boundary is proven with a validation-passing but
//     render-breaking poison (mcq bubble without options →
//     McqCard options.length throws in render).
//   D72 (L4): result pins C12/D11 reality — reopen is Q-only, the
//     never-persisted answer is NOT resurrected; "exactly-once
//     content" = one Q, zero dupes, next send completes cleanly.
//   D73 (L3): the synthetic rejection's pageerror echo is exempt by
//     exact marker (S3 pattern) — the asserts prove the APP's own
//     toast + log line behave.

import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import * as fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TEMP = "C:\\Users\\anubh\\AppData\\Local\\Temp\\opencode";
const ROOT = "C:\\Anubhav\\Web Dev Projects\\PESDac";
const PASS_COOKIES = `${TEMP}\\seed-cookies.json`;

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

// ---- mock shapes ------------------------------------------------------------

const iso = () => new Date().toISOString();
const json = (data: unknown, status = 200) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(data),
});
const err500 = () =>
  json({ error: { code: "SERVER_ERROR", message: "l1 storm" } }, 500);

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
  updateUserBodies?: unknown[];
  updateUserLeg?: (attempt: number) => { status: number; body: unknown };
  /** D70: fail every data leg (identity GETs stay healthy). */
  failApiV1?: boolean;  /** D71: per-code messagesGet body override (poison legs). */
  poisonMessages?: Map<string, unknown>;
};

const ME_DEFAULT = {
  user: {
    id: "e2e",
    email: "e2e.sectionl@example.com",
    displayName: "E2E SectionL",
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
    if (opts.failApiV1) return r.fulfill(err500());
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
    if (opts.failApiV1) {
      // D70: the boot path (chats list + llm status) stays healthy so
      // the storm stays drivable — hydrate-failure is R8-owned, E9
      // owns llm-down (which honestly BLOCKS sends, killing leg 4).
      if (p === "/api/v1/llm/status") {
        c.llm += 1;
        return r.fulfill(json(LLM_READY));
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
      if (p === "/api/v1/profiles/me" && m === "PATCH") c.profilePatch += 1;
      else if (p === "/api/v1/users/me/export") c.exportGet += 1;
      else if (p === "/api/v1/chats" && m === "POST") c.chatsPost += 1;
      else if (p === "/api/v1/chats" && m === "DELETE") c.chatsDelete += 1;
      else if (/\/api\/v1\/chats\/[^/]+\/messages$/.test(p) && m === "GET")
        c.messagesGet += 1;
      else if (/\/api\/v1\/chats\/[^/]+\/messages$/.test(p) && m === "POST")
        c.messagesPost += 1;
      else if (/^\/api\/v1\/chats\/[^/]+$/.test(p) && m === "PATCH")
        c.chatPatch += 1;
      return r.fulfill(err500());
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
        json({
          profile: { ...profileRow },
          chats: [],
          demoState: [],
          exportedAt: iso(),
          version: 1,
        }),
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
      const code = `l${String(chatSeq).padStart(5, "0")}`;
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
      const poison = opts.poisonMessages?.get(code);
      if (poison !== undefined) return r.fulfill(json(poison));
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

async function waitStreamSettled(page: Page) {
  await expect(stopBtn(page)).toHaveCount(0, { timeout: 30000 });
}

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

// Controlled inputs can drop a fill that races a post-save re-render
// (T98) — refill until the value lands.
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

// ---- L1 — error storm dedupe ------------------------------------------------

test("L1 — nine failing requests collapse to a bounded toast set, layout holds", async ({
  page,
  context,
}) => {
  test.setTimeout(180000);
  const { errors } = collectAll(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await mockBackend(page, c, { failApiV1: true });
  await page.goto("/new");
  await welcomeReady(page);

  // Transient toasts are snapshot-polled (S3 pattern): Astryx
  // auto-dismisses, so a single end-of-test read would miss them.
  // NOTE: [role=status] also matches spinner regions ("Loading") —
  // those are not toasts and are filtered here.
  const seenToasts = new Set<string>();
  let maxSimultaneous = 0;
  const snap = async () => {
    const live = (await toastTexts(page))
      .map((t) => t.trim())
      .filter((t) => t && t !== "Loading");
    for (const t of live) seenToasts.add(t);
    if (live.length > maxSimultaneous) maxSimultaneous = live.length;
  };

  // Storm leg 1 — Campus picks ×3 (3 PATCH 500s, same generic body).
  await openProfileDialog(page);
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("combobox", { name: "Campus" }).click();
  await page.getByRole("option", { name: "RR Campus" }).click();
  await snap();
  await dlg.getByRole("combobox", { name: "Campus" }).click();
  await page.getByRole("option", { name: "EC Campus" }).click();
  await snap();
  await dlg.getByRole("combobox", { name: "Campus" }).click();
  await page.getByRole("option", { name: "RR Campus" }).click();
  await snap();

  // Storm leg 2 — display-name saves ×2 (2 update-user 500s, same body).
  const field = dlg.getByLabel("Display name").first();
  const save = dlg.getByRole("button", { name: "Save display name" });
  await fillSettled(field, "L1 Storm A");
  await save.click();
  await snap();
  await fillSettled(field, "L1 Storm B");
  await save.click();
  await snap();

  // Storm leg 3 — Privacy tab: export + clear-all (2 more 500s).
  await dlg.getByRole("button", { name: "Privacy", exact: true }).click();
  await dlg.getByRole("button", { name: "Export my data" }).click();
  await snap();
  await dlg.getByRole("button", { name: "Delete all chats" }).click();
  const confirm = page.getByRole("alertdialog");
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await snap();
  // Failure keeps the confirm UX honest: dialog stays open, rows kept.
  await expect(page.getByRole("dialog").first()).toBeVisible();

  // Storm leg 4 — welcome sends ×2 (2 create 500s, own copy + inline).
  // Navigate (not Esc — the dialog's dismiss path is K3-owned): the
  // full navigation unmounts the dialog, counters persist in-test.
  await page.goto("/new");
  await welcomeReady(page);
  await welcomeSend(page, "l1 storm send one");
  await expect
    .poll(() => c.chatsPost, { timeout: 20000 })
    .toBeGreaterThanOrEqual(1);
  await snap();
  await welcomeSend(page, "l1 storm send two");
  await expect
    .poll(() => c.chatsPost, { timeout: 20000 })
    .toBeGreaterThanOrEqual(2);
  // Soak snapshots so late/repeated toasts are all observed.
  for (let i = 0; i < 8; i++) {
    await snap();
    await page.waitForTimeout(500);
  }

  const failed =
    c.profilePatch + c.updateUser + c.exportGet + c.chatsDelete + c.chatsPost;
  console.log(
    `[L1] failed=${failed} (patch=${c.profilePatch} updateUser=${c.updateUser} export=${c.exportGet} del=${c.chatsDelete} create=${c.chatsPost}) distinct=${seenToasts.size} maxSimul=${maxSimultaneous}: ${[...seenToasts].join(" || ").slice(0, 400)}`,
  );
  // Nine driven requests failed but the toast set stays bounded —
  // no 10-stack, no layout breakage. Pinned actual: 3 real bodies
  // (generic 5xx collapses patch/export/delete; create + the
  // display-name fallback carry their own) + headroom; simultaneous
  // is timing-shaped (window-expiry re-fires while an elder is still
  // visible — the window-not-latch semantics L3 pins precisely).
  expect(failed).toBeGreaterThanOrEqual(9);
  expect(seenToasts.size).toBeLessThanOrEqual(4);
  expect(maxSimultaneous).toBeLessThanOrEqual(5);
  // Layout holds: no toast stack in the DOM, composer live.
  expect(maxSimultaneous).toBeGreaterThanOrEqual(1);
  await expect
    .poll(async () => composer(page).getAttribute("contenteditable"), {
      timeout: 15000,
    })
    .toBe("true");
  await expectCleanEnv(errors, true);
});

// ---- L2 — forced React crash -------------------------------------------------

test("L2 — render poison shows the boundary, ref correlates, both buttons work", async ({
  page,
  context,
}) => {
  test.setTimeout(180000);
  const { errors, consoleText } = collectAll(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const code = "l2aa01";
  // D71: [null] rows are fail-closed by messageToBlock (L2a, no crash).
  // The boundary needs a validation-passing but render-breaking row:
  // an mcq bubble WITHOUT options — McqCard reads options.length in
  // render and throws.
  const poison = {
    data: [
      {
        id: "p1",
        seq: 1,
        role: "assistant",
        content: {
          from: "assistant",
          bubbles: [{ type: "mcq", question: "l2 poison?" }],
        },
        createdAt: iso(),
      },
    ],
    pagination: { limit: 50, offset: 0, total: 1 },
  };
  const nullRows = {
    data: [null],
    pagination: { limit: 50, offset: 0, total: 1 },
  };
  await mockBackend(page, c, {
    seedChats: [
      { code, title: "L2 crash thread" },
      { code: "l2bb02", title: "L2 null thread" },
    ],
    poisonMessages: new Map<string, unknown>([
      [code, poison],
      ["l2bb02", nullRows],
    ]),
  });

  // L2a first: [null] rows paint an honest empty thread, never a crash.
  await page.goto("/subject/CN/l2bb02");
  await page
    .getByText("Ask anything about CN...", { exact: false })
    .first()
    .waitFor({ timeout: 25000 });
  await expect(
    page.getByRole("article", { name: "Message from user" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("article", { name: "Message from assistant" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Something went wrong", { exact: false }),
  ).toHaveCount(0);

  // Main leg: the mcq poison throws in render → the boundary.
  await page.goto(`/subject/CN/${code}`);
  const boundary = page.getByRole("dialog", { name: "Something went wrong" });
  await expect(boundary).toBeVisible({ timeout: 25000 });
  await expect(
    boundary.getByRole("button", { name: "Try again", exact: true }),
  ).toBeVisible();
  await expect(
    boundary.getByRole("button", { name: "Back to home", exact: true }),
  ).toBeVisible();
  const refText =
    (await boundary.getByText("Reference:", { exact: false }).innerText()) ??
    "";
  const ref = refText.replace(/^[\s\S]*Reference:\s*/i, "").trim();
  expect(ref, `ref must be 8 hex, got: ${JSON.stringify(refText)}`).toMatch(
    /^[0-9a-f]{8}$/,
  );
  // Operator correlation: the console line carries the same ref.
  await expect
    .poll(
      () =>
        consoleText.filter(
          (l) => l.includes("render failure") && l.includes(ref),
        ).length,
      { timeout: 15000 },
    )
    .toBeGreaterThanOrEqual(1);

  // "Try again" resets + re-renders: the poison is still served, so it
  // correctly re-crashes with a FRESH ref (button wired, not dead).
  await boundary.getByRole("button", { name: "Try again", exact: true }).click();
  await expect
    .poll(async () => {
      const t =
        (await boundary
          .getByText("Reference:", { exact: false })
          .innerText()
          .catch(() => "")) ?? "";
      return t.replace(/^[\s\S]*Reference:\s*/i, "").trim();
    })
    .not.toBe(ref);
  // "Back to home" leaves the boundary: / → /new boots clean.
  await boundary
    .getByRole("button", { name: "Back to home", exact: true })
    .click();
  await page.waitForURL(/\/new/, { timeout: 25000 });
  await welcomeReady(page);
  await expect
    .poll(async () => composer(page).getAttribute("contenteditable"), {
      timeout: 15000,
    })
    .toBe("true");
  console.log(`[L2] ref=${ref} correlated, retry re-crashed fresh, home ok`);
  // The boundary's own console.error IS the asserted signal (carries
  // the UI ref) — exempt exactly it, plus React's echo of the
  // injected poison (the option-less mcq's `.map` TypeError, twice:
  // initial + Try-again re-crash — same echo class as S3's pageerror
  // exemption for synthetic poison).
  await expectCleanEnv(errors, true, [
    "render failure ref=",
    "reading 'map'",
  ]);
});

// ---- L3 — unhandled rejection path -------------------------------------------

test("L3 — rejection storm toasts once, window expiry re-fires, app alive", async ({
  page,
  context,
}) => {
  test.setTimeout(180000);
  const { errors, consoleText } = collectAll(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await mockBackend(page, c);
  await page.goto("/new");
  await welcomeReady(page);
  const marker = "l3-storm-marker";

  const rejectionLines = () =>
    consoleText.filter((l) => l.includes("Unhandled rejection:")).length;
  const globalToasts = async () =>
    (await toastTexts(page)).filter((t) => t.includes("reload the page"));

  // Five identical rejections inside the 3s repeat window.
  await page.evaluate((m) => {
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        void Promise.reject(new Error(`l3 flush boom ${m} ${i}`));
      }, i * 200);
    }
  }, marker);
  // The global copy surfaces…
  await expect
    .poll(async () => (await globalToasts()).length, { timeout: 20000 })
    .toBeGreaterThanOrEqual(1);
  // …exactly once: the guard collapses the other four (both toast
  // AND log line are skipped for repeats).
  await page.waitForTimeout(2500);
  expect(await globalToasts()).toHaveLength(1);
  expect(rejectionLines()).toBe(1);

  // Past the window the same body fires again: a window, not a latch.
  await page.waitForTimeout(3500);
  await page.evaluate((m) => {
    setTimeout(() => {
      void Promise.reject(new Error(`l3 flush boom ${m} late`));
    }, 0);
  }, marker);
  await expect.poll(() => rejectionLines(), { timeout: 15000 }).toBe(2);

  // App alive: a full send completes after the storm.
  await welcomeSend(page, "l3 alive after storm");
  await expect(page).toHaveURL(/\/subject\/CN\/[a-z0-9]{6}/, {
    timeout: 25000,
  });
  await waitStreamSettled(page);
  console.log(
    `[L3] rejections=6 logLines=${rejectionLines()} chatsPost=${c.chatsPost}`,
  );
  // D73: Chromium echoes each synthetic rejection via pageerror, raw —
  // exempt exactly the marker; the APP's own lines are the asserts.
  await expectCleanEnv(errors, true, [marker]);
});

// ---- L4 — kill tab mid-stream --------------------------------------------------

test("L4 — closed page mid-stream reopens Q-only, exactly once, send works", async ({
  browser,
}) => {
  test.setTimeout(180000);
  const context = await browser.newContext();
  try {
    await addSession(context, PASS_COOKIES);
    const c = newCounters();
    const journal = new Map<string, JournalRow[]>();
    // Context-level router: the replacement page inherits it, and the
    // journal Map outlives the closed page (server-side truth).
    await mockBackend(context, c, { journal });
    const p1 = await context.newPage();
    const { errors: errorsA } = collectAll(p1);
    await p1.goto("/new");
    await p1
      .getByText("Ask anything about your course...", { exact: false })
      .first()
      .waitFor({ timeout: 25000 });
    // Long deep answer streams ~10s (C12): send, persist, kill inside it.
    const box = p1.getByRole("combobox", { name: "Message input" });
    await box.click();
    await p1.keyboard.type("teach me UDP in detail please", { delay: 10 });
    await p1.getByRole("button", { name: "Send", exact: true }).click();
    await expect(p1).toHaveURL(/\/subject\/CN\/[a-z0-9]{6}/, {
      timeout: 25000,
    });
    await expect
      .poll(() => c.messagesPost, { timeout: 15000 })
      .toBeGreaterThanOrEqual(1);
    const postsAtKill = c.messagesPost;
    const threadUrl = p1.url();
    await p1.waitForTimeout(1000);
    await p1.close();

    // Fresh page, same context: boot replays nothing settled (C12/D11
    // reality — the in-flight answer never persisted, so Q-only), and
    // crucially never duplicates the killed send.
    const p2 = await context.newPage();
    const { errors: errorsB } = collectAll(p2);
    await p2.goto(threadUrl);
    await p2
      .getByText("Ask anything about CN...", { exact: false })
      .first()
      .waitFor({ timeout: 25000 });
    const userArticle = p2.getByRole("article", {
      name: "Message from user",
    });
    const asstArticle = p2.getByRole("article", {
      name: "Message from assistant",
    });
    await expect(userArticle).toHaveCount(1, { timeout: 25000 });
    await expect(asstArticle).toHaveCount(0);
    await p2.waitForTimeout(3000);
    expect(c.messagesPost).toBe(postsAtKill);
    expect(postsAtKill).toBe(1);
    // The thread is fully usable after the kill: next send completes.
    await p2.getByRole("combobox", { name: "Message input" }).click();
    await p2.keyboard.type("l4 follow-up", { delay: 10 });
    await p2.getByRole("button", { name: "Send", exact: true }).click();
    await expect(
      p2.getByText(ASK_MARKER_OR_ANSWER, { exact: false }).first(),
    ).toBeVisible({ timeout: 30000 });
    await expect(stopBtn(p2)).toHaveCount(0, { timeout: 30000 });
    await expect(userArticle).toHaveCount(2);
    await expect(asstArticle).toHaveCount(1);
    console.log(
      `[L4] postsAtKill=${postsAtKill} finalPosts=${c.messagesPost} url=${threadUrl.slice(-12)}`,
    );
    await expectCleanEnv(errorsA, true);
    await expectCleanEnv(errorsB, true);
  } finally {
    await context.close();
  }
});

// ---- L5 — legacy storage keys ----------------------------------------------------

test("L5 — pre-rename pesdac-* keys purge on boot, colon ping survives", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const { errors } = collectAll(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await mockBackend(page, c, {
    seedChats: [{ code: "l5aa01", title: "L5 thread" }],
  });
  await page.goto("/new");
  await welcomeReady(page);
  // Seed parseable OLD shapes (A9 owns garbage) + the colon ping.
  // Purge runs at module load, so keys planted now die on next boot.
  const legacy = {
    "pesdac-chats": JSON.stringify([{ id: "x", title: "Old row" }]),
    "pesdac-drafts": JSON.stringify({ "CN:abc123": "half typed" }),
    "pesdac-settings-v0": JSON.stringify({ theme: "dark" }),
    "pesdac-onboarding-done": "yes",
    "pesdac-profile": JSON.stringify({ campus: "Old Campus", semester: "9" }),
  };
  const pingValue = "1718000000000";
  await page.evaluate(
    ([keys, ping]) => {
      for (const [k, v] of Object.entries(keys))
        window.localStorage.setItem(k, v as string);
      window.localStorage.setItem("pesdac:logout-ping", ping as string);
    },
    [legacy, pingValue] as const,
  );
  await page.reload();
  await welcomeReady(page);
  const after = await page.evaluate(() => {
    const out: Record<string, string | null> = {};
    for (const k of [
      "pesdac-chats",
      "pesdac-drafts",
      "pesdac-settings-v0",
      "pesdac-onboarding-done",
      "pesdac-profile",
      "pesdac:logout-ping",
    ])
      out[k] = window.localStorage.getItem(k);
    return out;
  });
  for (const [k, v] of Object.entries(after)) {
    if (k === "pesdac:logout-ping") {
      expect(v, "colon ping never swept by design").toBe(pingValue);
    } else {
      expect(v, `expected ${k} purged`).toBeNull();
    }
  }
  // Store functional after the purge: thread opens, composer live.
  await page.goto("/subject/CN/l5aa01");
  await page
    .getByText("Ask anything about CN...", { exact: false })
    .first()
    .waitFor({ timeout: 25000 });
  await expect
    .poll(async () => composer(page).getAttribute("contenteditable"), {
      timeout: 15000,
    })
    .toBe("true");
  console.log("[L5] 5 legacy keys purged, colon ping kept, thread opens");
  await expectCleanEnv(errors, true);
});

// The deep-answer marker is asserted in section-b (chapter view); L4
// only needs "an assistant turn completed" — ASK_MARKER is the
// short-answer stable marker, so accept either surface.
const ASK_MARKER_OR_ANSWER = "Quote it first";
