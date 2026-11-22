const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "src", "main.tsx"), "utf8");
const theme = fs.readFileSync(path.join(root, "src", "axivestra-theme.css"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const orbitalHub = fs.readFileSync(path.join(root, "src", "AxivestraOrbitalHub.tsx"), "utf8");
const analytics = fs.readFileSync(path.join(root, "src", "PortfolioAnalytics.tsx"), "utf8");
const magicGrid = fs.readFileSync(path.join(root, "src", "components", "MagicAnimatedGridPattern.tsx"), "utf8");
const motionNumber = fs.readFileSync(path.join(root, "src", "components", "MotionAnimatedNumber.tsx"), "utf8");
const unlumenGlowButton = fs.readFileSync(path.join(root, "src", "components", "UnlumenGlowButton.tsx"), "utf8");
const thirdPartyNotices = fs.readFileSync(path.join(root, "THIRD_PARTY_NOTICES.md"), "utf8");
const table = fs.readFileSync(path.join(root, "src", "components", "EnterpriseDataTable.tsx"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

assert.match(main, /import "\.\/styles\.css";[\s\S]*import "\.\/axivestra-theme\.css";/,
  "The enterprise theme must load after existing styles.");
assert.match(app, /className=\{company\?\.role === "read_only" \? "app-shell ax-modern-shell workspace-readonly" : "app-shell ax-modern-shell"\}/,
  "The theme must stay scoped to the existing AXIVESTRA application shell.");

const requiredTokens = [
  "--axiv-canvas: #0b1420",
  "--axiv-surface: #132333",
  "--axiv-ink: #e8f0f4",
  "--axiv-primary: #3b9189",
  "--axiv-navy: #091725",
  "--axiv-brass: #b99a68"
];
for (const token of requiredTokens) {
  assert.ok(theme.includes(token), `Missing approved design token: ${token}`);
}

for (const selector of [
  ".ax-modern-shell .sidebar",
  ".ax-modern-shell .topbar",
  ".ax-modern-shell .institutional-banner",
  ".ax-modern-shell .stat-card",
  ".ax-modern-shell .module-card",
  ".ax-modern-shell .form-card",
  ".ax-modern-shell .ax-analytics-panel",
  ".ax-modern-shell .ax-orbit-hub"
]) {
  assert.ok(theme.includes(selector), `Missing enterprise theme override: ${selector}`);
}

assert.match(theme, /@media\s*\(max-width:\s*720px\)/,
  "The visual layer must preserve mobile-specific treatment.");
assert.match(theme, /@media\s*\(prefers-reduced-motion:\s*reduce\)/,
  "The visual layer must respect reduced-motion preferences.");
assert.ok(packageJson.scripts.test.includes("axivestra-theme.test.cjs"),
  "The new theme contract test must be part of the standard test command.");


for (const selector of [
  ".auth-shell",
  ".auth-card",
  ".auth-primary",
  ".auth-input",
  ".auth-company-row"
]) {
  assert.ok(theme.includes(selector), `Missing authentication theme override: ${selector}`);
}
assert.match(theme, /\.auth-card\s*\{[^}]*background:\s*linear-gradient\(155deg,#14293b,#0f2030\)/s,
  "The authentication card must use the shared dark marine surface.");
assert.match(theme, /\.auth-primary,[\s\S]*?background:\s*#286e6a/,
  "The authentication primary action must use the muted teal token.");
assert.match(theme, /color-scheme:\s*dark/,
  "The application must use a dark browser colour scheme.");

function luminance(hex) {
  const channels = hex.replace("#", "").match(/.{2}/g).map(value => parseInt(value, 16) / 255);
  const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
assert.ok(contrast("#e8f0f4", "#0b1420") >= 12,
  "Main text must meet a strong contrast target on the dark canvas.");
assert.ok(contrast("#9aafbd", "#132333") >= 6,
  "Muted text must remain readable on dark surfaces.");
assert.ok(contrast("#f4fbfa", "#286e6a") >= 4.5,
  "Primary button text must be readable against its muted teal fill.");

assert.ok(analytics.includes("const periodInflow = cashflowRows.reduce"), "Cashflow inspector totals must be computed from the selected chart period.");
assert.ok(analytics.includes("Net recorded cashflow · selected {period}-month window"), "Cashflow summary must disclose its selected window.");
assert.ok(analytics.includes("Unclassified transaction types"), "Cashflow must disclose transactions outside the inflow/outflow map.");
assert.ok(analytics.includes("const todayKey ="), "Overdue tasks must compare against the local calendar date.");
assert.ok(analytics.includes("visibleItems.map((item, index) =>"), "Analytics legend must render every visible category rather than truncating after eight.");
assert.ok(analytics.includes('role="group" aria-label={focus === "allocation" ? "All recorded workspace categories" : "All recorded pipeline statuses"}'), "Analytics category controls must expose a meaningful group label.");
assert.match(app, /<div key=\{active\} className="content ax-workspace-transition">/, "Switching workspaces must restart the content entry transition.");
assert.match(theme, /@keyframes ax-workspace-enter/, "Workspace changes must use a restrained content transition.");
assert.match(theme, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.content\.ax-workspace-transition \{ animation: none; \}/, "Workspace transitions must be disabled for reduced-motion users.");
assert.match(app, /import MagicAnimatedGridPattern from "\.\/components\/MagicAnimatedGridPattern";/, "Workspace Explorer must import the adapted Magic UI grid component.");
assert.match(app, /<MagicAnimatedGridPattern \/>/, "Workspace Explorer must render the animated grid visual in its hero banner.");
assert.match(magicGrid, /aria-hidden="true"/, "Decorative grid geometry must be hidden from assistive technology.");
assert.match(magicGrid, /useId\(\)/, "The SVG grid pattern must use a unique per-instance definition ID.");
assert.match(theme, /@keyframes ax-magic-grid-square-pulse/, "The adapted grid must animate square highlights using local CSS.");
assert.match(theme, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?ax-magic-grid-pattern__square \{[\s\S]*?animation: none/, "The Magic UI grid animation must respect reduced-motion preferences.");
assert.match(thirdPartyNotices, /Magic UI[\s\S]*?MIT License[\s\S]*?Copyright \(c\) Magic UI/, "The adapted component must preserve its upstream MIT attribution and licence notice.");
assert.ok(!("motion" in packageJson.dependencies) && !("motion" in packageJson.devDependencies), "The CSS adaptation must not add the upstream Motion runtime dependency.");

assert.match(app, /import MotionAnimatedNumber from "\.\/components\/MotionAnimatedNumber";/, "AXIVESTRA must import the adapted Motion Primitives count component.");
assert.match(app, /typeof value === "number" \? <MotionAnimatedNumber value=\{value\}\/\> : value/, "Numeric stat cards must use the animated count component without touching preformatted strings.");
assert.match(app, /<MotionAnimatedNumber value=\{highRiskCount\}\/\>/, "Risk-count metrics must use the animated count component.");
assert.match(app, /<MotionAnimatedNumber value=\{overdueTaskCount\}\/\>/, "Overdue-task metrics must use the animated count component.");
assert.match(app, /<MotionAnimatedNumber value=\{tasks\.filter\(item=>!item\.done\)\.length\}\/\>/, "Open-action totals must use the animated count component.");
assert.match(motionNumber, /new Intl\.NumberFormat\("en-IN"/, "Animated count values must retain Indian digit grouping.");
assert.match(motionNumber, /window\.matchMedia\?\.\("\(prefers-reduced-motion: reduce\)"\)/, "Animated counts must check reduced-motion preferences.");
assert.match(motionNumber, /window\.requestAnimationFrame/, "The animation must use the browser frame scheduler rather than a new runtime library.");
assert.match(motionNumber, /removeEventListener\?\.\("change", onMotionPreferenceChange\)/, "Reduced-motion preference listeners must be cleaned up.");
assert.match(motionNumber, /aria-label=\{formatter\.format\(safeValue\)\}/, "The accessible name must expose the final count, not each intermediate frame.");
assert.match(thirdPartyNotices, /Motion Primitives[\s\S]*?MIT License[\s\S]*?Copyright \(c\) 2024 ibelick/, "Motion Primitives adaptation must preserve upstream MIT attribution.");
assert.ok(!("motion" in packageJson.dependencies) && !("motion" in packageJson.devDependencies), "The animated-number adaptation must not add the Motion runtime dependency.");

console.log("AXIVESTRA enterprise design-system contract passed.");


assert.match(theme,/\.ax-modern-shell\s*\{[^}]*color-scheme:\s*dark/s,"Shell remains dark.");
assert.match(theme,/\.ax-enterprise-grid__viewport/,"Enterprise table dark styling exists.");
assert.match(theme,/\.ax-echart-host/,"Chart container styling exists.");

assert.ok(theme.lastIndexOf(".ax-modern-shell .topbar") > theme.indexOf(".ax-modern-shell .topbar"),
  "The final Night Marine surface harmonization must override legacy topbar styling.");
assert.match(theme, /\.ax-modern-shell \.topbar\s*\{[^}]*background:\s*rgba\(9,23,37,\.96\)/s,
  "The desktop topbar must use the dark marine surface.");
assert.match(theme, /\.ax-modern-shell \.search-box,[\s\S]*?background:\s*#0f2030/s,
  "Search controls must use the dark marine surface.");
assert.match(theme, /\.ax-modern-shell \.institutional-banner\s*\{[^}]*background:\s*linear-gradient\(115deg,#142b3d 0%,#102536 62%,#1d343b 100%\)/s,
  "The workspace banner must not fall back to a light legacy surface.");
assert.match(theme, /\.ax-modern-shell \.module-card,[\s\S]*?background:\s*var\(--axiv-surface\)/s,
  "Workspace cards must use the shared marine surface.");


assert.match(orbitalHub, /window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\)/,
  "The orbital UI must detect the user's system reduced-motion preference.");
assert.match(orbitalHub, /motionPreference\.addEventListener\("change", syncMotionPreference\)/,
  "The orbital UI must react when the reduced-motion preference changes.");
assert.match(orbitalHub, /disabled=\{motionSuppressed\}/,
  "The rotation control must not offer an ineffective action in grid or reduced-motion mode.");
assert.match(orbitalHub, /if \(motionSuppressed\) \{[\s\S]*?onOpen\(name\);[\s\S]*?return;/,
  "Grid and reduced-motion navigation must not impose an artificial animation delay.");
assert.match(orbitalHub, /onMouseLeave=\{\(\) => setFocused\(/,
  "Hover focus must clear when the pointer leaves a workspace node.");
assert.match(orbitalHub, /role="group" aria-label="Selectable workspace orbits"/,
  "Workspace node collection must expose a named group to assistive technology.");
assert.match(theme, /\.ax-modern-shell \.ax-orbit-hub \.ax-orbit-node-inspect\s*\{[^}]*width:\s*28px;[^}]*height:\s*28px/s,
  "Workspace inspection controls must use larger touch targets.");
assert.match(theme, /\.ax-modern-shell \.ax-orbit-hub \.ax-orbit-motion-toggle:disabled/,
  "Reduced-motion and grid-view controls must communicate their disabled state.");


assert.match(analytics, /valueFormatter:formatTooltipValue/,
  "Portfolio tooltips must format values in Indian currency or count notation.");
assert.match(analytics, /parseIndianAmount\(row\.value\) === null/,
  "Portfolio coverage must correctly recognize Indian shorthand values.");
assert.match(analytics, /cashflowRows\.every\(row => row\.count === 0\)/,
  "Cashflow empty state must use the selected date range.");
assert.match(theme, /\.ax-modern-shell \.ax-analytics-panel\s*\{[^}]*background:\s*linear-gradient\(145deg,#132638 0%,#0d1f2e 100%\)/s,
  "Analytics surfaces must follow the Night Marine visual system.");
assert.match(theme, /\.ax-modern-shell \.ax-chart-type button\[aria-pressed="true"\]/,
  "Selected chart controls must have a clear visual treatment tied to their accessible state.");


assert.match(table, /aria-rowcount=\{headerRowCount\+Math\.max\(rows\.length,1\)\}/,
  "Virtualized tables must expose filtered rows and grouped headers accurately to assistive technology.");
assert.match(table, /aria-rowindex=\{v\.index\+headerRowCount\+1\}/,
  "Virtualized rows must preserve their absolute position after all grouped header rows.");
assert.match(table, /<tr aria-rowindex=\{headerRowCount\+1\}/,
  "Virtualized table empty states must have a correct absolute row index.");
assert.match(table, /aria-sort=\{/,
  "Column headers must expose the current sort direction.");
assert.match(table, /Showing \{rows\.length\.toLocaleString\("en-IN"\)\} of \{data\.length\.toLocaleString\("en-IN"\)\} records/,
  "Table result summaries must distinguish filtered records from the complete dataset.");
assert.match(theme, /\.ax-modern-shell \.ax-enterprise-grid__viewport\s*\{[\s\S]*?overscroll-behavior:\s*contain/,
  "Virtualized table scrolling must remain contained within its own viewport.");
assert.match(theme, /\.ax-modern-shell \.ax-enterprise-grid__sort\s*\{[^}]*min-height:\s*44px/s,
  "Table sort controls must provide touch-friendly targets.");


assert.match(theme, /\.ax-modern-shell \.ax-followup-form \.ax-followup-contact-picker\s*\{[^}]*background:\s*#102638/s,
  "Follow-up contact selection must use a readable Night Marine fieldset.");
assert.match(theme, /\.ax-modern-shell \.ax-followup-form \.ax-field-error\s*\{[^}]*color:\s*#ffc0b7/s,
  "Follow-up validation errors must be readable on dark form surfaces.");
assert.match(theme, /@media \(max-width: 640px\)\s*\{[\s\S]*?\.ax-modern-shell \.ax-followup-form \.ax-followup-contact-options\s*\{[^}]*grid-template-columns:\s*minmax\(0,1fr\)/s,
  "Follow-up contact options must collapse to a single touch-friendly column on mobile.");


assert.match(app, /import UnlumenGlowButton from "\.\/components\/UnlumenGlowButton";/,
  "AXIVESTRA must import the adapted Unlumen Glow Button.");
assert.match(app, /<UnlumenGlowButton type="button" className="hero-button"/,
  "Only the primary Overview action should use the glow button wrapper.");
assert.match(unlumenGlowButton, /ButtonHTMLAttributes<HTMLButtonElement>/,
  "The glow wrapper must preserve native button attributes and keyboard behaviour.");
assert.match(unlumenGlowButton, /className=\{\["ax-unlumen-glow-button", className\]/,
  "The wrapper must retain the existing AXIVESTRA hero-button class.");
assert.match(theme, /\.hero-button\.ax-unlumen-glow-button::before[\s\S]*?conic-gradient/,
  "The glow layer must use a CSS conic gradient behind the native action.");
assert.match(theme, /@keyframes ax-unlumen-glow-rotate/,
  "The Unlumen glow treatment must animate independently without a JS animation runtime.");
assert.match(theme, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.hero-button\.ax-unlumen-glow-button::before[\s\S]*?animation: none/,
  "The glow treatment must stop rotating when reduced motion is preferred.");
assert.match(thirdPartyNotices, /Unlumen UI[\s\S]*?MIT License[\s\S]*?Copyright \(c\) 2026 Léo Wicki/,
  "The adapted Unlumen component must retain the upstream MIT attribution and licence.");
