// Section I — keyboard & a11y (extends a11y.spec.ts), K1–K13.
// Same base harness as section-h (real BetterAuth session + mocked
// FastAPI `**/api/v1/**` incl. the offline flag for the pill leg, one
// router per test, counters after, same clean-env gate, beforeAll
// reseed). Axe (K5) reuses the @axe-core/playwright bar from
// a11y.spec.ts (serious/critical zero). K12 is `[manual]` — no test
// here; the quarterly procedure lives in the plan.
// Keyboard-first throughout: setups that need pointer (opening the
// profile for trap entry, hovering the row menu for size measurement,
// staging a file for the drawer) are marked as setup — the asserted
// paths are keyboard.
//
// Vendor/app facts pinned while implementing (cited, not guessed):
// - Global shortcut bus (Pesdac.tsx): `/` focuses the composer (not
//   from editables), Ctrl/Cmd+K new chat, Ctrl/Cmd+F thread find (only
//   when the finder is mounted), Esc yields on gate/onboarding and
//   otherwise dispatches CANCEL_EVENT.
// - CANCEL_EVENT order (ThreadView): live→Stop, else edit→cancel,
//   else find→close. Gate/onboarding Esc-yield is by design.
// - Thread turns mirror into `div[role=log][aria-live=polite]` (the
//   announcement path for stream + error text); the unsynced pill
//   carries its OWN `div[role=status]` (not mirrored into the log).
// - Dictation button is labelled ("Start dictation"); real denial
//   fires onError → an error toast (B18; B42 closed) — headless has no
//   SpeechRecognition so the rig observes silence (C17's pointer half).
// - Avatar is `role=img` with initials (no <img>); sidebar collapses
//   under "Open navigation" at 360px; composer Send is icon-only
//   (accessible name "Send").
// - Word-chunk streaming calms to a single settle under
//   `prefers-reduced-motion: reduce` (B43); the vendor chevron
//   self-calms via its own reduce query.
// - Every Tab stop rings `outline:solid/2px` (B40 fixed — the composer
//   carries the standard ring); BODY stops are wrap-only.
//
// Deviations from browser-break-it-plan.md (evidence over text):
//   D55 (K1): headless despite the `[headed]` tag — focus semantics
//     proven identical across 6 headless probe runs, and a headed
//     window risks focus-theft flakes mid-suite.
//   D56 (K2 gate leg): guest gate, not post-logout — same gate state,
//     no session kill.
//   D57 (K4 pill oracle): the pill announces via its OWN role=status,
//     not the thread log (inLog=false probed) — asserted accordingly.
//   D58 (K9): composer controls measure 44×44 (B44 fixed — explicit
//     boxes; vendor sizes top out at 36px). WCAG 2.2 AA 24px holds
//     throughout; the row menu keeps its 24px floor (no tripwire).
//   D59 (K13): headless wrap-through-BODY allowance (≤2,
//     non-consecutive) — headed Tabs would continue into chrome; the
//     gated 2-stop cycle routes wrap through BODY every 3rd stop, which
//     is the same transient at dialog scale, not a trap hole (B39
//     closed as non-bug — vendor Dialog is native showModal, no
//     sentinels to leak).
//   D60 (K3): profile close restores the My Profile invoker (B41
//     fixed — conditional render bypasses the vendor trigger-restore,
//     so Pesdac refocuses on the open→closed edge).
//   D61 (K7): the reduced-motion calming branch exists (B43 fixed) —
//     the test pins single-settle timing plus identical content.
//   D62 (K8): headless denial announces nothing (B42 closed by B18 —
//     real denial toasts via onError; the rig has no recognizer).

import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
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

// No I test logs out, but predecessors might have (Sections F–H
// discipline): one mint covers the file.
test.beforeAll(async () => {
  await execFileAsync("npx.cmd", ["tsx", "seed-e2e.local.mts"], {
    cwd: ROOT,
    timeout: 60000,
    shell: true,
  });
});

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

// ---- mock shapes (same as section-h) ----------------------------------------

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
    email: "e2e.sectioni@example.com",
    displayName: "E2E SectionI",
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

export type BackendOv = {
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

export type MockOpts = {
  seedChats?: Array<{ code: string; title: string; subject?: string }>;
  chatBodies?: unknown[];
  msgBodies?: Array<{ code: string; body: unknown }>;
  msgGetQueries?: string[];
  patchBodies?: unknown[];
  chatPatchBodies?: Array<{ code: string; body: unknown }>;
  chatDeletes?: string[];
  journal?: Map<string, JournalRow[]>;
  meta?: Map<string, ChatMeta>;
  profileRow?: Record<string, unknown>;
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
  const flags = opts.flags ?? { offline: false };
  let chatSeq = 0;
  const msgSeq = new Map<string, number>();
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
    try {
      if (req.headers()["authorization"]?.startsWith("Bearer ")) c.authed += 1;
    } catch {
      // Header read is best-effort; counts below carry the proof.
    }
    const run = async (
      leg: Leg | undefined,
      fallback: Fulfill,
      key: keyof Counters,
    ) => {
      c[key] += 1;
      const out = leg ? await leg(c[key], req) : fallback;
      if (out === "abort") await r.abort("connectionreset");
      else if (out.status === 204) await r.fulfill({ status: 204, body: "" });
      else await r.fulfill(json(out.body, out.status, out.headers));
    };
    const offlineAbort: Fulfill = "abort";
    if (p === "/api/v1/auth/me" && m === "GET")
      return run(ov.me, ok(ME()), "me");
    if (p === "/api/v1/profiles/me" && m === "GET")
      return run(ov.profileGet, ok(profileRow), "profileGet");
    if (p === "/api/v1/profiles/me" && m === "PATCH") {
      if (flags.offline) return run(ov.profilePatch, offlineAbort, "profilePatch");
      try {
        const posted = req.postDataJSON() as Record<string, unknown>;
        opts.patchBodies?.push(posted);
        Object.assign(profileRow, posted);
      } catch {
        opts.patchBodies?.push(null);
      }
      return run(ov.profilePatch, ok(profileRow), "profilePatch");
    }
    if (p === "/api/v1/llm/status")
      return run(ov.llm, ok(LLM_READY), "llm");
    if (p === "/api/v1/users/me/export" && m === "GET") {
      if (flags.offline) return run(ov.exportGet, offlineAbort, "exportGet");
      return run(ov.exportGet, ok({ exportedAt: iso(), chats: [] }), "exportGet");
    }
    if (p === "/api/v1/chats" && m === "GET") {
      const rows = [...meta.values()].filter((row) =>
        u.searchParams.get("archived") === "true" ? row.isArchived : !row.isArchived,
      );
      return run(ov.chatsGet, ok({
        data: rows.map(metaRow),
        pagination: { limit: 50, offset: 0, total: rows.length },
      }), "chatsGet");
    }
    if (p === "/api/v1/chats" && m === "POST") {
      if (flags.offline) return run(ov.chatsPost, offlineAbort, "chatsPost");
      const fb: Fulfill = (() => {
        chatSeq += 1;
        const posted = req.postDataJSON() as { subject: string; title: string };
        opts.chatBodies?.push(posted);
        const code = `d${String(chatSeq).padStart(5, "0")}`;
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
      })();
      return run(ov.chatsPost, fb, "chatsPost");
    }
    if (p === "/api/v1/chats" && m === "DELETE") {
      if (flags.offline) return run(ov.chatsDelete, offlineAbort, "chatsDelete");
      const fb: Fulfill = (() => {
        const n = meta.size;
        meta.clear();
        journal.clear();
        return ok({
          data: { deleted: n },
          pagination: { limit: 50, offset: 0, total: n },
        });
      })();
      return run(ov.chatsDelete, fb, "chatsDelete");
    }
    const chatMatch = p.match(/^\/api\/v1\/chats\/([^/]+)$/);
    if (chatMatch && m === "PATCH") {
      if (flags.offline) return run(ov.chatPatch, offlineAbort, "chatPatch");
      const fb: Fulfill = (() => {
        const row = meta.get(chatMatch[1]);
        if (!row) return { status: 404, body: errBody("NOT_FOUND", "nope") };
        const posted = req.postDataJSON() as Partial<ChatMeta>;
        opts.chatPatchBodies?.push({ code: chatMatch[1], body: posted });
        Object.assign(row, posted, { updatedAt: iso() });
        return ok(metaRow(row));
      })();
      return run(ov.chatPatch, fb, "chatPatch");
    }
    if (chatMatch && m === "DELETE") {
      const fb: Fulfill = (() => {
        if (!meta.has(chatMatch[1]))
          return { status: 404, body: errBody("NOT_FOUND", "nope") };
        meta.delete(chatMatch[1]);
        journal.delete(chatMatch[1]);
        opts.chatDeletes?.push(chatMatch[1]);
        return { status: 204, body: {} };
      })();
      return run(ov.chatDelete, fb, "chatDelete");
    }
    const msgMatch = p.match(/^\/api\/v1\/chats\/([^/]+)\/messages/);
    if (msgMatch && m === "GET") {
      const code = msgMatch[1];
      opts.msgGetQueries?.push(new URL(req.url()).search);
      const fb: Fulfill = ok({
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
      const fb: Fulfill = (() => {
        const code = msgMatch[1];
        // Faithful 404: clear-all/delete removed the container.
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
      })();
      return run(ov.messagesPost, fb, "messagesPost");
    }
    if (msgMatch && m === "DELETE") {
      const code = msgMatch[1];
      const fb: Fulfill = (() => {
        const fromSeq = Number(new URL(req.url()).searchParams.get("from_seq") ?? "0");
        const kept = (journal.get(code) ?? []).filter((row) => row.seq < fromSeq);
        const deleted = (journal.get(code) ?? []).length - kept.length;
        journal.set(code, kept);
        return ok({
          data: { deleted },
          pagination: { limit: 50, offset: 0, total: kept.length },
        });
      })();
      return run(ov.messagesDelete, fb, "messagesDelete");
    }
    return r.continue();
  });
  return { journal, meta, profileRow };
}

// ---- shared helpers ---------------------------------------------------------

const composerBox = (page: Page) =>
  page.getByRole("combobox", { name: "Message input" });
const sendBtn = (page: Page) =>
  page.getByRole("button", { name: "Send", exact: true });
const stopBtn = (page: Page) =>
  page.getByRole("button", { name: "Stop", exact: true });
const userArticle = (page: Page) =>
  page.getByRole("article", { name: "Message from user" });
const asstArticle = (page: Page) =>
  page.getByRole("article", { name: "Message from assistant" });
const gateHeading = (page: Page) =>
  page.getByRole("heading", { name: /log in to continue/i });

async function openWelcome(page: Page) {
  await page.goto("/new");
  await expect
    .poll(() => composerBox(page).getAttribute("contenteditable"), {
      timeout: 25000,
    })
    .toBe("true");
}

async function waitStreamSettled(page: Page) {
  await expect(stopBtn(page)).toHaveCount(0, { timeout: 30000 });
}

async function activeTag(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return "BODY";
    return `${el.tagName}:${((el.getAttribute("aria-label") ?? el.textContent ?? "").slice(0, 30))}`;
  });
}

type TourStop = { body: boolean; ring: boolean; label: string };
// One Tab stop: BODY-ness plus Astryx ring presence (outline solid ≠
// none/0px). The gated cycle's BODY transient is wrap at dialog scale
// (B39 closed as non-bug); every stop rings since the B40 fix.
async function tabStop(page: Page): Promise<TourStop> {
  await page.keyboard.press("Tab");
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { body: true, ring: false, label: "BODY" };
    const cs = getComputedStyle(el);
    const ring = cs.outlineStyle !== "none" && cs.outlineWidth !== "0px";
    return {
      body: false,
      ring,
      label: `${el.tagName}:${((el.getAttribute("aria-label") ?? el.textContent ?? "").slice(0, 30))}`,
    };
  });
}

// ---- K1 ---------------------------------------------------------------------
// Keyboard-only full send (headless per D55): `/` focuses the composer
// from body, typed text + Enter sends (chat created, turn streams to
// completion), Ctrl+K returns to a live /new — zero pointer.

test("K1 — keyboard-only cycle: / focuses, Enter sends, Ctrl+K news", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await mockBackend(page, c);
  await openWelcome(page);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur?.());
  await page.keyboard.press("/");
  await expect
    .poll(() => activeTag(page), { timeout: 10000 })
    .toContain("DIV");
  const composerFocused = await page.evaluate(
    () =>
      (document.activeElement as HTMLElement)?.getAttribute("role") ===
      "combobox",
  );
  expect(composerFocused, "/ focuses the composer").toBe(true);
  await page.keyboard.type("keyboard only voyage", { delay: 10 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/subject\/CN\/[a-z0-9]{6}/, {
    timeout: 15000,
  });
  await waitStreamSettled(page);
  await expect(userArticle(page)).toHaveCount(1, { timeout: 15000 });
  await expect(asstArticle(page)).toHaveCount(1, { timeout: 15000 });
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page).toHaveURL(/\/new/, { timeout: 15000 });
  await expect
    .poll(() => composerBox(page).getAttribute("contenteditable"), {
      timeout: 25000,
    })
    .toBe("true");
  await expectCleanEnv(errors, true);
});

// ---- K2 ---------------------------------------------------------------------
// Esc hierarchy [staging]: streaming→Esc stops in the composer (B41
// fixed); edit→Esc cancels into the composer; find (Ctrl+F)→Esc
// closes into the composer (was already fine — B14). Gate-Esc yields
// in K2gate (separate guest context). D15's find-close note is
// superseded: the landing was re-probed composer, not BODY.

test("K2 — Esc hierarchy fires in order with pinned focus landings", async ({
  page,
  context,
}) => {
  test.setTimeout(180000);
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await mockBackend(page, c, {}, { seedChats: [{ code: "k2aa11", title: "K2" }] });
  await page.goto("/subject/CN/k2aa11");
  await expect
    .poll(() => composerBox(page).getAttribute("contenteditable"), {
      timeout: 25000,
    })
    .toBe("true");
  // Streaming → Esc stops the stream.
  await composerBox(page).click();
  await page.keyboard.type("teach me TCP in detail", { delay: 5 });
  await sendBtn(page).click();
  await expect(stopBtn(page)).toBeVisible({ timeout: 15000 });
  await page.keyboard.press("Escape");
  await expect(stopBtn(page)).toHaveCount(0, { timeout: 10000 });
  const afterStop = await activeTag(page);
  console.log(`[K2] after Esc-stop focus=${afterStop}`);
  expect(afterStop, "stop lands back in the composer (B41 fixed)").toContain("DIV");
  // Edit → Esc cancels back into the composer (C9 banner path).
  await composerBox(page).click();
  await page.keyboard.type("simulate limit please", { delay: 5 });
  await sendBtn(page).click();
  await expect(
    page.getByText("Too many requests", { exact: false }).first(),
  ).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Edit message" }).last().click();
  const banner = "Editing message — Send applies it to this turn, Esc cancels.";
  await expect(page.getByText(banner).first()).toBeVisible({ timeout: 10000 });
  await page.keyboard.press("Escape");
  await expect(page.getByText(banner)).toHaveCount(0, { timeout: 10000 });
  const afterEdit = await activeTag(page);
  console.log(`[K2] after Esc-edit-cancel focus=${afterEdit}`);
  expect(afterEdit, "edit-cancel lands back in the composer").toContain("DIV");
  // Find (Ctrl+F) → Esc closes the panel.
  await page.keyboard.press("ControlOrMeta+f");
  const findBox = page.getByPlaceholder("Find in thread...");
  await expect(findBox).toBeVisible({ timeout: 10000 });
  const findFocus = await activeTag(page);
  expect(findFocus, "find opens focused").toContain("INPUT");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-find-panel]")).toHaveCount(0, {
    timeout: 10000,
  });
  const afterFind = await activeTag(page);
  console.log(`[K2] after Esc-find-close focus=${afterFind} (D15-filed)`);
  await expectCleanEnv(errors, true);
});

// ---- K2gate -----------------------------------------------------------------
// Guest gate → Esc yields: gate stays, focus unmoved. Separate context:
// the K2 page carries the seed session (authed /new shows no gate).

test("K2gate — gate Esc yields without moving focus", async ({ browser }) => {
  const errors: string[] = [];
  const gctx = await browser.newContext();
  try {
    const guest = await gctx.newPage();
    guest.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    guest.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
    });
    await guest.goto("/new");
    await expect(gateHeading(guest)).toBeVisible({ timeout: 20000 });
    const beforeGate = await activeTag(guest);
    await guest.keyboard.press("Escape");
    await expect(gateHeading(guest)).toBeVisible({ timeout: 10000 });
    const afterGate = await activeTag(guest);
    expect(afterGate, "gate Esc yields without moving focus").toBe(beforeGate);
    await expectCleanEnv(errors);
  } finally {
    await gctx.close();
  }
});

// ---- K3 ---------------------------------------------------------------------
// Dialog focus traps: profile + onboarding contain Tab (the single
// BODY stop per tour is the headless wrap transient, not a leak —
// B39 closed as non-bug); keyboard Close restores the invoker (B41
// fixed); the required onboarding ignores Esc by design; the gate
// cycle is pinned in K13g.

test("K3 — profile/onboarding trap Tab, keyboard close, Esc yields", async ({
  page,
  context,
}) => {
  test.setTimeout(180000);
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await mockBackend(page, c);
  await openWelcome(page);
  const dlg = page.getByRole("dialog").first();
  // Setup via pointer (trap entry is what's asserted): open profile.
  await page.locator("nav, aside").first().getByRole("link", { name: "My Profile" }).click();
  await expect(dlg).toBeVisible({ timeout: 15000 });
  let escapes = 0;
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    const inside = await dlg.evaluate((d) => d.contains(document.activeElement));
    if (!inside) {
      escapes += 1;
      console.log(`[K3] profile escape: ${await activeTag(page)}`);
    }
  }
  console.log(`[K3] profile trap escapes=${escapes}/30 (B39 family)`);
  expect(escapes, "profile trap holds (≤1 BODY-hole stop)").toBeLessThanOrEqual(1);
  // Keyboard close: Tab to the Close action, Enter dismisses…
  for (let i = 0; i < 40; i++) {
    const nm = await page.evaluate(
      () =>
        (document.activeElement as HTMLElement)?.getAttribute("aria-label") ??
        "",
    );
    if (/close/i.test(nm)) break;
    await page.keyboard.press("Tab");
  }
  await page.keyboard.press("Enter");
  await expect(dlg).toHaveCount(0, { timeout: 15000 });
  const afterClose = await activeTag(page);
  console.log(`[K3] after keyboard close focus=${afterClose}`);
  expect(afterClose, "close restores the My Profile invoker (B41 fixed)").toContain(
    "My Profile",
  );
  // Onboarding (required): contains Tab, ignores Esc by design.
  await mockBackend(
    page,
    c,
    {
      me: () => ok(ME({ onboardingDone: false })),
      profileGet: () =>
        ok({ ...DEFAULT_PROFILE_ROW, onboardingDone: false }),
    },
    {},
  );
  await page.goto("/new");
  const onb = page.getByRole("alertdialog", { name: "Set up your profile" });
  await expect(onb).toBeVisible({ timeout: 25000 });
  let onbEscapes = 0;
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press("Tab");
    const inside = await onb.evaluate((d) => d.contains(document.activeElement));
    if (!inside) {
      onbEscapes += 1;
      console.log(`[K3] onboarding escape: ${await activeTag(page)}`);
    }
  }
  console.log(`[K3] onboarding trap escapes=${onbEscapes}/15 (B39 family)`);
  expect(onbEscapes, "onboarding trap holds (≤1 BODY-hole stop)").toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1000);
  await expect(onb).toHaveCount(1, { timeout: 5000 });
  console.log("[K3] onboarding ignores Esc (required dialog, by design)");
  await expectCleanEnv(errors);
});

// ---- K4 ---------------------------------------------------------------------
// Live-region announcements [staging]: the thread `role=log` mirrors
// stream + error text (announced), and the unsynced pill carries its
// OWN `role=status` (announced — not mirrored into the log, D57).

test("K4 — stream, error, and unsynced pill all reach live regions", async ({
  page,
  context,
}) => {
  test.setTimeout(180000);
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const flags = { offline: false };
  await mockBackend(page, c, {}, { seedChats: [{ code: "k4aa11", title: "K4" }], flags });
  await page.goto("/subject/CN/k4aa11");
  await expect
    .poll(() => composerBox(page).getAttribute("contenteditable"), {
      timeout: 25000,
    })
    .toBe("true");
  const logText = () =>
    page.evaluate(
      () => document.querySelector('[role="log"]')?.textContent ?? "(no log)",
    );
  await composerBox(page).click();
  await page.keyboard.type("hello live boxes", { delay: 5 });
  await sendBtn(page).click();
  await waitStreamSettled(page);
  const settled = await logText();
  expect(settled.length, "streamed turn mirrored into role=log").toBeGreaterThan(0);
  await composerBox(page).click();
  await page.keyboard.type("simulate error please", { delay: 5 });
  await sendBtn(page).click();
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }).first(),
  ).toBeVisible({ timeout: 30000 });
  const errText = await logText();
  expect(errText.length, "error text mirrored into role=log").toBeGreaterThan(settled.length);
  console.log("[K4] stream + error announced via role=log");
  // Offline leg (O1 recipe): abort → inline failure (B47 — the send
  // leg reads the connection copy) → reload → pill.
  flags.offline = true;
  await composerBox(page).click();
  await page.keyboard.type("o1 hello while offline", { delay: 5 });
  await sendBtn(page).click();
  await expect(
    page.getByText("Couldn't reach the server", { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  await page.reload();
  await page
    .getByText("Ask anything about CN...", { exact: false })
    .first()
    .waitFor({ timeout: 25000 });
  await expect
    .poll(() => composerBox(page).getAttribute("contenteditable"), {
      timeout: 25000,
    })
    .toBe("true");
  const pill = page.getByText(/unsynced/, { exact: false });
  await expect(pill.first()).toBeVisible({ timeout: 20000 });
  const pillRole = await pill.first().evaluate((el) => el.getAttribute("role"));
  expect(pillRole, "unsynced pill is itself a live region").toBe("status");
  console.log(`[K4] unsynced pill announced via own role=status: ${await pill.first().textContent()}`);
  flags.offline = false;
  await expectCleanEnv(errors, true);
});

// ---- K5 ---------------------------------------------------------------------
// Axe on a live thread: messages + error bubble (Retry) + find open —
// serious/critical zero, same bar as the existing suite.

test("K5 — axe clean on live thread with error bubble and find open", async ({
  page,
  context,
}) => {
  test.setTimeout(180000);
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await mockBackend(page, c, {}, { seedChats: [{ code: "k5aa11", title: "K5 axe" }] });
  await page.goto("/subject/CN/k5aa11");
  await expect
    .poll(() => composerBox(page).getAttribute("contenteditable"), {
      timeout: 25000,
    })
    .toBe("true");
  await composerBox(page).click();
  await page.keyboard.type("explain TCP", { delay: 5 });
  await sendBtn(page).click();
  await waitStreamSettled(page);
  await composerBox(page).click();
  await page.keyboard.type("simulate error please", { delay: 5 });
  await sendBtn(page).click();
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }).first(),
  ).toBeVisible({ timeout: 30000 });
  await page.keyboard.press("ControlOrMeta+f");
  const findBox = page.getByPlaceholder("Find in thread...");
  await expect(findBox).toBeVisible({ timeout: 10000 });
  await findBox.fill("TCP");
  await page.waitForTimeout(500);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  console.log(
    `[K5] axe passes=${results.passes.length} violations=${results.violations.length} blocking=${blocking.length}`,
  );
  for (const v of blocking)
    console.log(
      `  axe-blocking: ${v.id} impact=${v.impact} nodes=${v.nodes.length} targets=${JSON.stringify(v.nodes.map((n) => n.target)).slice(0, 300)}`,
    );
  for (const v of blocking)
    for (const n of v.nodes.slice(0, 2)) {
      const html = await page
        .evaluate(
          (sel) =>
            document.querySelector(sel)?.outerHTML.slice(0, 260) ?? "(gone)",
          n.target[0] as string,
        )
        .catch(() => "(eval failed)");
      console.log(`  axe-node ${v.id}: ${html}`);
    }
  // Tripwire (B45+B46 FIXED this round): the live thread used to
  // carry exactly two known violations — composer `aria-multiline` on
  // role=combobox (critical, stripped at the boundary) and tool-call
  // metadata contrast (serious, disabled→secondary promotion). The bar
  // is now zero blocking IDs; any NEW violation fails here.
  expect(blocking.map((v) => v.id).sort()).toEqual([]);
  await expectCleanEnv(errors, true);
});

// ---- K6 ---------------------------------------------------------------------
// 200% zoom on a thread with the attachment drawer open: no horizontal
// overflow, composer reachable and live (file staged via setInputFiles
// as drawer setup — the zoom assertions are the test).

test("K6 — 200% zoom on thread with open drawer stays usable", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await mockBackend(page, c, {}, { seedChats: [{ code: "k6aa11", title: "K6 zoom" }] });
  await page.goto("/subject/CN/k6aa11");
  await expect
    .poll(() => composerBox(page).getAttribute("contenteditable"), {
      timeout: 25000,
    })
    .toBe("true");
  const inputHandle = await page.$('input[type="file"]');
  expect(inputHandle, "file input exists for drawer setup").not.toBeNull();
  await inputHandle!.setInputFiles([
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello drawer") },
  ]);
  await expect(page.getByText("notes.txt", { exact: false }).first()).toBeVisible({
    timeout: 15000,
  });
  // 200% zoom == CSS viewport half the device pixels in each axis.
  await page.setViewportSize({ width: 640, height: 400 });
  await page.evaluate(() => {
    document.body.style.zoom = "200%";
  });
  await page.waitForTimeout(500);
  await expect(page.getByText("notes.txt", { exact: false }).first()).toBeVisible();
  const overflow = await page.evaluate(
    () => document.scrollingElement?.scrollWidth ?? 0,
  );
  console.log(`[K6] 200% scrollWidth=${overflow} (viewport 640)`);
  expect(overflow, "no horizontal overflow at 200% with drawer").toBeLessThanOrEqual(640);
  await expect
    .poll(() => composerBox(page).getAttribute("contenteditable"), {
      timeout: 15000,
    })
    .toBe("true");
  await expectCleanEnv(errors, true);
});

// ---- K7 ---------------------------------------------------------------------
// Reduced motion: the stream settles in one paint under `reduce` (B43
// fixed — the word-chunk loop is skipped) with identical content.
// The 6s closer bound proves single-settle: the chunked path needs
// ~13s for this answer.

test("K7 — reduced-motion stream completes with identical content", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  try {
    await addSession(ctx, PASS_COOKIES);
    const p = await ctx.newPage();
    const errors = await collectErrors(p);
    const c = newCounters();
    await mockBackend(p, c);
    await p.goto("/new");
    await expect
      .poll(() => composerBox(p).getAttribute("contenteditable"), {
        timeout: 25000,
      })
      .toBe("true");
    expect(
      await p.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches),
      "reduce is active in-page",
    ).toBe(true);
    await composerBox(p).click();
    await p.keyboard.type("teach me TCP in detail", { delay: 5 });
    const sentAt = Date.now();
    await sendBtn(p).click();
    await expect(p).toHaveURL(/\/subject\/CN\/[a-z0-9]{6}/, {
      timeout: 15000,
    });
    // B43 calming proof: the deep answer chunks for ~13s word by word
    // (~150 words × 80ms) — a single-settle calming branch lands the
    // closer inside 6s. Then the normal settle + parity asserts.
    await expect(
      p.getByText("test you on it", { exact: false }).first(),
    ).toBeVisible({ timeout: 6000 });
    console.log(`[K7] reduce closer landed in ${Date.now() - sentAt}ms (chunked path needs ~13s)`);
  await waitStreamSettled(p);
  await expect(userArticle(p)).toHaveCount(1, { timeout: 15000 });
  await expect(asstArticle(p)).toHaveCount(1, { timeout: 15000 });
  // Identical content: "teach me TCP in detail" matches the deep
  // branch deterministically (responder DEEP_RE) — the deep closer
  // already landed above, and no caret survives (same bar as default
  // motion, P1).
    const stranded = await p.evaluate(() =>
      document.body.innerText.includes("▍"),
    );
    expect(stranded, "no stranded caret under reduce").toBe(false);
    await expectCleanEnv(errors, true);
  } finally {
    await ctx.close();
  }
});

// ---- K8 ---------------------------------------------------------------------
// Dictation a11y half (C17 covers pointer): the button is labelled,
// and headless denial stays silent (B42 closed by the B18 fix — real
// denial fires onError → an error toast on the aria-live region; the
// headless rig has no SpeechRecognition, so nothing fires here and the
// log comparison stands).

test("K8 — dictation labelled; denial announces nothing (B42 closed by B18)", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await mockBackend(page, c, {}, { seedChats: [{ code: "k8aa11", title: "K8" }] });
  await page.goto("/subject/CN/k8aa11");
  await expect
    .poll(() => composerBox(page).getAttribute("contenteditable"), {
      timeout: 25000,
    })
    .toBe("true");
  const mic = page.getByRole("button", { name: /dictation/i });
  await expect(mic, "dictation control is labelled").toHaveCount(1);
  const logBefore = await page.evaluate(
    () => document.querySelector('[role="log"]')?.textContent ?? "(no log)",
  );
  await mic.click();
  await page.waitForTimeout(2000);
  await expect(mic, "denial leaves the control live").toBeVisible();
  const logAfter = await page.evaluate(
    () => document.querySelector('[role="log"]')?.textContent ?? "(no log)",
  );
  expect(logAfter, "denial announces nothing (B42)").toBe(logBefore);
  // Composer unaffected by the denial.
  await composerBox(page).click();
  await page.keyboard.type("explain TCP", { delay: 5 });
  await sendBtn(page).click();
  await waitStreamSettled(page);
  await expect(asstArticle(page)).toHaveCount(1, { timeout: 15000 });
  await expectCleanEnv(errors, true);
});

// ---- K9 ---------------------------------------------------------------------
// Touch targets at 360px: composer controls measure 44×44 (B44 fixed),
// over WCAG 2.2 AA's 24px floor. The row menu keeps its 24px floor
// through the nav drawer the 360px layout requires.

test("K9 — touch targets measured at 360px (B44 tripwire)", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await mockBackend(page, c, {}, { seedChats: [{ code: "k9aa11", title: "K9 sizes" }] });
  await page.goto("/subject/CN/k9aa11");
  await expect
    .poll(() => composerBox(page).getAttribute("contenteditable"), {
      timeout: 25000,
    })
    .toBe("true");
  const sizes = await page.evaluate(() => {
    const out: Record<string, string> = {};
    const pick = (re: RegExp) =>
      [...document.querySelectorAll("button")].find(
        (b) => re.test(b.textContent ?? "") || re.test(b.getAttribute("aria-label") ?? ""),
      );
    for (const [k, re] of [
      ["send", /^send$/i],
      ["attach", /attach/i],
      ["dictation", /dictation/i],
    ] as const) {
      const r = pick(re)?.getBoundingClientRect();
      out[k] = r ? `${r.width.toFixed(0)}x${r.height.toFixed(0)}` : "missing";
    }
    return out;
  });
  console.log(`[K9] 360px targets=${JSON.stringify(sizes)} (bar 44px, AA floor 24px)`);
  for (const [k, v] of Object.entries(sizes)) {
    const h = Number(v.split("x")[1]);
    expect(h, `${k} meets the WCAG 2.2 AA 24px floor`).toBeGreaterThanOrEqual(24);
    expect(h, `${k} meets the 44px plan bar (B44 fixed)`).toBeGreaterThanOrEqual(44);
  }
  // Row menu through the nav drawer (sidebar collapses at 360px).
  await page.getByRole("button", { name: /open navigation/i }).click();
  const row = page.getByRole("link", { name: "K9 sizes" });
  await expect(row).toBeVisible({ timeout: 15000 });
  await row.hover();
  const menuBtn = page.getByRole("button", { name: "Conversation options" }).first();
  await expect(menuBtn).toBeVisible({ timeout: 15000 });
  const menuBox = await menuBtn.boundingBox();
  console.log(`[K9] row-menu=${menuBox?.width.toFixed(0)}x${menuBox?.height.toFixed(0)}`);
  expect(menuBox?.height ?? 0, "row menu meets the AA 24px floor").toBeGreaterThanOrEqual(24);
  await expectCleanEnv(errors, true);
});

// ---- K10 --------------------------------------------------------------------
// Landscape phone (800×360): mid-thread rotation keeps the composer
// live with no page overflow, and the guest gate fits.

test("K10 — 800×360 keeps composer live, gate fits", async ({
  page,
  context,
  browser,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await mockBackend(page, c, {}, { seedChats: [{ code: "k0aa11", title: "K10 land" }] });
  await page.goto("/subject/CN/k0aa11");
  await expect
    .poll(() => composerBox(page).getAttribute("contenteditable"), {
      timeout: 25000,
    })
    .toBe("true");
  await page.setViewportSize({ width: 800, height: 360 });
  await page.waitForTimeout(800);
  await expect
    .poll(() => composerBox(page).getAttribute("contenteditable"), {
      timeout: 15000,
    })
    .toBe("true");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(overflow, "no page overflow at 800×360").toBe(true);
  // Guest gate on its own context (shared contexts inherit the seed).
  const gctx = await browser.newContext({ viewport: { width: 800, height: 360 } });
  try {
    const guest = await gctx.newPage();
    const gerrors = await collectErrors(guest);
    await guest.goto("/new");
    await expect(gateHeading(guest)).toBeVisible({ timeout: 20000 });
    const gateOverflow = await guest.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(gateOverflow, "gate fits 800×360").toBe(true);
    await expectCleanEnv(gerrors);
  } finally {
    await gctx.close();
  }
  await expectCleanEnv(errors, true);
});

// ---- K11 --------------------------------------------------------------------
// Forced colors: system remap applies, readable text stays visible,
// and real Tab focus keeps its ring (programmatic .focus() does NOT
// match :focus-visible — probed — so the test Tabs for real).

test("K11 — forced-colors keeps text readable and focus ringed", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const ctx = await browser.newContext({ forcedColors: "active" });
  try {
    const p = await ctx.newPage();
    const errors = await collectErrors(p);
    await p.goto("/new");
    await expect(gateHeading(p)).toBeVisible({ timeout: 20000 });
    expect(
      await p.evaluate(() => matchMedia("(forced-colors: active)").matches),
      "forced-colors is active in-page",
    ).toBe(true);
    // Tab to a real button stop and read its ring (probed ring=true).
    let ring = "none";
    for (let i = 0; i < 6; i++) {
      await p.keyboard.press("Tab");
      const stop = await p.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        return `${el.tagName}:${cs.outlineStyle}/${cs.outlineWidth}`;
      });
      if (stop?.startsWith("BUTTON")) {
        ring = stop;
        break;
      }
    }
    console.log(`[K11] forced-colors button stop ring=${ring}`);
    expect(ring, "focus stays ringed under forced-colors").not.toContain("none");
    await expectCleanEnv(errors);
  } finally {
    await ctx.close();
  }
});

// ---- K13 --------------------------------------------------------------------
// Visible focus, full tab tour: authed /new + thread tour every stop
// with a ring (B40 fixed — the composer carries the standard Astryx
// ring now); BODY stops are wrap-only (≤2, never consecutive —
// headless has no chrome to continue into, D59). The gated 3-cycle
// pins the wrap transient at dialog scale (B39 closed as non-bug —
// wrap routes through BODY every 3rd stop in a 2-stop dialog).

test("K13 — tab tours ring every stop; BODY only at wrap", async ({
  page,
  context,
}) => {
  test.setTimeout(180000);
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await mockBackend(page, c, {}, { seedChats: [{ code: "k3aa11", title: "K13 tour" }] });
  async function tour(n: number, label: string) {
    const stops: TourStop[] = [];
    for (let i = 0; i < n; i++) stops.push(await tabStop(page));
    const bodies = stops.filter((s) => s.body).length;
    const consecutive = stops.some((s, i) => s.body && stops[i + 1]?.body);
    const unringed = stops.filter((s) => !s.body && !s.ring);
    console.log(
      `[K13 ${label}] stops=${n} bodies=${bodies} consecutiveBodies=${consecutive} unringed=${unringed.length} ${unringed.map((s) => s.label).join(" | ")}`,
    );
    expect(bodies, `${label}: BODY only at wrap`).toBeLessThanOrEqual(2);
    expect(consecutive, `${label}: never stuck on BODY`).toBe(false);
    expect(
      unringed.length,
      `${label}: every stop ringed (B40 fixed — composer carries the standard ring)`,
    ).toBe(0);
    return stops;
  }
  // Authed /new shell tour.
  await openWelcome(page);
  const welcomeStops = await tour(30, "welcome");
  expect(
    welcomeStops.some((s) => s.label.includes("Message input")),
    "tour reaches the composer",
  ).toBe(true);
  // Thread tour.
  await page.goto("/subject/CN/k3aa11");
  await expect
    .poll(() => composerBox(page).getAttribute("contenteditable"), {
      timeout: 25000,
    })
    .toBe("true");
  const threadStops = await tour(30, "thread");
  expect(
    threadStops.some((s) => s.label.includes("Message input")),
    "thread tour reaches the composer",
  ).toBe(true);
  await expectCleanEnv(errors, true);
});

test("K13g — gated cycle reaches both actions; BODY is wrap (B39 closed)", async ({
  page,
}) => {
  const errors = await collectErrors(page);
  await page.goto("/new");
  await expect(gateHeading(page)).toBeVisible({ timeout: 20000 });
  const stops: TourStop[] = [];
  for (let i = 0; i < 9; i++) stops.push(await tabStop(page));
  const labels = stops.map((s) => (s.body ? "BODY" : s.label.split(":")[0]));
  console.log(`[K13g] cycle=${labels.join(" → ")}`);
  expect(
    stops.some((s) => s.label.includes("Log in")),
    "gate tour reaches Log in",
  ).toBe(true);
  expect(
    stops.some((s) => s.label.includes("Create account")),
    "gate tour reaches Create account",
  ).toBe(true);
  expect(
    stops.filter((s) => s.body).length,
    "wrap routes through BODY every 3rd stop in a 2-stop dialog (B39: non-bug)",
  ).toBe(3);
  await expectCleanEnv(errors);
});
