import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { supabase } from "./lib/supabase";
import DiscoveryJobQueue from "./DiscoveryJobQueue";
import DiscoveryExtractionResults from "./DiscoveryExtractionResults";
import DiscoveryEvidenceWorkspace from "./DiscoveryEvidenceWorkspace";
import DiscoveryAiMatchingReviewWorkspace from "./DiscoveryAiMatchingReviewWorkspace";
import DiscoveryLeadWorkspace from "./DiscoveryLeadWorkspace";
import DiscoveryVerificationWorkspace from "./DiscoveryVerificationWorkspace";
import DiscoveryOrchestrationWorkspace from "./DiscoveryOrchestrationWorkspace";
import DiscoveryMatchScoringWorkspace from "./DiscoveryMatchScoringWorkspace";
import { CheckCircle2, CircleAlert, Globe, LoaderCircle, Plus, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { getDefaultWorkspaceCriteria, validateWorkspaceCriteria } from "./lib/discovery-profiles.mjs";
import { createDefaultDiscoverySearchFilters, getWorkspaceSearchFilterFields, INDIA_STATES_AND_UTS } from "./lib/discovery-search-filters.mjs";
import type { DiscoverySearchFilterDraft } from "./lib/discovery-search-filters.mjs";
import { OFFICIAL_SOURCE_STARTERS, toSourceDraft } from "./lib/discovery-source-catalogue.mjs";
import DiscoveryPublicApiCatalogue from "./DiscoveryPublicApiCatalogue";

type SourceStatus = "pending" | "approved" | "paused" | "rejected";
type Source = {
  id: string;
  name: string;
  canonical_url: string;
  domain: string;
  source_type: string;
  render_mode: "http" | "browser";
  jurisdiction: string;
  terms_url: string | null;
  license_ref: string;
  allowed_purposes: string[];
  allowed_fields: string[];
  field_schema?: Record<string, { type?: string; aliases?: string[]; required?: boolean; entityKind?: string }>;
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
type SearchCandidate = { title: string; url: string; domain: string; snippet: string; status: string; fetchEligible: boolean; approvedSourceName?: string | null; retrievedAt?: string; firstSeenAt?: string; lastSeenAt?: string };
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
  results?: SearchCandidate[];
  resultsByProfile?: Record<string, SearchCandidate[]>;
  configured?: boolean;
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
  renderMode: "http",
  jurisdiction: "IN",
  termsUrl: "",
  licenseRef: "unreviewed",
  allowedPaths: "",
  allowedPurposes: "",
  allowedFields: "",
  fieldSchemaJson: "",
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
  companyRole,
  selectedWorkspaceKey,
  selectedMode,
  onSwitchWorkspace
}: {
  companyId?: string;
  companyRole?: string;
  selectedWorkspaceKey?: string;
  selectedMode?: "LENDER" | "CUSTOMER";
  onSwitchWorkspace?: () => void;
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
  const [profileDraft, setProfileDraft] = useState<{
    workspaceKey: string;
    discoveryMode: "LENDER" | "CUSTOMER";
    purpose: string;
    jurisdiction: string;
  }>({
    workspaceKey: WORKSPACES.some(([key]) => key === selectedWorkspaceKey) ? selectedWorkspaceKey! : "property_loans",
    discoveryMode: selectedMode || "LENDER",
    purpose: "",
    jurisdiction: "IN"
  });
  const [criteriaText, setCriteriaText] = useState(() => JSON.stringify(getDefaultWorkspaceCriteria("property_loans", "LENDER"), null, 2));
  const [criteriaEditors, setCriteriaEditors] = useState<Record<string, string>>({});
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, {
    termsUrl: string;
    licenseRef: string;
    legalBasis: string;
    attribution: string;
  }>>({});
  const [selectedSources, setSelectedSources] = useState<Record<string, string>>({});
  const [searchResults, setSearchResults] = useState<Record<string, SearchCandidate[]>>({});
  const [searchServiceConfigured, setSearchServiceConfigured] = useState<boolean | null>(null);
  const [searchFilterDrafts, setSearchFilterDrafts] = useState<Record<string, DiscoverySearchFilterDraft>>({});
  const [selectedSearchWorkspace, setSelectedSearchWorkspace] = useState(WORKSPACES.some(([key]) => key === selectedWorkspaceKey) ? selectedWorkspaceKey! : "property_loans");
  const [quickSearchText, setQuickSearchText] = useState("");
  const [quickSearchFilters, setQuickSearchFilters] = useState<DiscoverySearchFilterDraft>(() => createDefaultDiscoverySearchFilters());
  const [quickSearchProfileId, setQuickSearchProfileId] = useState("");

  const invoke = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    if (!companyId) throw new Error("Open an authenticated AXIVESTRA company workspace first.");
    if (!supabase) throw new Error("Cloud authentication is not configured. Sign in through an AXIVESTRA company workspace.");
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
      const [searchStatusResult, candidateResult] = await Promise.allSettled([
        invoke("search.status"),
        invoke("search.candidates.list")
      ]);
      setSearchServiceConfigured(
        searchStatusResult.status === "fulfilled" && searchStatusResult.value.configured === true
      );
      if (candidateResult.status === "fulfilled") {
        setSearchResults(candidateResult.value.resultsByProfile || {});
      }
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setLoading(false);
    }
  }, [companyId, invoke]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    setProfileDraft(current => ({
      ...current,
      ...(WORKSPACES.some(([key]) => key === selectedWorkspaceKey) ? { workspaceKey: selectedWorkspaceKey! } : {}),
      discoveryMode: selectedMode || current.discoveryMode,
      purpose: ""
    }));
  }, [selectedWorkspaceKey, selectedMode]);

  useEffect(() => {
    setCriteriaText(JSON.stringify(getDefaultWorkspaceCriteria(profileDraft.workspaceKey, profileDraft.discoveryMode), null, 2));
  }, [profileDraft.workspaceKey, profileDraft.discoveryMode]);

  const purposeOptions = useMemo(() => [...new Set(
    sources.filter(source => source.status === "approved").flatMap(source => source.allowed_purposes || [])
  )].sort((a, b) => a.localeCompare(b)), [sources]);

  const loadSourceStarter = (starter: (typeof OFFICIAL_SOURCE_STARTERS)[number]) => {
    setSourceDraft(toSourceDraft(starter));
    setNotice("Loaded " + starter.name + " as a pending source draft. Add and verify the official terms URL before any approval; this did not register or fetch the source.");
    setError("");
  };

  const addSource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusyKey("add-source");
    setError("");
    setNotice("");
    try {
      const result = await invoke("sources.register", {
        ...sourceDraft,
        allowedPaths: splitList(sourceDraft.allowedPaths),
        allowedPurposes: splitList(sourceDraft.allowedPurposes),
        allowedFields: splitList(sourceDraft.allowedFields),
        fieldSchema: sourceDraft.fieldSchemaJson.trim() ? JSON.parse(sourceDraft.fieldSchemaJson) : {}
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

  const profileAlreadyExists = profiles.some(profile =>
    profile.workspace_key === selectedSearchWorkspace &&
    profile.discovery_mode === (selectedMode || "LENDER")
  );

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (profileAlreadyExists) {
      setError("This workspace and discovery mode already have a profile. Edit its source attachments or use the existing profile instead of overwriting it.");
      return;
    }
    setBusyKey("add-profile");
    setError("");
    setNotice("");
    try {
      const workspaceLabel = WORKSPACES.find(([key]) => key === selectedSearchWorkspace)?.[1] || selectedSearchWorkspace;
      const discoveryMode = selectedMode || "LENDER";
      const purpose = profileDraft.purpose.trim() || ("Public " + discoveryMode.toLowerCase() + " discovery for " + workspaceLabel);
      const criteria = validateWorkspaceCriteria(JSON.parse(criteriaText), selectedSearchWorkspace, discoveryMode);
      const enabled = criteria.disabledByPolicy !== true;
      await invoke("profiles.upsert", {
        workspaceKey: selectedSearchWorkspace,
        discoveryMode,
        purpose,
        jurisdiction: profileDraft.jurisdiction || "IN",
        enabled,
        criteria
      });
      setProfileDraft(current => ({ ...current, workspaceKey: selectedSearchWorkspace, discoveryMode, purpose }));
      setNotice(enabled
        ? "Search profile created and enabled. Results will be stored as unverified candidates."
        : "This workspace is policy-restricted and remains disabled.");
      await refresh();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusyKey("");
    }
  };

  const saveProfileCriteria = async (profile: Profile) => {
    const editorValue = criteriaEditors[profile.id] || JSON.stringify(
      profile.criteria?.schemaVersion === 1
        ? profile.criteria
        : getDefaultWorkspaceCriteria(profile.workspace_key, profile.discovery_mode),
      null,
      2
    );
    setBusyKey("criteria-" + profile.id);
    setError("");
    setNotice("");
    try {
      const criteria = validateWorkspaceCriteria(JSON.parse(editorValue), profile.workspace_key, profile.discovery_mode);
      await invoke("profiles.upsert", {
        workspaceKey: profile.workspace_key,
        discoveryMode: profile.discovery_mode,
        purpose: profile.purpose,
        jurisdiction: profile.jurisdiction,
        enabled: profile.enabled && criteria.disabledByPolicy !== true,
        criteria
      });
      setCriteriaEditors({ ...criteriaEditors, [profile.id]: JSON.stringify(criteria, null, 2) });
      setNotice("Workspace-specific discovery criteria saved. Existing records and source evidence were not changed.");
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
      const criteria = profile.criteria?.schemaVersion === 1
        ? validateWorkspaceCriteria(profile.criteria, profile.workspace_key, profile.discovery_mode)
        : getDefaultWorkspaceCriteria(profile.workspace_key, profile.discovery_mode);
      if (enabled && criteria.disabledByPolicy) {
        throw new Error("This workspace/mode is disabled by discovery policy and cannot be enabled for external search.");
      }
      await invoke("profiles.upsert", {
        workspaceKey: profile.workspace_key,
        discoveryMode: profile.discovery_mode,
        purpose: profile.purpose,
        jurisdiction: profile.jurisdiction,
        enabled,
        criteria
      });
      setNotice(enabled
        ? (sourcesForProfile(profile).some(source => source.status === "approved")
          ? "Profile enabled. E04 fetching still requires an active one-hour company grant and the separate worker process."
          : "Search-only profile enabled. E03 search requires the configured SearXNG service; E04 stays blocked until an exact target source is approved and attached.")
        : "Profile disabled.");
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

  useEffect(() => {
    if (selectedWorkspaceKey && WORKSPACES.some(([key]) => key === selectedWorkspaceKey)) {
      setSelectedSearchWorkspace(selectedWorkspaceKey);
    }
  }, [selectedWorkspaceKey]);

  const activeDiscoveryMode = selectedMode || "LENDER";
  const visibleProfiles = profiles.filter(profile =>
    profile.discovery_mode === activeDiscoveryMode &&
    profile.workspace_key === selectedSearchWorkspace
  );
  const selectedWorkspaceLabel = WORKSPACES.find(([key]) => key === selectedSearchWorkspace)?.[1] || selectedSearchWorkspace;

  const updateSearchFilter = (profileId: string, key: "coverageScope" | "state" | "country" | "currency" | "keywords", value: string) => {
    setSearchFilterDrafts(current => {
      const draft = { ...(current[profileId] || createDefaultDiscoverySearchFilters()) };
      if (key === "coverageScope") draft.coverageScope = value as DiscoverySearchFilterDraft["coverageScope"];
      else if (key === "state") draft.state = value;
      else if (key === "country") draft.country = value;
      else if (key === "currency") draft.currency = value;
      else draft.keywords = value;
      return { ...current, [profileId]: draft };
    });
  };

  const updateWorkspaceFilter = (profileId: string, key: string, value: string) => {
    setSearchFilterDrafts(current => {
      const currentDraft = current[profileId] || createDefaultDiscoverySearchFilters();
      return { ...current, [profileId]: { ...currentDraft, fields: { ...currentDraft.fields, [key]: value } } };
    });
  };

  const runPublicSearch = async (profile: Profile) => {
    setBusyKey("search-" + profile.id);
    setError("");
    setNotice("");
    try {
      if (searchServiceConfigured !== true) {
        throw new Error("Live search is not connected on this AXIVESTRA server yet. The search screen is ready; the server search provider must be activated before real results can appear.");
      }
      const filters = searchFilterDrafts[profile.id] || createDefaultDiscoverySearchFilters();
      const result = await invoke("search.preview", { profileId: profile.id, filters });
      setSearchResults(current => ({ ...current, [profile.id]: result.results || [] }));
      await refresh();
      const scopeLabel = filters.coverageScope === "state" ? filters.state + ", India"
        : filters.coverageScope === "india" ? "All India"
        : filters.country || "International (all countries)";
      setNotice("Search completed for " + scopeLabel + ". Results are unverified candidates; only exact matches to approved attached source paths are fetch-eligible.");
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusyKey("");
    }
  };

  const runQuickSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = quickSearchText.trim();
    if (query.length < 2) {
      setError("Enter what you are looking for before searching.");
      return;
    }
    if (searchServiceConfigured !== true) {
      setError("Live search is not connected on this AXIVESTRA server yet. No dummy results will be shown. The provider must be activated before live results can appear.");
      return;
    }
    setBusyKey("quick-search");
    setError("");
    setNotice("");
    try {
      const workspaceKey = selectedSearchWorkspace;
      const discoveryMode = activeDiscoveryMode;
      const workspaceLabel = WORKSPACES.find(([key]) => key === workspaceKey)?.[1] || workspaceKey;
      const defaultCriteria = getDefaultWorkspaceCriteria(workspaceKey, discoveryMode);
      if (defaultCriteria.disabledByPolicy) {
        throw new Error("This search is restricted by AXIVESTRA policy. Use the approved intake or referral workflow instead.");
      }

      let profile = profiles.find(item =>
        item.workspace_key === workspaceKey && item.discovery_mode === discoveryMode
      );
      if (!profile) {
        const created = await invoke("profiles.upsert", {
          workspaceKey,
          discoveryMode,
          purpose: "Public " + discoveryMode.toLowerCase() + " discovery for " + workspaceLabel,
          jurisdiction: "IN",
          enabled: true,
          criteria: defaultCriteria
        });
        profile = created.profile as Profile | undefined;
        if (!profile?.id) {
          const refreshed = await invoke("profiles.list");
          profile = (refreshed.profiles || []).find((item: Profile) =>
            item.workspace_key === workspaceKey && item.discovery_mode === discoveryMode
          );
        }
      } else if (!profile.enabled) {
        const criteria = profile.criteria?.schemaVersion === 1
          ? validateWorkspaceCriteria(profile.criteria, workspaceKey, discoveryMode)
          : defaultCriteria;
        const enabled = await invoke("profiles.upsert", {
          workspaceKey,
          discoveryMode,
          purpose: profile.purpose,
          jurisdiction: profile.jurisdiction || "IN",
          enabled: true,
          criteria
        });
        profile = (enabled.profile as Profile | undefined) || { ...profile, enabled: true };
      }
      if (!profile?.id) throw new Error("AXIVESTRA could not prepare the search workspace. Refresh the page and try again.");

      const filters: DiscoverySearchFilterDraft = {
        ...quickSearchFilters,
        keywords: [query, quickSearchFilters.keywords].filter(Boolean).join(" ").slice(0, 160)
      };
      const result = await invoke("search.preview", { profileId: profile.id, filters });
      setQuickSearchProfileId(profile.id);
      setSearchResults(current => ({ ...current, [profile!.id]: result.results || [] }));
      setNotice("Search completed. Results are live public-source candidates and remain unverified until separately reviewed.");
      await refresh();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusyKey("");
    }
  };

  const availableSources = (profile: Profile) => sources.filter(source =>
    source.status === "approved" &&
    (source.allowed_purposes || []).includes(profile.purpose) &&
    !links.some(link => link.profile_id === profile.id && link.source_id === source.id)
  );

  if (!companyId) {
    return <section className="discovery-manager">
      <div className="discovery-empty-state">
        <ShieldCheck size={28}/>
        <h2>Connect a company workspace to use {selectedMode === "CUSTOMER" ? "CUSTOMER" : "LENDER"} discovery</h2>
        <p>This discovery module is ready for company-scoped search, source approvals and shared evidence. The current session is Personal or Local, so the service cannot load company profiles or live source results. Your local records remain untouched.</p>
        {onSwitchWorkspace && <button type="button" className="primary-button" onClick={() => onSwitchWorkspace()}>Switch to company workspace</button>}
      </div>
    </section>;
  }

  return <section className="discovery-manager">
    <div className="discovery-hero">
      <div>
        <span className="section-kicker">AXIVESTRA · LIVE DISCOVERY</span>
        <h2>{selectedMode === "CUSTOMER" ? "Find Customers" : "Find Lenders"}</h2>
        <p>Type what you need and search. AXIVESTRA prepares the matching workspace automatically. Add filters only when you want to narrow the results.</p>
      </div>
      <div className="discovery-hero-counts">
        <div><strong>{sources.length}</strong><span>Registered sources</span></div>
        <div><strong>{sources.filter(source => source.status === "approved").length}</strong><span>Approved sources</span></div>
        <div><strong>{profiles.length}/32</strong><span>Workspace profiles</span></div>
      </div>
    </div>

    <div className="discovery-notice">
      <ShieldCheck size={17}/>
      <p><strong>{searchServiceConfigured === true ? "Live search connected." : searchServiceConfigured === false ? "Live search is not connected yet." : "Checking search connection…"}</strong> {searchServiceConfigured === true ? "Search results are public-source candidates and are not treated as verified records." : searchServiceConfigured === false ? "The server search provider must be activated before live results can be returned." : "AXIVESTRA is checking the server connection."}</p>
      <button type="button" onClick={() => void refresh()} disabled={loading} aria-label="Refresh discovery status"><RefreshCw size={16}/></button>
    </div>
    <section className="data-panel discovery-quick-search">
      <div className="discovery-quick-search-heading">
        <div>
          <span className="section-kicker">{activeDiscoveryMode} DISCOVERY</span>
          <h2>{activeDiscoveryMode === "LENDER" ? "Find a lender" : "Find a customer"}</h2>
          <p>One search box. No profile setup needed.</p>
        </div>
        <label>Search in
          <select value={selectedSearchWorkspace} onChange={event => {
            setSelectedSearchWorkspace(event.target.value);
            setProfileDraft(current => ({ ...current, workspaceKey: event.target.value, purpose: "" }));
            setQuickSearchFilters(createDefaultDiscoverySearchFilters());
            setQuickSearchProfileId("");
          }}>
            {WORKSPACES.map(([key, label]) => <option value={key} key={key}>{label}</option>)}
          </select>
        </label>
      </div>
      <form className="discovery-quick-search-form" onSubmit={runQuickSearch}>
        <label htmlFor="axivestra-quick-search-query">What are you looking for?</label>
        <div className="discovery-quick-search-input-row">
          <input id="axivestra-quick-search-query" value={quickSearchText} maxLength={160} required
            onChange={event => setQuickSearchText(event.target.value)}
            placeholder={activeDiscoveryMode === "LENDER" ? "e.g. Property loan lenders in Karnataka" : "e.g. Businesses seeking loans against property"}/>
          <button type="submit" className="primary-button" disabled={busyKey === "quick-search" || searchServiceConfigured === null}>
            {busyKey === "quick-search" ? <LoaderCircle size={16}/> : <Globe size={16}/>}
            {busyKey === "quick-search" ? "Searching…" : activeDiscoveryMode === "LENDER" ? "Search Lenders" : "Search Customers"}
          </button>
        </div>
      </form>
      <details className="discovery-quick-search-filters">
        <summary>Filters (optional)</summary>
        <div className="discovery-quick-search-filter-grid">
          <label>Coverage
            <select value={quickSearchFilters.coverageScope} onChange={event => setQuickSearchFilters(current => ({ ...current, coverageScope: event.target.value as DiscoverySearchFilterDraft["coverageScope"] }))}>
              <option value="state">One State / UT</option>
              <option value="india">All India</option>
              <option value="international">International</option>
            </select>
          </label>
          {quickSearchFilters.coverageScope === "state" && <label>State / UT
            <select value={quickSearchFilters.state} onChange={event => setQuickSearchFilters(current => ({ ...current, state: event.target.value }))}>
              {INDIA_STATES_AND_UTS.map(state => <option value={state} key={state}>{state}</option>)}
            </select>
          </label>}
          {quickSearchFilters.coverageScope === "international" && <label>Country (optional)
            <input value={quickSearchFilters.country} maxLength={100} onChange={event => setQuickSearchFilters(current => ({ ...current, country: event.target.value }))} placeholder="Blank = global"/>
          </label>}
          {getWorkspaceSearchFilterFields(selectedSearchWorkspace, activeDiscoveryMode).map(field => <label key={field.key}>{field.label}
            {field.type === "select" ? <select value={quickSearchFilters.fields[field.key] || ""} onChange={event => setQuickSearchFilters(current => ({ ...current, fields: { ...current.fields, [field.key]: event.target.value } }))}>
              <option value="">Any</option>
              {(field.options || []).map(option => <option value={option} key={option}>{option}</option>)}
            </select> : <input type={field.type} min={field.type === "number" ? 0 : undefined} step={field.type === "number" ? "any" : undefined} value={quickSearchFilters.fields[field.key] || ""} placeholder={field.placeholder || "Any"} onChange={event => setQuickSearchFilters(current => ({ ...current, fields: { ...current.fields, [field.key]: event.target.value } }))}/>}
          </label>)}
          {getWorkspaceSearchFilterFields(selectedSearchWorkspace, activeDiscoveryMode).some(field => /(amount|ticket|loan|investment|capital|value|exposure|commitment|budget|price)/i.test(field.label)) && <label>Currency
            <select value={quickSearchFilters.currency} onChange={event => setQuickSearchFilters(current => ({ ...current, currency: event.target.value }))}>
              {["INR", "USD", "EUR", "GBP", "AED", "SGD", "CAD", "AUD"].map(currency => <option value={currency} key={currency}>{currency}</option>)}
            </select>
          </label>}
        </div>
        <div className="discovery-quick-search-filter-actions">
          <span>Leave every filter blank to search broadly.</span>
          <button type="button" className="text-button" onClick={() => setQuickSearchFilters(createDefaultDiscoverySearchFilters())}>Clear filters</button>
        </div>
      </details>
      {searchServiceConfigured === false && <p className="discovery-quick-search-status" role="status">The search screen is ready, but live results are not available until the server search provider is connected. AXIVESTRA will not show made-up or sample records.</p>}
      {searchServiceConfigured === true && <p className="discovery-quick-search-status">Live public-source search is available. Results are unverified candidates until reviewed.</p>}
      {quickSearchProfileId && searchResults[quickSearchProfileId] && <div className="discovery-search-results">
        <div className="discovery-search-results-head"><b>Search results · {searchResults[quickSearchProfileId].length}</b><small>Live public-source candidates · unverified</small></div>
        {searchResults[quickSearchProfileId].length ? searchResults[quickSearchProfileId].map(candidate => <article className="discovery-search-candidate" key={candidate.url}>
          <strong>{candidate.title}</strong>
          <small>{candidate.domain} · {candidate.status.replaceAll("_", " ")}</small>
          {candidate.snippet && <p>{candidate.snippet}</p>}
          <a href={candidate.url} target="_blank" rel="noreferrer">{candidate.url}</a>
          <span>{candidate.fetchEligible ? "Matches an approved source path" : "Unverified · source approval required before fetching"}</span>
        </article>) : <p className="discovery-empty-inline">No matching public results were returned. Try a broader search or different filters.</p>}
      </div>}
    </section>


    <details className="discovery-advanced-sources">
      <summary>Source catalogue and governance (advanced)</summary>
      <DiscoveryPublicApiCatalogue workspaceKey={selectedWorkspaceKey} mode={selectedMode} />

    {error && <div className="discovery-feedback discovery-feedback--error" role="alert"><CircleAlert size={17}/><span>{error}</span><button type="button" onClick={() => setError("")} aria-label="Dismiss error"><XCircle size={15}/></button></div>}
    {notice && <div className="discovery-feedback discovery-feedback--success" role="status"><CheckCircle2 size={17}/><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="Dismiss notice">×</button></div>}

    <details className="discovery-source-governance"><summary>Source registry and approvals (advanced)</summary><div className="discovery-columns">
      <section className="data-panel discovery-panel">
        <div className="section-heading">
          <div><span className="section-kicker">E02 · SOURCE REGISTRY</span><h2>Register a website or provider</h2><p>Use the exact official hostname and narrow path list. No wildcard domains.</p></div>
          <Globe size={20}/>
        </div>
        {!canManage && <p className="discovery-readonly">Your company role is read-only for source governance. An owner or admin must register and approve sources.</p>}
        <div className="discovery-source-starters">
          <div><span className="section-kicker">E03 · CONTROLLED SOURCE STARTERS</span><h3>Official India directories</h3><p>Start with identified RBI, NHB and MCA sources. Loading a starter only fills the pending registration form; it does not approve, search or fetch it.</p></div>
          <div className="discovery-source-starter-grid">
            {OFFICIAL_SOURCE_STARTERS.map(starter => <article key={starter.id} className="discovery-source-starter">
              <span className="section-kicker">{starter.category}</span>
              <strong>{starter.name}</strong>
              <small>{starter.description}</small>
              <a href={starter.canonicalUrl} target="_blank" rel="noreferrer">Open official source</a>
              <button type="button" className="secondary-button" onClick={() => loadSourceStarter(starter)} disabled={!canManage || busyKey === "add-source"}>Use as pending draft</button>
            </article>)}
          </div>
        </div>
        <form className="discovery-form" onSubmit={addSource}>
          <label>Source name<input required maxLength={160} value={sourceDraft.name} disabled={!canManage || busyKey === "add-source"} onChange={event => setSourceDraft({ ...sourceDraft, name: event.target.value })} placeholder="e.g. Official company registry"/></label>
          <label>Canonical HTTPS URL<input required type="url" value={sourceDraft.canonicalUrl} disabled={!canManage || busyKey === "add-source"} onChange={event => setSourceDraft({ ...sourceDraft, canonicalUrl: event.target.value })} placeholder="https://registry.example.in/api"/></label>
          <div className="discovery-form-grid">
            <label>Source category<select value={sourceDraft.sourceType} disabled={!canManage || busyKey === "add-source"} onChange={event => setSourceDraft({ ...sourceDraft, sourceType: event.target.value, renderMode: event.target.value === "permitted_public_page" ? sourceDraft.renderMode : "http" })}>{SOURCE_TYPES.map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label>Fetch adapter<select value={sourceDraft.renderMode} disabled={!canManage || busyKey === "add-source" || sourceDraft.sourceType !== "permitted_public_page"} onChange={event => setSourceDraft({ ...sourceDraft, renderMode: event.target.value })}><option value="http">Static HTTPS / API (default)</option><option value="browser">Playwright rendered page (approved public page only)</option></select></label>
          </div>
          <div className="discovery-form-grid">
            <label>Terms / policy URL<input type="url" value={sourceDraft.termsUrl} disabled={!canManage || busyKey === "add-source"} onChange={event => setSourceDraft({ ...sourceDraft, termsUrl: event.target.value })} placeholder="HTTPS URL; needed for approval"/></label>
            <label>Licence / data-rights reference<input value={sourceDraft.licenseRef} disabled={!canManage || busyKey === "add-source"} onChange={event => setSourceDraft({ ...sourceDraft, licenseRef: event.target.value })} placeholder="Exact terms or licence identifier"/></label>
          </div>
          <label>Allowed URL path prefixes<textarea required rows={2} value={sourceDraft.allowedPaths} disabled={!canManage || busyKey === "add-source"} onChange={event => setSourceDraft({ ...sourceDraft, allowedPaths: event.target.value })} placeholder={"/api/v1/entities\n/company-directory"} /></label>
          <div className="discovery-form-grid">
            <label>Permitted purposes<textarea required rows={2} value={sourceDraft.allowedPurposes} disabled={!canManage || busyKey === "add-source"} onChange={event => setSourceDraft({ ...sourceDraft, allowedPurposes: event.target.value })} placeholder={"company identity discovery\nlender institution discovery\nenrichment"}/><small className="discovery-field-help">Add the exact purpose this source is permitted to support. Include <code>enrichment</code> only when source terms allow E10 observation processing; it is separate from the workspace profile purpose.</small></label>
            <label>Allowed fields<textarea required rows={2} value={sourceDraft.allowedFields} disabled={!canManage || busyKey === "add-source"} onChange={event => setSourceDraft({ ...sourceDraft, allowedFields: event.target.value })} placeholder={"legal_name\nregistration_id\nregistration_status"}/><small className="discovery-field-help">E10 only queues fields that have a matching business/finance/property/operating attribute mapping and an approved schema type. Unmapped fields remain extraction evidence only.</small></label>
          </div>
          <label>Field schema <span className="discovery-optional">(optional JSON; every key must also appear in Allowed fields)</span>
            <textarea rows={5} value={sourceDraft.fieldSchemaJson} disabled={!canManage || busyKey === "add-source"} onChange={event => setSourceDraft({ ...sourceDraft, fieldSchemaJson: event.target.value })} placeholder={'{\n  "legal_name": { "type": "string", "aliases": ["legalName", "companyName"], "required": true, "entityKind": "organization" },\n  "registration_id": { "type": "identifier", "aliases": ["cin", "registrationNumber"] }\n}'}/>
          </label>
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
                <span><b>E10 enrichment purpose</b>{(source.allowed_purposes || []).includes("enrichment") ? "Allowed by this source's policy; field mappings still apply" : "Not approved for E10 enrichment"}</span>
                <span><b>Fetch adapter</b>{source.render_mode === "browser" ? "Playwright browser render" : "Static HTTPS / API"}</span>
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
    </div></details>
    </details>


    <details className="discovery-advanced-profile-setup">
      <summary>Advanced profile setup and controls (optional)</summary>
      <section className="data-panel discovery-panel discovery-profiles-panel">
      <div className="section-heading"><div><span className="section-kicker">E02 · WORKSPACE CONFIGURATION</span><h2>LENDER and CUSTOMER profiles</h2><p>Configure separate target profiles for each of AXIVESTRA's 16 workspaces. Create and enable a profile to search; E04 fetching still requires each target source to be separately reviewed, approved and attached.</p></div><ShieldCheck size={20}/></div>
      <section className="discovery-module-search-selector" aria-label={activeDiscoveryMode + " module settings"}>
        <div>
          <span className="section-kicker">ADVANCED {activeDiscoveryMode} SETTINGS</span>
          <strong>Selected module: {selectedWorkspaceLabel}</strong>
          <small>The main search panel already handles this workspace automatically.</small>
        </div>
      </section>
      {searchServiceConfigured === false && <div className="discovery-feedback discovery-feedback--error" role="status"><CircleAlert size={17}/><span>Live search provider is not connected. Advanced filters can be prepared, but live results require the server provider.</span></div>}
      <form className="discovery-profile-create" onSubmit={saveProfile}>
        <div className="discovery-profile-create-context">
          <strong>{activeDiscoveryMode} · {selectedWorkspaceLabel}</strong>
          <small>One search profile for this selected module. A ready-made purpose and India jurisdiction are supplied automatically.</small>
        </div>
        <details className="discovery-profile-advanced-create">
          <summary>Advanced profile settings (optional)</summary>
          <label>Purpose override <span className="discovery-optional">(leave blank to use the default)</span>
            <input list="axivestra-discovery-purposes" maxLength={500} value={profileDraft.purpose} disabled={!canManage || busyKey === "add-profile"} onChange={event => setProfileDraft({ ...profileDraft, purpose: event.target.value })} placeholder={"Public " + activeDiscoveryMode.toLowerCase() + " discovery for " + selectedWorkspaceLabel}/>
            <datalist id="axivestra-discovery-purposes">{purposeOptions.map(purpose => <option value={purpose} key={purpose}/>)}</datalist>
          </label>
          <label>Jurisdiction <input maxLength={80} value={profileDraft.jurisdiction} disabled={!canManage || busyKey === "add-profile"} onChange={event => setProfileDraft({ ...profileDraft, jurisdiction: event.target.value })}/></label>
          <label className="discovery-profile-criteria-editor">Workspace criteria (JSON)
            <textarea rows={7} value={criteriaText} onChange={event => setCriteriaText(event.target.value)} disabled={!canManage || busyKey === "add-profile"} spellCheck={false}/>
            <small>Default targets and guardrails are preloaded. Edit only when this module needs a different target scope.</small>
          </label>
        </details>
        <button type="submit" className="primary-button" disabled={!canManage || busyKey === "add-profile" || profileAlreadyExists || getDefaultWorkspaceCriteria(selectedSearchWorkspace, activeDiscoveryMode).disabledByPolicy}>
          <Plus size={15}/>{profileAlreadyExists ? "Profile already exists" : "Create and enable search profile"}
        </button>
      </form>
      <details className="discovery-profile-coverage-details"><summary>View setup status across all 16 workspaces</summary><section className="discovery-profile-coverage" aria-label="Workspace profile coverage">
        <div className="discovery-profile-coverage-head">
          <div><span className="section-kicker">16 WORKSPACES · 2 MODES</span><h3>Discovery coverage</h3><p>{profiles.length} of 32 profiles configured · {profiles.filter(profile => profile.enabled).length} enabled · {WORKSPACES.filter(([key]) => getDefaultWorkspaceCriteria(key,"LENDER").disabledByPolicy || getDefaultWorkspaceCriteria(key,"CUSTOMER").disabledByPolicy).length} workspaces contain a policy-restricted mode.</p></div>
        </div>
        <div className="discovery-profile-coverage-scroll">
          <table className="discovery-profile-coverage-table">
            <thead><tr><th>Workspace</th><th>LENDER</th><th>CUSTOMER</th></tr></thead>
            <tbody>{WORKSPACES.map(([workspaceKey,workspaceLabel]) => {
              const renderStatus = (mode: "LENDER" | "CUSTOMER") => {
                const profile = profiles.find(item => item.workspace_key === workspaceKey && item.discovery_mode === mode);
                const defaults = getDefaultWorkspaceCriteria(workspaceKey,mode);
                const restricted = defaults.disabledByPolicy === true || profile?.criteria?.disabledByPolicy === true;
                const attached = profile ? sourcesForProfile(profile) : [];
                const enrichmentSources = attached.filter(source =>
                  source.status === "approved" && (source.allowed_purposes || []).includes("enrichment")
                ).length;
                const stateLabel = restricted ? "Policy restricted" : profile?.enabled ? "Enabled" : profile ? "Configured · disabled" : "Not configured";
                return <td key={mode}>
                  <span className={"discovery-coverage-state " + (restricted ? "is-restricted" : profile?.enabled ? "is-enabled" : profile ? "is-configured" : "is-missing")}>{stateLabel}</span>
                  {profile && <small>{attached.length} source(s) · {enrichmentSources} enrichment-purpose</small>}
                  {!profile && !restricted && <small>Choose purpose and create profile below</small>}
                  {restricted && <small>{mode === "CUSTOMER" && workspaceKey === "personal_loan" ? "Inbound / referral / consented intake only" : "Requires a separately governed workflow"}</small>}
                </td>;
              };
              return <tr key={workspaceKey}>
                <th scope="row">{workspaceLabel}</th>
                {renderStatus("LENDER")}
                {renderStatus("CUSTOMER")}
              </tr>;
            })}</tbody>
          </table>
        </div>
      </section></details>
      {profileAlreadyExists && <p className="discovery-readonly">A {activeDiscoveryMode} search profile already exists for {selectedWorkspaceLabel}. Use the existing profile below.</p>}
      {!canManage && <p className="discovery-readonly">Only company owners and admins can configure profiles and source links.</p>}
      {visibleProfiles.length === 0 ? <p className="discovery-empty-inline">No {activeDiscoveryMode} profile exists for {selectedWorkspaceLabel}. Create this module profile above to enable its filters and search.</p> :
        <div className="discovery-profile-list">{visibleProfiles.map(profile => {
          const attached = sourcesForProfile(profile);
          const choices = profile.workspace_key === "personal_loan" && profile.discovery_mode === "CUSTOMER" ? [] : availableSources(profile);
          const selected = selectedSources[profile.id] || "";
          const filterDraft = searchFilterDrafts[profile.id] || createDefaultDiscoverySearchFilters();
          const filterFields = getWorkspaceSearchFilterFields(profile.workspace_key, profile.discovery_mode);
          const primaryFilterFields = filterFields.slice(0, 3);
          const additionalFilterFields = filterFields.slice(3);
          const hasAmountFilters = filterFields.some(field => /(amount|ticket|loan|investment|capital|value|exposure|commitment|budget|price)/i.test(field.label));
          return <article className="discovery-profile-card" key={profile.id}>
            <div className="discovery-profile-head">
              <div><span className="section-kicker">{profile.discovery_mode}</span><strong>{WORKSPACES.find(([key]) => key === profile.workspace_key)?.[1] || profile.workspace_key}</strong><small>{profile.purpose} · {profile.jurisdiction}</small></div>
              <StatusPill status={profile.enabled ? "enabled" : "disabled"}/>
            </div>
            <div className="discovery-attached-sources">
              <b>Attached sources ({attached.length})</b>
              {attached.length ? attached.map(source => <span key={source.id}>{source.name} <button type="button" onClick={() => void detachSource(profile, source.id)} disabled={!canManage || busyKey === "detach-" + profile.id} aria-label={"Detach " + source.name}>×</button></span>) : <small>No approved sources attached.</small>}
            </div>
            <details className="discovery-profile-criteria">
              <summary>Workspace criteria and guardrails</summary>
              <textarea rows={8}
                value={criteriaEditors[profile.id] ?? JSON.stringify(
                  profile.criteria?.schemaVersion === 1
                    ? profile.criteria
                    : getDefaultWorkspaceCriteria(profile.workspace_key, profile.discovery_mode),
                  null,
                  2
                )}
                onChange={event => setCriteriaEditors({ ...criteriaEditors, [profile.id]: event.target.value })}
                disabled={!canManage || busyKey === "criteria-" + profile.id}
                spellCheck={false}
              />
              {canManage && <button type="button" className="secondary-button" onClick={() => void saveProfileCriteria(profile)} disabled={busyKey === "criteria-" + profile.id}>Save criteria</button>}
            </details>
            {canManage && <div className="discovery-profile-controls">
              <select value={selected} onChange={event => setSelectedSources({ ...selectedSources, [profile.id]: event.target.value })} disabled={!choices.length || busyKey === "attach-" + profile.id}>
                <option value="">{choices.length ? "Choose a purpose-matched source…" : "No matching approved source"}</option>
                {choices.map(source => <option value={source.id} key={source.id}>{source.name} · {source.domain}</option>)}
              </select>
              <button type="button" className="secondary-button" onClick={() => void attachSource(profile)} disabled={!selected || busyKey === "attach-" + profile.id}>Attach source</button>
              <button type="button" className={profile.enabled ? "secondary-button" : "primary-button"} onClick={() => void toggleProfile(profile, !profile.enabled)} disabled={busyKey === "profile-" + profile.id}>
                {profile.enabled ? "Disable profile" : "Enable profile"}
              </button>
            </div>}
            <section className="discovery-search-filter-panel" aria-label={profile.workspace_key.replaceAll("_", " ") + " " + profile.discovery_mode + " search filters"}>
              <div className="discovery-search-filter-heading">
                <div><span className="section-kicker">E03 · TARGET FILTERS</span><strong>Search filters</strong><small>Specific to this module and {profile.discovery_mode.toLowerCase()} search.</small></div>
              </div>
              <div className="discovery-search-filter-grid">
                <label>Coverage
                  <select value={filterDraft.coverageScope} onChange={event => updateSearchFilter(profile.id, "coverageScope", event.target.value)}>
                    <option value="state">One State / UT</option>
                    <option value="india">All India</option>
                    <option value="international">International</option>
                  </select>
                </label>
                {filterDraft.coverageScope === "state" && <label>State / UT
                  <select value={filterDraft.state} onChange={event => updateSearchFilter(profile.id, "state", event.target.value)}>
                    {INDIA_STATES_AND_UTS.map(state => <option value={state} key={state}>{state}</option>)}
                  </select>
                </label>}
                {filterDraft.coverageScope === "international" && <label>Country (optional)
                  <input value={filterDraft.country} maxLength={100} onChange={event => updateSearchFilter(profile.id, "country", event.target.value)} placeholder="Blank = global"/>
                </label>}
                {primaryFilterFields.map(field => <label key={field.key}>{field.label}
                  {field.type === "select" ? <select value={filterDraft.fields[field.key] || ""} onChange={event => updateWorkspaceFilter(profile.id, field.key, event.target.value)}>
                    <option value="">Any</option>
                    {(field.options || []).map(option => <option value={option} key={option}>{option}</option>)}
                  </select> : <input type={field.type} min={field.type === "number" ? 0 : undefined} step={field.type === "number" ? "any" : undefined} value={filterDraft.fields[field.key] || ""} placeholder={field.placeholder || "Any"} onChange={event => updateWorkspaceFilter(profile.id, field.key, event.target.value)}/>}
                </label>)}
                {hasAmountFilters && <label>Currency
                  <select value={filterDraft.currency} onChange={event => updateSearchFilter(profile.id, "currency", event.target.value)}>
                    {["INR", "USD", "EUR", "GBP", "AED", "SGD", "CAD", "AUD"].map(currency => <option value={currency} key={currency}>{currency}</option>)}
                  </select>
                </label>}
                <label>Keywords (optional)
                  <input value={filterDraft.keywords || ""} maxLength={160} onChange={event => updateSearchFilter(profile.id, "keywords", event.target.value)} placeholder="Additional search terms"/>
                </label>
              </div>
              {additionalFilterFields.length > 0 && <details className="discovery-more-filters">
                <summary>More filters ({additionalFilterFields.length})</summary>
                <div className="discovery-search-filter-grid">
                  {additionalFilterFields.map(field => <label key={field.key}>{field.label}
                    {field.type === "select" ? <select value={filterDraft.fields[field.key] || ""} onChange={event => updateWorkspaceFilter(profile.id, field.key, event.target.value)}>
                      <option value="">Any</option>
                      {(field.options || []).map(option => <option value={option} key={option}>{option}</option>)}
                    </select> : <input type={field.type} min={field.type === "number" ? 0 : undefined} step={field.type === "number" ? "any" : undefined} value={filterDraft.fields[field.key] || ""} placeholder={field.placeholder || "Any"} onChange={event => updateWorkspaceFilter(profile.id, field.key, event.target.value)}/>}
                  </label>)}
                </div>
              </details>}
              <div className="discovery-search-filter-actions">
                <small className="discovery-guardrail">Applies only to this selected module and mode.</small>
                <button type="button" className="text-button" onClick={() => setSearchFilterDrafts(current => ({ ...current, [profile.id]: createDefaultDiscoverySearchFilters() }))}>Clear filters</button>
              </div>
            </section>
            <div className="discovery-profile-controls">
              <button type="button" className="primary-button" onClick={() => void runPublicSearch(profile)} disabled={!profile.enabled || searchServiceConfigured !== true || busyKey === "search-" + profile.id}>
                {busyKey === "search-" + profile.id ? <LoaderCircle size={15}/> : <Globe size={15}/>} {searchServiceConfigured === false ? "Search provider not connected" : "Search with filters"}
              </button>
              <span className="discovery-guardrail">Search uses this {profile.discovery_mode} / {profile.workspace_key.replaceAll("_", " ")} filter set.</span>
            </div>
            {searchResults[profile.id] && <div className="discovery-search-results">
              <div className="discovery-search-results-head"><b>Saved candidates · {searchResults[profile.id].length}</b><small>Unverified · retained for this company and module</small></div>
              {searchResults[profile.id].length ? searchResults[profile.id].map(candidate => <article className="discovery-search-candidate" key={candidate.url}>
                <strong>{candidate.title}</strong>
                <small>{candidate.domain} · {candidate.status.replaceAll("_", " ")}</small>
                {candidate.snippet && <p>{candidate.snippet}</p>}
                <a href={candidate.url} target="_blank" rel="noreferrer">{candidate.url}</a>
                <span>{candidate.fetchEligible ? "Matches approved attached source path" : "Not fetch-eligible · register and approve source first"}</span>
              </article>) : <p className="discovery-empty-inline">No candidates are saved for this module yet. Check the search connection and try again.</p>}
            </div>}
            {!attached.some(source => source.status === "approved") && <small className="discovery-guardrail">Search-only profile: no target source is attached. E03 search results are unverified; E04 fetch and extraction are unavailable until a domain/path is registered, reviewed, approved and attached.</small>}
            {profile.workspace_key === "personal_loan" && profile.discovery_mode === "CUSTOMER" && <small className="discovery-guardrail">External person-discovery is disabled for Personal Loan customers. Use user-entered, referred, inbound or explicitly consented borrower intake.</small>}
          </article>;
        })}</div>}
      </section>
    </details>
    <DiscoveryJobQueue companyId={companyId} companyRole={companyRole} sources={sources} profiles={profiles} links={links} initialWorkspaceKey={selectedWorkspaceKey} initialMode={selectedMode}/>
    <DiscoveryExtractionResults companyId={companyId} companyRole={companyRole} sources={sources}/>
    <DiscoveryEvidenceWorkspace companyId={companyId} companyRole={companyRole}/>
    <DiscoveryAiMatchingReviewWorkspace companyId={companyId} companyRole={companyRole}/>
    <DiscoveryVerificationWorkspace companyId={companyId} companyRole={companyRole}/>
    <DiscoveryMatchScoringWorkspace companyId={companyId} companyRole={companyRole} profiles={profiles}/>
    <DiscoveryOrchestrationWorkspace companyId={companyId} companyRole={companyRole}/>
    <DiscoveryLeadWorkspace companyId={companyId} companyRole={companyRole}/>
    <div className="discovery-footer-note">Source governance, candidate URL queueing and fetch controls are company-scoped. E04 fetches only explicit allow-listed URLs; it does not search the internet, expand links, harvest private individuals, conduct outreach or make automated lending/property decisions.</div>
  </section>;
}
