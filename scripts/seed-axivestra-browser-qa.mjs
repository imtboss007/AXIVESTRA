import { createHash, randomBytes, randomUUID } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { DISCOVERY_WORKSPACE_KEYS, getDefaultWorkspaceCriteria } from "../src/lib/discovery-profiles.mjs";

function required(name, ...alternates) {
  for (const key of [name, ...alternates]) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  throw new Error("Missing required local Supabase environment value: " + name);
}

function check(error, action) {
  if (error) throw new Error(action + ": " + error.message);
}

const url = required("API_URL", "SUPABASE_URL");
const anonKey = required("ANON_KEY", "SUPABASE_ANON_KEY");
const serviceKey = required("SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY");
const email = "axivestra-e2e@axivestra.local";
const password = randomBytes(32).toString("base64url");
const companyName = "AXIVESTRA Disposable Browser QA";
const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
});

const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: "AXIVESTRA CI QA Owner", display_name: "AXIVESTRA CI QA Owner" }
});
check(createUserError, "Create disposable QA owner");
const userId = createdUser.user?.id;
if (!userId) throw new Error("Supabase Auth did not return the disposable QA user ID.");

const userClient = createClient(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
});
const { error: signInError } = await userClient.auth.signInWithPassword({ email, password });
check(signInError, "Sign in disposable QA owner");

const { data: companyId, error: companyError } = await userClient.rpc("create_company_with_owner", {
  company_name: companyName
});
check(companyError, "Create disposable QA company");
if (typeof companyId !== "string") throw new Error("Company creation did not return a company UUID.");

async function insertCompanyRecord(recordType, recordKey, payload) {
  const { error } = await userClient.from("company_records").insert({
    company_id: companyId,
    record_type: recordType,
    record_key: recordKey,
    payload,
    created_by: userId,
    updated_by: userId
  });
  check(error, "Create QA " + recordType + " record");
}

const dealKey = "qa-deal-e18";
const partyKey = "qa-party-e18";
const taskKey = "qa-legacy-task-e18";
const dealTitle = "E18 QA Deal — Browser Acceptance";
const partyName = "E18 QA Buyer — Browser Acceptance";
const taskTitle = "E18 QA Legacy Task — Browser Acceptance";

await insertCompanyRecord("property", dealKey, {
  id: dealKey,
  title: dealTitle,
  name: dealTitle,
  propertyType: "Commercial",
  status: "active",
  primaryContactId: partyKey,
  moduleData: { __contact_buyer: partyKey }
});
await insertCompanyRecord("contact", partyKey, {
  id: partyKey,
  name: partyName,
  fullName: partyName,
  displayName: partyName,
  role: "Buyer",
  status: "active"
});
await insertCompanyRecord("task", taskKey, {
  id: taskKey,
  title: taskTitle,
  notes: "Disposable QA task for E18 one-time source linking.",
  priority: "normal",
  nextAction: "review_internal",
  propertyId: dealKey,
  contactId: partyKey,
  done: false
});

const { data: relationship, error: relationshipError } = await userClient
  .from("company_deal_parties")
  .insert({
    company_id: companyId,
    deal_record_key: dealKey,
    party_record_key: partyKey,
    role_code: "buyer",
    responsibility_code: "decision_maker",
    verification_state: "unverified",
    created_by: userId,
    updated_by: userId
  })
  .select("id")
  .single();
check(relationshipError, "Create explicit E16 QA relationship");

const { data: source, error: sourceError } = await admin
  .from("discovery_source_registry")
  .insert({
    company_id: companyId,
    name: "Synthetic AXIVESTRA CI Evidence Source",
    canonical_url: "https://example.invalid/axivestra-ci-evidence",
    domain: "example.invalid",
    source_type: "manual_research",
    connector_key: "manual_research",
    jurisdiction: "IN",
    access_method: "synthetic_fixture_only",
    legal_basis: "Synthetic, non-production CI fixture; no external source accessed.",
    policy_notes: "Disposable CI fixture. Never used for live discovery.",
    attribution: "Synthetic evidence generated inside GitHub Actions.",
    license_ref: "CC0-1.0",
    created_by: userId,
    updated_by: userId
  })
  .select("id")
  .single();
check(sourceError, "Create synthetic E04 source");

const { data: profile, error: profileError } = await admin
  .from("discovery_profiles")
  .insert({
    company_id: companyId,
    workspace_key: "property_sale",
    discovery_mode: "LENDER",
    jurisdiction: "IN",
    purpose: "Synthetic browser acceptance fixture only.",
    enabled: false,
    criteria: {},
    created_by: userId,
    updated_by: userId
  })
  .select("id")
  .single();
check(profileError, "Create disabled synthetic discovery profile");

// The browser demo is isolated in this disposable QA company. Create one disabled
// profile for every workspace/mode combination. No source is attached and no
// external search or fetch is executed by these fixtures.
const additionalProfileRows = [];
for (const workspaceKey of DISCOVERY_WORKSPACE_KEYS) {
  for (const discoveryMode of ["LENDER", "CUSTOMER"]) {
    if (workspaceKey === "property_sale" && discoveryMode === "LENDER") continue;
    additionalProfileRows.push({
      company_id: companyId,
      workspace_key: workspaceKey,
      discovery_mode: discoveryMode,
      jurisdiction: "IN",
      purpose: "Synthetic removable browser demo only · " + workspaceKey + " · " + discoveryMode,
      enabled: false,
      criteria: getDefaultWorkspaceCriteria(workspaceKey, discoveryMode),
      created_by: userId,
      updated_by: userId
    });
  }
}
const { error: moduleProfilesError } = await admin
  .from("discovery_profiles")
  .insert(additionalProfileRows);
check(moduleProfilesError, "Create isolated 16-workspace × 2-mode demo profiles");

const { count: demoProfileCount, error: demoCountError } = await admin
  .from("discovery_profiles")
  .select("id", { count: "exact", head: true })
  .eq("company_id", companyId);
check(demoCountError, "Verify isolated demo profile count");
if (demoProfileCount !== DISCOVERY_WORKSPACE_KEYS.length * 2) {
  throw new Error("The disposable QA company must contain exactly 32 synthetic workspace profiles.");
}

const { data: job, error: jobError } = await admin
  .from("discovery_jobs")
  .insert({
    company_id: companyId,
    profile_id: profile.id,
    source_id: source.id,
    requested_by: userId,
    status: "succeeded",
    payload: { fixture: "browser-acceptance", externalFetchPermitted: false },
    idempotency_key: "axivestra-e2e-" + randomUUID()
  })
  .select("id")
  .single();
check(jobError, "Create synthetic completed discovery job");

const evidenceHash = createHash("sha256")
  .update("AXIVESTRA synthetic CI evidence; no external source data.")
  .digest("hex");
const { data: evidence, error: evidenceError } = await admin
  .from("discovery_evidence_items")
  .insert({
    company_id: companyId,
    job_id: job.id,
    source_id: source.id,
    canonical_url: "https://example.invalid/axivestra-ci-evidence",
    content_hash: evidenceHash,
    raw_blob_ref: "qa://synthetic/axivestra-e2e-evidence",
    content_type: "text/plain",
    byte_length: 58,
    attribution: "Synthetic evidence generated inside GitHub Actions.",
    jurisdiction: "IN",
    licence_snapshot: { license_ref: "CC0-1.0", retention_days: 90, synthetic: true },
    response_metadata: { synthetic: true, externalRequestMade: false }
  })
  .select("id")
  .single();
check(evidenceError, "Create synthetic E04 evidence metadata");

const { data: canonicalEntity, error: canonicalError } = await admin
  .from("discovery_canonical_entities")
  .insert({
    company_id: companyId,
    entity_kind: "organization",
    legal_name: "AXIVESTRA Synthetic QA Organization",
    normalized_name: "axivestra synthetic qa organization",
    jurisdiction: "IN",
    entity_type: "company",
    source_evidence_id: evidence.id,
    created_by: userId
  })
  .select("id")
  .single();
check(canonicalError, "Create synthetic E06 canonical entity");

const { data: provenance, error: provenanceError } = await admin
  .from("discovery_provenance_events")
  .select("id")
  .eq("company_id", companyId)
  .eq("subject_kind", "canonical_entity")
  .eq("subject_id", canonicalEntity.id)
  .eq("event_type", "canonical_entity_created")
  .limit(1)
  .maybeSingle();
check(provenanceError, "Read generated E13 provenance");
if (!provenance?.id) {
  throw new Error("E13 did not generate provenance for the synthetic canonical entity; do not skip the E21/E19 acceptance tests.");
}

const { data: verificationCase, error: verificationError } = await admin
  .from("discovery_verification_inbox")
  .select("id")
  .eq("company_id", companyId)
  .eq("subject_kind", "canonical_entity")
  .eq("subject_id", canonicalEntity.id)
  .maybeSingle();
check(verificationError, "Read generated E19 verification case");
if (!verificationCase?.id) throw new Error("E19 did not open the synthetic canonical-entity verification case.");

const { data: matchResult, error: matchError } = await admin
  .from("discovery_match_results")
  .insert({
    company_id: companyId,
    canonical_entity_id: canonicalEntity.id,
    workspace_key: "property_sale",
    discovery_mode: "LENDER",
    criteria_version: "e11_qa_fixture_v1",
    criteria_snapshot: { geography: "IN", type: "company", fixture: true },
    candidate_snapshot: { legal_name: "AXIVESTRA Synthetic QA Organization", fixture: true },
    score: 82,
    confidence: 0.91,
    eligible: true,
    method: "deterministic_weighted_rules_v1",
    positive_factors: [{ criterion: "geography", status: "match" }],
    negative_factors: [],
    unknown_criteria: [],
    blockers: [],
    created_by: userId
  })
  .select("id")
  .single();
check(matchError, "Create synthetic E11 deterministic match");

const { error: customerMatchError } = await admin
  .from("discovery_match_results")
  .insert({
    company_id: companyId,
    canonical_entity_id: canonicalEntity.id,
    workspace_key: "startup",
    discovery_mode: "CUSTOMER",
    criteria_version: "e11_qa_customer_fixture_v1",
    criteria_snapshot: { geography: "IN", type: "company", fixture: true, mode: "CUSTOMER" },
    candidate_snapshot: { legal_name: "AXIVESTRA Synthetic QA Organization", fixture: true },
    score: 76,
    confidence: 0.88,
    eligible: true,
    method: "deterministic_weighted_rules_v1",
    positive_factors: [{ criterion: "geography", status: "match" }],
    negative_factors: [],
    unknown_criteria: [],
    blockers: [],
    created_by: userId
  });
check(customerMatchError, "Create synthetic E11 customer-mode match");

const requestHash = createHash("sha256")
  .update(JSON.stringify({
    companyId,
    matchResultId: matchResult.id,
    evidenceId: evidence.id,
    policy: "e22_advisory_matching_v1"
  }))
  .digest("hex");
const suggestion = {
  schemaVersion: "axivestra.ai-match-suggestion.v1",
  policyVersion: "e22_advisory_matching_v1",
  requestHash,
  recommendation: "possible_match",
  advisoryScore: 84,
  scoreMeaning: "ordinal advisory score; not a probability or approval",
  reasons: [{ criterion: "geography", code: "aligned", evidenceIds: [evidence.id] }],
  requiresHumanReview: true,
  automaticDecisionAllowed: false,
  canonicalMutationAllowed: false,
  leadPromotionAllowed: false
};
const { data: suggestionId, error: suggestionError } = await admin.rpc(
  "record_discovery_ai_match_suggestion",
  {
    p_company_id: companyId,
    p_match_result_id: matchResult.id,
    p_request_hash: requestHash,
    p_provider_id: "synthetic-ci-fixture",
    p_model_version: "fixture-v1",
    p_suggestion: suggestion,
    p_evidence_ids: [evidence.id],
    p_reason: "Synthetic E22 pending suggestion created only for disposable browser acceptance."
  }
);
check(suggestionError, "Create synthetic E22 pending suggestion");
if (typeof suggestionId !== "string") throw new Error("E22 did not return a suggestion ID.");

const githubEnv = process.env.GITHUB_ENV;
if (!githubEnv) throw new Error("GITHUB_ENV is required so the browser test job can receive disposable local fixture settings.");
const envLines = [
  "VITE_SUPABASE_URL=" + url,
  "VITE_SUPABASE_ANON_KEY=" + anonKey,
  "AXIVESTRA_E2E_EMAIL=" + email,
  "AXIVESTRA_E2E_PASSWORD=" + password,
  "AXIVESTRA_E2E_COMPANY_NAME=" + companyName,
  "AXIVESTRA_E2E_DISCOVERY_PROFILE_COUNT=32",
  "AXIVESTRA_E2E_DEAL_TITLE=" + dealTitle,
  "AXIVESTRA_E2E_PARTY_NAME=" + partyName,
  "AXIVESTRA_E2E_RELATIONSHIP_LABEL=buyer",
  "AXIVESTRA_E2E_LEGACY_TASK_TITLE=" + taskTitle,
  "AXIVESTRA_E2E_VERIFICATION_SUBJECT_ID=" + canonicalEntity.id,
  "AXIVESTRA_E2E_E22_SUGGESTION_ID=" + suggestionId,
  "AXIVESTRA_E2E_E21_PROVENANCE_EVENT_ID=" + provenance.id
];
await appendFile(githubEnv, envLines.join("\n") + "\n", "utf8");

console.log("Disposable local QA fixtures created successfully.");
console.log("QA company, 32 synthetic discovery profiles (16 workspaces × 2 modes), E16 relationship, E19 case, E21 provenance citation and E22 pending suggestion: PASS.");
console.log("No hosted Supabase project, real company data, live source or external provider was accessed.");
