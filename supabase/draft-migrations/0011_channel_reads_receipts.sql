-- 0011_channel_reads_receipts.sql — let channel members see each
-- other's read state (the read-receipts feature), without widening
-- writes. Part of the 2026-11-06 messaging rebuild (M2a), under the
-- same "Full rebuild + Web Push now" approval. Applied 2026-11-06 via
-- the Supabase Management API.
--
-- Before: channel_reads has one ALL policy, "Manage own reads"
-- (auth.uid() = athlete_id) — you can only ever read your OWN read
-- row, so ticks and seen-by lists are impossible.
-- After: SELECT widens to read rows in channels the caller can see
-- (the 0009 visibility rule, via the channel_visible_to helper from
-- 0010) — a read timestamp inside a channel you can already read is
-- the receipts feature working, not a leak. INSERT/UPDATE/DELETE stay
-- strictly own-row, exactly as before.
-- channel_reads also joins the realtime publication so ticks update
-- live while a thread is open.

drop policy if exists "Manage own reads" on public.channel_reads;

create policy "Read reads in visible channels"
on public.channel_reads for select to authenticated
using (public.channel_visible_to(channel_id, auth.uid()));

create policy "Insert own reads"
on public.channel_reads for insert to authenticated
with check (auth.uid() = athlete_id);

create policy "Update own reads"
on public.channel_reads for update to authenticated
using (auth.uid() = athlete_id)
with check (auth.uid() = athlete_id);

create policy "Delete own reads"
on public.channel_reads for delete to authenticated
using (auth.uid() = athlete_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'channel_reads'
  ) then
    alter publication supabase_realtime add table public.channel_reads;
  end if;
end $$;
