import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration=await readFile(new URL("../../../supabase/migrations/20261122310000_axivestra_deal_party_relationships.sql",import.meta.url),"utf8");

test("E16 creates normalized company-scoped deal-party links using stable record IDs",()=>{
  assert.match(migration,/create table if not exists public\.company_deal_parties/);
  assert.match(migration,/foreign key\(company_id,deal_record_type,deal_record_key\)/);
  assert.match(migration,/foreign key\(company_id,party_record_type,party_record_key\)/);
  assert.match(migration,/references public\.company_records\(company_id,record_type,record_key\)/);
  assert.match(migration,/unique\(company_id,deal_record_key,party_record_key,role_code,effective_from\)/);
  assert.match(migration,/role_code text not null check/);
  assert.doesNotMatch(migration,/display_name|similarity\(/i);
});

test("E16 supports transaction-specific roles, responsibility, authority and effective dates",()=>{
  for(const role of ["owner","buyer","seller","borrower","lender","guarantor","investor","advisor","broker","tenant","developer","advocate","mediator","introducer","partner"])
    assert.match(migration,new RegExp("'" + role + "'"));
  for(const field of ["responsibility_code","authority_scope","effective_from","effective_to"])
    assert.match(migration,new RegExp(field));
  assert.match(migration,/effective_to>=effective_from/);
});

test("E16 requires evidence for evidence-supported or verified party relationships",()=>{
  assert.match(migration,/verification_state in \('evidence_supported','verified'\) and evidence_record_key is not null/);
  assert.match(migration,/evidence_record_type text not null default 'document_metadata'/);
  assert.match(migration,/Deleted evidence metadata cannot verify a deal-party link/);
});

test("E16 enforces tenant membership, write roles and immutable relationship identity",()=>{
  assert.match(migration,/public\.is_company_member\(company_id\)/);
  assert.match(migration,/public\.has_company_role\(company_id,array\['owner','admin','manager','staff'\]\)/);
  assert.match(migration,/old\.deal_record_key is distinct from new\.deal_record_key/);
  assert.match(migration,/old\.party_record_key is distinct from new\.party_record_key/);
  assert.match(migration,/old\.role_code is distinct from new\.role_code/);
  assert.match(migration,/Deal-party links cannot be deleted/);
  assert.match(migration,/revoke all on public\.company_deal_parties,public\.company_deal_party_events/);
});

test("E16 protects active relationship records and verification evidence from soft deletion",()=>{
  assert.match(migration,/prevent_company_record_soft_delete_with_party_links/);
  assert.match(migration,/active deal-party relationship or its verification evidence prevents soft deletion/);
  assert.match(migration,/p\.verification_state in \('evidence_supported','verified'\)/);
});

test("E16 records append-only party relationship history",()=>{
  assert.match(migration,/create table if not exists public\.company_deal_party_events/);
  assert.match(migration,/party_link_created/);
  assert.match(migration,/party_link_updated/);
  assert.match(migration,/before update or delete on public\.company_deal_party_events/);
  assert.match(migration,/Deal-party history is immutable/);
  assert.match(migration,/after insert or update on public\.company_deal_parties/);
});

test("E16 is additive and preserves existing record payloads",()=>{
  assert.match(migration,/Additive foundation over existing company_records/);
  assert.doesNotMatch(migration,/update public\.company_records|delete from public\.company_records/i);
});
