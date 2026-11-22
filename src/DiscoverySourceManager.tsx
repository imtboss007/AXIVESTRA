import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase";
import { CheckCircle2, CircleAlert, Globe, LoaderCircle, Plus, RefreshCw, ShieldCheck, XCircle } from "lucide-react";

type SourceStatus = "pending" | "approved" | "paused" | "rejected";
type Source = {
  id: string;
  name: string;
  canonical_url: string;
  domain: string;
  source_type: string;
  jurisdiction: string;
  terms_url: string | null;
  license_ref: string;
  allowed_purposes: string[];
  allowed_fields: string[];
  allowed_paths: string[];
  attribution: string;
  legal_basis: string;
  status: SourceStatus;
  rate_limit_per_minute: number;
  max_pages_per_job: number;
  retention_days: number;
  policy_notes?: string;
};
type Profile = {
  id: string;
  workspace_key: string;
  discovery_mode: "LENDER" | "CUSTOMER";
  jurisdiction: string;
  purpose: string;
  enabled: boolean;
  criteria: Record<string, unknown>;
};
type SourceLink = { profile_id: string; source_id: string };
type ApiResponse = {
  ok?: boolean;
  error?: string;
  message?: string;
  sources?: Source[];
  profiles?: Profile[];
  sourceLinks?: SourceLink[];
  source?: Source;
  profile?: Profile;
  remainingSources?: number;
};

const WORKSPACES = [
  ["property_sale", "Property Sale"],
  ["property_loans", "Property Loans"],
  ["jv_jda_jd", "JV / JDA / JD"],
  ["sr_rate_settlement", "SR Rate Settlement"],
  ["agricultural_land", "Agricultural Land"],
  ["commercial_land", "Commercial Land"],
  ["startup", "Startup"],
  ["equity", "Equity"],
  ["unsecured_company_loan", "Unsecured Company Loan"],
  ["personal_loan", "Personal Loan"],
  ["housing_loan", "Housing Loan"],
  ["house_purchase", "House Purchase"],
  ["litigation", "Litigation"],
  ["fund_portfolio_management", "Fund & Portfolio Management"],
  ["investor_relations", "Investor Relations"],
  ["compliance_kyc", "Compliance & KYC"]
] as const;

const SOURCE_TYPES = [
  ["official_api", "Official API"],
  ["licensed_api", "Licensed provider API"],
  ["open_dataset", "Open dataset"],
  ["permitted_public_page", "Permitted public website"],
  ["manual_research", "Manual / user-provided research"]
] as const;

const initialSourceDraft = {
  name: "",
  canonicalUrl: "",
  sourceType: "official_api",
  jurisdiction: "IN",
  termsUrl: "",
  licenseRef: "unreviewed",
  allowedPaths: "",
  allowedPurposes: "",
  allowedFields: "",
  attribution: "",
  policyNotes: ""
};

function splitList(value: string) {
  return [...new Set(value.split(/[\n,;]/).map(item => item.trim()).filter(Boolean))];
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "The discovery request failed.";
}

function StatusPill({ status }: { status: SourceStatus | "enabled" | "disabled" }) {
  return <span className={"discovery-status discovery-status--" + status}>{status.replace("_", " ")}</span>;
}

export default function DiscoverySourceManager({
  companyId,
  companyRole
}: {
  companyId?: string;
  companyRole?: string;
}) {
  const canManage = companyRole === "owner" || companyRole === "admin";
  const [sources, setSources] = useState<Source[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [links, setLinks] = useState<SourceLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sourceDraft, setSourceDraft] = useState(initialSourceDraft);
  const [profileDraft, setProfileDraft] = useState({
    workspaceKey: "property_loans",
    discoveryMode: "LENDER",
    purpose: "",
    jurisdiction: "IN"
  });
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, {
    termsUrl: string;
    licenseRef: string;
    legalBasis: string;
    attribution: string;
  }>>({});
  const [selectedSources, setSelectedSources] = useState<Record<string, string>>({});

  const invoke = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    if (!companyId) throw new Error("Open an authenticated AXIVESTRA company workspace first.");
    const { data, error: invokeError } = await supabase.functions.invoke("discovery-control", {
      body: { companyId, action, payload }
    });
    if (invokeError) throw new Error(invokeError.message || "The discovery service could not be reached.");
    const response = data as ApiResponse | null;
    if (!response?.ok) throw new Error(String(response?.error || "The discovery request was not accepted."));
    return response;
  }, [companyId]);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError("");
    try {
      const [sourceResponse, profileResponse] = await Promise.all([
        invoke("sources.list"),
        invoke("profiles.list")
      ]);
      setSources(sourceResponse.sources || []);
      setProfiles(profileResponse.profiles || []);
      setLinks(profileResponse.sourceLinks || []);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setLoading(false);
    }
  }, [companyId, invoke]);

  useEffect(() => { void refresh(); }, [refresh]);

  const purposeOptions = useMemo(() => [...new Set(
    sources.filter(source => source.status === "approved").flatMap(source => source.allowed_purposes || [])
  )].sort((a, b) => a.localeCompare(b)), [sources]);

  const addSource = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusyKey("add-source");
    setError("");
    setNotice("");
    try {
      const result = await invoke("sources.register", {
        ...sourceDraft,
        allowedPaths: splitList(sourceDraft.allowedPaths),
        allowedPurposes: splitList(sourceDraft.allowedPurposes),
        allowedFields: splitList(sourceDraft.allowedFields)
      });
      setSourceDraft(initialSourceDraft);
      setNotice(result.message || "Source registered as pending.");
      await refresh();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusyKey("");
    }
  };

  const reviewSource = async (source: Source, status: "approved" | "paused" | "rejected") => {
    setBusyKey("review-" + source.id);
    setError("");
    setNotice("");
    try {
      const draft = reviewDrafts[source.id] || {
        termsUrl: source.terms_url || "",
        licenseRef: source.license_ref || "unreviewed",
        legalBasis: source.legal_basis || "",
        attribution: source.attribution || ""
      };
      await invoke("sources.review", {
        sourceId: source.id,
        status,
        ...(status === "approved" ? {
          termsUrl: draft.termsUrl,
          licenseRef: draft.licenseRef,
          legalBasis: draft.legalBasis,
          attribution: draft.attribution,
          allowedPaths: source.allowed_paths,
          allowedPurposes: source.allowed_purposes,
          allowedFields: source.allowed_fields,
          rateLimitPerMinute: source.rate_limit_per_minute,
          maxPagesPerJob: source.max_pages_per_job,
          retentionDays: source.retention_days
        } : { reason: status === "paused" ? "Paused by company administrator." : "Rejected by company administrator." })
      });
      setNotice(status === "approved" ? "Source approved. It is now eligible to be attached to matching profiles." : "Source status updated.");
      await refresh();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusyKey("");
    }
  };

  const saveProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusyKey("add-profile");
    setError("");
    setNotice("");
    try {
      await invoke("profiles.upsert", {
        ...profileDraft,
        enabled: false,
        criteria: {}
      });
      setProfileDraft({ ...profileDraft, purpose: "" });
      setNotice("Workspace discovery profile saved in disabled state.");
      await refresh();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusyKey("");
    }
  };

  const toggleProfile = async (profile: Profile, enabled: boolean) => {
    setBusyKey("profile-" + profile.id);
    setError("");
    setNotice("");
    try {
      await invoke("profiles.upsert", {
        workspaceKey: profile.workspace_key,
        discoveryMode: profile.discovery_mode,
        purpose: profile.purpose,
        jurisdiction: profile.jurisdiction,
        enabled,
        criteria: profile.criteria || {}
      });
      setNotice(enabled ? "Profile enabled. Actual discovery remains unavailable until a connector is implemented." : "Profile disabled.");
      await refresh();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusyKey("");
    }
  };

  const attachSource = async (profile: Profile) => {
    const sourceId = selectedSources[profile.id];
    if (!sourceId) return;
    setBusyKey("attach-" + profile.id);
    setError("");
    setNotice("");
    try {
      await invoke("profiles.attach-source", { profileId: profile.id, sourceId });
      setNotice("Approved source attached to " + profile.workspace_key.replaceAll("_", " ") + ".");
      await refresh();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusyKey("");
    }
  };

  const detachSource = async (profile: Profile, sourceId: string) => {
    setBusyKey("detach-" + profile.id);
    setError("");
    setNotice("");
    try {
      await invoke("profiles.detach-source", { profileId: profile.id, sourceId });
      setNotice("Source detached. A profile with no approved sources is automatically disabled.");
      await refresh();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusyKey("");
    }
  };

  const sourcesForProfile = (profile: Profile) => links
    .filter(link => link.profile_id === profile.id)
    .map(link => sources.find(source => source.id === link.source_id))
    .filter((source): source is Source => Boolean(source));

  const availableSources = (profile: Profile) => sources.filter(source =>
    source.status === "approved" &&
    (source.allowed_purposes || []).includes(profile.purpose) &&
    !links.some(link => link.profile_id === profile.id && link.source_id === source.id)
  );

  if (!companyId) {
    return <section className="discovery-manager">
      <div className="discovery-empty-state">
        <ShieldCheck size={28}/>
        <h2>Company workspace required</h2>
        <p>Discovery source governance is company-scoped. Switch to an authenticated company workspace to register and review sources. Personal and local-only records are not shared with this service.</p>
      </div>
    </section>;
  }

  return <section className="discovery-manager">
    <div className="discovery-hero">
      <div>
        <span className="section-kicker">AXIVESTRA · EXTERNAL INTELLIGENCE</span>
        <h2>Multi-source discovery governance</h2>
        <p>Register permitted websites, official registries, APIs and datasets once, then assign approved sources to the relevant LENDER and CUSTOMER workspace profiles.</p>
      </div>
      <div className="discovery-hero-counts">
        <div><strong>{sources.length}</strong><span>Registered sources</span></div>
        <div><strong>{sources.filter(source => source.status === "approved").length}</strong><span>Approved sources</span></div>
        <div><strong>{profiles.length}/32</strong><span>Workspace profiles</span></div>
      </div>
    </div>

    <div className="discovery-notice">
      <ShieldCheck size={17}/>
      <p><strong>Governed access only.</strong> New sources start pending. No website is crawled by this screen. Actual fetch workers and provider-specific adapters are a separate implementation stage.</p>
      <button type="button" onClick={() => void refresh()} disabled={loading} aria-label="Refresh discovery registry"><RefreshCw size={16}/></button>
    </div>

    {error && <div className="discovery-feedback discovery-feedback--error" role="alert"><CircleAlert size={17}/><span>{error}</span><button type="button" onClick={() => setError("")} aria-label="Dismiss error"><XCircle size={15}/></button></div>}
    {notice && <div className="discovery-feedback discovery-feedback--success" role="status"><CheckCircle2 size={17}/><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="Dismiss notice">×</button></div>}

    <div className="discovery-columns">
      <section className="data-panel discovery-panel">
        <div className="section-heading">
          <div><span className="section-kicker">E02 · SOURCE REGISTRY</span><h2>Register a website or provider</h2><p>Use the exact official hostname and narrow path list. No wildcard domains.</p></div>
          <Globe size={20}/>
        </div>
        {!canManage && <p className="discovery-readonly">Your company role is read-only for source governance. An owner or admin must register and approve sources.</p>}
        <form className="discovery-form" onSubmit={addSource}>
          <label>Source name<input required maxLength={160} value={sourceDraft.name} disabled={!canManage || busyKey === "add-source"} onChange={event => setSourceDraft({ ...sourceDraft, name: event.target.value })} placeholder="e.g. Official company registry"/></label>
          <label>Canonical HTTPS URL<input required type="url" value={sourceDraft.canonicalUrl} disabled={!canManage || busyKey === "add-source"} onChange={event => setSourceDraft({ ...sourceDraft, canonicalUrl: event.target.value })} placeholder="https://registry.example.in/api"/></label>
          <div className="discovery-form-grid">
            <label>Source category<select value={sourceDraft.sourceType} disabled={!canManage || busyKey === "add-source"} onChange={event => setSourceDraft({ ...sourceDraft, sourceType: event.target.value })}>{SOURCE_TYPES.map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label>Jurisdiction<input required value={sourceDraft.jurisdiction} disabled={!canManage || busyKey === "add-source"} onChange={event => setSourceDraft({ ...sourceDraft, jurisdiction: event.target.value })} placeholder="IN / GLOBAL / US"/></label>
          </div>
          <div className="discovery-form-grid">
            <label>Terms / policy URL<input type="url" value={sourceDraft.termsUrl} disabled={!canManage || busyKey === "add-source"} onChange={event => setSourceDraft({ ...sourceDraft, termsUrl: event.target.value })} placeholder="HTTPS URL; needed for approval"/></label>
            <label>Licence / data-rights reference<input value={sourceDraft.licenseRef} disabled={!canManage || busyKey === "add-source"} onChange={event => setSourceDraft({ ...sourceDraft, licenseRef: event.target.value })} placeholder="Exact terms or licence identifier"/></label>
          </div>
          <label>Allowed URL path prefixes<textarea required rows={2} value={sourceDraft.allowedPaths} disabled={!canManage || busyKey === "add-source"} onChange={event => setSourceDraft({ ...sourceDraft, allowedPaths: event.target.value })} placeholder={"/api/v1/entities\n/company-directory"} /></label>
          <div className="discovery-form-grid">
            <label>Permitted purposes<textarea required rows={2} value={sourceDraft.allowedPurposes} disabled={!canManage || busyKey === "add-source"} onChange={event => setSourceDraft({ ...sourceDraft, allowedPurposes: event.target.value })} placeholder={"company identity verification\nlender product research"}/></label>
            <label>Allowed fields<textarea required rows={2} value={sourceDraft.allowedFields} disabled={!canManage || busyKey === "add-source"} onChange={event => setSourceDraft({ ...sourceDraft, allowedFields: event.target.value })} placeholder={"legal_name\nregistration_id\nstatus"}/></label>
          </div>
          <label>Attribution instruction<input required value={sourceDraft.attribution} disabled={!canManage || busyKey === "add-source"} onChange={event => setSourceDraft({ ...sourceDraft, attribution: event.target.value })} placeholder="How AXIVESTRA should attribute this source"/></label>
          <label>Policy notes <span className="discovery-optional">(optional)</span><textarea rows={2} value={sourceDraft.policyNotes} disabled={!canManage || busyKey === "add-source"} onChange={event => setSourceDraft({ ...sourceDraft, policyNotes: event.target.value })} placeholder="Terms restrictions, quota notes, exclusions…"/></label>
          <button className="primary-button" type="submit" disabled={!canManage || busyKey === "add-source"}><Plus size={16}/>{busyKey === "add-source" ? "Registering…" : "Register as pending"}</button>
        </form>
      </section>

      <section className="data-panel discovery-panel">
        <div className="section-heading"><div><span className="section-kicker">SOURCE REVIEW</span><h2>Registered sources</h2><p>{sources.length} source{sources.length === 1 ? "" : "s"} in this company registry.</p></div><button type="button" className="text-button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={14}/>Refresh</button></div>
        {loading && sources.length === 0 ? <div className="discovery-loading"><LoaderCircle size={18}/>Loading source registry…</div> :
          sources.length === 0 ? <p className="discovery-empty-inline">No sources registered yet. Add an official website, registry, permitted directory, API or dataset.</p> :
          <div className="discovery-source-list">{sources.map(source => {
            const draft = reviewDrafts[source.id] || {
              termsUrl: source.terms_url || "",
              licenseRef: source.license_ref || "unreviewed",
              legalBasis: source.legal_basis || "",
              attribution: source.attribution || ""
            };
            return <article className="discovery-source-card" key={source.id}>
              <div className="discovery-source-head">
                <div><strong>{source.name}</strong><small>{source.domain} · {source.source_type.replaceAll("_", " ")}</small></div>
                <StatusPill status={source.status}/>
              </div>
              <a href={source.canonical_url} target="_blank" rel="noreferrer">{source.canonical_url}</a>
              <div className="discovery-meta-grid">
                <span><b>Paths</b>{(source.allowed_paths || []).join(", ")}</span>
                <span><b>Purposes</b>{(source.allowed_purposes || []).join(", ")}</span>
                <span><b>Fields</b>{(source.allowed_fields || []).join(", ")}</span>
                <span><b>Rate / retention</b>{source.rate_limit_per_minute}/min · {source.retention_days} days</span>
              </div>
              {source.status === "pending" && canManage && <div className="discovery-review-fields">
                <label>Terms URL<input value={draft.termsUrl} onChange={event => setReviewDrafts({ ...reviewDrafts, [source.id]: { ...draft, termsUrl: event.target.value } })} placeholder="HTTPS source terms URL"/></label>
                <label>Licence / data-rights reference<input value={draft.licenseRef} onChange={event => setReviewDrafts({ ...reviewDrafts, [source.id]: { ...draft, licenseRef: event.target.value } })}/></label>
                <label>Permitted-use rationale<input value={draft.legalBasis} onChange={event => setReviewDrafts({ ...reviewDrafts, [source.id]: { ...draft, legalBasis: event.target.value } })} placeholder="Why this source and these fields may be used"/></label>
                <label>Attribution instruction<input value={draft.attribution} onChange={event => setReviewDrafts({ ...reviewDrafts, [source.id]: { ...draft, attribution: event.target.value } })}/></label>
                <div className="discovery-action-row">
                  <button type="button" className="primary-button" onClick={() => void reviewSource(source, "approved")} disabled={busyKey === "review-" + source.id}><CheckCircle2 size={15}/>Approve</button>
                  <button type="button" className="secondary-button" onClick={() => void reviewSource(source, "rejected")} disabled={busyKey === "review-" + source.id}>Reject</button>
                </div>
              </div>}
              {source.status === "approved" && canManage && <div className="discovery-action-row"><button type="button" className="secondary-button" onClick={() => void reviewSource(source, "paused")} disabled={busyKey === "review-" + source.id}>Pause source</button></div>}
              {source.status === "paused" && canManage && <div className="discovery-action-row"><button type="button" className="secondary-button" onClick={() => void reviewSource(source, "approved")} disabled={busyKey === "review-" + source.id}>Re-review and approve</button></div>}
            </article>;
          })}</div>}
      </section>
    </div>

    <section className="data-panel discovery-panel discovery-profiles-panel">
      <div className="section-heading"><div><span className="section-kicker">E02 · WORKSPACE CONFIGURATION</span><h2>LENDER and CUSTOMER profiles</h2><p>Configure separate target profiles for each of AXIVESTRA's 16 workspaces. Each profile remains disabled until an approved source is attached.</p></div><ShieldCheck size={20}/></div>
      <form className="discovery-profile-create" onSubmit={saveProfile}>
        <label>Workspace<select value={profileDraft.workspaceKey} disabled={!canManage || busyKey === "add-profile"} onChange={event => setProfileDraft({ ...profileDraft, workspaceKey: event.target.value })}>{WORKSPACES.map(([key,label]) => <option value={key} key={key}>{label}</option>)}</select></label>
        <label>Profile mode<select value={profileDraft.discoveryMode} disabled={!canManage || busyKey === "add-profile"} onChange={event => setProfileDraft({ ...profileDraft, discoveryMode: event.target.value })}><option value="LENDER">LENDER</option><option value="CUSTOMER">CUSTOMER</option></select></label>
        <label>Exact permitted purpose<select required value={profileDraft.purpose} disabled={!canManage || busyKey === "add-profile" || !purposeOptions.length} onChange={event => setProfileDraft({ ...profileDraft, purpose: event.target.value })}><option value="">Choose approved source purpose…</option>{purposeOptions.map(purpose => <option value={purpose} key={purpose}>{purpose}</option>)}</select></label>
        <label>Jurisdiction<input required value={profileDraft.jurisdiction} disabled={!canManage || busyKey === "add-profile"} onChange={event => setProfileDraft({ ...profileDraft, jurisdiction: event.target.value })}/></label>
        <button type="submit" className="primary-button" disabled={!canManage || !profileDraft.purpose || busyKey === "add-profile"}><Plus size={15}/>Create disabled profile</button>
      </form>
      {!canManage && <p className="discovery-readonly">Only company owners and admins can configure profiles and source links.</p>}
      {profiles.length === 0 ? <p className="discovery-empty-inline">No profiles created yet. Approve a source, choose its permitted purpose, then create the matching workspace profile.</p> :
        <div className="discovery-profile-list">{profiles.map(profile => {
          const attached = sourcesForProfile(profile);
          const choices = availableSources(profile);
          const selected = selectedSources[profile.id] || "";
          return <article className="discovery-profile-card" key={profile.id}>
            <div className="discovery-profile-head">
              <div><span className="section-kicker">{profile.discovery_mode}</span><strong>{WORKSPACES.find(([key]) => key === profile.workspace_key)?.[1] || profile.workspace_key}</strong><small>{profile.purpose} · {profile.jurisdiction}</small></div>
              <StatusPill status={profile.enabled ? "enabled" : "disabled"}/>
            </div>
            <div className="discovery-attached-sources">
              <b>Attached sources ({attached.length})</b>
              {attached.length ? attached.map(source => <span key={source.id}>{source.name} <button type="button" onClick={() => void detachSource(profile, source.id)} disabled={!canManage || busyKey === "detach-" + profile.id} aria-label={"Detach " + source.name}>×</button></span>) : <small>No approved sources attached.</small>}
            </div>
            {canManage && <div className="discovery-profile-controls">
              <select value={selected} onChange={event => setSelectedSources({ ...selectedSources, [profile.id]: event.target.value })} disabled={!choices.length || busyKey === "attach-" + profile.id}>
                <option value="">{choices.length ? "Choose a purpose-matched source…" : "No matching approved source"}</option>
                {choices.map(source => <option value={source.id} key={source.id}>{source.name} · {source.domain}</option>)}
              </select>
              <button type="button" className="secondary-button" onClick={() => void attachSource(profile)} disabled={!selected || busyKey === "attach-" + profile.id}>Attach source</button>
              <button type="button" className={profile.enabled ? "secondary-button" : "primary-button"} onClick={() => void toggleProfile(profile, !profile.enabled)} disabled={busyKey === "profile-" + profile.id || (!profile.enabled && attached.filter(source => source.status === "approved").length === 0)}>
                {profile.enabled ? "Disable profile" : "Enable profile"}
              </button>
            </div>}
            {profile.workspace_key === "personal_loan" && profile.discovery_mode === "CUSTOMER" && <small className="discovery-guardrail">External person-discovery is disabled for Personal Loan customers. Use user-entered, referred, inbound or explicitly consented borrower intake.</small>}
          </article>;
        })}</div>}
    </section>
    <div className="discovery-footer-note">Source review controls eligibility only. No search, page fetching, contact harvesting, lead qualification, outreach or automated decisions are run by this screen.</div>
  </section>;
}
