import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const moduleText=await readFile(new URL("../../discovery-worker/matching.mjs",import.meta.url),"utf8");
const migration=await readFile(new URL("../../../supabase/migrations/20261122250000_discovery_matching.sql",import.meta.url),"utf8");
const profileMigration=await readFile(new URL("../../../supabase/migrations/20261122150000_discovery_source_governance.sql",import.meta.url),"utf8");

test("E11 is a deterministic configurable rules engine across all eight matrix dimensions",()=>{
  for(const dimension of ["geography","type","ticket","instrument","collateral","stage","mandate","evidence_freshness"]){
    assert.match(moduleText,new RegExp('"' + dimension + '"'));
  }
  assert.match(moduleText,/deterministic-rules-v1/);
  assert.match(moduleText,/no conversion|Currency differs/);
  assert.match(moduleText,/reviewState === "accepted"/);
  assert.match(moduleText,/buildMatchScoreRecord/);
  assert.match(moduleText,/createHash/);
});

test("E11 persists explainability, confidence, evidence references and human review state",()=>{
  for(const name of ["match_score","confidence","coverage","score_components","rationale","evidence_refs","criteria_snapshot","candidate_snapshot","review_state"]){
    assert.match(migration,new RegExp(name));
  }
  assert.match(migration,/record_discovery_match_review/);
  assert.match(migration,/owner or admin/);
  assert.match(profileMigration,/criteria jsonb not null/);
});

test("E11 does not add autonomous lead creation, outreach, underwriting or AI scoring",()=>{
  assert.doesNotMatch(migration,/insert into public\.(leads|contacts|investors|borrowers)/i);
  assert.doesNotMatch(moduleText,/fetch\s*\(|axios|https?\.request|openai|anthropic|llm/i);
  assert.match(moduleText,/reviewState:"pending_review"/);
  assert.match(moduleText,/safeCandidateSnapshot/);
  assert.match(moduleText,/entityKind:"organization"/);
  assert.match(moduleText,/contactEmail/);
});
