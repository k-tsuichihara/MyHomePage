-- review8: dev-sandbox ONLY. Not executed. Verify project, live definitions and retry backends first.
-- Six existing functions only; no tables, data, policies or grants recreated.
BEGIN;
create or replace function public.memo_save(
 p_id uuid, p_title text, p_body text, p_tag_ids uuid[],
 p_expected_revision bigint, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_row public.memos%rowtype;
 v_payload jsonb; v_hash text; v_prev public.memo_requests%rowtype; v_result jsonb;
begin
 if v_uid is null then raise exception 'unauthenticated' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text, 911));
 if p_id is null or p_request_id is null or p_tag_ids is null or p_title is null or p_body is null
    or (p_expected_revision is not null and (p_expected_revision < 1 or p_expected_revision > 9007199254740991))
    or coalesce(array_ndims(p_tag_ids),1)<>1 then
   raise exception 'invalid argument' using errcode='22023'; end if;
 if exists(select 1 from unnest(p_tag_ids) x where x is null) or exists(select 1 from unnest(p_tag_ids) x group by x having count(*)>1) then
   raise exception 'duplicate tag id' using errcode='22023'; end if;
 v_payload := pg_catalog.jsonb_build_object('title',p_title,'body',p_body,
    'tagIds',(select coalesce(pg_catalog.jsonb_agg(x order by x), '[]'::jsonb) from unnest(p_tag_ids) x),
    'expectedRevision',p_expected_revision);
 v_hash := encode(extensions.digest(pg_catalog.convert_to(v_uid::text || ':' || p_request_id::text || ':save:' || p_id::text || ':' || v_payload::text, 'UTF8'),'sha256'),'hex');
 select * into v_prev from public.memo_requests where user_id=v_uid and request_id=p_request_id;
 if found then
   if v_prev.memo_id<>p_id or v_prev.operation<>'save' or v_prev.payload_hash<>v_hash then
     raise exception 'request id reused with different operation or content' using errcode='22023'; end if;
   if v_prev.deleted_redacted then return pg_catalog.jsonb_build_object('status','previously-applied-deleted'); end if;
   return v_prev.result; -- historical result, not proof of current state
 end if;
 if exists(select 1 from unnest(p_tag_ids) x where not exists
     (select 1 from public.tags t where t.id=x and t.user_id=v_uid)) then
   raise exception 'unknown tag' using errcode='22023'; end if;
 if not public.memo_valid_text(p_title,'title') or not public.memo_valid_text(p_body,'body') then raise exception 'invalid memo content' using errcode='22023'; end if;
 if p_expected_revision is null then
   insert into public.memo_id_registry(user_id,memo_id) values(v_uid,p_id)
   on conflict do nothing;
   if not found then raise exception 'previously used memo id' using errcode='PT409'; end if;
   insert into public.memos(id,user_id,title,body,last_request_id)
     values(p_id,v_uid,p_title,p_body,p_request_id) returning * into v_row;
 else
   select * into v_row from public.memos where id=p_id and user_id=v_uid for update;
   if not found then raise exception 'memo not found' using errcode='P0002'; end if;
   if v_row.revision<>p_expected_revision or v_row.deleted_at is not null then
     raise exception 'memo revision conflict' using errcode='PT409'; end if;
   update public.memos set title=p_title,body=p_body,revision=revision+1,
     updated_at=now(),last_request_id=p_request_id
     where id=p_id and user_id=v_uid returning * into v_row;
 end if;
 delete from public.memo_tags where user_id=v_uid and memo_id=p_id;
 insert into public.memo_tags(user_id,memo_id,tag_id)
   select v_uid,p_id,x from unnest(p_tag_ids) x;
 v_result:=pg_catalog.jsonb_build_object('memo',pg_catalog.to_jsonb(v_row),
   'tagIds',(select coalesce(pg_catalog.jsonb_agg(x order by x),'[]'::jsonb) from unnest(p_tag_ids) x));
 insert into public.memo_requests(user_id,request_id,memo_id,operation,payload_hash,result)
 values(v_uid,p_request_id,p_id,'save',v_hash,v_result);
 return v_result;
end; $$;


create or replace function public.memo_change_state(
 p_id uuid,p_expected_revision bigint,p_request_id uuid,p_action text
) returns public.memos language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_row public.memos%rowtype;
 v_prev public.memo_requests%rowtype; v_payload jsonb; v_hash text;
begin
 if v_uid is null then raise exception 'unauthenticated' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text, 911));
 if p_id is null or p_request_id is null or p_expected_revision is null or p_expected_revision < 1 or p_expected_revision > 9007199254740991 or p_action is null or p_action not in ('pin','unpin','trash','restore') then
   raise exception 'invalid argument' using errcode='22023'; end if;
 v_payload:=pg_catalog.jsonb_build_object('expectedRevision',p_expected_revision);
 v_hash := encode(extensions.digest(pg_catalog.convert_to(v_uid::text || ':' || p_request_id::text || ':' || p_action || ':' || p_id::text || ':' || v_payload::text, 'UTF8'),'sha256'),'hex');
 select * into v_prev from public.memo_requests where user_id=v_uid and request_id=p_request_id;
 if found then
   if v_prev.memo_id<>p_id or v_prev.operation<>p_action or v_prev.payload_hash<>v_hash then
     raise exception 'request id reused with different operation or content' using errcode='22023'; end if;
   if v_prev.deleted_redacted then raise exception 'previously applied, memo deleted' using errcode='P0002'; end if;
   return pg_catalog.jsonb_populate_record(null::public.memos,v_prev.result);
 end if;
 select * into v_row from public.memos where id=p_id and user_id=v_uid for update;
 if not found then raise exception 'memo not found' using errcode='P0002'; end if;
 if v_row.revision<>p_expected_revision then raise exception 'revision conflict' using errcode='PT409'; end if;
 if (p_action in ('pin','unpin','trash') and v_row.deleted_at is not null)
    or (p_action='restore' and v_row.deleted_at is null) then
   raise exception 'invalid memo state' using errcode='22023'; end if;
 update public.memos set
   pinned_at=case when p_action='pin' then now() when p_action='unpin' then null else pinned_at end,
   deleted_at=case when p_action='trash' then now() when p_action='restore' then null else deleted_at end,
   updated_at=now(),revision=revision+1,last_request_id=p_request_id
 where id=p_id and user_id=v_uid returning * into v_row;
 insert into public.memo_requests(user_id,request_id,memo_id,operation,payload_hash,result)
 values(v_uid,p_request_id,p_id,p_action,v_hash,pg_catalog.to_jsonb(v_row));
 return v_row;
end; $$;


create or replace function public.memo_delete_permanently(p_id uuid,p_expected_revision bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
 if v_uid is null then raise exception 'unauthenticated' using errcode='42501'; end if;
 if p_id is null or p_expected_revision is null or p_expected_revision<1 or p_expected_revision>9007199254740991 then raise exception 'invalid argument' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text, 911));
 delete from public.memos where id=p_id and user_id=v_uid
  and deleted_at is not null and revision=p_expected_revision;
 if not found then raise exception 'not found or revision conflict' using errcode='PT409'; end if;
 update public.memo_requests set result=null,deleted_redacted=true
 where user_id=v_uid and memo_id=p_id;
end; $$;


create or replace function public.memo_empty_trash(p_ids uuid[],p_revisions bigint[])
returns integer language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_count integer; v_expected integer;
begin
 if v_uid is null then raise exception 'unauthenticated' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text, 911));
 if p_ids is null or p_revisions is null or coalesce(array_ndims(p_ids),1)<>1
    or coalesce(array_ndims(p_revisions),1)<>1 then
   raise exception 'invalid snapshot dimensions' using errcode='22023'; end if;
 if cardinality(p_ids)<>cardinality(p_revisions)
    or array_position(p_ids,null) is not null or array_position(p_revisions,null) is not null
    or exists(select 1 from unnest(p_revisions) r where r<1 or r>9007199254740991) then
   raise exception 'invalid snapshot values' using errcode='22023'; end if;
 -- All memo RPCs take the same per-user advisory transaction lock.
 select count(*) into v_count from public.memos where user_id=v_uid and deleted_at is not null;
 v_expected := coalesce(array_length(p_ids,1),0);
 if v_count<>v_expected or v_expected<>(select count(distinct x) from unnest(p_ids) x) then
   raise exception 'trash snapshot conflict' using errcode='PT409'; end if;
 if exists(
   select 1 from unnest(p_ids,p_revisions) a(id,rev)
   where not exists(select 1 from public.memos m where m.id=a.id and m.user_id=v_uid
                    and m.deleted_at is not null and m.revision=a.rev)
 ) then raise exception 'trash revision conflict' using errcode='PT409'; end if;
 update public.memo_requests set result=null,deleted_redacted=true
 where user_id=v_uid and memo_id=any(p_ids);
 delete from public.memos where user_id=v_uid and deleted_at is not null;
 return v_count;
end; $$;


create or replace function public.memo_save_tag(p_id uuid,p_name text,p_expected_revision bigint)
returns public.tags language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_row public.tags%rowtype;
begin
 if v_uid is null then raise exception 'unauthenticated' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text, 911));
 if p_id is null or not coalesce(public.memo_valid_text(p_name,'tag'),false) or (p_expected_revision is not null and
    (p_expected_revision<1 or p_expected_revision>9007199254740991)) then
    raise exception 'invalid tag input' using errcode='22023'; end if;
 if p_expected_revision is null then
   insert into public.tags(id,user_id,name) values(p_id,v_uid,p_name)
   returning * into v_row;
 else
   update public.tags set name=p_name,revision=revision+1
   where id=p_id and user_id=v_uid and revision=p_expected_revision returning * into v_row;
   if not found then raise exception 'tag revision conflict' using errcode='PT409'; end if;
 end if;
 return v_row;
end; $$;


create or replace function public.memo_delete_tag(p_id uuid,p_expected_revision bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
 if v_uid is null then raise exception 'unauthenticated' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text, 911));
 if p_id is null or p_expected_revision is null or p_expected_revision<1 or p_expected_revision>9007199254740991 then
   raise exception 'invalid argument' using errcode='22023'; end if;
 -- Related memos must advance their revisions before FK cascade removes links.
 update public.memos m set revision=m.revision+1, updated_at=now(), last_request_id=null
 where m.user_id=v_uid and exists
   (select 1 from public.memo_tags mt where mt.user_id=v_uid and mt.memo_id=m.id and mt.tag_id=p_id);
 delete from public.tags where id=p_id and user_id=v_uid and revision=p_expected_revision;
 if not found then raise exception 'tag revision conflict' using errcode='PT409'; end if;
end; $$;


COMMIT;

