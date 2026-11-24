-- AXIVESTRA E11: add the source-backed attributes needed by lender/customer qualification
-- and expand the weighted match component taxonomy to include sector.
-- This migration adds catalogue definitions only; it does not approve sources,
-- accept enrichment observations, run scoring, or activate a worker.

begin;

insert into public.discovery_enrichment_attribute_registry(
  attribute_key,category,source_field_names,accepted_value_types,active
) values
  ('sector','business',array['sector'],array['string','array'],true),
  ('business_sector','business',array['business_sector'],array['string','array'],true),
  ('institution_type','business',array['institution_type'],array['string','array'],true),
  ('lender_category','business',array['lender_category'],array['string','array'],true),
  ('borrower_type','business',array['borrower_type'],array['string','array'],true),
  ('counterparty_type','business',array['counterparty_type'],array['string','array'],true),
  ('investor_type','business',array['investor_type'],array['string','array'],true),
  ('capital_instrument','business',array['capital_instrument'],array['string','array'],true),
  ('funding_instrument','business',array['funding_instrument'],array['string','array'],true),
  ('debt_equity_instrument','business',array['debt_equity_instrument'],array['string','array'],true),
  ('facility_type','business',array['facility_type'],array['string','array'],true),
  ('product_type','business',array['product_type'],array['string','array'],true),
  ('collateral_type','business',array['collateral_type'],array['string','array'],true),
  ('eligible_collateral','business',array['eligible_collateral'],array['string','array'],true),
  ('security_type','business',array['security_type'],array['string','array'],true),
  ('startup_stage','business',array['startup_stage'],array['string','array'],true),
  ('funding_stage','business',array['funding_stage'],array['string','array'],true),
  ('project_stage','business',array['project_stage'],array['string','array'],true),
  ('development_stage','business',array['development_stage'],array['string','array'],true),
  ('mandate','business',array['mandate'],array['string','array'],true),
  ('investment_mandate','business',array['investment_mandate'],array['string','array'],true),
  ('lending_mandate','business',array['lending_mandate'],array['string','array'],true),
  ('funding_mandate','business',array['funding_mandate'],array['string','array'],true),
  ('investment_thesis','business',array['investment_thesis'],array['string','array'],true),
  ('geography','business',array['geography'],array['string','array'],true),
  ('country','business',array['country'],array['string'],true),
  ('state','business',array['state'],array['string'],true),
  ('city','business',array['city'],array['string'],true),
  ('district','business',array['district'],array['string'],true),
  ('institution_name','business',array['institution_name'],array['string','array'],true),
  ('registration_status','business',array['registration_status'],array['string','identifier','date'],true),
  ('source_as_of_date','business',array['source_as_of_date'],array['date','string'],true),
  ('registered_office_address','business',array['registered_office_address'],array['string'],true),
  ('certificate_status','business',array['certificate_status'],array['string','identifier'],true),
  ('legal_name','business',array['legal_name'],array['string'],true),
  ('registration_id','business',array['registration_id'],array['identifier','string'],true),
  ('registered_state','business',array['registered_state'],array['string'],true),
  ('minimum_ticket_size','finance',array['minimum_ticket_size'],array['currency','number'],true),
  ('maximum_ticket_size','finance',array['maximum_ticket_size'],array['currency','number'],true),
  ('min_ticket','finance',array['min_ticket'],array['currency','number'],true),
  ('max_ticket','finance',array['max_ticket'],array['currency','number'],true)
on conflict (attribute_key) do update
  set category = excluded.category,
      source_field_names = excluded.source_field_names,
      accepted_value_types = excluded.accepted_value_types,
      active = true;

alter table public.discovery_match_score_components
  drop constraint if exists discovery_match_score_components_criterion_check;
alter table public.discovery_match_score_components
  add constraint discovery_match_score_components_criterion_check check (criterion in (
    'geography','type','sector','ticket','instrument','collateral','stage','mandate','evidence_freshness'
  ));

comment on table public.discovery_enrichment_attribute_registry is
  'Approved E10 source-field to business attribute taxonomy. E11 uses only owner-accepted observations from this registry.';
comment on table public.discovery_match_score_components is
  'Criterion-level weighted E11 match factors, including workspace-configured sector fit.';

commit;
