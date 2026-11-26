import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertCircle, CheckCircle2, LoaderCircle, RefreshCw, ShieldCheck, Target } from "lucide-react";
import { supabase } from "./lib/supabase";

type Profile = {
  id: string;
  workspace_key: string;
  discovery_mode: "LENDER" | "CUSTOMER";
  purpose: string;
  enabled: boolean;
  criteria: Record<string, unknown>;
};
type Candidate = {
  id: string;
  legalName: string;
  jurisdiction: string;
  entityType: string;
  acceptedObservationCount: number;
};
type MatchComponent = {
  criterion: string;
  weight: number;
  points: number;
  status: "match" | "mismatch" | "unknown";
  required: boolean;
  reason: string;
};
type MatchResult = {
  matchResultId: string;
  score: number;
  confidence: number;
  eligible: boolean;
  positives: Array<{ criterion: string; reason: string }>;
  negatives: Array<{ criterion: string; required: boolean; reason: string }>;
  unknown: string[];
  blockers: string[];
  components: MatchComponent[];
};
type ApiResponse = {
  ok?: boolean;
  error?: string;
  message?: string;
  candidates?: Candidate[];
  acceptedObservationCount?: number;
} & Partial<MatchResult>;

const humanize = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, part => part.toUpperCase());
const dateLabel = (value: string) => new Date(value).toLocaleString();

export default function DiscoveryMatchScoringWorkspace({
  companyId,
  companyRole,
  profiles
}: {
  companyId?: string;
  companyRole?: string;
  profiles: Profile[];
}) {
  const canScore = companyRole === "owner" || companyRole === "admin";
  const eligibleProfiles = useMemo(() => profiles.filter(profile =>
    profile.enabled &&
    profile.criteria?.disabledByPolicy !== true &&
    profile.criteria?.matchCriteria &&
    Object.keys(profile.criteria.matchCriteria as Record<string, unknown>).length > 0
  ), [profiles]);
  const [profileId, setProfileId] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [lastResults, setLastResults] = useState<Record<string, MatchResult>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedProfile = eligibleProfiles.find(profile => profile.id === profileId);

  const invoke = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    if (!companyId) throw new Error("Open an authenticated company workspace first.");
    if (!supabase) throw new Error("Cloud authentication is not configured for this company.");
    const { data, error: invokeError } = await supabase.functions.invoke("discovery-control", {
      body: { companyId, action, payload }
    });
    if (invokeError) throw new Error(invokeError.message || "E11 matching request failed.");
    const response = data as ApiResponse | null;
    if (!response?.ok) throw new Error(response?.error || "E11 matching request was not accepted.");
    return response;
  }, [companyId]);

  const refreshCandidates = useCallback(async () => {
    if (!profileId || !companyId) {
      setCandidates([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await invoke("matches.candidates.list", { profileId });
      setCandidates(result.candidates || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load accepted E10 candidates.");
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  }, [companyId, invoke, profileId]);

  useEffect(() => {
    if (!eligibleProfiles.some(profile => profile.id === profileId)) {
      setProfileId(eligibleProfiles[0]?.id || "");
    }
  }, [eligibleProfiles, profileId]);

  useEffect(() => { void refreshCandidates(); }, [refreshCandidates]);

  const evaluate = async (candidate: Candidate) => {
    if (!selectedProfile || !canScore) return;
    setBusy(candidate.id);
    setError("");
    setNotice("");
    try {
      const result = await invoke("matches.evaluate", {
        profileId: selectedProfile.id,
        canonicalEntityId: candidate.id
      });
      const match: MatchResult = {
        matchResultId: result.matchResultId || "",
        score: Number(result.score || 0),
        confidence: Number(result.confidence || 0),
        eligible: result.eligible === true,
        positives: result.positives || [],
        negatives: result.negatives || [],
        unknown: result.unknown || [],
        blockers: result.blockers || [],
        components: result.components || []
      };
      setLastResults(current => ({ ...current, [candidate.id]: match }));
      setNotice("E11 score saved to the pending human-review queue. No lead was created and no contact or approval action was taken.");
      await refreshCandidates();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "E11 scoring could not be completed.");
    } finally {
      setBusy("");
    }
  };

  if (!companyId) return null;

  return <section className="data-panel discovery-panel e11-scoring-workspace" data-testid="e11-scoring-workspace">
    <div className="section-heading">
      <div>
        <span className="section-kicker">E11 · DETERMINISTIC MATCHING</span>
        <h2>Workspace fit scoring</h2>
        <p>Compare canonical companies against explicit LENDER or CUSTOMER criteria using only owner-accepted E10 observations.</p>
      </div>
      <Target size={20}/>
    </div>
    <div className="discovery-notice">
      <ShieldCheck size={16}/>
      <p><strong>Human review required.</strong> E11 scores are advisory, not loan approval, investment advice, customer qualification or legal conclusions. Pending and conflicting evidence does not contribute.</p>
      <button type="button" onClick={() => void refreshCandidates()} disabled={loading || !profileId} aria-label="Refresh candidates"><RefreshCw size={15}/></button>
    </div>

    {error && <div className="discovery-feedback discovery-feedback--error" role="alert"><AlertCircle size={15}/>{error}</div>}
    {notice && <div className="discovery-feedback discovery-feedback--success" role="status"><CheckCircle2 size={15}/>{notice}</div>}
    {!canScore && <p className="discovery-readonly">Read-only view. Only a company owner or admin can create a persisted E11 score.</p>}

    <label className="discovery-profile-scoring-select">Enabled workspace profile
      <select value={profileId} onChange={event => setProfileId(event.target.value)} disabled={!eligibleProfiles.length || loading}>
        <option value="">Choose a profile with explicit E11 criteria</option>
        {eligibleProfiles.map(profile => <option value={profile.id} key={profile.id}>
          {humanize(profile.workspace_key)} · {profile.discovery_mode}
        </option>)}
      </select>
    </label>
    {!eligibleProfiles.length
      ? <p className="discovery-empty-inline">No enabled profile has explicit E11 criteria yet. Add matchCriteria to a workspace profile, attach an approved source, then enable the profile.</p>
      : !candidates.length && !loading
        ? <p className="discovery-empty-inline">No candidate has owner-accepted E10 enrichment observations from this profile's attached, approved sources. Review E10 observations first.</p>
        : <div className="discovery-match-candidate-list">
            {loading && <div className="discovery-loading"><LoaderCircle size={16}/>Loading accepted candidates…</div>}
            {candidates.map(candidate => {
              const result = lastResults[candidate.id];
              return <article className="discovery-match-candidate" key={candidate.id}>
                <div className="discovery-match-candidate-main">
                  <strong>{candidate.legalName || "Unnamed canonical organisation"}</strong>
                  <small>{candidate.entityType || "Organisation"} · {candidate.jurisdiction || "Jurisdiction not set"} · {candidate.acceptedObservationCount} accepted observation(s)</small>
                </div>
                {result && <div className="discovery-match-score-summary">
                  <b>{result.score.toFixed(1)} / 100</b>
                  <span>{Math.round(result.confidence * 100)}% evidence confidence · {result.eligible ? "no required mismatch" : "required mismatch"}</span>
                  <small>{result.components.filter(item => item.status === "match").length} matches · {result.unknown.length} unknown · {result.blockers.length} blocker(s)</small>
                </div>}
                <button type="button" className="secondary-button" onClick={() => void evaluate(candidate)} disabled={!canScore || busy === candidate.id || loading}>
                  {busy === candidate.id ? <LoaderCircle size={14}/> : <Activity size={14}/>}
                  {busy === candidate.id ? "Scoring…" : result ? "Recalculate E11" : "Evaluate E11 fit"}
                </button>
                {result && <details className="discovery-match-components">
                  <summary>Explainable criteria · {result.components.length}</summary>
                  {result.components.map(component => <div className="discovery-match-component" key={component.criterion}>
                    <span className={"discovery-match-component-status status-" + component.status}>{humanize(component.status)}</span>
                    <div><b>{humanize(component.criterion)}{component.required ? " · Required" : ""}</b><small>{component.reason}</small></div>
                    <span>{component.points.toFixed(1)} / {component.weight.toFixed(1)}</span>
                  </div>)}
                  <small>Score record {result.matchResultId.slice(0, 8)} · saved {dateLabel(new Date().toISOString())}</small>
                </details>}
              </article>;
            })}
          </div>}
  </section>;
}
