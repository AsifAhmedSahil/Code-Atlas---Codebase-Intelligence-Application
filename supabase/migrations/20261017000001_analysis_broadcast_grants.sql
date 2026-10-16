-- Cartograph — close the trigger function's public grant (Phase 7 follow-up).
--
-- `analyses_broadcast_progress` is a trigger function. It is invoked by the
-- database when a row changes, never by a client, so nobody needs EXECUTE on it
-- through the API. Postgres defaults new functions to EXECUTE for `public`,
-- which the linter rightly flags: the function is `security definer`, and being
-- callable at `/rest/v1/rpc/analyses_broadcast_progress` is a door that should
-- not be open.
--
-- Revoking the grant does not stop the trigger from firing. A trigger function
-- is called by the system and is not subject to EXECUTE checks, so progress
-- keeps publishing exactly as before.

revoke execute on function public.analyses_broadcast_progress()
  from public, anon, authenticated;
