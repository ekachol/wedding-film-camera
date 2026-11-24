-- ============================================================
--  ตั้งค่า Supabase สำหรับเว็บกล้องฟิล์มงานแต่ง
--  วิธีใช้: เปิด Supabase > SQL Editor > วางทั้งไฟล์นี้ > แก้รหัสผ่านบรรทัดล่างสุด > กด Run
--  รันซ้ำได้ ไม่ทำให้รูปหาย
-- ============================================================

-- ตั้งค่ากลาง (แก้ทีหลังได้ที่ Table Editor > app_settings)
create table if not exists public.app_settings (
  id int primary key default 1 check (id = 1),
  max_shots int not null default 25,        -- จำนวนรูปต่อแขก 1 คน
  reveal_at timestamptz                     -- ว่าง = เห็นอัลบั้มรวมทันที, ใส่วันเวลา = เปิดพร้อมกันตอนนั้น
);
insert into public.app_settings (id) values (1) on conflict do nothing;

create table if not exists public.photos (
  id uuid primary key,
  guest_id text not null check (char_length(guest_id) between 8 and 64),
  guest_name text not null default '' check (char_length(guest_name) <= 40),
  created_at timestamptz not null default now(),
  hidden boolean not null default false
);
create index if not exists photos_created_idx on public.photos (created_at desc);
create index if not exists photos_guest_idx on public.photos (guest_id);

-- รหัสผ่านของบ่าวสาว (ไม่มีใครอ่านตารางนี้ได้จากหน้าเว็บ)
create table if not exists public.admin_secret (
  id int primary key default 1 check (id = 1),
  pass text not null
);

-- สิทธิ์ให้หน้าเว็บเรียกใช้ได้ (ใช้ได้ทั้งตอนติ๊กหรือไม่ติ๊ก "Grant API access to new tables automatically")
grant usage on schema public to anon, authenticated;
grant select on public.app_settings to anon, authenticated;
grant select, insert on public.photos to anon, authenticated;
revoke all on public.admin_secret from anon, authenticated;

alter table public.app_settings enable row level security;
alter table public.photos enable row level security;
alter table public.admin_secret enable row level security;

drop policy if exists "read settings" on public.app_settings;
create policy "read settings" on public.app_settings for select to anon, authenticated using (true);

drop policy if exists "guest insert" on public.photos;
create policy "guest insert" on public.photos for insert to anon, authenticated with check (hidden = false);

drop policy if exists "gallery read" on public.photos;
create policy "gallery read" on public.photos for select to anon, authenticated using (
  not hidden
  and coalesce((select reveal_at <= now() from public.app_settings where id = 1), true)
);

-- กันถ่ายเกินจำนวนฟิล์ม (นับที่เซิร์ฟเวอร์อีกชั้น)
create or replace function public.enforce_film_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare lim int; n int;
begin
  select max_shots into lim from app_settings where id = 1;
  select count(*) into n from photos where guest_id = new.guest_id;
  if n >= coalesce(lim, 25) then
    raise exception 'FILM_LIMIT';
  end if;
  new.created_at := now();
  new.hidden := false;
  return new;
end $$;
drop trigger if exists photos_film_limit on public.photos;
create trigger photos_film_limit before insert on public.photos
  for each row execute function public.enforce_film_limit();

-- ฟังก์ชันสำหรับหน้าบ่าวสาว ต้องส่งรหัสผ่านมาด้วยทุกครั้ง
create or replace function public.admin_list_photos(p_pass text) returns setof public.photos
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from admin_secret where id = 1 and pass = p_pass) then
    raise exception 'BAD_PASS';
  end if;
  return query select * from photos order by created_at desc;
end $$;

create or replace function public.admin_set_hidden(p_pass text, p_id uuid, p_hidden boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from admin_secret where id = 1 and pass = p_pass) then
    raise exception 'BAD_PASS';
  end if;
  update photos set hidden = p_hidden where id = p_id;
end $$;

grant execute on function public.admin_list_photos(text) to anon, authenticated;
grant execute on function public.admin_set_hidden(text, uuid, boolean) to anon, authenticated;

-- ที่เก็บไฟล์รูป: เปิดดูได้ทุกคน อัปโหลดได้เฉพาะ JPEG ไม่เกิน 3 MB
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 3145728, array['image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 3145728, allowed_mime_types = array['image/jpeg'];

drop policy if exists "guest upload photos" on storage.objects;
create policy "guest upload photos" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'photos');

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

-- ============================================================
--  >>> แก้รหัสผ่านของบ่าวสาวตรงนี้ก่อนกด Run <<<
-- ============================================================
insert into public.admin_secret (id, pass) values (1, 'เปลี่ยนรหัสตรงนี้')
on conflict (id) do update set pass = excluded.pass;
