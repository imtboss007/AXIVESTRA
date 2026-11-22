const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "src", "main.tsx"), "utf8");
const theme = fs.readFileSync(path.join(root, "src", "axivestra-theme.css"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const orbitalHub = fs.readFileSync(path.join(root, "src", "AxivestraOrbitalHub.tsx"), "utf8");
const analytics = fs.readFileSync(path.join(root, "src", "PortfolioAnalytics.tsx"), "utf8");
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


assert.match(table, /aria-rowcount=\{rows\.length\+1\}/,
  "Virtualized tables must expose their filtered row count to assistive technology.");
assert.match(table, /aria-rowindex=\{v\.index\+2\}/,
  "Virtualized rows must preserve their absolute position in the filtered result.");
assert.match(table, /aria-sort=\{/,
  "Column headers must expose the current sort direction.");
assert.match(table, /Showing \{rows\.length\.toLocaleString\("en-IN"\)\} of \{data\.length\.toLocaleString\("en-IN"\)\} records/,
  "Table result summaries must distinguish filtered records from the complete dataset.");
assert.match(theme, /\.ax-modern-shell \.ax-enterprise-grid__viewport\s*\{[\s\S]*?overscroll-behavior:\s*contain/,
  "Virtualized table scrolling must remain contained within its own viewport.");
assert.match(theme, /\.ax-modern-shell \.ax-enterprise-grid__sort\s*\{[^}]*min-height:\s*44px/s,
  "Table sort controls must provide touch-friendly targets.");
