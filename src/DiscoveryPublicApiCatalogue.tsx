import { useMemo, useState } from "react";
import { ExternalLink, Search, ShieldAlert, BookOpen } from "lucide-react";
import { findPublicApiCandidates, PUBLIC_API_CATALOGUE_SOURCE } from "./lib/public-api-catalog.mjs";

type Props = {
  workspaceKey?: string;
  mode?: "LENDER" | "CUSTOMER";
};

export default function DiscoveryPublicApiCatalogue({ workspaceKey, mode }: Props) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const candidates = useMemo(() => findPublicApiCandidates({
    query,
    workspaceKey: showAll ? "" : workspaceKey || "",
    mode: showAll ? "" : mode || ""
  }), [query, showAll, workspaceKey, mode]);

  return (
    <section className="data-panel discovery-panel discovery-public-api-panel">
      <details>
        <summary>
          <span className="discovery-public-api-summary">
            <span>
              <span className="section-kicker">E03 · API SOURCE RESEARCH</span>
              <strong>Public APIs catalogue · {candidates.length} relevant candidates</strong>
            </span>
            <small>{showAll || !workspaceKey ? "All workspace candidates" : (workspaceKey.replaceAll("_", " ") + " · " + (mode || "all modes"))}</small>
          </span>
        </summary>
        <div className="discovery-public-api-content">
          <div className="discovery-public-api-intro">
            <div>
              <h3>India API candidates from public-apis</h3>
              <p>Use this curated directory to identify possible data providers. The directory's MIT licence covers its catalogue code/content; it does not grant rights to each API's data or service.</p>
              <a href={PUBLIC_API_CATALOGUE_SOURCE.repositoryUrl} target="_blank" rel="noreferrer">
                <BookOpen size={14}/> Open upstream repository
              </a>
            </div>
            <div className="discovery-public-api-controls">
              <label className="discovery-public-api-search">
                <Search size={15}/>
                <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search APIs, categories or guardrails"/>
              </label>
              <label className="discovery-public-api-all">
                <input type="checkbox" checked={showAll} onChange={event => setShowAll(event.target.checked)}/>
                Show all workspace candidates
              </label>
            </div>
          </div>
          <div className="discovery-public-api-grid">
            {candidates.map(candidate => (
              <article className="discovery-public-api-card" key={candidate.id}>
                <div className="discovery-public-api-card-head">
                  <span className="section-kicker">{candidate.category} · {candidate.jurisdiction}</span>
                  <span className={"discovery-public-api-state state-" + candidate.reviewState}>{candidate.reviewState.replaceAll("_", " ")}</span>
                </div>
                <strong>{candidate.name}</strong>
                <p>{candidate.relevance}</p>
                <div className="discovery-public-api-meta">
                  <span><b>Type</b>{candidate.sourceType.replaceAll("_", " ")}</span>
                  <span><b>Auth in directory</b>{candidate.authAsListed}</span>
                  <span><b>HTTPS</b>{candidate.httpsAsListed ? "Yes" : "No"}</span>
                  <span><b>CORS in directory</b>{candidate.corsAsListed}</span>
                  <span><b>Mode</b>{candidate.modeFit.join(" / ")}</span>
                </div>
                <ul>{candidate.guardrails.map((guardrail, index) => <li key={candidate.id + "-" + index}>{guardrail}</li>)}</ul>
                <div className="discovery-public-api-links">
                  <a href={candidate.providerUrl} target="_blank" rel="noreferrer">
                    Open provider <ExternalLink size={13}/>
                  </a>
                  <a href={candidate.docsUrl} target="_blank" rel="noreferrer">
                    API documentation <ExternalLink size={13}/>
                  </a>
                </div>
              </article>
            ))}
            {candidates.length === 0 && <p className="discovery-empty-inline">No candidates match this workspace and search. Enable “Show all workspace candidates” or change the search.</p>}
          </div>
          <div className="discovery-public-api-footer">
            <ShieldAlert size={15}/>
            <span>Research catalogue only. Candidate status is not approval: no credentials are stored, no API is called, and no source is added to the company registry. Select an exact endpoint/resource, verify its current terms, permitted fields, data provenance and quota, then register it separately as pending.</span>
          </div>
          <small className="discovery-public-api-attribution">
            Upstream: {PUBLIC_API_CATALOGUE_SOURCE.name} · {PUBLIC_API_CATALOGUE_SOURCE.license} · snapshot {PUBLIC_API_CATALOGUE_SOURCE.snapshotDate}
          </small>
        </div>
      </details>
    </section>
  );
}
