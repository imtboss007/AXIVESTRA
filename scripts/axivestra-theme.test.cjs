const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "src", "main.tsx"), "utf8");
const theme = fs.readFileSync(path.join(root, "src", "axivestra-theme.css"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

assert.match(main, /import "\.\/styles\.css";[\s\S]*import "\.\/axivestra-theme\.css";/,
  "The enterprise theme must load after existing styles.");
assert.match(app, /className=\{company\?\.role === "read_only" \? "app-shell ax-modern-shell workspace-readonly" : "app-shell ax-modern-shell"\}/,
  "The theme must stay scoped to the existing AXIVESTRA application shell.");

const requiredTokens = [
  "--axiv-canvas: #f3f6f5",
  "--axiv-surface: #ffffff",
  "--axiv-ink: #20343d",
  "--axiv-primary: #246a67",
  "--axiv-navy: #173746",
  "--axiv-brass: #a77f48"
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
assert.match(theme, /\.auth-card\s*\{[^}]*background:\s*#fff/s,
  "The authentication card must use the shared white surface.");
assert.match(theme, /\.auth-primary[\s\S]*?background:\s*var\(--axiv-primary\)/,
  "The authentication primary action must use the shared muted teal token.");

function luminance(hex) {
  const channels = hex.replace("#", "").match(/.{2}/g).map(value => parseInt(value, 16) / 255);
  const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
assert.ok(contrast("#20343d", "#f3f6f5") >= 7,
  "Main text must meet a strong contrast target on the canvas.");
assert.ok(contrast("#5b6d75", "#ffffff") >= 4.5,
  "Muted text must remain readable on white surfaces.");
assert.ok(contrast("#ffffff", "#246a67") >= 4.5,
  "Primary button text must be readable against its fill.");

console.log("AXIVESTRA enterprise design-system contract passed.");
