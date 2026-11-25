import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration=await readFile(new URL("../../../supabase/migrations/20261125110000_axivestra_legacy_relationship_backfill.sql",import.meta.url),"utf8");

test("E16.1 backfill is dry-run by default and requires explicit apply",()=>{
  assert.match(migration,/p_apply boolean default false/);
  assert.match(migration,/if coalesce(p_apply,false) then[\s\S]*?insert into public\.company_deal_parties/);
  assert.match(migration,/dry_run',not coalesce(p_apply,false)/);
  assert.match(migration,/call again with p_apply=true/);
});

test("E16.1 backfill requires company owner/admin and is bounded",()=>{
  assert.match(migration,/public\.has_company_role\(p_company_id,array\['owner','admin'\]\)/);
  assert.match(migration,/p_limit>10000/);
  assert.match(migration,/p_limit integer default 5000/);
});

test("E16.1 uses only explicit saved contact IDs and ignores deleted or missing contacts",()=>{
  assert.match(migration,/primaryContactId/);
  assert.match(migration,/__linkedContactIds/);
  assert.match(migration,/__contact_/);
  assert.match(migration,/c\.record_type='contact'/);
  assert.match(migration,/c\.deleted_at is null/);
  assert.match(migration,/d\.deleted_at is null/);
  assert.doesNotMatch(migration,/__followUpContactIds|ilike|similarity\(|levenshtein\(|soundex\(/i);
});

test("E16.1 backfilled links are unverified, idempotent and never inferred from names",()=>{
  assert.match(migration,/'unverified'/);
  assert.match(migration,/on conflict\(company_id,deal_record_key,party_record_key,role_code,effective_from\) do nothing/);
  assert.match(migration,/'legacy_backfill',true/);
  assert.match(migration,/No names were matched/);
  assert.doesNotMatch(migration,/verification_state\s*,\s*'verified'|evidence_supported/);
});

test("E16.1 is not an automatic migration-time data rewrite",()=>{
  const functionStart=migration.indexOf("create or replace function public.backfill_company_deal_parties_from_legacy_links");
  const insertStart=migration.indexOf("insert into public.company_deal_parties");
  assert.ok(functionStart>=0 && insertStart>functionStart,"The insert must be inside the opt-in RPC, not at migration time.");
  assert.match(migration,/create or replace function public\.backfill_company_deal_parties_from_legacy_links/);
});
