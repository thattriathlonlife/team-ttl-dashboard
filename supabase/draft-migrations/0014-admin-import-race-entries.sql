-- 0014 — Admin race-entry import RPC (Team Ops merge on-ramp).
-- Applied to production 2026-11-13 (run 70) with the Team Ops build.
--
-- race_entries RLS ("Manage own entries") only lets a member write their
-- own rows, so bulk-importing another system's start lines needs a
-- guarded definer function. Gate: caller must have profiles.role='admin'.
-- Idempotent: existing (race_id, athlete_id) pairs are skipped, bad rows
-- are counted as errors without aborting the batch. Batch cap 1000.
create or replace function public.admin_import_race_entries(p_entries jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec jsonb;
  v_inserted int := 0;
  v_skipped int := 0;
  v_errors int := 0;
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;
  if jsonb_array_length(p_entries) > 1000 then
    raise exception 'batch too large (max 1000)';
  end if;
  for v_rec in select * from jsonb_array_elements(p_entries) loop
    begin
      insert into race_entries (race_id, athlete_id)
      select (v_rec->>'race_id')::uuid, (v_rec->>'athlete_id')::uuid
      where not exists (
        select 1 from race_entries
        where race_id = (v_rec->>'race_id')::uuid
          and athlete_id = (v_rec->>'athlete_id')::uuid
      );
      if found then
        v_inserted := v_inserted + 1;
      else
        v_skipped := v_skipped + 1;
      end if;
    exception when others then
      v_errors := v_errors + 1;
    end;
  end loop;
  return jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped, 'errors', v_errors);
end;
$$;

revoke all on function public.admin_import_race_entries(jsonb) from public;
grant execute on function public.admin_import_race_entries(jsonb) to authenticated;
