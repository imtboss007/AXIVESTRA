const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const auth = fs.readFileSync(path.join(root, "src", "AuthGate.tsx"), "utf8");
const entry = fs.readFileSync(path.join(root, "src", "PublicEntry.tsx"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const styles = fs.readFileSync(path.join(root, "src", "PublicEntry.css"), "utf8");
const main = fs.readFileSync(path.join(root, "src", "main.tsx"), "utf8");

assert.match(main, /import AuthGate from "\.\/AuthGate"/, "The website must enter through the single application AuthGate.");
assert.match(auth, /import PublicEntry from "\.\/PublicEntry"/, "The public website must remain available from the authenticated entry flow.");
assert.match(auth, /const \[showPublicEntry, setShowPublicEntry\] = useState\(false\)/, "The marketing page must not replace the actual app as the first screen.");
assert.match(auth, /const storedMode = localStorage\.getItem\("axivestra\.workspaceMode"\)[\s\S]{0,450}return storedMode === "local" \|\| \(storedMode !== "cloud" && !activeCloudWorkspace\)/, "A fresh browser or desktop launch must enter the app in local mode.");
assert.match(auth, /setItem\("axivestra\.workspaceMode", "cloud"\)/, "Explicit cloud access must persist across reloads.");
assert.match(auth, /<PublicEntry[\s\S]*?onSignIn=\{\(\) => setShowPublicEntry\(false\)\}/, "The public entry must lead to the existing sign-in form.");
assert.match(auth, /onContinueLocally=\{enterLocalMode\}/, "The public entry must preserve the existing local-only application mode.");
assert.match(auth, /if \(!activeCompany\)|if \(activeCompany\)/, "The existing company workspace lifecycle must remain in the AuthGate.");
assert.match(auth, /<App key=\{\"company:\" \+ activeCompany\.id\}/, "Approved company access must still open the existing application.");
assert.match(auth, /<App key=\{\"personal:\" \+ userId\}/, "Personal access must still open the existing application.");
assert.match(entry, /ASSET INTELLIGENCE/);
assert.match(entry, /Property Sale[\s\S]*?Compliance & KYC/, "The public page must describe all sixteen existing domain workspaces.");
assert.match(entry, /ONE AXIVESTRA EXPERIENCE/, "The public website must make the single-product experience explicit.");
assert.match(styles, /@media \(max-width: 720px\)/, "The public website must have a responsive mobile layout.");
assert.match(styles, /prefers-reduced-motion/, "The public website must respect reduced-motion preferences.");
assert.match(app, /name: "Property Sale"/);
assert.match(app, /name: "Compliance & KYC"/);

console.log("AXIVESTRA unified public-entry contract passed.");
