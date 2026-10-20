-- RepoScope — live run progress (Phase 7).
--
-- Progress is published by the database, not polled by the browser. The stage a
-- run has reached and the sentence describing it are already written to
-- `analyses`; this migration adds a trigger that re-sends exactly those two
-- facts — plus the status, so a page knows when to stop waiting — to a channel
-- named for the run. It never publishes the whole row: the page has nothing to
-- filter and nothing to interpret.
--
-- Two pieces belong together here, and the phase names both:
--
--   1. The channel pattern is declared in the migration, next to the tables. A
--      policy on `realtime.messages` is what makes `analysis:*` a channel that
--      may be joined at all. Without it the subscription is refused, the socket
--      opens to nothing, and the symptom is a progress page that never updates.
--
--   2. Who may join is the same policy's predicate. A run's channel is readable
--      by the organization that owns the row and by nobody else, for exactly the
--      same reason its row is.
--
-- The trigger sits on our own table. Nothing here attaches a trigger to the
-- realtime machinery, which is the database's, not ours.

-- The parse's framework name and its repository root directory, recorded so a
-- stored analysis can be reconstructed into the same shape the parser produced.
alter table public.analyses
  add column if not exists adapter text,
  add column if not exists root    text;

-- Publishing the stage and its message. `realtime.send` writes into
-- `realtime.messages`, which the replication slot streams to every subscriber of
-- the topic. When nobody is connected the insert is dropped with a warning (the
-- message would have reached no one anyway), so a broadcast can never fail a run.
create or replace function public.analyses_broadcast_progress()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'stage',   new.stage,
      'message', new.stage_message,
      'status',  new.status
    ),
    'progress',
    'analysis:' || new.id::text,
    true
  );
  return null;
end;
$$;

drop trigger if exists analyses_broadcast_progress on public.analyses;
create trigger analyses_broadcast_progress
after insert or update on public.analyses
for each row
execute function public.analyses_broadcast_progress();

-- The channel pattern, declared here. A per-analysis channel is named
-- `analysis:<uuid>`; this policy makes exactly those topics subscribable, and
-- only to a member of the organization that owns the run. `realtime.topic()` is
-- the topic the connecting client asked for, so the predicate can read the id
-- back out of it.
drop policy if exists "progress reaches the run's own organization" on realtime.messages;
create policy "progress reaches the run's own organization" on realtime.messages
  for select to authenticated
  using (
    realtime.topic() like 'analysis:%'
    and exists (
      select 1
      from public.analyses a
      where 'analysis:' || a.id::text = realtime.topic()
        and a.organization_id =
          (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id'))
    )
  );
