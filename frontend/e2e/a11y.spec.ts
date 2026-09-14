// Accessibility + responsive audit (audit §15 items 1–2): axe-core on
// every public route (the /new run audits WITH the login gate open —
// the exact state guests meet), gate-dialog focus containment, and a
// 200%-zoom overflow check. Serious/critical violations fail the run;
// the full rule table is printed for the audit record.

import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

type Violation = { id: string; impact?: string; nodes: number };

async function audit(page: Page): Promise<Violation[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const violations: Violation[] = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact ?? undefined,
    nodes: v.nodes.length,
  }));
  console.log(`axe: ${results.url} passes=${results.passes.length} violations=${violations.length}`);
  for (const v of violations) console.log(`  axe-violation: ${v.id} impact=${v.impact} nodes=${v.nodes}`);
  return violations;
}

function blocking(violations: Violation[]): Violation[] {
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

test("/new with gate open: no serious axe violations", async ({ page }) => {
  await page.goto("/new");
  await expect(page.getByRole("heading", { name: /log in to continue/i })).toBeVisible({
    timeout: 20_000,
  });
  const violations = await audit(page);
  expect(blocking(violations)).toEqual([]);
});

test("/login: no serious axe violations", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });
  expect(blocking(await audit(page))).toEqual([]);
});

test("/signup: no serious axe violations", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });
  expect(blocking(await audit(page))).toEqual([]);
});

test("404: no serious axe violations", async ({ page }) => {
  await page.goto("/definitely-missing-xyz");
  await expect(page.getByRole("heading", { name: /page not found/i })).toBeVisible();
  expect(blocking(await audit(page))).toEqual([]);
});

test("gate dialog contains focus on open (focus trap entry)", async ({ page }) => {
  await page.goto("/new");
  await expect(page.getByRole("heading", { name: /log in to continue/i })).toBeVisible({
    timeout: 20_000,
  });
  const role = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return "none";
    const dialog = el.closest('[role="dialog"], [role="alertdialog"]');
    return `${el.tagName}${dialog ? " inside-dialog" : " OUTSIDE-DIALOG"}`;
  });
  console.log("gate focus:", role);
  expect(role).toContain("inside-dialog");
});

test("200% zoom: gate stays usable without horizontal overflow", async ({ page }) => {
  await page.goto("/new");
  await expect(page.getByRole("heading", { name: /log in to continue/i })).toBeVisible({
    timeout: 20_000,
  });
  // 200% zoom == CSS viewport half the device pixels in each axis.
  await page.setViewportSize({ width: 640, height: 400 });
  await page.evaluate(() => {
    document.body.style.zoom = "200%";
  });
  await page.waitForTimeout(500);
  await expect(page.getByRole("heading", { name: /log in to continue/i })).toBeVisible();
  const overflow = await page.evaluate(() => document.scrollingElement?.scrollWidth ?? 0);
  console.log("200% scrollWidth:", overflow);
  expect(overflow).toBeLessThanOrEqual(640);
});
