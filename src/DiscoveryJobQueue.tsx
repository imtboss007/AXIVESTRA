import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { supabase } from "./lib/supabase";
import { Activity, Clock3, LoaderCircle, PlayCircle, RefreshCw, ShieldAlert, ShieldCheck, Square, Waypoints } from "lucide-react";
import { BorderBeam } from "./components/BorderBeam";
import { buildDiscoveryQueryHints } from "./lib/discovery-profiles.mjs";

type Source = { id: string; name: string; canonical_url: string; status: string; max_pages_per_job: number; rate_limit_per_minute: number };
type Profile = { id: string; workspace_key: string; discovery_mode: "LENDER" | "CUSTOMER"; purpose: string; enabled: boolean; criteria: Record<string, unknown> };
type Link = { profile_id: string; source_id: string };
type Job = {
  id: string; profile_id: string; source_id: string; status: string;
  attempts: number; max_attempts: number; created_at: string; started_at?: string | null;
  finished_at?: string | null; available_at: string; last_error_code?: string | null;
  last_error_message?: string | null;
};
type WorkerGrant = { enabled: boolean; expiresAt?: string | null; updatedAt?: string | null; reason?: string };
type SearchCandidate = {
  title: string; url: string; domain: string; snippet: string; engine: string;
  publishedAt: string | null; fetchedAt: string; status: "unverified_candidate";
  verified: false; evidenceId: null; approvedSourceId: string | null;
  approvedSourceName: string | null; fetchEligible: boolean;
};
type ApiResponse = {
  ok?: boolean; error?: string; jobs?: Job[]; job?: Job; worker?: WorkerGrant;
  duplicate?: boolean; message?: string; queries?: string[]; results?: SearchCandidate[];
};

function labelWorkspace(value: string) {
  return value.split("_").map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
function readableTime(value?: string | null) {
  if (!value) return "—";
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? "—" : time.toLocaleString();
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Discovery request failed.";
}

export default function DiscoveryJobQueue({
  companyId, companyRole, sources, profiles, links, initialWorkspaceKey, initialMode
}: {
  companyId?: string;
  companyRole?: string;
  sources: Source[];
  profiles: Profile[];
  links: Link[];
  initialWorkspaceKey?: string;
  initialMode?: "LENDER" | "CUSTOMER";
}) {
  const canManage = companyRole === "owner" || companyRole === "admin";
  const [jobs, setJobs] = useState<Job[]>([]);
  const [worker, setWorker] = useState<WorkerGrant>({ enabled: false });
  const [profileId, setProfileId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [candidateText, setCandidateText] = useState("");
  const [searchFilters, setSearchFilters] = useState({ location: "", sector: "", product: "" });
  const [searchResults, setSearchResults] = useState<SearchCandidate[]>([]);
  const [searchQueries, setSearchQueries] = useState<string[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const eligibleProfiles = useMemo(() => profiles.filter(profile => profile.enabled), [profiles]);
  const eligibleSources = useMemo(() => {
    if (!profileId) return [];
    const attached = new Set(links.filter(link => link.profile_id === profileId).map(link => link.source_id));
    return sources.filter(source => source.status === "approved" && attached.has(source.id));
  }, [links, profileId, sources]);
  const selectedProfile = eligibleProfiles.find(profile => profile.id === profileId);
  const selectedSource = eligibleSources.find(source => source.id === sourceId);
  const queryHints = useMemo(() => selectedProfile
    ? buildDiscoveryQueryHints(selectedProfile.criteria || {})
    : [], [selectedProfile]);

  const invoke = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    if (!companyId) throw new Error("An authenticated company workspace is required.");
    if (!supabase) throw new Error("Cloud authentication is not configured for this workspace.");
    const { data, error: invokeError } = await supabase.functions.invoke("discovery-control", {
      body: { companyId, action, payload }
    });
    if (invokeError) throw new Error(invokeError.message || "The discovery service could not be reached.");
    const result = data as ApiResponse | null;
    if (!result?.ok) throw new Error(result?.error || "Discovery request was not accepted.");
    return result;
  }, [companyId]);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setBusy("refresh");
    setError("");
    try {
      const [jobResult, workerResult] = await Promise.all([
        invoke("jobs.list"), invoke("workers.status")
      ]);
      setJobs(jobResult.jobs || []);
      setWorker(workerResult.worker || { enabled: false });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy("");
    }
  }, [companyId, invoke]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const preferred = initialWorkspaceKey
      ? eligibleProfiles.find(profile => profile.workspace_key === initialWorkspaceKey && profile.discovery_mode === (initialMode || "LENDER"))
      : undefined;
    if (preferred && profileId !== preferred.id) {
      setProfileId(preferred.id);
      setSourceId("");
      return;
    }
    if (!eligibleProfiles.some(profile => profile.id === profileId)) {
      const next = preferred || eligibleProfiles[0];
      setProfileId(next?.id || "");
      setSourceId("");
    }
  }, [eligibleProfiles, profileId, initialWorkspaceKey, initialMode]);

  useEffect(() => {
    if (!eligibleSources.some(source => source.id === sourceId)) setSourceId(eligibleSources[0]?.id || "");
  }, [eligibleSources, sourceId]);

  const searchPublicDirectories = async () => {
    if (!selectedProfile) {
      setError("Choose an enabled, policy-eligible workspace profile before searching.");
      return;
    }
    setBusy("search");
    setError("");
    setNotice("");
    setSearchResults([]);
    setSearchQueries([]);
    try {
      const result = await invoke("search.preview", {
        profileId: selectedProfile.id,
        filters: {
          location: searchFilters.location,
          sector: searchFilters.sector,
          product: searchFilters.product
        }
      });
      setSearchResults(result.results || []);
      setSearchQueries(result.queries || []);
      setNotice((result.message || "Search preview complete.") + " " + (result.results?.length || 0) + " unverified candidates returned.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy("");
    }
  };

  const addSearchCandidate = (candidate: SearchCandidate) => {
    if (!candidate.fetchEligible || !candidate.approvedSourceId) {
      setError("This result is not inside an approved, attached source path. Register and approve its source before fetching.");
      return;
    }
    const matchingSource = eligibleSources.find(source => source.id === candidate.approvedSourceId);
    if (!matchingSource) {
      setError("The approved source is no longer attached to the selected workspace profile.");
      return;
    }
    setSourceId(matchingSource.id);
    setCandidateText(current => {
      const rows = current.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
      return rows.includes(candidate.url) ? current : [...rows, candidate.url].join("\n");
    });
    setNotice("Candidate URL added to the E04 draft under " + matchingSource.name + ". It has not been fetched or verified.");
  };

  const enqueue = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const urls = [...new Set(candidateText.split(/\r?\n/).map(value => value.trim()).filter(Boolean))];
    if (!selectedProfile || !selectedSource) {
      setError("Choose an enabled workspace profile and one of its attached, approved sources.");
      return;
    }
    if (!urls.length || urls.length > selectedSource.max_pages_per_job) {
      setError("Enter 1 to " + selectedSource.max_pages_per_job + " source URLs, one per line.");
      return;
    }
    if (urls.length !== candidateText.split(/\r?\n/).map(value => value.trim()).filter(Boolean).length) {
      setError("Duplicate URLs are not allowed in a single discovery job.");
      return;
    }
    setBusy("enqueue");
    setError("");
    setNotice("");
    try {
      const result = await invoke("jobs.enqueue", {
        profileId: selectedProfile.id,
        sourceId: selectedSource.id,
        purpose: selectedProfile.purpose,
        criteria: selectedProfile.criteria || {},
        candidateUrls: urls,
        idempotencyKey
      });
      setCandidateText("");
      setIdempotencyKey(crypto.randomUUID());
      setNotice(result.duplicate ? "This exact request was already queued; the existing job was returned." : "Discovery job queued. No website has been contacted yet.");
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy("");
    }
  };

  const setWorkerGrant = async (enabled: boolean) => {
    setBusy("worker");
    setError("");
    setNotice("");
    try {
      const result = await invoke("workers.control", {
        enabled,
        reason: enabled
          ? "Owner/admin enabled approved-source fetching for a one-hour window."
          : "Owner/admin paused all company discovery fetching."
      });
      setWorker(result.worker || { enabled });
      setNotice(enabled
        ? "A one-hour company fetch grant is active. The separately hosted worker still requires DISCOVERY_WORKER_ENABLED=true."
        : "Company fetch grant revoked. New outbound requests are blocked.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy("");
    }
  };

  return <section className="discovery-queue-panel">
    <div className="discovery-queue-heading">
      <div>
        <span className="section-kicker">E04 · GOVERNED FETCH WORKER</span>
        <h2>Discovery queue & fetch controls</h2>
        <p>Submit only candidate URLs returned by an approved search step or entered from known source records. The worker does not crawl links or expand scope.</p>
      </div>
      <div className="discovery-queue-live"><Activity size={16}/><span>{worker.enabled ? "Company grant active" : "Fetch paused"}</span></div>
    </div>

    <div className="discovery-queue-grid">
      <div className="discovery-queue-card">
        <div className="discovery-queue-card-head"><div><span className="section-kicker">BOUNDED REQUEST</span><h3>Queue approved source URLs</h3></div><Waypoints size={19}/></div>
        <form onSubmit={enqueue} className="discovery-job-form">
          <label>Enabled workspace profile
            <select value={profileId} onChange={event => { setProfileId(event.target.value); setSourceId(""); setSearchResults([]); setSearchQueries([]); }} disabled={!eligibleProfiles.length || busy === "enqueue" || busy === "search"}>
              <option value="">Choose profile</option>
              {eligibleProfiles.map(profile => <option key={profile.id} value={profile.id}>{labelWorkspace(profile.workspace_key)} · {profile.discovery_mode}</option>)}
            </select>
          </label>
          <label>Attached approved source
            <select value={sourceId} onChange={event => setSourceId(event.target.value)} disabled={!eligibleSources.length || busy === "enqueue"}>
              <option value="">Choose source</option>
              {eligibleSources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}
            </select>
          </label>
          {selectedProfile && <div className="discovery-planner-preview">
            <span className="section-kicker">E01 · PROFILE-DRIVEN SEARCH PLAN</span>
            <b>Target classes</b><small>{Array.isArray(selectedProfile.criteria?.targetClasses) ? selectedProfile.criteria.targetClasses.join(" · ") : "Configure profile criteria first."}</small>
            <b>Suggested research queries</b><small>{queryHints.length ? queryHints.slice(0, 8).join(" · ") : "No query hints available."}</small>
            <small>These are deterministic research hints. Use the separate public-directory search below to retrieve unverified result links.</small>
          </div>}
          <div className="discovery-search-preview">
            <div className="section-kicker">E03 · PUBLIC DIRECTORY SEARCH</div>
            <div className="discovery-search-filter-grid">
              <label>Location<input value={searchFilters.location} onChange={event => setSearchFilters({ ...searchFilters, location: event.target.value })} placeholder="Karnataka / Bengaluru" maxLength={120} disabled={!selectedProfile || busy === "search"}/></label>
              <label>Sector<input value={searchFilters.sector} onChange={event => setSearchFilters({ ...searchFilters, sector: event.target.value })} placeholder="Banking / real estate" maxLength={100} disabled={!selectedProfile || busy === "search"}/></label>
              <label>Product / mandate<input value={searchFilters.product} onChange={event => setSearchFilters({ ...searchFilters, product: event.target.value })} placeholder="LAP / project finance" maxLength={100} disabled={!selectedProfile || busy === "search"}/></label>
            </div>
            <button type="button" className="secondary-button" onClick={() => void searchPublicDirectories()} disabled={!selectedProfile || busy === "search"}>
              {busy === "search" ? <LoaderCircle size={15}/> : <RefreshCw size={15}/>} Search public directories
            </button>
            <small>Uses the separately configured self-hosted search service. Search results remain unverified and are never fetched automatically. You can discover new domains before attaching a target source; those links cannot be fetched until their exact source is registered, approved and attached. No provider is activated by this screen.</small>
            {searchQueries.length > 0 && <div className="discovery-search-queries"><b>Queries used</b>{searchQueries.map(query => <span key={query}>{query}</span>)}</div>}
            {searchResults.length > 0 && <div className="discovery-search-results">
              {searchResults.map(result => <article className="discovery-search-result" key={result.url}>
                <div><strong>{result.title}</strong><small>{result.domain} · {result.engine} · {result.status.replaceAll("_", " ")}</small></div>
                <p>{result.snippet || "No provider snippet supplied."}</p>
                <a href={result.url} target="_blank" rel="noreferrer">Open result page</a>
                <div className="discovery-search-result-actions">
                  <small>{result.fetchEligible ? "Exact URL is within approved source: " + result.approvedSourceName : "No attached approved source matches this exact host and path. Register/review it first."}</small>
                  {result.fetchEligible
                    ? <button type="button" className="secondary-button" onClick={() => addSearchCandidate(result)} disabled={busy === "enqueue" || busy === "search"}>Add URL to E04 draft</button>
                    : <span className="discovery-unverified-label">Unverified · no fetch permission</span>}
                </div>
              </article>)}
            </div>}
          </div>
          <label>Candidate URLs <span className="discovery-optional">(one per line)</span>
            <textarea rows={5} value={candidateText} onChange={event => setCandidateText(event.target.value)} disabled={!selectedSource || busy === "enqueue"} placeholder={"https://approved-source.example/api/v1/record/123"} />
          </label>
          {selectedSource && <div className="discovery-source-url-actions">
            <button type="button" className="secondary-button" onClick={() => setCandidateText(current => current.trim() ? current + "\n" + selectedSource.canonical_url : selectedSource.canonical_url)} disabled={busy === "enqueue"}>
              Use registered source entry URL
            </button>
            <small>This adds only the exact registered entry point. It does not expand links, submit search forms or bypass CAPTCHA or access controls.</small>
          </div>}
          {selectedSource && <div className="discovery-job-limits">
            <span><b>Purpose</b>{selectedProfile?.purpose}</span>
            <span><b>Page budget</b>{selectedSource.max_pages_per_job} max</span>
            <span><b>Rate ceiling</b>{selectedSource.rate_limit_per_minute}/min per source</span>
          </div>}
          <button className="primary-button" type="submit" disabled={!selectedSource || !candidateText.trim() || busy === "enqueue"}>
            {busy === "enqueue" ? <LoaderCircle size={15}/> : <PlayCircle size={15}/>} Queue fetch job
          </button>
        </form>
        <p className="discovery-queue-footnote">Enqueue is separate from execution. URLs are checked against the exact HTTPS host, approved path prefixes, purpose, source page budget and company profile attachment.</p>
      </div>

      <div className="discovery-queue-card discovery-worker-card">
        {worker.enabled && <BorderBeam size={90} duration={8} borderWidth={1} colorFrom="#35bfd0" colorTo="#7be2ba"/>}
        <div className="discovery-queue-card-head"><div><span className="section-kicker">AUTHORITY BOUNDARY</span><h3>Company fetch grant</h3></div><ShieldCheck size={19}/></div>
        <div className={"discovery-worker-status " + (worker.enabled ? "is-enabled" : "is-paused")}>
          <span className="discovery-worker-dot"/><strong>{worker.enabled ? "Enabled until " + readableTime(worker.expiresAt) : "Paused / expired"}</strong>
        </div>
        <div className="discovery-grant-scope">
          <b>Exact permission scope</b>
          <ul>
            <li>Only this company's approved source registry entries.</li>
            <li>Only sources attached to an enabled workspace profile.</li>
            <li>Only explicit candidate URLs inside approved HTTPS path prefixes.</li>
            <li>Maximum source page budget and shared per-source request quota apply.</li>
            <li>Private raw evidence is retained in the company evidence bucket.</li>
            <li>No contact guessing, outreach, login/session automation or anti-bot bypass.</li>
          </ul>
        </div>
        {canManage ? <div className="discovery-worker-actions">
          <button type="button" className={worker.enabled ? "secondary-button" : "primary-button"} onClick={() => void setWorkerGrant(!worker.enabled)} disabled={busy === "worker"}>
            {busy === "worker" ? <LoaderCircle size={15}/> : worker.enabled ? <Square size={15}/> : <PlayCircle size={15}/>}
            {worker.enabled ? "Pause & revoke grant" : "Enable for 1 hour"}
          </button>
          <small>Owner/admin only. This does not deploy or start a worker. The operator-hosted process also needs its separate environment flag.</small>
        </div> : <p className="discovery-readonly">Only this company's owner or admin can issue or revoke the one-hour fetch grant.</p>}
        <div className="discovery-worker-footer"><ShieldAlert size={15}/><span>Missing grant, expired grant or worker environment switch keeps all fetching disabled.</span></div>
      </div>
    </div>

    {(error || notice) && <div className={"discovery-feedback " + (error ? "discovery-feedback--error" : "discovery-feedback--success")} role={error ? "alert" : "status"}>
      {error || notice}
      <button type="button" onClick={() => { setError(""); setNotice(""); }} aria-label="Dismiss message">×</button>
    </div>}

    <div className="discovery-jobs-head">
      <div><span className="section-kicker">COMPANY QUEUE</span><h3>Recent fetch jobs</h3></div>
      <button type="button" className="text-button" onClick={() => void refresh()} disabled={busy === "refresh"}><RefreshCw size={14}/> Refresh</button>
    </div>
    {jobs.length ? <div className="discovery-job-list">
      {jobs.map(job => {
        const source = sources.find(item => item.id === job.source_id);
        const profile = profiles.find(item => item.id === job.profile_id);
        return <article key={job.id} className="discovery-job-row">
          <div className="discovery-job-icon"><Activity size={16}/></div>
          <div className="discovery-job-main">
            <strong>{source?.name || "Source"} · {profile ? labelWorkspace(profile.workspace_key) : "Workspace"}</strong>
            <small>{job.id} · Attempt {job.attempts}/{job.max_attempts} · Created {readableTime(job.created_at)}</small>
            {job.last_error_message && <small className="discovery-job-error">{job.last_error_code}: {job.last_error_message}</small>}
          </div>
          <span className={"discovery-job-status status-" + job.status}>{job.status.replaceAll("_", " ")}</span>
          <div className="discovery-job-time"><Clock3 size={13}/>{readableTime(job.finished_at || job.started_at || job.available_at)}</div>
        </article>;
      })}
    </div> : <p className="discovery-empty-inline">No discovery jobs have been queued for this company.</p>}
  </section>;
}
