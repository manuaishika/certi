-- Public `assets` bucket for logos, uploaded backgrounds and AI-generated artwork.
-- Guarded so the same migration set also runs on plain Postgres / PGlite (demo + tests), where there is no `storage` schema.
do $$
begin
  if to_regnamespace('storage') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('assets', 'assets', true, 8388608, array['image/png','image/jpeg','image/webp'])
    on conflict (id) do update set public = true, file_size_limit = 8388608, allowed_mime_types = excluded.allowed_mime_types;

    -- Anyone may read (certificates must render for participants); only tenant admins / Super Admin may upload. No update/delete from clients.
    execute 'drop policy if exists "assets_read" on storage.objects';
    execute 'create policy "assets_read" on storage.objects for select using (bucket_id = ''assets'')';
    execute 'drop policy if exists "assets_admin_upload" on storage.objects';
    execute $p$create policy "assets_admin_upload" on storage.objects for insert to authenticated
              with check (bucket_id = 'assets' and (storage.foldername(name))[1] in ('logos','backgrounds') and app.role() in ('super','org_admin'))$p$;
  end if;
end $$;
