"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const gate = read("src/AuthGate.tsx");
const app = read("src/App.tsx");
const checks = [
  ["local workspace choice is available before login", /Continue locally without login/.test(gate)],
  ["local workspace choice is also available for signed-in users", /Use this device locally/.test(gate)],
  ["local mode persists across app restarts", /axivestra\.workspaceMode[\s\S]{0,100}local/.test(gate)],
  ["entering local mode clears only active cloud scope selectors", /const enterLocalMode = \(\) => \{[\s\S]{0,500}removeItem\("axivestra\.activeCompanyId"\)[\s\S]{0,200}removeItem\("axivestra\.activePersonalUserId"\)[\s\S]{0,120}setItem\("axivestra\.workspaceMode", "local"\)/.test(gate)],
  ["local mode does not require sign-out or destroy the account session", /if \(localMode\) return <App onSwitchCompany=\{switchToCloudMode\} \/>/.test(gate)],
  ["local mode can return to cloud login from Settings", /Sign in \/ switch to cloud mode/.test(app)],
  ["workspace export uses a versioned envelope", /createWorkspaceBackup\([\s\S]{0,350}properties, contacts, whatsappGroups: savedWhatsAppGroups, tasks/.test(app)],
  ["workspace import persists to the active scope before updating state", /parseWorkspaceBackup\(parsed\)[\s\S]{0,2500}persistImportedWorkspaceCollections\(collections\)[\s\S]{0,900}setProperties\(collections\.properties/.test(app)],
  ["workspace restore confirms only after records are persisted", /persistImportedWorkspaceCollections\(collections\)[\s\S]{0,1400}Workspace backup imported and saved/.test(app)],
  ["JSON import chooser is attached, cancel-aware and bounded", /async function chooseJsonBackupText[\s\S]{0,2400}input\.addEventListener\("cancel",[\s\S]{0,900}document\.body\.appendChild\(input\)[\s\S]{0,120}input\.click\(\)[\s\S]{0,300}120000/.test(app)],
  ["Document Vault import uses the cross-platform chooser", /const importDocumentVault = async \(\) => \{[\s\S]{0,1000}chooseJsonBackupText\(\)/.test(app)],
  ["older mobile WebViews have a FileReader fallback", /async function readBrowserFileText[\s\S]{0,500}new FileReader\(\)/.test(app)],
  ["download URL is revoked after a delay", /window\.setTimeout\(\(\) => URL\.revokeObjectURL\(url\), 60000\)/.test(app)],
  ["document-file backup remains explicitly separate", /document files are backed up separately from the Documents workspace/.test(app)]
];

let failures = 0;
for (const [label, ok] of checks) {
  process.stdout.write((ok ? "PASS " : "FAIL ") + label + "\n");
  if (!ok) failures++;
}
if (failures) {
  process.stderr.write(failures + " local-first regression checks failed.\n");
  process.exitCode = 1;
} else {
  process.stdout.write(checks.length + " local-first regression checks passed.\n");
}
