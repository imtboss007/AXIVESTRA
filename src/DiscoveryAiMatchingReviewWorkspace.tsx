import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Clock3, RefreshCw, ShieldCheck } from "lucide-react";
import { supabase } from "./lib/supabase";

type Suggestion = {
  id: string;
  company_id: string;
  match_result_id: string;
  workspace_key: string;
  candidate_label: string;
  deterministic_score: number;
  deterministic_confidence: number;
  deterministic_eligible: boolean;
  deterministic_review_state: string;
  provider_id: string;
  model_version: string;
  recommendation: "possible_match" | "not_a_match" | "insufficient_evidence";
  advisory_score: number;
  reasons: Array<{ criterion: string; code: string; evidenceIds: string[] }>;
  evidence_ids: string[];
  review_state: string;
  created_at: string;
  reviewed_at: string | null;
  review_reason: string | null;
};
type ReviewEvent = {
  id: string;
  suggestion_id: string;
  event_type: string;
  decision: string | null;
  reason: string;
  occurred_at: string;
  actor_user_id: string | null;
};

const decisionLabels = [
  ["accepted_for_review", "Accept for further human review"],
  ["needs_more_evidence", "Request more evidence"],
  ["rejected", "Reject advisory suggestion"]
] as const;
const humanize = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, x => x.toUpperCase());
const dateTime = (value: string) => new Date(value).toLocaleString();
function describeSupabaseError(cause: unknown, fallback: string) {
  if (cause instanceof Error && cause.message) return cause.message;
  if (cause && typeof cause === "object") {
    const value = cause as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    const message = typeof value.message === "string" && value.message.trim() ? value.message.trim() : fallback;
    const code = typeof value.code === "string" && value.code.trim() ? " [" + value.code.trim() + "]" : "";
    const details = typeof value.details === "string" && value.details.trim() ? " " + value.details.trim() : "";
    const hint = typeof value.hint === "string" && value.hint.trim() ? " Hint: " + value.hint.trim() : "";
    return message + code + details + hint;
  }
  return fallback;
}


export default function DiscoveryAiMatchingReviewWorkspace({
  companyId,
  companyRole
}: {
  companyId?: string;
  companyRole?: string;
}) {
  const canReview = companyRole === "owner" || companyRole === "admin";
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [events, setEvents] = useState<ReviewEvent[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    if (!companyId || !supabase) return;
    setLoading(true);
    setError("");
    try {
      const [suggestionResult, eventResult] = await Promise.all([
        supabase.from("discovery_ai_match_suggestion_inbox")
          .select("*").eq("company_id", companyId).order("created_at", { ascending: false }).limit(100),
        supabase.from("discovery_ai_match_suggestion_event_inbox")
          .select("id,suggestion_id,event_type,decision,reason,occurred_at,actor_user_id")
          .eq("company_id", companyId).order("occurred_at", { ascending: false }).limit(250)
      ]);
      if (suggestionResult.error) throw suggestionResult.error;
      if (eventResult.error) throw eventResult.error;
      setSuggestions((suggestionResult.data || []) as Suggestion[]);
      setEvents((eventResult.data || []) as ReviewEvent[]);
    } catch (cause) {
      setError(describeSupabaseError(cause, "Could not load E22 review records."));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const review = async (item: Suggestion) => {
    if (!supabase || !companyId || !canReview) return;
    const decision = decisions[item.id] || "needs_more_evidence";
    const reason = (reasons[item.id] || "").trim();
    if (reason.length < 10) {
      setError("Enter a review reason of at least 10 characters.");
      return;
    }
    setBusy(item.id);
    setError("");
    setNotice("");
    try {
      const { error: reviewError } = await supabase.rpc("review_discovery_ai_match_suggestion", {
        p_company_id: companyId,
        p_suggestion_id: item.id,
        p_decision: decision,
        p_reason: reason
      });
      if (reviewError) throw reviewError;
      setNotice("Human review recorded. The E11 match result and canonical records were not changed.");
      await refresh();
    } catch (cause) {
      setError(describeSupabaseError(cause, "The E22 review was not recorded."));
    } finally {
      setBusy("");
    }
  };

  if (!companyId) return <section className="data-panel discovery-panel"><p className="discovery-empty-inline"><ShieldCheck size={15}/> Open an authenticated company workspace to access E22 review records.</p></section>;

  const pending = suggestions.filter(item => item.review_state === "pending_review");
  const reviewed = suggestions.length - pending.length;

  return <section className="data-panel discovery-panel e22-review-workspace" data-testid="e22-review-workspace">
    <div className="section-heading">
      <div><span className="section-kicker">E22 · GOVERNED AI MATCHING</span><h2>AI suggestion review desk</h2>
        <p>Company-scoped advisory suggestions beside the authoritative E11 score. Human review only; no automatic match decision or lead promotion.</p></div>
      <button type="button" className="secondary-button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={14}/>Refresh</button>
    </div>
    <div className="discovery-notice"><ShieldCheck size={16}/><p><strong>Provider execution remains disabled by default.</strong> This desk displays only validated suggestions already recorded by an explicitly authorised service process.</p></div>
    {error && <div className="discovery-feedback discovery-feedback--error" role="alert"><CircleAlert size={16}/>{error}</div>}
    {notice && <div className="discovery-feedback discovery-feedback--success" role="status"><CheckCircle2 size={16}/>{notice}</div>}
    {!canReview && <p className="discovery-readonly">Read-only view. Only a company owner or admin can record a review decision.</p>}
    <div className="discovery-lead-stats">
      <div><strong>{suggestions.length}</strong><span>Recorded suggestions</span></div>
      <div><strong>{pending.length}</strong><span>Awaiting review</span></div>
      <div><strong>{reviewed}</strong><span>Reviewed</span></div>
      <div><strong>{events.length}</strong><span>History events loaded</span></div>
    </div>
    {loading && suggestions.length === 0 ? <div className="discovery-loading"><Clock3 size={15}/>Loading E22 review queue…</div> :
      suggestions.length === 0 ? <p className="discovery-empty-inline">No E22 suggestions have been recorded for this company. The queue does not generate suggestions or activate a model provider.</p> :
      <div className="discovery-source-list">{suggestions.map(item => {
        const itemEvents = events.filter(event => event.suggestion_id === item.id);
        return <article className="discovery-source-card e22-review-card" key={item.id} data-suggestion-id={item.id}>
          <div className="discovery-source-head">
            <div><strong>{item.candidate_label || "Candidate record"}</strong><small>{humanize(item.workspace_key)} · E11 match {item.match_result_id.slice(0, 8)}</small></div>
            <span className={"discovery-status discovery-status--" + (item.review_state === "pending_review" ? "pending" : "approved")}>{humanize(item.review_state)}</span>
          </div>
          <div className="discovery-meta-grid">
            <span><b>E11 deterministic score</b>{Number(item.deterministic_score).toFixed(1)} / 100</span>
            <span><b>E11 confidence</b>{Math.round(Number(item.deterministic_confidence) * 100)}%</span>
            <span><b>E11 eligibility</b>{item.deterministic_eligible ? "Eligible for review" : "Blocked"}</span>
            <span><b>E22 advisory score</b>{item.advisory_score} / 100 · ordinal only</span>
            <span><b>Suggestion</b>{humanize(item.recommendation)}</span>
            <span><b>Provider / model</b>{item.provider_id} · {item.model_version}</span>
            <span><b>Evidence references</b>{item.evidence_ids?.length || 0} metadata IDs</span>
            <span><b>Recorded</b>{dateTime(item.created_at)}</span>
          </div>
          <div className="e22-reasons"><b>Structured rationale</b>
            {item.reasons?.length ? item.reasons.map((reason, index) => <span key={index}>{humanize(reason.criterion)} · {humanize(reason.code)} · {reason.evidenceIds.length} evidence reference(s)</span>) : <small>No criterion rationale supplied.</small>}
          </div>
          <p className="discovery-guardrail">E22 does not override E11 blockers. No canonical entity mutation, match approval, lead creation or outreach is triggered by this record.</p>
          {item.review_state === "pending_review" && canReview && <div className="discovery-review-fields">
            <label>Human review decision<select value={decisions[item.id] || "needs_more_evidence"} onChange={event => setDecisions(current => ({ ...current, [item.id]: event.target.value }))} disabled={busy === item.id}>{decisionLabels.map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label>Review reason<textarea rows={2} minLength={10} maxLength={1000} value={reasons[item.id] || ""} onChange={event => setReasons(current => ({ ...current, [item.id]: event.target.value }))} placeholder="Record the evidence-based reason for this review decision." disabled={busy === item.id}/></label>
            <div className="discovery-action-row"><button type="button" className="primary-button" onClick={() => void review(item)} disabled={busy === item.id || (reasons[item.id] || "").trim().length < 10}><CheckCircle2 size={15}/>{busy === item.id ? "Saving review…" : "Record human review"}</button></div>
          </div>}
          {item.review_state !== "pending_review" && <div className="discovery-readonly"><CheckCircle2 size={14}/>Reviewed {item.reviewed_at ? dateTime(item.reviewed_at) : ""} · {item.review_reason || "No reason recorded"}</div>}
          {itemEvents.length > 0 && <details className="e22-history"><summary>Immutable history · {itemEvents.length} event(s)</summary>{itemEvents.map(event => <div key={event.id}><b>{humanize(event.event_type)}{event.decision ? " · " + humanize(event.decision) : ""}</b><small>{dateTime(event.occurred_at)} · {event.reason}</small></div>)}</details>}
        </article>;
      })}</div>}
  </section>;
}
