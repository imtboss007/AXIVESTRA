import { test, expect, type Page } from "@playwright/test";

const env = process.env;
const email = env.AXIVESTRA_E2E_EMAIL || "";
const password = env.AXIVESTRA_E2E_PASSWORD || "";
const companyName = env.AXIVESTRA_E2E_COMPANY_NAME || "";
const expectedProfileCount = Number(env.AXIVESTRA_E2E_DISCOVERY_PROFILE_COUNT || 0);
const configured = Boolean(email && password && companyName);

async function openDiscovery(page: Page, navigationLabel: "Lender Discovery" | "Customer Discovery") {
  await page.goto("/");
  const emailField = page.getByLabel("Email address");
  if (await emailField.isVisible().catch(() => false)) {
    await emailField.fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in securely" }).click();
  }

  await expect(page.getByRole("heading", { name: "Select your workspace." })).toBeVisible();
  const company = page.locator(".auth-company-list .auth-company-row")
    .filter({ hasText: companyName }).first();
  await expect(company).toBeVisible();
  await company.click();

  await expect(page.locator(".topbar")).toBeVisible();
  const navigation = page.locator(".nav-list")
    .getByRole("button", { name: new RegExp("^" + navigationLabel) });
  const openMenu = page.getByRole("button", { name: "Open menu" });
  await expect(openMenu).toBeVisible();
  await openMenu.click();
  await expect(page.locator(".sidebar")).toHaveClass(/sidebar-open/);
  await expect(navigation).toBeVisible();
  await navigation.click();

  await expect(page.locator(".discovery-quick-search")).toBeVisible();
  const advanced = page.locator("details.discovery-advanced-profile-setup");
  await expect(advanced).toBeAttached();
  await advanced.locator(":scope > summary").click();
  await expect(advanced).toHaveAttribute("open", "");
}

async function verifyAllWorkspaceProfiles(page: Page, mode: "LENDER" | "CUSTOMER") {
  const select = page.getByLabel("Search in");
  const options = await select.locator("option").evaluateAll(nodes =>
    nodes.map(node => ({
      value: (node as HTMLOptionElement).value,
      label: node.textContent?.trim() || ""
    })).filter(option => option.value)
  );
  expect(options).toHaveLength(16);

  for (const option of options) {
    await select.selectOption(option.value);
    const cards = page.locator(".discovery-profile-card");
    await expect(cards).toHaveCount(1);
    const card = cards.first();
    await expect(card.locator(".discovery-profile-head")).toContainText(mode);
    await expect(card.locator(".discovery-profile-head strong")).toHaveText(option.label);
    await expect(card.locator(".discovery-search-filter-panel")).toBeVisible();
    await expect(card.locator(".discovery-search-filter-heading")).toContainText("Search filters");
    expect(await card.locator(".discovery-search-filter-grid label").count()).toBeGreaterThan(3);
    await expect(card.locator(".discovery-attached-sources")).toContainText("Attached sources (0)");
    await expect(card.locator(".discovery-search-filter-actions"))
      .toContainText("Applies only to this selected module and mode.");
  }
}

test.describe("AXIVESTRA disposable demo: 16 workspace filters on mobile", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-chromium",
      "This acceptance suite is intentionally mobile-only."
    );
    test.skip(!configured, "Requires the disposable local AXIVESTRA QA company credentials.");
    expect(expectedProfileCount).toBe(32);
  });

  test("tests all 16 LENDER module filter profiles without executing public search", async ({ page }) => {
    await openDiscovery(page, "Lender Discovery");
    await verifyAllWorkspaceProfiles(page, "LENDER");
    const searchButtons = page.locator(".discovery-profile-card button")
      .filter({ hasText: /Search with filters|Search provider not connected/ });
    await expect(searchButtons).toHaveCount(1);
    // No search button is clicked: this is an authenticated UI/profile test only.
  });

  test("tests all 16 CUSTOMER module filter profiles without executing public search", async ({ page }) => {
    await openDiscovery(page, "Customer Discovery");
    await verifyAllWorkspaceProfiles(page, "CUSTOMER");
    const personalLoan = page.locator(".discovery-profile-card").filter({ hasText: "Personal Loan" });
    await expect(personalLoan).toContainText("External person-discovery is disabled");
    // All fixtures are disabled and have no attached sources. No live request is performed.
  });
});
