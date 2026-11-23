import { useCallback, useEffect, useState } from "react";
import { Activity, CheckCircle2, CircleAlert, Clock3, GitBranch, LoaderCircle, Pause, Play, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { supabase } from "./lib/supabase";

type Workflow = { workflow_key: string; label: string; description: string; stage_keys: string[] };
type Stage = { stage_key: string; technical_stage: string; capability_name: string; description: string; dependency_stage_keys: string[]; permission_class: string; adapter_key: string | null; dispatch_ready: boolean; enabled_by_default: boolean };
type Step = { id: string; run_id: string; stage_key: string; step_order: number; depends_on_step_ids: string[]; status: string; dispatch_state: string; permission_class: string; stage_snapshot: Record<string, unknown> };
type Preflight = { step_id: string; run_id: string; blocker_codes: string[]; unsatisfied_dependency_count: number; unsatisfied_dependency_ids: string[]; dispatch_permitted: boolean; execution_context_bound?: boolean; profile_id?: string | null; source_id?: string | null; purpose?: string | null; required_fields?: string[] | null; profile_enabled?: boolean; source_status?: string | null; context_snapshot_current?: boolean; purpose_still_allowed?: boolean; fields_still_allowed?: boolean };
type Profile = { id: string; workspace_key: string; discovery_mode: string; jurisdiction: string; purpose: string; enabled: boolean };
type Source = { id: string; name: string; status: string; allowed_purposes: string[]; allowed_fields: string[] };
type ProfileSource = { profile_id: string; source_id: string };
type ContextEvent = { id: string; run_id: string; event_type: string; profile_id: string; source_id: string; purpose: string; required_fields: string[]; reason: string; occurred_at: string; actor_user_id: string | null };
type Event = { id: string; run_id: string; event_type: string; previous_status: string | null; new_status: string; reason: string; occurred_at: string; actor_user_id: string | null };
type Run = { id: string; workflow_key: string; workflow_label: string; status: string; dispatch_state: string; requested_by: string; approved_by: string | null; approved_at: string | null; decision_reason: string | null; stage_count: number; unavailable_adapter_count: number; disabled_stage_count: number; all_stage_gates_ready: boolean; created_at: string };
type ApiResponse = { ok?: boolean; error?: string; message?: string; workflows?: Workflow[]; stages?: Stage[]; runs?: Run[]; steps?: Step[]; events?: Event[]; preflight?: Preflight[]; profiles?: Profile[]; sources?: Source[]; profileSources?: ProfileSource[]; contextEvents?: ContextEvent[]; runId?: string };

function readableError(error: unknown) {
  return error instanceof Error ? error.message : "The orchestration request failed.";
}
function formatDate(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleString();
}
function statusLabel(value: string) {
  return value.replaceAll("_", " ");
}

export default function DiscoveryOrchestrationWorkspace({
  companyId,
  companyRole
}: {
  companyId?: string;
  companyRole?: string;
}) {
  const canManage = companyRole === "owner" || companyRole === "admin";
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [preflight, setPreflight] = useState<Preflight[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [profileSources, setProfileSources] = useState<ProfileSource[]>([]);
  const [contextEvents, setContextEvents] = useState<ContextEvent[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [requiredFieldNames, setRequiredFieldNames] = useState("");
  const [selectedWorkflow, setSelectedWorkflow] = useState("company_identity");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const invoke = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    if (!companyId) throw new Error("Open an authenticated company workspace first.");
    if (!supabase) throw new Error("Cloud authentication is not configured.");
    const { data, error: invokeError } = await supabase.functions.invoke("discovery-control", {
      body: { companyId, action, payload }
    });
    if (invokeError) throw new Error(invokeError.message || "The orchestration service could not be reached.");
    const response = data as ApiResponse | null;
    if (!response?.ok) throw new Error(String(response?.error || "The orchestration request was not accepted."));
    return response;
  }, [companyId]);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError("");
    try {
      const result = await invoke("orchestration.list");
      setWorkflows(result.workflows || []);
      setStages(result.stages || []);
      setRuns(result.runs || []);
      setSteps(result.steps || []);
      setEvents(result.events || []);
      setPreflight(result.preflight || []);
      setProfiles(result.profiles || []);
      setSources(result.sources || []);
      setProfileSources(result.profileSources || []);
      setContextEvents(result.contextEvents || []);
      const enabledProfiles = (result.profiles || []).filter(profile => profile.enabled);
      const chosenProfile = enabledProfiles.find(profile => profile.id === selectedProfileId) || enabledProfiles[0];
      if ((chosenProfile?.id || "") !== selectedProfileId) setSelectedProfileId(chosenProfile?.id || "");
      const attachedSourceIds = (result.profileSources || []).filter(link => link.profile_id === chosenProfile?.id).map(link => link.source_id);
      const eligibleSources = (result.sources || []).filter(source => source.status === "approved" && attachedSourceIds.includes(source.id));
      const chosenSource = eligibleSources.find(source => source.id === selectedSourceId) || eligibleSources[0];
      if ((chosenSource?.id || "") !== selectedSourceId) setSelectedSourceId(chosenSource?.id || "");
      if (result.workflows?.length && !result.workflows.some(item => item.workflow_key === selectedWorkflow)) {
        setSelectedWorkflow(result.workflows[0].workflow_key);
      }
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setLoading(false);
    }
  }, [companyId, invoke, selectedWorkflow, selectedProfileId, selectedSourceId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const requestRun = async () => {
    setBusy("request");
    setError("");
    setNotice("");
    try {
      const result = await invoke("orchestration.request", {
        workflowKey: selectedWorkflow,
        idempotencyKey: "e20-" + crypto.randomUUID()
      });
      setNotice("Orchestration plan created and submitted for owner/admin approval. No stage was dispatched.");
      await refresh();
      if (result.runId) {
        document.getElementById("ax-e20-run-" + result.runId)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy("");
    }
  };

  const bindContext = async (run: Run) => {
    const profile = profiles.find(item => item.id === selectedProfileId && item.enabled);
    const source = sources.find(item => item.id === selectedSourceId && item.status === "approved");
    const attached = profileSources.some(link => link.profile_id === profile?.id && link.source_id === source?.id);
    const fields = requiredFieldNames.split(",").map(value => value.trim()).filter(Boolean);
    if (!profile || !source || !attached) {
      setError("Choose an enabled company profile and an approved source attached to it.");
      return;
    }
    if (!fields.length) {
      setError("Enter at least one exact source-allow-listed field name.");
      return;
    }
    setBusy(run.id + ":context");
    setError("");
    setNotice("");
    try {
      await invoke("orchestration.bindContext", {
        runId: run.id,
        profileId: profile.id,
        sourceId: source.id,
        purpose: profile.purpose,
        requiredFields: fields,
        reason: "Company owner/admin bound this run to the approved profile purpose and source field allow-list."
      });
      setNotice("Run context bound and audited. The preflight still blocks dispatch until the remaining safeguards are implemented.");
      await refresh();
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy("");
    }
  };

  const sourcesForProfile = (profileId: string) => {
    const attachedIds = profileSources.filter(link => link.profile_id === profileId).map(link => link.source_id);
    return sources.filter(source => attachedIds.includes(source.id));
  };

  const decide = async (run: Run, decision: "approve" | "reject" | "pause" | "resume" | "cancel") => {
    const reason = decision === "approve" ? "Approved for controlled adapter-readiness review; execution remains disabled." :
      decision === "reject" ? "Plan rejected during owner/admin governance review." :
      decision === "pause" ? "Plan paused by company administrator." :
      decision === "resume" ? "Plan returned to approved-not-dispatched review state." :
      "Plan cancelled by company administrator.";
    setBusy(run.id + ":" + decision);
    setError("");
    setNotice("");
    try {
      await invoke("orchestration.decide", { runId: run.id, decision, reason });
      setNotice("Orchestration plan state updated. No stage was dispatched.");
      await refresh();
    } catch (reasonValue) {
      setError(readableError(reasonValue));
    } finally {
      setBusy("");
    }
  };

  const stepsFor = (runId: string) => steps.filter(step => step.run_id === runId).sort((a, b) => a.step_order - b.step_order);
  const eventsFor = (runId: string) => events.filter(event => event.run_id === runId).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const contextEventsFor = (runId: string) => contextEvents.filter(event => event.run_id === runId).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const preflightFor = (stepId: string) => preflight.find(item => item.step_id === stepId);
  const stagesByKey = new Map(stages.map(stage => [stage.stage_key, stage]));

  if (!companyId) {
    return <section className="discovery-orchestration"><div className="discovery-empty-state"><ShieldCheck size={26}/><h2>Company workspace required</h2><p>Agent orchestration plans and approvals are isolated by company.</p></div></section>;
  }

  return <section className="discovery-orchestration">
    <header className="discovery-orchestration-head">
      <div>
        <span className="section-kicker">E20 · REVISED ROADMAP E16</span>
        <h2>Agent orchestration control plane</h2>
        <p>Build a company-scoped stage plan with explicit dependencies, role-gated approval and an append-only decision history. This version prepares and approves plans only; it does not execute agents or enqueue stage jobs.</p>
      </div>
      <button type="button" className="secondary-button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={14}/>Refresh</button>
    </header>

    <div className="discovery-orchestration-guard"><ShieldCheck size={17}/><div><strong>Execution is disabled by design</strong><span>All E04–E12 adapters are currently unregistered, and every company/stage kill switch starts OFF. Approval means “approved for adapter-readiness review”, not “start worker”. Existing source grants and per-stage checks remain mandatory for any future dispatcher.</span></div></div>

    {error && <div className="discovery-feedback discovery-feedback--error" role="alert"><CircleAlert size={16}/><span>{error}</span><button type="button" onClick={() => setError("")} aria-label="Dismiss error"><XCircle size={15}/></button></div>}
    {notice && <div className="discovery-feedback discovery-feedback--success" role="status"><CheckCircle2 size={16}/><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="Dismiss notice">×</button></div>}

    <div className="discovery-orchestration-builder">
      <div><span className="section-kicker">PLAN BUILDER</span><h3>Request a governed workflow plan</h3><p>Submitting creates a draft plan and immutable request receipt. Any company member can request one; only owners/admins can approve or reject it.</p></div>
      <label>Workflow preset
        <select value={selectedWorkflow} onChange={event => setSelectedWorkflow(event.target.value)} disabled={loading || busy === "request"}>
          {workflows.map(workflow => <option key={workflow.workflow_key} value={workflow.workflow_key}>{workflow.label}</option>)}
        </select>
      </label>
      <button type="button" className="primary-button" onClick={() => void requestRun()} disabled={!workflows.length || loading || Boolean(busy)}>
        {busy === "request" ? <LoaderCircle size={15} className="spin"/> : <GitBranch size={15}/>}Create plan for approval
      </button>
    </div>

    <div className="discovery-orchestration-summary">
      <article><strong>{runs.length}</strong><span>Recent plans</span></article>
      <article><strong>{runs.filter(run => run.status === "awaiting_approval").length}</strong><span>Awaiting approval</span></article>
      <article><strong>{runs.filter(run => run.status === "approved_not_dispatched").length}</strong><span>Approved · not dispatched</span></article>
      <article><strong>{stages.length}</strong><span>Registered stages</span></article>
    </div>

    <div className="discovery-orchestration-stage-list">
      <div className="discovery-orchestration-section-head"><div><span className="section-kicker">STAGE REGISTRY</span><h3>Existing worker-stage inventory</h3></div><small>All dispatch adapters unavailable</small></div>
      <div className="discovery-orchestration-stage-grid">
        {stages.map(stage => <article key={stage.stage_key}>
          <div><b>{stage.technical_stage}</b><span>{stage.capability_name}</span></div>
          <small>{stage.description}</small>
          <em>{stage.permission_class.replaceAll("_", " ")}</em>
          <code>{stage.dependency_stage_keys.length ? stage.dependency_stage_keys.join(" → ") : "No upstream stage"}</code>
          <span className="discovery-orchestration-off">Adapter not registered · kill switch OFF</span>
        </article>)}
      </div>
    </div>

    <div className="discovery-orchestration-runs">
      <div className="discovery-orchestration-section-head"><div><span className="section-kicker">RUN GOVERNANCE</span><h3>Orchestration plans</h3></div><small>{loading ? "Refreshing…" : "Latest 40 plans"}</small></div>
      {!runs.length && !loading ? <p className="discovery-empty-inline">No orchestration plans have been requested for this company.</p> : runs.map(run => {
        const runSteps = stepsFor(run.id);
        const runEvents = eventsFor(run.id);
        const runContextEvents = contextEventsFor(run.id);
        const runContext = preflight.find(item => item.run_id === run.id);
        return <article className="discovery-orchestration-run" id={"ax-e20-run-" + run.id} key={run.id}>
          <div className="discovery-orchestration-run-head">
            <div><strong>{run.workflow_label}</strong><small>{run.id} · requested {formatDate(run.created_at)}</small></div>
            <span className={"discovery-orchestration-status status-" + run.status}>{statusLabel(run.status)}</span>
          </div>
          <div className="discovery-orchestration-preflight-banner"><ShieldCheck size={13}/> Read-only dry-run preflight: every step remains non-dispatchable until adapter, worker grant, source/purpose and privacy policy gates are implemented and independently approved.</div>
          {canManage && run.status === "awaiting_approval" && <div className="discovery-orchestration-context">
            <div><b>Bind governed execution context</b><small>Required before a run can ever become eligible for a future worker. This does not start execution.</small></div>
            <label>Enabled company profile
              <select value={selectedProfileId} onChange={event => {
                const nextProfileId = event.target.value;
                setSelectedProfileId(nextProfileId);
                const eligible = sourcesForProfile(nextProfileId).filter(source => source.status === "approved");
                setSelectedSourceId(eligible[0]?.id || "");
              }} disabled={loading || Boolean(busy)}>
                <option value="">Select profile</option>
                {profiles.filter(profile => profile.enabled).map(profile => <option key={profile.id} value={profile.id}>{profile.workspace_key} · {profile.discovery_mode} · {profile.jurisdiction}</option>)}
              </select>
            </label>
            <label>Approved attached source
              <select value={selectedSourceId} onChange={event => setSelectedSourceId(event.target.value)} disabled={loading || Boolean(busy) || !selectedProfileId}>
                <option value="">Select source</option>
                {sourcesForProfile(selectedProfileId).filter(source => source.status === "approved").map(source => <option key={source.id} value={source.id}>{source.name}</option>)}
              </select>
            </label>
            <label>Required field names (comma-separated)
              <input value={requiredFieldNames} onChange={event => setRequiredFieldNames(event.target.value)} placeholder="legal_name, registration_id" disabled={loading || Boolean(busy)}/>
            </label>
            <small>Profile purpose: {profiles.find(profile => profile.id === selectedProfileId)?.purpose || "Select a profile"} · Source allow-list: {sources.find(source => source.id === selectedSourceId)?.allowed_fields.join(", ") || "Select an approved source"}</small>
            <button type="button" className="secondary-button" onClick={() => void bindContext(run)} disabled={Boolean(busy) || !selectedProfileId || !selectedSourceId}>
              {busy === run.id + ":context" ? <LoaderCircle size={14} className="spin"/> : <ShieldCheck size={14}/>}Bind & validate context
            </button>
          </div>}
          <div className="discovery-orchestration-context-state">
            <ShieldCheck size={14}/>
            {runContext?.execution_context_bound
              ? <span>Context bound · {profiles.find(profile => profile.id === runContext.profile_id)?.workspace_key || "profile"} · {sources.find(source => source.id === runContext.source_id)?.name || "source"} · {runContext.context_snapshot_current ? "snapshot current" : "snapshot stale"}</span>
              : <span>Execution context not yet bound to an approved profile/source/purpose/field scope</span>}
          </div>
          <div className="discovery-orchestration-run-metrics">
            <span><GitBranch size={13}/>{run.stage_count} dependent stages</span>
            <span><CircleAlert size={13}/>{run.unavailable_adapter_count} adapters unavailable</span>
            <span><ShieldCheck size={13}/>{run.disabled_stage_count} stage kill switches OFF</span>
            <span><Activity size={13}/>Not dispatched</span>
          </div>
          <div className="discovery-orchestration-step-list">
            {runSteps.map(step => {
              const stage = stagesByKey.get(step.stage_key);
              return <div className="discovery-orchestration-step" key={step.id}>
                <span className="discovery-orchestration-step-no">{step.step_order}</span>
                <div><b>{stage?.technical_stage || step.stage_key} · {stage?.capability_name || step.stage_key}</b><small>Depends on {step.depends_on_step_ids.length ? step.depends_on_step_ids.length + " prior stage(s)" : "no prior stage"} · {step.permission_class.replaceAll("_", " ")}</small></div>
                <em>{statusLabel(step.status)}</em>
                {preflightFor(step.id) && <div className="discovery-orchestration-preflight">
                  <strong>{preflightFor(step.id)?.dispatch_permitted ? "Preflight eligible" : "Preflight blocked"}</strong>
                  <span>{preflightFor(step.id)?.blocker_codes.map(code => code.replaceAll("_"," ")).join(" · ") || "No reported blockers"}</span>
                </div>}
              </div>;
            })}
          </div>
          {canManage && <div className="discovery-orchestration-actions">
            {run.status === "awaiting_approval" && <>
              <button type="button" className="primary-button" onClick={() => void decide(run,"approve")} disabled={Boolean(busy)}><CheckCircle2 size={14}/>Approve plan only</button>
              <button type="button" className="secondary-button" onClick={() => void decide(run,"reject")} disabled={Boolean(busy)}>Reject</button>
            </>}
            {run.status === "approved_not_dispatched" && <>
              <button type="button" className="secondary-button" onClick={() => void decide(run,"pause")} disabled={Boolean(busy)}><Pause size={14}/>Pause plan</button>
              <button type="button" className="secondary-button" onClick={() => void decide(run,"cancel")} disabled={Boolean(busy)}>Cancel</button>
            </>}
            {run.status === "paused" && <>
              <button type="button" className="secondary-button" onClick={() => void decide(run,"resume")} disabled={Boolean(busy)}><Play size={14}/>Resume review state</button>
              <button type="button" className="secondary-button" onClick={() => void decide(run,"cancel")} disabled={Boolean(busy)}>Cancel</button>
            </>}
            {run.status === "awaiting_approval" && <button type="button" className="secondary-button" onClick={() => void decide(run,"cancel")} disabled={Boolean(busy)}>Cancel request</button>}
          </div>}
          {run.decision_reason && <p className="discovery-orchestration-decision"><b>Latest reason:</b> {run.decision_reason} {run.approved_at && <span>· approved by {run.approved_by} at {formatDate(run.approved_at)}</span>}</p>}
          <details className="discovery-orchestration-history">
            <summary><Clock3 size={13}/>Context history ({runContextEvents.length})</summary>
            {runContextEvents.map(event => <div key={event.id}><b>{statusLabel(event.event_type)}</b><small>{formatDate(event.occurred_at)} · {event.actor_user_id || "system"} · {event.profile_id} / {event.source_id}</small><p>{event.purpose} · fields: {event.required_fields.join(", ")}</p><p>{event.reason}</p></div>)}
          </details>
          <details className="discovery-orchestration-history">
            <summary><Clock3 size={13}/>Decision history ({runEvents.length})</summary>
            {runEvents.map(event => <div key={event.id}><b>{statusLabel(event.event_type)}</b><small>{formatDate(event.occurred_at)} · {event.actor_user_id || "system"}</small><p>{event.reason}</p></div>)}
          </details>
        </article>;
      })}
    </div>

    <p className="discovery-orchestration-footnote">Human approval never substitutes for source approval, company worker grants, purpose/field allow-lists, personal-data controls or stage-level kill switches. No outreach, underwriting, credit decision, property-title conclusion, AI-provider call or automatic entity merge is performed.</p>
  </section>;
}
