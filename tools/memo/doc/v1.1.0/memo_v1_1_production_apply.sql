-- v1.1.0 本番新規導入SQL / REVIEW ONLY / 未実行
-- 実行にはk-life-logのProject Refを管理画面で照合し、対象・時間枠・実行者の個別承認が必要。
-- SQL自身はSupabase projectを識別しない。既存メモオブジェクトが一つでもあれば停止。
-- 読書管理reading_*、既存Authユーザー、既存データ、ロール/default ACLは変更しない。
-- seedなし・自動再試行なし・失敗時は同じtransaction全体をROLLBACK。途中から再開しない。
-- 全体を1セッションで実行。エラー後は明示ROLLBACKし、結果確認まで再実行しない。
-- pgcrypto/配置/権限が不足すれば停止。自動作成・移設・権限補完はしない。
-- 他のDDL/権限変更と同時実行しない。COMMIT後の復旧は別途承認。
-- source: tools/memo/doc/v1.1.0/memo_v1_1_schema_review8.sql SHA256=62e3e1ff82d01cba848603901a3bc136ad474e8da98c8339f401525664d0debd
-- source: tools/memo/doc/v1.1.0/memo_v1_1_conflict_patch_review8.sql SHA256=e83326902218dfcd306e20d0d03b634b58fe9f4d51fd3ec618b4cde6cb007cf9
-- source: tools/memo/tests/db-audit/s04-helper-execute.sql SHA256=dec172695cd42c517f1b81a5102271212f622edfef6c06c1ab0670d5ed68f730

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '3s';
DO $preflight$
DECLARE
  object_names constant text[] := ARRAY['memos','memo_id_registry','memo_requests','tags','memo_tags','tags_name_per_user','memos_owner_updated','memos_owner_trash','memo_tags_owner_tag','memo_edge_spaces','memo_trim_edges','memo_valid_text','memo_tag_key','memo_load_snapshot','memo_save','memo_resolve_request','memo_change_state','memo_delete_permanently','memo_empty_trash','memo_save_tag','memo_delete_tag'];
  ext_oid oid;
  digest_oid oid;
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer / 10000 <> 17
     OR pg_catalog.current_setting('server_encoding') <> 'UTF8' THEN
    RAISE EXCEPTION 'memo preflight: expected PostgreSQL 17 / UTF8';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=ANY(object_names))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=ANY(object_names))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname='public' AND t.typname=ANY(object_names)) THEN
    RAISE EXCEPTION 'memo preflight: existing target name; no replacement permitted';
  END IF;
  IF pg_catalog.to_regclass('auth.users') IS NULL OR pg_catalog.to_regprocedure('auth.uid()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='anon')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='authenticated') THEN
    RAISE EXCEPTION 'memo preflight: Supabase prerequisites missing';
  END IF;
  SELECT e.oid INTO ext_oid FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace
    WHERE e.extname='pgcrypto' AND n.nspname='extensions';
  digest_oid := pg_catalog.to_regprocedure('extensions.digest(bytea,text)');
  IF ext_oid IS NULL OR digest_oid IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_proc'::regclass
        AND d.objid=digest_oid AND d.refclassid='pg_catalog.pg_extension'::regclass
        AND d.refobjid=ext_oid AND d.deptype='e') THEN
    RAISE EXCEPTION 'memo preflight: pgcrypto/digest placement mismatch';
  END IF;
  IF NOT pg_catalog.has_schema_privilege(current_user,'public','USAGE')
     OR NOT pg_catalog.has_schema_privilege(current_user,'public','CREATE')
     OR NOT pg_catalog.has_schema_privilege(current_user,'extensions','USAGE')
     OR NOT pg_catalog.has_function_privilege(current_user,digest_oid,'EXECUTE')
     OR NOT pg_catalog.has_schema_privilege(current_user,'auth','USAGE')
     OR NOT pg_catalog.has_function_privilege(current_user,'auth.uid()','EXECUTE')
     OR NOT pg_catalog.has_table_privilege(current_user,'auth.users','REFERENCES') THEN
    RAISE EXCEPTION 'memo preflight: privilege missing; no automatic grant';
  END IF;
END;
$preflight$;

-- 1. 検証済み基礎schema（本文そのまま）
-- Shared Unicode input contract. PostgreSQL ascii() returns Unicode code points for UTF-8.
-- Explicit ECMAScript-trim whitespace set; no locale-dependent lower() or regex classes.
create function public.memo_edge_spaces() returns text
language sql immutable parallel safe set search_path = '' as $$
 select chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)
 || (select string_agg(chr(i),'' order by i) from generate_series(8192,8202) i)
 || chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279)
$$;
create function public.memo_trim_edges(s text) returns text
language sql immutable parallel safe set search_path = '' as $$
 select pg_catalog.btrim(s, public.memo_edge_spaces())
$$;
create function public.memo_valid_text(s text, field text) returns boolean
language plpgsql immutable parallel safe set search_path = '' as $$
declare cp integer; i integer; n integer;
begin
 if s is null or field is null or field not in ('title','body','tag') then return false; end if;
 n := char_length(s);
 if (field='title' and (n<1 or n>100 or s<>public.memo_trim_edges(s)))
 or (field='tag' and (n<1 or n>30 or s<>public.memo_trim_edges(s)))
 or (field='body' and n>10000) then return false; end if;
 for i in 1..n loop
   cp := ascii(substr(s,i,1));
   if cp between 127 and 159 or
     (field in ('title','tag') and cp in (8232,8233)) or
     (cp between 0 and 31 and not (field='body' and cp in (9,10))) then
     return false;
   end if;
 end loop;
 return true;
end; $$;
create function public.memo_tag_key(s text) returns text
language sql immutable parallel safe set search_path = '' as $$
 select pg_catalog.translate(s collate "C",
   'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz') collate "C"
$$;

create table public.memos (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 title text not null, body text not null default '',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 pinned_at timestamptz, deleted_at timestamptz,
 revision bigint not null default 1 check (revision between 1 and 9007199254740991), last_request_id uuid,
 constraint memo_title_check check (public.memo_valid_text(title,'title')),
 constraint memo_body_check check (public.memo_valid_text(body,'body')),
 unique(user_id,id)
);
-- Durable tombstones + idempotency ledger. Keep these rows after permanent memo deletion.
create table public.memo_id_registry (
 user_id uuid not null references auth.users(id) on delete cascade,
 memo_id uuid not null, primary key(user_id,memo_id)
);
create table public.memo_requests (
 user_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null, memo_id uuid not null,
 operation text not null, payload_hash text not null, result jsonb, deleted_redacted boolean not null default false,
 primary key(user_id,request_id)
);
create table public.tags (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 name text not null, created_at timestamptz not null default now(),
 revision bigint not null default 1 check (revision between 1 and 9007199254740991),
 constraint tag_name_check check (public.memo_valid_text(name,'tag')),
 unique(user_id,id)
);
create unique index tags_name_per_user on public.tags(user_id,(public.memo_tag_key(name) collate "C"));
create table public.memo_tags (
 user_id uuid not null references auth.users(id) on delete cascade,
 memo_id uuid not null, tag_id uuid not null,
 primary key(memo_id,tag_id),
 foreign key(user_id,memo_id) references public.memos(user_id,id) on delete cascade,
 foreign key(user_id,tag_id) references public.tags(user_id,id) on delete cascade
);
create index memos_owner_updated on public.memos(user_id,updated_at desc);
create index memos_owner_trash on public.memos(user_id,deleted_at);
create index memo_tags_owner_tag on public.memo_tags(user_id,tag_id);

alter table public.memo_id_registry enable row level security;
alter table public.memo_requests enable row level security;
-- Internal-only ledger/registry; do not grant client SELECT or DML.
alter table public.memos enable row level security;
alter table public.tags enable row level security;
alter table public.memo_tags enable row level security;
create policy memos_read on public.memos for select to authenticated using (user_id = (select auth.uid()));
create policy tags_read on public.tags for select to authenticated using (user_id = (select auth.uid()));
create policy memo_tags_read on public.memo_tags for select to authenticated using (user_id = (select auth.uid()));
-- Direct DML is prohibited; only explicit authenticated RPCs mutate data.
revoke all on public.memos, public.tags, public.memo_tags, public.memo_id_registry, public.memo_requests from public, anon, authenticated;
grant select on public.memos, public.tags, public.memo_tags to authenticated;

-- One request_id maps to exactly one operation and payload, including ordered tag set.
-- Registry remains after permanent deletion: retrying create can never resurrect a memo.
-- RPC returns atomic JSON snapshot of memo and tag IDs; not a mixed follow-up SELECT.
create function public.memo_save(
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

-- Query the durable request result even after permanent deletion.
-- Caller compares result.memo + result.tagIds to immutable submitted draft.
create function public.memo_resolve_request(
 p_id uuid, p_request_id uuid, p_title text, p_body text,
 p_tag_ids uuid[], p_expected_revision bigint
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid:=auth.uid(); v public.memo_requests%rowtype;
 v_payload jsonb; v_hash text;
begin
 if v_uid is null then raise exception 'unauthenticated' using errcode='42501'; end if;
 if p_id is null or p_request_id is null or p_title is null or p_body is null or p_tag_ids is null
    or (p_expected_revision is not null and (p_expected_revision<1 or p_expected_revision>9007199254740991))
    or coalesce(array_ndims(p_tag_ids),1)<>1 then
    raise exception 'invalid argument' using errcode='22023'; end if;
 if exists(select 1 from unnest(p_tag_ids) x where x is null)
    or exists(select 1 from unnest(p_tag_ids) x group by x having count(*)>1) then
    raise exception 'invalid tag ids' using errcode='22023'; end if;
 v_payload:=pg_catalog.jsonb_build_object('title',p_title,'body',p_body,
    'tagIds',(select coalesce(pg_catalog.jsonb_agg(x order by x),'[]'::jsonb) from unnest(p_tag_ids) x),
    'expectedRevision',p_expected_revision);
 v_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    v_uid::text || ':' || p_request_id::text || ':save:' || p_id::text || ':' || v_payload::text,
    'UTF8'),'sha256'),'hex');
 select * into v from public.memo_requests where user_id=v_uid and request_id=p_request_id;
 if not found then return null; end if; -- Not proof of non-execution.
 if v.memo_id<>p_id or v.operation<>'save' or v.payload_hash<>v_hash then
   raise exception 'request mismatch' using errcode='22023'; end if;
 if v.deleted_redacted then
   return pg_catalog.jsonb_build_object('status','previously-applied-deleted');
 end if;
 return pg_catalog.jsonb_build_object('status','saved','result',v.result);
end; $$;

-- Generic state transition, never changes text or tags. p_action: pin/unpin/trash/restore.
create function public.memo_change_state(
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

create function public.memo_delete_permanently(p_id uuid,p_expected_revision bigint)
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

-- Empty trash is atomic and protects against concurrent restore/additions.
-- Caller supplies exact trash snapshot with matching revisions; locking serializes with state changes.
create function public.memo_empty_trash(p_ids uuid[],p_revisions bigint[])
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

-- Tags: create/rename/delete with revision guards. Foreign keys cascade tag deletion.
create function public.memo_save_tag(p_id uuid,p_name text,p_expected_revision bigint)
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
create function public.memo_delete_tag(p_id uuid,p_expected_revision bigint)
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


-- One statement snapshot for initial load; includes trashed memo relations for restore.
create function public.memo_load_snapshot() returns jsonb
language sql security definer set search_path = '' stable as $$
 select case when auth.uid() is null then null else pg_catalog.jsonb_build_object(
   'memos',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(m) order by m.created_at,m.id)
      from public.memos m where m.user_id=auth.uid()),'[]'::jsonb),
   'tags',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) order by t.created_at,t.id)
      from public.tags t where t.user_id=auth.uid()),'[]'::jsonb),
   'memoTags',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(mt) order by mt.memo_id,mt.tag_id)
      from public.memo_tags mt where mt.user_id=auth.uid()),'[]'::jsonb)) end;
$$;
-- SQL STABLE statement snapshot is expected; verify with concurrent-session test.

-- Per-user advisory transaction lock serializes memo RPC mutations and empty-trash.
-- Test with real Supabase RLS/GRANT and concurrent sessions before production.
-- This file is a review proposal, not production-verified SQL.
revoke all on function public.memo_save(uuid,text,text,uuid[],bigint,uuid) from public, anon, authenticated;
revoke all on function public.memo_resolve_request(uuid,uuid,text,text,uuid[],bigint) from public, anon, authenticated;
revoke all on function public.memo_change_state(uuid,bigint,uuid,text) from public, anon, authenticated;
revoke all on function public.memo_delete_permanently(uuid,bigint) from public, anon, authenticated;
revoke all on function public.memo_empty_trash(uuid[],bigint[]) from public, anon, authenticated;
revoke all on function public.memo_save_tag(uuid,text,bigint) from public, anon, authenticated;
revoke all on function public.memo_delete_tag(uuid,bigint) from public, anon, authenticated;
grant execute on function public.memo_save(uuid,text,text,uuid[],bigint,uuid) to authenticated;
grant execute on function public.memo_resolve_request(uuid,uuid,text,text,uuid[],bigint) to authenticated;
grant execute on function public.memo_change_state(uuid,bigint,uuid,text) to authenticated;
grant execute on function public.memo_delete_permanently(uuid,bigint) to authenticated;
grant execute on function public.memo_empty_trash(uuid[],bigint[]) to authenticated;
grant execute on function public.memo_save_tag(uuid,text,bigint) to authenticated;
grant execute on function public.memo_delete_tag(uuid,bigint) to authenticated;

revoke all on function public.memo_load_snapshot() from public, anon, authenticated;
grant execute on function public.memo_load_snapshot() to authenticated;

-- REVIEW6: DB validators are drafted, NOT tested for TS/SQL parity. No cloud writes before tests.
-- REVIEW5 OPEN: Verify the bytea/JSON hash RPC and redacted receipts against real test DB.
-- REVIEW5 OPEN: Test pgcrypto extension installation and SECURITY DEFINER owner grants.
-- REVIEW5 OPEN: payload_hash is a digest, not encryption; do not claim absolute erasure.
-- REVIEW5 OPEN: deleted-redacted retry is a receipt, not a replay of full historical data.

-- 2. 検証済み6関数patch（外側BEGIN/COMMITのみ除去）
﻿-- review8: dev-sandbox ONLY. Not executed. Verify project, live definitions and retry backends first.
-- Six existing functions only; no tables, data, policies or grants recreated.
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

-- 3. 検証済みS04 DO文（そのまま）
DO $s04$
DECLARE
  helpers constant text[] := ARRAY[
    'public.memo_edge_spaces()',
    'public.memo_trim_edges(pg_catalog.text)',
    'public.memo_valid_text(pg_catalog.text,pg_catalog.text)',
    'public.memo_tag_key(pg_catalog.text)'
  ];
  rpcs constant text[] := ARRAY[
    'public.memo_load_snapshot()',
    'public.memo_save(pg_catalog.uuid,pg_catalog.text,pg_catalog.text,pg_catalog.uuid[],pg_catalog.int8,pg_catalog.uuid)',
    'public.memo_resolve_request(pg_catalog.uuid,pg_catalog.uuid,pg_catalog.text,pg_catalog.text,pg_catalog.uuid[],pg_catalog.int8)',
    'public.memo_change_state(pg_catalog.uuid,pg_catalog.int8,pg_catalog.uuid,pg_catalog.text)',
    'public.memo_delete_permanently(pg_catalog.uuid,pg_catalog.int8)',
    'public.memo_empty_trash(pg_catalog.uuid[],pg_catalog.int8[])',
    'public.memo_save_tag(pg_catalog.uuid,pg_catalog.text,pg_catalog.int8)',
    'public.memo_delete_tag(pg_catalog.uuid,pg_catalog.int8)'
  ];
  signature text;
  rpc_signature text;
  helper_oid oid;
  rpc_oid oid;
  client_oid oid;
  owner_oid oid;
BEGIN
  -- 固定対象以外へ操作を広げない。DEFINER属性の変化は停止する。
  FOREACH signature IN ARRAY helpers LOOP
    helper_oid := pg_catalog.to_regprocedure(signature);
    IF helper_oid IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc WHERE oid = helper_oid AND prokind = 'f' AND NOT prosecdef
    ) THEN RAISE EXCEPTION 'S04: helper definition mismatch'; END IF;
  END LOOP;
  FOREACH signature IN ARRAY rpcs LOOP
    rpc_oid := pg_catalog.to_regprocedure(signature);
    IF rpc_oid IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc WHERE oid = rpc_oid AND prokind = 'f' AND prosecdef
    ) THEN RAISE EXCEPTION 'S04: RPC definition mismatch'; END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') OR
     NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION 'S04: client role missing';
  END IF;

  -- RESTRICTにより付与連鎖の巻き込みを拒否する。必要な権限が不足しても追加しない。
  FOREACH signature IN ARRAY helpers LOOP
    EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || signature || ' FROM PUBLIC, anon, authenticated RESTRICT';
  END LOOP;

  FOREACH signature IN ARRAY helpers LOOP
    helper_oid := pg_catalog.to_regprocedure(signature);
    -- 8 RPC ownerすべてについて十分条件を検査。全ownerが全helperを使うという意味ではない。
    FOREACH rpc_signature IN ARRAY rpcs LOOP
      rpc_oid := pg_catalog.to_regprocedure(rpc_signature);
      SELECT proowner INTO STRICT owner_oid FROM pg_catalog.pg_proc WHERE oid = rpc_oid;
      IF NOT pg_catalog.has_function_privilege(owner_oid, helper_oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'S04: RPC owner permission insufficient';
      END IF;
    END LOOP;
    FOR client_oid IN SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
      IF pg_catalog.has_function_privilege(client_oid, helper_oid, 'EXECUTE') OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles r
        WHERE pg_catalog.pg_has_role(client_oid, r.oid, 'SET')
          AND pg_catalog.has_function_privilege(r.oid, helper_oid, 'EXECUTE')
      ) THEN RAISE EXCEPTION 'S04: client permission remains'; END IF;
    END LOOP;
  END LOOP;
END;
$s04$;
-- COMMIT前の対象限定確認。ユーザーデータやRPC本体を実行しない。
DO $postflight$
DECLARE
  table_name text;
  signature text;
  client_name text;
  fn oid;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['memos','memo_id_registry','memo_requests','tags','memo_tags'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=table_name AND c.relkind='r' AND c.relrowsecurity
          AND c.relowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)) THEN
      RAISE EXCEPTION 'memo postflight: table/RLS/owner mismatch';
    END IF;
    IF table_name IN ('memos','tags','memo_tags')
       AND NOT pg_catalog.has_table_privilege('authenticated','public.'||table_name,'SELECT') THEN
      RAISE EXCEPTION 'memo postflight: authenticated read permission missing';
    END IF;
    FOREACH client_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF pg_catalog.has_table_privilege(client_name,'public.'||table_name,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
        RAISE EXCEPTION 'memo postflight: direct table mutation permission remains';
      END IF;
      IF (table_name IN ('memo_id_registry','memo_requests') OR client_name='anon')
         AND pg_catalog.has_table_privilege(client_name,'public.'||table_name,'SELECT') THEN
        RAISE EXCEPTION 'memo postflight: unexpected table read permission';
      END IF;
    END LOOP;
  END LOOP;
  FOREACH signature IN ARRAY ARRAY['public.memo_load_snapshot()','public.memo_save(uuid,text,text,uuid[],bigint,uuid)','public.memo_resolve_request(uuid,uuid,text,text,uuid[],bigint)','public.memo_change_state(uuid,bigint,uuid,text)','public.memo_delete_permanently(uuid,bigint)','public.memo_empty_trash(uuid[],bigint[])','public.memo_save_tag(uuid,text,bigint)','public.memo_delete_tag(uuid,bigint)'] LOOP
    fn := pg_catalog.to_regprocedure(signature);
    IF fn IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=fn AND p.prosecdef
        AND p.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)
        AND p.proconfig @> ARRAY['search_path=""'])
       OR NOT pg_catalog.has_function_privilege('authenticated',fn,'EXECUTE')
       OR pg_catalog.has_function_privilege('anon',fn,'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p,
           LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
           WHERE p.oid=fn AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN
      RAISE EXCEPTION 'memo postflight: RPC/owner/search_path/permission mismatch';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_catalog.pg_policy p WHERE p.polrelid=ANY(ARRAY[
      'public.memos'::regclass,'public.tags'::regclass,'public.memo_tags'::regclass])
      AND p.polname IN ('memos_read','tags_read','memo_tags_read') AND p.polcmd='r') <> 3 THEN
    RAISE EXCEPTION 'memo postflight: read policy missing';
  END IF;
END;
$postflight$;
COMMIT;
