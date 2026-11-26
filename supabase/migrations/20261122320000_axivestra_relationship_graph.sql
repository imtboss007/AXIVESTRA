-- AXIVESTRA E17: company-scoped relationship graph and safe graph projection.
-- The graph is built only from E16 reviewed/recorded links; names never create edges.
begin;

create or replace view public.company_relationship_graph
with (security_invoker=true)
as
select
  p.company_id,
  p.id as relationship_id,
  p.deal_record_type,
  p.deal_record_key,
  coalesce(nullif(d.payload->>'title',''),nullif(d.payload->>'name',''),nullif(d.payload->>'reference',''),p.deal_record_key) as deal_label,
  p.party_record_type,
  p.party_record_key,
  coalesce(nullif(c.payload->>'name',''),nullif(c.payload->>'legal_name',''),p.party_record_key) as party_label,
  p.role_code,p.responsibility_code,p.authority_scope,p.effective_from,p.effective_to,
  p.verification_state,p.evidence_record_type,p.evidence_record_key,
  case when e.record_key is null then null
    else coalesce(nullif(e.payload->>'name',''),nullif(e.payload->>'title',''),e.record_key) end as evidence_label,
  p.created_at,p.updated_at
from public.company_deal_parties p
join public.company_records d
  on d.company_id=p.company_id and d.record_type=p.deal_record_type
  and d.record_key=p.deal_record_key and d.deleted_at is null
join public.company_records c
  on c.company_id=p.company_id and c.record_type=p.party_record_type
  and c.record_key=p.party_record_key and c.deleted_at is null
left join public.company_records e
  on e.company_id=p.company_id and e.record_type=p.evidence_record_type
  and e.record_key=p.evidence_record_key and e.deleted_at is null;

revoke all on public.company_relationship_graph from public,anon,authenticated;
grant select on public.company_relationship_graph to authenticated;

create or replace function public.get_company_relationship_graph(
  p_company_id uuid,
  p_as_of_date date default current_date
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $graph$
declare v_nodes jsonb; v_edges jsonb; v_counts jsonb; v_date date:=coalesce(p_as_of_date,current_date);
begin
  if auth.uid() is null or not public.is_company_member(p_company_id) then
    raise exception 'A signed-in company member is required to read this relationship graph.' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(node order by node->>'label'),'[]'::jsonb) into v_nodes
  from (
    select distinct jsonb_build_object('id',deal_record_type||':'||deal_record_key,
      'record_type',deal_record_type,'record_key',deal_record_key,'kind','deal','label',deal_label) as node
    from public.company_relationship_graph
    where company_id=p_company_id and effective_from<=v_date and (effective_to is null or effective_to>=v_date)
    union all
    select distinct jsonb_build_object('id',party_record_type||':'||party_record_key,
      'record_type',party_record_type,'record_key',party_record_key,'kind','person','label',party_label) as node
    from public.company_relationship_graph
    where company_id=p_company_id and effective_from<=v_date and (effective_to is null or effective_to>=v_date)
  ) nodes;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',relationship_id,'source',deal_record_type||':'||deal_record_key,
    'target',party_record_type||':'||party_record_key,'role',role_code,
    'responsibility',responsibility_code,'authority_scope',authority_scope,
    'verification_state',verification_state,'effective_from',effective_from,
    'effective_to',effective_to,'evidence_record_key',evidence_record_key,
    'evidence_label',evidence_label,'updated_at',updated_at
  ) order by updated_at desc,relationship_id),'[]'::jsonb) into v_edges
  from public.company_relationship_graph
  where company_id=p_company_id and effective_from<=v_date and (effective_to is null or effective_to>=v_date);
  select jsonb_build_object(
    'relationship_count',count(*),
    'verified_count',count(*) filter(where verification_state='verified'),
    'evidence_supported_count',count(*) filter(where verification_state='evidence_supported'),
    'unverified_count',count(*) filter(where verification_state in ('unverified','claimed')),
    'disputed_count',count(*) filter(where verification_state in ('disputed','rejected'))
  ) into v_counts
  from public.company_relationship_graph
  where company_id=p_company_id and effective_from<=v_date and (effective_to is null or effective_to>=v_date);
  return jsonb_build_object('company_id',p_company_id,'as_of_date',v_date,
    'nodes',v_nodes,'edges',v_edges,'counts',coalesce(v_counts,'{}'::jsonb));
end;
$graph$;

revoke all on function public.get_company_relationship_graph(uuid,date) from public,anon;
grant execute on function public.get_company_relationship_graph(uuid,date) to authenticated;
comment on view public.company_relationship_graph is
  'E17 safe security-invoker projection of E16 deal-party links. Labels only; no contact payloads or identity secrets.';
comment on function public.get_company_relationship_graph(uuid,date) is
  'E17 returns nodes, explicit party edges and verification counts as of a date. Does not infer relationships or merge identities.';
commit;
