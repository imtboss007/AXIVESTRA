import { test, expect, type Page } from "@playwright/test";

const env = process.env;
const email = env.AXIVESTRA_E2E_EMAIL || "";
const password = env.AXIVESTRA_E2E_PASSWORD || "";
const companyName = env.AXIVESTRA_E2E_COMPANY_NAME || "";
const suggestionId = env.AXIVESTRA_E2E_E22_SUGGESTION_ID || "";
const configured = Boolean(email && password && companyName);

async function openCompanyDiscovery(page: Page) {
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

  await page.locator(".nav-list")
    .getByRole("button", { name: /^Source Governance/ }).click();
  return page.getByTestId("e22-review-workspace");
}

test.describe("AXIVESTRA E22 authenticated review desk acceptance", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-chromium",
      "E22 authenticated QA acceptance runs once on desktop."
    );
    test.skip(
      !configured,
      "Requires AXIVESTRA_E2E_EMAIL, AXIVESTRA_E2E_PASSWORD and AXIVESTRA_E2E_COMPANY_NAME."
    );
  });

  test("shows the company-scoped review desk while provider execution remains disabled", async ({ page }) => {
    const workspace = await openCompanyDiscovery(page);
    await expect(workspace).toBeVisible();
    await expect(workspace.getByRole("heading", { name: "AI suggestion review desk" })).toBeVisible();
    await expect(workspace.locator(".discovery-notice"))
      .toContainText("Provider execution remains disabled by default.");
    await expect(workspace)
      .toContainText("Human review only; no automatic match decision or lead promotion.");
    await expect(workspace).toContainText("Recorded suggestions");
    await expect(workspace).toContainText("Awaiting review");
  });

  test("a configured suggestion exposes the E11 baseline and guarded human-review controls", async ({ page }) => {
    test.skip(
      !suggestionId,
      "Set AXIVESTRA_E2E_E22_SUGGESTION_ID to a dedicated pending QA suggestion UUID to exercise the review form."
    );
    const workspace = await openCompanyDiscovery(page);
    const card = workspace.locator(`[data-suggestion-id="${suggestionId}"]`);
    await expect(card).toBeVisible();
    await expect(card).toContainText("E11 deterministic score");
    await expect(card).toContainText("E22 advisory score");
    await expect(card).toContainText("E22 does not override E11 blockers.");

    const reviewReason = card.getByLabel("Review reason");
    if (await reviewReason.count()) {
      const submit = card.getByRole("button", { name: "Record human review" });
      await expect(submit).toBeDisabled();
      await reviewReason.fill("QA acceptance validates that a reason is required before a review can be recorded.");
      await expect(submit).toBeEnabled();
      // Deliberately do not submit: QA acceptance must not alter the review fixture.
    } else {
      await expect(card).toContainText("Read-only view");
    }
  });

  test("E15 separates lender/customer review views with searchable responsive cards and reduced motion", async ({ page }) => {
    await openCompanyDiscovery(page);
    const workspace = page.locator(".discovery-lead-panel");
    await expect(workspace).toBeVisible();
    await expect(workspace.getByRole("heading", { name: "Lead review & workspace pipeline" })).toBeVisible();
    await expect(workspace.locator(".discovery-match-card")).toHaveCount(2);

    const modes = workspace.getByRole("group", { name: "Workspace mode" });
    const lender = modes.getByRole("button", { name: "Lender" });
    const customer = modes.getByRole("button", { name: "Customer" });
    await lender.click();
    await expect(lender).toHaveAttribute("aria-pressed", "true");
    await expect(customer).toHaveAttribute("aria-pressed", "false");
    await expect(workspace.locator(".discovery-match-card")).toHaveCount(1);
    await expect(workspace.locator(".discovery-mode-pill.mode-lender")).toBeVisible();
    await expect(workspace.locator(".discovery-match-meter")).toBeVisible();

    await customer.click();
    await expect(customer).toHaveAttribute("aria-pressed", "true");
    await expect(lender).toHaveAttribute("aria-pressed", "false");
    await expect(workspace.locator(".discovery-match-card")).toHaveCount(1);
    await expect(workspace.locator(".discovery-mode-pill.mode-customer")).toBeVisible();

    const search = workspace.getByRole("searchbox", { name: "Search lender and customer records" });
    await search.fill("startup");
    await expect(workspace.locator(".discovery-match-card")).toHaveCount(1);
    await search.fill("no-such-qa-company");
    await expect(workspace.locator(".discovery-match-card")).toHaveCount(0);
    await expect(workspace).toContainText("No pending matches match this workspace/search filter.");
    await workspace.getByRole("button", { name: "Clear search" }).click();
    await expect(search).toHaveValue("");

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(modes).toHaveCSS("display", "grid");
    await expect(lender).toBeVisible();
    await expect(customer).toBeVisible();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(workspace).toHaveCSS("animation-name", "none");
    await expect(workspace.locator(".discovery-lead-stats > div").first()).toHaveCSS("animation-name", "none");
  });
});
