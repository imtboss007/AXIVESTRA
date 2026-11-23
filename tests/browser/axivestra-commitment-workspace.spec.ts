import { test, expect, type Locator, type Page } from "@playwright/test";

const env = process.env;
const companyName = env.AXIVESTRA_E2E_COMPANY_NAME || "";
const email = env.AXIVESTRA_E2E_EMAIL || "";
const password = env.AXIVESTRA_E2E_PASSWORD || "";
const configured = Boolean(email && password && companyName);

async function selectOptionContaining(select: Locator, fragment: string) {
  const options = await select.locator("option").evaluateAll(elements =>
    elements.map(option => ({
      value: (option as HTMLOptionElement).value,
      label: option.textContent?.trim() || ""
    }))
  );
  const match = options.find(option =>
    Boolean(option.value) && option.label.toLocaleLowerCase().includes(fragment.toLocaleLowerCase())
  );
  expect(match, "A configured QA option should exist: " + fragment).toBeDefined();
  await select.selectOption(match!.value);
}

async function openCompanyWorkspace(page: Page) {
  await page.goto("/");
  const emailField = page.getByLabel("Email address");
  if (await emailField.isVisible().catch(() => false)) {
    await emailField.fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in securely" }).click();
  }

  await expect(page.getByRole("heading", { name: "Select your workspace." })).toBeVisible();
  const companyChoice = page.locator(".auth-company-list .auth-company-row")
    .filter({ hasText: companyName }).first();
  await expect(companyChoice).toBeVisible();
  await companyChoice.click();

  await expect(page.getByRole("region", {
    name: "Commitments and operational actions"
  })).toBeVisible();
}

test.describe("AXIVESTRA E18 authenticated company acceptance", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-chromium",
      "Fixture-mutating E18 acceptance runs once on desktop; it is not duplicated across mobile project workers."
    );
    test.skip(
      !configured,
      "Requires AXIVESTRA_E2E_EMAIL, AXIVESTRA_E2E_PASSWORD and AXIVESTRA_E2E_COMPANY_NAME. Build the preview with the VITE_SUPABASE_URL and publishable/anon key before running Playwright."
    );
    await openCompanyWorkspace(page);
  });

  test("creates and edits a commitment with summary and a matching E16 relationship", async ({ page }) => {
    const dealTitle = env.AXIVESTRA_E2E_DEAL_TITLE || "";
    const partyName = env.AXIVESTRA_E2E_PARTY_NAME || "";
    test.skip(!dealTitle || !partyName, "Set AXIVESTRA_E2E_DEAL_TITLE and AXIVESTRA_E2E_PARTY_NAME for the relationship acceptance fixture.");

    const workspace = page.getByRole("region", { name: "Commitments and operational actions" });
    const title = "E18 browser acceptance " + new Date().toISOString();
    const firstSummary = "QA-created summary for E18 acceptance.";
    const editedSummary = "QA-edited summary; persisted through the commitment details workflow.";
    const dueDate = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);

    await workspace.getByLabel("Type").selectOption("promise");
    await workspace.getByLabel("Title").fill(title);
    await workspace.getByLabel("Summary").fill(firstSummary);
    await workspace.getByLabel("Priority").selectOption("high");
    await workspace.getByLabel("Next internal action").selectOption("verify_evidence");
    await workspace.getByLabel("Due date").fill(dueDate);
    await selectOptionContaining(workspace.getByLabel("Linked deal"), dealTitle);
    await selectOptionContaining(workspace.getByLabel("Linked party"), partyName);

    const relationshipSelect = workspace.getByLabel("Matching E16 relationship");
    const relationshipLabel = env.AXIVESTRA_E2E_RELATIONSHIP_LABEL || "";
    const relationshipOptions = await relationshipSelect.locator("option").evaluateAll(elements =>
      elements.map(option => ({
        value: (option as HTMLOptionElement).value,
        label: option.textContent?.trim() || ""
      }))
    );
    const relationship = relationshipOptions.find(option =>
      Boolean(option.value) &&
      (!relationshipLabel || option.label.toLocaleLowerCase().includes(relationshipLabel.toLocaleLowerCase()))
    );
    expect(relationship, "A live E16 relationship matching the configured deal and party is required").toBeDefined();
    await relationshipSelect.selectOption(relationship!.value);

    await workspace.getByRole("button", { name: "Create action" }).click();
    const card = workspace.locator(".ax-commitment-card").filter({ hasText: title });
    await expect(card).toBeVisible();
    await expect(card).toContainText(firstSummary);
    await expect(card).toContainText("E16 link:");

    await card.getByRole("button", { name: "Edit title / summary / links" }).click();
    await card.locator(".ax-commitment-detail-editor textarea").fill(editedSummary);
    await card.getByRole("button", { name: "Save details" }).click();
    await expect(card.locator("p")).toHaveText(editedSummary);

    // Keep the reusable QA company tidy without deleting its immutable audit record.
    await card.getByLabel("Status").selectOption("cancelled");
    await card.getByRole("button", { name: "Save status" }).click();
    await expect(card.locator(".ax-commitment-card-meta")).toContainText("Cancelled");
  });

  test("links one explicitly selected legacy task without deleting its source record", async ({ page }) => {
    const taskTitle = env.AXIVESTRA_E2E_LEGACY_TASK_TITLE || "";
    test.skip(!taskTitle, "Set AXIVESTRA_E2E_LEGACY_TASK_TITLE to a dedicated, synced QA task. Linking a source task is intentionally one-time.");

    const workspace = page.getByRole("region", { name: "Commitments and operational actions" });
    const select = workspace.getByLabel("Unlinked legacy task");
    const option = select.locator("option").filter({ hasText: taskTitle }).first();
    const optionCount = await option.count();
    test.skip(!optionCount, "The configured legacy task is not currently available for linking; it may already have been linked or may need to sync.");

    const optionValue = await option.getAttribute("value");
    const optionText = (await option.textContent()) || "";
    const importedTitle = optionText.split(" · ")[0].trim();
    expect(optionValue).toBeTruthy();

    await select.selectOption(optionValue!);
    await workspace.getByRole("button", { name: "Link / import selected task" }).click();

    const card = workspace.locator(".ax-commitment-card").filter({ hasText: importedTitle });
    await expect(card).toBeVisible();
    await expect(card.locator(".ax-commitment-source-task")).toBeVisible();
    await expect(card.locator(".ax-commitment-source-task")).toContainText("Linked legacy task:");

    if (!optionText.includes("Completed")) {
      await card.getByLabel("Status").selectOption("cancelled");
      await card.getByRole("button", { name: "Save status" }).click();
      await expect(card.locator(".ax-commitment-card-meta")).toContainText("Cancelled");
    }
  });
});
