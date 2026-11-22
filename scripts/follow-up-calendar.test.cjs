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

const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const registry = fs.readFileSync(path.join(root, "src", "FollowUpRegistry.tsx"), "utf8");
const theme = fs.readFileSync(path.join(root, "src", "axivestra-theme.css"), "utf8");

assert.match(registry, /const calendarGrid = useMemo\(\(\) => buildMonthGrid\(month\)/,
  "The registry must render the shared month-grid utility.");
assert.match(registry, /const calendarItemCounts = useMemo/,
  "Calendar day badges must be derived from the currently visible follow-ups.");
assert.match(registry, /const selectedDayItems = useMemo/,
  "The selected-day detail panel must be derived from the visible month entries.");
assert.match(registry, /onClick=\{\(\)=>setSelectedDate\(day\.date\)\}/,
  "Each date cell must open its selected-day detail.");
assert.match(registry, /aria-pressed=\{selectedDate===day\.date\}/,
  "Date selection must be exposed to assistive technology.");
assert.match(registry, /aria-current=\{day\.date===today\?"date":undefined\}/,
  "The current date must be programmatically identifiable.");
assert.match(registry, /navigateCalendarMonth\(-1\)/,
  "The calendar must provide previous-month navigation.");
assert.match(registry, /navigateCalendarMonth\(1\)/,
  "The calendar must provide next-month navigation.");
assert.match(registry, /const jumpToToday = \(\) =>/,
  "The calendar must provide a one-action return to today.");
assert.match(registry, /selectedDayItems\.map\(renderItem\)/,
  "Only the selected day's assignments should appear in its detail panel.");
assert.match(theme, /\.ax-followup-calendar__grid/,
  "The month grid must have a dedicated visual layout.");
assert.match(theme, /@media \(max-width: 680px\)[\s\S]*?\.ax-followup-calendar__controls/,
  "Calendar controls and cells must adapt to mobile widths.");
assert.match(theme, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.ax-followup-calendar__day/,
  "Calendar selection transitions must respect reduced-motion preferences.");

console.log("AXIVESTRA follow-up calendar interface contract passed.");
