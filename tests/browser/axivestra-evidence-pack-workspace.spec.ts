import { test, expect, type Page } from "@playwright/test";

const env = process.env;
const email = env.AXIVESTRA_E2E_EMAIL || "";
const password = env.AXIVESTRA_E2E_PASSWORD || "";
const companyName = env.AXIVESTRA_E2E_COMPANY_NAME || "";
const provenanceEventId = env.AXIVESTRA_E2E_E21_PROVENANCE_EVENT_ID || "";
const configured = Boolean(email && password && companyName);

async function openEvidenceWorkspace(page: Page) {
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
    .getByRole("button", { name: /^Discovery Sources/ }).click();
  return page.getByTestId("e21-evidence-workspace");
}

test.describe("AXIVESTRA E21 authenticated evidence-pack acceptance", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-chromium",
      "E21 authenticated QA acceptance runs once on desktop."
    );
    test.skip(
      !configured,
      "Requires AXIVESTRA_E2E_EMAIL, AXIVESTRA_E2E_PASSWORD and AXIVESTRA_E2E_COMPANY_NAME."
    );
  });

  test("shows the company-scoped evidence catalogue and safe export boundary", async ({ page }) => {
    const workspace = await openEvidenceWorkspace(page);
    await expect(workspace).toBeVisible();
    await expect(workspace.getByRole("heading", { name: "Evidence manager & review packs" })).toBeVisible();
    await expect(workspace.locator(".discovery-notice"))
      .toContainText("Evidence-safe export.");
    await expect(workspace.getByRole("heading", { name: "Available provenance citations" })).toBeVisible();
    await expect(workspace).toContainText("Lineage citations");
    await expect(workspace).toContainText("Evidence packs");
    await expect(workspace).not.toContainText(/https?:\/\//);
    await expect(workspace).not.toContainText(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);

    const createPack = workspace.getByRole("button", { name: "Create evidence pack" });
    if (await createPack.count()) {
      await expect(workspace.getByLabel("Pack title")).toBeVisible();
      await expect(workspace.getByLabel("Intended purpose")).toBeVisible();
    } else {
      await expect(workspace).toContainText("Only company owners/admins can curate, submit, review or export packs.");
    }
  });

  test("an owner/admin can curate, submit, approve and export a QA provenance citation", async ({ page }) => {
    test.skip(
      !provenanceEventId,
      "Set AXIVESTRA_E2E_E21_PROVENANCE_EVENT_ID to a dedicated eligible provenance-event UUID in the QA company."
    );
    const workspace = await openEvidenceWorkspace(page);
    const createPack = workspace.getByRole("button", { name: "Create evidence pack" });
    test.skip(
      await createPack.count() === 0,
      "The authenticated QA member is not an owner/admin and cannot curate evidence packs."
    );

    const title = "E21 browser acceptance " + new Date().toISOString();
    await workspace.getByLabel("Pack title").fill(title);
    await workspace.getByLabel("Intended purpose")
      .fill("Dedicated QA acceptance of evidence citation curation, owner review and metadata-only export.");
    await createPack.click();

    const packChoice = workspace.locator(".discovery-evidence-pack-choice").filter({ hasText: title });
    await expect(packChoice).toBeVisible();
    await packChoice.click();

    const candidate = workspace.locator(`[data-provenance-event-id="${provenanceEventId}"]`);
    await expect(candidate).toBeVisible();
    await candidate.getByRole("button", { name: "Add to selected draft" }).click();
    await expect(workspace.locator(".discovery-evidence-items")).toContainText("Included citations (1)");

    await workspace.getByRole("button", { name: "Submit for review" }).click();
    await expect(workspace.locator(".discovery-evidence-pack-meta")).toContainText("in review");
    const approve = workspace.getByRole("button", { name: "Approve pack" });
    await expect(approve).toBeVisible();
    await approve.click();
    await expect(workspace.locator(".discovery-evidence-pack-meta")).toContainText("approved");

    const exportButton = workspace.getByRole("button", { name: "Export SHA-256 hashed manifest" });
    await expect(exportButton).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      exportButton.click()
    ]);
    expect(download.suggestedFilename()).toMatch(/^axivestra-.*-evidence-manifest\.json$/);
    await expect(workspace).toContainText(
      "Approved metadata/provenance bundle exported and its SHA-256 export receipt recorded."
    );
    await workspace.locator("details.discovery-history summary").click();
    await expect(workspace.locator("details.discovery-history")).toContainText("export");
    // This intentionally leaves the approved QA pack and its immutable history for inspection.
  });
});
