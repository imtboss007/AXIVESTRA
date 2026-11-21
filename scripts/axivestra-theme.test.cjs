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
