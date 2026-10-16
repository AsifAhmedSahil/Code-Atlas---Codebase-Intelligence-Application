-- Cartograph — storage for a real analysis (Phase 7).
--
-- The initial schema held only a path per file. A real parse result carries more,
-- and the stage a run has reached has to live somewhere durable, because the
-- browser is not the source of truth for progress.
--
-- Everything here is additive. The seeded rows keep their defaults, the existing
-- policies are untouched, and the new table gets the same policy as the other
-- eight: a row belongs to an organization and nothing else decides who may touch
-- it.

-- The commit the archive came from, and where a run currently is. Stage and its
-- message are updated as the run moves; error and error_stage are filled in when
-- a run fails, so a failure says which stage it failed in.
alter table public.analyses
  add column if not exists commit_sha    text,
  add column if not exists stage         text,
  add column if not exists stage_message text,
  add column if not exists error         text,
  add column if not exists error_stage   text,
  add column if not exists counts        jsonb,
  add column if not exists coverage      jsonb,
  add column if not exists updated_at    timestamptz not null default now();

-- The per-file facts the map and the pane read. All nullable or defaulted so the
-- rows seeded before this migration stay valid.
alter table public.files
  add column if not exists folder    text not null default '.',
  add column if not exists extension text,
  add column if not exists is_module boolean not null default false,
  add column if not exists bytes     integer,
  add column if not exists lines     integer,
  add column if not exists hash      text,
  add column if not exists fan_in    integer not null default 0,
  add column if not exists fan_out   integer not null default 0;

-- Files the parser skipped, with the reason. Kept as rows rather than folded into
-- the analysis so the coverage report can name them.
create table if not exists public.skipped_files (
  id              uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  analysis_id     uuid not null references public.analyses (id) on delete cascade,
  path            text not null,
  reason          text not null,
  detail          text,
  created_at      timestamptz not null default now(),
  unique (analysis_id, path)
);

create index if not exists skipped_files_organization_id_idx on public.skipped_files (organization_id);
create index if not exists skipped_files_analysis_id_idx on public.skipped_files (analysis_id);

alter table public.skipped_files enable row level security;

create policy "row belongs to the active organization" on public.skipped_files
  for all to authenticated
  using (organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')))
  with check (organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')));
