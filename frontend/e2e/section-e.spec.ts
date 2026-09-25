// Section E — offline & slow network [mock] + [cdp] with a real
// BetterAuth session (seed users in Neon) + mocked FastAPI.
// Hermetic sessions: every cookie test mints its own session FIRST
// (ensureSeed, ~4s) — the shared seed row dies whenever any suite
// really logs out (T54/O15 doctrine; F's campaign murdered it once).
// Same base harness as section-d (one router per test after
// `unrouteAll`, counters asserted after, server journal + meta,
// mutable offline flag with abort-shaped legs — the same TypeError
// the browser raises on a dead network, per E21) plus:
// - IDB seeding (DB "pesdac-outbox", store "ops") for overflow /
//   create-before-append proofs,
// - a request listener (not legs) for create-vs-append order,
// - real CDP Slow-3G for O6, real recordHar/routeFromHAR for O9.
//
// Vendor/app facts pinned while implementing (cited, not guessed):
// - The app NEVER reads navigator.onLine (zero hits in src); offline
//   == fetch-failure taxonomy (outbox-queue.ts classifyOutboxError).
//   `context.setOffline(true)` kills even the doc nav
//   (net::ERR_INTERNET_DISCONNECTED — probed), so full-offline shape
//   is flags-abort on every write leg; boot reads stay mocked
//   ("cached") except O9, which replays a real HAR truly offline.
// - Pill copy (ThreadView.tsx): "N unsynced — will send
//   automatically when online." + " M oldest dropped (outbox full)."
//   + " K failed and won't retry until reload." No banner exists.
// - Live-send failure rolls back the paint, toasts the toUserMessage
//   copy for the failure kind (B47 — offline legs read the connection
//   copy, 500s read the 5xx copy), queues the op durably (R14 shape).
// - Reconnected flush repaints when a sync error is showing (B26):
//   the drain forces a messages reload, so delivered turns paint and
//   the successful load clears the error itself (B28 — no stale sync
//   error, and the pill suffixes surface instead of hiding beneath
//   it, B29). O2 is the proof. Flushes
//   with no error showing (O3's reload-offline shape) still need a
//   reload to repaint — documented residual, not a false signal.
// - failed-fatal ops skip every worker flush until reload rebuilds
//   the record-less queue (the only UI-exposed manual path).
// - orderOutboxOps: createdAt first, then create-chat before
//   append-message on ties (unit-pinned; O2b is the browser proof).
// - MAX_OUTBOX_OPS=200 (enforceCap on enqueue), MAX_OUTBOX_ATTEMPTS=5
//   (fatal when attempts>5, i.e. after the 6th failed flush round),
//   30s scheduler (OUTBOX_FLUSH_INTERVAL_MS) + online/focus events.
// - Skeletons: "Loading chats" (sidebar), "Loading composer"
//   (welcome), "Loading chat history" (thread) — aria-labels.
// - route.fulfill bypasses CDP throttling, so O6 pairs a real
//   Slow-3G transport (bundle bytes genuinely throttled — probed
//   5.4s goto) with delayed boot legs to hold skeletons observably.
// - recordHar CAPTURES route.fulfill responses and routeFromHAR +
//   setOffline(true) replays them (both probed).
//
// Deviations from browser-break-it-plan.md (evidence over text):
//   D30 (all): flags-abort legs instead of context.setOffline —
//     setOffline bricks the doc nav under interception; the abort
//     shape is byte-identical at the fetch layer (TypeError).
//   D31 (O3): reload-offline keeps boot reads mocked — boot-failure
//     UI is uncharted; O3 proves the outbox half (IndexedDB survival
//     + boot-kick replay), O9 proves the truly-offline boot half.
//   D32 (O6): throttle + delayed legs (see above) — fulfill alone
//     would make the throttle unobservable on API calls.
//   D33 (O9): HAR recorded with the mocked backend (deterministic)
//     and committed at e2e/hars/o9.har.

import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import * as fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TEMP = "C:\\Users\\anubh\\AppData\\Local\\Temp\\opencode";
const ROOT = "C:\\Anubhav\\Web Dev Projects\\PESDac";
const PASS_COOKIES = `${TEMP}\\seed-cookies.json`;
const O9_HAR = "e2e/hars/o9.har";

// Hermetic sessions: the shared seed row dies whenever any suite
// really logs out (F's A10/A14 murdered it mid-campaign — 8/10 red
// with zero code change). Mint fresh per cookie test (~4s), same
// T54/O15 doctrine as section-f.
async function ensureSeed() {
  await execFileAsync("npx.cmd", ["tsx", "seed-e2e.local.mts"], {
    cwd: ROOT,
    timeout: 60000,
    shell: true,
  });
}

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

const OFFLINE_SEND_COPY = "Couldn't reach the server";
const unsyncedCopy = (n: number) =>
  `${n} unsynced — will send automatically when online.`;
const EVICT_COPY = "1 oldest dropped (outbox full).";
const FATAL_COPY = "1 failed and won't retry until reload.";

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
    email: "e2e.sectione@example.com",
    displayName: "E2E SectionE",
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
  journalSeed?: Array<{ code: string; rows: JournalRow[] }>;
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
  const flags = opts.flags ?? { offline: false };
  const tokenMode = opts.tokenMode ?? { mode: "ok" as const };
  const updateUserUp = opts.updateUserUp ?? { up: true };
  let chatSeq = 0;
  const msgSeq = new Map<string, number>();
  for (const [code, rows] of journal) msgSeq.set(code, rows.length);
  await target.unrouteAll({ behavior: "wait" });
  await target.route("**/api/auth/sign-out*", (r) =>
    r.fulfill(json({}, 200)),
  );
  await target.route("**/api/auth/update-user*", (r) =>
    updateUserUp.up
      ? r.fulfill(json({ status: true }, 200))
      : r.abort("connectionreset"),
  );
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
    try {
      if (req.headers()["authorization"]?.startsWith("Bearer ")) c.authed += 1;
    } catch {
      // Header read is best-effort; counts below carry the proof.
    }
    // Fallback is a THUNK (lazy): IIFE fallbacks mutate meta/journal,
    // so they must run ONLY when no leg overrides — otherwise failure
    // legs would still apply the success side effects (bitten in O5).
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
      return run(ov.me, () => ok(ME()), "me");
    if (p === "/api/v1/profiles/me" && m === "GET")
      return run(ov.profileGet, () => ok(profileRow), "profileGet");
    if (p === "/api/v1/profiles/me" && m === "PATCH") {
      if (flags.offline) return run(ov.profilePatch, offlineAbort, "profilePatch");
      try {
        const posted = req.postDataJSON() as Record<string, unknown>;
        opts.patchBodies?.push(posted);
        Object.assign(profileRow, posted);
      } catch {
        opts.patchBodies?.push(null);
      }
      return run(ov.profilePatch, () => ok(profileRow), "profilePatch");
    }
    if (p === "/api/v1/llm/status")
      return run(ov.llm, () => ok(LLM_READY), "llm");
    if (p === "/api/v1/users/me/export" && m === "GET") {
      if (flags.offline) return run(ov.exportGet, offlineAbort, "exportGet");
      return run(ov.exportGet, () => ok({ exportedAt: iso(), chats: [] }), "exportGet");
    }
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
        opts.chatBodies?.push(posted);
        const code = `e${String(chatSeq).padStart(5, "0")}`;
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
    if (p === "/api/v1/chats" && m === "DELETE") {
      if (flags.offline) return run(ov.chatsDelete, offlineAbort, "chatsDelete");
      const fb = (): Fulfill => {
        const n = meta.size;
        meta.clear();
        journal.clear();
        return ok({
          data: { deleted: n },
          pagination: { limit: 50, offset: 0, total: 0 },
        });
      };
      return run(ov.chatsDelete, fb, "chatsDelete");
    }
    const chatMatch = p.match(/^\/api\/v1\/chats\/([^/]+)$/);
    if (chatMatch && m === "PATCH") {
      if (flags.offline) return run(ov.chatPatch, offlineAbort, "chatPatch");
      const fb = (): Fulfill => {
        const row = meta.get(chatMatch[1]);
        if (!row) return { status: 404, body: errBody("NOT_FOUND", "nope") };
        const posted = req.postDataJSON() as Partial<ChatMeta>;
        opts.chatPatchBodies?.push({ code: chatMatch[1], body: posted });
        Object.assign(row, posted, { updatedAt: iso() });
        return ok(metaRow(row));
      };
      return run(ov.chatPatch, fb, "chatPatch");
    }
    if (chatMatch && m === "DELETE") {
      const fb = (): Fulfill => {
        if (!meta.has(chatMatch[1]))
          return { status: 404, body: errBody("NOT_FOUND", "nope") };
        meta.delete(chatMatch[1]);
        journal.delete(chatMatch[1]);
        opts.chatDeletes?.push(chatMatch[1]);
        return { status: 204, body: {} };
      };
      return run(ov.chatDelete, fb, "chatDelete");
    }
    const msgMatch = p.match(/^\/api\/v1\/chats\/([^/]+)\/messages/);
    if (msgMatch && m === "GET") {
      const code = msgMatch[1];
      opts.msgGetQueries?.push(new URL(req.url()).search);
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
    if (msgMatch && m === "DELETE") {
      const code = msgMatch[1];
      const fb = (): Fulfill => {
        const fromSeq = Number(new URL(req.url()).searchParams.get("from_seq") ?? "0");
        const kept = (journal.get(code) ?? []).filter((row) => row.seq < fromSeq);
        const deleted = (journal.get(code) ?? []).length - kept.length;
        journal.set(code, kept);
        return ok({
          data: { deleted },
          pagination: { limit: 50, offset: 0, total: kept.length },
        });
      };
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

const composerBox = (page: Page) =>
  page.getByRole("combobox", { name: "Message input" });
const sendBtn = (page: Page) =>
  page.getByRole("button", { name: "Send", exact: true });
const stopBtn = (page: Page) =>
  page.getByRole("button", { name: "Stop", exact: true });
const userArticle = (page: Page) =>
  page.getByRole("article", { name: "Message from user" });

async function threadSend(page: Page, text: string) {
  await composerBox(page).click();
  await page.keyboard.type(text, { delay: 5 });
  await sendBtn(page).click();
}

async function waitStreamSettled(page: Page) {
  await expect(stopBtn(page)).toHaveCount(0, { timeout: 30000 });
}

const onlineKick = () => window.dispatchEvent(new Event("online"));

// Flushes run async with IDB writes per op — polls the counter
// until it stops moving (stable = round fully drained).
async function waitForPostsStable(
  c: Counters,
  timeoutMs = 25000,
): Promise<number> {
  const start = Date.now();
  let last = c.messagesPost;
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000));
    const now = c.messagesPost;
    if (now === last) return now;
    last = now;
    if (Date.now() - start > timeoutMs)
      throw new Error(`messagesPost never stabilized (at ${now})`);
  }
}

// Journal content is a wire Block: user text lives at
// bubbles[0].text (UserBlock), not top-level.
const journalTexts = (rows: JournalRow[]) =>
  rows.map(
    (r) =>
      (
        (r.content as { bubbles?: Array<{ text?: unknown }> })?.bubbles?.[0] as
          | { text?: unknown }
          | undefined
      )?.text,
  );

// Non-intrusive create-vs-append order tape (legs can't delegate to
// the mock fallback, so order is read off request events instead).
function captureApiOrder(page: Page): string[] {
  const seq: string[] = [];
  page.on("request", (r) => {
    try {
      const u = new URL(r.url());
      if (u.hostname !== "localhost") return;
      if (u.pathname === "/api/v1/chats" && r.method() === "POST")
        seq.push("create");
      if (
        /^\/api\/v1\/chats\/[^/]+\/messages$/.test(u.pathname) &&
        r.method() === "POST"
      )
        seq.push("append");
    } catch {
      // Non-URL requests never occur here; ignore defensively.
    }
  });
  return seq;
}

// Direct IndexedDB seeding (DB "pesdac-outbox", store "ops",
// keyPath "id" — outbox-db.ts). Bypasses enqueue/cap on purpose.
async function seedOutbox(page: Page, ops: Array<Record<string, unknown>>) {
  await page.evaluate(
    (rows) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("pesdac-outbox", 1);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("ops", "readwrite");
          const store = tx.objectStore("ops");
          for (const row of rows) store.put(row);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        open.onerror = () => reject(open.error);
      }),
    ops,
  );
}

async function readOutboxIds(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open("pesdac-outbox", 1);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("ops", "readonly");
          const req = tx.objectStore("ops").getAllKeys();
          req.onsuccess = () => {
            db.close();
            resolve((req.result as IDBValidKey[]).map(String));
          };
          req.onerror = () => reject(req.error);
        };
        open.onerror = () => reject(open.error);
      }),
  );
}

// ---- O1 ---------------------------------------------------------------------
// Offline mid-session: the failed send is honest (toast + sync-error
// status, never a banner — none exists by design), and after a
// reload the N-unsynced pill is THE offline signal (the sync error
// is memory-only; the op is IndexedDB-durable). Composer stays
// interactive throughout.

test("O1 — offline send surfaces the unsynced pill, no banner, stays usable", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await ensureSeed();
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const flags = { offline: false };
  const code = "o1aa11";
  await openSeededThread(page, c, code, {}, { flags });
  flags.offline = true;
  await threadSend(page, "o1 hello while offline");
  await expect(
    page.getByText(OFFLINE_SEND_COPY, { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  await expect(userArticle(page)).toHaveCount(0, { timeout: 15000 });
  // Honest failure inline (sync-error status outranks the pill while
  // set — ThreadView status ternary), never a banner.
  await expect(
    page.getByText(OFFLINE_SEND_COPY, { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.locator("[role='banner']")).toHaveCount(0);
  expect(c.messagesPost).toBeGreaterThanOrEqual(1);
  // "Refresh" while offline: the memory-only error is gone, the
  // durable op remains — the pill is THE offline signal now.
  await page.reload();
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
  await expect(
    page.getByText(unsyncedCopy(1), { exact: false }).first(),
  ).toBeVisible({ timeout: 20000 });
  // Still interactive: can compose the next message (not sent here —
  // O2 owns multi-send; typing proves the composer isn't wedged).
  await composerBox(page).click();
  await page.keyboard.type("still here", { delay: 5 });
  await expect(sendBtn(page)).toBeEnabled({ timeout: 15000 });
  await expectCleanEnv(errors, true);
});

// ---- O2 ---------------------------------------------------------------------
// Offline x3 sends then reconnect: FIFO flush order, all acked, zero
// dupes (idempotency keys unique per send); the flush itself repaints
// all three AND clears the sync error (B26/B28 — no reload needed),
// and a reload stays exactly-once.

test("O2 — offline x3 sends reconnect in order, acked once each", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  const errors = await collectErrors(page);
  await ensureSeed();
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const flags = { offline: false };
  const code = "o2bb22";
  const msgBodies: Array<{ code: string; body: unknown }> = [];
  const { journal } = await openSeededThread(
    page,
    c,
    code,
    {},
    { flags, msgBodies },
  );
  const texts = ["o2 first", "o2 second", "o2 third"];
  flags.offline = true;
  for (const t of texts) {
    await threadSend(page, t);
    await expect(
      page.getByText(OFFLINE_SEND_COPY, { exact: false }).first(),
    ).toBeVisible({ timeout: 15000 });
    await expect(userArticle(page)).toHaveCount(0, { timeout: 15000 });
  }
  // While offline the sync-error status outranks the pill (status
  // ternary) — the honest inline copy is what's visible.
  await expect(
    page.getByText(OFFLINE_SEND_COPY, { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  expect(c.messagesPost).toBeGreaterThanOrEqual(3);
  expect(journal.get(code) ?? []).toEqual([]);
  // Reconnect: one online kick drains FIFO.
  flags.offline = false;
  await page.evaluate(onlineKick);
  await expect
    .poll(() => (journal.get(code) ?? []).length, { timeout: 20000 })
    .toBe(3);
  expect(journalTexts(journal.get(code) ?? [])).toEqual(texts);
  expect((journal.get(code) ?? []).map((r) => r.role)).toEqual([
    "user",
    "user",
    "user",
  ]);
  // Server idempotency proof: exactly 3 appends, unique clientMsgKeys
  // in send order.
  expect(msgBodies).toHaveLength(3);
  const keys = msgBodies.map(
    (m) => (m.body as { clientMsgKey?: string }).clientMsgKey,
  );
  expect(new Set(keys).size).toBe(3);
  expect(keys.every((k) => typeof k === "string" && k.length > 0)).toBe(true);
  // B26+B28 (fixed): the drain repaints AND clears the sync error —
  // no reload. Proof is behavioral, not textual: the vendor toasts
  // share the failure copy and outlive the flush, so bare-text absence
  // is unassertable. But three painted
  // articles with no reload in between are only reachable through
  // the drain-triggered reload, whose success exits both delete the
  // sync error (session.ts) — the repaint IS the clearing proof.
  // The pill (unique copy) is asserted absent directly.
  await expect(
    page.getByText("unsynced", { exact: false }),
  ).toHaveCount(0, { timeout: 15000 });
  await expect(userArticle(page)).toHaveCount(3, { timeout: 20000 });
  for (const t of texts) {
    await expect(
      userArticle(page).getByText(t, { exact: false }).first(),
    ).toBeVisible({ timeout: 15000 });
  }
  // Reload stays exactly-once (idempotent repaint, stale error stays
  // gone with it).
  await page.reload();
  await page
    .getByText("Ask anything about CN...", { exact: false })
    .first()
    .waitFor({ timeout: 25000 });
  await expect(userArticle(page)).toHaveCount(3, { timeout: 15000 });
  for (const t of texts) {
    await expect(
      userArticle(page).getByText(t, { exact: false }).first(),
    ).toBeVisible({ timeout: 15000 });
  }
  await expectCleanEnv(errors, true);
});

// ---- O2b --------------------------------------------------------------------
// Creates drain before their chat's appends: seed one create-chat op
// + one append op with EQUAL createdAt (isolates the kind tiebreak
// from FIFO) and tape the wire order.

test("O2b — seeded create + append drain create-first", async ({
  page,
  context,
}) => {
  const errors = await collectErrors(page);
  await ensureSeed();
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const code = "o2cc33";
  const { journal, meta } = await openSeededThread(page, c, code);
  const order = captureApiOrder(page);
  const now = Date.now();
  await seedOutbox(page, [
    {
      id: "o2b-create-1",
      chatCode: code,
      kind: "create-chat",
      clientKey: "o2b-create-1",
      payload: { subject: "CN", title: "O2b seeded create" },
      createdAt: now,
      attempts: 0,
    },
    {
      id: "o2b-append-1",
      chatCode: code,
      kind: "append-message",
      clientKey: "o2b-append-1",
      payload: { role: "user", content: "o2b seeded append" },
      createdAt: now,
      attempts: 0,
    },
  ]);
  await page.evaluate(onlineKick);
  await expect
    .poll(() => (journal.get(code) ?? []).length, { timeout: 20000 })
    .toBe(1);
  expect(order).toEqual(["create", "append"]);
  // Seeded payloads bypass blockToMessage — raw string survives.
  expect((journal.get(code) ?? [])[0].content).toBe("o2b seeded append");
  expect(meta.size).toBe(2);
  await expectCleanEnv(errors, true);
});

// ---- O3 ---------------------------------------------------------------------
// Offline reload: 2 queued sends survive in IndexedDB (pill still
// counts 2 after boot, boot-kick replay fails honestly while
// offline), reconnect delivers both FIFO, reload repaints (D28).

test("O3 — offline reload keeps 2 queued ops, reconnect replays FIFO", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  const errors = await collectErrors(page);
  await ensureSeed();
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const flags = { offline: false };
  const code = "o3dd33";
  const { journal } = await openSeededThread(page, c, code, {}, { flags });
  flags.offline = true;
  for (const t of ["o3 one", "o3 two"]) {
    await threadSend(page, t);
    await expect(
      page.getByText(OFFLINE_SEND_COPY, { exact: false }).first(),
    ).toBeVisible({ timeout: 15000 });
    await expect(userArticle(page)).toHaveCount(0, { timeout: 15000 });
  }
  // Reload while still offline (boot reads mocked; writes abort):
  // the ops survive in IndexedDB and the boot kick replays+fails
  // honestly — pill still counts 2.
  await page.reload();
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
  await expect(
    page.getByText(unsyncedCopy(2), { exact: false }).first(),
  ).toBeVisible({ timeout: 20000 });
  expect(journal.get(code) ?? []).toEqual([]);
  // Reconnect: both replay FIFO, pill clears.
  flags.offline = false;
  await page.evaluate(onlineKick);
  await expect
    .poll(() => (journal.get(code) ?? []).length, { timeout: 20000 })
    .toBe(2);
  expect(journalTexts(journal.get(code) ?? [])).toEqual([
    "o3 one",
    "o3 two",
  ]);
  await expect(
    page.getByText("unsynced", { exact: false }),
  ).toHaveCount(0, { timeout: 15000 });
  await page.reload();
  await page
    .getByText("Ask anything about CN...", { exact: false })
    .first()
    .waitFor({ timeout: 25000 });
  await expect(userArticle(page)).toHaveCount(2, { timeout: 15000 });
  await expectCleanEnv(errors, true);
});

// ---- O4 ---------------------------------------------------------------------
// Outbox overflow: 200 seeded ops + 1 live offline send = 201th op
// evicts the oldest (enforceCap on enqueue). The eviction suffix is
// only observable once the sync error clears (status ternary) — a
// second send ONLINE lands directly, clears the error, and leaves
// the pill (total still 200, evicted still 1 — both memory-live, no
// reload in between since reload wipes evictedCount).

test("O4 — 201st op evicts oldest, pill says so, newest 200 kept", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const errors = await collectErrors(page);
  await ensureSeed();
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const flags = { offline: true };
  const code = "o4aa11";
  await openSeededThread(page, c, code, {}, { flags });
  const base = Date.now();
  const seeds: Array<Record<string, unknown>> = [];
  for (let i = 0; i < 200; i++) {
    seeds.push({
      id: `o4seed-${i}`,
      chatCode: code,
      kind: "append-message",
      clientKey: `o4key-${i}`,
      payload: { role: "user", content: `seed op ${i}` },
      createdAt: base + i,
      attempts: 0,
    });
  }
  await seedOutbox(page, seeds);
  // The 201st op (live offline send) triggers enforceCap on enqueue.
  await threadSend(page, "o4 live message");
  await expect(
    page.getByText(OFFLINE_SEND_COPY, { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  // Drain-gate: send#1's kick flushes 200 ops with an IDB write each
  // and runs seconds. Flipping online mid-flush would let the tail
  // deliver and move the pill under us — wait for full drain first
  // (1 live + 200 flush attempts).
  const drained = await waitForPostsStable(c);
  expect(drained).toBeGreaterThanOrEqual(201);
  // Reconnect + one live ONLINE send: lands directly (not queued),
  // clears the sync error — pill + eviction suffix surface. Uses the
  // empty trigger (instant error block, no stream) to stay well clear
  // of the 30s scheduler, which would drain the queue and move the
  // pill under us.
  flags.offline = false;
  await threadSend(page, "simulate empty o4");
  // No stream on the empty path — the user-block persist succeeding
  // is what clears the sync error.
  await expect(
    page.getByText(unsyncedCopy(200), { exact: false }).first(),
  ).toBeVisible({ timeout: 20000 });
  await expect(
    page.getByText(EVICT_COPY, { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  const ids = await readOutboxIds(page);
  expect(ids).toHaveLength(200);
  expect(ids).not.toContain("o4seed-0");
  expect(ids).toContain("o4seed-199");
  await expectCleanEnv(errors, true);
});

// ---- O5 ---------------------------------------------------------------------
// Op exhausts attempts: every append 500s. After the 6th failed
// flush round (attempts>MAX_OUTBOX_ATTEMPTS=5) the op settles
// failed-fatal. The fatal suffix needs the sync error cleared
// first (status ternary) — a live ONLINE send lands directly and
// clears it while the fatal record stays memory-settled. Further
// kicks don't resend; reload (the only UI-exposed manual path)
// revives it.

test("O5 — attempts exhausted go failed-fatal, reload revives", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const errors = await collectErrors(page);
  await ensureSeed();
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const code = "o5ee55";
  let postMode: "fail500" | "ok" = "fail500";
  const { journal } = await openSeededThread(
    page,
    c,
    code,
    {
      messagesPost: (_n, req) => {
        if (postMode === "fail500")
          return { status: 500, body: errBody("SERVER_FAIL", "boom") };
        // ok path mirrors the mock fallback (journal append) — legs
        // can't delegate to it, so the shape is replicated here.
        const u = new URL(req.url());
        const mcode = u.pathname.split("/")[4];
        const posted = req.postDataJSON() as {
          role: string;
          content: unknown;
        };
        const rows = journal.get(mcode) ?? [];
        const row: JournalRow = {
          id: `m${rows.length + 1}`,
          seq: rows.length + 1,
          role: posted.role,
          content: posted.content,
          createdAt: iso(),
        };
        journal.set(mcode, [...rows, row]);
        return ok(row);
      },
    },
    {},
  );
  await threadSend(page, "o5 doomed");
  // Live 500 fails honestly: paint rolls back, op queued durably.
  await expect(userArticle(page)).toHaveCount(0, { timeout: 15000 });
  expect(journal.get(code) ?? []).toEqual([]);
  // Kick flush rounds until the op settles fatal (6 failed rounds —
  // live-send isn't a round; attempts increment per flush only).
  // Kick-until-count, not fixed 8×800ms: flushes coalesce under load
  // (flushInFlight guard in outbox.ts) so fixed kicks under-attempt
  // on slow full-run machines (count assert flaked). Then THREE
  // extra rounds unconditionally: the fatal record paints on flush
  // announcements, so stopping the instant the count hits 6 leaves
  // the UI stale (no suffix — deterministic fail). The trailing
  // rounds also give the in-flight 6th attempt's 500 + fatal settle
  // room to land before postMode flips (flipping instantly can
  // deliver it in "ok" mode — never fatal).
  let i = 0;
  for (; i < 16 && c.messagesPost < 6; i++) {
    await page.evaluate(onlineKick);
    await page.waitForTimeout(800);
  }
  for (let j = 0; j < 3; j++) {
    await page.evaluate(onlineKick);
    await page.waitForTimeout(800);
  }
  // Bounded, not infinite: live attempt + failed rounds, then stop.
  expect(c.messagesPost).toBeGreaterThanOrEqual(6);
  // Clear the sync error with a live ONLINE send (lands directly,
  // fatal record stays settled) so the fatal suffix surfaces.
  postMode = "ok";
  await threadSend(page, "o5 alive again");
  await waitStreamSettled(page);
  await expect(
    page.getByText(FATAL_COPY, { exact: false }).first(),
  ).toBeVisible({ timeout: 20000 });
  await expect(
    page.getByText(unsyncedCopy(1), { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  // Settled fatal: further kicks don't resend (frozen counter).
  // (Journal holds only the direct live send — the doomed op is
  // still queued, never delivered.)
  const frozen = c.messagesPost;
  await page.evaluate(onlineKick);
  await page.waitForTimeout(2000);
  expect(c.messagesPost).toBe(frozen);
  expect(journalTexts(journal.get(code) ?? [])).toEqual([
    "o5 alive again",
  ]);
  // Reload rebuilds the record-less queue: the op revives and lands.
  // (Send#2's streamed answer persists as an assistant row too, so
  // the journal holds 3 rows — poll for the revival, not the count.)
  await page.reload();
  await page
    .getByText("Ask anything about CN...", { exact: false })
    .first()
    .waitFor({ timeout: 25000 });
  await expect
    .poll(() => journalTexts(journal.get(code) ?? []), { timeout: 20000 })
    .toContain("o5 doomed");
  const revived = journal.get(code) ?? [];
  expect(revived).toHaveLength(3);
  expect(journalTexts(revived)[0]).toBe("o5 alive again");
  expect(journalTexts(revived)[2]).toBe("o5 doomed");
  await expect(
    page.getByText("unsynced", { exact: false }),
  ).toHaveCount(0, { timeout: 15000 });
  // No error shows at revival time (memory-only errors died with the
  // reload), so no drain-repaint fires — the reload shows it.
  await page.reload();
  await page
    .getByText("Ask anything about CN...", { exact: false })
    .first()
    .waitFor({ timeout: 25000 });
  await expect(userArticle(page)).toHaveCount(2, { timeout: 15000 });
  await expect(
    userArticle(page).getByText("o5 doomed", { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    userArticle(page).getByText("o5 alive again", { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  await expectCleanEnv(errors, true);
});

// ---- O6 ---------------------------------------------------------------------
// Slow-3G full load [cdp]: real transport throttle (bundle bytes
// genuinely slowed — probed) + delayed boot legs hold the skeletons
// observably. Skeletons → content on /new and on a thread.

test("O6 — slow-3G cold load shows skeletons then content", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const errors = await collectErrors(page);
  await ensureSeed();
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 400,
    downloadThroughput: 50 * 1024,
    uploadThroughput: 50 * 1024,
    connectionType: "cellular3g",
  });
  // Node-side sleep (never page.waitForTimeout): a test-scoped timer
  // inside a route handler throws "Test ended" if a late refetch
  // outlives the test body.
  const slow = async (ms: number, v: Fulfill): Promise<Fulfill> => {
    await new Promise((r) => setTimeout(r, ms));
    return v;
  };
  const code = "o6ff66";
  const { journal } = await mockBackend(
    page,
    c,
    {
      me: () => slow(1500, ok(ME())),
      profileGet: () => slow(1500, ok({ ...DEFAULT_PROFILE_ROW })),
    },
    { seedChats: [{ code, title: "O6 thread" }] },
  );
  void journal;
  await page.goto("/new");
  // Skeleton observable while the slow boot legs hang…
  await expect(
    page.getByLabel("Loading composer"),
  ).toBeVisible({ timeout: 30000 });
  // …then the live composer (generous: signal, not flake).
  await expect
    .poll(
      async () => composerBox(page).getAttribute("contenteditable"),
      { timeout: 90000 },
    )
    .toBe("true");
  // Thread half: slow history holds its loader, then settles.
  await mockBackend(
    page,
    c,
    {
      messagesGet: () =>
        slow(
          2500,
          ok({
            data: [],
            pagination: { limit: 50, offset: 0, total: 0 },
          }),
        ),
    },
    { seedChats: [{ code, title: "O6 thread" }] },
  );
  await page.goto(`/subject/CN/${code}`);
  await expect(
    page.getByLabel("Loading chat history"),
  ).toBeVisible({ timeout: 30000 });
  await page
    .getByText("Ask anything about CN...", { exact: false })
    .first()
    .waitFor({ timeout: 90000 });
  await expect
    .poll(
      async () => composerBox(page).getAttribute("contenteditable"),
      { timeout: 90000 },
    )
    .toBe("true");
  // Late refetches (interval revalidation) may still be inside a
  // delayed leg at teardown — drop routes quietly first.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await expectCleanEnv(errors, true);
});

// ---- O7 ---------------------------------------------------------------------
// Slow chats-list only: 1.5s+ on GET /chats, everything else live.
// Sidebar skeleton observable, rest interactive meanwhile. The
// skeleton needs a planted snapshot: first-timers get zero skeleton
// rows by design (Pesdac snapshot rule), so phase 1 boots fast to
// plant it and phase 2 reloads slow.

test("O7 — slow chats list shows sidebar skeleton, rest interactive", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const errors = await collectErrors(page);
  await ensureSeed();
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const code = "o7gg77";
  const seeds = [{ code, title: "O7 thread" }];
  // Phase 1 (fast): baseline + plant the sidebar snapshot.
  await mockBackend(page, c, {}, { seedChats: seeds });
  await page.goto("/new");
  await expect
    .poll(
      async () => composerBox(page).getAttribute("contenteditable"),
      { timeout: 25000 },
    )
    .toBe("true");
  await expect(
    page.getByRole("link", { name: "O7 thread" }),
  ).toBeVisible({ timeout: 15000 });
  // Phase 2: reload with ONLY the chats list slow.
  await mockBackend(
    page,
    c,
    {
      chatsGet: async (_n, req) => {
        await new Promise((r) => setTimeout(r, 2500));
        // Mirror the mock fallback's archived filter — the sidebar
        // fetches both views and an unfiltered leg double-renders.
        const archived = new URL(req.url()).searchParams.get("archived") === "true";
        return ok({
          data: archived
            ? []
            : [
                {
                  code,
                  title: "O7 thread",
                  subject: "CN",
                  isPinned: false,
                  isArchived: false,
                  createdAt: iso(),
                  updatedAt: iso(),
                },
              ],
          pagination: { limit: 50, offset: 0, total: archived ? 0 : 1 },
        });
      },
    },
    { seedChats: seeds },
  );
  await page.reload();
  await expect(page.getByLabel("Loading chats")).toBeVisible({
    timeout: 15000,
  });
  // Rest interactive WHILE the skeleton shows: composer already live
  // (user legs instant — only the list hangs).
  await expect
    .poll(
      async () => composerBox(page).getAttribute("contenteditable"),
      { timeout: 15000 },
    )
    .toBe("true");
  // Skeleton clears into the real row.
  await expect(page.getByLabel("Loading chats")).toHaveCount(0, {
    timeout: 15000,
  });
  await expect(
    page.getByRole("link", { name: "O7 thread" }),
  ).toBeVisible({ timeout: 15000 });
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await expectCleanEnv(errors, true);
});

// ---- O8 ---------------------------------------------------------------------
// 35s offline scheduler: queued op sits while offline; the 30s
// interval auto-flushes (attempt counter moves with NO manual kick);
// reconnect delivers without any manual retry.

test("O8 — 30s scheduler auto-flushes the queued op, reconnect delivers", async ({
  page,
  context,
}) => {
  test.setTimeout(150000);
  const errors = await collectErrors(page);
  await ensureSeed();
  await addSession(context, PASS_COOKIES);
  const c = newCounters();
  const flags = { offline: false };
  const code = "o8hh88";
  const { journal } = await openSeededThread(page, c, code, {}, { flags });
  flags.offline = true;
  await threadSend(page, "o8 scheduled");
  await expect(
    page.getByText(OFFLINE_SEND_COPY, { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  await expect(userArticle(page)).toHaveCount(0, { timeout: 15000 });
  const afterSend = c.messagesPost;
  expect(afterSend).toBeGreaterThanOrEqual(1);
  // Wait out the 30s scheduler with zero manual kicks: the attempt
  // counter must move on its own (auto-flush while still offline).
  await expect
    .poll(() => c.messagesPost, { timeout: 45000 })
    .toBeGreaterThan(afterSend);
  expect(journal.get(code) ?? []).toEqual([]);
  // While offline the sync-error status outranks the pill — the
  // honest inline copy is what's visible (O1 shape).
  await expect(
    page.getByText(OFFLINE_SEND_COPY, { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  // Reconnect: online event delivers, no manual retry of the op.
  flags.offline = false;
  await page.evaluate(onlineKick);
  await expect
    .poll(() => (journal.get(code) ?? []).length, { timeout: 20000 })
    .toBe(1);
  await expect(
    page.getByText("unsynced", { exact: false }),
  ).toHaveCount(0, { timeout: 15000 });
  await page.reload();
  await page
    .getByText("Ask anything about CN...", { exact: false })
    .first()
    .waitFor({ timeout: 25000 });
  await expect(userArticle(page)).toHaveCount(1, { timeout: 15000 });
  await expectCleanEnv(errors, true);
});

// ---- O9 ---------------------------------------------------------------------
// HAR replay, truly offline: record the mocked flow once (update),
// then replay with notFound:'abort' + setOffline(true). Renders from
// the archive — proves zero hidden live dependencies.

test("O9 — recorded HAR replays the app truly offline", async ({
  browser,
}) => {
  test.setTimeout(150000);
  fs.mkdirSync("e2e/hars", { recursive: true });
  // Record (mocked backend = deterministic archive).
  const rec = await browser.newContext({
    recordHar: { path: O9_HAR, update: true },
  });
  try {
    await ensureSeed();
    await addSession(rec, PASS_COOKIES);
    const c = newCounters();
    const code = "o9ii99";
    await mockBackend(
      rec,
      c,
      {},
      {
        seedChats: [{ code, title: "O9 thread" }],
        journalSeed: [
          {
            code,
            rows: [
              // Wire-Block shape (messageToBlock fails closed on raw
              // strings — a seeded string row would render nothing).
              // TWO rows: the archive's single canonical messagesGet
              // must already hold both (routeFromHAR serves the first
              // duplicate recording, never advances — proven below).
              {
                id: "o9r1",
                seq: 1,
                role: "user",
                content: {
                  from: "user",
                  bubbles: [{ type: "text", text: "o9 seeded q" }],
                },
                createdAt: iso(),
              },
              {
                id: "o9r2",
                seq: 2,
                role: "user",
                content: {
                  from: "user",
                  bubbles: [{ type: "text", text: "o9 seeded q2" }],
                },
                createdAt: iso(),
              },
            ],
          },
        ],
      },
    );
    const p = await rec.newPage();
    const errors = await collectErrors(p);
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
    await p.goto(`/subject/CN/${code}`);
    await expect(
      p.getByRole("article", { name: "Message from user" }),
    ).toHaveCount(2, { timeout: 25000 });
    await threadSend(p, "o9 drill");
    await waitStreamSettled(p);
    // Settle-gate: turn persists are void-fired (user + assistant
    // appends) — reloading the instant the caret clears can cut them
    // in flight and flake the archive. The counter is the only
    // synchronous witness: 2 appends, then quiet.
    await expect
      .poll(() => c.messagesPost, { timeout: 15000 })
      .toBeGreaterThanOrEqual(2);
    await waitForPostsStable(c, 15000);
    // Reload so the archive ALSO captures the post-drill shape
    // (harmless duplicate; replay reads the first recording).
    await p.reload();
    await expect(
      p.getByRole("article", { name: "Message from user" }),
    ).toHaveCount(3, { timeout: 25000 });
    await expectCleanEnv(errors, true);
    await p.close();
  } finally {
    await rec.close();
  }
  // Replay: nothing but the archive (aborts prove it) + no network.
  const rep = await browser.newContext();
  try {
    await ensureSeed();
    await addSession(rep, PASS_COOKIES);
    const p = await rep.newPage();
    const errors = await collectErrors(p);
    await p.routeFromHAR(O9_HAR, { notFound: "abort" });
    await rep.setOffline(true);
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
    await p.goto("/subject/CN/o9ii99");
    await expect(
      p.getByRole("article", { name: "Message from user" }),
    ).toHaveCount(2, { timeout: 25000 });
    await expect(
      p
        .getByRole("article", { name: "Message from user" })
        .getByText("o9 seeded q", { exact: false })
        .first(),
    ).toBeVisible({ timeout: 15000 });
    await expectCleanEnv(errors, true);
    await p.close();
  } finally {
    await rep.close();
  }
});
