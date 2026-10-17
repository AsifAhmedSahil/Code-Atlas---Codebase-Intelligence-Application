-- Cartograph - explanations become a keyed cache (Phase 10).
--
-- The initial schema held an explanation with a uuid subject, which fits a file
-- or a route but not a folded folder whose id is a path like "src/app". Phase 10
-- also needs the explanation to be a *cache*: looked up by the content it was
-- written from, so a file that has not changed is never sent to the model twice,
-- and by the pinned model and prompt version, so re-pinning invalidates only
-- that model's own rows.
--
-- Everything here is additive. The three seeded rows keep their defaults and
-- the existing policies are untouched.

-- A subject is now named by path or folder id, both text. No column references
-- subject_id, so the widening cast is lossless and safe.
alter table public.explanations
  alter column subject_id type text using subject_id::text;

-- The cache key's other halves. Defaulted so the rows written before this
-- migration stay valid; a defaulted row simply never matches a live lookup.
alter table public.explanations
  add column if not exists content_hash   text not null default '',
  add column if not exists model          text not null default '',
  add column if not exists prompt_version text not null default '';

-- "folder" joins the subject kinds. The constraint is replaced rather than
-- dropped so a subject kind outside the known set is still refused.
alter table public.explanations
  drop constraint if exists explanations_subject_kind_check;
alter table public.explanations
  add constraint explanations_subject_kind_check
  check (subject_kind in ('file', 'folder', 'project', 'route'));

-- The lookup the cache performs. One row per (analysis, subject, content, model,
-- prompt version): the same content explained by the same model is written once.
create unique index if not exists explanations_cache_key_idx
  on public.explanations (analysis_id, subject_kind, subject_id, model, prompt_version, content_hash);

-- Where a role came from. The parser and the framework adapters write 'adapter';
-- a role the model assigned to a file no adapter claimed is 'ai', so an
-- assigned role never reads as one a rule decided.
alter table public.file_roles
  add column if not exists source text not null default 'adapter';
alter table public.file_roles
  drop constraint if exists file_roles_source_check;
alter table public.file_roles
  add constraint file_roles_source_check
  check (source in ('adapter', 'ai'));
