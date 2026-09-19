-- İçerik takvimine PDF/Excel dosyaları bağlama desteği.
alter table public.contents
  add column if not exists attachments jsonb not null default '[]'::jsonb;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'content-files',
  'content-files',
  false,
  20971520,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'text/tab-separated-values',
    'text/plain'
  ]
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists content_files_select on storage.objects;
create policy content_files_select on storage.objects for select to authenticated
using (
  bucket_id = 'content-files'
  and (storage.foldername(name))[1] = public.current_org_id()::text
);

drop policy if exists content_files_insert on storage.objects;
create policy content_files_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'content-files'
  and (storage.foldername(name))[1] = public.current_org_id()::text
);

drop policy if exists content_files_update on storage.objects;
create policy content_files_update on storage.objects for update to authenticated
using (
  bucket_id = 'content-files'
  and (storage.foldername(name))[1] = public.current_org_id()::text
)
with check (
  bucket_id = 'content-files'
  and (storage.foldername(name))[1] = public.current_org_id()::text
);

drop policy if exists content_files_delete on storage.objects;
create policy content_files_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'content-files'
  and (storage.foldername(name))[1] = public.current_org_id()::text
);
