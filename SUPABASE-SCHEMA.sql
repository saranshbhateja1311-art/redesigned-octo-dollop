-- APEX OS independent cloud snapshot schema.
-- Run this only inside the NEW APEX OS Supabase project, not the JEE OS project.

create table if not exists public.apex_cloud_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 1500000),
  version bigint not null default 1 check (version >= 1),
  client_updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.apex_cloud_state enable row level security;
revoke all on table public.apex_cloud_state from anon, authenticated;
grant select, insert, update, delete on table public.apex_cloud_state to authenticated;

drop policy if exists apex_cloud_state_select on public.apex_cloud_state;
drop policy if exists apex_cloud_state_insert on public.apex_cloud_state;
drop policy if exists apex_cloud_state_update on public.apex_cloud_state;
drop policy if exists apex_cloud_state_delete on public.apex_cloud_state;

create policy apex_cloud_state_select on public.apex_cloud_state
  for select to authenticated using ((select auth.uid()) = user_id);
create policy apex_cloud_state_insert on public.apex_cloud_state
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy apex_cloud_state_update on public.apex_cloud_state
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy apex_cloud_state_delete on public.apex_cloud_state
  for delete to authenticated using ((select auth.uid()) = user_id);

create or replace function public.apex_cloud_state_touch()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  new.server_updated_at = now();
  if tg_op = 'UPDATE' then new.version = old.version + 1; else new.version = 1; end if;
  return new;
end;
$$;

drop trigger if exists apex_cloud_state_touch_trigger on public.apex_cloud_state;
create trigger apex_cloud_state_touch_trigger
  before insert or update on public.apex_cloud_state
  for each row execute function public.apex_cloud_state_touch();

-- Enable Realtime for public.apex_cloud_state in the Supabase dashboard if cross-device
-- instant refresh is desired. RLS still restricts each row to its owning auth.uid().


do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'apex_cloud_state'
     ) then
    alter publication supabase_realtime add table public.apex_cloud_state;
  end if;
end $$;
