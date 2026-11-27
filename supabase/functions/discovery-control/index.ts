import { createClient } from "npm:@supabase/supabase-js@2";
import { redactExtractedFacts } from "../_shared/discovery-contact-redaction.mjs";
import { buildSearxngQueries, searchSearxng } from "../_shared/discovery-search-connectors.mjs";
import { normalizeDiscoverySearchFilters } from "../_shared/discovery-search-filters.mjs";
import { buildE11CandidateFromAcceptedObservations, scoreDiscoveryMatch } from "../_shared/discovery-matching.mjs";
import {
  normalizeSourceRegistration,
  normalizeSourceReview,
  normalizeProfile,
  assertSourceCanBeAttached,
  assertAllowedSourceUrl
} from "../_shared/discovery-policy.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store"
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
  });
}

function defaultKeyFromJson(name: string): string {
  try {
    const value = JSON.parse(Deno.env.get(name) || "{}");
    return value && typeof value.default === "string" ? value.default : "";
  } catch {
    return "";
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function writeAudit(admin: any, event: {
  company_id: string; actor_user_id: string; action: string;
  entity_type: string; entity_id: string; details?: Record<string, unknown>;
}) {
  const { error } = await admin.from("discovery_audit_events").insert({
    ...event,
    details: event.details || {}
  });
  if (error) throw new Error("The change was saved, but the audit event could not be written. Do not repeat the action blindly; contact your AXIVESTRA administrator.");
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse(405, { error: "Use POST for discovery governance actions." });

  const authorization = request.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+/i.test(authorization)) return jsonResponse(401, { error: "Sign in to AXIVESTRA first." });

  const rawBody = await request.text();
  if (rawBody.length > 64_000) return jsonResponse(413, { error: "The discovery governance request is too large." });
  let body: { companyId?: unknown; action?: unknown; payload?: unknown };
  try { body = JSON.parse(rawBody); }
  catch { return jsonResponse(400, { error: "Request body must be valid JSON." }); }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const publicKey = Deno.env.get("SUPABASE_ANON_KEY") || defaultKeyFromJson("SUPABASE_PUBLISHABLE_KEYS");
  const secretKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || defaultKeyFromJson("SUPABASE_SECRET_KEYS");
  if (!supabaseUrl || !publicKey || !secretKey) {
    console.error("discovery-control: required Supabase server environment is missing");
    return jsonResponse(503, { error: "AXIVESTRA discovery governance is not configured on this Supabase project." });
  }

  const token = authorization.replace(/^Bearer\s+/i, "");
  const userClient = createClient(supabaseUrl, publicKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
  });
  const admin = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
  });

  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  const caller = authData.user;
  if (authError || !caller) return jsonResponse(401, { error: "Your AXIVESTRA session is invalid or expired. Sign in again." });

  const companyId = body.companyId;
  if (!isUuid(companyId)) return jsonResponse(400, { error: "A valid company ID is required." });
  const action = typeof body.action === "string" ? body.action : "";
  const payload = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
    ? body.payload as Record<string, unknown> : {};

  const { data: membership, error: membershipError } = await admin
    .from("company_memberships")
    .select("role")
    .eq("company_id", companyId)
    .eq("user_id", caller.id)
    .maybeSingle();
  if (membershipError) {
    console.error("discovery-control: membership check failed", membershipError.message);
    return jsonResponse(500, { error: "Could not verify your AXIVESTRA company access." });
  }
  if (!membership) return jsonResponse(403, { error: "You do not have access to this AXIVESTRA company." });
  const canManage = ["owner", "admin"].includes(membership.role);

  try {
    if (action === "sources.list") {
      const { data, error } = await admin.from("discovery_source_registry")
        .select("*").eq("company_id", companyId).order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return jsonResponse(200, { ok: true, sources: data || [] });
    }

    if (action === "profiles.list") {
      const { data: profiles, error } = await admin.from("discovery_profiles")
        .select("*").eq("company_id", companyId).order("workspace_key").limit(100);
      if (error) throw error;
      const { data: links, error: linkError } = await admin.from("discovery_profile_sources")
        .select("profile_id,source_id,created_at").eq("company_id", companyId);
      if (linkError) throw linkError;
      return jsonResponse(200, { ok: true, profiles: profiles || [], sourceLinks: links || [] });
    }

    if (action === "search.preview") {
      if (!isUuid(payload.profileId)) return jsonResponse(400, { error: "A valid workspace discovery profile is required." });
      if (Deno.env.get("DISCOVERY_SEARXNG_ENABLED") !== "true") {
        return jsonResponse(503, { error: "The optional self-hosted search connector is disabled. Configure and enable the SearXNG service before searching." });
      }
      const searchBaseUrl = Deno.env.get("DISCOVERY_SEARXNG_URL") || "";
      const searchBearerToken = Deno.env.get("DISCOVERY_SEARXNG_BEARER_TOKEN") || "";
      if (!searchBaseUrl) return jsonResponse(503, { error: "The self-hosted SearXNG endpoint is not configured on this AXIVESTRA server." });

      const { data: profile, error: profileError } = await admin.from("discovery_profiles")
        .select("*").eq("company_id", companyId).eq("id", payload.profileId).maybeSingle();
      if (profileError) throw profileError;
      if (!profile) return jsonResponse(404, { error: "The discovery profile was not found in this company." });
      if (profile.enabled !== true) return jsonResponse(409, { error: "Enable this workspace profile before searching." });
      if (profile.criteria?.disabledByPolicy === true) return jsonResponse(403, { error: "This workspace/mode is disabled by discovery policy." });
      if (profile.workspace_key === "personal_loan" && profile.discovery_mode === "CUSTOMER") {
        return jsonResponse(403, { error: "Personal Loan borrower discovery is limited to inbound, referred, user-entered or explicitly consented intake." });
      }
      if (profile.workspace_key === "litigation" && profile.discovery_mode === "LENDER") {
        return jsonResponse(403, { error: "Litigation lender discovery remains disabled until separately configured and legally reviewed." });
      }

      const { data: links, error: linkError } = await admin.from("discovery_profile_sources")
        .select("source_id").eq("company_id", companyId).eq("profile_id", profile.id);
      if (linkError) throw linkError;
      const sourceIds = [...new Set((links || []).map((item: { source_id: string }) => item.source_id))];
      // Search can discover new candidate domains before the company has registered
      // any target source. Without a separately approved attached source, every result
      // remains unverified and fetchEligible=false; E04 still requires exact source approval.
      const sourceResult = sourceIds.length
        ? await admin.from("discovery_source_registry")
          .select("*").eq("company_id", companyId).eq("status", "approved").in("id", sourceIds).limit(100)
        : { data: [], error: null };
      if (sourceResult.error) throw sourceResult.error;
      const eligibleSources = (sourceResult.data || []).filter((source: Record<string, unknown>) => {
        if (source.connector_key === "manual_research") return false;
        try { assertSourceCanBeAttached(profile, source); return true; } catch { return false; }
      });

      const filterInput = payload.filters && typeof payload.filters === "object" && !Array.isArray(payload.filters)
        ? payload.filters as Record<string, unknown> : {};
      const filters = normalizeDiscoverySearchFilters(profile.workspace_key, profile.discovery_mode, filterInput);
      const queries = buildSearxngQueries(profile.criteria || {}, filters);
      await writeAudit(admin, {
        company_id: companyId,
        actor_user_id: caller.id,
        action: "discovery_search_previewed",
        entity_type: "profile",
        entity_id: profile.id,
        details: {
          workspaceKey: profile.workspace_key,
          discoveryMode: profile.discovery_mode,
          queryCount: queries.length,
          attachedApprovedSourceCount: eligibleSources.length,
          coverageScope: filters.coverageScope,
          filterKeys: [...Object.keys(filters.fields), ...(filters.location ? ["location"] : []), ...(filters.searchTerms ? ["workspace_filters"] : [])]
        }
      });
      const resultsByUrl = new Map<string, Record<string, unknown>>();
      for (const query of queries) {
        const rows = await searchSearxng({
          baseUrl: searchBaseUrl,
          query,
          limit: 10,
          bearerToken: searchBearerToken
        });
        for (const candidate of rows) {
          const url = String(candidate.url || "");
          let approvedSource: Record<string, unknown> | null = null;
          for (const source of eligibleSources as Record<string, unknown>[]) {
            try {
              assertAllowedSourceUrl(source, url);
              approvedSource = source;
              break;
            } catch {
              // Search results outside a separately approved exact host/path remain unapproved.
            }
          }
          resultsByUrl.set(url, {
            ...candidate,
            approvedSourceId: approvedSource?.id || null,
            approvedSourceName: approvedSource?.name || null,
            fetchEligible: Boolean(approvedSource)
          });
          if (resultsByUrl.size >= 30) break;
        }
        if (resultsByUrl.size >= 30) break;
      }
      const results = [...resultsByUrl.values()].slice(0, 30);
      return jsonResponse(200, {
        ok: true,
        profile: { id: profile.id, workspace_key: profile.workspace_key, discovery_mode: profile.discovery_mode },
        queries,
        results,
        appliedFilters: {
          coverageScope: filters.coverageScope,
          state: filters.state,
          country: filters.country,
          fieldKeys: Object.keys(filters.fields)
        },
        message: "Search results are unverified candidates, not evidence or verified contacts. Only URLs inside an already approved, attached source path may be added to the E04 queue. Other domains need separate source registration and owner/admin approval."
      });
    }

    if (action === "workers.status") {
      const { data, error } = await admin.from("discovery_company_worker_controls")
        .select("enabled,expires_at,updated_at,reason").eq("company_id", companyId).maybeSingle();
      if (error) throw error;
      const active = data !== null && data.enabled === true
        && typeof data.expires_at === "string"
        && Date.parse(data.expires_at) > Date.now();
      return jsonResponse(200, { ok: true, worker: {
        enabled: active,
        expiresAt: active ? data?.expires_at ?? null : null,
        updatedAt: data?.updated_at ?? null,
        reason: data?.reason ?? ""
      } });
    }

    if (action === "jobs.list") {
      const { data, error } = await admin.from("discovery_jobs")
        .select("id,profile_id,source_id,status,attempts,max_attempts,available_at,created_at,started_at,finished_at,last_error_code,last_error_message")
        .eq("company_id", companyId).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return jsonResponse(200, { ok: true, jobs: data || [] });
    }

    if (action === "evidence.packs.list") {
      const packId = typeof payload.packId === "string" ? payload.packId : "";
      if (packId && !isUuid(packId)) return jsonResponse(400, { error: "A valid evidence pack ID is required." });
      const [packResult, candidateResult] = await Promise.all([
        userClient.from("discovery_evidence_pack_inbox").select("*")
          .eq("company_id", companyId).order("created_at", { ascending: false }).limit(100),
        userClient.from("discovery_evidence_candidate_inbox").select("*")
          .eq("company_id", companyId).order("occurred_at", { ascending: false }).limit(500)
      ]);
      for (const result of [packResult, candidateResult]) if (result.error) throw result.error;
      let items: Record<string, unknown>[] = [];
      let events: Record<string, unknown>[] = [];
      if (packId) {
        const [itemResult, eventResult] = await Promise.all([
          userClient.from("discovery_evidence_pack_item_inbox").select("*")
            .eq("company_id", companyId).eq("pack_id", packId).order("added_at", { ascending: false }).limit(500),
          userClient.from("discovery_evidence_pack_event_inbox").select("*")
            .eq("company_id", companyId).eq("pack_id", packId).order("occurred_at", { ascending: false }).limit(500)
        ]);
        for (const result of [itemResult, eventResult]) if (result.error) throw result.error;
        items = itemResult.data || [];
        events = eventResult.data || [];
      }
      return jsonResponse(200, {
        ok: true,
        packs: packResult.data || [],
        candidates: candidateResult.data || [],
        items,
        events,
        limits: { packs: 100, candidates: 500, items: 500, events: 500 }
      });
    }

    if (action === "evidence.packs.create") {
      if (!canManage) return jsonResponse(403, { error: "Only company owners/admins can create evidence packs." });
      const title = typeof payload.title === "string" ? payload.title.trim() : "";
      const purpose = typeof payload.purpose === "string" ? payload.purpose.trim() : "";
      if (title.length < 3 || title.length > 160 || purpose.length < 10 || purpose.length > 1000) {
        return jsonResponse(400, { error: "Provide a 3–160 character title and a 10–1000 character evidence-pack purpose." });
      }
      const { data, error } = await userClient.rpc("create_discovery_evidence_pack", {
        p_company_id: companyId, p_title: title, p_purpose: purpose
      });
      if (error) throw error;
      return jsonResponse(200, { ok: true, packId: data });
    }

    if (action === "evidence.packs.add") {
      if (!canManage) return jsonResponse(403, { error: "Only company owners/admins can curate evidence packs." });
      if (!isUuid(payload.packId) || !isUuid(payload.provenanceEventId)) {
        return jsonResponse(400, { error: "A valid pack ID and provenance event ID are required." });
      }
      const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
      if (reason.length < 10 || reason.length > 1000) return jsonResponse(400, { error: "An inclusion reason of 10–1000 characters is required." });
      const { data, error } = await userClient.rpc("add_discovery_evidence_pack_item", {
        p_company_id: companyId, p_pack_id: payload.packId,
        p_provenance_event_id: payload.provenanceEventId, p_reason: reason
      });
      if (error) throw error;
      return jsonResponse(200, { ok: true, itemId: data });
    }

    if (action === "evidence.packs.remove") {
      if (!canManage) return jsonResponse(403, { error: "Only company owners/admins can curate evidence packs." });
      if (!isUuid(payload.packId) || !isUuid(payload.itemId)) return jsonResponse(400, { error: "A valid pack ID and item ID are required." });
      const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
      if (reason.length < 10 || reason.length > 1000) return jsonResponse(400, { error: "A removal reason of 10–1000 characters is required." });
      const { data, error } = await userClient.rpc("remove_discovery_evidence_pack_item", {
        p_company_id: companyId, p_pack_id: payload.packId, p_item_id: payload.itemId, p_reason: reason
      });
      if (error) throw error;
      return jsonResponse(200, { ok: true, eventId: data });
    }

    if (action === "evidence.packs.submit") {
      if (!canManage) return jsonResponse(403, { error: "Only company owners/admins can submit evidence packs." });
      if (!isUuid(payload.packId)) return jsonResponse(400, { error: "A valid evidence pack ID is required." });
      const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
      if (reason.length < 10 || reason.length > 1000) return jsonResponse(400, { error: "A submission reason of 10–1000 characters is required." });
      const { data, error } = await userClient.rpc("submit_discovery_evidence_pack", {
        p_company_id: companyId, p_pack_id: payload.packId, p_reason: reason
      });
      if (error) throw error;
      return jsonResponse(200, { ok: true, eventId: data });
    }

    if (action === "evidence.packs.review") {
      if (!canManage) return jsonResponse(403, { error: "Only company owners/admins can review evidence packs." });
      if (!isUuid(payload.packId) || (payload.decision !== "approved" && payload.decision !== "rejected")) {
        return jsonResponse(400, { error: "Provide a valid evidence pack ID and approve/reject decision." });
      }
      const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
      if (reason.length < 10 || reason.length > 1000) return jsonResponse(400, { error: "A review reason of 10–1000 characters is required." });
      const { data, error } = await userClient.rpc("review_discovery_evidence_pack", {
        p_company_id: companyId, p_pack_id: payload.packId, p_decision: payload.decision, p_reason: reason
      });
      if (error) throw error;
      return jsonResponse(200, { ok: true, eventId: data });
    }

    if (action === "evidence.packs.reopen") {
      if (!canManage) return jsonResponse(403, { error: "Only company owners/admins can reopen evidence packs." });
      if (!isUuid(payload.packId)) return jsonResponse(400, { error: "A valid evidence pack ID is required." });
      const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
      if (reason.length < 10 || reason.length > 1000) return jsonResponse(400, { error: "A reopening reason of 10–1000 characters is required." });
      const { data, error } = await userClient.rpc("reopen_discovery_evidence_pack", {
        p_company_id: companyId, p_pack_id: payload.packId, p_reason: reason
      });
      if (error) throw error;
      return jsonResponse(200, { ok: true, eventId: data });
    }

    if (action === "evidence.packs.export") {
      if (!canManage) return jsonResponse(403, { error: "Only company owners/admins can export evidence packs." });
      if (!isUuid(payload.packId)) return jsonResponse(400, { error: "A valid evidence pack ID is required." });
      const [{ data: pack, error: packError }, { data: items, error: itemsError }] = await Promise.all([
        userClient.from("discovery_evidence_pack_inbox").select("*")
          .eq("company_id", companyId).eq("id", payload.packId).maybeSingle(),
        userClient.from("discovery_evidence_pack_item_inbox").select("*")
          .eq("company_id", companyId).eq("pack_id", payload.packId)
          .is("removed_at", null).order("added_at", { ascending: true }).limit(500)
      ]);
      if (packError) throw packError;
      if (itemsError) throw itemsError;
      if (!pack || pack.status !== "approved") return jsonResponse(409, { error: "Only an approved evidence pack can be exported." });
      if (!items?.length || items.length > 500 || items.length !== pack.item_count) {
        return jsonResponse(409, { error: "The evidence pack changed or has no active items. Refresh and try again." });
      }
      const exportedAt = new Date().toISOString();
      const manifestItems = items.map((item: Record<string, unknown>) => ({
        provenanceEventId: item.provenance_event_id,
        subjectKind: item.subject_kind,
        subjectId: item.subject_id,
        fieldName: item.field_name,
        eventType: item.event_type,
        decision: item.decision,
        sourceId: item.source_id,
        sourceName: item.source_name_snapshot,
        sourceDomain: item.source_domain_snapshot,
        jurisdiction: item.source_jurisdiction_snapshot,
        attribution: item.source_attribution_snapshot,
        licenceReference: item.source_license_ref_snapshot,
        licenceSnapshot: item.source_license_snapshot,
        evidenceId: item.evidence_id,
        evidenceSha256: item.evidence_content_hash,
        capturedAt: item.evidence_captured_at,
        sourcePublishedAt: item.source_published_at,
        sourceSpan: item.source_span,
        evidenceRetained: item.evidence_retained,
        observedAt: item.provenance_occurred_at
      }));
      const manifestCore = {
        schemaVersion: "axivestra.evidence-pack.v1",
        exportedAt,
        pack: {
          id: pack.id,
          title: pack.title,
          purpose: pack.purpose,
          reviewedBy: pack.reviewed_by,
          reviewedAt: pack.reviewed_at,
          reviewReason: pack.review_reason
        },
        itemCount: manifestItems.length,
        items: manifestItems,
        privacyNotice: "Metadata and provenance only. Raw source bodies, extracted values, canonical source URLs, object references and credentials are intentionally excluded."
      };
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(manifestCore)));
      const manifestHash = Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, "0")).join("");
      const { data: exportEventId, error: exportError } = await userClient.rpc("record_discovery_evidence_pack_export", {
        p_company_id: companyId,
        p_pack_id: payload.packId,
        p_manifest_hash: manifestHash,
        p_item_count: manifestItems.length
      });
      if (exportError) throw exportError;
      return jsonResponse(200, { ok: true, exportEventId, manifest: { ...manifestCore, manifestHash } });
    }

    if (action === "extractions.list") {
      const { data: runs, error: runsError } = await admin.from("discovery_extraction_runs")
        .select("id,extraction_job_id,evidence_id,source_id,extractor_version,schema_hash,extraction_method,status,extracted_entity_count,fact_count,invalid_fact_count,warnings,source_content_hash,completed_at")
        .eq("company_id", companyId).order("completed_at", { ascending: false }).limit(25);
      if (runsError) throw runsError;
      const runIds = (runs || []).map((run: { id: string }) => run.id);
      if (!runIds.length) return jsonResponse(200, { ok: true, runs: [], facts: [], entities: [], reviews: [], evidence: [] });
      const evidenceIds = [...new Set((runs || []).map((run: { evidence_id: string }) => run.evidence_id))];
      const [{ data: facts, error: factsError }, { data: entities, error: entitiesError }, { data: reviews, error: reviewsError }, { data: evidence, error: evidenceError }] = await Promise.all([
        admin.from("discovery_extracted_facts")
          .select("id,extraction_run_id,evidence_id,extracted_entity_id,field_name,value_type,raw_value,normalized_value,source_span,confidence,validation_status,validation_message,extraction_method,created_at")
          .eq("company_id", companyId).in("extraction_run_id", runIds).order("created_at", { ascending: true }).limit(1000),
        admin.from("discovery_extracted_entities")
          .select("id,extraction_run_id,evidence_id,mention_key,entity_kind,raw_name,normalized_name,source_span,confidence,extraction_method,created_at")
          .eq("company_id", companyId).in("extraction_run_id", runIds).order("created_at", { ascending: true }).limit(500),
        admin.from("discovery_extraction_review_events")
          .select("id,extraction_run_id,fact_id,extracted_entity_id,actor_user_id,decision,reason,corrected_value,occurred_at")
          .eq("company_id", companyId).in("extraction_run_id", runIds).order("occurred_at", { ascending: false }).limit(1000),
        admin.from("discovery_evidence_items")
          .select("id,canonical_url,captured_at,source_published_at,content_type,byte_length,content_hash,attribution,jurisdiction")
          .eq("company_id", companyId).in("id", evidenceIds).limit(25)
      ]);
      if (factsError) throw factsError;
      if (entitiesError) throw entitiesError;
      if (reviewsError) throw reviewsError;
      if (evidenceError) throw evidenceError;
      return jsonResponse(200, {
        ok: true, runs: runs || [], facts: redactExtractedFacts(facts || []), entities: entities || [], reviews: reviews || [], evidence: evidence || [],
        limits: { runs: 25, facts: 1000, entities: 500, reviews: 1000, evidence: 25 }
      });
    }

    if (action === "jobs.enqueue") {
      if (!isUuid(payload.profileId) || !isUuid(payload.sourceId)) return jsonResponse(400, { error: "Valid profile and source IDs are required." });
      const idempotencyKey = typeof payload.idempotencyKey === "string" ? payload.idempotencyKey.trim() : "";
      if (idempotencyKey.length < 8 || idempotencyKey.length > 160) return jsonResponse(400, { error: "Provide an idempotency key between 8 and 160 characters." });
      const candidateInput = Array.isArray(payload.candidateUrls) ? payload.candidateUrls : [];
      if (!candidateInput.length || candidateInput.length > 100 || candidateInput.some(url => typeof url !== "string" || url.length > 2048)) {
        return jsonResponse(400, { error: "Provide 1 to 100 candidate URLs, each no longer than 2048 characters." });
      }
      const [{ data: profile, error: profileError }, { data: source, error: sourceError }, { data: link, error: linkError }] = await Promise.all([
        admin.from("discovery_profiles").select("*").eq("company_id", companyId).eq("id", payload.profileId).maybeSingle(),
        admin.from("discovery_source_registry").select("*").eq("company_id", companyId).eq("id", payload.sourceId).maybeSingle(),
        admin.from("discovery_profile_sources").select("profile_id").eq("company_id", companyId).eq("profile_id", payload.profileId).eq("source_id", payload.sourceId).maybeSingle()
      ]);
      if (profileError) throw profileError; if (sourceError) throw sourceError; if (linkError) throw linkError;
      if (!profile || !source || !link) return jsonResponse(404, { error: "The profile and its attached source must exist in this company." });
      // The company-scoped database profile is the sole authority for discovery criteria.
      // Ignore any client-supplied criteria so queued work cannot replace reviewed matching rules.
      const criteria = profile.criteria && typeof profile.criteria === "object" && !Array.isArray(profile.criteria)
        ? profile.criteria as Record<string, unknown> : {};
      if (new TextEncoder().encode(JSON.stringify({ criteria, candidateUrls: candidateInput })).length > 48_000) {
        return jsonResponse(413, { error: "The discovery job payload must not exceed 48 KB." });
      }
      if (new TextEncoder().encode(JSON.stringify(criteria)).length > 8192) {
        return jsonResponse(413, { error: "The saved workspace criteria must not exceed 8 KB." });
      }
      if (profile.enabled !== true) return jsonResponse(409, { error: "This discovery profile is disabled." });
      if (source.status !== "approved") return jsonResponse(409, { error: "Only an approved discovery source can be queued." });
      if (source.connector_key === "manual_research") return jsonResponse(403, { error: "Manual/user-provided research is not eligible for automated fetching; attach it as evidence manually." });
      assertSourceCanBeAttached(profile, source);
      if (candidateInput.length > Number(source.max_pages_per_job || 0)) {
        return jsonResponse(400, { error: "Candidate URL count exceeds this source's approved pages-per-job limit." });
      }
      const candidateUrls = [...new Set(candidateInput.map(value => assertAllowedSourceUrl(source, value).toString()))];
      if (candidateUrls.length !== candidateInput.length) return jsonResponse(400, { error: "Duplicate candidate URLs are not allowed in one job." });
      const purpose = typeof payload.purpose === "string" ? payload.purpose.trim() : profile.purpose;
      if (!purpose || purpose !== profile.purpose) return jsonResponse(400, { error: "The job purpose must exactly match the profile's approved purpose." });
      if (!(Array.isArray(source.allowed_purposes) ? source.allowed_purposes : []).includes(purpose)) return jsonResponse(403, { error: "The purpose is not in this source's approved purpose allow-list." });
      const { data: queued, error: enqueueError } = await admin.rpc("enqueue_discovery_job", {
        p_company_id: companyId,
        p_profile_id: profile.id,
        p_source_id: source.id,
        p_requested_by: caller.id,
        p_payload: { purpose, criteria, candidateUrls },
        p_idempotency_key: idempotencyKey,
        p_profile_updated_at: profile.updated_at,
        p_source_updated_at: source.updated_at
      });
      if (enqueueError) {
        if (enqueueError.code === "23505") return jsonResponse(409, { error: "This idempotency key is already used by a different discovery request." });
        throw enqueueError;
      }
      const queueResult = Array.isArray(queued) ? queued[0] : queued;
      const record = queueResult?.job as Record<string, unknown> | undefined;
      if (!record) throw new Error("The discovery enqueue transaction returned no job record.");
      const resultJob = {
        id: record.id, profile_id: record.profile_id, source_id: record.source_id,
        status: record.status, attempts: record.attempts, max_attempts: record.max_attempts,
        available_at: record.available_at, created_at: record.created_at
      };
      const duplicate = queueResult?.duplicate === true;
      return jsonResponse(duplicate ? 200 : 201, {
        ok: true, duplicate, job: resultJob,
        message: duplicate ? "The same discovery job was already queued." : "Discovery job queued. Enqueue does not contact the source."
      });
    }

    if (action === "matches.candidates.list") {
      if (!isUuid(payload.profileId)) return jsonResponse(400, { error: "A valid workspace profile ID is required." });
      const { data: profile, error: profileError } = await admin.from("discovery_profiles")
        .select("*").eq("company_id", companyId).eq("id", payload.profileId).maybeSingle();
      if (profileError) throw profileError;
      if (!profile) return jsonResponse(404, { error: "The discovery profile was not found in this company." });
      if (profile.enabled !== true || profile.criteria?.disabledByPolicy === true) {
        return jsonResponse(409, { error: "Enable an eligible workspace profile before scoring candidates." });
      }
      const matchCriteria = profile.criteria?.matchCriteria;
      if (!matchCriteria || typeof matchCriteria !== "object" || Array.isArray(matchCriteria) || !Object.keys(matchCriteria).length) {
        return jsonResponse(409, { error: "Add explicit E11 matchCriteria values to this workspace profile before scoring." });
      }
      const { data: links, error: linkError } = await admin.from("discovery_profile_sources")
        .select("source_id").eq("company_id", companyId).eq("profile_id", profile.id);
      if (linkError) throw linkError;
      const sourceIds = [...new Set((links || []).map((item: { source_id: string }) => item.source_id))];
      if (!sourceIds.length) return jsonResponse(409, { error: "Attach an approved source before scoring candidates." });
      const { data: sources, error: sourcesError } = await admin.from("discovery_source_registry")
        .select("*").eq("company_id", companyId).eq("status", "approved").in("id", sourceIds).limit(100);
      if (sourcesError) throw sourcesError;
      const eligibleSourceIds = (sources || []).filter((source: Record<string, unknown>) => {
        try { assertSourceCanBeAttached(profile, source); return true; } catch { return false; }
      }).map((source: { id: string }) => source.id);
      if (!eligibleSourceIds.length) return jsonResponse(409, { error: "No attached source is currently approved for this profile's exact purpose and policy." });

      const { data: observations, error: observationsError } = await admin.from("discovery_enrichment_observations")
        .select("id,canonical_entity_id")
        .eq("company_id", companyId).eq("review_state", "accepted")
        .in("source_id", eligibleSourceIds).limit(3000);
      if (observationsError) throw observationsError;
      const counts = new Map<string, number>();
      for (const item of observations || []) {
        counts.set(item.canonical_entity_id, (counts.get(item.canonical_entity_id) || 0) + 1);
      }
      const entityIds = [...counts.keys()].slice(0, 500);
      if (!entityIds.length) return jsonResponse(200, { ok: true, candidates: [], acceptedObservationCount: 0 });
      const { data: entities, error: entitiesError } = await admin.from("discovery_canonical_entities")
        .select("id,legal_name,jurisdiction,entity_type,status")
        .eq("company_id", companyId).eq("status", "active").in("id", entityIds).limit(500);
      if (entitiesError) throw entitiesError;
      return jsonResponse(200, {
        ok: true,
        workspaceKey: profile.workspace_key,
        discoveryMode: profile.discovery_mode,
        candidates: (entities || []).map((entity: Record<string, unknown>) => ({
          id: entity.id,
          legalName: entity.legal_name,
          jurisdiction: entity.jurisdiction,
          entityType: entity.entity_type,
          acceptedObservationCount: counts.get(String(entity.id)) || 0
        })),
        acceptedObservationCount: observations?.length || 0,
        message: "Only owner-accepted E10 observations from attached, currently approved sources are eligible for E11 scoring."
      });
    }

    if (action === "matches.evaluate") {
      if (!canManage) return jsonResponse(403, { error: "Only company owners/admins can run and persist E11 match scoring." });
      if (!isUuid(payload.profileId) || !isUuid(payload.canonicalEntityId)) {
        return jsonResponse(400, { error: "A valid workspace profile and canonical entity ID are required." });
      }
      const [{ data: profile, error: profileError }, { data: canonicalEntity, error: entityError }] = await Promise.all([
        admin.from("discovery_profiles").select("*")
          .eq("company_id", companyId).eq("id", payload.profileId).maybeSingle(),
        admin.from("discovery_canonical_entities").select("id,legal_name,jurisdiction,entity_type,status")
          .eq("company_id", companyId).eq("id", payload.canonicalEntityId).maybeSingle()
      ]);
      if (profileError) throw profileError;
      if (entityError) throw entityError;
      if (!profile) return jsonResponse(404, { error: "The workspace profile was not found in this company." });
      if (!canonicalEntity || canonicalEntity.status !== "active") return jsonResponse(404, { error: "The active canonical entity was not found in this company." });
      if (profile.enabled !== true || profile.criteria?.disabledByPolicy === true) {
        return jsonResponse(409, { error: "The workspace profile is disabled or restricted by discovery policy." });
      }
      const matchCriteria = profile.criteria?.matchCriteria;
      if (!matchCriteria || typeof matchCriteria !== "object" || Array.isArray(matchCriteria) || !Object.keys(matchCriteria).length) {
        return jsonResponse(409, { error: "Configure explicit E11 matchCriteria values in this workspace profile first." });
      }
      const { data: links, error: linkError } = await admin.from("discovery_profile_sources")
        .select("source_id").eq("company_id", companyId).eq("profile_id", profile.id);
      if (linkError) throw linkError;
      const sourceIds = [...new Set((links || []).map((item: { source_id: string }) => item.source_id))];
      if (!sourceIds.length) return jsonResponse(409, { error: "No sources are attached to this workspace profile." });
      const { data: sources, error: sourcesError } = await admin.from("discovery_source_registry")
        .select("*").eq("company_id", companyId).eq("status", "approved").in("id", sourceIds).limit(100);
      if (sourcesError) throw sourcesError;
      const eligibleSourceIds = (sources || []).filter((source: Record<string, unknown>) => {
        try { assertSourceCanBeAttached(profile, source); return true; } catch { return false; }
      }).map((source: { id: string }) => source.id);
      if (!eligibleSourceIds.length) return jsonResponse(409, { error: "No attached source remains approved for this profile's exact purpose and policy." });

      const { data: observations, error: observationsError } = await admin.from("discovery_enrichment_observations")
        .select("id,canonical_entity_id,attribute_key,normalized_value,currency_code,source_id,evidence_id,source_published_at,evidence_captured_at,review_state")
        .eq("company_id", companyId).eq("canonical_entity_id", payload.canonicalEntityId)
        .eq("review_state", "accepted").in("source_id", eligibleSourceIds)
        .order("evidence_captured_at", { ascending: false }).limit(500);
      if (observationsError) throw observationsError;
      if (!observations?.length) {
        return jsonResponse(409, { error: "No owner-accepted E10 enrichment observations from attached approved sources are available for this candidate." });
      }

      let mapped: ReturnType<typeof buildE11CandidateFromAcceptedObservations>;
      let scored: ReturnType<typeof scoreDiscoveryMatch>;
      try {
        mapped = buildE11CandidateFromAcceptedObservations({ canonicalEntity, observations });
        scored = scoreDiscoveryMatch({
          candidate: mapped.candidate,
          criteria: matchCriteria,
          evidence: mapped.evidence,
          now: new Date().toISOString()
        });
      } catch (error) {
        return jsonResponse(400, { error: error instanceof Error ? error.message : "The configured E11 scoring criteria are invalid." });
      }
      if (!scored.components.length || !mapped.evidence.length) {
        return jsonResponse(409, { error: "No configured scoring dimensions could be evaluated from the accepted evidence." });
      }
      const candidateSnapshot = {
        ...mapped.snapshot,
        canonicalEntityId: canonicalEntity.id,
        legalName: canonicalEntity.legal_name,
        jurisdiction: canonicalEntity.jurisdiction,
        entityType: canonicalEntity.entity_type
      };
      const components = scored.components.map(item => ({
        criterion: item.criterion,
        weight: item.weight,
        points: item.points,
        status: item.status,
        required: item.required,
        reason: item.reason
      }));
      const { data: matchId, error: saveError } = await admin.rpc("record_discovery_match_score", {
        p_company_id: companyId,
        p_actor_user_id: caller.id,
        p_profile_id: profile.id,
        p_canonical_entity_id: canonicalEntity.id,
        p_criteria_version: "e11-weighted-rules-v1:" + String(profile.discovery_mode).toLowerCase(),
        p_criteria_snapshot: matchCriteria,
        p_candidate_snapshot: candidateSnapshot,
        p_score: scored.score,
        p_confidence: scored.confidence,
        p_eligible: scored.eligible,
        p_positive_factors: scored.positives,
        p_negative_factors: scored.negatives,
        p_unknown_criteria: scored.unknown,
        p_blockers: scored.blockers,
        p_components: components
      });
      if (saveError) {
        if (saveError.code === "42501") return jsonResponse(403, { error: saveError.message });
        if (saveError.code === "22023") return jsonResponse(400, { error: saveError.message });
        throw saveError;
      }
      return jsonResponse(201, {
        ok: true,
        matchResultId: matchId,
        workspaceKey: profile.workspace_key,
        discoveryMode: profile.discovery_mode,
        canonicalEntity: { id: canonicalEntity.id, legalName: canonicalEntity.legal_name },
        score: scored.score,
        confidence: scored.confidence,
        eligible: scored.eligible,
        positives: scored.positives,
        negatives: scored.negatives,
        unknown: scored.unknown,
        blockers: scored.blockers,
        components,
        requiresHumanReview: true,
        message: "E11 score saved as a pending human-review result. No lead, approval, contact or outreach was created."
      });
    }

    if (action === "matches.list") {
      const { data: matches, error } = await admin.from("discovery_match_results")
        .select("id,canonical_entity_id,workspace_key,discovery_mode,criteria_version,score,confidence,eligible,positive_factors,negative_factors,unknown_criteria,blockers,review_state,created_at")
        .eq("company_id", companyId).eq("review_state", "pending_review")
        .order("score", { ascending: false }).limit(100);
      if (error) throw error;
      const entityIds = [...new Set((matches || []).map((row: { canonical_entity_id: string }) => row.canonical_entity_id))];
      const { data: entities, error: entityError } = entityIds.length
        ? await admin.from("discovery_canonical_entities").select("id,legal_name,jurisdiction,entity_type")
          .eq("company_id", companyId).in("id", entityIds)
        : { data: [], error: null };
      if (entityError) throw entityError;
      const byId = new Map<string, Record<string, unknown>>((entities || []).map((entity: Record<string, unknown>) => [String(entity.id), entity] as [string, Record<string, unknown>]));
      return jsonResponse(200, { ok: true, matches: (matches || []).map((match: Record<string, unknown>) => ({
        ...match, candidate: byId.get(String(match.canonical_entity_id)) || null
      })) });
    }

    if (action === "leads.list") {
      const { data: leads, error } = await admin.from("discovery_leads")
        .select("*").eq("company_id", companyId).order("updated_at", { ascending: false }).limit(200);
      if (error) throw error;
      const matchIds = [...new Set((leads || []).map((lead: { match_result_id: string }) => lead.match_result_id))];
      const entityIds = [...new Set((leads || []).map((lead: { canonical_entity_id: string }) => lead.canonical_entity_id))];
      const [matchResult, entityResult, eventResult] = await Promise.all([
        matchIds.length ? admin.from("discovery_match_results")
          .select("id,score,confidence,eligible,workspace_key,discovery_mode,criteria_version")
          .eq("company_id", companyId).in("id", matchIds) : Promise.resolve({ data: [], error: null }),
        entityIds.length ? admin.from("discovery_canonical_entities")
          .select("id,legal_name,jurisdiction,entity_type")
          .eq("company_id", companyId).in("id", entityIds) : Promise.resolve({ data: [], error: null }),
        (leads || []).length ? admin.from("discovery_lead_events")
          .select("id,lead_id,event_type,previous_status,new_status,previous_priority,new_priority,previous_assignee_id,new_assignee_id,reason_code,details,actor_user_id,occurred_at")
          .eq("company_id", companyId).in("lead_id", (leads || []).map((lead: { id: string }) => lead.id))
          .order("occurred_at", { ascending: false }).limit(1000) : Promise.resolve({ data: [], error: null })
      ]);
      if (matchResult.error) throw matchResult.error;
      if (entityResult.error) throw entityResult.error;
      if (eventResult.error) throw eventResult.error;
      const matchesById = new Map<string, Record<string, unknown>>((matchResult.data || []).map((row: Record<string, unknown>) => [String(row.id), row] as [string, Record<string, unknown>]));
      const entitiesById = new Map<string, Record<string, unknown>>((entityResult.data || []).map((row: Record<string, unknown>) => [String(row.id), row] as [string, Record<string, unknown>]));
      const eventsByLead = new Map<string, Record<string, unknown>[]>();
      for (const event of eventResult.data || []) {
        const key = String((event as Record<string, unknown>).lead_id);
        eventsByLead.set(key, [...(eventsByLead.get(key) || []), event as Record<string, unknown>]);
      }
      return jsonResponse(200, { ok: true, leads: (leads || []).map((lead: Record<string, unknown>) => ({
        ...lead,
        match: matchesById.get(String(lead.match_result_id)) || null,
        candidate: entitiesById.get(String(lead.canonical_entity_id)) || null,
        events: eventsByLead.get(String(lead.id)) || []
      })) });
    }


    if (action === "orchestration.list") {
      const [workflowResult, stageResult, runResult, stepResult, eventResult, preflightResult, profileResult, sourceResult, profileSourceResult, contextEventResult, adapterContractResult, adapterApprovalResult, adapterEventResult, schedulePreviewResult, stageQueueContractResult, executionResult, attemptResult, failurePolicyResult, operationsResult] = await Promise.all([
        admin.from("discovery_orchestration_workflows").select("workflow_key,label,description,stage_keys")
          .eq("active", true).order("label"),
        admin.from("discovery_orchestration_stage_registry").select("stage_key,technical_stage,capability_name,description,dependency_stage_keys,permission_class,adapter_key,dispatch_ready,enabled_by_default")
          .order("sequence_no"),
        admin.from("discovery_orchestration_run_inbox").select("*")
          .eq("company_id", companyId).order("created_at", { ascending: false }).limit(40),
        admin.from("discovery_orchestration_steps").select("id,run_id,stage_key,step_order,depends_on_step_ids,status,dispatch_state,permission_class,stage_snapshot")
          .eq("company_id", companyId).order("step_order").limit(500),
        admin.from("discovery_orchestration_events").select("id,run_id,event_type,previous_status,new_status,reason,occurred_at,actor_user_id")
          .eq("company_id", companyId).order("occurred_at", { ascending: false }).limit(800),
        userClient.from("discovery_orchestration_step_preflight").select("step_id,run_id,blocker_codes,unsatisfied_dependency_count,unsatisfied_dependency_ids,dispatch_permitted,execution_context_bound,profile_id,source_id,purpose,required_fields,profile_enabled,source_status,context_snapshot_current,purpose_still_allowed,fields_still_allowed,company_worker_grant_active,company_worker_grant_expires_at,worker_identity_scope_available,adapter_contract_platform_approved,company_adapter_approved,stage_queue_mode,stage_queue_table,stage_queue_enqueue_path,stage_queue_claim_routine,stage_queue_bridge_enabled")
          .eq("company_id", companyId).limit(500),
        admin.from("discovery_profiles").select("id,workspace_key,discovery_mode,jurisdiction,purpose,enabled,updated_at")
          .eq("company_id", companyId).order("workspace_key").limit(200),
        admin.from("discovery_source_registry").select("id,name,status,allowed_purposes,allowed_fields,updated_at")
          .eq("company_id", companyId).order("name").limit(300),
        admin.from("discovery_profile_sources").select("profile_id,source_id")
          .eq("company_id", companyId).limit(500),
        admin.from("discovery_orchestration_context_events").select("id,run_id,event_type,profile_id,source_id,purpose,required_fields,reason,occurred_at,actor_user_id")
          .eq("company_id", companyId).order("occurred_at", { ascending: false }).limit(800),
        admin.from("discovery_orchestration_adapter_contracts").select("adapter_key,stage_key,contract_version,required_permission_class,required_policy_checks,max_attempts,lease_seconds,max_parallel_per_company,enabled,reviewed_at,review_reason")
          .order("stage_key").order("contract_version").limit(200),
        admin.from("discovery_orchestration_company_adapter_approvals").select("adapter_key,contract_version,status,reviewed_at,review_reason,updated_at")
          .eq("company_id", companyId).order("updated_at", { ascending: false }).limit(200),
        admin.from("discovery_orchestration_company_adapter_events").select("id,adapter_key,contract_version,event_type,previous_status,new_status,reason,occurred_at,actor_user_id")
          .eq("company_id", companyId).order("occurred_at", { ascending: false }).limit(500),
        userClient.from("discovery_orchestration_dependency_schedule").select("run_id,step_id,stage_key,step_order,dependency_count,unsatisfied_dependency_count,failed_dependency_count,dependency_state,schedule_preview_state,dispatch_permitted")
          .eq("company_id", companyId).order("step_order").limit(500),
        admin.from("discovery_orchestration_stage_queue_contracts").select("stage_key,mapping_version,queue_mode,queue_table,enqueue_path,claim_routine,source_migration,mapping_notes,bridge_enabled")
          .order("stage_key")
,
        userClient.from("discovery_orchestration_execution_inbox").select("execution_id,run_id,step_id,stage_key,adapter_key,state,attempt_count,max_attempts,available_at,last_error_code,last_error_summary,updated_at")
          .eq("company_id", companyId).order("updated_at", { ascending: false }).limit(500),
        userClient.from("discovery_orchestration_attempt_inbox").select("attempt_id,execution_id,attempt_number,status,error_code,failure_class,retryable,started_at,finished_at,next_retry_at,run_id,step_id,stage_key,adapter_key")
          .eq("company_id", companyId).order("started_at", { ascending: false }).limit(1000),
        admin.from("discovery_orchestration_failure_policies").select("error_code,failure_class,retryable,base_delay_seconds,max_delay_seconds,max_attempts,safe_summary")
          .eq("enabled", true).order("failure_class").order("error_code"),
        userClient.from("discovery_orchestration_operations_inbox").select("*")
          .eq("company_id", companyId).order("updated_at", { ascending: false }).limit(500)
      ]);
      for (const result of [workflowResult, stageResult, runResult, stepResult, eventResult, preflightResult, profileResult, sourceResult, profileSourceResult, contextEventResult, adapterContractResult, adapterApprovalResult, adapterEventResult, schedulePreviewResult, stageQueueContractResult, executionResult, attemptResult, failurePolicyResult, operationsResult]) {
        if (result.error) throw result.error;
      }
      let workerIdentities: Record<string, unknown>[] = [];
      let workerEvents: Record<string, unknown>[] = [];
      let companyWorkerGrant: Record<string, unknown> | null = null;
      if (canManage) {
        const [workerResult, workerEventResult, companyGrantResult] = await Promise.all([
          admin.from("discovery_orchestration_worker_identities")
            .select("id,worker_key,display_name,stage_keys,max_active_leases,lease_seconds,status,expires_at,last_used_at,granted_by,updated_by,reason,created_at,updated_at")
            .eq("company_id", companyId).order("created_at", { ascending: false }).limit(100),
          admin.from("discovery_orchestration_worker_events")
            .select("id,worker_identity_id,event_type,worker_key_snapshot,stage_keys_snapshot,reason,details,occurred_at,actor_user_id")
            .eq("company_id", companyId).order("occurred_at", { ascending: false }).limit(300),
          admin.from("discovery_company_worker_controls")
            .select("enabled,expires_at,updated_at,reason").eq("company_id", companyId).maybeSingle()
        ]);
        for (const result of [workerResult, workerEventResult, companyGrantResult]) {
          if (result.error) throw result.error;
        }
        workerIdentities = workerResult.data || [];
        workerEvents = workerEventResult.data || [];
        companyWorkerGrant = companyGrantResult.data || null;
      }
      return jsonResponse(200, {
        ok: true,
        workflows: workflowResult.data || [],
        stages: stageResult.data || [],
        runs: runResult.data || [],
        steps: stepResult.data || [],
        events: eventResult.data || [],
        preflight: preflightResult.data || [],
        profiles: profileResult.data || [],
        sources: sourceResult.data || [],
        profileSources: profileSourceResult.data || [],
        contextEvents: contextEventResult.data || [],
        adapterContracts: adapterContractResult.data || [],
        adapterApprovals: adapterApprovalResult.data || [],
        adapterEvents: adapterEventResult.data || [],
        schedulePreview: schedulePreviewResult.data || [],
        stageQueueContracts: stageQueueContractResult.data || [],
        executions: executionResult.data || [],
        attempts: attemptResult.data || [],
        failurePolicies: failurePolicyResult.data || [],
        operations: operationsResult.data || [],
        workerIdentities,
        workerEvents,
        companyWorkerGrant,
        limits: { runs: 40, steps: 500, events: 800, preflight: 500, profiles: 200, sources: 300, profileSources: 500, contextEvents: 800, adapterContracts: 200, adapterApprovals: 200, adapterEvents: 500, schedulePreview: 500, stageQueueContracts: 9, executions: 500, attempts: 1000, failurePolicies: 100, operations: 500, workerIdentities: 100, workerEvents: 300 }
      });
    }

    if (action === "orchestration.request") {
      const workflowKey = typeof payload.workflowKey === "string" ? payload.workflowKey.trim() : "";
      const idempotencyKey = typeof payload.idempotencyKey === "string" ? payload.idempotencyKey.trim() : "";
      if (!/^[a-z0-9_]{3,80}$/.test(workflowKey)) return jsonResponse(400, { error: "Choose a valid orchestration workflow." });
      if (idempotencyKey.length < 8 || idempotencyKey.length > 160) return jsonResponse(400, { error: "An idempotency key between 8 and 160 characters is required." });
      const { data, error } = await userClient.rpc("request_discovery_orchestration_run", {
        p_company_id: companyId, p_workflow_key: workflowKey, p_idempotency_key: idempotencyKey
      });
      if (error) {
        if (error.code === "42501") return jsonResponse(403, { error: error.message });
        if (error.code === "22023" || error.code === "23505") return jsonResponse(400, { error: error.message });
        throw error;
      }
      return jsonResponse(201, {
        ok: true, runId: data,
        message: "Orchestration plan created for owner/admin approval. No stage job was dispatched."
      });
    }

    if (action === "members.list") {
      const { data, error } = await admin.from("company_memberships")
        .select("user_id,role").eq("company_id", companyId).order("role");
      if (error) throw error;
      return jsonResponse(200, { ok: true, members: data || [] });
    }

    if (!canManage && action !== "jobs.enqueue") return jsonResponse(403, { error: "Only this company's owner or admin can change discovery sources, profiles or worker permissions." });



    if (action === "orchestration.bindContext") {
      if (!isUuid(payload.runId) || !isUuid(payload.profileId) || !isUuid(payload.sourceId)) {
        return jsonResponse(400, { error: "A valid run, profile and source ID are required." });
      }
      const purpose = typeof payload.purpose === "string" ? payload.purpose.trim() : "";
      const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
      const requiredFields = Array.isArray(payload.requiredFields)
        ? payload.requiredFields.filter((value): value is string => typeof value === "string").map(value => value.trim())
        : [];
      if (purpose.length < 5 || purpose.length > 500) return jsonResponse(400, { error: "An exact profile purpose is required." });
      if (reason.length < 10 || reason.length > 1000) return jsonResponse(400, { error: "A context-binding reason between 10 and 1000 characters is required." });
      if (!requiredFields.length || requiredFields.length > 40 || requiredFields.some(value => !value || value.length > 120)) {
        return jsonResponse(400, { error: "Provide 1–40 exact required field names from the source allow-list." });
      }
      const { data, error } = await userClient.rpc("bind_discovery_orchestration_run_context", {
        p_company_id: companyId,
        p_run_id: payload.runId,
        p_profile_id: payload.profileId,
        p_source_id: payload.sourceId,
        p_purpose: purpose,
        p_required_fields: requiredFields,
        p_reason: reason
      });
      if (error) {
        if (error.code === "42501") return jsonResponse(403, { error: error.message });
        if (error.code === "P0002") return jsonResponse(404, { error: error.message });
        if (error.code === "22023") return jsonResponse(400, { error: error.message });
        throw error;
      }
      return jsonResponse(200, { ok: true, eventId: data, message: "Run context bound and audited. Dispatch remains disabled." });
    }

    if (action === "orchestration.adapterReview") {
      if (!canManage) return jsonResponse(403, { error: "Only company owners/admins can review company adapter contracts." });
      const adapterKey = typeof payload.adapterKey === "string" ? payload.adapterKey.trim() : "";
      const contractVersion = typeof payload.contractVersion === "string" ? payload.contractVersion.trim() : "";
      const decision = typeof payload.decision === "string" ? payload.decision : "";
      const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
      if (!/^[a-z0-9][a-z0-9._-]{2,119}$/.test(adapterKey)) return jsonResponse(400, { error: "A valid registered adapter key is required." });
      if (!contractVersion || contractVersion.length > 80) return jsonResponse(400, { error: "An exact registered contract version is required." });
      if (!["approved","rejected","suspended"].includes(decision)) return jsonResponse(400, { error: "Choose approved, rejected or suspended." });
      if (reason.length < 10 || reason.length > 1000) return jsonResponse(400, { error: "A review reason of 10–1000 characters is required." });
      const { data, error } = await userClient.rpc("review_discovery_orchestration_company_adapter", {
        p_company_id: companyId,
        p_adapter_key: adapterKey,
        p_contract_version: contractVersion,
        p_decision: decision,
        p_reason: reason
      });
      if (error) {
        if (error.code === "42501") return jsonResponse(403, { error: error.message });
        if (error.code === "P0002") return jsonResponse(404, { error: error.message });
        if (error.code === "22023") return jsonResponse(400, { error: error.message });
        throw error;
      }
      return jsonResponse(200, {
        ok: true,
        eventId: data,
        message: "Company adapter contract review recorded. It does not enable a stage gate or dispatch work."
      });
    }

    if (action === "orchestration.workerGrant") {
      if (!canManage) return jsonResponse(403, { error: "Only company owners/admins can grant a scoped orchestration worker." });
      const workerKey = typeof payload.workerKey === "string" ? payload.workerKey.trim() : "";
      const displayName = typeof payload.displayName === "string" ? payload.displayName.trim() : "";
      const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
      const stageKeys = Array.isArray(payload.stageKeys)
        ? payload.stageKeys.filter((value): value is string => typeof value === "string")
        : [];
      const maxActiveLeases = Number(payload.maxActiveLeases || 1);
      const leaseSeconds = Number(payload.leaseSeconds || 120);
      const expiresMinutes = Number(payload.expiresMinutes || 30);
      if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(workerKey)) return jsonResponse(400, { error: "Worker key must be 3–80 lowercase letters, digits, dot, underscore or dash." });
      if (displayName.length < 3 || displayName.length > 120) return jsonResponse(400, { error: "Worker display name must be 3–120 characters." });
      if (reason.length < 10 || reason.length > 1000) return jsonResponse(400, { error: "A grant reason of 10–1000 characters is required." });
      if (!stageKeys.length || stageKeys.length > 9 || new Set(stageKeys).size !== stageKeys.length) {
        return jsonResponse(400, { error: "Choose 1–9 distinct orchestration stages. No broad or wildcard scope is supported." });
      }
      if (!Number.isInteger(maxActiveLeases) || maxActiveLeases < 1 || maxActiveLeases > 4) return jsonResponse(400, { error: "Maximum active leases must be between 1 and 4." });
      if (!Number.isInteger(leaseSeconds) || leaseSeconds < 15 || leaseSeconds > 300) return jsonResponse(400, { error: "Lease duration must be between 15 and 300 seconds." });
      if (!Number.isInteger(expiresMinutes) || expiresMinutes < 5 || expiresMinutes > 60) return jsonResponse(400, { error: "Worker grant duration must be between 5 and 60 minutes." });

      const credentialBytes = crypto.getRandomValues(new Uint8Array(32));
      const workerToken = Array.from(credentialBytes, value => value.toString(16).padStart(2, "0")).join("");
      const tokenDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(workerToken));
      const credentialHash = Array.from(new Uint8Array(tokenDigest), value => value.toString(16).padStart(2, "0")).join("");
      const expiresAt = new Date(Date.now() + expiresMinutes * 60_000).toISOString();
      const { data, error } = await userClient.rpc("grant_discovery_orchestration_worker_identity", {
        p_company_id: companyId,
        p_worker_key: workerKey,
        p_display_name: displayName,
        p_credential_hash: credentialHash,
        p_stage_keys: stageKeys,
        p_max_active_leases: maxActiveLeases,
        p_lease_seconds: leaseSeconds,
        p_expires_at: expiresAt,
        p_reason: reason
      });
      if (error) {
        if (error.code === "42501") return jsonResponse(403, { error: error.message });
        if (error.code === "22023") return jsonResponse(400, { error: error.message });
        if (error.code === "23505") return jsonResponse(409, { error: "This worker key or credential is already registered in this company." });
        throw error;
      }
      const worker = Array.isArray(data) ? data[0] : data;
      if (!worker) throw new Error("Worker grant transaction returned no receipt.");
      return jsonResponse(201, {
        ok: true,
        worker,
        workerToken,
        credentialHandling: "This credential is shown once. Copy it to the worker's secret environment; AXIVESTRA stores only its SHA-256 hash. It is not included in audit history.",
        dispatchMessage: "Worker identity granted, but no work can be claimed: orchestration dispatch remains disabled."
      });
    }

    if (action === "orchestration.workerControl") {
      if (!canManage) return jsonResponse(403, { error: "Only company owners/admins can pause or revoke an orchestration worker." });
      if (!isUuid(payload.workerIdentityId)) return jsonResponse(400, { error: "A valid worker identity ID is required." });
      const status = payload.status === "revoked" ? "revoked" : payload.status === "paused" ? "paused" : payload.status === "active" ? "active" : "";
      const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
      if (!status) return jsonResponse(400, { error: "Choose active, paused or revoked status." });
      if (reason.length < 10 || reason.length > 1000) return jsonResponse(400, { error: "A control reason of 10–1000 characters is required." });
      const { data, error } = await userClient.rpc("set_discovery_orchestration_worker_identity_status", {
        p_company_id: companyId,
        p_worker_identity_id: payload.workerIdentityId,
        p_status: status,
        p_reason: reason
      });
      if (error) {
        if (error.code === "42501") return jsonResponse(403, { error: error.message });
        if (error.code === "P0002") return jsonResponse(404, { error: error.message });
        if (error.code === "22023") return jsonResponse(400, { error: error.message });
        throw error;
      }
      const worker = Array.isArray(data) ? data[0] : data;
      if (!worker) throw new Error("Worker identity control transaction returned no receipt.");
      return jsonResponse(200, {
        ok: true, worker,
        message: status === "revoked"
          ? "Worker identity revoked. Active orchestration leases were released immediately."
          : status === "paused"
            ? "Worker identity paused. Active orchestration leases were released immediately."
            : "Worker identity resumed. Expiry and the company grant are still enforced."
      });
    }

    if (action === "orchestration.decide") {
      if (!isUuid(payload.runId)) return jsonResponse(400, { error: "A valid orchestration run ID is required." });
      const decision = String(payload.decision || "");
      if (!["approve","reject","pause","resume","cancel"].includes(decision)) {
        return jsonResponse(400, { error: "Choose approve, reject, pause, resume or cancel." });
      }
      const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
      if (reason.length < 10 || reason.length > 1000) return jsonResponse(400, { error: "A decision reason between 10 and 1000 characters is required." });
      const { data, error } = await userClient.rpc("record_discovery_orchestration_decision", {
        p_company_id: companyId, p_run_id: payload.runId, p_decision: decision, p_reason: reason
      });
      if (error) {
        if (error.code === "42501") return jsonResponse(403, { error: error.message });
        if (error.code === "P0002") return jsonResponse(404, { error: error.message });
        if (error.code === "22023") return jsonResponse(400, { error: error.message });
        throw error;
      }
      return jsonResponse(200, { ok: true, eventId: data, message: "Orchestration plan state updated. No stage was dispatched." });
    }

    if (action === "matches.review") {
      if (!isUuid(payload.matchResultId)) return jsonResponse(400, { error: "A valid match result ID is required." });
      const decision = String(payload.decision || "");
      const reasonCode = String(payload.reasonCode || "");
      if (!["accepted_for_review","rejected"].includes(decision)) return jsonResponse(400, { error: "Choose accept for review or reject." });
      const { data, error } = await admin.rpc("record_discovery_match_review", {
        p_company_id: companyId, p_actor_user_id: caller.id,
        p_match_result_id: payload.matchResultId, p_decision: decision, p_reason_code: reasonCode
      });
      if (error) {
        if (error.code === "42501") return jsonResponse(403, { error: error.message });
        if (error.code === "P0002") return jsonResponse(404, { error: error.message });
        if (error.code === "22023") return jsonResponse(400, { error: error.message });
        throw error;
      }
      return jsonResponse(201, { ok: true, review: data?.review || null, lead: data?.lead || null });
    }

    if (action === "leads.assign") {
      if (!isUuid(payload.leadId)) return jsonResponse(400, { error: "A valid lead ID is required." });
      const assigneeId = payload.assigneeId === null || payload.assigneeId === "" ? null : payload.assigneeId;
      if (assigneeId !== null && !isUuid(assigneeId)) return jsonResponse(400, { error: "Choose a valid company member." });
      const { data, error } = await admin.rpc("assign_discovery_lead", {
        p_company_id: companyId, p_actor_user_id: caller.id, p_lead_id: payload.leadId,
        p_assignee_id: assigneeId, p_reason_code: String(payload.reasonCode || (assigneeId ? "assignment_change" : "unassigned"))
      });
      if (error) {
        if (error.code === "42501") return jsonResponse(403, { error: error.message });
        if (error.code === "P0002") return jsonResponse(404, { error: error.message });
        if (error.code === "22023") return jsonResponse(400, { error: error.message });
        throw error;
      }
      return jsonResponse(200, { ok: true, lead: data });
    }

    if (action === "leads.transition") {
      if (!isUuid(payload.leadId)) return jsonResponse(400, { error: "A valid lead ID is required." });
      const { data, error } = await admin.rpc("transition_discovery_lead", {
        p_company_id: companyId, p_actor_user_id: caller.id, p_lead_id: payload.leadId,
        p_new_status: String(payload.status || ""), p_reason_code: String(payload.reasonCode || "stage_progress")
      });
      if (error) {
        if (error.code === "42501") return jsonResponse(403, { error: error.message });
        if (error.code === "P0002") return jsonResponse(404, { error: error.message });
        if (error.code === "22023") return jsonResponse(400, { error: error.message });
        throw error;
      }
      return jsonResponse(200, { ok: true, lead: data });
    }

    if (action === "leads.priority") {
      if (!isUuid(payload.leadId)) return jsonResponse(400, { error: "A valid lead ID is required." });
      const { data, error } = await admin.rpc("set_discovery_lead_priority", {
        p_company_id: companyId, p_actor_user_id: caller.id, p_lead_id: payload.leadId,
        p_priority: String(payload.priority || "")
      });
      if (error) {
        if (error.code === "42501") return jsonResponse(403, { error: error.message });
        if (error.code === "P0002") return jsonResponse(404, { error: error.message });
        if (error.code === "22023") return jsonResponse(400, { error: error.message });
        throw error;
      }
      return jsonResponse(200, { ok: true, lead: data });
    }

    if (action === "leads.next-action") {
      if (!isUuid(payload.leadId)) return jsonResponse(400, { error: "A valid lead ID is required." });
      const dueAt = payload.dueAt === null || payload.dueAt === "" ? null : String(payload.dueAt);
      if (dueAt !== null && !Number.isFinite(Date.parse(dueAt))) return jsonResponse(400, { error: "Next-action due date must be a valid timestamp." });
      const { data, error } = await admin.rpc("set_discovery_lead_next_action", {
        p_company_id: companyId, p_actor_user_id: caller.id, p_lead_id: payload.leadId,
        p_next_action_code: String(payload.nextActionCode || "none"), p_due_at: dueAt
      });
      if (error) {
        if (error.code === "42501") return jsonResponse(403, { error: error.message });
        if (error.code === "P0002") return jsonResponse(404, { error: error.message });
        if (error.code === "22023") return jsonResponse(400, { error: error.message });
        throw error;
      }
      return jsonResponse(200, { ok: true, lead: data });
    }

    if (action === "extractions.review") {
      if (!isUuid(payload.runId)) return jsonResponse(400, { error: "A valid extraction run ID is required." });
      const factId = isUuid(payload.factId) ? payload.factId : null;
      const entityId = isUuid(payload.entityId) ? payload.entityId : null;
      if (Boolean(factId) === Boolean(entityId)) return jsonResponse(400, { error: "Review exactly one extracted fact or entity mention." });
      const decision = typeof payload.decision === "string" ? payload.decision : "";
      if (!["accepted","rejected","corrected","escalated"].includes(decision)) {
        return jsonResponse(400, { error: "Choose an explicit extraction review decision." });
      }
      const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
      if (!reason || reason.length > 1000) return jsonResponse(400, { error: "A review reason is required and must not exceed 1000 characters." });
      const correctedValue = payload.correctedValue;
      if (decision === "corrected" && correctedValue === undefined) {
        return jsonResponse(400, { error: "A corrected value is required for a correction review event." });
      }
      if (decision !== "corrected" && correctedValue !== undefined) {
        return jsonResponse(400, { error: "A corrected value is accepted only for a correction decision." });
      }
      if (correctedValue !== undefined && new TextEncoder().encode(JSON.stringify(correctedValue)).length > 4096) {
        return jsonResponse(413, { error: "Corrected value must not exceed 4 KB." });
      }

      // The database transaction rechecks owner/admin role, run/fact scope and
      // writes the review event plus audit receipt atomically.
      const { data: saved, error: reviewError } = await admin.rpc("record_discovery_extraction_review", {
        p_company_id: companyId,
        p_actor_user_id: caller.id,
        p_run_id: payload.runId,
        p_fact_id: factId,
        p_entity_id: entityId,
        p_decision: decision,
        p_reason: reason,
        p_corrected_value: decision === "corrected" ? correctedValue : null
      });
      if (reviewError) {
        if (reviewError.code === "42501") return jsonResponse(403, { error: reviewError.message });
        if (reviewError.code === "P0002") return jsonResponse(404, { error: reviewError.message });
        throw reviewError;
      }
      const review = Array.isArray(saved) ? saved[0] : saved;
      if (!review) throw new Error("The extraction review transaction returned no receipt.");
      return jsonResponse(201, {
        ok: true,
        review: {
          id: review.id, decision: review.decision,
          reason: review.reason, occurred_at: review.occurred_at
        },
        message: "Human review receipt recorded atomically with its audit event. The immutable extracted fact or entity mention was not overwritten."
      });
    }

    if (action === "workers.control") {
      const enabled = payload.enabled === true;
      const reason = typeof payload.reason === "string" ? payload.reason.trim().slice(0, 500) : "";
      const { data, error } = await admin.rpc("set_discovery_company_worker_grant", {
        p_company_id: companyId,
        p_actor_user_id: caller.id,
        p_enabled: enabled,
        p_reason: reason
      });
      if (error) throw error;
      const record = Array.isArray(data) ? data[0] : data;
      if (!record) throw new Error("The worker grant transaction returned no record.");
      return jsonResponse(200, { ok: true, worker: {
        enabled: record.enabled,
        expiresAt: record.expires_at,
        updatedAt: record.updated_at,
        reason: record.reason
      } });
    }

    if (action === "sources.register") {
      const source = normalizeSourceRegistration(payload);
      const { data, error } = await admin.from("discovery_source_registry")
        .insert({ ...source, company_id: companyId, created_by: caller.id, updated_by: caller.id })
        .select("*").single();
      if (error) {
        if (error.code === "23505") return jsonResponse(409, { error: "This canonical source URL is already registered for this company." });
        throw error;
      }
      await writeAudit(admin, {
        company_id: companyId, actor_user_id: caller.id, action: "source_registered",
        entity_type: "source", entity_id: data.id, details: { name: data.name, domain: data.domain, initialStatus: "pending" }
      });
      return jsonResponse(201, { ok: true, source: data, message: "Source registered as pending. It cannot be fetched until an administrator completes the terms and policy review." });
    }

    if (action === "sources.review") {
      if (!isUuid(payload.sourceId)) return jsonResponse(400, { error: "A valid source ID is required." });
      const { data: existing, error: lookupError } = await admin.from("discovery_source_registry")
        .select("*").eq("company_id", companyId).eq("id", payload.sourceId).maybeSingle();
      if (lookupError) throw lookupError;
      if (!existing) return jsonResponse(404, { error: "Source was not found in this company." });
      const review = normalizeSourceReview(payload, existing, caller.id);
      const { data, error } = await admin.from("discovery_source_registry")
        .update({ ...review, updated_by: caller.id, updated_at: new Date().toISOString() })
        .eq("company_id", companyId).eq("id", payload.sourceId).select("*").single();
      if (error) throw error;
      let disabledProfiles: string[] = [];
      if (review.status !== "approved") {
        const { data: attachedProfiles, error: attachedProfilesError } = await admin
          .from("discovery_profile_sources").select("profile_id")
          .eq("company_id", companyId).eq("source_id", data.id);
        if (attachedProfilesError) throw attachedProfilesError;
        const profileIds = [...new Set((attachedProfiles || []).map((link: { profile_id: string }) => link.profile_id))];
        if (profileIds.length) {
          const { data: changedProfiles, error: disableError } = await admin.from("discovery_profiles")
            .update({ enabled: false, updated_by: caller.id, updated_at: new Date().toISOString() })
            .eq("company_id", companyId).in("id", profileIds).eq("enabled", true)
            .select("id");
          if (disableError) throw disableError;
          disabledProfiles = (changedProfiles || []).map((profile: { id: string }) => profile.id);
          for (const profileId of disabledProfiles) {
            await writeAudit(admin, {
              company_id: companyId, actor_user_id: caller.id, action: "profile_disabled",
              entity_type: "profile", entity_id: profileId,
              details: { reason: "attached_source_" + review.status, sourceId: data.id }
            });
          }
        }
      }
      const actionName = review.status === "approved" ? "source_approved" : review.status === "paused" ? "source_paused" : "source_rejected";
      await writeAudit(admin, {
        company_id: companyId, actor_user_id: caller.id, action: actionName,
        entity_type: "source", entity_id: data.id,
        details: { status: data.status, domain: data.domain, disabledProfiles: disabledProfiles.length }
      });
      return jsonResponse(200, { ok: true, source: data, disabledProfiles: disabledProfiles.length });
    }

    if (action === "profiles.upsert") {
      const workspaceKey = String(payload.workspaceKey || "");
      const discoveryMode = String(payload.discoveryMode || "").toUpperCase();
      const { data: existingProfile, error: existingProfileError } = await admin.from("discovery_profiles")
        .select("id,enabled").eq("company_id", companyId)
        .eq("workspace_key", workspaceKey).eq("discovery_mode", discoveryMode).maybeSingle();
      if (existingProfileError) throw existingProfileError;
      let compatibleApprovedSources: Record<string, unknown>[] = [];
      if (existingProfile?.id) {
        const { data: links, error: linkError } = await admin.from("discovery_profile_sources")
          .select("source_id").eq("company_id", companyId).eq("profile_id", existingProfile.id);
        if (linkError) throw linkError;
        const sourceIds = (links || []).map((link: { source_id: string }) => link.source_id);
        if (sourceIds.length) {
          const { data: approvedSources, error: sourceError } = await admin.from("discovery_source_registry")
            .select("*").eq("company_id", companyId).eq("status", "approved").in("id", sourceIds);
          if (sourceError) throw sourceError;
          compatibleApprovedSources = (approvedSources || []).filter((source: Record<string, unknown>) => {
            try {
              assertSourceCanBeAttached({
                workspace_key: workspaceKey,
                discovery_mode: discoveryMode,
                purpose: String(payload.purpose || ""),
                criteria: payload.criteria || {}
              }, source);
              return true;
            } catch {
              return false;
            }
          });
        }
      }
      const profile = normalizeProfile(payload, compatibleApprovedSources.length);
      const saved = await admin.from("discovery_profiles").upsert({
        ...profile, company_id: companyId,
        ...(existingProfile?.id ? {} : { created_by: caller.id }),
        updated_by: caller.id, updated_at: new Date().toISOString()
      }, { onConflict: "company_id,workspace_key,discovery_mode" }).select("*").single();
      if (saved.error) throw saved.error;
      const auditAction = !existingProfile
        ? "profile_created"
        : saved.data.enabled
          ? "profile_enabled"
          : existingProfile.enabled
            ? "profile_disabled"
            : "profile_updated";
      await writeAudit(admin, {
        company_id: companyId, actor_user_id: caller.id,
        action: auditAction,
        entity_type: "profile", entity_id: saved.data.id,
        details: { workspaceKey, discoveryMode, enabled: saved.data.enabled, compatibleApprovedSourceCount: compatibleApprovedSources.length }
      });
      return jsonResponse(200, { ok: true, profile: saved.data });
    }

    if (action === "profiles.attach-source") {
      if (!isUuid(payload.profileId) || !isUuid(payload.sourceId)) return jsonResponse(400, { error: "Valid profile and source IDs are required." });
      const [{ data: profile, error: profileError }, { data: source, error: sourceError }] = await Promise.all([
        admin.from("discovery_profiles").select("*").eq("company_id", companyId).eq("id", payload.profileId).maybeSingle(),
        admin.from("discovery_source_registry").select("*").eq("company_id", companyId).eq("id", payload.sourceId).maybeSingle()
      ]);
      if (profileError) throw profileError;
      if (sourceError) throw sourceError;
      if (!profile || !source) return jsonResponse(404, { error: "The profile or source was not found in this company." });
      assertSourceCanBeAttached(profile, source);
      const { error } = await admin.from("discovery_profile_sources").upsert({
        company_id: companyId, profile_id: profile.id, source_id: source.id, created_by: caller.id
      }, { onConflict: "company_id,profile_id,source_id", ignoreDuplicates: true });
      if (error) throw error;
      await writeAudit(admin, {
        company_id: companyId, actor_user_id: caller.id, action: "profile_source_attached",
        entity_type: "profile_source", entity_id: profile.id, details: { sourceId: source.id }
      });
      return jsonResponse(200, { ok: true, message: "Approved source attached to the workspace profile." });
    }

    if (action === "profiles.detach-source") {
      if (!isUuid(payload.profileId) || !isUuid(payload.sourceId)) return jsonResponse(400, { error: "Valid profile and source IDs are required." });
      const { error } = await admin.from("discovery_profile_sources").delete()
        .eq("company_id", companyId).eq("profile_id", payload.profileId).eq("source_id", payload.sourceId);
      if (error) throw error;
      const { count, error: countError } = await admin.from("discovery_profile_sources")
        .select("*", { count: "exact", head: true }).eq("company_id", companyId).eq("profile_id", payload.profileId);
      if (countError) throw countError;
      if ((count || 0) === 0) {
        const { error: disableError } = await admin.from("discovery_profiles")
          .update({ enabled: false, updated_by: caller.id, updated_at: new Date().toISOString() })
          .eq("company_id", companyId).eq("id", payload.profileId);
        if (disableError) throw disableError;
      }
      await writeAudit(admin, {
        company_id: companyId, actor_user_id: caller.id, action: "profile_source_detached",
        entity_type: "profile_source", entity_id: payload.profileId, details: { sourceId: payload.sourceId, remainingSources: count || 0 }
      });
      return jsonResponse(200, { ok: true, remainingSources: count || 0, profileDisabled: (count || 0) === 0 });
    }

    return jsonResponse(400, { error: "Choose a supported discovery governance action." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The discovery governance action failed.";
    console.error("discovery-control: action failed", message);
    return jsonResponse(400, { error: message });
  }
});
