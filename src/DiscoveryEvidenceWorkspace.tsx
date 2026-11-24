import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive, CheckCircle2, CircleAlert, Clock3, Download, FileSearch,
  LoaderCircle, Plus, RefreshCw, Send, ShieldCheck, Trash2, XCircle
} from "lucide-react";
import { supabase } from "./lib/supabase";

type EvidencePack = {
  id: string; title: string; purpose: string; status: "draft" | "in_review" | "approved" | "rejected";
  item_count: number; event_count: number; created_at: string; updated_at: string;
  reviewed_by: string | null; reviewed_at: string | null; review_reason: string | null;
};
type EvidenceCandidate = {
  provenance_event_id: string; subject_kind: string; subject_id: string; field_name: string | null;
  event_type: string; decision: string | null; source_id: string; evidence_id: string;
  evidence_content_hash: string | null; evidence_captured_at: string | null; source_published_at: string | null;
  source_name_snapshot: string | null; source_domain_snapshot: string | null;
  source_jurisdiction_snapshot: string | null; source_attribution_snapshot: string | null;
  source_license_ref_snapshot: string | null; source_span: Record<string, unknown>;
  occurred_at: string; evidence_retained: boolean;
};
type EvidencePackItem = EvidenceCandidate & {
  item_id: string; pack_id: string; added_at: string; removed_at: string | null;
};
type EvidencePackEvent = {
  id: string; event_type: string; reason: string; occurred_at: string; actor_user_id: string | null;
};
type ApiResponse = {
  ok?: boolean; error?: string; packs?: EvidencePack[]; candidates?: EvidenceCandidate[];
  items?: EvidencePackItem[]; events?: EvidencePackEvent[]; packId?: string;
  manifest?: Record<string, unknown>;
};

function readableError(reason: unknown) {
  return reason instanceof Error ? reason.message : "The evidence management request failed.";
}
function formatDate(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleString();
}
function label(value: string) {
  return value.replaceAll("_", " ");
}

export default function DiscoveryEvidenceWorkspace({
  companyId,
  companyRole
}: {
  companyId?: string;
  companyRole?: string;
}) {
  const canManage = companyRole === "owner" || companyRole === "admin";
  const [packs, setPacks] = useState<EvidencePack[]>([]);
  const [candidates, setCandidates] = useState<EvidenceCandidate[]>([]);
  const [items, setItems] = useState<EvidencePackItem[]>([]);
  const [events, setEvents] = useState<EvidencePackEvent[]>([]);
  const [selectedPackId, setSelectedPackId] = useState("");
  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("Reviewed evidence bundle for company identity, transaction or legal decision support.");
  const [reason, setReason] = useState("Included after reviewing the source attribution, evidence hash and provenance locator.");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const invoke = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    if (!companyId) throw new Error("Open an authenticated AXIVESTRA company workspace first.");
    if (!supabase) throw new Error("Cloud authentication is not configured.");
    const { data, error: invokeError } = await supabase.functions.invoke("discovery-control", {
      body: { companyId, action, payload }
    });
    if (invokeError) throw new Error(invokeError.message || "The evidence service could not be reached.");
    const response = data as ApiResponse | null;
    if (!response?.ok) throw new Error(String(response?.error || "The evidence request was not accepted."));
    return response;
  }, [companyId]);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError("");
    try {
      const response = await invoke("evidence.packs.list", selectedPackId ? { packId: selectedPackId } : {});
      const nextPacks = response.packs || [];
      setPacks(nextPacks);
      setCandidates(response.candidates || []);
      setItems(response.items || []);
      setEvents(response.events || []);
      if (!selectedPackId && nextPacks.length) setSelectedPackId(nextPacks[0].id);
      if (selectedPackId && !nextPacks.some(pack => pack.id === selectedPackId)) setSelectedPackId("");
    } catch (reasonValue) {
      setError(readableError(reasonValue));
    } finally {
      setLoading(false);
    }
  }, [companyId, invoke, selectedPackId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const selectedPack = packs.find(pack => pack.id === selectedPackId) || null;
  const activeItems = items.filter(item => !item.removed_at);
  const includedEventIds = new Set(activeItems.map(item => item.provenance_event_id));
  const visibleCandidates = useMemo(() => {
    const query = search.trim().toLowerCase();
    return candidates.filter(candidate => !includedEventIds.has(candidate.provenance_event_id) && (
      !query || [
        candidate.source_name_snapshot, candidate.source_domain_snapshot, candidate.subject_kind,
        candidate.subject_id, candidate.field_name, candidate.event_type, candidate.evidence_id
      ].some(value => String(value || "").toLowerCase().includes(query))
    ));
  }, [candidates, search, items]);

  const runAction = async (key: string, action: string, payload: Record<string, unknown>, success: string) => {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      await invoke(action, payload);
      setNotice(success);
      await refresh();
    } catch (reasonValue) {
      setError(readableError(reasonValue));
    } finally {
      setBusy("");
    }
  };

  const createPack = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManage) return;
    setBusy("create");
    setError("");
    setNotice("");
    try {
      const response = await invoke("evidence.packs.create", { title: title.trim(), purpose: purpose.trim() });
      setTitle("");
      setSelectedPackId(response.packId || "");
      setNotice("Evidence pack created as a draft. Add provenance-backed evidence items, then submit it for review.");
      await refresh();
    } catch (reasonValue) {
      setError(readableError(reasonValue));
    } finally {
      setBusy("");
    }
  };

  const addCandidate = (candidate: EvidenceCandidate) => {
    if (!selectedPack || selectedPack.status !== "draft") return;
    void runAction(
      "add:" + candidate.provenance_event_id,
      "evidence.packs.add",
      { packId: selectedPack.id, provenanceEventId: candidate.provenance_event_id, reason: reason.trim() },
      "Evidence citation added to the draft pack."
    );
  };

  const removeItem = (item: EvidencePackItem) => {
    if (!selectedPack) return;
    void runAction(
      "remove:" + item.item_id,
      "evidence.packs.remove",
      { packId: selectedPack.id, itemId: item.item_id, reason: reason.trim() },
      "Evidence citation removed from the draft. Its event history remains."
    );
  };

  const exportPack = async () => {
    if (!selectedPack || selectedPack.status !== "approved") return;
    setBusy("export");
    setError("");
    setNotice("");
    try {
      const response = await invoke("evidence.packs.export", { packId: selectedPack.id });
      if (!response.manifest) throw new Error("The approved evidence manifest was not returned.");
      const content = JSON.stringify(response.manifest, null, 2);
      const blob = new Blob([content], { type: "application/json;charset=utf-8" });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const safeTitle = selectedPack.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "evidence-pack";
      link.href = objectUrl;
      link.download = "axivestra-" + safeTitle + "-evidence-manifest.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      setNotice("Approved metadata/provenance bundle exported and its SHA-256 export receipt recorded.");
      await refresh();
    } catch (reasonValue) {
      setError(readableError(reasonValue));
    } finally {
      setBusy("");
    }
  };

  if (!companyId) {
    return <section className="discovery-evidence-workspace data-panel discovery-panel">
      <div className="discovery-empty-state"><ShieldCheck size={25}/><h3>Company workspace required</h3><p>Evidence packs are isolated by company and are not available in local-only mode.</p></div>
    </section>;
  }

  return <section className="discovery-evidence-workspace data-panel discovery-panel" aria-label="E21 evidence management and evidence packs">
    <div className="section-heading">
      <div><span className="section-kicker">E21 · REVISED ROADMAP E11</span><h2>Evidence manager & review packs</h2>
        <p>Browse evidence lineage across capture, extraction, entity, contact, location, enrichment, matching and verification stages. Curate citations into a reviewable pack.</p>
      </div>
      <button type="button" className="text-button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={14}/>Refresh</button>
    </div>

    <div className="discovery-notice">
      <ShieldCheck size={16}/>
      <p><strong>Evidence-safe export.</strong> Packs reference existing immutable E04 evidence and E13 provenance. The JSON export includes hashes, attribution, licence snapshots and structural locators only—not raw source bodies, extracted values, source URLs or storage object references.</p>
    </div>

    {error && <div className="discovery-feedback discovery-feedback--error" role="alert"><CircleAlert size={16}/><span>{error}</span><button type="button" onClick={() => setError("")} aria-label="Dismiss error"><XCircle size={15}/></button></div>}
    {notice && <div className="discovery-feedback discovery-feedback--success" role="status"><CheckCircle2 size={16}/><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="Dismiss notice">×</button></div>}

    <div className="discovery-evidence-summary">
      <article><strong>{candidates.length}</strong><span>Lineage citations</span></article>
      <article><strong>{packs.length}</strong><span>Evidence packs</span></article>
      <article><strong>{activeItems.length}</strong><span>Items in selected pack</span></article>
      <article><strong>{events.length}</strong><span>Selected pack events</span></article>
    </div>

    <div className="discovery-evidence-layout">
      <section className="discovery-evidence-pane">
        <div className="section-heading"><div><span className="section-kicker">PACK REGISTRY</span><h3>Create / select a pack</h3></div><Archive size={18}/></div>
        {canManage && <form className="discovery-evidence-create" onSubmit={createPack}>
          <label>Pack title<input required minLength={3} maxLength={160} value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Company identity evidence bundle" disabled={Boolean(busy)}/></label>
          <label>Intended purpose<textarea required minLength={10} maxLength={1000} rows={2} value={purpose} onChange={event => setPurpose(event.target.value)} disabled={Boolean(busy)}/></label>
          <button type="submit" className="primary-button" disabled={Boolean(busy) || title.trim().length < 3 || purpose.trim().length < 10}>
            {busy === "create" ? <LoaderCircle size={14} className="spin"/> : <Plus size={14}/>}Create evidence pack
          </button>
        </form>}
        {!canManage && <p className="discovery-readonly">You can view evidence packs. Only company owners/admins can curate, submit, review or export packs.</p>}
        <div className="discovery-evidence-pack-list">
          {packs.map(pack => <button type="button" key={pack.id}
            className={"discovery-evidence-pack-choice" + (pack.id === selectedPackId ? " is-selected" : "")}
            onClick={() => setSelectedPackId(pack.id)}>
            <span><b>{pack.title}</b><small>{pack.item_count} citation(s) · {formatDate(pack.updated_at)}</small></span>
            <em className={"discovery-evidence-status status-" + pack.status}>{label(pack.status)}</em>
          </button>)}
          {!packs.length && <p className="discovery-empty-inline">No evidence packs yet. Create one to curate citations for review.</p>}
        </div>
      </section>

      <section className="discovery-evidence-pane">
        <div className="section-heading"><div><span className="section-kicker">PACK REVIEW</span><h3>{selectedPack?.title || "Select an evidence pack"}</h3></div><FileSearch size={18}/></div>
        {selectedPack ? <>
          <p>{selectedPack.purpose}</p>
          <div className="discovery-evidence-pack-meta">
            <span><b>Status</b><em className={"discovery-evidence-status status-" + selectedPack.status}>{label(selectedPack.status)}</em></span>
            <span><b>Created</b>{formatDate(selectedPack.created_at)}</span>
            <span><b>Last reviewed</b>{formatDate(selectedPack.reviewed_at)}</span>
            <span><b>Reviewer</b>{selectedPack.reviewed_by || "Not reviewed"}</span>
          </div>
          {selectedPack.review_reason && <p className="discovery-readonly"><b>Review reason:</b> {selectedPack.review_reason}</p>}
          <label>Reason for evidence inclusion/removal or review
            <input value={reason} onChange={event => setReason(event.target.value)} minLength={10} maxLength={1000} disabled={Boolean(busy)}/>
          </label>
          {selectedPack.status === "draft" && canManage && <div className="discovery-action-row">
            <button type="button" className="primary-button" onClick={() => void runAction("submit","evidence.packs.submit",{packId:selectedPack.id,reason:reason.trim()},"Evidence pack submitted for owner/admin review.")} disabled={Boolean(busy) || activeItems.length < 1 || reason.trim().length < 10}>
              <Send size={14}/>Submit for review
            </button>
          </div>}
          {selectedPack.status === "in_review" && canManage && <div className="discovery-action-row">
            <button type="button" className="primary-button" onClick={() => void runAction("approve","evidence.packs.review",{packId:selectedPack.id,decision:"approved",reason:reason.trim()},"Evidence pack approved. Its metadata/provenance export is now available.")} disabled={Boolean(busy) || reason.trim().length < 10}><CheckCircle2 size={14}/>Approve pack</button>
            <button type="button" className="secondary-button" onClick={() => void runAction("reject","evidence.packs.review",{packId:selectedPack.id,decision:"rejected",reason:reason.trim()},"Evidence pack rejected. Its review receipt has been preserved.")} disabled={Boolean(busy) || reason.trim().length < 10}>Reject pack</button>
          </div>}
          {selectedPack.status === "rejected" && canManage && <div className="discovery-action-row">
            <button type="button" className="secondary-button" onClick={() => void runAction("reopen","evidence.packs.reopen",{packId:selectedPack.id,reason:reason.trim()},"Rejected evidence pack reopened as a draft.")} disabled={Boolean(busy) || reason.trim().length < 10}>Reopen as draft</button>
          </div>}
          {selectedPack.status === "approved" && canManage && <div className="discovery-action-row">
            <button type="button" className="primary-button" onClick={() => void exportPack()} disabled={Boolean(busy) || !activeItems.length}>
              {busy === "export" ? <LoaderCircle size={14} className="spin"/> : <Download size={14}/>}Export SHA-256 verified manifest
            </button>
          </div>}
          <div className="discovery-evidence-items">
            <b>Included citations ({activeItems.length})</b>
            {activeItems.map(item => <article key={item.item_id}>
              <div><b>{label(item.subject_kind)}{item.field_name ? " · " + item.field_name : ""}</b><small>{label(item.event_type)} · {item.source_name_snapshot || item.source_domain_snapshot || "Source snapshot unavailable"}</small></div>
              <small>Evidence ID: {item.evidence_id} · SHA-256: {item.evidence_content_hash || "Not recorded"}</small>
              <small>Captured: {formatDate(item.evidence_captured_at)} · provenance: {formatDate(item.occurred_at)}</small>
              <small>{item.evidence_retained ? "Raw evidence retained under source retention policy" : "Raw evidence purged or unavailable · provenance retained"}</small>
              {selectedPack.status === "draft" && canManage && <button type="button" className="text-button" onClick={() => removeItem(item)} disabled={Boolean(busy)}><Trash2 size={13}/>Remove citation</button>}
            </article>)}
            {!activeItems.length && <p className="discovery-empty-inline">No citations included yet.</p>}
          </div>
          <details className="discovery-history">
            <summary><Clock3 size={13}/>Pack activity history ({events.length})</summary>
            {events.map(event => <div key={event.id}><b>{label(event.event_type)}</b><small>{formatDate(event.occurred_at)} · {event.actor_user_id || "system"}</small><p>{event.reason}</p></div>)}
          </details>
        </> : <p className="discovery-empty-inline">Choose a pack or create a new draft to begin.</p>}
      </section>
    </div>

    <section className="discovery-evidence-catalogue">
      <div className="section-heading"><div><span className="section-kicker">ALL-STAGE EVIDENCE CATALOGUE</span><h3>Available provenance citations</h3><p>Each row references one immutable E13 lineage event associated with an E04 evidence snapshot. Add citations to the selected draft.</p></div></div>
      <label className="discovery-evidence-search">Search source, stage, field or evidence ID
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search citations…" />
      </label>
      <div className="discovery-evidence-candidate-list">
        {visibleCandidates.map(candidate => <article key={candidate.provenance_event_id}>
          <div><b>{label(candidate.subject_kind)}{candidate.field_name ? " · " + candidate.field_name : ""}</b><em>{label(candidate.event_type)}</em></div>
          <small>{candidate.source_name_snapshot || "Unknown source"} · {candidate.source_domain_snapshot || "domain not recorded"} · {candidate.source_jurisdiction_snapshot || "jurisdiction not recorded"}</small>
          <small>Evidence {candidate.evidence_id} · SHA-256 {candidate.evidence_content_hash || "not recorded"}</small>
          <small>Captured {formatDate(candidate.evidence_captured_at)} · published {formatDate(candidate.source_published_at)}</small>
          <small>{candidate.evidence_retained ? "Raw evidence retained" : "Raw evidence purged/unavailable; lineage retained"}</small>
          <small>Attribution: {candidate.source_attribution_snapshot || "Not recorded"} · licence: {candidate.source_license_ref_snapshot || "Not recorded"}</small>
          {canManage && selectedPack?.status === "draft" && <button type="button" className="secondary-button"
            onClick={() => addCandidate(candidate)} disabled={Boolean(busy) || reason.trim().length < 10}>
            {busy === "add:" + candidate.provenance_event_id ? <LoaderCircle size={13} className="spin"/> : <Plus size={13}/>}Add to selected draft
          </button>}
        </article>)}
        {!visibleCandidates.length && <p className="discovery-empty-inline">{candidates.length ? "No matching citations remain outside the selected draft." : "No evidence-backed provenance citations are available for this company yet."}</p>}
      </div>
    </section>

    <div className="discovery-preflight-banner"><ShieldCheck size={14}/>Export is metadata/provenance only. Original evidence remains in the existing private E04 evidence store and is governed by its source retention policy. No raw evidence is copied into this pack manager.</div>
  </section>;
}
