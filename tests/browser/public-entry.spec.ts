import { test, expect } from "@playwright/test";

test("desktop and mobile: first launch opens the existing AXIVESTRA app workspace", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Understand assets, capital and exposure/i })).toBeVisible();
  const mobile = (page.viewportSize()?.width || 1440) <= 720;
  if (mobile) await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.locator(".nav-list")).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Export workspace JSON" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: /Understand assets, capital and exposure/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /See the full picture behind/i })).toHaveCount(0);
});

test("mobile: the same app workspace opens without horizontal overflow", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "Mobile-only app-layout check.");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Understand assets, capital and exposure/i })).toBeVisible();
  const overflow = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
