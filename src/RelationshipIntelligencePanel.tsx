import { useMemo, useState } from "react";
import { ArrowUpRight, Search, Users, Link2, AlertTriangle, Unlink2, Network, List } from "lucide-react";
import { buildRelationshipIntelligence } from "./lib/relationship-intelligence.mjs";

type Contact = { id: string; name: string; role?: string; roles?: string[]; customRoles?: string };
type WorkspaceRecord = { id: string; title: string; module: string; primaryContactId?: string; moduleData?: Record<string, string> };
type Task = { id: string; title: string; contactId?: string; followUpContactIds?: string[] };
type Financial = { id: string; reference?: string; type?: string; contactId?: string };
type Risk = { id: string; title: string; contactId?: string };
type Approval = { id: string; title: string; contactId?: string };
type Document = { id: string; name: string; contactId?: string };
type Props = {
  contacts: Contact[]; properties: WorkspaceRecord[]; tasks: Task[];
  financials: Financial[]; risks: Risk[]; approvals: Approval[]; documents: Document[];
  onOpenWorkspace: (name: string) => void;
};
type PersonSummary = ReturnType<typeof buildRelationshipIntelligence>["contacts"][number];

function RelationshipGraph({ people, onOpenWorkspace }: { people: PersonSummary[]; onOpenWorkspace: Props["onOpenWorkspace"] }) {
  const [focus, setFocus] = useState<{ kind: "contact" | "record"; key: string } | null>(null);
  const graph = useMemo(() => {
    const visiblePeople = people.slice(0, 24);
    const allFilteredRecords = new Map<string, PersonSummary["records"][number]>();
    people.forEach(person => person.records.forEach(record => allFilteredRecords.set(record.key, record)));
    const visibleRecords = new Map<string, PersonSummary["records"][number]>();
    visiblePeople.forEach(person => person.records.forEach(record => visibleRecords.set(record.key, record)));
    const recordNodes = [...visibleRecords.values()].slice(0, 48);
    const recordIndex = new Map(recordNodes.map((record, index) => [record.key, index]));
    const edges = visiblePeople.flatMap((person, personIndex) => person.records.flatMap(record => {
      const target = recordIndex.get(record.key);
      return target === undefined ? [] : [{ personIndex, personId: person.id, recordIndex: target, recordKey: record.key, relations: record.relations.join(", ") }];
    }));
    return {
      visiblePeople,
      recordNodes,
      edges,
      hasMorePeople: people.length > visiblePeople.length,
      totalRecordCount: allFilteredRecords.size,
      hasMoreRecords: allFilteredRecords.size > recordNodes.length,
      height: Math.max(300, visiblePeople.length * 104 + 44, recordNodes.length * 82 + 44)
    };
  }, [people]);

  const activeFocus = focus && (focus.kind === "contact"
    ? graph.visiblePeople.some(person => person.id === focus.key)
    : graph.recordNodes.some(record => record.key === focus.key)) ? focus : null;
  const focusedPerson = activeFocus?.kind === "contact"
    ? graph.visiblePeople.find(person => person.id === activeFocus.key)
    : undefined;
  const focusedRecord = activeFocus?.kind === "record"
    ? graph.recordNodes.find(record => record.key === activeFocus.key)
    : undefined;
  const isFocusedEdge = (edge: typeof graph.edges[number]) => !activeFocus
    || (activeFocus.kind === "contact" ? edge.personId === activeFocus.key : edge.recordKey === activeFocus.key);
  const isFocusedPerson = (person: PersonSummary) => !activeFocus
    || (activeFocus.kind === "contact" ? person.id === activeFocus.key : person.records.some(record => record.key === activeFocus.key));
  const isFocusedRecord = (record: PersonSummary["records"][number]) => !activeFocus
    || (activeFocus.kind === "contact" ? Boolean(focusedPerson?.records.some(item => item.key === record.key)) : record.key === activeFocus.key);
  const focusedLinks = activeFocus ? graph.edges.filter(isFocusedEdge).length : 0;
  const focusLabel = focusedPerson ? focusedPerson.name : focusedRecord?.title;

  if (!graph.recordNodes.length) return <p className="ax-relationship-unlinked">{people.length
    ? "No explicit saved contact-ID links match this search. Search by another contact or source record."
    : "No matching contacts were found. Change the search to inspect a different contact or linked record."}</p>;

  const toggleFocus = (next: { kind: "contact" | "record"; key: string }) => {
    setFocus(current => current?.kind === next.kind && current.key === next.key ? null : next);
  };

  return <div className="ax-relationship-graph-scroll" role="region" aria-label={`Relationship graph with ${graph.edges.length} explicit saved contact-to-record links; horizontally scrollable`} tabIndex={0}>
    <div className="ax-relationship-graph__summary" aria-live="polite">
      <span><strong>{activeFocus ? focusedLinks.toLocaleString("en-IN") : graph.edges.length.toLocaleString("en-IN")}</strong> {activeFocus ? "highlighted saved links" : "visible explicit saved links"}</span>
      <span>Contacts {graph.visiblePeople.length}/{people.length} · linked records {graph.recordNodes.length}/{graph.totalRecordCount}</span>
    </div>
    {activeFocus && <div className="ax-relationship-graph__focus-status" aria-live="polite">
      <span>Focused: <strong>{focusLabel}</strong> · {focusedLinks} connected link{focusedLinks === 1 ? "" : "s"}</span>
      <button type="button" onClick={() => setFocus(null)}>Clear focus <span aria-hidden="true">×</span></button>
    </div>}
    <div className="ax-relationship-graph" style={{ height: graph.height }}>
      <div className="ax-relationship-graph__heading ax-relationship-graph__heading--people">CONTACTS <span>{graph.visiblePeople.length}</span></div>
      <div className="ax-relationship-graph__heading ax-relationship-graph__heading--records">LINKED RECORDS <span>{graph.recordNodes.length}</span></div>
      <svg className="ax-relationship-graph__edges" viewBox={`0 0 840 ${graph.height}`} preserveAspectRatio="none" role="img" aria-label={`${graph.edges.length} explicit saved contact-to-record links`}>
        {graph.edges.map((edge, index) => {
          const y1 = edge.personIndex * 104 + 88;
          const y2 = edge.recordIndex * 82 + 79;
          return <path key={index} className={activeFocus ? isFocusedEdge(edge) ? "is-focused" : "is-dimmed" : ""} d={`M 258 ${y1} C 330 ${y1}, 365 ${y2}, 438 ${y2}`}><title>{edge.relations || "Explicit saved contact link"}</title></path>;
        })}
      </svg>
      {graph.visiblePeople.map((person, index) => <button
        type="button"
        className={`ax-relationship-graph__node ax-relationship-graph__node--person${activeFocus ? isFocusedPerson(person) ? " is-focused" : " is-dimmed" : ""}`}
        style={{ top: index * 104 + 48 }}
        key={person.id}
        aria-pressed={activeFocus?.kind === "contact" && activeFocus.key === person.id}
        aria-label={`Highlight saved relationships for ${person.name}, ${person.recordCount} linked records`}
        onClick={() => toggleFocus({ kind: "contact", key: person.id })}
      >
        <span className="ax-relationship-graph__node-icon"><Users size={15}/></span>
        <span className="ax-relationship-graph__node-copy"><strong>{person.name}</strong><small>{person.roles.join(" · ") || "Role not specified"}</small><small>{person.recordCount} linked records · ID {person.id}</small></span>
      </button>)}
      {graph.recordNodes.map((record, index) => <article
        className={`ax-relationship-graph__node ax-relationship-graph__node--record${activeFocus ? isFocusedRecord(record) ? " is-focused" : " is-dimmed" : ""}`}
        style={{ top: index * 82 + 48 }}
        key={record.key}
      >
        <button
          type="button"
          className="ax-relationship-graph__focus"
          aria-pressed={activeFocus?.kind === "record" && activeFocus.key === record.key}
          aria-label={`Highlight contacts linked to ${record.title}`}
          onClick={() => toggleFocus({ kind: "record", key: record.key })}
        >
          <span className="ax-relationship-graph__node-icon"><Link2 size={15}/></span>
          <span className="ax-relationship-graph__node-copy"><strong>{record.title}</strong><small>{record.workspace || record.kind} · {record.relations.join(" · ")}</small><small>Source ID: {record.recordId || "not supplied"}</small></span>
        </button>
        {record.workspace && <button type="button" className="text-button" onClick={() => onOpenWorkspace(record.workspace)} aria-label={`Open ${record.workspace} workspace`}><ArrowUpRight size={14}/></button>}
      </article>)}
    </div>
    {(graph.hasMorePeople || graph.hasMoreRecords) && <p className="ax-relationship-graph__limit">Showing a readable graph subset. Use search to narrow the graph to a specific contact or source record.</p>}
  </div>;
}

export default function RelationshipIntelligencePanel(props: Props) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"list" | "graph">("graph");
  const result = useMemo(() => buildRelationshipIntelligence(props), [
    props.contacts, props.properties, props.tasks, props.financials,
    props.risks, props.approvals, props.documents
  ]);
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    if (!search) return result.contacts;
    return result.contacts.filter(person =>
      [person.name, person.id, person.role, ...person.roles, ...person.workspaces,
        ...person.records.flatMap(record => [record.title, record.recordId, record.workspace, ...record.relations])]
        .join(" ").toLocaleLowerCase().includes(search)
    );
  }, [query, result]);

  return (
    <section className="data-panel ax-relationship-intelligence" aria-label="Cross-workspace relationship intelligence">
      <div className="section-heading">
        <div>
          <span className="section-kicker">CROSS-WORKSPACE RELATIONSHIP GRAPH</span>
          <h2>Who is connected to what?</h2>
          <p>Connections are drawn only from saved contact IDs. Matching names are never treated as proof of a relationship.</p>
        </div>
        <label className="search-box ax-relationship-search">
          <Search size={15} />
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search people, roles or records…" aria-label="Search relationship intelligence" />
        </label>
      </div>
      <div className="ax-relationship-metrics">
        <article><Users size={17}/><strong>{result.linkedContacts}</strong><span>Linked contacts</span></article>
        <article><Link2 size={17}/><strong>{result.linkedRecords}</strong><span>Linked source records</span></article>
        <article><Unlink2 size={17}/><strong>{result.unlinkedContacts}</strong><span>Contacts without ID links</span></article>
        <article><AlertTriangle size={17}/><strong>{result.unresolvedReferences}</strong><span>Unresolved contact IDs</span></article>
      </div>
      <div className="ax-relationship-view-toggle" role="group" aria-label="Relationship view">
        <button type="button" className={view === "graph" ? "is-active" : ""} aria-pressed={view === "graph"} onClick={() => setView("graph")}><Network size={14}/> Graph</button>
        <button type="button" className={view === "list" ? "is-active" : ""} aria-pressed={view === "list"} onClick={() => setView("list")}><List size={14}/> List</button>
      </div>
      {view === "graph" ? <RelationshipGraph people={filtered} onOpenWorkspace={props.onOpenWorkspace}/> : <div className="ax-relationship-list">
        {filtered.map(person => (
          <details className="ax-relationship-person" key={person.id}>
            <summary>
              <span className="ax-relationship-avatar"><Users size={16}/></span>
              <span className="ax-relationship-person-main">
                <strong>{person.name}</strong>
                <small>{[...person.roles].join(" · ") || "Role not specified"} · ID {person.id}</small>
              </span>
              <span className="ax-relationship-person-count">{person.recordCount} linked</span>
            </summary>
            {person.records.length ? (
              <div className="ax-relationship-records">
                {person.records.map(record => (
                  <article key={record.key}>
                    <div><strong>{record.title}</strong><small>{record.workspace || record.kind} · {record.relations.join(" · ")}</small><small>Source ID: {record.recordId}</small></div>
                    {record.workspace && <button type="button" className="text-button" onClick={() => props.onOpenWorkspace(record.workspace)}>Open workspace <ArrowUpRight size={14}/></button>}
                  </article>
                ))}
              </div>
            ) : <p className="ax-relationship-unlinked">No explicit record links are saved for this contact yet.</p>}
          </details>
        ))}
        {filtered.length === 0 && <p className="ax-relationship-unlinked">No contacts match this search.</p>}
      </div>}
      <p className="ax-relationship-footnote">Evidence boundary: this view reports explicit saved IDs only. It does not infer relationships from names or text and does not yet represent a complete person–organisation–deal graph.</p>
    </section>
  );
}
