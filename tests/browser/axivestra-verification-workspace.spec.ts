import { test, expect, type Page } from "@playwright/test";

const env=process.env;
const email=env.AXIVESTRA_E2E_EMAIL||"";
const password=env.AXIVESTRA_E2E_PASSWORD||"";
const companyName=env.AXIVESTRA_E2E_COMPANY_NAME||"";
const configured=Boolean(email&&password&&companyName);

async function openCompany(page:Page){
  await page.goto("/");
  const emailField=page.getByLabel("Email address");
  if(await emailField.isVisible().catch(()=>false)){
    await emailField.fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button",{name:"Sign in securely"}).click();
  }
  await expect(page.getByRole("heading",{name:"Select your workspace."})).toBeVisible();
  const company=page.locator(".auth-company-list .auth-company-row").filter({hasText:companyName}).first();
  await expect(company).toBeVisible();
  await company.click();
}

test.describe("AXIVESTRA E19 verification acceptance",()=>{
  test.describe.configure({mode:"serial"});

  test.beforeEach(async({page},testInfo)=>{
    test.skip(testInfo.project.name!=="desktop-chromium","The verification QA acceptance runs once on desktop.");
    test.skip(!configured,"Requires AXIVESTRA_E2E_EMAIL, AXIVESTRA_E2E_PASSWORD and AXIVESTRA_E2E_COMPANY_NAME.");
    await openCompany(page);
    await page.locator(".nav-list").getByRole("button",{name:/^Source Governance/}).click();
  });

  test("company Discovery Sources exposes the cross-stage verification inbox",async({page})=>{
    const workspace=page.getByRole("region",{name:"Verification and confidence workspace"});
    await expect(workspace).toBeVisible();
    await expect(workspace.getByRole("heading",{name:"Verification & confidence"})).toBeVisible();
    await expect(workspace.getByLabel("Show")).toBeVisible();
    await expect(workspace).toContainText("Confidence is an evidence-coverage index");
  });

  test("a configured provenance subject can be inspected without exposing raw values",async({page})=>{
    const subjectId=env.AXIVESTRA_E2E_VERIFICATION_SUBJECT_ID||"";
    test.skip(!subjectId,"Set AXIVESTRA_E2E_VERIFICATION_SUBJECT_ID to a dedicated QA case subject UUID for the subject-level acceptance assertion.");
    const workspace=page.getByRole("region",{name:"Verification and confidence workspace"});
    const card=workspace.locator(".discovery-verification-card").filter({hasText:"Record "+subjectId.slice(0,8)}).first();
    await expect(card).toBeVisible();
    await card.getByText(/Inspect evidence references/).click();
    await expect(card.locator(".discovery-verification-evidence-row").first()).toBeVisible();
    await expect(card).not.toContainText(/@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  });
});
