// Section B — chat create / send / stop / retry [mock] with a real
// BetterAuth session (seed users in Neon) + mocked FastAPI (`**/api/v1/**`).
// The "staging" halves of plan §B need no live backend: the responder
// triggers (`simulate error|empty|limit|tool error`) are client-side
// (lib/responder.ts), so C4–C7 run with zero answer mocking — exactly the
// plan's "prefer triggers, mock only the network half". Persistence legs
// (chats/messages CRUD) are mock-backed with a per-test server journal,
// which also proves the reload round-trip (toWireBlock/messageToBlock).
//
// Seed prerequisites: same as section-a-authed.spec.ts (7-day sessions).
//
// Conventions: one `**/api/v1/**` router per test (registered after
// `unrouteAll`), exactly one terminal action per handler, never assert
// inside a handler (counters asserted after). Same clean-env gate as
// section-a-authed (thread pages allowlist the known hydration #418).
//
// Deviations from browser-break-it-plan.md found while implementing
// (evidence over text — each cited to code):
//   D5 (C1): ordinary welcome creates OMIT clientAdoptKey — it is sent
//     only by the guest→login adopt path (chat-sync.ts:99-113).
//     Message appends DO carry clientMsgKey (chat-sync.ts:157-174).
//     The plan's "bodies carry subject, clientAdoptKey, clientMsgKey"
//     does not match; the test pins actual.
//   D6 (C8, fixed B11): Stop persists the partial as an INTERRUPTED
//     turn (handleStop → failTurn: failed error block with Retry).
//     Matches the plan's '"interrupted" state'; the marker persists
//     across reload.
//   D7 (C9): Edit lives on session-added user turns (last bubble per
//     turn, ThreadView ~1649-1667) — every session turn carries one,
//     and editing a non-final turn truncates everything after it
//     (edit = truncate-from-index + resend). Static demo tails are
//     immutable. The test reaches a session turn via the rate-limit
//     path and disambiguates multiple pencils with .last().
//   D8 (C19, fixed B15): copy-transcript confirms inline ("Copied!"
//     label flip) AND with an info toast — the menu closes on select so
//     the flip alone is invisible. Matches the plan's "toast confirms".
//   D9 (C4/C5): bubble-Retry re-runs WITHOUT removing the failed turn —
//     the fresh answer appends below it (startTurn has no pop; only
//     Regenerate pops). The plan's "error bubble replaced" does not
//     match; the tests pin actual (failed turn stays + fresh answer).
//   D10 (C5/C6, fixed B10): forced retries of contentless intents plan
//     the REAL answer (planResponse ignoreSimulation) instead of
//     replaying the empty outcome — Retry escapes with a normal stream,
//     no second empty block. Payload-bearing branches (stream-failed,
//     tool error) are untouched.

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

// ---- mock shapes -----------------------------------------------------------

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
const emptyChats = () => ({
  data: [],
  pagination: { limit: 50, offset: 0, total: 0 },
});
const mkChat = (code: string, title: string, subject = "CN") => ({
  code,
  subject,
  title,
  isPinned: false,
  isArchived: false,
  createdAt: iso(),
  updatedAt: iso(),
});
const ME = (over: Record<string, unknown> = {}) => ({
  user: {
    id: "e2e",
    email: "e2e.sectionb@example.com",
    displayName: "E2E SectionB",
    onboardingDone: true,
    ...over,
  },
});
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

type Counters = {
  me: number;
  profileGet: number;
  profilePatch: number;
  llm: number;
  chatsGet: number;
  chatsPost: number;
  messagesGet: number;
  messagesPost: number;
  messagesDelete: number;
};
const newCounters = (): Counters => ({
  me: 0,
  profileGet: 0,
  profilePatch: 0,
  llm: 0,
  chatsGet: 0,
  chatsPost: 0,
  messagesGet: 0,
  messagesPost: 0,
  messagesDelete: 0,
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
  messagesGet?: Leg;
  messagesPost?: Leg;
  messagesDelete?: Leg;
};

const ok = (body: unknown): Fulfill => ({ status: 200, body });

// Server journal: posted rows per chat code, served back by messagesGet.
// Round-trips through the real wire shape (role + content block), so
// reload tests prove the toWireBlock/messageToBlock contract.
type JournalRow = {
  id: string;
  seq: number;
  role: string;
  content: unknown;
  createdAt: string;
};

async function mockBackend(
  page: Page,
  c: Counters,
  ov: BackendOv = {},
  opts: {
    seedChats?: Array<{ code: string; title: string; subject?: string }>;
    chatBodies?: unknown[];
    msgBodies?: Array<{ code: string; body: unknown }>;
    msgGetQueries?: string[];
    patchBodies?: unknown[];
    journal?: Map<string, JournalRow[]>;
  } = {},
) {
  const journal = opts.journal ?? new Map<string, JournalRow[]>();
  let chatSeq = 0;
  const msgSeq = new Map<string, number>();
  await page.unrouteAll({ behavior: "wait" });
  await page.route("**/api/auth/sign-out*", (r) =>
    r.fulfill(json({}, 200)),
  );
  await page.route("**/api/v1/**", async (r) => {
    const req = r.request();
    const u = new URL(req.url());
    const m = req.method();
    const p = u.pathname;
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
    if (p === "/api/v1/auth/me" && m === "GET")
      return run(ov.me, ok(ME()), "me");
    if (p === "/api/v1/profiles/me" && m === "GET")
      return run(ov.profileGet, ok(PROFILE_ROW), "profileGet");
    if (p === "/api/v1/profiles/me" && m === "PATCH") {
      try {
        opts.patchBodies?.push(req.postDataJSON());
      } catch {
        opts.patchBodies?.push(null);
      }
      return run(ov.profilePatch, ok(PROFILE_ROW), "profilePatch");
    }
    if (p === "/api/v1/llm/status")
      return run(ov.llm, ok(LLM_READY), "llm");
    if (p === "/api/v1/chats" && m === "GET") {
      // listAllChats merges the live leg with the archived leg
      // (session.ts listAllChats): a faithful seed user has nothing
      // archived, so the archived leg defaults empty — otherwise every
      // seed chat double-lists. Archive tests override explicitly.
      if (u.searchParams.get("archived") === "true")
        return run(ov.chatsGet, ok(emptyChats()), "chatsGet");
      const seeds = (opts.seedChats ?? []).map((s) =>
        mkChat(s.code, s.title, s.subject ?? "CN"),
      );
      return run(ov.chatsGet, ok({
        data: seeds,
        pagination: { limit: 50, offset: 0, total: seeds.length },
      }), "chatsGet");
    }
    if (p === "/api/v1/chats" && m === "POST") {
      const fb: Fulfill = (() => {
        chatSeq += 1;
        const posted = req.postDataJSON() as { subject: string; title: string };
        opts.chatBodies?.push(posted);
        const code = `b${String(chatSeq).padStart(5, "0")}`;
        return ok(mkChat(code, posted.title, posted.subject));
      })();
      return run(ov.chatsPost, fb, "chatsPost");
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
      const code = msgMatch[1];
      const fb: Fulfill = (() => {
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
  return { journal };
}

// ---- composer helpers ------------------------------------------------------

async function welcomeReady(page: Page) {
  await page
    .getByText("Ask anything about your course...", { exact: false })
    .first()
    .waitFor({ timeout: 25000 });
}

async function welcomeSend(page: Page, text: string) {
  const box = page.getByRole("combobox", { name: "Message input" });
  await box.click();
  await page.keyboard.type(text, { delay: 10 });
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

const SEED_CODE = "s3cnd1";
const SEED_TITLE = "Seeded thread for Section B";

async function openSeededThread(
  page: Page,
  c: Counters,
  ov: BackendOv = {},
  extra: {
    seedChats?: Array<{ code: string; title: string; subject?: string }>;
    chatBodies?: unknown[];
    msgBodies?: Array<{ code: string; body: unknown }>;
    msgGetQueries?: string[];
    patchBodies?: unknown[];
    journal?: Map<string, JournalRow[]>;
  } = {},
  code = SEED_CODE,
) {
  const seeds = extra.seedChats ?? [{ code, title: SEED_TITLE }];
  const { journal } = await mockBackend(page, c, ov, { ...extra, seedChats: seeds });
  await page.goto(`/subject/CN/${code}`);
  await page
    .getByText("Ask anything about CN...", { exact: false })
    .first()
    .waitFor({ timeout: 25000 });
  return { journal };
}

async function threadSend(page: Page, text: string) {
  const box = page.getByRole("combobox", { name: "Message input" });
  await box.click();
  await page.keyboard.type(text, { delay: 10 });
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

const stopBtn = (page: Page) =>
  page.getByRole("button", { name: "Stop", exact: true });

// Ask-shape (short) answers end with the stable marker below; deep-shape
// ("teach me … in detail") answers carry "chapter view".
const ASK_MARKER = "Quote it first";
const DEEP_MARKER = "chapter view";

async function waitStreamSettled(page: Page) {
  await expect(stopBtn(page)).toHaveCount(0, { timeout: 30000 });
}

// ---- C1 --------------------------------------------------------------------
// Welcome send happy path (also the E1b handoff regression pin: the first
// message must POST, not just memory-paint — ThreadView autoSend waits for
// settled identity before delivering).

test("C1 — welcome send navigates, posts, streams; bodies carry subject + clientMsgKey (D5)", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const chatBodies: unknown[] = [];
  const msgBodies: Array<{ code: string; body: unknown }> = [];
  await mockBackend(page, c, {}, { chatBodies, msgBodies });
  await page.goto("/new");
  await welcomeReady(page);
  // Subject toggle (welcome main — NOT the sidebar workspace button):
  // picking OS scopes the create (plan: OS example).
  await page
    .locator("#astryx-app-shell-main")
    .getByRole("button", { name: "OS", exact: true })
    .click();
  await expect(
    page.getByText("Ask something about OS...", { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  await welcomeSend(page, "explain paging");
  await expect(page).toHaveURL(/\/subject\/OS\/[a-z0-9]{6}/, { timeout: 15000 });
  // Exactly one user turn + one assistant turn (article-scoped — immune
  // to title/echo text collisions).
  const userArticle = page.getByRole("article", { name: "Message from user" });
  await expect(userArticle).toHaveCount(1, { timeout: 25000 });
  await expect(page.getByText("explain paging", { exact: true }).first()).toBeVisible({
    timeout: 25000,
  });
  // Answer streams to completion (caret gone with the Stop button).
  await expect(page.getByText(ASK_MARKER, { exact: false }).first()).toBeVisible({
    timeout: 30000,
  });
  await waitStreamSettled(page);
  // Contract: create carries subject (D5: NO clientAdoptKey on ordinary
  // creates — adopt path only); appends carry clientMsgKey.
  expect(c.chatsPost).toBe(1);
  const created = chatBodies[0] as { subject: string; title: string; clientAdoptKey?: string };
  expect(created.subject).toBe("OS");
  expect(created.title).toContain("explain paging");
  expect(created.clientAdoptKey).toBeUndefined();
  const userPosts = msgBodies.filter(
    (e) => (e.body as { role: string }).role === "user",
  );
  expect(userPosts.length).toBe(1);
  expect((userPosts[0].body as { clientMsgKey?: string }).clientMsgKey).toMatch(
    /^[0-9a-f-]{8,}$/,
  );
  // Assistant persist lands too (user + assistant = 2 message POSTs).
  await expect.poll(() => c.messagesPost, { timeout: 15000 }).toBe(2);
  await expectCleanEnv(errors, true);
});

// ---- C2 --------------------------------------------------------------------

test("C2 — guest welcome send blocked: gate holds, zero chats fetches", async ({
  page,
}) => {
  const errors = await collectErrors(page);
  let chatsHits = 0;
  await page.unrouteAll({ behavior: "wait" });
  await page.route("**/api/v1/chats*", async (r) => {
    chatsHits += 1;
    await r.fulfill(json(emptyChats()));
  });
  await page.goto("/new");
  // Guest truth (smoke.spec.ts): non-closable login gate, no composer.
  await expect(page.getByRole("heading", { name: /log in to continue/i })).toBeVisible({
    timeout: 20000,
  });
  expect(chatsHits).toBe(0);
  await expectCleanEnv(errors);
});

// ---- C3 --------------------------------------------------------------------

test("C3 — keyless authed send blocked with key warning, nothing posted", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await mockBackend(page, c, {
    llm: () => ok({ configured: false, provider: null, keyHint: null, model: null, validatedAt: null }),
  });
  await page.goto("/new");
  await welcomeReady(page);
  await expect(
    page.getByText("Connect your OpenRouter key in Settings to start chatting."),
  ).toBeVisible({ timeout: 15000 });
  await welcomeSend(page, "explain paging");
  // Gate stops the send before create: zero posts, text kept.
  await page.waitForTimeout(1500);
  expect(c.chatsPost).toBe(0);
  expect(c.messagesPost).toBe(0);
  await expect(
    page.getByRole("combobox", { name: "Message input" }),
  ).toContainText("explain paging");
  await expect(page).toHaveURL(/\/new/);
  await expectCleanEnv(errors);
});

// ---- C4 --------------------------------------------------------------------

test("C4 — simulate error renders inline Retry; retry succeeds, single user bubble", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await openSeededThread(page, c);
  const text = "simulate error please";
  await threadSend(page, text);
  // Mid-stream failure bubble with inline Retry (partial text kept above).
  const failedCopy = "This response was interrupted before it finished.";
  await expect(page.getByText(failedCopy).first()).toBeVisible({ timeout: 30000 });
  await waitStreamSettled(page);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  // Rerun succeeds (forceOk) but does NOT pop the failed turn (D9): the
  // retried prompt re-streams its own long-form answer below the failed
  // turn — failed history stays visible. (The stream-failed answer has no
  // "Quote it first" marker; its tail pins the rerun.)
  const retryTail = "we will dig into it together";
  await expect(page.getByText(retryTail, { exact: false }).first()).toBeVisible({
    timeout: 30000,
  });
  await waitStreamSettled(page);
  await expect(page.getByText(failedCopy)).toHaveCount(1);
  // Exactly one user turn, two assistant turns (failed + rerun).
  await expect(page.getByRole("article", { name: "Message from user" })).toHaveCount(1);
  await expect(page.getByRole("article", { name: "Message from assistant" })).toHaveCount(2);
  await expectCleanEnv(errors, true);
});

// ---- C5 --------------------------------------------------------------------

test("C5 — simulate empty says so with Retry; retry escapes with a real answer (B10)", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await openSeededThread(page, c);
  const text = "simulate empty please";
  await threadSend(page, text);
  const emptyCopy = "PESDac returned an empty response.";
  await expect(page.getByText(emptyCopy).first()).toBeVisible({ timeout: 30000 });
  await waitStreamSettled(page);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  // B10 fixed: forceOk plans the REAL answer instead of replaying the
  // contentless intent — the rerun streams normally below the empty
  // block (D9: no pop), and no second empty block ever lands.
  await expect(page.getByText(ASK_MARKER, { exact: false }).first()).toBeVisible({
    timeout: 30000,
  });
  await waitStreamSettled(page);
  await expect(page.getByText(emptyCopy)).toHaveCount(1);
  // Exactly one user turn, two assistant turns (empty + real answer).
  await expect(page.getByRole("article", { name: "Message from user" })).toHaveCount(1);
  await expect(page.getByRole("article", { name: "Message from assistant" })).toHaveCount(2);
  await expectCleanEnv(errors, true);
});

// ---- C6 --------------------------------------------------------------------

test("C6 — simulate limit shows rate pill; Retry resumes with a real answer (B10)", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await openSeededThread(page, c);
  await threadSend(page, "simulate limit please");
  // No optimistic assistant block — the composer-level rate pill instead.
  const pill = "Too many requests — wait a few seconds, then retry.";
  await expect(page.getByText(pill).first()).toBeVisible({ timeout: 15000 });
  // The pills-row Retry is the only Retry on screen (no error bubble).
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  // B10 fixed: the forceOk rerun plans the REAL answer — the pill
  // clears and a normal turn streams (exactly one user bubble, no
  // empty block).
  await expect(page.getByText(pill)).toHaveCount(0, { timeout: 15000 });
  await expect(page.getByText(ASK_MARKER, { exact: false }).first()).toBeVisible({
    timeout: 30000,
  });
  await waitStreamSettled(page);
  await expect(page.getByRole("article", { name: "Message from user" })).toHaveCount(1);
  await expectCleanEnv(errors, true);
});

// ---- C7 --------------------------------------------------------------------

test("C7 — simulate tool error renders honestly, retry offered, no fake cover", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await openSeededThread(page, c);
  await threadSend(page, "simulate tool error please");
  // Failed tool call rendered as failed (not covered by a fake answer)…
  await expect(page.getByText("Search timed out after 8s").first()).toBeVisible({
    timeout: 30000,
  });
  // …with the honest scope note in the answer body…
  await expect(
    page.getByText(/the textbook search failed this time/).first(),
  ).toBeVisible({ timeout: 30000 });
  await waitStreamSettled(page);
  // …and a rerun offered beside the assistant copy action.
  await expect(
    page.getByRole("button", { name: "Regenerate response" }),
  ).toBeVisible();
  await expectCleanEnv(errors, true);
});

// ---- C8 --------------------------------------------------------------------

test("C8 — Stop mid-stream halts, partial persists as interrupted turn, reload keeps it", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const journal = new Map<string, JournalRow[]>();
  await openSeededThread(page, c, {}, { journal });
  await threadSend(page, "teach me TCP in detail please");
  // Stop inside the stream window (deep answers settle tools ~850ms
  // then pace 80ms/word — stopping ~2.5s in keeps a meaty partial with
  // plenty of stream left, so a ghost continuation would be visible).
  await expect(stopBtn(page)).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2500);
  await stopBtn(page).click();
  await expect(stopBtn(page)).toHaveCount(0, { timeout: 15000 });
  // Partial text persists as an INTERRUPTED turn (B11 fixed: failed
  // error block — "This response was interrupted before it finished."
  // + Retry), never as a normal turn. Article-scoped: one user turn,
  // one assistant turn holding the stopped partial (wherever the 80ms
  // pacing happened to cut it — no heading assumption).
  const asstArticle = page.getByRole("article", { name: "Message from assistant" });
  await expect(asstArticle).toHaveCount(1, { timeout: 15000 });
  expect(((await asstArticle.first().innerText()) ?? "").length).toBeGreaterThan(20);
  await expect(
    page.getByText("This response was interrupted before it finished.").first(),
  ).toBeVisible({ timeout: 15000 });
  // No ghost continuation: message POSTs settle, then freeze for 5s.
  await expect.poll(() => c.messagesPost, { timeout: 15000 }).toBeGreaterThanOrEqual(2);
  const frozen = c.messagesPost;
  await page.waitForTimeout(5000);
  expect(c.messagesPost).toBe(frozen);
  // Reload: the server journal (user + stopped partial) repaints the turn.
  await page.reload();
  await page
    .getByText("Ask anything about CN...", { exact: false })
    .first()
    .waitFor({ timeout: 25000 });
  await expect(page.getByRole("article", { name: "Message from user" })).toHaveCount(1, {
    timeout: 25000,
  });
  await expect(page.getByRole("article", { name: "Message from assistant" })).toHaveCount(1, {
    timeout: 25000,
  });
  // The journal (what the server kept at stop-time) repaints verbatim:
  // first rendered line of the persisted partial must be visible.
  const keptMd =
    (journal.get(SEED_CODE) ?? []).find((r) => r.role === "assistant")
      ?.content as { bubbles?: Array<{ md?: string }> } | undefined;
  const firstLine = (keptMd?.bubbles?.[0]?.md ?? "").split("\n")[0].replace(/^###\s*/, "");
  expect(firstLine.length).toBeGreaterThan(10);
  await expect(page.getByText(firstLine.slice(0, 40), { exact: false }).first()).toBeVisible({
    timeout: 25000,
  });
  // The interrupted marker survives reload with the turn (failed error
  // block persists; retryText recomputes at render).
  await expect(
    page.getByText("This response was interrupted before it finished.").first(),
  ).toBeVisible({ timeout: 25000 });
  await expectCleanEnv(errors, true);
});

//   D11 (C12): an in-flight (client-simulated) stream does not survive
//     reload — the server only owns persisted turns, and the assistant
//     turn persists at finalize. Reload mid-stream restores exactly one
//     Q and no A (no duplication, no resurrection). Backend SSE will own
//     resumability later; the test pins actual.
//   D12 (C13): semantic context ("refer back to turn 2") is unprovable
//     with the stateless mockup responder (answers echo the current
//     question only). C13 proves the structural half: 20 turns post,
//     stream, persist, and reload with dense seqs and no gaps/dupes.
//   D13 (C15, fixed B13): the thread depth toggle persists the GLOBAL
//     default (profile depth) — reload keeps the last choice instead of
//     resetting to Auto. Per-thread override still lives for the session
//     in composerMode; the toggle writes both.

// ---- C9 --------------------------------------------------------------------
// Edit lives on trailing session user turns only (D7) — the rate-limit
// path leaves the user turn last with no assistant block started.

test("C9 — Edit prefills, resend replaces; Esc restores byte-identical (D7)", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const journal = new Map<string, JournalRow[]>();
  await openSeededThread(page, c, {}, { journal });
  const userArticle = page.getByRole("article", { name: "Message from user" });
  // Leg 1: send → rate pill (user turn trailing) → Edit → resend edited.
  await threadSend(page, "simulate limit please");
  await expect(
    page.getByText("Too many requests — wait a few seconds, then retry."),
  ).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Edit message" }).click();
  const banner = "Editing message — Send applies it to this turn, Esc cancels.";
  await expect(page.getByText(banner).first()).toBeVisible({ timeout: 10000 });
  const box = page.getByRole("combobox", { name: "Message input" });
  await expect(box).toContainText("simulate limit please");
  await box.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("explain TCP", { delay: 10 });
  await page.getByRole("button", { name: "Send", exact: true }).click();
  // Edited question streams its answer; exactly one user turn survives.
  await expect(page.getByText(ASK_MARKER, { exact: false }).first()).toBeVisible({
    timeout: 30000,
  });
  await waitStreamSettled(page);
  await expect(page.getByText(banner)).toHaveCount(0);
  await expect(userArticle).toHaveCount(1);
  await expect(page.getByText("explain TCP", { exact: true }).first()).toBeVisible();
  // Leg 2: another limited send → Edit → Esc cancels losslessly.
  await threadSend(page, "simulate limit again please");
  await expect(
    page.getByText("Too many requests — wait a few seconds, then retry."),
  ).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Edit message" }).last().click();
  await expect(page.getByText(banner).first()).toBeVisible({ timeout: 10000 });
  await page.keyboard.press("Escape");
  await expect(page.getByText(banner)).toHaveCount(0);
  // Bubble text restored byte-identical (overlay truncates on send only).
  const bubbles = await userArticle.allInnerTexts();
  expect(bubbles.some((t) => t.includes("simulate limit again please"))).toBe(true);
  await expectCleanEnv(errors, true);
});

// ---- C10 -------------------------------------------------------------------

test("C10 — Regenerate pops the last answer, reruns, never duplicates the question", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await openSeededThread(page, c);
  await threadSend(page, "explain UDP");
  await expect(page.getByText(ASK_MARKER, { exact: false }).first()).toBeVisible({
    timeout: 30000,
  });
  await waitStreamSettled(page);
  const postsBefore = c.messagesPost;
  const deletesBefore = c.messagesDelete;
  await page.getByRole("button", { name: "Regenerate response" }).click();
  // Rerun streams (Stop shows mid-rerun) and settles to exactly one
  // user turn + one assistant turn — the popped answer is replaced.
  await expect(stopBtn(page)).toBeVisible({ timeout: 15000 });
  await waitStreamSettled(page);
  await expect(page.getByRole("article", { name: "Message from user" })).toHaveCount(1);
  await expect(page.getByRole("article", { name: "Message from assistant" })).toHaveCount(1);
  await expect(page.getByText(ASK_MARKER, { exact: false }).first()).toBeVisible({
    timeout: 15000,
  });
  // Backed regenerate truncates server-side first, then re-persists.
  expect(c.messagesDelete).toBeGreaterThan(deletesBefore);
  expect(c.messagesPost).toBeGreaterThan(postsBefore);
  await expectCleanEnv(errors, true);
});

// ---- C11 -------------------------------------------------------------------

test("C11 — double-Enter and triple-click Send post exactly one user message each", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const msgBodies: Array<{ code: string; body: unknown }> = [];
  await openSeededThread(page, c, {}, { msgBodies });
  const userPosts = () =>
    msgBodies.filter((e) => (e.body as { role: string }).role === "user").length;
  // Double-Enter: the first submit clears synchronously, the second lands
  // on an empty box and no-ops.
  const box = page.getByRole("combobox", { name: "Message input" });
  await box.click();
  await page.keyboard.type("first double enter probe", { delay: 10 });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("article", { name: "Message from user" })).toHaveCount(1, {
    timeout: 25000,
  });
  await waitStreamSettled(page);
  expect(userPosts()).toBe(1);
  // Triple-click Send: same single-append guarantee.
  await box.click();
  await page.keyboard.type("triple click probe", { delay: 10 });
  const send = page.getByRole("button", { name: "Send", exact: true });
  await send.click();
  // The first click clears synchronously, disabling Send while empty:
  // forced extra clicks dispatch at a disabled control and must fire no
  // handler (the empty-submit guard would no-op them anyway).
  await send.click({ force: true });
  await send.click({ force: true });
  await expect(page.getByRole("article", { name: "Message from user" })).toHaveCount(2, {
    timeout: 25000,
  });
  await waitStreamSettled(page);
  expect(userPosts()).toBe(2);
  await expectCleanEnv(errors, true);
});

// ---- C12 -------------------------------------------------------------------

test("C12 — reload mid-stream keeps exactly one Q, never duplicates (D11)", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const journal = new Map<string, JournalRow[]>();
  await openSeededThread(page, c, {}, { journal });
  await threadSend(page, "teach me UDP in detail please");
  // User leg persists fast; the deep stream runs ~10s — reload inside it.
  await expect.poll(() => c.messagesPost, { timeout: 15000 }).toBeGreaterThanOrEqual(1);
  const postsAtReload = c.messagesPost;
  await page.reload();
  await page
    .getByText("Ask anything about CN...", { exact: false })
    .first()
    .waitFor({ timeout: 25000 });
  // Exactly one Q from the server journal, no duplicate POSTs after load
  // (settled outbox records do not replay), and no resurrected A (D11:
  // the in-flight assistant turn never persisted — nothing to restore).
  await expect(page.getByRole("article", { name: "Message from user" })).toHaveCount(1, {
    timeout: 25000,
  });
  await expect(page.getByRole("article", { name: "Message from assistant" })).toHaveCount(0);
  await page.waitForTimeout(3000);
  expect(c.messagesPost).toBe(postsAtReload);
  expect(postsAtReload).toBe(1);
  await expectCleanEnv(errors, true);
});

// ---- C13 -------------------------------------------------------------------

test("C13 — 20-turn conversation persists dense, reloads gapless (D12)", async ({
  page,
  context,
}) => {
  test.setTimeout(240000);
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const journal = new Map<string, JournalRow[]>();
  const msgGetQueries: string[] = [];
  await openSeededThread(page, c, {}, { journal, msgGetQueries });
  const userArticle = page.getByRole("article", { name: "Message from user" });
  const asstArticle = page.getByRole("article", { name: "Message from assistant" });
  for (let i = 1; i <= 20; i++) {
    const q = i === 20
      ? "turn 20 question about CN, as established in turn 2"
      : `turn ${i} question about CN`;
    await threadSend(page, q);
    await expect(userArticle).toHaveCount(i, { timeout: 25000 });
    await expect(asstArticle).toHaveCount(i, { timeout: 30000 });
  }
  // Turn 20's question text round-trips through its answer (echo — the
  // structural half of "context holds"; semantic memory is unprovable
  // with the stateless responder, D12).
  await expect(page.getByText("as established in turn 2").first()).toBeVisible({
    timeout: 15000,
  });
  // Assistant persist resolves a beat after the final paint — poll.
  await expect.poll(() => c.messagesPost, { timeout: 15000 }).toBe(40);
  // Reload: server rows repaint with no gaps or dupes.
  await page.reload();
  await page
    .getByText("Ask anything about CN...", { exact: false })
    .first()
    .waitFor({ timeout: 25000 });
  await expect(page.getByRole("article", { name: "Message from user" })).toHaveCount(20, {
    timeout: 30000,
  });
  await expect(page.getByRole("article", { name: "Message from assistant" })).toHaveCount(20, {
    timeout: 30000,
  });
  // Server-side density: 40 rows, seqs 1..40, strict user/assistant
  // alternation — nothing dropped, nothing doubled.
  const rows = journal.get(SEED_CODE) ?? [];
  expect(rows.length).toBe(40);
  expect(rows.map((r) => r.seq)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
  expect(rows.map((r) => r.role)).toEqual(
    Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? "user" : "assistant")),
  );
  // History windowing legs fire as designed (bare read; 40 rows fit, so
  // no tail slice needed).
  expect(msgGetQueries.length).toBeGreaterThanOrEqual(1);
  await expectCleanEnv(errors, true);
});

// ---- C14 -------------------------------------------------------------------

test("C14 — follow-up pill click sends as the next user message", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await openSeededThread(page, c);
  await threadSend(page, "explain subnets");
  await expect(page.getByText(ASK_MARKER, { exact: false }).first()).toBeVisible({
    timeout: 30000,
  });
  await waitStreamSettled(page);
  // Pill row offers the turn's follow-ups; clicking one sends it.
  const pill = page.getByRole("button", { name: "Walk me through it step by step" });
  await expect(pill).toBeVisible({ timeout: 15000 });
  await pill.click();
  await expect(page.getByRole("article", { name: "Message from user" })).toHaveCount(2, {
    timeout: 25000,
  });
  await expect(page.getByRole("article", { name: "Message from assistant" })).toHaveCount(2, {
    timeout: 30000,
  });
  await expectCleanEnv(errors, true);
});

// ---- C15 -------------------------------------------------------------------

test("C15 — welcome Math routes the subject; thread depth choice persists across reload (B13)", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const chatBodies: unknown[] = [];
  await mockBackend(page, c, {}, { chatBodies });
  await page.goto("/new");
  await welcomeReady(page);
  // Welcome half: mode menu Auto → Math scopes the create to Math.
  await page
    .locator("#astryx-app-shell-main")
    .getByRole("button", { name: "Auto", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Math" }).click();
  await welcomeSend(page, "explain integrals");
  await expect(page).toHaveURL(/\/subject\/Math\/[a-z0-9]{6}/, { timeout: 15000 });
  expect((chatBodies[0] as { subject: string }).subject).toBe("Math");
  // Thread half: depth menu Auto → Deep Study applies to this turn.
  const modeBtn = page.getByRole("button", { name: "Auto", exact: true });
  await expect(modeBtn).toBeVisible({ timeout: 25000 });
  await modeBtn.click();
  await page.getByRole("menuitem", { name: "Deep Study" }).click();
  await expect(page.getByRole("button", { name: "Deep Study", exact: true })).toBeVisible({
    timeout: 10000,
  });
  await threadSend(page, "explain ARP");
  await expect(page.getByText(DEEP_MARKER, { exact: false }).first()).toBeVisible({
    timeout: 30000,
  });
  await waitStreamSettled(page);
  // B13 fixed: the toggle persists the global default — reload keeps
  // Deep Study instead of resetting to Auto.
  await page.reload();
  await page
    .getByText("Ask anything about Math...", { exact: false })
    .first()
    .waitFor({ timeout: 25000 });
  await expect(page.getByRole("button", { name: "Deep Study", exact: true })).toBeVisible({
    timeout: 15000,
  });
  await expectCleanEnv(errors, true);
});

// ---- C16 -------------------------------------------------------------------

test("C16 — @ menu opens, selects by keyboard, Esc closes; send scopes retrieval", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await openSeededThread(page, c);
  const box = page.getByRole("combobox", { name: "Message input" });
  // Esc leg: menu opens on @, Esc closes it, the @ stays put.
  await box.click();
  await page.keyboard.type("@", { delay: 20 });
  const textbookOpt = page.getByRole("option", { name: /Textbook/ });
  await expect(textbookOpt.first()).toBeVisible({ timeout: 15000 });
  await page.keyboard.press("Escape");
  await expect(textbookOpt).toHaveCount(0, { timeout: 10000 });
  // Select leg: @ → ArrowDown → Enter inserts the reference chip…
  await box.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("@", { delay: 20 });
  await expect(page.getByRole("option", { name: /Textbook/ }).first()).toBeVisible({
    timeout: 15000,
  });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(box).toContainText("Textbook", { timeout: 10000 });
  // …and sending with the chip scopes retrieval to the textbook.
  await page.keyboard.type(" explain subnets", { delay: 10 });
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(ASK_MARKER, { exact: false }).first()).toBeVisible({
    timeout: 30000,
  });
  await waitStreamSettled(page);
  await expect(page.getByText(/CN textbook/).first()).toBeVisible({ timeout: 15000 });
  await expectCleanEnv(errors, true);
});

//   D14 (C20, fixed B16): feedback votes persist in localStorage
//     (pesdac-feedback-v1) — reload KEEPS the active vote. Matches the
//     plan's "survives reload".
//     Active state has no accessible name — proven via the accent icon
//     color, with a no-crash fallback if the theme ever equates them.
//   D15 (C18, fixed B14): Find-Esc closes the panel AND returns focus
//     to the composer (closeFind restores composer focus). Matches the
//     plan; keyboard users keep their place.

// ---- C17 -------------------------------------------------------------------

test("C17 — dictation denied signals with copy, composer keeps working (B18)", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  // Headless Chromium ships no SpeechRecognition at all, so the vendor
  // would return before any error exists. Fault-inject one that denies
  // (init script, before mount so the vendor's isSupported latches true):
  // the fake fires the real denial shape, the vendor forwards it to our
  // onError, and B18's denial toast must appear.
  await page.addInitScript(() => {
    class DeniedRecognition {
      lang = "";
      continuous = false;
      interimResults = false;
      onstart: ((e: { error: string }) => void) | null = null;
      onend: ((e: { error: string }) => void) | null = null;
      onerror: ((e: { error: string }) => void) | null = null;
      onresult: ((e: { error: string }) => void) | null = null;
      start() {
        queueMicrotask(() => this.onerror?.({ error: "not-allowed" }));
      }
      stop() {}
      abort() {}
    }
    (window as unknown as Record<string, unknown>).SpeechRecognition =
      DeniedRecognition;
  });
  await openSeededThread(page, c);
  await page.getByRole("button", { name: "Start dictation" }).click();
  await expect(
    page.getByText("Microphone is blocked", { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: "Start dictation" })).toBeVisible();
  await threadSend(page, "explain TCP");
  await expect(page.getByText(ASK_MARKER, { exact: false }).first()).toBeVisible({
    timeout: 30000,
  });
  await waitStreamSettled(page);
  await expectCleanEnv(errors, true);
});

// ---- C18 -------------------------------------------------------------------

test("C18 — thread Find counts, steps, No matches, Esc returns focus", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await openSeededThread(page, c);
  await threadSend(page, "explain TCP");
  await expect(page.getByText(ASK_MARKER, { exact: false }).first()).toBeVisible({
    timeout: 30000,
  });
  await waitStreamSettled(page);
  await threadSend(page, "explain UDP");
  await expect(page.getByText(ASK_MARKER, { exact: false }).nth(1)).toBeVisible({
    timeout: 30000,
  });
  await waitStreamSettled(page);
  // Find the word present in turn 1 (user bubble + answer echo = 2 hits).
  await page.getByRole("button", { name: "Find in thread" }).click();
  const findBox = page.getByPlaceholder("Find in thread...");
  await expect(findBox).toBeVisible({ timeout: 10000 });
  await findBox.fill("TCP");
  await expect(page.getByText("1 of 2").first()).toBeVisible({ timeout: 10000 });
  await page.keyboard.press("Enter");
  await expect(page.getByText("2 of 2").first()).toBeVisible({ timeout: 10000 });
  // Gibberish → No matches.
  await findBox.fill("zzzqqqxxx");
  await expect(page.getByText("No matches").first()).toBeVisible({ timeout: 10000 });
  // Esc closes the panel…
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-find-panel]")).toHaveCount(0, { timeout: 10000 });
  // …and focus returns to the composer (B14 fixed: closeFind restores
  // composer focus so keyboard users keep their place).
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  expect(focused).toBe("Message input");
  await expectCleanEnv(errors, true);
});

// ---- C19 -------------------------------------------------------------------

test("C19 — Copy transcript fills the clipboard, confirms inline + toast (B15)", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const c = newCounters();
  await openSeededThread(page, c);
  const q = "explain paged segmentation";
  await threadSend(page, q);
  await expect(page.getByText(ASK_MARKER, { exact: false }).first()).toBeVisible({
    timeout: 30000,
  });
  await waitStreamSettled(page);
  await page.getByRole("button", { name: "Conversation actions" }).click();
  await page.getByRole("menuitem", { name: "Copy transcript" }).click();
  // B15: an info toast is the visible confirmation (the menu closes on
  // select, so the inline flip alone is never seen).
  await expect(
    page.getByText("Transcript copied to clipboard.", { exact: false }).first(),
  ).toBeVisible({ timeout: 10000 });
  // Clipboard holds the full Q/A text (primary proof)…
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain(q);
  expect(clip).toContain("Quote it first");
  // …and the menu item confirms inline on reopen (D8: "Copied!" flip,
  // 1500ms window — reopen immediately).
  await page.getByRole("button", { name: "Conversation actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Copied!" })).toBeVisible({
    timeout: 5000,
  });
  await expectCleanEnv(errors, true);
});

// ---- C20 -------------------------------------------------------------------

test("C20 — feedback votes persist locally; reload keeps the vote (B16)", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await openSeededThread(page, c);
  await threadSend(page, "explain TCP");
  await expect(page.getByText(ASK_MARKER, { exact: false }).first()).toBeVisible({
    timeout: 30000,
  });
  await waitStreamSettled(page);
  const up = page.getByRole("button", { name: "Good response" });
  const iconColor = () =>
    up.locator("svg").first().evaluate((el) => getComputedStyle(el).color);
  const before = await iconColor();
  const snap = { ...c };
  await up.click();
  const after = await iconColor();
  // Active vote repaints the icon accent (accessible-name-free state).
  expect(after).not.toBe(before);
  // …and never touches the network (localStorage map, guests included).
  await page.waitForTimeout(1000);
  expect(c).toEqual(snap);
  // B16 fixed: votes persist — reload keeps the active vote.
  await page.reload();
  await page
    .getByText("Ask anything about CN...", { exact: false })
    .first()
    .waitFor({ timeout: 25000 });
  const reloaded = await page
    .getByRole("button", { name: "Good response" })
    .first()
    .locator("svg")
    .first()
    .evaluate((el) => getComputedStyle(el).color);
  expect(reloaded).toBe(after);
  // Toggle clears without complaint.
  await page.getByRole("button", { name: "Good response" }).first().click();
  const cleared = await page
    .getByRole("button", { name: "Good response" })
    .first()
    .locator("svg")
    .first()
    .evaluate((el) => getComputedStyle(el).color);
  expect(cleared).toBe(before);
  await expectCleanEnv(errors, true);
});

// ---- C21 -------------------------------------------------------------------

test("C21 — onboarding save PATCHes only its fields, closes, unlocks welcome", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const patchBodies: unknown[] = [];
  await mockBackend(
    page,
    c,
    {
      me: () => ok(ME({ onboardingDone: false })),
      profileGet: () =>
        ok({ institution: "", semester: "", branch: "", subjects: [], campus: "", onboardingDone: false }),
    },
    { patchBodies },
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
  // Save PATCHes exactly its fields + the completion flag, then the
  // required dialog closes and the welcome composer goes live.
  await expect(dialog).toBeHidden({ timeout: 15000 });
  expect(c.profilePatch).toBe(1);
  const body = patchBodies[0] as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(
    ["branch", "campus", "onboardingDone", "semester", "subjects"].sort(),
  );
  expect(body).toMatchObject({
    // Short codes, not labels (profile-options values).
    campus: "RR",
    semester: "3",
    branch: "CSE(Core)",
    onboardingDone: true,
  });
  expect(body.subjects as unknown[]).toHaveLength(5);
  await welcomeReady(page);
  await expectCleanEnv(errors);
});

// ---- C22 -------------------------------------------------------------------

test("C22 — onboarding save 500-once errors, retry succeeds (attempts===2)", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await mockBackend(
    page,
    c,
    {
      me: () => ok(ME({ onboardingDone: false })),
      profileGet: () =>
        ok({ institution: "", semester: "", branch: "", subjects: [], campus: "", onboardingDone: false }),
      profilePatch: (n) =>
        n === 1
          ? { status: 500, body: errBody("INTERNAL", "boom") }
          : ok(PROFILE_ROW),
    },
    {},
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
  // 5xx is NOT auto-retried (closed retry set — unit-proven in
  // onboarding-retry.test.ts): the dialog stays open with the mapped 5xx
  // copy (the toUserMessage mapping wins over the "Couldn't save"
  // fallback)…
  await dialog.getByRole("button", { name: "Start studying" }).click();
  await expect(
    dialog.getByText("That didn't work on our end. Please try again later."),
  ).toBeVisible({ timeout: 15000 });
  // …and the user-initiated retry lands the second attempt.
  await dialog.getByRole("button", { name: "Start studying" }).click();
  await expect(dialog).toBeHidden({ timeout: 15000 });
  expect(c.profilePatch).toBe(2);
  await welcomeReady(page);
  await expectCleanEnv(errors);
});

// ---- C23 -------------------------------------------------------------------

test("C23 — stream completes exactly once: caret + Stop retire, no second append", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await openSeededThread(page, c);
  await threadSend(page, "explain DNS");
  // Mid-stream: caret streams inside the assistant bubble, Stop shows.
  await expect(page.getByText(/▍/).first()).toBeVisible({ timeout: 15000 });
  await expect(stopBtn(page)).toBeVisible({ timeout: 5000 });
  await waitStreamSettled(page);
  // Settled: caret removed, Stop hidden…
  await expect(page.getByText(/▍/)).toHaveCount(0, { timeout: 10000 });
  await expect(stopBtn(page)).toHaveCount(0);
  // …and no second append after 3s idle (single finalizeTurn).
  const frozen = c.messagesPost;
  expect(frozen).toBe(2);
  await page.waitForTimeout(3000);
  expect(c.messagesPost).toBe(frozen);
  await expectCleanEnv(errors, true);
});

// ---- C24 -------------------------------------------------------------------

test("C24 — welcome shows the composer skeleton until ready, never a dead input", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const slow = async <T>(ms: number, v: T): Promise<T> => {
    await new Promise((r) => setTimeout(r, ms));
    return v;
  };
  await mockBackend(page, c, {
    me: () => slow(2000, ok(ME())),
    profileGet: () => slow(2000, ok(PROFILE_ROW)),
  });
  await page.goto("/new");
  // Skeleton (not a dead composer) while identity resolves…
  await expect(page.getByLabel("Loading composer")).toBeVisible({ timeout: 15000 });
  expect(await page.getByRole("combobox", { name: "Message input" }).count()).toBe(0);
  // …then the live composer — and it actually sends.
  await welcomeReady(page);
  await welcomeSend(page, "explain paging");
  await expect(page).toHaveURL(/\/subject\/CN\/[a-z0-9]{6}/, { timeout: 15000 });
  await expectCleanEnv(errors, true);
});

// ---- C25 -------------------------------------------------------------------

test("C25 — thread composer stays disabled over the history skeleton", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  await mockBackend(
    page,
    c,
    {
      messagesGet: async () => {
        await new Promise((r) => setTimeout(r, 2000));
        return ok(emptyChats());
      },
    },
    { seedChats: [{ code: SEED_CODE, title: SEED_TITLE }] },
  );
  await page.goto(`/subject/CN/${SEED_CODE}`);
  // History skeleton announces busy; Send is disabled (no queued ghost).
  await expect(page.getByLabel("Loading chat history")).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled({
    timeout: 10000,
  });
  expect(c.messagesPost).toBe(0);
  // Load lands → skeleton out, composer live (empty composer keeps Send
  // disabled by design — type to prove the input itself is live).
  await expect(page.getByLabel("Loading chat history")).toHaveCount(0, { timeout: 15000 });
  const liveBox = page.getByRole("combobox", { name: "Message input" });
  await liveBox.click();
  await page.keyboard.type("composer is live", { delay: 10 });
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled({
    timeout: 15000,
  });
  await expectCleanEnv(errors, true);
});

// ---- C26 -------------------------------------------------------------------

test("C26 — draft survives in-memory nav, gone after reload (memory-only by design)", async ({
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
        { code: "dr4f71", title: "Draft chat Alpha" },
        { code: "dr4f72", title: "Draft chat Beta" },
      ],
    },
    "dr4f71",
  );
  const box = page.getByRole("combobox", { name: "Message input" });
  await box.click();
  await page.keyboard.type("half a thought", { delay: 10 });
  await page.waitForTimeout(600); // past the 400ms draft debounce
  // Away to the sibling chat and back — no reload.
  await page.getByRole("link", { name: "Draft chat Beta" }).click();
  await expect(page).toHaveURL(/\/subject\/CN\/dr4f72/, { timeout: 15000 });
  await page.getByRole("link", { name: "Draft chat Alpha" }).click();
  await expect(page).toHaveURL(/\/subject\/CN\/dr4f71/, { timeout: 15000 });
  await expect(page.getByRole("combobox", { name: "Message input" })).toContainText(
    "half a thought",
  );
  // Reload: memory-only drafts are gone (pins documented behavior —
  // catches accidental "persistence" regressions).
  await page.reload();
  await page
    .getByText("Ask anything about CN...", { exact: false })
    .first()
    .waitFor({ timeout: 25000 });
  await expect(page.getByRole("combobox", { name: "Message input" })).toBeEmpty();
  await expectCleanEnv(errors, true);
});

