import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration=await readFile(new URL("../../../supabase/migrations/20261122320000_axivestra_relationship_graph.sql",import.meta.url),"utf8");
const ui=await readFile(new URL("../../../src/NormalizedRelationshipGraphPanel.tsx",import.meta.url),"utf8");

test("E17 graph is sourced exclusively from explicit E16 relationship records",()=>{
  assert.match(migration,/from public\.company_deal_parties p/);
  assert.match(migration,/create or replace view public\.company_relationship_graph/);
  assert.match(migration,/relationship_id/);
  assert.match(migration,/deal_record_key/);
  assert.match(migration,/party_record_key/);
  assert.doesNotMatch(migration,/similarity\(|levenshtein\(|soundex\(/i);
});

test("E17 graph labels are minimised and exclude full source payloads",()=>{
  assert.match(migration,/d\.payload->>'title'/);
  assert.match(migration,/c\.payload->>'name'/);
  assert.doesNotMatch(migration,/select .*payload\s*,/is);
  assert.match(migration,/security_invoker=true/);
});

test("E17 returns date-aware nodes, edges, provenance evidence and verification counts",()=>{
  for(const field of ["p_as_of_date","effective_from","effective_to","verification_state","evidence_record_key","relationship_count","verified_count","disputed_count"])
    assert.match(migration,new RegExp(field));
  assert.match(migration,/'nodes',v_nodes,'edges',v_edges/);
});

test("E17 graph reads require authenticated company membership and least-privilege execution",()=>{
  assert.match(migration,/auth\.uid\(\) is null or not public\.is_company_member\(p_company_id\)/);
  assert.match(migration,/revoke all on function public\.get_company_relationship_graph\(uuid,date\) from public,anon/);
  assert.match(migration,/grant execute on function public\.get_company_relationship_graph\(uuid,date\) to authenticated/);
  assert.match(migration,/revoke all on public\.company_relationship_graph from public,anon,authenticated/);
});

test("E17 filters deleted source records and does not create or mutate relationship identities",()=>{
  assert.match(migration,/d\.deleted_at is null/);
  assert.match(migration,/c\.deleted_at is null/);
  assert.doesNotMatch(migration,/insert into public\.company_deal_parties|update public\.company_deal_parties|delete from public\.company_deal_parties/i);
});

test("E17 overview panel reads the company graph and supports evidence-backed relationship review",()=>{
  assert.match(ui,/get_company_relationship_graph/);
  assert.match(ui,/company_deal_parties/);
  assert.match(ui,/verification_state/);
  assert.match(ui,/document_metadata/);
  assert.match(ui,/evidence_supported.*verified|verified.*evidence_supported/);
  assert.match(ui,/No identity was inferred/);
});
