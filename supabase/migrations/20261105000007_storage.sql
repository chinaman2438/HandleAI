-- =============================================================================
-- 0007 — Private Supabase Storage bucket & object-level RLS policies
-- =============================================================================

do $$
begin
  if exists (
    select 1 from information_schema.tables
     where table_schema = 'storage' and table_name = 'buckets'
  ) then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'documents',
      'documents',
      false,
      15728640, -- 15 MB
      array[
        'application/pdf',
        'image/jpeg',
        'image/png',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel'
      ]
    )
    on conflict (id) do update
      set public = false,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;

    -- Drop existing policies if re-running
    drop policy if exists documents_storage_staff_all on storage.objects;
    drop policy if exists documents_storage_customer_select on storage.objects;
    drop policy if exists documents_storage_customer_insert on storage.objects;

    -- Staff can read and upload any object in the private `documents` bucket
    execute $pol$
      create policy documents_storage_staff_all on storage.objects
        for all to authenticated
        using (bucket_id = 'documents' and app.is_staff())
        with check (bucket_id = 'documents' and app.is_staff())
    $pol$;

    -- Customers can only read/upload objects under `org/<their_org_id>/...`
    execute $pol$
      create policy documents_storage_customer_select on storage.objects
        for select to authenticated
        using (
          bucket_id = 'documents'
          and (storage.foldername(name))[1] = 'org'
          and (storage.foldername(name))[2] = app.current_user_org_id()::text
        )
    $pol$;

    execute $pol$
      create policy documents_storage_customer_insert on storage.objects
        for insert to authenticated
        with check (
          bucket_id = 'documents'
          and (storage.foldername(name))[1] = 'org'
          and (storage.foldername(name))[2] = app.current_user_org_id()::text
        )
    $pol$;
  end if;
end;
$$;
