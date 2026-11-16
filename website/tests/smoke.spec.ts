import { test, expect } from "@playwright/test";

test("public homepage renders the AXIVESTRA positioning and core sections", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/AXIVESTRA/);
  await expect(page.getByRole("heading", { name: /see the full picture behind every asset/i })).toBeVisible();
  await expect(page.locator("#platform")).toBeAttached();
  await expect(page.locator("#solutions")).toBeAttached();
  await expect(page.locator("#about")).toBeAttached();
  await expect(page.locator("#contact")).toBeAttached();
  await expect(page.getByRole("link", { name: /open axivestra workspace/i })).toHaveAttribute("href", "https://axivestra.pages.dev");
});

test("mobile navigation opens and moves to a website section", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const openMenu = page.getByRole("button", { name: "Open menu" });
  await expect(openMenu).toBeVisible();
  await openMenu.click();
  const platformButton = page.locator(".main-nav").getByRole("button", { name: "Platform", exact: true });
  await expect(platformButton).toBeVisible();
  await platformButton.click();
  await expect(page.locator(".main-nav")).not.toHaveClass(/nav-open/);
  await expect(page.locator("#platform")).toBeInViewport();
});

test("website administrator route never grants access without configured backend", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Website admin setup required" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Return to website" })).toBeVisible();
});

test("public enquiry form does not report success when the backend is not configured", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[placeholder="Name"]').fill("Website Smoke Test");
  await page.locator('input[placeholder="you@company.com"]').fill("smoke@example.test");
  await page.locator('textarea[placeholder="Tell us briefly about your requirements."]').fill("Checking the public enquiry form fallback.");
  await page.getByRole("checkbox", { name: /i agree to be contacted/i }).check();
  await page.getByRole("button", { name: /send enquiry/i }).click();
  await expect(page.getByRole("alert")).toContainText("contact form is not connected yet");
  await expect(page.getByRole("heading", { name: "Thank you for reaching out." })).toHaveCount(0);
});