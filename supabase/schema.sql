-- كلماتي — قاعدة بيانات Supabase
-- التشغيل: Supabase Dashboard ← SQL Editor ← New query ← الصق الملف كاملًا ← Run.
-- آمن لإعادة التشغيل أكثر من مرة.
--
-- التصميم الأمني: مفتاح Publishable يظهر في كود الصفحة ويراه أي زائر، لذلك:
--   1) الجداول في مخطط خاص (kalimati) غير مكشوف عبر الـAPI، وعليها RLS بلا أي سياسة.
--   2) الوصول الوحيد عبر دوال public.kal_* ، وكل دالة تتحقق من رمز جلسة (token).
--   3) كلمة مرور المعلم مشفّرة بـbcrypt، ومحاولات الدخول الفاشلة محدودة لكل عنوان IP.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists kalimati;

-- ---------- الجداول ----------

create table if not exists kalimati.settings (
  key text primary key,                       -- teacher_hash | retry_max | curriculum
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists kalimati.students (
  id text primary key,
  name text not null,
  grade text not null,
  pin text not null check (pin ~ '^[0-9]{4}$'),
  epoch int not null default 0,               -- يزيد عند تصفير التقدم لرفض حفظ قديم من جهاز آخر
  data jsonb not null default '{}'::jsonb,    -- التقدم والنطاقات وبقية الحقول
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (grade, pin)
);

create table if not exists kalimati.sessions (
  token uuid primary key default gen_random_uuid(),
  role text not null check (role in ('teacher', 'student')),
  student_id text references kalimati.students(id) on delete cascade,
  expires_at timestamptz not null
);

create table if not exists kalimati.attempts (
  id bigserial primary key,
  ip text not null,
  kind text not null,
  at timestamptz not null default now()
);
create index if not exists attempts_lookup on kalimati.attempts (ip, kind, at);

alter table kalimati.settings enable row level security;
alter table kalimati.students enable row level security;
alter table kalimati.sessions enable row level security;
alter table kalimati.attempts enable row level security;
revoke all on all tables in schema kalimati from anon, authenticated;
revoke all on all sequences in schema kalimati from anon, authenticated;
revoke all on schema kalimati from anon, authenticated;

-- ---------- دوال مساعدة (داخلية، غير متاحة للـAPI) ----------

create or replace function kalimati.to_uuid(t text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return t::uuid;
exception when others then
  return null;
end $$;

create or replace function kalimati.client_ip() returns text
language plpgsql stable set search_path = '' as $$
declare h text; ip text;
begin
  h := current_setting('request.headers', true);
  if h is null or h = '' then return 'unknown'; end if;
  begin
    ip := trim(split_part(coalesce((h::json) ->> 'x-forwarded-for', ''), ',', 1));
  exception when others then
    ip := '';
  end;
  return coalesce(nullif(ip, ''), 'unknown');
end $$;

create or replace function kalimati.rate_blocked(p_kind text, p_limit int) returns boolean
language plpgsql set search_path = '' as $$
declare n int;
begin
  delete from kalimati.attempts where at < now() - interval '1 hour';
  select count(*) into n from kalimati.attempts
   where ip = kalimati.client_ip() and kind = p_kind and at > now() - interval '10 minutes';
  return n >= p_limit;
end $$;

create or replace function kalimati.rate_fail(p_kind text) returns void
language sql set search_path = '' as $$
  insert into kalimati.attempts (ip, kind) values (kalimati.client_ip(), p_kind)
$$;

create or replace function kalimati.rate_clear(p_kind text) returns void
language sql set search_path = '' as $$
  delete from kalimati.attempts where ip = kalimati.client_ip() and kind = p_kind
$$;

create or replace function kalimati.is_teacher(p_token text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from kalimati.sessions s
     where s.token = kalimati.to_uuid(p_token) and s.role = 'teacher' and s.expires_at > now())
$$;

create or replace function kalimati.student_of(p_token text) returns text
language sql stable security definer set search_path = '' as $$
  select s.student_id from kalimati.sessions s
   where s.token = kalimati.to_uuid(p_token) and s.role = 'student' and s.expires_at > now()
$$;

create or replace function kalimati.student_json(st kalimati.students) returns jsonb
language sql immutable set search_path = '' as $$
  select st.data || jsonb_build_object('id', st.id, 'name', st.name, 'grade', st.grade, 'pin', st.pin, 'epoch', st.epoch)
$$;

-- ---------- عام: الإعدادات والمنهج ----------

create or replace function public.kal_config(p_curriculum_at text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c record; retry int;
begin
  select s.value as value, (extract(epoch from s.updated_at) * 1000000)::bigint::text as at
    into c from kalimati.settings s where s.key = 'curriculum';
  select coalesce((select (s.value #>> '{}')::int from kalimati.settings s where s.key = 'retry_max'), 3) into retry;
  return jsonb_build_object(
    'has_teacher', exists (select 1 from kalimati.settings s where s.key = 'teacher_hash'),
    'retry_max', retry,
    'curriculum_set', c.at is not null,
    'curriculum_at', c.at,
    'curriculum', case when c.at is not null and c.at is distinct from p_curriculum_at then c.value else null end
  );
end $$;

-- ---------- المعلم ----------

create or replace function public.kal_teacher_setup(p_pass text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare tok uuid;
begin
  if p_pass is null or length(p_pass) < 4 then return jsonb_build_object('error', 'short'); end if;
  insert into kalimati.settings (key, value)
    values ('teacher_hash', to_jsonb(extensions.crypt(p_pass, extensions.gen_salt('bf'))))
    on conflict (key) do nothing;
  if not found then return jsonb_build_object('error', 'exists'); end if;
  insert into kalimati.sessions (role, expires_at) values ('teacher', now() + interval '12 hours') returning token into tok;
  return jsonb_build_object('ok', true, 'token', tok);
end $$;

create or replace function public.kal_teacher_login(p_pass text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare h text; tok uuid;
begin
  if kalimati.rate_blocked('teacher', 5) then return jsonb_build_object('error', 'rate-limited'); end if;
  select s.value #>> '{}' into h from kalimati.settings s where s.key = 'teacher_hash';
  if h is null then return jsonb_build_object('error', 'no-teacher'); end if;
  if p_pass is null or extensions.crypt(p_pass, h) <> h then
    perform kalimati.rate_fail('teacher');
    return jsonb_build_object('error', 'bad-password');
  end if;
  perform kalimati.rate_clear('teacher');
  delete from kalimati.sessions where expires_at < now();
  insert into kalimati.sessions (role, expires_at) values ('teacher', now() + interval '12 hours') returning token into tok;
  return jsonb_build_object('ok', true, 'token', tok);
end $$;

create or replace function public.kal_teacher_logout(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  delete from kalimati.sessions where token = kalimati.to_uuid(p_token) and role = 'teacher';
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.kal_teacher_list(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not kalimati.is_teacher(p_token) then return jsonb_build_object('error', 'auth'); end if;
  return jsonb_build_object('ok', true, 'students', coalesce(
    (select jsonb_agg(kalimati.student_json(s) order by s.created_at) from kalimati.students s), '[]'::jsonb));
end $$;

create or replace function public.kal_teacher_add(p_token text, p_student jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare sid text; nm text; gr text; pn text;
begin
  if not kalimati.is_teacher(p_token) then return jsonb_build_object('error', 'auth'); end if;
  if p_student is null or jsonb_typeof(p_student) <> 'object' or octet_length(p_student::text) > 400000 then
    return jsonb_build_object('error', 'bad');
  end if;
  sid := p_student ->> 'id'; nm := btrim(p_student ->> 'name'); gr := p_student ->> 'grade'; pn := p_student ->> 'pin';
  if sid is null or sid = '' or length(sid) > 40
     or nm is null or nm = '' or length(nm) > 40
     or gr is null or gr = '' or length(gr) > 20
     or pn is null or pn !~ '^[0-9]{4}$' then
    return jsonb_build_object('error', 'bad');
  end if;
  insert into kalimati.students (id, name, grade, pin, data)
    values (sid, nm, gr, pn, p_student - 'id' - 'name' - 'grade' - 'pin' - 'epoch')
    on conflict (id) do nothing;
  return jsonb_build_object('ok', true);
exception when unique_violation then
  return jsonb_build_object('error', 'pin-taken');
end $$;

create or replace function public.kal_teacher_patch(p_token text, p_id text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not kalimati.is_teacher(p_token) then return jsonb_build_object('error', 'auth'); end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then return jsonb_build_object('error', 'bad'); end if;
  if p_patch ? 'pin' and (p_patch ->> 'pin') !~ '^[0-9]{4}$' then return jsonb_build_object('error', 'bad'); end if;
  if p_patch ? 'name' and (btrim(coalesce(p_patch ->> 'name', '')) = '' or length(p_patch ->> 'name') > 40) then
    return jsonb_build_object('error', 'bad');
  end if;
  update kalimati.students set
    name = coalesce(btrim(p_patch ->> 'name'), name),
    pin = coalesce(p_patch ->> 'pin', pin),
    grade = coalesce(p_patch ->> 'grade', grade),
    data = case when jsonb_typeof(p_patch -> 'ranges') = 'object'
                then jsonb_set(data, '{ranges}', coalesce(data -> 'ranges', '{}'::jsonb) || (p_patch -> 'ranges'), true)
                else data end,
    updated_at = now()
  where id = p_id;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('error', 'not-found'); end if;
  return jsonb_build_object('ok', true);
exception when unique_violation then
  return jsonb_build_object('error', 'pin-taken');
end $$;

create or replace function public.kal_teacher_reset(p_token text, p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not kalimati.is_teacher(p_token) then return jsonb_build_object('error', 'auth'); end if;
  update kalimati.students set
    epoch = epoch + 1,
    data = (data - 'xp' - 'streak' - 'lastActive' - 'daily' - 'words' - 'units' - 'log' - 'reps')
           || jsonb_build_object(
                'xp', 0, 'streak', 0, 'lastActive', 'null'::jsonb,
                'daily', jsonb_build_object('date', '', 'n', 0),
                'words', '{}'::jsonb, 'units', '{}'::jsonb, 'log', '[]'::jsonb,
                'reps', jsonb_build_object('total', 0, 'byWord', '{}'::jsonb, 'daily', jsonb_build_object('date', '', 'n', 0))),
    updated_at = now()
  where id = p_id;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('error', 'not-found'); end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.kal_teacher_delete(p_token text, p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not kalimati.is_teacher(p_token) then return jsonb_build_object('error', 'auth'); end if;
  delete from kalimati.students where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.kal_teacher_set_retry(p_token text, p_n int) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not kalimati.is_teacher(p_token) then return jsonb_build_object('error', 'auth'); end if;
  if p_n is null or p_n < 0 or p_n > 10 then return jsonb_build_object('error', 'bad'); end if;
  insert into kalimati.settings (key, value) values ('retry_max', to_jsonb(p_n))
    on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.kal_teacher_set_curriculum(p_token text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare at_txt text;
begin
  if not kalimati.is_teacher(p_token) then return jsonb_build_object('error', 'auth'); end if;
  if p_data is null or p_data = 'null'::jsonb then
    delete from kalimati.settings where key = 'curriculum';
    return jsonb_build_object('ok', true, 'curriculum_at', null);
  end if;
  if jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 3000000 then
    return jsonb_build_object('error', 'bad');
  end if;
  insert into kalimati.settings (key, value) values ('curriculum', p_data)
    on conflict (key) do update set value = excluded.value, updated_at = now();
  select (extract(epoch from s.updated_at) * 1000000)::bigint::text into at_txt from kalimati.settings s where s.key = 'curriculum';
  return jsonb_build_object('ok', true, 'curriculum_at', at_txt);
end $$;

-- ---------- الطالب ----------

create or replace function public.kal_student_login(p_grade text, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare st kalimati.students; tok uuid;
begin
  if kalimati.rate_blocked('student', 15) then return jsonb_build_object('error', 'rate-limited'); end if;
  select * into st from kalimati.students s where s.grade = p_grade and s.pin = p_pin;
  if not found then
    perform kalimati.rate_fail('student');
    return jsonb_build_object('error', 'bad-pin');
  end if;
  perform kalimati.rate_clear('student');
  delete from kalimati.sessions where expires_at < now();
  insert into kalimati.sessions (role, student_id, expires_at)
    values ('student', st.id, now() + interval '365 days') returning token into tok;
  return jsonb_build_object('ok', true, 'token', tok, 'student', kalimati.student_json(st));
end $$;

create or replace function public.kal_student_get(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare sid text; st kalimati.students;
begin
  sid := kalimati.student_of(p_token);
  if sid is null then return jsonb_build_object('error', 'auth'); end if;
  select * into st from kalimati.students s where s.id = sid;
  if not found then return jsonb_build_object('error', 'auth'); end if;
  return jsonb_build_object('ok', true, 'student', kalimati.student_json(st));
end $$;

-- الطالب يحفظ تقدمه فقط؛ لا يستطيع تغيير اسمه أو رمزه أو نطاقه
create or replace function public.kal_student_save(p_token text, p_patch jsonb, p_epoch int default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare sid text; st kalimati.students; clean jsonb;
begin
  sid := kalimati.student_of(p_token);
  if sid is null then return jsonb_build_object('error', 'auth'); end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or octet_length(p_patch::text) > 400000 then
    return jsonb_build_object('error', 'bad');
  end if;
  select * into st from kalimati.students s where s.id = sid for update;
  if st.epoch <> coalesce(p_epoch, 0) then
    return jsonb_build_object('error', 'stale', 'student', kalimati.student_json(st));
  end if;
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into clean
    from jsonb_each(p_patch) e
   where e.key in ('xp', 'streak', 'lastActive', 'daily', 'words', 'units', 'log', 'reps');
  update kalimati.students set data = data || clean, updated_at = now() where id = sid;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- الصلاحيات: دوال kal_* فقط للـAPI ----------

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'kal\_%'
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('grant execute on function %s to anon, authenticated', r.sig);
  end loop;
end $$;

-- لتغيير كلمة مرور المعلم لاحقًا (من SQL Editor):
-- update kalimati.settings
--    set value = to_jsonb(extensions.crypt('كلمة_المرور_الجديدة', extensions.gen_salt('bf')))
--  where key = 'teacher_hash';
