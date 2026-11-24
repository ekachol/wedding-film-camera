-- ============================================================
--  อัปเดต: เพิ่มปุ่ม "ลบรูป" ในหน้าบ่าวสาว
--  วิธีใช้: Supabase > SQL Editor > วางทั้งไฟล์ > กด Run (ไม่ต้องแก้อะไร รหัสเดิมไม่เปลี่ยน)
-- ============================================================

-- ลบรายการรูป ต้องใช้รหัสบ่าวสาว
create or replace function public.admin_delete_photo(p_pass text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from admin_secret where id = 1 and pass = p_pass) then
    raise exception 'BAD_PASS';
  end if;
  delete from photos where id = p_id;
end $$;
grant execute on function public.admin_delete_photo(text, uuid) to anon, authenticated;

-- เช็กว่าไฟล์ยังมีรายการรูปอยู่ไหม (ใช้ในกติกาด้านล่าง)
create or replace function public.photo_file_is_orphan(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from photos where id::text = split_part(split_part(p_name, '/', 2), '.', 1)
  );
$$;
grant execute on function public.photo_file_is_orphan(text) to anon, authenticated;

-- ลบไฟล์ได้เฉพาะไฟล์ของรูปที่บ่าวสาวลบรายการไปแล้วเท่านั้น
drop policy if exists "remove deleted photo files (select)" on storage.objects;
create policy "remove deleted photo files (select)" on storage.objects for select to anon, authenticated
  using (bucket_id = 'photos' and public.photo_file_is_orphan(name));
drop policy if exists "remove deleted photo files" on storage.objects;
create policy "remove deleted photo files" on storage.objects for delete to anon, authenticated
  using (bucket_id = 'photos' and public.photo_file_is_orphan(name));
