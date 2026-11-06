-- =====================================================================
-- 0013 — Channel delete policies (M5 addendum)          STATUS: APPLIED
-- Applied live 2026-11-06 via the Supabase Management API, same
-- session/approval as 0012 (the M5 "member channels + approval"
-- scope implies a rejection path, and the live schema had NO delete
-- policy on channels at all).
--
-- Admins can delete any channel (reject proposals, retire channels);
-- a creator can delete their own still-pending proposal.
-- =====================================================================

drop policy if exists "Admins delete channels" on public.channels;
create policy "Admins delete channels"
  on public.channels for delete to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists "Creators delete own pending channels" on public.channels;
create policy "Creators delete own pending channels"
  on public.channels for delete to authenticated
  using (created_by = auth.uid() and status = 'pending');
