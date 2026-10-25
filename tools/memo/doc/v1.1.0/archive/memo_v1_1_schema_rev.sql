-- Memo Tool Ver1.1.0 / reviewed Supabase PostgreSQL design
-- REVIEW ONLY: run in a test Supabase project after code review; never expose service_role key.
-- SQL constraints use char_length (PostgreSQL characters); client length checks must match.
create extension if not exists pgcrypto;

create table public.memos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  pinned_at timestamptz,
  deleted_at timestamptz,
  constraint memos_title_length check (char_length(title) between 1 and 100 and title = btrim(title)),
  constraint memos_body_length check (char_length(body) <= 10000),
  constraint memos_not_blank check (char_length(btrim(title)) > 0),
  constraint memos_owner_id_unique unique (user_id, id)
);
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  constraint tags_name_length check (char_length(name) between 1 and 30 and name = btrim(name) and char_length(name) > 0),
  constraint tags_owner_id_unique unique (user_id, id)
);
create unique index tags_user_name_ci_unique on public.tags (user_id, lower(name));
create table public.memo_tags (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  memo_id uuid not null,
  tag_id uuid not null,
  primary key (memo_id, tag_id),
  constraint memo_tags_memo_owner_fk foreign key (user_id, memo_id)
    references public.memos(user_id, id) on delete cascade,
  constraint memo_tags_tag_owner_fk foreign key (user_id, tag_id)
    references public.tags(user_id, id) on delete cascade
);
create index memos_user_updated_idx on public.memos (user_id, updated_at desc);
create index memos_user_pinned_idx on public.memos (user_id, pinned_at desc);
create index memo_tags_user_tag_idx on public.memo_tags (user_id, tag_id);

alter table public.memos enable row level security;
alter table public.tags enable row level security;
alter table public.memo_tags enable row level security;
create policy memos_select_own on public.memos for select to authenticated using (user_id = (select auth.uid()));
create policy memos_insert_own on public.memos for insert to authenticated with check (user_id = (select auth.uid()));
create policy memos_update_own on public.memos for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy memos_delete_own on public.memos for delete to authenticated using (user_id = (select auth.uid()));
create policy tags_select_own on public.tags for select to authenticated using (user_id = (select auth.uid()));
create policy tags_insert_own on public.tags for insert to authenticated with check (user_id = (select auth.uid()));
create policy tags_update_own on public.tags for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy tags_delete_own on public.tags for delete to authenticated using (user_id = (select auth.uid()));
create policy memo_tags_select_own on public.memo_tags for select to authenticated using (user_id = (select auth.uid()));
create policy memo_tags_insert_own on public.memo_tags for insert to authenticated with check (user_id = (select auth.uid()));
create policy memo_tags_update_own on public.memo_tags for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy memo_tags_delete_own on public.memo_tags for delete to authenticated using (user_id = (select auth.uid()));

-- One RPC call = one PostgreSQL transaction: memo upsert and tag replacement.
-- SECURITY INVOKER means the authenticated caller's RLS policies apply.
create function public.save_memo_with_tags(
  p_id uuid, p_title text, p_body text, p_created_at timestamptz,
  p_updated_at timestamptz, p_pinned_at timestamptz,
  p_deleted_at timestamptz, p_tag_ids uuid[]
) returns void
language plpgsql security invoker set search_path = '' as $$
declare v_user uuid := (select auth.uid());
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_tag_ids is null then raise exception 'Tag IDs required'; end if;
  if exists (select 1 from unnest(p_tag_ids) t group by t having count(*) > 1) then
    raise exception 'Duplicate tag ID';
  end if;
  if exists (
    select 1 from unnest(p_tag_ids) t
    where not exists (select 1 from public.tags x where x.id = t and x.user_id = v_user)
  ) then raise exception 'Unknown or inaccessible tag'; end if;
  insert into public.memos (id,user_id,title,body,created_at,updated_at,pinned_at,deleted_at)
  values (p_id,v_user,p_title,p_body,p_created_at,p_updated_at,p_pinned_at,p_deleted_at)
  on conflict (id) do update set
    title = excluded.title, body = excluded.body,
    updated_at = excluded.updated_at, pinned_at = excluded.pinned_at,
    deleted_at = excluded.deleted_at
  where public.memos.user_id = v_user;
  if not found then raise exception 'Memo is inaccessible'; end if;
  delete from public.memo_tags where memo_id = p_id and user_id = v_user;
  insert into public.memo_tags (user_id,memo_id,tag_id)
    select v_user,p_id,t from unnest(p_tag_ids) t;
end;
$$;
revoke all on function public.save_memo_with_tags(uuid,text,text,timestamptz,timestamptz,timestamptz,timestamptz,uuid[]) from public;
grant execute on function public.save_memo_with_tags(uuid,text,text,timestamptz,timestamptz,timestamptz,timestamptz,uuid[]) to authenticated;

-- Production follow-ups: prevent stale-write conflicts (optimistic concurrency),
-- restrict user-controlled timestamps where needed, and test RPC RLS and privileges.
-- For atomic empty-trash in cloud, add a separate authenticated RPC transaction.
