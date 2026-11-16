import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), "utf8");
const sql = read("supabase/schema.sql");
const app = read("src/main.tsx");
const failures = [];
let passed = 0;

function check(label, condition) {
  try {
    assert.ok(condition, label);
    passed += 1;
    process.stdout.write("PASS  " + label + "\n");
  } catch (error) {
    failures.push(label);
    process.stderr.write("FAIL  " + label + ": " + error.message + "\n");
  }
}

check("all website data tables enable row-level security",
  ["website_admins", "website_settings", "website_pages", "website_leads"]
    .every(name => new RegExp("alter table public\\." + name + " enable row level security", "i").test(sql)));

check("website administrator access is allowlisted by Supabase user ID",
  /create table if not exists public\.website_admins[\s\S]*user_id uuid primary key references auth\.users/i.test(sql) &&
  /public\.is_website_admin\(\)/i.test(sql) &&
  /from public\.website_admins[\s\S]*where a\.user_id = auth\.uid\(\)/i.test(sql));

check("public users cannot read website enquiry records",
  /grant insert on table public\.website_leads to anon, authenticated/i.test(sql) &&
  !/grant select[^;]*website_leads to anon/i.test(sql) &&
  /website admins can read enquiries[\s\S]*on public\.website_leads for select to authenticated[\s\S]*public\.is_website_admin\(\)/i.test(sql));

check("only published website pages are public",
  /public can read published website pages[\s\S]*on public\.website_pages for select to anon, authenticated[\s\S]*status = 'published'/i.test(sql));

check("website admins are required for page and settings changes",
  /website admins manage settings[\s\S]*public\.is_website_admin\(\)/i.test(sql) &&
  /website admins manage pages[\s\S]*public\.is_website_admin\(\)/i.test(sql));

check("admin console checks the website_admins table after login",
  /from\("website_admins"\)\.select\("role"\)/i.test(app) &&
  /This account is not yet authorised/i.test(app));

check("public enquiry form writes only to website_leads and requires consent",
  /from\("website_leads"\)\.insert/i.test(app) &&
  /if \(!consent\)/i.test(app) &&
  /consent: true/i.test(app));

check("browser code does not contain a Supabase service-role key",
  !/SUPABASE_SERVICE_ROLE_KEY|service_role/i.test(app) &&
  !/SUPABASE_SERVICE_ROLE_KEY|service_role/i.test(read("index.html")));

check("admin access can be provisioned without embedding a secret",
  /insert into public\.website_admins[\s\S]*select id, 'owner'[\s\S]*from auth\.users/i.test(read("README.md")));

check("standalone website package exposes build and test scripts",
  /"build": "tsc -b && vite build"/.test(read("package.json")) &&
  /"test": "node scripts\/website-security-contract\.test\.mjs"/.test(read("package.json")));

process.stdout.write("\n" + passed + " website security-contract checks passed.\n");
if (failures.length) {
  process.stderr.write(failures.length + " website security-contract check(s) failed.\n");
  process.exitCode = 1;
}
