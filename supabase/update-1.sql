-- ============================================================
--  อัปเดตครั้งที่ 1 (24 พ.ย. 2026)
--  - ปุ่มลบรูปในหน้าบ่าวสาว
--  - ถ่ายได้คนละ 25 รูป
--  - บ่าวสาวเพิ่มฟิล์มให้แขกรายคนได้
--  วิธีใช้: Supabase > SQL Editor > New query > วางทั้งไฟล์ > กด Run
--  ไม่ต้องแก้อะไร รหัสบ่าวสาวเดิมไม่เปลี่ยน รูปเดิมไม่หาย รันซ้ำได้
-- ============================================================

-- ---------- ลบรูป (หน้าบ่าวสาว) ----------
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

-- ---------- 25 รูปต่อคน ----------
alter table public.app_settings alter column max_shots set default 25;
update public.app_settings set max_shots = 25 where id = 1;

-- ---------- ฟิล์มเพิ่มรายคน ----------
create table if not exists public.guest_bonus (
  guest_id text primary key,
  extra int not null default 0 check (extra >= 0)
);
alter table public.guest_bonus enable row level security;
revoke all on public.guest_bonus from anon, authenticated;

-- กันถ่ายเกิน: จำนวนปกติ + ฟิล์มที่บ่าวสาวเพิ่มให้
create or replace function public.enforce_film_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare lim int; n int;
begin
  select max_shots into lim from app_settings where id = 1;
  lim := coalesce(lim, 25) + coalesce((select extra from guest_bonus where guest_id = new.guest_id), 0);
  select count(*) into n from photos where guest_id = new.guest_id;
  if n >= lim then
    raise exception 'FILM_LIMIT';
  end if;
  new.created_at := now();
  new.hidden := false;
  return new;
end $$;

-- แขกถามได้ว่าตัวเองถ่ายได้กี่รูป
create or replace function public.my_allowance(p_guest_id text) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select max_shots from app_settings where id = 1), 25)
       + coalesce((select extra from guest_bonus where guest_id = p_guest_id), 0);
$$;
grant execute on function public.my_allowance(text) to anon, authenticated;

-- รายชื่อแขกที่ถ่ายแล้ว (หน้าบ่าวสาว)
create or replace function public.admin_list_guests(p_pass text)
returns table (guest_id text, guest_name text, shots bigint, extra int, last_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from admin_secret where id = 1 and pass = p_pass) then
    raise exception 'BAD_PASS';
  end if;
  return query
    select p.guest_id, coalesce((array_agg(p.guest_name order by p.created_at desc) filter (where p.guest_name <> ''))[1], ''), count(*), coalesce(max(b.extra), 0), max(p.created_at)
    from photos p left join guest_bonus b on b.guest_id = p.guest_id
    group by p.guest_id
    order by max(p.created_at) desc;
end $$;
grant execute on function public.admin_list_guests(text) to anon, authenticated;

-- เพิ่ม (หรือลด) ฟิล์มให้แขก 1 คน คืนค่าฟิล์มพิเศษรวมของคนนั้น
create or replace function public.admin_add_shots(p_pass text, p_guest_id text, p_n int) returns int
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if not exists (select 1 from admin_secret where id = 1 and pass = p_pass) then
    raise exception 'BAD_PASS';
  end if;
  insert into guest_bonus (guest_id, extra) values (p_guest_id, greatest(0, p_n))
  on conflict (guest_id) do update set extra = greatest(0, guest_bonus.extra + p_n)
  returning extra into v;
  return v;
end $$;
grant execute on function public.admin_add_shots(text, text, int) to anon, authenticated;
