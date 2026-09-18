// Section G — routing & nav [mock] unless noted (N5 + N11 are
// [staging]: real BetterAuth session + mocked FastAPI).
// Same base harness as section-d (one router per test after
// `unrouteAll`, counters asserted after, server journal + meta, same
// clean-env gate). No test logs out, but `beforeAll` still reseeds —
// Section F's tail (A14) revokes the shared seed row, so a suite run
// arriving here would otherwise inherit a dead cookie masked by the
// mocked me leg (Section F T54/T55 — bitten again in G probes).
// N7 is covered by smoke.spec.ts ("unknown route gets the honest 404
// fallback") — no new test here; the audit records it kept, never
// deleted. N8 runs against the normal `test:e2e` PRODUCTION build, so
// "dev-only routes must not ship" is tested for real.
//
// Vendor/app facts pinned while implementing (cited, not guessed):
// - index.astro is a bare `Astro.redirect("/new")`; [subject].astro
//   redirects bare `/subject/<subject>` the same way.
// - Chat codes are 6-char lowercase alnum (isChatCodeFormat); anything
//   else never enters the custom-thread path (no draftCode, no bounce).
// - Dead deep link = store-live + draftCode absent from customs →
//   navigate("/new") (Pesdac.tsx). Both an absent valid-format code and
//   a code the server 404s end up there.
// - The session store is MEMORY-only: boot purges every `pesdac-*`
//   localStorage key and nothing reads browser storage again
//   (session.ts). localStorage seeds die at boot — the N2 seed below
//   exercises the dead-code URL path, not store seeding (corrected,
//   Section H D53: the "reconcile" comment it replaced was wrong).
// - Query params and hash on /new are fully ignored (no subject
//   honoring, no focus move); the gate autofocuses Create account.
// - The gate view always mounts a SECOND hidden alertdialog (Delete
//   chat? template) — visible-count, not DOM-count, is the assertion.
// - mockup.astro + mockups.astro are DEV-gated (B37 fixed): 404 in
//   production builds, live under `astro dev`.
//
// Deviations from browser-break-it-plan.md (evidence over text):
//   D41 (N1): no skeleton thread — bad-format codes render the welcome
//     view stranded on the chat URL (live composer when authed).
//   D42 (N6): /new/ serves 200 in place (no normalization); /LOGIN and
//     /Subject/OS/abc both 404 (router is case-sensitive throughout).
//   D43 (N8): /mockup + /mockups 404 in the prod test build —
//     dev-only routes no longer ship (B37 fixed: DEV gate).
//   D44 (N4): the DOM always holds 2 alertdialogs (gate + hidden
//     Delete template) — "no double dialogs" means exactly one VISIBLE.
//   D45 (N9/N10): params/hash ignored entirely, nothing honored.

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

// Section F kills the shared seed on its way out (A14 logout) — mint a
// live one before this file's authed tests, or the mocked me leg masks
// a corpse (T55, bitten in G probes: N5 stayed /login, N11 never armed).
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

// ---- mock shapes (same as section-d) ----------------------------------------

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
    email: "e2e.sectiong@example.com",
    displayName: "E2E SectionG",
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
          pagination: { limit: 50, offset: 0, total: 0 },
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

// ---- composer helpers -------------------------------------------------------

const composerBox = (page: Page) =>
  page.getByRole("combobox", { name: "Message input" });
const userArticle = (page: Page) =>
  page.getByRole("article", { name: "Message from user" });
const asstArticle = (page: Page) =>
  page.getByRole("article", { name: "Message from assistant" });
const gateHeading = (page: Page) =>
  page.getByRole("heading", { name: /log in to continue/i });
const notFoundHeading = (page: Page) =>
  page.getByRole("heading", { name: /page not found/i });

async function openWelcome(page: Page) {
  await page.goto("/new");
  await expect
    .poll(() => composerBox(page).getAttribute("contenteditable"), {
      timeout: 25000,
    })
    .toBe("true");
}

// ---- N1 ---------------------------------------------------------------------
// Unknown subject code (bad format): never enters the custom-thread path —
// the welcome view renders stranded on the chat URL (D41). No skeleton,
// no bounce, no crash; live composer when authed.

test("N1 — unknown subject code renders welcome on the URL, no crash", async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await mockBackend(page, c);
  await page.goto("/subject/os/ZZZ9");
  // URL stays put (no bounce, no redirect)…
  await expect.poll(() => page.url(), { timeout: 10000 }).toContain("/subject/os/ZZZ9");
  // …welcome view renders, composer live (authed)…
  await expect
    .poll(() => composerBox(page).getAttribute("contenteditable"), {
      timeout: 25000,
    })
    .toBe("true");
  await expect(
    page.getByRole("heading", { name: /welcome to pesdac/i }),
  ).toBeVisible({ timeout: 15000 });
  // …no gate, no crash copy.
  await expect(gateHeading(page)).toHaveCount(0);
  await expect(notFoundHeading(page)).toHaveCount(0);
  await expectCleanEnv(errors, true);
});

// ---- N2 ---------------------------------------------------------------------
// Dead custom code: a valid-format code the server doesn't know (N2a —
// the localStorage seed is boot-purged, so this is the dead-code URL
// path with an empty server list) AND a valid-format code absent
// everywhere (N2b) — both bounce to /new (documented behavior, pinned
// twice). Corrected in Section H (D53): no store seeding or server
// reconcile is involved — the store is memory-only.

test("N2 — dead custom code bounces to /new, welcome takes over", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await page.addInitScript(() => {
    localStorage.setItem(
      "pesdac-custom-chats-v1",
      JSON.stringify([
        {
          code: "d34d99",
          subject: "CN",
          title: "N2 doomed local",
          createdAt: new Date().toISOString(),
        },
      ]),
    );
  });
  await mockBackend(
    page,
    c,
    {
      messagesGet: (n, req) =>
        new URL(req.url()).pathname.includes("/d34d99/")
          ? { status: 404, body: errBody("NOT_FOUND", "nope") }
          : ok({ data: [], pagination: { limit: 50, offset: 0, total: 0 } }),
    },
    {},
  );
  // N2a: the seeded row's thread 404s → bounce.
  await page.goto("/subject/CN/d34d99");
  await expect(page).toHaveURL(/\/new/, { timeout: 15000 });
  // The localStorage seed above is boot-purged (memory-only store), so
  // this pins the dead-code URL path: unknown code + store-live (the
  // server list is empty) → dead-link bounce. The local row never
  // survives boot by design — no reconcile is involved (D53).
  await expect
    .poll(
      () =>
        page.evaluate(
          () => localStorage.getItem("pesdac-custom-chats-v1") ?? "[]",
        ),
      { timeout: 15000 },
    )
    .not.toContain("d34d99");
  // N2b: valid-format code, absent everywhere → same bounce.
  await page.goto("/subject/CN/zzz999");
  await expect(page).toHaveURL(/\/new/, { timeout: 15000 });
  // Welcome takes over, identity intact (mock user greets by name).
  await expect
    .poll(() => composerBox(page).getAttribute("contenteditable"), {
      timeout: 25000,
    })
    .toBe("true");
  await expect(gateHeading(page)).toHaveCount(0);
  await expectCleanEnv(errors, true);
});

// ---- N3 ---------------------------------------------------------------------
// Bare /subject/<subject>: server redirect to /new (never a bare
// composer). Guest lands on the gate.

test("N3 — bare /subject/os redirects to /new", async ({ page }) => {
  const errors = await collectErrors(page);
  const resp = await page.goto("/subject/os");
  expect(resp?.request().redirectedFrom()?.url()).toContain("/subject/os");
  await expect(page).toHaveURL(/\/new/);
  await expect(gateHeading(page)).toBeVisible({ timeout: 20000 });
  await expectCleanEnv(errors);
});

// ---- N4 ---------------------------------------------------------------------
// Back/forward across the gate: history sane, exactly one VISIBLE gate
// each landing (the DOM always holds a hidden Delete-template
// alertdialog — D44), focus inside the gate, no crash.

test("N4 — back/forward across the gate stays sane", async ({ page }) => {
  const errors = await collectErrors(page);
  await page.goto("/new");
  await expect(gateHeading(page)).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page).toHaveURL(/\/login/);
  // Back → gate again, single visible dialog, focus trapped inside it.
  await page.goBack();
  await expect(gateHeading(page)).toBeVisible({ timeout: 20000 });
  const back = await page.evaluate(() => {
    // offsetParent lies for position:fixed — rect + computed style.
    const visible = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].filter(
      (d) => {
        const el = d as HTMLElement;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
      },
    );
    return {
      visibleDialogs: visible.length,
      gateRole: visible[0]?.getAttribute("role"),
      focusInside: visible[0]?.contains(document.activeElement) ?? false,
      focusLabel: document.activeElement?.textContent?.slice(0, 30) ?? "(none)",
    };
  });
  expect(back.visibleDialogs).toBe(1);
  expect(back.gateRole).toBe("alertdialog");
  expect(back.focusInside).toBe(true);
  // Forward → /login, gate gone, no dialog anywhere.
  await page.goForward();
  await expect(page).toHaveURL(/\/login/);
  await expect(gateHeading(page)).toHaveCount(0);
  const fwdDialogs = await page
    .locator('[role="dialog"],[role="alertdialog"]')
    .count();
  expect(fwdDialogs).toBe(0);
  await expectCleanEnv(errors);
});

// ---- N5 ---------------------------------------------------------------------
// Reload on /login while authed [staging]: bounce /new, gate closed
// (pairs A6 — same client effect, reload flavor).

test("N5 — reload on /login while authed bounces to /new", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await mockBackend(page, c);
  await page.goto("/login");
  await expect(page).toHaveURL(/\/new/, { timeout: 20000 });
  await expect
    .poll(() => composerBox(page).getAttribute("contenteditable"), {
      timeout: 25000,
    })
    .toBe("true");
  await expect(gateHeading(page)).toHaveCount(0);
  // And a hard reload of /login lands the same way.
  await page.goto("/login");
  await expect(page).toHaveURL(/\/new/, { timeout: 20000 });
  await page.reload();
  await expect(page).toHaveURL(/\/new/, { timeout: 20000 });
  await expect(gateHeading(page)).toHaveCount(0);
  await expectCleanEnv(errors, true);
});

// ---- N6 ---------------------------------------------------------------------
// Trailing slash / case: three defined behaviors pinned (D42).

test("N6 — trailing slash serves in place, casing 404s", async ({ page }) => {
  const errors = await collectErrors(page);
  // /new/ — 200, no normalization, gate renders on the slashed URL.
  const slash = await page.goto("/new/");
  expect(slash?.status()).toBe(200);
  await expect.poll(() => page.url(), { timeout: 10000 }).toContain("/new/");
  await expect(gateHeading(page)).toBeVisible({ timeout: 20000 });
  // /LOGIN — case-sensitive router, honest 404.
  const upper = await page.goto("/LOGIN");
  expect(upper?.status()).toBe(404);
  await expect(notFoundHeading(page)).toBeVisible({ timeout: 15000 });
  // /Subject/OS/abc — dynamic segments are case-sensitive too.
  const mixed = await page.goto("/Subject/OS/abc");
  expect(mixed?.status()).toBe(404);
  await expect(notFoundHeading(page)).toBeVisible({ timeout: 15000 });
  await expectCleanEnv(errors);
});

// ---- N8 ---------------------------------------------------------------------
// /mockup* in the prod test build: honest 404s — dev-only routes do NOT
// ship (B37 fixed via `import.meta.env.DEV` gate; the plan's original
// expectation). No redirect (redirectedFrom stays null), no crash.

test("N8 — /mockup routes 404 in the prod build (B37 fixed)", async ({ page }) => {
  const errors = await collectErrors(page);
  const one = await page.goto("/mockup");
  expect(one?.status()).toBe(404);
  expect(one?.request().redirectedFrom()).toBeNull();
  const many = await page.goto("/mockups");
  expect(many?.status()).toBe(404);
  expect(many?.request().redirectedFrom()).toBeNull();
  await expect(notFoundHeading(page)).toHaveCount(0);
  await expectCleanEnv(errors);
});

// ---- N9 ---------------------------------------------------------------------
// Query params on /new: preserved in the URL, never executed, layout
// intact, gate renders.

test("N9 — hostile query params never execute, URL survives", async ({
  page,
}) => {
  const errors = await collectErrors(page);
  const dialogs: string[] = [];
  page.on("dialog", async (d) => {
    dialogs.push(d.message());
    await d.dismiss();
  });
  await page.goto("/new?subject=os&foo=<script>alert(1)</script>");
  await expect(gateHeading(page)).toBeVisible({ timeout: 20000 });
  expect(dialogs).toEqual([]);
  // Params ride along untouched (encoded) — app neither honors nor
  // chokes on them; layout holds at full width.
  expect(page.url()).toContain("subject=os");
  expect(page.url()).toContain("foo=");
  const overflow = await page.evaluate(
    () => document.scrollingElement?.scrollWidth ?? 0,
  );
  expect(overflow).toBeLessThanOrEqual(1280);
  await expectCleanEnv(errors);
});

// ---- N10 --------------------------------------------------------------------
// Hash fragments: no crash, hash preserved, gate autofocus sane (D45).

test("N10 — hash fragment is inert, gate focus sane", async ({ page }) => {
  const errors = await collectErrors(page);
  await page.goto("/new#composer");
  await expect(gateHeading(page)).toBeVisible({ timeout: 20000 });
  expect(page.url()).toContain("#composer");
  // Focus lands on the gate's primary action, not lost to body.
  const focusLabel = await page.evaluate(
    () => document.activeElement?.textContent?.slice(0, 30) ?? "(none)",
  );
  expect(focusLabel).toContain("Create account");
  await expectCleanEnv(errors);
});

// ---- N11 --------------------------------------------------------------------
// Back button during stream [staging]: stream cancelled (R4's
// unmount-cancel, Back-button flavor), history sane, Forward re-opens
// the thread Q-only — no zombie stream.

test("N11 — Back mid-stream cancels, Forward shows Q-only, no zombie", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const { journal } = await mockBackend(page, c);
  await openWelcome(page);
  await composerBox(page).click();
  await page.keyboard.type("teach me TCP in detail", { delay: 5 });
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/\/subject\/CN\/[a-z0-9]{6}/, {
    timeout: 15000,
  });
  const threadUrl = page.url();
  const code = threadUrl.split("/").pop()!;
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  // Back → /new, stream dead (Stop gone everywhere).
  await page.goBack();
  await expect(page).toHaveURL(/\/new/, { timeout: 15000 });
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0, { timeout: 10000 });
  // Old chat kept the question only (unmount-cancel drops the partial).
  expect((journal.get(code) ?? []).map((r) => r.role)).toEqual(["user"]);
  // Forward → thread URL again, Q only, and no zombie stream wakes up.
  await page.goForward();
  await expect(page).toHaveURL(threadUrl);
  await expect(userArticle(page)).toHaveCount(1, { timeout: 15000 });
  await expect(asstArticle(page)).toHaveCount(0);
  await page.waitForTimeout(2500);
  await expect(asstArticle(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0);
  expect((journal.get(code) ?? []).length).toBe(1);
  await expectCleanEnv(errors, true);
});

// ---- N12 --------------------------------------------------------------------
// Landing / root: instant server redirect to /new — assert the redirect
// chain (not just the landing) so a future client-side bounce can't
// silently replace it, plus no flash of anything else.

test("N12 — / redirects instantly to /new", async ({ page }) => {
  const errors = await collectErrors(page);
  const resp = await page.goto("/");
  expect(resp?.request().redirectedFrom()?.url()).toMatch(/\/$/);
  await expect(page).toHaveURL(/\/new/);
  await expect(gateHeading(page)).toBeVisible({ timeout: 20000 });
  await expectCleanEnv(errors);
});
