// Section D — races & concurrency [staging] with a real BetterAuth
// session (seed users in Neon) + mocked FastAPI (`**/api/v1/**`).
// Same base harness as section-c (one router per test after
// `unrouteAll`, counters asserted after, server journal, same
// clean-env gate) plus server-side CHAT META (rename/pin/archive/
// delete/clear-all round-trip through a meta map, so reload tests
// prove server==UI) and a mutable offline flag (abort-shaped legs -
// the same TypeError the browser raises on a dead network, per E21).
//
// The mock router is shared by page.route AND context.route (two-tab
// tests), via mockBackend(target) accepting either.
//
// Vendor/app facts pinned while implementing (cited, not guessed):
// - ThreadView timers are component-lifetime: unmount (nav away,
//   Ctrl+K, logout) cancels WITHOUT persisting — the in-flight
//   partial is dropped, the old chat keeps Q only. Stop ALWAYS keeps
//   an interrupted marker with Retry (B24: even pre-words stops
//   persist the failed block, so a stranded Q keeps its recovery).
//   R1b pins the pre-words stop; R1 pins the mid-stream stop.
// - Bubble-Retry calls startTurn directly; the `if (live) return`
//   guard inside startTurn is the entire concurrency control for
//   Retry-mid-stream and double-click Retry.
// - handleSend closes over its render's `live`: a Send immediately
//   after Stop can be swallowed if React hasn't re-rendered yet —
//   R1 measures the real Stop→Send gap instead of assuming 300ms.
// - Sidebar rows are links; row menus mount on hover ("Conversation
//   options"); delete asks first ("Delete chat?" → Delete → /new);
//   archive is instant; archiving unpins (session.ts).
// - Sidebar lists guard code format (B27): format-invalid custom
//   codes never render as rows — the route guard would bounce them to
//   the welcome shell (dead-end link). Only reachable with corrupt
//   data (the server issues 6-char codes); R10b pins the hiding with
//   a deliberate 5-char seed.
// - Profile dialog revalidates on open (B25): the server row is
//   refetched and the local store reseeded, so reopen converges
//   cross-tab without a reload. An already-open dialog does not
//   live-update.
// - A reconnect flush that delivers while the open thread shows a
//   sync error triggers a messages reload (B26) — delivered turns
//   repaint without a manual reload; the successful load clears the
//   error itself. R14 pins repaint-then-reload-idempotent.
// - Logged-in export is a SERVER call (GET /users/me/export) —
//   offline fails honestly with a toast (R12 matches the plan).
// - Onboarding/profile saves fail inline/toast with form data kept.
// - Token mint is per-page-heap (module-level cache+dedupe):
//   two pages mint twice; N-per-component would be the bug (R16).
//
// Deviations from browser-break-it-plan.md (evidence over text):
//   D24 (R4/R7): navigating away mid-stream does NOT leave "partial
//     on OLD chat" — unmount-cancel drops the partial silently; the
//     old chat keeps Q only, the new chat is pristine. Pins actual.
//   D25 (R5): same-context two pages (not two contexts) — real tabs
//     share localStorage/cookies; context.route shares one journal.
//     Stronger than the plan's contexts, same assertions.
//   D26 (R8): clear-all empties the store, so the open thread's code
//     is gone and the dead-deep-link bounce fires (/new welcome — no
//     crash, no stranded composer); a fresh welcome send then proves
//     the app isn't wedged. Pins actual.
//   D27 (R10): pin+archive burst ends archived-AND-unpinned (archive
//     unpins by design) — order matters, last intent wins.
//   D28 (R14, fixed B26): the reconnected flush repaints — the row
//     lands server-side (journal) AND the open thread reloads its
//     messages, so the delivered turn appears without a manual reload
//     (the successful load clears the sync error itself).
//   D29 (R12/R15/R11): offline copies pinned (OFFLINE_COPY / inline
//     failure); retry works on reconnect.

import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import * as fs from "node:fs";

const TEMP = "C:\\Users\\anubh\\AppData\\Local\\Temp\\opencode";
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
const OFFLINE_COPY =
  "Couldn't reach the server. Check your connection and try again.";

// ---- mock shapes ------------------------------------------------------------

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
    email: "e2e.sectiond@example.com",
    displayName: "E2E SectionD",
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
  tokenMode?: { mode: "ok" | "expired" };
  updateUserUp?: { up: boolean };
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
  const tokenMode = opts.tokenMode ?? { mode: "ok" as const };
  const updateUserUp = opts.updateUserUp ?? { up: true };
  let chatSeq = 0;
  const msgSeq = new Map<string, number>();
  await target.unrouteAll({ behavior: "wait" });
  await target.route("**/api/auth/sign-out*", (r) =>
    r.fulfill(json({}, 200)),
  );
  // BetterAuth display-name transport (R11): abort = offline half;
  // crafted 2xx = retry half (the generated client only checks
  // res.error, so no Neon write is needed to prove the success path).
  await target.route("**/api/auth/update-user*", (r) =>
    updateUserUp.up
      ? r.fulfill(json({ status: true }, 200))
      : r.abort("connectionreset"),
  );
  // Service-token mint (R16/R17): counted, shaped like the real one.
  await target.route("**/api/auth/token*", (r) => {
    c.token += 1;
    if (tokenMode.mode === "expired")
      return r.fulfill(json({ token: "expired-e2e-jwt" }, 200));
    return r.fulfill(json({ token: `e2e-jwt-${c.token}` }, 200));
  });
  await target.route("**/api/v1/**", async (r) => {
    const req = r.request();
    const u = new URL(req.url());
    const m = req.method();
    const p = u.pathname;
    // Requests carrying the minted Bearer prove the mint was used.
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

async function openSeededThread(
  page: Page,
  c: Counters,
  ov: BackendOv = {},
  extra: MockOpts & {
    seedChats?: Array<{ code: string; title: string; subject?: string }>;
  } = {},
  code = "s3cnd1",
) {
  const seeds = extra.seedChats ?? [{ code, title: "Seeded thread for Section D" }];
  const { journal, meta } = await mockBackend(page, c, ov, { ...extra, seedChats: seeds });
  await page.goto(`/subject/CN/${code}`);
  await page
    .getByText("Ask anything about CN...", { exact: false })
    .first()
    .waitFor({ timeout: 25000 });
  // Placeholder paint is NOT readiness (section-c T25): staging and
  // sends gate on isAppReady (composer contentEditable goes true).
  await expect
    .poll(
      async () => composerBox(page).getAttribute("contenteditable"),
      { timeout: 25000 },
    )
    .toBe("true");
  return { journal, meta };
}

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

async function threadSend(page: Page, text: string) {
  await composerBox(page).click();
  await page.keyboard.type(text, { delay: 5 });
  await sendBtn(page).click();
}

const ASK_MARKER = "Quote it first";
const DEEP_MARKER = "chapter view";

async function waitStreamSettled(page: Page) {
  await expect(stopBtn(page)).toHaveCount(0, { timeout: 30000 });
}

const sidebar = (page: Page) => page.locator("nav, aside").first();

async function openProfileDialog(page: Page) {
  await sidebar(page).getByRole("link", { name: "My Profile" }).click();
  await expect(page.getByRole("dialog").first()).toBeVisible({ timeout: 15000 });
}

// Hover a sidebar chat row to mount its MoreMenu, then pick an item.
async function rowMenu(page: Page, title: string, item: string) {
  await sidebar(page).getByRole("link", { name: title }).hover();
  await page
    .getByRole("button", { name: "Conversation options" })
    .first()
    .click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}

// ---- R1 --------------------------------------------------------------------
// Stop-then-Send: the old stream must die (timers cleared, partial kept
// via finalize) and the new turn must stream clean. The Stop→Send gap
// is MEASURED — handleSend closes over its render's `live`, so a Send
// before React re-renders post-Stop is swallowed; the test pins the
// real gap instead of assuming the plan's 300ms.

test("R1 — Stop then Send: old stream dead, new turn clean, order kept", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const { journal } = await openSeededThread(page, c);
  await threadSend(page, "teach me TCP in detail");
  await expect(stopBtn(page)).toBeVisible({ timeout: 15000 });
  // Wait for the first streamed words BEFORE stopping: Stop with
  // live.text still "" silently drops the assistant turn entirely
  // (finalizeTurn appends nothing for empty text — filed as a
  // finding). The header proves words are flowing.
  await expect(
    page.getByText(DEEP_MARKER, { exact: false }).first(),
  ).toBeVisible({ timeout: 30000 });
  // Pre-type the follow-up while the old stream runs (composer stays
  // live during streams), so Stop→Send is two fast clicks. Deep-shaped
  // ("walk me through it") so the new turn carries the deep marker.
  await composerBox(page).click();
  await page.keyboard.type("and UDP next, walk me through it", { delay: 5 });
  const tStop = Date.now();
  await stopBtn(page).click();
  await expect(stopBtn(page)).toHaveCount(0, { timeout: 10000 });
  await sendBtn(page).click();
  const gapMs = Date.now() - tStop;
  // Pin the real gap (plan says ≤300ms — honest measurement wins).
  expect(gapMs).toBeLessThan(5000);
  await expect(userArticle(page)).toHaveCount(2, { timeout: 15000 });
  // New turn streamed clean to completion…
  await waitStreamSettled(page);
  await expect(asstArticle(page)).toHaveCount(2, { timeout: 15000 });
  // …old partial kept but never completed: the deep closer (final
  // sentence — a stopped prefix can never carry it) is only on the
  // new turn. (Header markers are asserted nowhere: the streaming
  // parser withholds partial blocks, so header presence mid-stream
  // is timing, not structure.)
  const DEEP_CLOSER = "test you on it";
  await expect(
    asstArticle(page).first().getByText(DEEP_CLOSER, { exact: false }),
  ).toHaveCount(0);
  await expect(
    asstArticle(page).nth(1).getByText(DEEP_CLOSER, { exact: false }),
  ).toBeVisible({ timeout: 15000 });
  // …and the server order matches the paint order.
  await expect.poll(() => (journal.get("s3cnd1") ?? []).length, {
    timeout: 15000,
  }).toBe(4);
  const roles = (journal.get("s3cnd1") ?? []).map((r) => r.role);
  expect(roles).toEqual(["user", "assistant", "user", "assistant"]);
  // Reload keeps the same order.
  await page.reload();
  await page
    .getByText("Ask anything about CN...", { exact: false })
    .first()
    .waitFor({ timeout: 25000 });
  await expect(userArticle(page)).toHaveCount(2, { timeout: 15000 });
  await expect(asstArticle(page)).toHaveCount(2, { timeout: 15000 });
  await expectCleanEnv(errors, true);
});

// ---- R1b -------------------------------------------------------------------
// B24: Stop before the first streamed words keeps an interrupted marker
// with Retry (was: silent drop, stranded Q). No marker wait here —
// both timings (words flowing or not) persist the failed block now,
// so the assertions hold either way.

test("R1b — Stop before first words keeps an interrupted marker with Retry (B24)", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const { journal } = await openSeededThread(page, c);
  await threadSend(page, "teach me TCP in detail");
  await expect(stopBtn(page)).toBeVisible({ timeout: 15000 });
  await stopBtn(page).click();
  await expect(stopBtn(page)).toHaveCount(0, { timeout: 10000 });
  // Interrupted marker either way — never a stranded answerless Q.
  await expect(
    page.getByText("This response was interrupted before it finished.", { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  await expect(userArticle(page)).toHaveCount(1, { timeout: 15000 });
  await expect(asstArticle(page)).toHaveCount(1, { timeout: 15000 });
  // Recovery: Retry replays the prompt into a real answer (appended
  // below the marker — failed history stays).
  await page.getByRole("button", { name: "Retry", exact: true }).first().click();
  await expect(page.getByText(DEEP_MARKER, { exact: false }).first()).toBeVisible({
    timeout: 30000,
  });
  await waitStreamSettled(page);
  await expect(userArticle(page)).toHaveCount(1, { timeout: 15000 });
  await expect(asstArticle(page)).toHaveCount(2, { timeout: 15000 });
  // Server order: Q, interrupted A, fresh A.
  await expect.poll(() => (journal.get("s3cnd1") ?? []).length, {
    timeout: 15000,
  }).toBe(3);
  const roles = (journal.get("s3cnd1") ?? []).map((r) => r.role);
  expect(roles).toEqual(["user", "assistant", "assistant"]);
  await expectCleanEnv(errors, true);
});

// ---- R2 --------------------------------------------------------------------
// Retry while a rerun streams: the error block's Retry stays mounted
// during the rerun, but startTurn's `if (live) return` guard eats the
// second click — single active turn, no interleaved answers.

test("R2 — Retry mid-rerun is ignored: single active turn", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await openSeededThread(page, c);
  await threadSend(page, "simulate error please");
  const retryBtn = asstArticle(page)
    .first()
    .getByRole("button", { name: "Retry", exact: true });
  await expect(retryBtn).toBeVisible({ timeout: 30000 });
  await retryBtn.click();
  await expect(stopBtn(page)).toBeVisible({ timeout: 15000 });
  // Second Retry while the rerun is live: must not fork a turn.
  await retryBtn.click();
  await expect(stopBtn(page)).toHaveCount(1, { timeout: 5000 });
  // The rerun completes: the simulate-error answer's closing line
  // ("dig into it together" — its final sentence, so only the FULL
  // answer carries it) lands in exactly one fresh turn.
  await expect(
    page.getByText("dig into it together", { exact: false }).first(),
  ).toBeVisible({ timeout: 30000 });
  await waitStreamSettled(page);
  // Failed turn stays + exactly one fresh answer, still one user turn.
  await expect(userArticle(page)).toHaveCount(1);
  await expect(asstArticle(page)).toHaveCount(2);
  await expectCleanEnv(errors, true);
});

// ---- R3 --------------------------------------------------------------------
// Double-click Retry: two clicks, one rerun (React re-renders between
// the clicks so the second sees live != null — pinned, not assumed).

test("R3 — double-click Retry fires exactly one rerun", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await openSeededThread(page, c);
  await threadSend(page, "simulate error please");
  const retryBtn = asstArticle(page)
    .first()
    .getByRole("button", { name: "Retry", exact: true });
  await expect(retryBtn).toBeVisible({ timeout: 30000 });
  await retryBtn.dblclick();
  // Exactly one rerun lands the full answer's closing line once.
  await expect(
    page.getByText("dig into it together", { exact: false }).first(),
  ).toBeVisible({ timeout: 30000 });
  await waitStreamSettled(page);
  await expect(userArticle(page)).toHaveCount(1);
  await expect(asstArticle(page)).toHaveCount(2);
  await expect(
    page.getByText("dig into it together", { exact: false }),
  ).toHaveCount(1);
  await expectCleanEnv(errors, true);
});

// ---- R4 --------------------------------------------------------------------
// Navigate away mid-stream: unmount cancels timers WITHOUT persisting
// (D24) — the old chat keeps Q only, the new chat is pristine, and no
// late append ever lands after the switch.

test("R4 — navigate away mid-stream: old chat Q-only, new chat pristine", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const seeds = [
    { code: "r4aa11", title: "R4 chat A" },
    { code: "r4bb22", title: "R4 chat B" },
  ];
  const { journal } = await openSeededThread(page, c, {}, { seedChats: seeds }, "r4aa11");
  await threadSend(page, "teach me TCP in detail");
  await expect(stopBtn(page)).toBeVisible({ timeout: 15000 });
  await sidebar(page).getByRole("link", { name: "R4 chat B" }).click();
  await expect(page).toHaveURL(/\/subject\/CN\/r4bb22/, { timeout: 15000 });
  // New chat pristine: divider only, zero articles…
  await expect(userArticle(page)).toHaveCount(0, { timeout: 15000 });
  await expect(asstArticle(page)).toHaveCount(0);
  // …old chat kept the question but no answer row was ever persisted…
  expect((journal.get("r4aa11") ?? []).map((r) => r.role)).toEqual(["user"]);
  // …and going back proves it: Q only, stream dead (no late append).
  await sidebar(page).getByRole("link", { name: "R4 chat A" }).click();
  await expect(page).toHaveURL(/\/subject\/CN\/r4aa11/, { timeout: 15000 });
  await expect(userArticle(page)).toHaveCount(1, { timeout: 15000 });
  await expect(asstArticle(page)).toHaveCount(0);
  await page.waitForTimeout(2500);
  await expect(asstArticle(page)).toHaveCount(0);
  expect((journal.get("r4aa11") ?? []).length).toBe(1);
  await expectCleanEnv(errors, true);
});

// ---- R5 --------------------------------------------------------------------
// Two tabs (same context = shared cookies/storage, like real tabs),
// one shared journal via context.route (D25): both send within a
// second; both turns land once each, reload converges with no dupes.

test("R5 — two tabs, same chat: both turns land once, reload converges", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const context = await browser.newContext();
  try {
    await addSession(context, PASS_COOKIES);
    const c = newCounters();
    const journal = new Map<string, JournalRow[]>();
    await mockBackend(
      context,
      c,
      {},
      { seedChats: [{ code: "r5tab1", title: "R5 shared chat" }], journal },
    );
    const p1 = await context.newPage();
    const p2 = await context.newPage();
    // Live refs (NOT .then snapshots): collectErrors returns the very
    // array its listeners push into, so awaiting it keeps the gate live.
    const errorsA = await collectErrors(p1);
    const errorsB = await collectErrors(p2);
    await p1.goto("/subject/CN/r5tab1");
    await p2.goto("/subject/CN/r5tab1");
    for (const p of [p1, p2]) {
      await p
        .getByText("Ask anything about CN...", { exact: false })
        .first()
        .waitFor({ timeout: 25000 });
      await expect
        .poll(
          async () =>
            p.getByRole("combobox", { name: "Message input" }).getAttribute("contenteditable"),
          { timeout: 25000 },
        )
        .toBe("true");
    }
    // Both send within a second of each other.
    await p1.getByRole("combobox", { name: "Message input" }).click();
    await p1.keyboard.type("alpha turn", { delay: 5 });
    await p2.getByRole("combobox", { name: "Message input" }).click();
    await p2.keyboard.type("beta turn", { delay: 5 });
    await p1.getByRole("button", { name: "Send", exact: true }).click();
    await p2.getByRole("button", { name: "Send", exact: true }).click();
    // Both streams settle on both tabs.
    for (const p of [p1, p2]) {
      await expect(
        p.getByRole("button", { name: "Stop", exact: true }),
      ).toHaveCount(0, { timeout: 30000 });
    }
    // Server holds both turns: 2 user rows + 2 assistant rows…
    await expect.poll(() => (journal.get("r5tab1") ?? []).length, {
      timeout: 15000,
    }).toBe(4);
    const texts = (journal.get("r5tab1") ?? []).map((r) =>
      JSON.stringify(r.content),
    );
    expect(texts.some((t) => t.includes("alpha turn"))).toBe(true);
    expect(texts.some((t) => t.includes("beta turn"))).toBe(true);
    // …and a reload converges: each turn exactly once, no dupes.
    await p1.reload();
    await p1
      .getByText("Ask anything about CN...", { exact: false })
      .first()
      .waitFor({ timeout: 25000 });
    await expect(
      p1.getByRole("article", { name: "Message from user" }),
    ).toHaveCount(2, { timeout: 15000 });
    await expect(
      p1.getByRole("article", { name: "Message from assistant" }),
    ).toHaveCount(2, { timeout: 15000 });
    // Article-scoped (section-c T-lesson): the assistant bold echo
    // carries the same text, so page-level exact counts double-count.
    const p1user = p1.getByRole("article", { name: "Message from user" });
    await expect(
      p1user.getByText("alpha turn", { exact: true }),
    ).toHaveCount(1, { timeout: 15000 });
    await expect(
      p1user.getByText("beta turn", { exact: true }),
    ).toHaveCount(1, { timeout: 15000 });
    await expectCleanEnv(errorsA, true);
    await expectCleanEnv(errorsB, true);
  } finally {
    await context.close();
  }
});

// ---- R6 --------------------------------------------------------------------
// Logout mid-stream: the gate takes over, the stream halts (unmount
// clears timers), and no authed fetch fires after logout settles.

test("R6 — logout mid-stream halts the stream, zero fetches after", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  // The mocked sign-out is force-200 (seed-guard), so the REAL
  // BetterAuth session would survive and /login would bounce to /new
  // (E6's note). Killing get-session after the click simulates the
  // revocation the fake-200 skipped — the honest half of the logout.
  const session = { dead: false };
  await page.unrouteAll({ behavior: "wait" });
  const { journal } = await mockBackend(page, c, {}, {
    seedChats: [{ code: "s3cnd1", title: "R6 thread" }],
  });
  await page.route("**/api/auth/get-session*", (r) =>
    session.dead
      ? r.fulfill(json(null, 200))
      : r.continue(),
  );
  await page.goto("/subject/CN/s3cnd1");
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
  await threadSend(page, "teach me TCP in detail");
  await expect(stopBtn(page)).toBeVisible({ timeout: 15000 });
  await sidebar(page).getByRole("link", { name: "Logout" }).click();
  session.dead = true;
  await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
  // Login holds (no bounce: session reads dead)…
  await page.waitForTimeout(2000);
  await expect(page).toHaveURL(/\/login/);
  // …stream halted with the thread (unmount clears timers, Q only)…
  await expect(stopBtn(page)).toHaveCount(0);
  expect((journal.get("s3cnd1") ?? []).map((r) => r.role)).toEqual(["user"]);
  // …and the request log freezes: snapshot, wait, compare.
  const snap = { ...c };
  await page.waitForTimeout(2500);
  expect({ ...c }).toEqual(snap);
  await expectCleanEnv(errors, true, ["Transition was skipped"]);
});

// ---- R7 --------------------------------------------------------------------
// Ctrl+K mid-stream: fresh welcome, old stream dead (unmount-cancel,
// D24 — Q only on the old chat), no cross-chat append.

test("R7 — Ctrl+K mid-stream: fresh chat, old stream dead", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const { journal } = await openSeededThread(page, c);
  await threadSend(page, "teach me TCP in detail");
  await expect(stopBtn(page)).toBeVisible({ timeout: 15000 });
  // Tab out of the editable (shortcuts ignore editable targets), then
  // the new-chat shortcut.
  await page.keyboard.press("Tab");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page).toHaveURL(/\/new/, { timeout: 15000 });
  await page
    .getByText("Ask anything about your course...", { exact: false })
    .first()
    .waitFor({ timeout: 25000 });
  // Fresh chat: zero articles…
  await expect(userArticle(page)).toHaveCount(0);
  // …old stream dead: Q persisted, A never did, journal frozen.
  expect((journal.get("s3cnd1") ?? []).map((r) => r.role)).toEqual(["user"]);
  await page.waitForTimeout(2500);
  expect((journal.get("s3cnd1") ?? []).length).toBe(1);
  // Old thread repaints Q only.
  await page.goto("/subject/CN/s3cnd1");
  await page
    .getByText("Ask anything about CN...", { exact: false })
    .first()
    .waitFor({ timeout: 25000 });
  await expect(userArticle(page)).toHaveCount(1, { timeout: 15000 });
  await expect(asstArticle(page)).toHaveCount(0);
  await expectCleanEnv(errors, true);
});

// ---- R8 --------------------------------------------------------------------
// Clear-all with the thread open: memory paint survives (no crash, no
// redirect — D26), the sidebar empties, and the next send 404s
// honestly with a toast + rollback.

test("R8 — clear-all bounces the open thread to /new, next send works", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await openSeededThread(page, c);
  await openProfileDialog(page);
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("button", { name: "Privacy", exact: true }).click();
  await dlg.getByRole("button", { name: "Delete all chats" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(
    confirm.getByText("Delete all chats?", { exact: false }),
  ).toBeVisible({ timeout: 15000 });
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  // Toast renders in the notification region AND the aria-live region
  // (strict-mode dupe by design) — first() pins presence.
  await expect(
    page.getByText("All chats deleted.", { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  expect(c.chatsDelete).toBe(1);
  // The open thread's code is gone, so the dead-deep-link bounce fires:
  // /new welcome (no crash, no stranded composer), sidebar emptied…
  await expect(page).toHaveURL(/\/new/, { timeout: 15000 });
  await page
    .getByText("Ask anything about your course...", { exact: false })
    .first()
    .waitFor({ timeout: 25000 });
  await expect(
    sidebar(page).getByRole("link", { name: "Seeded thread for Section D" }),
  ).toHaveCount(0);
  // …and the next send works fine (fresh welcome create proves the app
  // isn't wedged on the deleted container). Close the still-open
  // profile dialog first (its backdrop eats composer clicks), then
  // wait out the Astro transition overlay from the bounce.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog").first()).toHaveCount(0, {
    timeout: 15000,
  });
  await composerBox(page).click();
  await page.keyboard.type("fresh start", { delay: 5 });
  await sendBtn(page).click();
  await expect(page).toHaveURL(/\/subject\/CN\/[a-z0-9]{6}/, {
    timeout: 15000,
  });
  await expect(userArticle(page)).toHaveCount(1, { timeout: 15000 });
  await expect(
    page.getByText(ASK_MARKER, { exact: false }).first(),
  ).toBeVisible({ timeout: 30000 });
  await waitStreamSettled(page);
  await expectCleanEnv(errors, true);
});

// ---- R9 --------------------------------------------------------------------
// Delete the open chat: confirm → /new, row gone, no zombie composer
// posting to the dead code.

test("R9 — delete the open chat lands on /new, no zombie posts", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const chatDeletes: string[] = [];
  const seeds = [{ code: "r9del1", title: "R9 doomed chat" }];
  await openSeededThread(page, c, {}, { seedChats: seeds, chatDeletes }, "r9del1");
  const postsBefore = c.messagesPost;
  await rowMenu(page, "R9 doomed chat", "Delete");
  const confirm = page.getByRole("alertdialog");
  await expect(
    confirm.getByText("Delete chat?", { exact: false }),
  ).toBeVisible({ timeout: 15000 });
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page).toHaveURL(/\/new/, { timeout: 15000 });
  expect(c.chatDelete).toBe(1);
  expect(chatDeletes).toEqual(["r9del1"]);
  await expect(
    sidebar(page).getByRole("link", { name: "R9 doomed chat" }),
  ).toHaveCount(0);
  // No zombie: nothing posts to the dead code after the delete.
  await page.waitForTimeout(1500);
  expect(c.messagesPost).toBe(postsBefore);
  await page
    .getByText("Ask anything about your course...", { exact: false })
    .first()
    .waitFor({ timeout: 25000 });
  await expectCleanEnv(errors, true);
});

// ---- R10 -------------------------------------------------------------------
// Rename + pin + archive burst: three PATCHes <1s apart, last intent
// wins — archiving unpins by design (D27), so the end state is
// archived-only with the new title, and reload proves server==UI.

test("R10 — rename/pin/archive burst converges, reload-proof", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const chatPatchBodies: Array<{ code: string; body: unknown }> = [];
  const seeds = [{ code: "r10b11", title: "R10 burst chat" }];
  await openSeededThread(page, c, {}, { seedChats: seeds, chatPatchBodies }, "r10b11");
  await rowMenu(page, "R10 burst chat", "Rename");
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("textbox").fill("Burst title");
  await dlg.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    sidebar(page).getByRole("link", { name: "Burst title" }),
  ).toBeVisible({ timeout: 15000 });
  await rowMenu(page, "Burst title", "Pin");
  await rowMenu(page, "Burst title", "Archive");
  expect(c.chatPatch).toBe(3);
  const kinds = chatPatchBodies.map((e) => e.body as Record<string, unknown>);
  expect(kinds[0]).toMatchObject({ title: "Burst title" });
  expect(kinds[1]).toMatchObject({ isPinned: true });
  expect(kinds[2]).toMatchObject({ isArchived: true });
  // Archive exits to /new and unpins: Archived holds the title, Pinned
  // does not.
  await expect(page).toHaveURL(/\/new/, { timeout: 15000 });
  await expect(
    sidebar(page).getByText("Archived", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    sidebar(page).getByRole("link", { name: "Burst title" }),
  ).toBeVisible({ timeout: 15000 });
  // Reload: server state == UI state.
  await page.reload();
  await page
    .getByText("Ask anything about your course...", { exact: false })
    .first()
    .waitFor({ timeout: 25000 });
  await expect(
    sidebar(page).getByRole("link", { name: "Burst title" }),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    sidebar(page).getByText("Archived", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expectCleanEnv(errors, true);
});

// ---- R10b ------------------------------------------------------------------
// B27: format-invalid codes never list — the route guard would bounce
// them to the welcome shell (dead-end link, wrong content, no error).
// Deliberate 5-char corrupt seed (cf. T33: every other test seeds
// valid 6-char codes).

test("R10b — sidebar hides format-invalid codes instead of dead-linking (B27)", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await openSeededThread(
    page,
    c,
    {},
    {
      seedChats: [
        { code: "r10b11", title: "R10b valid chat" },
        { code: "bad01", title: "R10b corrupt chat" },
      ],
    },
    "r10b11",
  );
  await expect(
    sidebar(page).getByRole("link", { name: "R10b valid chat" }),
  ).toBeVisible({ timeout: 15000 });
  // The corrupt-code row lists nowhere (recent/pinned/search share the
  // same guarded list paths).
  await expect(sidebar(page).getByText("R10b corrupt chat")).toHaveCount(0);
  await expectCleanEnv(errors, true);
});

// ---- R11 -------------------------------------------------------------------
// Display-name save while offline: honest error toast, draft kept in
// the form (never a fake "Saved"); retry on reconnect lands it.

test("R11 — display-name save offline errors honestly, retry works", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const updateUserUp = { up: false };
  await openSeededThread(page, c, {}, { updateUserUp });
  await openProfileDialog(page);
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Display name").first().fill("Offline E2E");
  await dlg.getByRole("button", { name: "Save display name" }).click();
  // Honest error (pin the real copy), form keeps the draft…
  await expect(
    page
      .getByText(/Couldn't save your name|Couldn't reach the server/, {
        exact: false,
      })
      .first(),
  ).toBeVisible({ timeout: 15000 });
  await expect(dlg.getByLabel("Display name").first()).toHaveValue(
    "Offline E2E",
  );
  // …and the retry on reconnect lands the save.
  updateUserUp.up = true;
  await dlg.getByRole("button", { name: "Save display name" }).click();
  await expect(
    page.getByText("Display name saved.", { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  await expectCleanEnv(errors, true);
});

// ---- R12 -------------------------------------------------------------------
// Export while offline: honest failure now (server data can't be
// fabricated), dialog stays open; retry on reconnect downloads.

test("R12 — export offline fails honestly, retry downloads", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const flags = { offline: true };
  await openSeededThread(page, c, {}, { flags });
  await openProfileDialog(page);
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("button", { name: "Privacy", exact: true }).click();
  await dlg.getByRole("button", { name: "Export my data" }).click();
  await expect(
    page.getByText(OFFLINE_COPY, { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  expect(
    await page.getByText("Your data export is ready.").count(),
  ).toBe(0);
  await expect(page.getByRole("dialog").first()).toBeVisible();
  // Reconnect → retry downloads the file.
  flags.offline = false;
  const dlPromise = page.waitForEvent("download", { timeout: 15000 });
  await dlg.getByRole("button", { name: "Export my data" }).click();
  const dl = await dlPromise;
  expect(dl.suggestedFilename()).toBe("pesdac-data.json");
  await expect(
    page.getByText("Your data export is ready.", { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  expect(c.exportGet).toBe(2);
  await expectCleanEnv(errors, true);
});

// ---- R13 -------------------------------------------------------------------
// Two tabs edit one profile: shared server row, last-write-wins, both
// tabs converge on refetch, no crash.

test("R13 — two tabs edit one profile: server LWW, reopen converges (B25)", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const context = await browser.newContext();
  try {
    await addSession(context, PASS_COOKIES);
    const c = newCounters();
    const profileRow: Record<string, unknown> = { ...DEFAULT_PROFILE_ROW };
    await mockBackend(
      context,
      c,
      {},
      {
        seedChats: [{ code: "r13p11", title: "R13 thread" }],
        profileRow,
      },
    );
    const p1 = await context.newPage();
    const p2 = await context.newPage();
    // Live refs (NOT .then snapshots): collectErrors returns the very
    // array its listeners push into, so awaiting it keeps the gate live.
    const errorsA = await collectErrors(p1);
    const errorsB = await collectErrors(p2);
    for (const p of [p1, p2]) {
      await p.goto("/subject/CN/r13p11");
      await p
        .getByText("Ask anything about CN...", { exact: false })
        .first()
        .waitFor({ timeout: 25000 });
      await expect
        .poll(
          async () =>
            p.getByRole("combobox", { name: "Message input" }).getAttribute("contenteditable"),
          { timeout: 25000 },
        )
        .toBe("true");
    }
    const setCampus = async (p: Page, option: string) => {
      await sidebar(p).getByRole("link", { name: "My Profile" }).click();
      const dlg = p.getByRole("dialog");
      await expect(dlg.first()).toBeVisible({ timeout: 15000 });
      await dlg.getByRole("combobox", { name: "Campus" }).click();
      await p.getByRole("option", { name: option }).click();
    };
    // The Selector listbox may stay open after picking (then getByLabel
    // matches the combobox + clear-button + open listbox): close it
    // explicitly so later reads are unambiguous.
    const closeListbox = async (p: Page) => {
      if ((await p.getByRole("listbox").count()) > 0) {
        await p.keyboard.press("Escape");
        await expect(p.getByRole("listbox")).toHaveCount(0, {
          timeout: 10000,
        });
      }
    };
    const campusShown = (p: Page) =>
      p
        .getByRole("dialog")
        .getByRole("combobox", { name: "Campus" })
        .textContent();
    await setCampus(p1, "RR Campus");
    await expect.poll(() => c.profilePatch, { timeout: 15000 }).toBe(1);
    await closeListbox(p1);
    await expect.poll(() => campusShown(p1), { timeout: 15000 }).toContain(
      "RR Campus",
    );
    await setCampus(p2, "EC Campus");
    await expect.poll(() => c.profilePatch, { timeout: 15000 }).toBe(2);
    await closeListbox(p2);
    await expect.poll(() => campusShown(p2), { timeout: 15000 }).toContain(
      "EC Campus",
    );
    // Server row holds the last write…
    expect(profileRow["campus"]).toBe("EC");
    // …and every reopen converges (B25): the dialog revalidates on
    // open. Close + reopen p2 (already EC)…
    await p2.keyboard.press("Escape");
    await expect(p2.getByRole("dialog").first()).toHaveCount(0, {
      timeout: 15000,
    });
    await sidebar(p2).getByRole("link", { name: "My Profile" }).click();
    await expect(p2.getByRole("dialog").first()).toBeVisible({
      timeout: 15000,
    });
    await expect.poll(() => campusShown(p2), { timeout: 15000 }).toContain(
      "EC Campus",
    );
    // …while p1 reopens CONVERGED (B25 fixed: the dialog revalidates
    // the server row on open and reseeds the local store — no reload
    // needed; an already-open dialog does not live-update).
    await p1.keyboard.press("Escape");
    await expect(p1.getByRole("dialog").first()).toHaveCount(0, {
      timeout: 15000,
    });
    await sidebar(p1).getByRole("link", { name: "My Profile" }).click();
    await expect(p1.getByRole("dialog").first()).toBeVisible({
      timeout: 15000,
    });
    await expect.poll(() => campusShown(p1), { timeout: 15000 }).toContain(
      "EC Campus",
    );
    // Reload agrees (idempotent convergence, not a second write).
    await p1.reload();
    await p1
      .getByText("Ask anything about CN...", { exact: false })
      .first()
      .waitFor({ timeout: 25000 });
    await sidebar(p1).getByRole("link", { name: "My Profile" }).click();
    await expect(p1.getByRole("dialog").first()).toBeVisible({
      timeout: 15000,
    });
    await expect.poll(() => campusShown(p1), { timeout: 15000 }).toContain(
      "EC Campus",
    );
    await expectCleanEnv(errorsA, true);
    await expectCleanEnv(errorsB, true);
  } finally {
    await context.close();
  }
});

// ---- R14 -------------------------------------------------------------------
// Offline flapping with a queued send: exactly-once delivery. The
// offline send rolls back its paint + toasts (honest), the op waits
// durable in the outbox, and one `online` kick lands exactly one row —
// which repaints only on reload (D28).

test("R14 — offline flap x5: exactly-once delivery, no dupe or loss", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const flags = { offline: false };
  const { journal } = await openSeededThread(page, c, {}, { flags });
  flags.offline = true;
  await threadSend(page, "queued while offline");
  // Honest failure: paint rolls back, toast fires, assistant never starts.
  await expect(
    page.getByText("Couldn't save that message", { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  await expect(userArticle(page)).toHaveCount(0, { timeout: 15000 });
  // Flap the network 5x inside 10s: nothing may duplicate or drop.
  for (let i = 0; i < 5; i++) {
    flags.offline = !flags.offline;
    await page.waitForTimeout(400);
  }
  flags.offline = false;
  // Reconnect kick: the durable op replays exactly once.
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect
    .poll(() => (journal.get("s3cnd1") ?? []).length, { timeout: 20000 })
    .toBe(1);
  const rows = journal.get("s3cnd1") ?? [];
  expect(rows.map((r) => r.role)).toEqual(["user"]);
  // B26 fixed: the flush repaints — the delivered turn appears WITHOUT
  // reload (the sync error clears with the successful reload).
  const delivered = page.getByRole("article", { name: "Message from user" });
  await expect(delivered).toHaveCount(1, { timeout: 20000 });
  await expect(
    delivered.first().getByText("queued while offline", { exact: false }),
  ).toBeVisible({ timeout: 15000 });
  // Reload keeps exactly one (repaint + reload never dupes).
  await page.reload();
  await page
    .getByText("Ask anything about CN...", { exact: false })
    .first()
    .waitFor({ timeout: 25000 });
  const reloaded = page.getByRole("article", { name: "Message from user" });
  await expect(reloaded).toHaveCount(1, { timeout: 15000 });
  await expect(
    reloaded.first().getByText("queued while offline", { exact: false }),
  ).toBeVisible({ timeout: 15000 });
  await expectCleanEnv(errors, true);
});

// ---- R15 -------------------------------------------------------------------
// Onboarding save offline: blocked WITH copy, dialog stays open, form
// data kept for retry; reconnect lands the save.

test("R15 — onboarding save offline keeps data, retry succeeds", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const flags = { offline: true };
  await mockBackend(
    page,
    c,
    {
      me: () => ok(ME({ onboardingDone: false })),
      profileGet: () =>
        ok({ institution: "", semester: "", branch: "", subjects: [], campus: "", onboardingDone: false }),
    },
    { flags },
  );
  await page.goto("/new");
  const dialog = page.getByRole("alertdialog", { name: "Set up your profile" });
  await expect(dialog).toBeVisible({ timeout: 25000 });
  await dialog.getByRole("radio", { name: "RR Campus" }).check();
  await dialog.getByRole("combobox", { name: "Semester" }).click();
  await page.getByRole("option", { name: "Semester 3" }).click();
  await dialog.getByRole("combobox", { name: "Branch" }).click();
  await page.getByRole("option", { name: "CSE (Core)" }).click();
  await dialog.getByRole("checkbox", { name: "Select all" }).check();
  await dialog.getByRole("button", { name: "Start studying" }).click();
  // Blocked WITH copy, dialog open, picks retained…
  await expect(
    dialog.getByText(OFFLINE_COPY, { exact: false }),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    dialog.getByRole("radio", { name: "RR Campus" }),
  ).toBeChecked({ timeout: 15000 });
  expect(c.profilePatch).toBe(1);
  // …retry on reconnect lands the save and closes the wizard.
  flags.offline = false;
  await dialog.getByRole("button", { name: "Start studying" }).click();
  await expect(dialog).toBeHidden({ timeout: 15000 });
  expect(c.profilePatch).toBe(2);
  await expectCleanEnv(errors);
});

// ---- R16 -------------------------------------------------------------------
// Parallel token mints dedupe: two pages boot simultaneously; the mint
// endpoint sees at most 2 hits (one per page heap — the in-flight
// dedupe is per-heap, so N-per-component would be the bug).

test("R16 — two simultaneous boots mint at most twice", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const context = await browser.newContext();
  try {
    await addSession(context, PASS_COOKIES);
    const c = newCounters();
    await mockBackend(
      context,
      c,
      {},
      { seedChats: [{ code: "r16t11", title: "R16 thread" }] },
    );
    const p1 = await context.newPage();
    const p2 = await context.newPage();
    await Promise.all([
      p1.goto("/subject/CN/r16t11"),
      p2.goto("/subject/CN/r16t11"),
    ]);
    for (const p of [p1, p2]) {
      await p
        .getByText("Ask anything about CN...", { exact: false })
        .first()
        .waitFor({ timeout: 25000 });
      await expect
        .poll(
          async () =>
            p.getByRole("combobox", { name: "Message input" }).getAttribute("contenteditable"),
          { timeout: 25000 },
        )
        .toBe("true");
    }
    // At most one mint per page heap (unit-proven per-heap dedupe in
    // auth-cache.test.ts — this is the browser proof)…
    expect(c.token).toBeLessThanOrEqual(2);
    expect(c.token).toBeGreaterThanOrEqual(1);
    // …and the mints were actually used (Bearer on backend calls).
    expect(c.authed).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});

// ---- R17 -------------------------------------------------------------------
// Already-expired JWT: the mint returns it, the first write 401s, and
// the app takes the instant re-auth path (E6 shape) — no request
// storm of doomed retries first.

test("R17 — expired JWT fails fast to re-login, no storm", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const tokenMode = { mode: "expired" as const };
  await openSeededThread(page, c, {
    messagesPost: () => ({ status: 401, body: errBody("UNAUTHORIZED", "nope") }),
  }, { tokenMode });
  await threadSend(page, "are you still there");
  await expect(page.getByText(EXPIRY_COPY).first()).toBeVisible({ timeout: 15000 });
  await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
  // Bounded: one mint served the session, the 401 cleared it, and the
  // gate stopped everything — no doomed-request storm. Freeze covers
  // writes + mint only: the /login shell legitimately re-reads session
  // state (me/profile), and one in-flight Bearer may land late — reads
  // are revalidation, not a storm.
  expect(c.token).toBeLessThanOrEqual(3);
  expect(c.messagesPost).toBe(1);
  await page.waitForTimeout(2000);
  const snap = {
    messagesPost: c.messagesPost,
    chatsPost: c.chatsPost,
    chatPatch: c.chatPatch,
    token: c.token,
  };
  await page.waitForTimeout(2000);
  expect({
    messagesPost: c.messagesPost,
    chatsPost: c.chatsPost,
    chatPatch: c.chatPatch,
    token: c.token,
  }).toEqual(snap);
  await expectCleanEnv(errors, true, ["Transition was skipped"]);
});
