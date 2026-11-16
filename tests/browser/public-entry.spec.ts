import { test, expect } from "@playwright/test";

const expectedWorkspaces = [
  "Property Sale", "Property Loans", "JV / JDA / JD", "SR Rate Settlement",
  "Agricultural Land", "Commercial Land", "Startup", "Equity",
  "Unsecured Company Loan", "Personal Loan", "Housing Loan", "House Purchase",
  "Litigation", "Fund & Portfolio Management", "Investor Relations", "Compliance & KYC"
];

test("desktop and mobile: AXIVESTRA public website is the shared application front door", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /See the full picture behind/i })).toBeVisible();
  await expect(page.getByText("ASSET INTELLIGENCE PLATFORM", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue locally on this device" })).toBeVisible();

  for (const name of expectedWorkspaces) {
    await expect(page.locator(".ax-public-domain-card").getByText(name, { exact: true })).toBeVisible();
  }

  await page.getByRole("button", { name: "Continue locally on this device" }).click();
  await expect(page.getByRole("heading", { name: /Understand assets, capital and exposure/i })).toBeVisible();
  await expect(page.locator(".nav-list")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: /Understand assets, capital and exposure/i })).toBeVisible();
});

test("mobile: public navigation adapts and opens the existing workspace", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "Mobile-only public-entry checks.");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /See the full picture behind/i })).toBeVisible();

  const menu = page.getByRole("button", { name: "Open navigation" });
  await expect(menu).toBeVisible();
  await menu.click();
  await page.getByRole("button", { name: "Workspaces", exact: true }).click();
  await expect(page.locator("#workspaces")).toBeInViewport();

  const overflow = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Continue locally on this device" }).click();
  await expect(page.getByRole("heading", { name: /Understand assets, capital and exposure/i })).toBeVisible();
});
