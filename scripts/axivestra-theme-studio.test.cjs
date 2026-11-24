const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const studio = fs.readFileSync(path.join(root, "src", "ThemeStudio.tsx"), "utf8");
const helper = fs.readFileSync(path.join(root, "src", "lib", "theme-preferences.ts"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");

for (const name of [
  "AXIVESTRA Signature", "Titanium Graphite", "Obsidian Emerald", "Midnight Sapphire",
  "Carbon Precision", "Platinum Light", "Arctic Ice", "Warm Sand", "Deep Violet", "Custom Theme"
]) assert.ok(studio.includes(name) || helper.includes(name), "Missing theme option: " + name);

for (const section of ["Asset Intelligence", "Workspace Explorer", "Intelligence Hub", "AXIVESTRA Shift"]) {
  assert.ok(app.includes(section), "Existing application section was unexpectedly removed: " + section);
}
assert.match(app,/import ThemeStudio from "\.\/ThemeStudio"/,"Theme Studio must use the existing React application.");
assert.match(app,/<ThemeStudio\s*\/>/,"Theme Studio must be mounted in existing Settings.");
assert.match(app,/applyThemePreferences\(savedTheme\)/,"Saved appearance must load during normal application startup.");
assert.match(helper,/THEME_STORAGE_KEY\s*=\s*"axivestra\.themePreferences\.v1"/,"Theme preferences must have a stable local key.");
assert.match(helper,/localStorage\.setItem/,"Theme preferences must persist locally.");
assert.match(helper,/data-ax-theme-mode/,"Light/dark/system mode must be applied to the actual app shell.");
assert.match(helper,/export function getContrastRatio/,"Theme contrast must be calculated from selected colours.");
assert.match(helper,/export function getReadableForeground/,"Theme must derive a readable foreground when contrast is too low.");
assert.match(helper,/getReadableForeground\(palette\[foregroundField\],palette\[backgroundField\]\)/,"Every text/background pairing must be guarded.");
assert.match(studio,/4\.5:1/,"Theme Studio must explain its AA contrast guard.");
assert.match(helper,/^export function clearThemeApplication/m,"Cancel must be able to restore the unthemed current application.");
assert.match(studio,/aria-pressed/,"Theme choices must expose selected state accessibly.");
assert.match(studio,/STYLE PREVIEW · SAMPLE ONLY/,"Theme preview must not present invented figures as live business data.");
assert.doesNotMatch(studio,/₹2\.45 Cr|Open actions<\/small><strong>08/,"Theme preview must not display fabricated business metrics.");
assert.match(studio,/type="color"/,"The palette must include a colour picker.");
assert.match(studio,/type="text" value=\{palette\[key\]\.toUpperCase\(\)\}/,"The palette must include editable HEX values.");
assert.match(css,/\.ax-modern-shell\[data-ax-theme\]/,"Theme values must style the existing application shell.");
assert.match(css,/@media\s*\(max-width:\s*720px\)[\s\S]*?\.ax-theme-studio__palette/,"Theme Studio must have a mobile-responsive palette layout.");
assert.match(css,/@media\s*\(prefers-reduced-motion:\s*reduce\)/,"Theme preview must respect reduced-motion preferences.");
console.log("AXIVESTRA Theme Studio contract passed.");
