import { createClient } from "npm:@supabase/supabase-js@2";
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

    if (action === "extractions.list") {
      const { data: runs, error: runsError } = await admin.from("discovery_extraction_runs")
        .select("id,extraction_job_id,evidence_id,source_id,extractor_version,schema_hash,extraction_method,status,extracted_entity_count,fact_count,invalid_fact_count,warnings,source_content_hash,completed_at")
        .eq("company_id", companyId).order("completed_at", { ascending: false }).limit(25);
      if (runsError) throw runsError;
      const runIds = (runs || []).map((run: { id: string }) => run.id);
      if (!runIds.length) return jsonResponse(200, { ok: true, runs: [], facts: [], entities: [], reviews: [] });
      const [{ data: facts, error: factsError }, { data: entities, error: entitiesError }, { data: reviews, error: reviewsError }] = await Promise.all([
        admin.from("discovery_extracted_facts")
          .select("id,extraction_run_id,evidence_id,extracted_entity_id,field_name,value_type,raw_value,normalized_value,source_span,confidence,validation_status,validation_message,extraction_method,created_at")
          .eq("company_id", companyId).in("extraction_run_id", runIds).order("created_at", { ascending: true }).limit(1000),
        admin.from("discovery_extracted_entities")
          .select("id,extraction_run_id,evidence_id,mention_key,entity_kind,raw_name,normalized_name,source_span,confidence,extraction_method,created_at")
          .eq("company_id", companyId).in("extraction_run_id", runIds).order("created_at", { ascending: true }).limit(500),
        admin.from("discovery_extraction_review_events")
          .select("id,extraction_run_id,fact_id,extracted_entity_id,actor_user_id,decision,reason,corrected_value,occurred_at")
          .eq("company_id", companyId).in("extraction_run_id", runIds).order("occurred_at", { ascending: false }).limit(1000)
      ]);
      if (factsError) throw factsError;
      if (entitiesError) throw entitiesError;
      if (reviewsError) throw reviewsError;
      return jsonResponse(200, {
        ok: true, runs: runs || [], facts: facts || [], entities: entities || [], reviews: reviews || [],
        limits: { runs: 25, facts: 1000, entities: 500, reviews: 1000 }
      });
    }

    if (action === "jobs.enqueue") {
      if (!isUuid(payload.profileId) || !isUuid(payload.sourceId)) return jsonResponse(400, { error: "Valid profile and source IDs are required." });
      const idempotencyKey = typeof payload.idempotencyKey === "string" ? payload.idempotencyKey.trim() : "";
      if (idempotencyKey.length < 8 || idempotencyKey.length > 160) return jsonResponse(400, { error: "Provide an idempotency key between 8 and 160 characters." });
      const criteria = payload.criteria && typeof payload.criteria === "object" && !Array.isArray(payload.criteria) ? payload.criteria as Record<string, unknown> : {};
      const candidateInput = Array.isArray(payload.candidateUrls) ? payload.candidateUrls : [];
      if (!candidateInput.length || candidateInput.length > 100 || candidateInput.some(url => typeof url !== "string" || url.length > 2048)) {
        return jsonResponse(400, { error: "Provide 1 to 100 candidate URLs, each no longer than 2048 characters." });
      }
      if (new TextEncoder().encode(JSON.stringify({ criteria, candidateUrls: candidateInput })).length > 48_000) {
        return jsonResponse(413, { error: "The discovery job payload must not exceed 48 KB." });
      }
      if (new TextEncoder().encode(JSON.stringify(criteria)).length > 8192) return jsonResponse(413, { error: "Discovery criteria must not exceed 8 KB." });
      const [{ data: profile, error: profileError }, { data: source, error: sourceError }, { data: link, error: linkError }] = await Promise.all([
        admin.from("discovery_profiles").select("*").eq("company_id", companyId).eq("id", payload.profileId).maybeSingle(),
        admin.from("discovery_source_registry").select("*").eq("company_id", companyId).eq("id", payload.sourceId).maybeSingle(),
        admin.from("discovery_profile_sources").select("profile_id").eq("company_id", companyId).eq("profile_id", payload.profileId).eq("source_id", payload.sourceId).maybeSingle()
      ]);
      if (profileError) throw profileError; if (sourceError) throw sourceError; if (linkError) throw linkError;
      if (!profile || !source || !link) return jsonResponse(404, { error: "The profile and its attached source must exist in this company." });
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
    if (!canManage && action !== "jobs.enqueue") return jsonResponse(403, { error: "Only this company's owner or admin can change discovery sources, profiles or worker permissions." });


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
