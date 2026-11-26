const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const workbench = fs.readFileSync(path.join(root, "src", "ModuleWorkbench.tsx"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");

for (const field of ["tasks: RelatedTask[]","documents: RelatedDocument[]","financials: RelatedFinancial[]","onOpenContact: (id:string) => void","onOpenTask: (id:string) => void","onOpenFinancial: (id:string) => void","onOpenDocument: (id:string) => void"]) {
  assert.ok(workbench.includes(field), "ModuleWorkbench is missing " + field);
}
assert.match(workbench,/linkedByStableIds\s*=\s*\(record:ModuleRecord\)\s*=>\s*Array\.from\(new Set\(contactIds\(record\)\.filter\(id=>contactsById\.has\(id\)\)\)\)/, "Contact shortcuts must be based on saved contact IDs.");
assert.match(workbench,/tasks\.filter\(item=>item\.propertyId===record\.id \|\| Boolean\(item\.contactId && ids\.has\(item\.contactId\)\)\)/, "Tasks must connect by saved property/contact IDs.");
assert.match(workbench,/documents\.filter\(item=>item\.propertyId===record\.id \|\| Boolean\(item\.contactId && ids\.has\(item\.contactId\)\)\)/, "Documents must connect by saved property/contact IDs.");
assert.match(workbench,/financials\.filter\(item=>item\.propertyId===record\.id \|\| Boolean\(item\.contactId && ids\.has\(item\.contactId\)\)\)/, "Financials must connect by saved property/contact IDs.");
assert.match(workbench,/onOpenContact\(id\)/,"Related contact link must be actionable.");
assert.match(workbench,/onOpenTask\(item\.id\)/,"Related task link must be actionable.");
assert.match(workbench,/onOpenFinancial\(item\.id\)/,"Related financial link must be actionable.");
assert.match(workbench,/onOpenDocument\(item\.id\)/,"Related document link must be actionable.");
for (const callback of ["onOpenContact={id=>","onOpenTask={id=>","onOpenFinancial={id=>","onOpenDocument={id=>"]) {
  assert.ok(app.includes(callback), "App is missing cross-workspace callback " + callback);
}
assert.match(app,/contacts\.find\(item=>item\.id===id\)/,"Contact navigation must resolve by ID.");
assert.match(app,/tasks\.find\(task=>task\.id===id\)/,"Task navigation must resolve by ID.");
assert.match(app,/financials\.find\(financial=>financial\.id===id\)/,"Financial navigation must resolve by ID.");
assert.match(app,/documents\.find\(document=>document\.id===id\)/,"Document navigation must resolve by ID.");
assert.match(css,/\.ax-module-related-records__groups/,"Connected record actions must have a visual layout.");
assert.match(css,/@media\(max-width:640px\)\s*\{\s*\.ax-module-related-records__groups/,"Connected record actions must stack on mobile.");
console.log("AXIVESTRA stable-ID cross-workspace navigation contract passed.");
