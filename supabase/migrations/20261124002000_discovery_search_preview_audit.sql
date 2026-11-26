-- AXIVESTRA E03: record company-scoped requests to the external public-directory search connector.
-- Raw search terms, snippets and result contents are intentionally not copied into audit metadata.
begin;

alter table public.discovery_audit_events
  drop constraint if exists discovery_audit_events_action_check;
alter table public.discovery_audit_events
  add constraint discovery_audit_events_action_check check (action in (
    'source_registered','source_approved','source_paused','source_rejected',
    'profile_created','profile_updated','profile_enabled','profile_disabled',
    'profile_source_attached','profile_source_detached',
    'discovery_job_queued','discovery_worker_grant_enabled','discovery_worker_grant_disabled',
    'extraction_review_recorded','entity_resolution_review_recorded',
    'entity_relationship_review_recorded','professional_role_review_recorded',
    'contact_point_review_recorded','discovery_search_previewed'
  ));

comment on table public.discovery_audit_events is
  'Append-only discovery governance and source-use events. Search preview events record scope/count metadata only; raw query text and search results are not retained here.';

commit;
