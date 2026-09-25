// Section A — forced backend errors [mock], Phase 1 backend-down subset.
//
// Guest truth (pinned by smoke.spec.ts): guests on app routes get the
// NON-CLOSABLE login gate, so there is no guest composer to drive. Guest
// chat paths are memory-only with zero fetches (session.ts: hydrateChats
// returns {status:"guest"} before any fetch when chatAuth == null;
// createChatBacked returns null before any fetch). Phase 1 therefore
// proves the guest shapes: forced 500/abort/garbage/empty on every
// /api/v1/* leg leaves the gate honest, the app interactive, and zero
// pageerror/console.error.
//
// Authed shapes (E3-E9, E12, E14-E15, E17-E20, E22 + full E1/E2/E10/E11)
// need a staging session (seed password user) and stay test.fixme —
// never faked. When staging lands, each fixme becomes a real test using
// the H-MOCK flip (fail→success, attempt===2) and the copy strings cited.
//
// Copy strings cited are verified in-tree:
// - create: "Couldn't create that chat. Try again." (session.ts:1146)
// - conn: "Couldn't reach the server. Check your connection and try again." (api/errors.ts:68)
// - 5xx: "That didn't work on our end. Please try again later." (api/errors.ts:61)
// - 404: "That didn't work. Please try again later." (api/errors.ts:58)
// - rate: "Too many requests — wait a few seconds, then retry." (ThreadView.tsx:1171)
// - expiry: "Your session expired. Please log in again." (Pesdac.tsx:827)
// - profile: "Couldn't load your profile" + "Try again" (OnboardingDialog.tsx:222,231)
// - llm: "Connect your OpenRouter key in Settings to start chatting." (Pesdac.tsx:2156)

import { test, expect, type Page } from "@playwright/test";

async function collectErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  return errors;
}

async function expectClean(errors: string[]) {
  expect(errors, `expected zero page/console errors, got:\n${errors.join("\n")}`).toEqual([]);
}

async function expectGate(page: Page) {
  await expect(page.getByRole("heading", { name: /log in to continue/i })).toBeVisible({
    timeout: 20_000,
  });
}

const CHATS = "**/api/v1/chats*";
const CHATS_EXACT = "**/api/v1/chats";
const AUTH_APIS = "**/api/auth/**";

test("E1-guest — create-chat 500 fires zero POSTs, gate holds", async ({ page }) => {
  const errors = await collectErrors(page);
  let posts = 0;
  // Register BEFORE goto; exactly one terminal action (fulfill).
  await page.route(CHATS_EXACT, async (r) => {
    if (r.request().method() === "POST") posts += 1;
    await r.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "INTERNAL", message: "boom" } }),
    });
  });
  await page.goto("/new");
  await expectGate(page);
  // Guest shape: no composer to drive (gate non-closable), so the proof
  // is zero POSTs + honest gate + clean console. Full E1 (authed welcome
  // "Couldn't create that chat. Try again.", text preserved, Send
  // re-enabled, flip-to-200 retry) runs in Phase 2.
  expect(posts).toBe(0);
  await expectClean(errors);
  await page.unroute(CHATS_EXACT);
});

test("E2-guest — create-chat transport drop fires zero POSTs, app interactive", async ({ page }) => {
  const errors = await collectErrors(page);
  let posts = 0;
  await page.route(CHATS_EXACT, async (r) => {
    if (r.request().method() === "POST") posts += 1;
    await r.abort("connectionreset");
  });
  await page.goto("/new");
  await expectGate(page);
  // Offline copy ("Couldn't reach the server…") belongs to the authed
  // send path (api/errors.ts TypeError branch); guests must see no toast
  // storm and stay interactive — gate buttons navigate.
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page).toHaveURL(/\/login/);
  expect(posts).toBe(0);
  await expectClean(errors);
  await page.unroute(CHATS_EXACT);
});

test("E10-guest — 200 with garbage body never whitescreens", async ({ page }) => {
  const errors = await collectErrors(page);
  let gets = 0;
  await page.route(CHATS, async (r) => {
    if (r.request().method() === "GET") gets += 1;
    await r.fulfill({ status: 200, contentType: "application/json", body: "not json{{{ " });
  });
  await page.goto("/new");
  await expectGate(page);
  // Guest never GETs the list (memory-only), so garbage can't parse-fail
  // here; the bar is no white screen + clean console. Authed parse-failure
  // UI ("That didn't work on our end…", never raw) runs in Phase 2.
  expect(gets).toBe(0);
  await expectClean(errors);
  await page.unroute(CHATS);
});

test("E11-guest — empty chat list renders gate cleanly", async ({ page }) => {
  const errors = await collectErrors(page);
  await page.route(CHATS, async (r) => {
    await r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [], pagination: { limit: 50, offset: 0, total: 0 } }),
    });
  });
  await page.goto("/new");
  await expectGate(page);
  await expectClean(errors);
  await page.unroute(CHATS);
});

test("E13a-guest — auth endpoints down degrades to guest honestly", async ({ page }) => {
  const errors = await collectErrors(page);
  // Block BetterAuth only; backend untouched. SSR tag already proves guest
  // (no cookie → null tag → instant guest, no 800ms wait), so the gate
  // must open with no spinner-forever and no crash.
  await page.route(AUTH_APIS, async (r) => {
    await r.abort("failed");
  });
  await page.goto("/new");
  await expectGate(page);
  // Our own abort makes the browser log the failed resource load itself —
  // environmental noise (same class as smoke's 404-navigation exception),
  // not an app error. Everything else must be silent.
  const appErrors = errors.filter((e) => !e.includes("Failed to load resource"));
  await expectClean(appErrors);
  await page.unroute(AUTH_APIS);
});

test("E13b-guest — backend down keeps guest memory-only with zero fetches", async ({ page }) => {
  const errors = await collectErrors(page);
  let apiCalls = 0;
  await page.route("**/api/v1/**", async (r) => {
    apiCalls += 1;
    await r.abort("failed");
  });
  await page.goto("/new");
  await expectGate(page);
  expect(apiCalls).toBe(0);
  await expectClean(errors);
  await page.unroute("**/api/v1/**");
});

test("E16-guest — 503 without Retry-After causes no retry storm", async ({ page }) => {
  const errors = await collectErrors(page);
  let gets = 0;
  await page.route(CHATS, async (r) => {
    if (r.request().method() === "GET") gets += 1;
    await r.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "UNAVAILABLE", message: "down" } }),
    });
  });
  await page.goto("/new");
  await expectGate(page);
  // No auto-retry without Retry-After (apiFetch only retries chat-write
  // 429s with a bounded wait); guests fire zero GETs so gets===0 doubles
  // as the no-storm proof. Authed 5xx copy ("That didn't work on our
  // end…") + manual retry runs in Phase 2.
  expect(gets).toBe(0);
  await expectClean(errors);
  await page.unroute(CHATS);
});

test("E21-guest — CORS-misconfig shape stays a clean gate, never a crash", async ({ page }) => {
  const errors = await collectErrors(page);
  // Fulfill the preflight without ACAO headers: any request the app DID
  // fire would fail as connectivity ("Couldn't reach…"). Guests fire
  // none, so the bar is gate + clean console — documents graceful shape.
  await page.route("**/api/v1/**", async (r) => {
    if (r.request().method() === "OPTIONS") {
      await r.fulfill({ status: 204, body: "" });
      return;
    }
    await r.continue();
  });
  await page.goto("/new");
  await expectGate(page);
  await expectClean(errors);
  await page.unroute("**/api/v1/**");
});

// --- Phase 2 (staging) — full authed shapes, kept as fixme until a seed user exists ---

test.fixme("E1 — authed create-chat 500 shows error, preserves text, retry succeeds", async () => {
  // Needs: authed context on /new. POST /api/v1/chats → 500
  // {error:{code,message}}; type "explain TCP" → Send. Expect welcome
  // status "Couldn't create that chat. Try again.", typed text preserved,
  // Send re-enabled; unroute flip → 200 → retry succeeds (attempt===2).
});

test.fixme("E2 — authed create-chat abort shows offline copy, stays interactive", async () => {
  // Same as E1 but route.abort('connectionreset'). Expect "Couldn't reach
  // the server. Check your connection and try again." (NOT the 5xx copy),
  // app interactive, no hang.
});

test.fixme("E3 — message append 429 short Retry-After boundedly retries once", async () => {
  // POST /api/v1/chats/*/messages → 429 + Retry-After: 2. Send in open
  // thread. Expect "Too many requests — wait a few seconds, then retry."
  // pill, exactly one bounded auto-retry, exactly one message copy.
});

test.fixme("E4 — message append 429 long Retry-After never auto-retries", async () => {
  // Same endpoint → 429 + Retry-After: 30 (over the ≤5s honor cap).
  // Expect NO auto-retry, manual Retry offered, pill explains the wait.
});

test.fixme("E5 — history 500 then 200 retry proof (attempt===2)", async () => {
  // GET /api/v1/chats/*/messages* → 500 on attempt 1, 200 real-shape on
  // 2+ (counter in handler). Open thread → error state → Try again →
  // messages load, handler ran twice.
});

test.fixme("E6 — session dies mid-chat (401) locks composer, silent toast path", async () => {
  // Authed in thread; GET /api/v1/auth/me → 401 from now on; Send.
  // Expect "Your session expired. Please log in again.", composer locked,
  // no toast storm (401 path silent by design).
});

test.fixme("E7 — profile load 500 on boot shows retry, never dead-ends", async () => {
  // Fresh context, GET /api/v1/profiles/me → 500; log in. Expect
  // onboarding "Couldn't load your profile" + Try again; flip to 200 →
  // form appears.
});

test.fixme("E8 — token mint timeout retries once then surfaces AuthServiceError", async () => {
  // GET */api/auth/token → never responds; trigger authed call. Expect one
  // retry after the 8s mint timeout, then surfaced AuthServiceError — never
  // an infinite loop. Generous test timeout (slow by nature).
});

test.fixme("E9 — LLM status 500 blocks sends honestly", async () => {
  // Authed, GET /api/v1/llm/status → 500. Expect "Connect your OpenRouter
  // key…" warning, sends blocked with reason stated — never silently
  // swallowed.
});

test.fixme("E10 — authed 200-garbage shows error UI, never white screen", async () => {
  // GET /api/v1/chats → 200 body `not json{{{`. Expect parse failure →
  // error UI, console clean of uncaught.
});

test.fixme("E11 — authed empty chat list renders blank cleanly", async () => {
  // GET /api/v1/chats* → 200 []. Expect sidebar blank (design has no "no
  // chats" copy — verify blank, no crash, skeletons clear).
});

test.fixme("E12 — delete-account partial failure still drops local identity", async () => {
  // DELETE /api/v1/users/me → 200 but BetterAuth deleteUser → 500 via
  // */api/auth/*. Expect backend-first ordering: local heap fully dropped,
  // lands on guest gate, no half-logged ghost.
});

test.fixme("E14 — foreign chat 403/404 renders honest error, zero data", async () => {
  // GET /api/v1/chats/XXXX/messages → 403 (rerun 404); goto
  // /subject/os/XXXX. Expect honest error, zero foreign bytes rendered.
});

test.fixme("E15 — 400 + 422 map to friendly copy, form state kept", async () => {
  // POST /api/v1/chats → 400 {error:{code:'BAD_REQUEST'}}; rerun 422 field
  // errors. Expect user-friendly copy (never raw codes), form kept.
});

test.fixme("E17 — export 500 keeps dialog open, no partial file", async () => {
  // GET /api/v1/users/me/export → 500; Profile → Export. Expect calm
  // failure notice, dialog stays open, no corrupt partial file saved.
});

test.fixme("E18 — link-password 429 after 5 attempts honors cooldown", async () => {
  // Needs Google-only seed user. POST /api/link-password → 429 +
  // Retry-After after 5 attempts (mirror link-password-server.test.ts).
  // Expect 429 honored, cooldown explained, no resubmit bypass.
});

test.fixme("E19 — profile PATCH 429 disables save honestly", async () => {
  // PATCH /api/v1/profiles/me → 429 (60/60s bucket). Expect save disabled
  // with reason or queued honestly — never a silent drop.
});

test.fixme("E20 — slow writes show pending, block double-submit", async () => {
  // Delay ONLY POST|PATCH|DELETE **/api/v1/** by 2s. Expect pending
  // affordances on mutating controls, reads snappy, no double-submit.
});

test.fixme("E22 — token mint 500 fast-fails bounded (contrasts E8 slow)", async () => {
  // GET */api/auth/token → 500 immediately. Expect single retry, then
  // surfaced error — both E8 (slow) and E22 (fast) bounded.
});
