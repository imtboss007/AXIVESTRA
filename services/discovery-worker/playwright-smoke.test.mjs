import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";

test("Playwright renderer starts in headless isolated mode and captures a static DOM", async () => {
  const browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage"] });
  try {
    const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false, permissions: [] });
    const page = await context.newPage();
    await page.setContent("<main><h1>AXIVESTRA E04 renderer smoke test</h1><p>Local synthetic content only.</p></main>");
    const result = await page.locator("h1").textContent();
    assert.equal(result, "AXIVESTRA E04 renderer smoke test");
    await context.close();
  } finally {
    await browser.close();
  }
});
