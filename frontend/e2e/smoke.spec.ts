// Browser smoke net (audit §13 item 3): guest gate, auth-page routing,
// small-viewport gate, the 404 fallback — every test gated on zero
// pageerrors and zero console.errors. Run via `npm run test:e2e`
// (builds with the e2e origin, serves preview, runs this spec).
//
// Product truth this spec pins (spec §A): guests on app routes get the
// NON-CLOSABLE login gate, so there is no guest composer to drive —
// send/stop/retry/attach/keyboard tests need an authenticated staging
// session (BetterAuth credentials + database) and are marked FIXME,
// not faked. Backend staging is not required for what runs here.

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

test("guests on /new get the login gate with zero errors", async ({ page }) => {
  const errors = await collectErrors(page);
  await page.goto("/new");
  await expect(page.getByRole("heading", { name: /log in to continue/i })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("button", { name: /create account/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /^log in$/i })).toBeVisible();
  await expectClean(errors);
});

test("gate routes to login and signup", async ({ page }) => {
  const errors = await collectErrors(page);
  await page.goto("/new");
  await expect(page.getByRole("heading", { name: /log in to continue/i })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/new");
  await expect(page.getByRole("heading", { name: /log in to continue/i })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/signup/);
  await expectClean(errors);
});

test("gate fits a 360px viewport with zero errors", async ({ page }) => {
  const errors = await collectErrors(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/new");
  await expect(page.getByRole("heading", { name: /log in to continue/i })).toBeVisible({
    timeout: 20_000,
  });
  const overflow = await page.evaluate(() => document.scrollingElement?.scrollWidth ?? 0);
  expect(overflow).toBeLessThanOrEqual(360);
  await expectClean(errors);
});

test("unknown route gets the honest 404 fallback", async ({ page }) => {
  const errors = await collectErrors(page);
  const response = await page.goto("/definitely-missing-xyz");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: /page not found/i })).toBeVisible();
  await page.getByRole("link", { name: /fresh chat/i }).click();
  await expect(page).toHaveURL(/\/new/);
  // The browser logs the failed navigation itself — environmental
  // noise, not an app error. Everything else must be silent.
  const appErrors = errors.filter((e) => !e.includes("status of 404"));
  await expectClean(appErrors);
});

test.fixme(
  "authenticated send/stop/retry/keyboard matrix needs a staging session",
  async () => {
    // Requires: preview + FastAPI backend + a seedable BetterAuth user
    // (email/password) to log in with. Until staging exists this matrix
    // (guest/auth send, stop, retry, attach, keyboard-only send, 200%
    // zoom, crash recovery, clear/export/delete flows) cannot run
    // honestly — see the audit §13 item 3 list.
  },
);
