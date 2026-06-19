-- =====================================================================
-- SportsWeb One — Ticketing — PATCH: storage bucket for uploaded logos.
-- Creates a public "tk-logos" bucket and lets signed-in club staff upload.
-- Public read so the logo shows on tickets / sales pages via its URL.
--
-- Run once in the Supabase SQL editor. Idempotent.
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('tk-logos', 'tk-logos', true)
on conflict (id) do update set public = true;

drop policy if exists "tk_logos_read"   on storage.objects;
drop policy if exists "tk_logos_insert" on storage.objects;
drop policy if exists "tk_logos_update" on storage.objects;
drop policy if exists "tk_logos_delete" on storage.objects;

create policy "tk_logos_read" on storage.objects
  for select using (bucket_id = 'tk-logos');

create policy "tk_logos_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'tk-logos');

create policy "tk_logos_update" on storage.objects
  for update to authenticated using (bucket_id = 'tk-logos');

create policy "tk_logos_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'tk-logos');
