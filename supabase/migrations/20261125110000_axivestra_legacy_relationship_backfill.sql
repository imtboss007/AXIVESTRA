-- AXIVESTRA E16.1: opt-in backfill of legacy, explicitly saved contact IDs.
-- This migration only installs a preview/apply RPC. It does not execute a backfill.
begin;

create or replace function public.backfill_company_deal_parties_from_legacy_links(
  p_company_id uuid,
  p_apply boolean default false,
  p_limit integer default 5000
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $backfill$
declare
  v_candidate_count integer:=0;
  v_inserted_count integer:=0;
  v_preview jsonb:='[]'::jsonb;
begin
  if auth.uid() is null or not public.has_company_role(p_company_id,array['owner','admin']) then
    raise exception 'Only a signed-in company owner or admin can preview or apply legacy relationship backfill.'
      using errcode='42501';
  end if;
  if p_limit is null or p_limit<1 or p_limit>10000 then
    raise exception 'Backfill limit must be between 1 and 10000.' using errcode='22023';
  end if;

  with raw_links as (
    select
      d.company_id,
      d.record_key as deal_record_key,
      nullif(btrim(link.party_record_key),'') as party_record_key,
      link.role_code,
      link.link_kind,
      link.source_field,
      case
        when coalesce(d.payload->>'createdAt','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
          then substring(d.payload->>'createdAt' from 1 for 10)::date
        else coalesce(d.created_at::date,current_date)
      end as effective_from
    from public.company_records d
    cross join lateral (
      select d.payload->>'primaryContactId' as party_record_key,
        'other'::text as role_code,'primary_contact'::text as link_kind,'primaryContactId'::text as source_field
      union all
      select split_link.value,'other'::text,'linked_contact'::text,'moduleData.__linkedContactIds'::text
      from unnest(string_to_array(coalesce(d.payload->'moduleData'->>'__linkedContactIds',''),',')) as split_link(value)
      union all
      select kv.value,
        case lower(regexp_replace(kv.key,'^__contact_',''))
          when 'seller' then 'seller'
          when 'buyer' then 'buyer'
          when 'broker' then 'broker'
          when 'brokercustodian' then 'broker'
          when 'legalcounsel' then 'advocate'
          when 'advocate' then 'advocate'
          when 'borrower' then 'borrower'
          when 'lender' then 'lender'
          when 'guarantor' then 'guarantor'
          when 'owner' then 'owner'
          when 'collateralowner' then 'owner'
          when 'landowner' then 'owner'
          when 'developer' then 'developer'
          when 'mediator' then 'mediator'
          when 'investor' then 'investor'
          when 'leadinvestor' then 'investor'
          when 'fundmanager' then 'fund_manager'
          when 'advisor' then 'advisor'
          when 'agent' then 'agent'
          when 'tenant' then 'tenant'
          when 'buyertenant' then 'tenant'
          when 'reviewer' then 'reviewer'
          else 'other'
        end,
        'module_contact_field'::text,kv.key
      from jsonb_each_text(
        case when jsonb_typeof(d.payload->'moduleData')='object' then d.payload->'moduleData' else '{}'::jsonb end
      ) as kv(key,value)
      where left(kv.key,10)='__contact_'
    ) link
    join public.company_records c
      on c.company_id=d.company_id and c.record_type='contact'
      and c.record_key=nullif(btrim(link.party_record_key),'') and c.deleted_at is null
    where d.company_id=p_company_id and d.record_type='property' and d.deleted_at is null
      and nullif(btrim(link.party_record_key),'') is not null
  ), candidates as (
    select
      company_id,deal_record_key,party_record_key,role_code,effective_from,
      jsonb_build_object(
        'legacy_backfill',true,
        'source_fields',jsonb_agg(distinct source_field order by source_field),
        'link_kinds',jsonb_agg(distinct link_kind order by link_kind)
      ) as metadata
    from raw_links
    group by company_id,deal_record_key,party_record_key,role_code,effective_from
    order by deal_record_key,party_record_key,role_code,effective_from
    limit p_limit
  ), ranked as (
    select *,row_number() over(order by deal_record_key,party_record_key,role_code,effective_from) as preview_rank
    from candidates
  )
  select count(*)::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'deal_record_key',deal_record_key,
      'party_record_key',party_record_key,
      'role_code',role_code,
      'effective_from',effective_from,
      'source_fields',metadata->'source_fields'
    ) order by deal_record_key,party_record_key,role_code) filter(where preview_rank<=20),'[]'::jsonb)
  into v_candidate_count,v_preview
  from ranked;

  if p_apply then
    with raw_links as (
      select
        d.company_id,d.record_key as deal_record_key,
        nullif(btrim(link.party_record_key),'') as party_record_key,
        link.role_code,link.link_kind,link.source_field,
        case
          when coalesce(d.payload->>'createdAt','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
            then substring(d.payload->>'createdAt' from 1 for 10)::date
          else coalesce(d.created_at::date,current_date)
        end as effective_from
      from public.company_records d
      cross join lateral (
        select d.payload->>'primaryContactId' as party_record_key,
          'other'::text as role_code,'primary_contact'::text as link_kind,'primaryContactId'::text as source_field
        union all
        select split_link.value,'other'::text,'linked_contact'::text,'moduleData.__linkedContactIds'::text
        from unnest(string_to_array(coalesce(d.payload->'moduleData'->>'__linkedContactIds',''),',')) as split_link(value)
        union all
        select kv.value,
          case lower(regexp_replace(kv.key,'^__contact_',''))
            when 'seller' then 'seller'
            when 'buyer' then 'buyer'
            when 'broker' then 'broker'
            when 'brokercustodian' then 'broker'
            when 'legalcounsel' then 'advocate'
            when 'advocate' then 'advocate'
            when 'borrower' then 'borrower'
            when 'lender' then 'lender'
            when 'guarantor' then 'guarantor'
            when 'owner' then 'owner'
            when 'collateralowner' then 'owner'
            when 'landowner' then 'owner'
            when 'developer' then 'developer'
            when 'mediator' then 'mediator'
            when 'investor' then 'investor'
            when 'leadinvestor' then 'investor'
            when 'fundmanager' then 'fund_manager'
            when 'advisor' then 'advisor'
            when 'agent' then 'agent'
            when 'tenant' then 'tenant'
            when 'buyertenant' then 'tenant'
            when 'reviewer' then 'reviewer'
            else 'other'
          end,
          'module_contact_field'::text,kv.key
        from jsonb_each_text(
          case when jsonb_typeof(d.payload->'moduleData')='object' then d.payload->'moduleData' else '{}'::jsonb end
        ) as kv(key,value)
        where left(kv.key,10)='__contact_'
      ) link
      join public.company_records c
        on c.company_id=d.company_id and c.record_type='contact'
        and c.record_key=nullif(btrim(link.party_record_key),'') and c.deleted_at is null
      where d.company_id=p_company_id and d.record_type='property' and d.deleted_at is null
        and nullif(btrim(link.party_record_key),'') is not null
    ), candidates as (
      select
        company_id,deal_record_key,party_record_key,role_code,effective_from,
        jsonb_build_object(
          'legacy_backfill',true,
          'source_fields',jsonb_agg(distinct source_field order by source_field),
          'link_kinds',jsonb_agg(distinct link_kind order by link_kind)
        ) as metadata
      from raw_links
      group by company_id,deal_record_key,party_record_key,role_code,effective_from
      order by deal_record_key,party_record_key,role_code,effective_from
      limit p_limit
    )
    insert into public.company_deal_parties(
      company_id,deal_record_type,deal_record_key,party_record_type,party_record_key,
      role_code,responsibility_code,effective_from,verification_state,metadata,created_by,updated_by
    )
    select
      company_id,'property',deal_record_key,'contact',party_record_key,
      role_code,'participant',effective_from,'unverified',metadata,auth.uid(),auth.uid()
    from candidates
    on conflict(company_id,deal_record_key,party_record_key,role_code,effective_from) do nothing;
    get diagnostics v_inserted_count=row_count;
  end if;

  return jsonb_build_object(
    'company_id',p_company_id,
    'dry_run',not p_apply,
    'candidate_count',v_candidate_count,
    'inserted_count',v_inserted_count,
    'existing_or_skipped_count',greatest(v_candidate_count-v_inserted_count,0),
    'preview',v_preview,
    'message',case when p_apply
      then 'Explicit legacy contact-ID relationships were backfilled as unverified. No names were matched and no evidence status was inferred.'
      else 'Dry run only. Review the count and sample; call again with p_apply=true only after owner/admin approval.'
    end
  );
end;
$backfill$;

revoke all on function public.backfill_company_deal_parties_from_legacy_links(uuid,boolean,integer) from public,anon,service_role;
grant execute on function public.backfill_company_deal_parties_from_legacy_links(uuid,boolean,integer) to authenticated;
comment on function public.backfill_company_deal_parties_from_legacy_links(uuid,boolean,integer) is
  'E16 opt-in owner/admin backfill from explicit primaryContactId, __linkedContactIds and __contact_* stable IDs. Dry-run by default; never name-match or verify.';
commit;
