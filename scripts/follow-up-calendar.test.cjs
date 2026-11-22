const assert = require("node:assert/strict");

(async () => {
  const { buildMonthGrid, shiftMonth, formatMonthLabel } = await import("../src/lib/follow-up-calendar.mjs");

  const november = buildMonthGrid("2026-11");
  assert.equal(november.length, 35, "A five-week month should render exactly five calendar rows.");
  assert.equal(november[0].date, "2026-11-01", "A month beginning on Sunday should start in the first cell.");
  assert.equal(november[29].date, "2026-11-30", "The final date should remain in the correct column.");
  assert.equal(november.filter(Boolean).length, 30, "The grid should contain every date exactly once.");

  const august = buildMonthGrid("2026-08");
  assert.equal(august.length, 42, "A month spanning six calendar weeks should render six rows.");
  assert.equal(august[0], null, "Leading days from the previous month should be empty cells.");
  assert.equal(august[6].date, "2026-08-01", "The first day should align with Saturday for August 2026.");
  assert.equal(august[36].date, "2026-08-31", "Trailing empty cells should not displace the last date.");

  const leapFebruary = buildMonthGrid("2024-02");
  assert.equal(leapFebruary.filter(Boolean).length, 29, "Leap-year February must include February 29.");
  assert.ok(leapFebruary.some(cell => cell?.date === "2024-02-29"), "Leap day must have a selectable date cell.");

  assert.equal(shiftMonth("2026-12", 1), "2027-01", "Next-month navigation must cross a year boundary.");
  assert.equal(shiftMonth("2027-01", -1), "2026-12", "Previous-month navigation must cross a year boundary.");
  assert.equal(shiftMonth("2026-03", -3), "2025-12", "Month navigation must support multiple-month jumps.");
  assert.equal(formatMonthLabel("2026-11", "en-IN"), "November 2026", "The month heading should be readable.");

  assert.throws(() => buildMonthGrid("2026-13"), /YYYY-MM/, "Invalid month values must be rejected.");
  assert.throws(() => buildMonthGrid("2026-2"), /YYYY-MM/, "Non-zero-padded month values must be rejected.");
  assert.throws(() => shiftMonth("2026-01", 1.5), /integer/, "Month offsets must be whole numbers.");

  console.log("AXIVESTRA follow-up calendar utilities passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
