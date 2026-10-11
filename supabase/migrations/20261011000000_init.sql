-- Cartograph — initial schema.
--
-- Nine tables: a local mirror of the identity provider's organizations, and the
-- eight domain tables. Each domain row owns itself by organization through a
-- foreign key to public.organizations, so deleting an organization removes
-- everything beneath it.
--
-- Authorization is a property of the database, not a check the application
-- remembers to perform. Every table has row-level security enabled and a
-- single policy whose predicate reads the organization claim off the auth
-- token. A table with no matching row therefore returns nothing rather than
-- everything.
--
-- These tables are enabled explicitly below. Supabase additionally installs an
-- `ensure_rls` event trigger that turns RLS on for every table created in the
-- public schema, so the property holds for tables added later without a
-- migration having to remember.

create table public.organizations (
  id         text primary key,
  name       text not null,
  slug       text,
  created_at timestamptz not null default now()
);

create table public.projects (
  id              uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  name            text not null,
  repo_url        text not null,
  default_branch  text,
  created_at      timestamptz not null default now(),
  unique (organization_id, repo_url)
);

create table public.analyses (
  id              uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  project_id      uuid not null references public.projects (id) on delete cascade,
  status          text not null default 'queued'
                    check (status in ('queued', 'running', 'complete', 'failed')),
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz not null default now()
);

create table public.files (
  id              uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  analysis_id     uuid not null references public.analyses (id) on delete cascade,
  path            text not null,
  created_at      timestamptz not null default now(),
  unique (analysis_id, path)
);

create table public.edges (
  id              uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  analysis_id     uuid not null references public.analyses (id) on delete cascade,
  source_file_id  uuid not null references public.files (id) on delete cascade,
  target_file_id  uuid not null references public.files (id) on delete cascade,
  kind            text not null check (kind in ('import', 're-export', 'dynamic', 'require')),
  created_at      timestamptz not null default now()
);

create table public.routes (
  id              uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  analysis_id     uuid not null references public.analyses (id) on delete cascade,
  file_id         uuid references public.files (id) on delete cascade,
  framework       text not null,
  kind            text not null check (kind in ('page', 'api')),
  path            text not null,
  method          text,
  created_at      timestamptz not null default now()
);

create table public.explanations (
  id              uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  analysis_id     uuid not null references public.analyses (id) on delete cascade,
  subject_kind    text not null check (subject_kind in ('file', 'project', 'route')),
  subject_id      uuid not null,
  body            text not null,
  created_at      timestamptz not null default now()
);

create table public.file_roles (
  id              uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  analysis_id     uuid not null references public.analyses (id) on delete cascade,
  file_id         uuid not null references public.files (id) on delete cascade,
  role            text not null,
  created_at      timestamptz not null default now(),
  unique (analysis_id, file_id)
);

create table public.insights (
  id              uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  analysis_id     uuid not null references public.analyses (id) on delete cascade,
  file_id         uuid references public.files (id) on delete cascade,
  kind            text not null,
  title           text not null,
  detail          text,
  created_at      timestamptz not null default now()
);

-- Indexes for the organization-scoped lookups the policies and dashboard run.
create index projects_organization_id_idx on public.projects (organization_id);
create index analyses_organization_id_idx on public.analyses (organization_id);
create index analyses_project_id_idx on public.analyses (project_id);
create index files_organization_id_idx on public.files (organization_id);
create index files_analysis_id_idx on public.files (analysis_id);
create index edges_organization_id_idx on public.edges (organization_id);
create index edges_analysis_id_idx on public.edges (analysis_id);
create index routes_organization_id_idx on public.routes (organization_id);
create index routes_analysis_id_idx on public.routes (analysis_id);
create index explanations_organization_id_idx on public.explanations (organization_id);
create index explanations_analysis_id_idx on public.explanations (analysis_id);
create index file_roles_organization_id_idx on public.file_roles (organization_id);
create index file_roles_analysis_id_idx on public.file_roles (analysis_id);
create index insights_organization_id_idx on public.insights (organization_id);
create index insights_analysis_id_idx on public.insights (analysis_id);

-- Row-level security, on for every table without exception.
alter table public.organizations enable row level security;
alter table public.projects enable row level security;
alter table public.analyses enable row level security;
alter table public.files enable row level security;
alter table public.edges enable row level security;
alter table public.routes enable row level security;
alter table public.explanations enable row level security;
alter table public.file_roles enable row level security;
alter table public.insights enable row level security;

-- The predicate reads the active organization off the auth token. Clerk nests
-- it under `o.id`; the top-level `org_id` is kept as a fallback. It is wrapped
-- in a subselect so Postgres evaluates it once for the statement rather than
-- once per row.
create policy "row belongs to the active organization" on public.organizations
  for all to authenticated
  using (id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')))
  with check (id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')));

create policy "row belongs to the active organization" on public.projects
  for all to authenticated
  using (organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')))
  with check (organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')));

create policy "row belongs to the active organization" on public.analyses
  for all to authenticated
  using (organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')))
  with check (organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')));

create policy "row belongs to the active organization" on public.files
  for all to authenticated
  using (organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')))
  with check (organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')));

create policy "row belongs to the active organization" on public.edges
  for all to authenticated
  using (organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')))
  with check (organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')));

create policy "row belongs to the active organization" on public.routes
  for all to authenticated
  using (organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')))
  with check (organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')));

create policy "row belongs to the active organization" on public.explanations
  for all to authenticated
  using (organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')))
  with check (organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')));

create policy "row belongs to the active organization" on public.file_roles
  for all to authenticated
  using (organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')))
  with check (organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')));

create policy "row belongs to the active organization" on public.insights
  for all to authenticated
  using (organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')))
  with check (organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')));
