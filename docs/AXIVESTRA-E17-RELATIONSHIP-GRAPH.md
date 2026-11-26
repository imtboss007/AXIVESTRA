# AXIVESTRA E17 — Relationship Graph Intelligence

**Stage:** Gate 2 relationship intelligence  
**Migration:** `20261122320000_axivestra_relationship_graph.sql`  
**Depends on:** E16 canonical deal-party relationships

## Delivered

E17 exposes a company-scoped graph projection over explicit E16 deal-party links. It does not infer edges from names, contact similarity or free-text notes.

- `company_relationship_graph` is a security-invoker view that joins relationship records to their deal, contact and optional evidence metadata.
- The projection emits only stable record keys, safe display labels, role/responsibility, authority scope, effective dates and verification/evidence state. It never returns full contact or company payloads.
- `get_company_relationship_graph(company_id, as_of_date)` returns unique deal/contact nodes, explicit relationship edges and verification counts.
- A historical as-of date can be supplied to examine the relationship state at that time.
- Deleted deal/contact source records are excluded from the graph.
- Reads require an authenticated company member. The graph view and RPC have least-privilege grants.

## Workspace integration

The AXIVESTRA overview now includes the normalized relationship panel. Owner, admin, manager and staff users can record a deal-to-contact role, review or update its verification state, attach existing document metadata and set an effective end date. The graph reads through the E17 company-scoped RPC and only labels the safe display fields returned by that projection.

## Interactive relationship network

The normalized relationship panel now renders the same RPC response as an ECharts force-directed network:

- Deal/workspace records and person/contact records use separate node categories.
- Directed arrows represent the explicitly stored E16 deal-party links.
- Link colours distinguish verified, evidence-supported, claimed, unverified, disputed and rejected states.
- Users can drag nodes, pan/zoom the network, select a node, or use the keyboard-accessible Focus node selector.
- Selecting a node filters the existing evidence/review cards; it does not edit or create a relationship.
- The underlying evidence/review cards remain available as the detailed, accessible audit surface.

The visual reuses the already-installed ECharts dependency. It does not add a second graph framework or duplicate the graph data model.

## Boundaries

- No fuzzy matching, transitive relationship inference, automated deduplication or identity merges.
- The graph contains relationships that have been explicitly recorded in E16; it does not claim to be a complete company-wide graph before legacy links are reconciled.
- The RPC does not include raw contact details, full document contents, phone numbers, email addresses, encrypted fields or raw source payloads.
- E17 is a read/projection layer. It does not rewrite E16 links or backfill legacy moduleData IDs.

## Verification

PostgreSQL integration tests exercise the view and graph RPC after E16 link creation, check node/edge identity and as-of filtering, and verify aggregate counts. Contract tests check company membership gates, payload minimisation, deleted-record exclusion and the no-inference boundary.
