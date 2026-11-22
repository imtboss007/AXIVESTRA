# AXIVESTRA E07 — Public People & Decision-Maker Intelligence

**Status:** Engineering stage on \`feat/discovery-e07-people-intelligence\`, stacked on the validated E06 branch. E07 is a limited public-professional-role evidence workflow. It is not a people-search engine or a personal-data enrichment product.

## Scope

E07 consumes completed E05 extraction and owner-approved E06 company assignments. It can propose a source-backed public professional role against a known canonical company where the evidence supports the association.

The stage stores only:
- A source-observed public person's name (maximum 250 characters).
- An explicit professional/office/board role title (maximum 200 characters).
- The linked E06 canonical company ID and jurisdiction.
- Person and role source locators, confidence, association method and review state.

E07 does **not** store private email addresses, phone numbers, residential addresses, dates of birth, personal identifiers, private notes, scraped profile histories or personal contactability/consent states. It does not create a global canonical person identity. The same name at different companies remains separate source-backed role observations unless later approved policy explicitly defines another lawful basis.

## Association rules

1. Only E05 mentions classified as \`person\` are considered.
2. Only an explicit role/title fact from the fixed E07 role-field allowlist is considered.
3. A company link is proposed only if person, role and E06 company assignment share the same supported HTML/CSV/top-level JSON record row, or if exactly one owner-approved company exists in the entire E05 run.
4. If more than one person or company could match the same row, or the evidence locator cannot establish a safe association, no candidate is emitted.
5. Every output remains pending review. No automatic person profile, contact or workspace record is created.

Supported association locators are deliberately limited to HTML table rows, CSV rows and top-level JSON record-array entries. PDF page proximity and generic text proximity are not used to infer company/person relationships. JSON-LD graph links and nested ambiguous arrays are not guessed.

## Data lifecycle and review

- \`discovery_public_person_role_jobs\`: one bounded job per owner-approved E06 company assignment in an E05 extraction run.
- \`discovery_public_person_role_candidates\`: source-backed person/role/company observations awaiting human review.
- \`discovery_public_person_role_review_events\`: append-only owner/admin accept/reject/escalate decisions and audit receipts.

A candidate can only be created from an immutable E05 run, matching evidence hash, approved source, enabled workspace profile and an existing owner-approved E06 assignment. SQL rechecks the exact extracted person name, source span, explicit role field/value and association context before persistence.

Only company owners/admins can review a candidate. Candidate and review data cascade when the underlying source evidence expires under the source's approved retention period. This is intentional because the observations contain personal data.

## Execution

Run only in a secured server environment with \`SUPABASE_URL\` and \`SUPABASE_SERVICE_ROLE_KEY\`:

\`\`\`sh
DISCOVERY_PUBLIC_PERSON_ROLE_WORKER_ENABLED=true npm --prefix services/discovery-worker run start:people-intelligence
\`\`\`

The worker is disabled by default, performs no external network requests and reads only the fixed public role-field allowlist. It cannot create people, contacts or canonical entities.

## Validation and boundaries

- Unit tests cover explicit roles, supported row locators, multi-company ambiguity, multiple people in a row, exclusion of non-person mentions and private contact fields.
- PostgreSQL integration verifies E05-to-E06-to-E07 queueing, source-bound candidate persistence, viewer denial, owner/admin review, audit receipts and deletion of role data with evidence retention.
- The E07 SQL contract tests ensure the worker cannot add unapproved fields, role titles and names must match E05 facts/mentions, and review requires owner/admin authority.
- Full discovery CI and AXIVESTRA build must pass before this stage is called validated.

No private-professional scraping, social-profile scraping, direct outreach, email/phone discovery, contact validation, automated qualification, investment/loan approval, production migration, merge to \`main\` or deployment is included. E08 contact validation is a separate later stage and must have its own purpose/consent/source gate.
