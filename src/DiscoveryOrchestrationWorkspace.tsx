import { useCallback, useEffect, useState } from "react";
import { Activity, CheckCircle2, CircleAlert, Clock3, GitBranch, LoaderCircle, Pause, Play, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { supabase } from "./lib/supabase";

type Workflow = { workflow_key: string; label: string; description: string; stage_keys: string[] };
type Stage = { stage_key: string; technical_stage: string; capability_name: string; description: string; dependency_stage_keys: string[]; permission_class: string; adapter_key: string | null; dispatch_ready: boolean; enabled_by_default: boolean };
type Step = { id: string; run_id: string; stage_key: string; step_order: number; depends_on_step_ids: string[]; status: string; dispatch_state: string; permission_class: string; stage_snapshot: Record<string, unknown> };
type Preflight = { step_id: string; run_id: string; blocker_codes: string[]; unsatisfied_dependency_count: number; unsatisfied_dependency_ids: string[]; dispatch_permitted: boolean; adapter_contract_platform_approved?: boolean; company_adapter_approved?: boolean; stage_queue_mode?: "existing_durable_queue" | "deterministic_inline" | null; stage_queue_table?: string | null; stage_queue_enqueue_path?: string | null; stage_queue_claim_routine?: string | null; stage_queue_bridge_enabled?: boolean; execution_context_bound?: boolean; profile_id?: string | null; source_id?: string | null; purpose?: string | null; required_fields?: string[] | null; profile_enabled?: boolean; source_status?: string | null; context_snapshot_current?: boolean; purpose_still_allowed?: boolean; fields_still_allowed?: boolean };
type AdapterContract = { adapter_key: string; stage_key: string; contract_version: string; required_permission_class: string; required_policy_checks: string[]; max_attempts: number; lease_seconds: number; max_parallel_per_company: number; enabled: boolean; reviewed_at: string | null; review_reason: string | null };
type AdapterApproval = { adapter_key: string; contract_version: string; status: "approved" | "rejected" | "suspended"; reviewed_at: string; review_reason: string; updated_at: string };
type AdapterEvent = { id: string; adapter_key: string; contract_version: string; event_type: string; previous_status: string | null; new_status: string; reason: string; occurred_at: string; actor_user_id: string | null };
type SchedulePreview = { run_id: string; step_id: string; stage_key: string; step_order: number; dependency_count: number; unsatisfied_dependency_count: number; failed_dependency_count: number; dependency_state: string; schedule_preview_state: string; dispatch_permitted: false };
type StageQueueContract = { stage_key: string; mapping_version: string; queue_mode: "existing_durable_queue" | "deterministic_inline"; queue_table: string | null; enqueue_path: string; claim_routine: string | null; source_migration: string; mapping_notes: string; bridge_enabled: false };
type ExecutionRecord = { execution_id: string; run_id: string; step_id: string; stage_key: string; adapter_key: string; state: string; attempt_count: number; max_attempts: number; available_at: string; last_error_code: string | null; last_error_summary: string | null; updated_at: string };
type AttemptRecord = { attempt_id: string; execution_id: string; attempt_number: number; status: string; error_code: string | null; failure_class: string | null; retryable: boolean; started_at: string; finished_at: string | null; next_retry_at: string | null; run_id: string; step_id: string; stage_key: string; adapter_key: string };
type FailurePolicy = { error_code: string; failure_class: string; retryable: boolean; base_delay_seconds: number; max_delay_seconds: number; max_attempts: number; safe_summary: string };
type OperationalRecord = {
  execution_id: string; run_id: string; step_id: string; stage_key: string; adapter_key: string;
  state: string; attempt_count: number; max_attempts: number; created_at: string; updated_at: string;
  available_at: string; queue_age_seconds: number | null; retry_wait_seconds: number | null;
  last_error_code: string | null; last_error_summary: string | null; lease_id: string | null;
  lease_state: "not_leased" | "active" | "expired" | "released"; worker_identity_id: string | null;
  worker_identity: string | null; worker_status: string | null; worker_expires_at: string | null;
  leased_at: string | null; lease_expires_at: string | null; lease_heartbeat_at: string | null;
  lease_heartbeat_age_seconds: number | null; stage_adapter_key: string | null;
  platform_contract_version: string | null; platform_adapter_enabled: boolean | null;
  company_approval_contract_version: string | null; company_approval_status: string | null;
  adapter_readiness_state: string;
};
type Profile = { id: string; workspace_key: string; discovery_mode: string; jurisdiction: string; purpose: string; enabled: boolean };
type Source = { id: string; name: string; status: string; allowed_purposes: string[]; allowed_fields: string[] };
type ProfileSource = { profile_id: string; source_id: string };
type ContextEvent = { id: string; run_id: string; event_type: string; profile_id: string; source_id: string; purpose: string; required_fields: string[]; reason: string; occurred_at: string; actor_user_id: string | null };
type WorkerIdentity = { id: string; worker_key: string; display_name: string; stage_keys: string[]; max_active_leases: number; lease_seconds: number; status: "active" | "paused" | "revoked"; expires_at: string; last_used_at: string | null; reason: string };
type WorkerEvent = { id: string; worker_identity_id: string; event_type: string; worker_key_snapshot: string; stage_keys_snapshot: string[]; reason: string; occurred_at: string; details: Record<string, unknown> };
type CompanyWorkerGrant = { enabled: boolean; expires_at: string; updated_at: string; reason: string };
type Event = { id: string; run_id: string; event_type: string; previous_status: string | null; new_status: string; reason: string; occurred_at: string; actor_user_id: string | null };
type Run = { id: string; workflow_key: string; workflow_label: string; status: string; dispatch_state: string; requested_by: string; approved_by: string | null; approved_at: string | null; decision_reason: string | null; stage_count: number; unavailable_adapter_count: number; disabled_stage_count: number; all_stage_gates_ready: boolean; created_at: string };
type ApiResponse = { ok?: boolean; error?: string; message?: string; workflows?: Workflow[]; stages?: Stage[]; runs?: Run[]; steps?: Step[]; events?: Event[]; preflight?: Preflight[]; profiles?: Profile[]; sources?: Source[]; profileSources?: ProfileSource[]; contextEvents?: ContextEvent[]; adapterContracts?: AdapterContract[]; adapterApprovals?: AdapterApproval[]; adapterEvents?: AdapterEvent[]; schedulePreview?: SchedulePreview[]; stageQueueContracts?: StageQueueContract[]; executions?: ExecutionRecord[]; attempts?: AttemptRecord[]; failurePolicies?: FailurePolicy[]; operations?: OperationalRecord[]; workerIdentities?: WorkerIdentity[]; workerEvents?: WorkerEvent[]; companyWorkerGrant?: CompanyWorkerGrant | null; workerToken?: string; worker?: WorkerIdentity; runId?: string };

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
function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "Not queued";
  const value = Math.max(0, Math.floor(seconds));
  if (value < 60) return value + "s";
  if (value < 3600) return Math.floor(value / 60) + "m " + (value % 60) + "s";
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return hours + "h " + minutes + "m";
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
  const [adapterContracts, setAdapterContracts] = useState<AdapterContract[]>([]);
  const [adapterApprovals, setAdapterApprovals] = useState<AdapterApproval[]>([]);
  const [adapterEvents, setAdapterEvents] = useState<AdapterEvent[]>([]);
  const [schedulePreview, setSchedulePreview] = useState<SchedulePreview[]>([]);
  const [stageQueueContracts, setStageQueueContracts] = useState<StageQueueContract[]>([]);
  const [executions, setExecutions] = useState<ExecutionRecord[]>([]);
  const [attempts, setAttempts] = useState<AttemptRecord[]>([]);
  const [failurePolicies, setFailurePolicies] = useState<FailurePolicy[]>([]);
  const [operations, setOperations] = useState<OperationalRecord[]>([]);
  const [adapterReviewReason, setAdapterReviewReason] = useState("Reviewed exact adapter version, permission class and source/purpose/personal-data checks for this company.");
  const [workerIdentities, setWorkerIdentities] = useState<WorkerIdentity[]>([]);
  const [workerEvents, setWorkerEvents] = useState<WorkerEvent[]>([]);
  const [companyWorkerGrant, setCompanyWorkerGrant] = useState<CompanyWorkerGrant | null>(null);
  const [workerKeyDraft, setWorkerKeyDraft] = useState("");
  const [workerNameDraft, setWorkerNameDraft] = useState("");
  const [workerStageKeys, setWorkerStageKeys] = useState<string[]>([]);
  const [workerMaxLeases, setWorkerMaxLeases] = useState(1);
  const [workerLeaseSeconds, setWorkerLeaseSeconds] = useState(120);
  const [workerExpiryMinutes, setWorkerExpiryMinutes] = useState(30);
  const [workerReason, setWorkerReason] = useState("Temporary worker scope for reviewed orchestration stages.");
  const [workerGrantConfirmed, setWorkerGrantConfirmed] = useState(false);
  const [workerToken, setWorkerToken] = useState("");
  const [workerTokenKey, setWorkerTokenKey] = useState("");
  const [revokeConfirm, setRevokeConfirm] = useState<Record<string, string>>({});
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
      setAdapterContracts(result.adapterContracts || []);
      setAdapterApprovals(result.adapterApprovals || []);
      setAdapterEvents(result.adapterEvents || []);
      setSchedulePreview(result.schedulePreview || []);
      setStageQueueContracts(result.stageQueueContracts || []);
      setExecutions(result.executions || []);
      setAttempts(result.attempts || []);
      setFailurePolicies(result.failurePolicies || []);
      setOperations(result.operations || []);
      setWorkerIdentities(result.workerIdentities || []);
      setWorkerEvents(result.workerEvents || []);
      setCompanyWorkerGrant(result.companyWorkerGrant || null);
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

  const grantWorker = async () => {
    if (!workerGrantConfirmed) {
      setError("Review and acknowledge the exact worker scope and expiry before granting this credential.");
      return;
    }
    const workerKey = workerKeyDraft.trim();
    const displayName = workerNameDraft.trim();
    if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(workerKey)) {
      setError("Use a worker key with 3–80 lowercase letters, digits, dot, underscore or dash.");
      return;
    }
    if (displayName.length < 3 || !workerStageKeys.length) {
      setError("Enter a display name and explicitly select at least one stage scope.");
      return;
    }
    if (!companyWorkerGrant?.enabled || Date.parse(companyWorkerGrant.expires_at) <= Date.now()) {
      setError("The temporary company worker grant must be active before a scoped orchestration worker can be granted.");
      return;
    }
    setBusy("worker-grant");
    setError("");
    setNotice("");
    setWorkerToken("");
    setWorkerTokenKey("");
    try {
      const result = await invoke("orchestration.workerGrant", {
        workerKey,
        displayName,
        stageKeys: workerStageKeys,
        maxActiveLeases: workerMaxLeases,
        leaseSeconds: workerLeaseSeconds,
        expiresMinutes: workerExpiryMinutes,
        reason: workerReason.trim()
      });
      setWorkerToken(result.workerToken || "");
      setWorkerTokenKey(workerKey);
      setNotice("Temporary worker identity granted. Its credential is shown once; no orchestration work can start while dispatch is disabled.");
      setWorkerKeyDraft("");
      setWorkerNameDraft("");
      setWorkerStageKeys([]);
      setWorkerGrantConfirmed(false);
      await refresh();
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy("");
    }
  };

  const controlWorker = async (worker: WorkerIdentity, status: "active" | "paused" | "revoked") => {
    if (status === "revoked" && revokeConfirm[worker.id] !== worker.worker_key) {
      setError("Type the exact worker key before revoking this identity.");
      return;
    }
    setBusy(worker.id + ":" + status);
    setError("");
    setNotice("");
    try {
      await invoke("orchestration.workerControl", {
        workerIdentityId: worker.id,
        status,
        reason: status === "revoked"
          ? "Owner/admin revoked this worker identity after typing its exact key. Active leases are released."
          : status === "paused"
            ? "Owner/admin paused this worker identity. Active leases are released."
            : "Owner/admin resumed this paused worker identity within its original expiry."
      });
      setRevokeConfirm(current => ({ ...current, [worker.id]: "" }));
      setNotice(status === "revoked" ? "Worker identity revoked; active leases were released immediately." : status === "paused" ? "Worker identity paused; active leases were released immediately." : "Worker identity resumed. Its original expiry still applies.");
      await refresh();
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy("");
    }
  };

  const reviewAdapter = async (adapter: AdapterContract, decision: "approved" | "rejected" | "suspended") => {
    const reason = adapterReviewReason.trim();
    if (reason.length < 10 || reason.length > 1000) {
      setError("Enter a company-specific adapter review reason of 10–1000 characters.");
      return;
    }
    if (!adapter.enabled || !adapter.reviewed_at || !adapter.review_reason || adapter.review_reason.trim().length < 10) {
      setError("Only a platform-reviewed, enabled adapter contract version can be reviewed for company approval.");
      return;
    }
    setBusy("adapter:" + adapter.adapter_key);
    setError("");
    setNotice("");
    try {
      await invoke("orchestration.adapterReview", {
        adapterKey: adapter.adapter_key,
        contractVersion: adapter.contract_version,
        decision,
        reason
      });
      setNotice("Company adapter review recorded. This does not enable a stage kill switch or dispatch work.");
      await refresh();
    } catch (reasonValue) {
      setError(readableError(reasonValue));
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
  const queuedOperations = operations.filter(item =>
    (item.state === "ready" || item.state === "retry_wait") && Date.parse(item.available_at) <= Date.now()
  );
  const oldestQueueAgeSeconds = queuedOperations.reduce(
    (oldest, item) => Math.max(oldest, item.queue_age_seconds || 0), 0
  );
  const activeLeaseCount = operations.filter(item => item.lease_state === "active").length;
  const expiredLeaseCount = operations.filter(item => item.lease_state === "expired").length;
  const terminalFailureCount = executions.filter(item => item.state === "failed").length;
  const adapterExceptions = new Map<string, string>();
  for (const item of operations) {
    if (item.adapter_readiness_state !== "current") {
      adapterExceptions.set(item.adapter_key, item.adapter_readiness_state);
    }
  }
  for (const contract of adapterContracts) {
    const approval = adapterApprovals.find(item => item.adapter_key === contract.adapter_key);
    if (approval?.status === "approved" && approval.contract_version !== contract.contract_version) {
      adapterExceptions.set(contract.adapter_key, "company_approval_stale");
    }
  }

  if (!companyId) {
    return <section className="discovery-orchestration" data-testid="e20-orchestration-workspace"><div className="discovery-empty-state"><ShieldCheck size={26}/><h2>Company workspace required</h2><p>Agent orchestration plans and approvals are isolated by company.</p></div></section>;
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

    <section className="discovery-orchestration-worker-panel" aria-label="E20.7 execution console and operational health">
      <div className="discovery-orchestration-section-head">
        <div><span className="section-kicker">E20.7 · OPERATIONS CONSOLE</span><h3>Execution health & live queue telemetry</h3></div>
        <small>Company-scoped · read-only snapshot</small>
      </div>
      <p>Operational telemetry is derived from durable execution, attempt and lease records. Queue age, retry delay, lease heartbeat, worker lifecycle and adapter-version readiness are observable here; this console never claims work or changes dispatch state.</p>
      <div className="discovery-orchestration-summary">
        <article><strong>{queuedOperations.length}</strong><span>Eligible queue items</span></article>
        <article><strong>{formatDuration(queuedOperations.length ? oldestQueueAgeSeconds : null)}</strong><span>Oldest queue age</span></article>
        <article><strong>{activeLeaseCount}</strong><span>Active leases</span></article>
        <article><strong>{expiredLeaseCount}</strong><span>Expired leases</span></article>
        <article><strong>{terminalFailureCount}</strong><span>Terminal failures</span></article>
        <article><strong>{adapterExceptions.size}</strong><span>Adapter/version exceptions</span></article>
      </div>
      <div className="discovery-orchestration-stage-grid">
        {operations.map(item => <article key={item.execution_id}>
          <div><b>{stagesByKey.get(item.stage_key)?.technical_stage || item.stage_key} · {item.stage_key}</b><span>{statusLabel(item.state)}</span></div>
          <small>{item.adapter_key} · attempt {item.attempt_count}/{item.max_attempts}</small>
          <small>Queue age: {formatDuration(item.queue_age_seconds)} · retry wait: {item.retry_wait_seconds === null ? "—" : formatDuration(item.retry_wait_seconds)}</small>
          <small>Lease: {statusLabel(item.lease_state)} · worker: {item.worker_identity || "None"}{item.worker_status ? " (" + statusLabel(item.worker_status) + ")" : ""}</small>
          {item.lease_heartbeat_age_seconds !== null && <small>Last heartbeat {formatDuration(item.lease_heartbeat_age_seconds)} ago · expires {formatDate(item.lease_expires_at)}</small>}
          <small>Platform version: {item.platform_contract_version || "Missing"} · company-approved: {item.company_approval_contract_version || "Not approved"} · {statusLabel(item.adapter_readiness_state)}</small>
          {item.last_error_code && <p><b>{item.last_error_code}</b> · {item.last_error_summary || "No safe summary recorded"}</p>}
          <small>Updated {formatDate(item.updated_at)} · run {item.run_id}</small>
        </article>)}
        {!operations.length && <p className="discovery-empty-inline">No durable execution records exist yet. Queue age and lease metrics will appear when governed execution records exist; dispatch remains OFF.</p>}
      </div>
      <details className="discovery-orchestration-history">
        <summary><ShieldCheck size={13}/>Adapter/version drift and readiness exceptions ({adapterExceptions.size})</summary>
        {Array.from(adapterExceptions.entries()).map(([adapterKey, state]) => <div key={adapterKey}>
          <b>{adapterKey} · {statusLabel(state)}</b>
          <small>{adapterContracts.find(item => item.adapter_key === adapterKey)?.contract_version || operations.find(item => item.adapter_key === adapterKey)?.platform_contract_version || "No current platform version"} · company approval {adapterApprovals.find(item => item.adapter_key === adapterKey)?.contract_version || "missing"}</small>
        </div>)}
        {!adapterExceptions.size && <p>No adapter-key or approved-version drift is visible in the current company snapshot.</p>}
      </details>
      <div className="discovery-orchestration-preflight-banner"><ShieldCheck size={13}/>Telemetry is observational only. The E20 preflight hard gate remains false and all nine existing E04–E12 queue bridges remain OFF.</div>
    </section>

    <section className="discovery-orchestration-worker-panel" aria-label="Scoped orchestration worker grants">
      <div className="discovery-orchestration-section-head">
        <div><span className="section-kicker">WORKER AUTHORITY</span><h3>Scoped worker identities</h3></div>
        <small>Temporary · stage-scoped · revocable</small>
      </div>
      <div className="discovery-orchestration-worker-gate">
        <ShieldCheck size={15}/>
        {companyWorkerGrant?.enabled && Date.parse(companyWorkerGrant.expires_at) > Date.now()
          ? <span>Company worker grant active until {formatDate(companyWorkerGrant.expires_at)}. Each identity below has a narrower scope and cannot extend that expiry.</span>
          : <span>Company worker grant is inactive or expired. A company owner/admin must enable the existing temporary company grant before adding a scoped identity.</span>}
      </div>
      {canManage && <div className="discovery-orchestration-worker-form">
        <div className="discovery-orchestration-worker-intro">
          <b>Grant a worker identity</b>
          <p>Choose its exact E04–E12 stages, maximum simultaneous leases and short expiry. Readiness only: this grant does not register an adapter, enable a stage or dispatch work.</p>
        </div>
        <label>Worker key
          <input value={workerKeyDraft} onChange={event => { setWorkerKeyDraft(event.target.value); setWorkerGrantConfirmed(false); }} placeholder="e05-parser-worker" disabled={Boolean(busy)}/>
        </label>
        <label>Display name
          <input value={workerNameDraft} onChange={event => { setWorkerNameDraft(event.target.value); setWorkerGrantConfirmed(false); }} placeholder="Extraction QA worker" disabled={Boolean(busy)}/>
        </label>
        <fieldset className="discovery-orchestration-worker-scopes">
          <legend>Permitted stage scope — select only required stages</legend>
          <div>
            {stages.map(stage => <label key={stage.stage_key}>
              <input
                type="checkbox"
                checked={workerStageKeys.includes(stage.stage_key)}
                onChange={event => {
                  setWorkerStageKeys(current => event.target.checked
                    ? [...current, stage.stage_key]
                    : current.filter(key => key !== stage.stage_key));
                  setWorkerGrantConfirmed(false);
                }}
                disabled={Boolean(busy)}
              />
              <span>{stage.technical_stage} · {stage.capability_name}</span>
            </label>)}
          </div>
        </fieldset>
        <div className="discovery-orchestration-worker-limits">
          <label>Maximum active leases
            <select value={workerMaxLeases} onChange={event => { setWorkerMaxLeases(Number(event.target.value)); setWorkerGrantConfirmed(false); }} disabled={Boolean(busy)}>
              {[1,2,3,4].map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>Lease duration
            <select value={workerLeaseSeconds} onChange={event => { setWorkerLeaseSeconds(Number(event.target.value)); setWorkerGrantConfirmed(false); }} disabled={Boolean(busy)}>
              {[30,60,90,120,180,300].map(value => <option key={value} value={value}>{value} seconds</option>)}
            </select>
          </label>
          <label>Grant expires after
            <select value={workerExpiryMinutes} onChange={event => { setWorkerExpiryMinutes(Number(event.target.value)); setWorkerGrantConfirmed(false); }} disabled={Boolean(busy)}>
              {[5,15,30,45,60].map(value => <option key={value} value={value}>{value} minutes</option>)}
            </select>
          </label>
        </div>
        <label>Grant reason
          <input value={workerReason} onChange={event => { setWorkerReason(event.target.value); setWorkerGrantConfirmed(false); }} minLength={10} maxLength={1000} disabled={Boolean(busy)}/>
        </label>
        <div className="discovery-orchestration-worker-preview" role="group" aria-label="Worker grant preview">
          <b>Grant preview</b>
          <span>Identity: {workerKeyDraft || "Not named"} · Stages: {workerStageKeys.length ? workerStageKeys.map(key => stages.find(stage => stage.stage_key === key)?.technical_stage || key).join(", ") : "None selected"}</span>
          <span>Concurrency: {workerMaxLeases} active lease(s) · Lease: {workerLeaseSeconds}s · Expiry: {workerExpiryMinutes} min (never beyond company grant)</span>
          <span>Authority: claim/heartbeat/release only. The E20 dispatch gate remains OFF; this grant cannot start discovery work.</span>
        </div>
        <label className="discovery-orchestration-worker-confirm">
          <input type="checkbox" checked={workerGrantConfirmed} onChange={event => setWorkerGrantConfirmed(event.target.checked)} disabled={Boolean(busy)}/>
          <span>I reviewed this exact stage scope, lease/concurrency limits and expiry. I understand this creates a temporary credential but does not enable dispatch.</span>
        </label>
        <button type="button" className="primary-button" onClick={() => void grantWorker()}
          disabled={!workerGrantConfirmed || Boolean(busy) || loading || workerKeyDraft.trim().length < 3 || workerNameDraft.trim().length < 3 || !workerStageKeys.length || workerReason.trim().length < 10 || !companyWorkerGrant?.enabled || Date.parse(companyWorkerGrant.expires_at) <= Date.now()}>
          {busy === "worker-grant" ? <LoaderCircle size={14} className="spin"/> : <ShieldCheck size={14}/>}Grant temporary worker identity
        </button>
      </div>}
      {workerToken && <div className="discovery-orchestration-worker-token" role="group" aria-label="One-time worker credential">
        <div><b>One-time credential for {workerTokenKey}</b><small>This value is shown once and is not stored in AXIVESTRA logs or audit history. Copy it to the worker's secret environment now. Do not paste it into chat or source code.</small></div>
        <code>{workerToken}</code>
        <div className="discovery-orchestration-worker-token-actions">
          <button type="button" className="secondary-button" onClick={() => {
            void navigator.clipboard.writeText(workerToken).then(
              () => setNotice("Worker credential copied. Store it in the worker's secret environment."),
              () => setError("Clipboard access was unavailable. Copy the one-time credential manually.")
            );
          }}><Activity size={14}/>Copy one-time credential</button>
          <button type="button" className="secondary-button" onClick={() => { setWorkerToken(""); setWorkerTokenKey(""); }}>Hide credential</button>
        </div>
      </div>}
      <div className="discovery-orchestration-worker-list">
        {workerIdentities.map(worker => {
          const expired = Date.parse(worker.expires_at) <= Date.now();
          return <article key={worker.id}>
            <div><b>{worker.display_name}</b><small>{worker.worker_key} · {worker.id}</small></div>
            <span className={"discovery-orchestration-worker-status status-" + (expired ? "expired" : worker.status)}>{expired ? "expired" : worker.status}</span>
            <p>Stages: {worker.stage_keys.map(key => stages.find(stage => stage.stage_key === key)?.technical_stage || key).join(", ")}</p>
            <p>{worker.max_active_leases} simultaneous lease(s) · {worker.lease_seconds}s lease · expires {formatDate(worker.expires_at)}</p>
            <small>Last used: {formatDate(worker.last_used_at)} · {operations.filter(item => item.worker_identity_id === worker.id && item.lease_state === "active").length} active lease(s) · {worker.reason}</small>
            {canManage && <div className="discovery-orchestration-worker-actions">
              {worker.status === "active" && !expired && <button type="button" className="secondary-button" onClick={() => void controlWorker(worker,"paused")} disabled={Boolean(busy)}>Pause worker</button>}
              {worker.status === "paused" && !expired && <button type="button" className="secondary-button" onClick={() => void controlWorker(worker,"active")} disabled={Boolean(busy)}>Resume worker</button>}
              {worker.status !== "revoked" && <div className="discovery-orchestration-worker-revoke">
                <label>Type {worker.worker_key} to revoke
                  <input value={revokeConfirm[worker.id] || ""} onChange={event => setRevokeConfirm(current => ({ ...current,[worker.id]:event.target.value }))} disabled={Boolean(busy)}/>
                </label>
                <button type="button" className="danger-button" onClick={() => void controlWorker(worker,"revoked")} disabled={Boolean(busy) || revokeConfirm[worker.id] !== worker.worker_key}>Revoke permanently</button>
              </div>}
            </div>}
          </article>;
        })}
        {!workerIdentities.length && <p className="discovery-empty-inline">No scoped orchestration worker identities have been granted.</p>}
      </div>
      <details className="discovery-orchestration-history">
        <summary><Clock3 size={13}/>Worker grant history ({workerEvents.length})</summary>
        {workerEvents.map(event => <div key={event.id}><b>{statusLabel(event.event_type)}</b><small>{event.worker_key_snapshot} · {formatDate(event.occurred_at)}</small><p>Stages: {event.stage_keys_snapshot.join(", ")} · {event.reason}</p></div>)}
      </details>
    </section>

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

    <section className="discovery-orchestration-worker-panel" aria-label="Versioned adapter contract approvals">
      <div className="discovery-orchestration-section-head">
        <div><span className="section-kicker">E20.5 · ADAPTER GOVERNANCE</span><h3>Versioned adapter contracts</h3></div>
        <small>{adapterContracts.length} platform catalogue entries</small>
      </div>
      <p>Adapter definitions are registered and platform-reviewed through controlled repository changes. A company owner/admin may approve, reject or suspend an exact enabled version. Company approval does not register executable code, enable a stage kill switch or activate dispatch.</p>
      {canManage && adapterContracts.some(item => item.enabled && item.reviewed_at) && <label>Company adapter review reason
        <input value={adapterReviewReason} onChange={event => setAdapterReviewReason(event.target.value)} minLength={10} maxLength={1000} disabled={Boolean(busy)}/>
      </label>}
      <div className="discovery-orchestration-stage-grid">
        {adapterContracts.map(adapter => {
          const approval = adapterApprovals.find(item => item.adapter_key === adapter.adapter_key);
          const platformApproved = adapter.enabled && Boolean(adapter.reviewed_at) && (adapter.review_reason || "").trim().length >= 10;
          const canReview = canManage && platformApproved && !busy;
          return <article key={adapter.adapter_key}>
            <div><b>{adapter.adapter_key}</b><span>{adapter.stage_key} · {adapter.contract_version}</span></div>
            <small>Permission: {adapter.required_permission_class.replaceAll("_", " ")} · required checks: {adapter.required_policy_checks.join(", ") || "None declared"}</small>
            <small>Attempts: {adapter.max_attempts} · lease: {adapter.lease_seconds}s · per-company adapter concurrency: {adapter.max_parallel_per_company}</small>
            <span className="discovery-orchestration-off">{platformApproved ? "Platform contract approved" : "Platform review required · not eligible for company approval"}</span>
            <span className="discovery-orchestration-off">Company status: {approval ? statusLabel(approval.status) + " · " + approval.contract_version : "Not reviewed"}</span>
            {approval?.review_reason && <small>Latest company reason: {approval.review_reason}</small>}
            {canManage && <div className="discovery-orchestration-worker-actions">
              {canReview && approval?.status !== "approved" && <button type="button" className="primary-button" onClick={() => void reviewAdapter(adapter,"approved")} disabled={Boolean(busy) || adapterReviewReason.trim().length < 10}>Approve exact version for company</button>}
              {canReview && approval?.status !== "rejected" && <button type="button" className="secondary-button" onClick={() => void reviewAdapter(adapter,"rejected")} disabled={Boolean(busy) || adapterReviewReason.trim().length < 10}>Reject version</button>}
              {canReview && approval?.status === "approved" && <button type="button" className="danger-button" onClick={() => void reviewAdapter(adapter,"suspended")} disabled={Boolean(busy) || adapterReviewReason.trim().length < 10}>Suspend company approval</button>}
            </div>}
          </article>;
        })}
        {!adapterContracts.length && <p className="discovery-empty-inline">No versioned adapter contracts are registered in the platform catalogue. No production adapter is added or enabled by E20.5.</p>}
      </div>
      <details className="discovery-orchestration-history">
        <summary><Clock3 size={13}/>Company adapter review history ({adapterEvents.length})</summary>
        {adapterEvents.map(event => <div key={event.id}><b>{event.adapter_key} · {event.contract_version} · {statusLabel(event.event_type)}</b><small>{formatDate(event.occurred_at)} · {event.actor_user_id || "system"}</small><p>{event.reason}</p></div>)}
        {!adapterEvents.length && <p>No company adapter review events have been recorded.</p>}
      </details>
    </section>

    <section className="discovery-orchestration-worker-panel" aria-label="Existing E04 through E12 queue map">
      <div className="discovery-orchestration-section-head">
        <div><span className="section-kicker">E20.5 · LEGACY QUEUE CONTRACTS</span><h3>Existing stage queue map</h3></div>
        <small>{stageQueueContracts.length}/9 stages mapped</small>
      </div>
      <p>This maps orchestration stages onto the queue systems already in AXIVESTRA. It does not create duplicate queues, call enqueue/claim functions or turn on a queue bridge.</p>
      <div className="discovery-orchestration-stage-grid">
        {stageQueueContracts.map(contract => {
          const stage = stages.find(item => item.stage_key === contract.stage_key);
          return <article key={contract.stage_key}>
            <div><b>{stage?.technical_stage || contract.stage_key}</b><span>{stage?.capability_name || contract.stage_key}</span></div>
            <small>Mode: {statusLabel(contract.queue_mode)} · Queue: {contract.queue_table || "No dedicated queue — deterministic inline engine"}</small>
            <small>Enqueue: {contract.enqueue_path}</small>
            <small>Claim: {contract.claim_routine || "Not applicable"}</small>
            <small>Defined by: {contract.source_migration}</small>
            <p>{contract.mapping_notes}</p>
            <span className="discovery-orchestration-off">Bridge: {contract.bridge_enabled ? "Enabled" : "OFF · read-only mapping"}</span>
          </article>;
        })}
        {!stageQueueContracts.length && <p className="discovery-empty-inline">Stage queue mappings are not available.</p>}
      </div>
    </section>

    <section className="discovery-orchestration-worker-panel" aria-label="Retry and recovery execution history">
      <div className="discovery-orchestration-section-head">
        <div><span className="section-kicker">E20.6 · ATTEMPT RECOVERY</span><h3>Execution attempts and retry status</h3></div>
        <small>{attempts.length} recent attempt receipts</small>
      </div>
      <p>Each issued lease consumes one bounded attempt. Failures are classified only by the platform error-code catalogue; retryable failures use capped exponential backoff. Unknown codes are not retried. This is a read-only operational view.</p>
      <div className="discovery-orchestration-summary">
        <article><strong>{executions.filter(item => item.state === "retry_wait").length}</strong><span>Waiting to retry</span></article>
        <article><strong>{executions.filter(item => item.state === "failed").length}</strong><span>Failed terminally</span></article>
        <article><strong>{executions.filter(item => item.state === "succeeded").length}</strong><span>Succeeded</span></article>
        <article><strong>{executions.reduce((sum,item) => sum + item.attempt_count,0)}</strong><span>Attempts consumed</span></article>
      </div>
      <div className="discovery-orchestration-stage-grid">
        {executions.map(execution => <article key={execution.execution_id}>
          <div><b>{stages.find(item => item.stage_key === execution.stage_key)?.technical_stage || execution.stage_key} · {execution.stage_key}</b><span>{statusLabel(execution.state)}</span></div>
          <small>{execution.adapter_key} · {execution.attempt_count}/{execution.max_attempts} attempts</small>
          {execution.last_error_code && <small>{execution.last_error_code} · {execution.last_error_summary || "No summary"}</small>}
          {execution.state === "retry_wait" && <span className="discovery-orchestration-off">Next eligible retry after {formatDate(execution.available_at)}</span>}
          <small>Updated {formatDate(execution.updated_at)} · run {execution.run_id}</small>
        </article>)}
        {!executions.length && <p className="discovery-empty-inline">No orchestration execution records exist. Plans remain un-dispatched until the separately approved release gate.</p>}
      </div>
      <details className="discovery-orchestration-history">
        <summary><Clock3 size={13}/>Attempt receipt history ({attempts.length})</summary>
        {attempts.map(attempt => <div key={attempt.attempt_id}>
          <b>{attempt.stage_key} · attempt {attempt.attempt_number} · {statusLabel(attempt.status)}</b>
          <small>{attempt.error_code || "No error"} · {attempt.failure_class || "No failure class"} · {attempt.retryable ? "retryable" : "not retryable"}</small>
          <small>Started {formatDate(attempt.started_at)} · finished {formatDate(attempt.finished_at)}</small>
          {attempt.next_retry_at && <small>Retry not before {formatDate(attempt.next_retry_at)}</small>}
          <small>{attempt.adapter_key} · execution {attempt.execution_id}</small>
        </div>)}
        {!attempts.length && <p>No attempt receipts have been recorded.</p>}
      </details>
      <details className="discovery-orchestration-history">
        <summary><ShieldCheck size={13}/>Approved failure classification catalogue ({failurePolicies.length})</summary>
        {failurePolicies.map(policy => <div key={policy.error_code}>
          <b>{policy.error_code} · {statusLabel(policy.failure_class)}</b>
          <small>{policy.retryable ? "Retryable" : "Terminal"} · max attempts {policy.max_attempts}</small>
          <small>{policy.retryable ? "Backoff " + policy.base_delay_seconds + "s, capped at " + policy.max_delay_seconds + "s" : "No retry delay"}</small>
          <p>{policy.safe_summary}</p>
        </div>)}
        {!failurePolicies.length && <p>Failure policies are not available.</p>}
      </details>
      <div className="discovery-orchestration-preflight-banner"><ShieldCheck size={13}/>The retry scheduler does not turn on dispatch. The E20 preflight hard gate and all nine legacy queue bridges remain OFF.</div>
    </section>

    <section className="discovery-orchestration-worker-panel" aria-label="Dependency schedule preview">
      <div className="discovery-orchestration-section-head">
        <div><span className="section-kicker">DEPENDENCY SCHEDULER · DRY RUN</span><h3>Dependency schedule preview</h3></div>
        <small>{schedulePreview.length} planned steps</small>
      </div>
      <p>Shows which prerequisite steps are satisfied, waiting or blocked. This is a read-only projection; it never changes step state or enqueues the existing E04–E12 queues.</p>
      <div className="discovery-orchestration-step-list">
        {schedulePreview.map(item => {
          const stage = stages.find(value => value.stage_key === item.stage_key);
          return <div className="discovery-orchestration-step" key={item.step_id}>
            <span className="discovery-orchestration-step-no">{item.step_order}</span>
            <div><b>{stage?.technical_stage || item.stage_key} · {stage?.capability_name || item.stage_key}</b><small>{item.dependency_count} prerequisite(s) · {item.unsatisfied_dependency_count} outstanding · {item.failed_dependency_count} failed</small></div>
            <em>{statusLabel(item.dependency_state)}</em>
            <div className="discovery-orchestration-preflight"><strong>{statusLabel(item.schedule_preview_state)}</strong><span>Dispatch: permanently OFF</span></div>
          </div>;
        })}
        {!schedulePreview.length && <p className="discovery-empty-inline">No dependency schedule rows are available until a company plan is requested.</p>}
      </div>
    </section>

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
