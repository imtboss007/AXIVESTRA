import { createClient } from "npm:@supabase/supabase-js@2";
import {
  normalizeSourceRegistration,
  normalizeSourceReview,
  normalizeProfile,
  assertSourceCanBeAttached
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

    if (!canManage) return jsonResponse(403, { error: "Only this company's owner or admin can change discovery sources and profiles." });

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
      const actionName = review.status === "approved" ? "source_approved" : review.status === "paused" ? "source_paused" : "source_rejected";
      await writeAudit(admin, {
        company_id: companyId, actor_user_id: caller.id, action: actionName,
        entity_type: "source", entity_id: data.id, details: { status: data.status, domain: data.domain }
      });
      return jsonResponse(200, { ok: true, source: data });
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
