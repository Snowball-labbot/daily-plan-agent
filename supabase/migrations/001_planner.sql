create table if not exists public.planner_schema_versions (version integer primary key, applied_at timestamptz not null default now());
create table if not exists public.planner_states (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{"settings":{},"tables":{}}',
  revision bigint not null default 0, updated_at timestamptz not null default now()
);
create table if not exists public.planner_operations (
  owner_id uuid references auth.users(id) on delete cascade, operation_id uuid,
  result jsonb not null, created_at timestamptz not null default now(), primary key(owner_id, operation_id)
);
create table if not exists public.planner_imports (
  owner_id uuid references auth.users(id) on delete cascade, source_id text, checksum text,
  report jsonb not null, imported_at timestamptz not null default now(), primary key(owner_id,source_id,checksum)
);
create table if not exists public.planner_jobs (
  id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade,
  request jsonb not null, run jsonb not null, phase text not null default 'queued',
  error text, workflow_id text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.planner_states enable row level security;
alter table public.planner_operations enable row level security;
alter table public.planner_imports enable row level security;
alter table public.planner_jobs enable row level security;
create policy own_state on public.planner_states for select to authenticated using(auth.uid()=owner_id);
create policy own_operations on public.planner_operations for select to authenticated using(auth.uid()=owner_id);
create policy own_imports on public.planner_imports for select to authenticated using(auth.uid()=owner_id);
create policy own_jobs on public.planner_jobs for select to authenticated using(auth.uid()=owner_id);
revoke insert,update,delete on public.planner_states, public.planner_operations, public.planner_imports, public.planner_jobs from anon, authenticated;

create or replace function public.commit_planner_state(p_owner uuid,p_data jsonb,p_expected bigint,p_operation uuid,p_result jsonb,p_import jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare existing jsonb; current_revision bigint;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'server only'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
  select result into existing from planner_operations where owner_id=p_owner and operation_id=p_operation;
  if found then return existing; end if;
  insert into planner_states(owner_id,data) values(p_owner,'{"settings":{},"tables":{}}') on conflict do nothing;
  select revision into current_revision from planner_states where owner_id=p_owner for update;
  if current_revision<>p_expected then raise exception 'revision-conflict' using errcode='40001'; end if;
  update planner_states set data=p_data,revision=revision+1,updated_at=now() where owner_id=p_owner;
  existing=jsonb_build_object('revision',current_revision+1,'response',p_result);
  insert into planner_operations(owner_id,operation_id,result) values(p_owner,p_operation,existing);
  if p_import is not null then
    insert into planner_imports(owner_id,source_id,checksum,report) values(p_owner,p_import->>'sourceId',p_import->>'checksum',p_import->'report') on conflict do nothing;
  end if;
  return existing;
end $$;
revoke all on function public.commit_planner_state(uuid,jsonb,bigint,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.commit_planner_state(uuid,jsonb,bigint,uuid,jsonb,jsonb) to service_role;
insert into public.planner_schema_versions(version) values(1) on conflict do nothing;
