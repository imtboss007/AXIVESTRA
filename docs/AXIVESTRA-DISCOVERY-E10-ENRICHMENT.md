# AXIVESTRA E10 — Enrichment & Attribute Validation

**Status:** Engineering implementation on `feat/discovery-e10-enrichment`, based on E09. No provider, external feed, production migration or worker is activated.

## Matrix scope

The AXIVESTRA Lead & Customer Intelligence Matrix says E10 combines independent, permitted sources to fill business, finance, property and operating attributes, while keeping conflicting values and timestamps. Its output is enriched facts with source-by-source evidence. Source directions are official company/regulator pages, licensed feeds and selected open data with attribution. Its status says no external enrichment provider is connected and the priority is source-by-source only.

## Implemented boundaries

- A source must be E02-approved, have the exact allowed purpose `enrichment`, retain the same reviewed field schema and allow-list, and remain linked to an enabled LENDER/CUSTOMER profile with an active company worker grant.
- An extracted organization must already have an E06 owner-reviewed canonical company assignment. No fuzzy entity resolution, standalone name linking or person-level enrichment is permitted in E10.
- The E10 attribute registry is allow-listed to business, finance, property and operating fields. Contact data, personal profile data, unrestricted extra fields and unregistered attributes are ignored.
- Observations preserve raw source value and E05 normalized value, declared source unit/currency metadata, source confidence, source field/span, content hash, source attribution/licence, jurisdiction, publication time, evidence capture time and extraction time.
- No currency conversion, unit conversion, date reinterpretation, averaging, source priority, overwrite or single-current-value selection is performed.
- When distinct sources provide different values for the same canonical company attribute, both observations are retained and the pair is flagged as a **potential value disagreement**. Publication/capture timestamps remain available. A timestamp difference is not automatically treated as proof of error; an owner/admin can mark different periods, retain both, or select one observation with a reason.
- Owner/admin review is required before an observation is accepted. An observation with an unresolved potential disagreement cannot be accepted through the ordinary observation-review function.
- Observations and conflict receipts retain historical E05 evidence/fact UUIDs rather than cascading with raw evidence expiry.

## Worker

- `DISCOVERY_ENRICHMENT_WORKER_ENABLED=true` enables the server-side worker.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are server-side only.
- No external provider/API adapter or network call exists in this stage. Sources are consumed only through earlier approved E02/E03/E04/E05 flows.

## Validation boundary

E10 stores observed values and source-by-source provenance; it does not decide which value is true, calculate creditworthiness, value property, verify title/ownership or produce E11 fit scores. Those remain later, separately governed stages.
