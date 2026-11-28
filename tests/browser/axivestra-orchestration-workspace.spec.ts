import { test, expect, type Page } from "@playwright/test";

const env = process.env;
const email = env.AXIVESTRA_E2E_EMAIL || "";
const password = env.AXIVESTRA_E2E_PASSWORD || "";
const companyName = env.AXIVESTRA_E2E_COMPANY_NAME || "";
const configured = Boolean(email && password && companyName);

async function openCompanySourceGovernance(page: Page) {
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
  const sourceGovernance = page.locator(".nav-list")
    .getByRole("button", { name: /^Source Governance/ });
  const openMenu = page.getByRole("button", { name: "Open menu" });
  await expect(openMenu).toBeVisible();
  await openMenu.click();
  await expect(page.locator(".sidebar")).toHaveClass(/sidebar-open/);
  await expect(sourceGovernance).toBeVisible();
  await sourceGovernance.click();
}

test.describe("AXIVESTRA E20 authenticated mobile acceptance", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-chromium",
      "E20 mobile acceptance runs on the Pixel mobile Chromium project."
    );
    test.skip(
      !configured,
      "Requires the disposable local AXIVESTRA QA company credentials."
    );
    await openCompanySourceGovernance(page);
  });

  test("loads workflow presets and all nine registered stages in an authenticated mobile session", async ({ page }) => {
    const workspace = page.getByTestId("e20-orchestration-workspace");
    await expect(workspace).toBeVisible();
    await expect(workspace.getByRole("heading", { name: "Agent orchestration control plane" })).toBeVisible();
    await expect(workspace.locator(".discovery-orchestration-guard"))
      .toContainText("Execution is disabled by design");
    await expect(workspace.locator(".discovery-orchestration-guard"))
      .toContainText("every company/stage kill switch starts OFF");
    await expect(workspace.getByRole("alert")).toHaveCount(0);

    const workflow = workspace.getByLabel("Workflow preset");
    await expect(workflow).toBeEnabled();
    const options = await workflow.locator("option").evaluateAll(nodes =>
      nodes.map(node => ({
        value: (node as HTMLOptionElement).value,
        label: node.textContent?.trim() || ""
      }))
    );
    expect(options).toHaveLength(3);
    expect(options.map(option => option.value).sort()).toEqual([
      "company_identity",
      "full_discovery",
      "geo_resolution"
    ]);

    const summary = workspace.locator(".discovery-orchestration-summary").first();
    await expect(summary.locator("article").nth(3).locator("strong")).toHaveText("9");
    await expect(summary.locator("article").nth(3)).toContainText("Registered stages");

    await workflow.selectOption("full_discovery");
    await expect(workflow).toHaveValue("full_discovery");
    await workspace.getByRole("button", { name: "Refresh" }).click();
    await expect(summary.locator("article").nth(3).locator("strong")).toHaveText("9");

    await expect(workspace).toContainText("dispatch remains OFF");
    await expect(workspace.locator(".discovery-orchestration-worker-panel").first())
      .toContainText("No durable execution records exist yet");

    const viewport = page.viewportSize();
    expect(viewport?.width).toBeLessThanOrEqual(500);
  });
});
