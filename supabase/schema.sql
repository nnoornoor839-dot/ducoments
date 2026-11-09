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
  key text primary key,                       -- teacher_hash | retry_max | assign_n | curriculum
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
  nick text,                                  -- لقب المنافسة: فريد، يسنده المعلم
  unique (grade, pin)
);
create unique index if not exists students_nick_uq on kalimati.students (nick) where nick is not null;

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
  select st.data || jsonb_build_object('id', st.id, 'name', st.name, 'grade', st.grade, 'pin', st.pin, 'epoch', st.epoch, 'nick', st.nick)
$$;

-- ---------- عام: الإعدادات والمنهج ----------

create or replace function public.kal_config(p_curriculum_at text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c record; retry int; an jsonb;
begin
  select s.value as value, (extract(epoch from s.updated_at) * 1000000)::bigint::text as at
    into c from kalimati.settings s where s.key = 'curriculum';
  select coalesce((select (s.value #>> '{}')::int from kalimati.settings s where s.key = 'retry_max'), 3) into retry;
  select s.value into an from kalimati.settings s where s.key = 'assign_n';
  return jsonb_build_object(
    'has_teacher', exists (select 1 from kalimati.settings s where s.key = 'teacher_hash'),
    'retry_max', retry,
    'assign_n', coalesce(an, '{}'::jsonb),
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
    data = (data - 'xp' - 'streak' - 'lastActive' - 'daily' - 'words' - 'units' - 'log' - 'reps' - 'sentences' - 'sentenceTries')
           || jsonb_build_object(
                'xp', 0, 'streak', 0, 'lastActive', 'null'::jsonb,
                'daily', jsonb_build_object('date', '', 'n', 0),
                'words', '{}'::jsonb, 'units', '{}'::jsonb, 'log', '[]'::jsonb,
                'reps', jsonb_build_object('total', 0, 'byWord', '{}'::jsonb, 'daily', jsonb_build_object('date', '', 'n', 0))),
    updated_at = now()
  where id = p_id;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('error', 'not-found'); end if;
  delete from kalimati.shadow_tries where student_id = p_id;
  delete from kalimati.shadow_clips where student_id = p_id;
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

-- عدد الكلمات المسندة تلقائيًا في كل مرة، لكل صف: {"g5": 5, "g6": 10, ...}
create or replace function public.kal_teacher_set_assign_n(p_token text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not kalimati.is_teacher(p_token) then return jsonb_build_object('error', 'auth'); end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' or exists (
       select 1 from jsonb_each(p_data) e
        where jsonb_typeof(e.value) <> 'number' or (e.value #>> '{}')::numeric not between 1 and 30
           or (e.value #>> '{}')::numeric <> trunc((e.value #>> '{}')::numeric)) then
    return jsonb_build_object('error', 'bad');
  end if;
  insert into kalimati.settings (key, value) values ('assign_n', p_data)
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

-- الطالب يحفظ تقدمه ونطاقه المسند (يُسند تلقائيًا من جهازه)؛ لا يستطيع تغيير اسمه أو رمزه
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
   where e.key in ('xp', 'streak', 'lastActive', 'daily', 'words', 'units', 'log', 'reps', 'ranges', 'sentences', 'sentenceTries');
  update kalimati.students set data = data || clean, updated_at = now() where id = sid;
  return jsonb_build_object('ok', true);
end $$;

-- 3) المعلم هو من يسند اللقب (أو يغيّره أو يزيله)، واللقب المأخوذ لا يُعطى لغيره
create or replace function public.kal_teacher_set_nick(p_token text, p_id text, p_nick text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare nk text;
begin
  if not kalimati.is_teacher(p_token) then return jsonb_build_object('error', 'auth'); end if;
  nk := nullif(trim(coalesce(p_nick, '')), '');
  if nk is not null and nk !~ '^[a-z]{3,20}$' then return jsonb_build_object('error', 'bad'); end if;
  if not exists (select 1 from kalimati.students s where s.id = p_id) then return jsonb_build_object('error', 'not-found'); end if;
  begin
    update kalimati.students set nick = nk, updated_at = now() where id = p_id;
  exception when unique_violation then
    return jsonb_build_object('error', 'taken');
  end;
  return jsonb_build_object('ok', true, 'nick', nk);
end $$;

-- 4) الترتيب: لقب وصف وعدد الكلمات المحفوظة ونقاط الجمل. لا أسماء ولا رموز سرية.
create or replace function public.kal_leaderboard(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare sid text; rows jsonb;
begin
  sid := kalimati.student_of(p_token);
  if sid is null and not kalimati.is_teacher(p_token) then return jsonb_build_object('error', 'auth'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'nick', t.nick, 'grade', t.grade, 'words', t.words, 'sents', t.sents, 'me', t.id = sid)), '[]'::jsonb)
    into rows
    from (
      select st.id, st.nick, st.grade,
             coalesce((select sum(greatest(0,
                 case when jsonb_typeof(u.value #> '{lastTest,tested}') = 'array' then jsonb_array_length(u.value #> '{lastTest,tested}') else 0 end
               - case when jsonb_typeof(u.value #> '{lastTest,wrong}') = 'array' then jsonb_array_length(u.value #> '{lastTest,wrong}') else 0 end))
                 from jsonb_each(case when jsonb_typeof(st.data -> 'units') = 'object' then st.data -> 'units' else '{}'::jsonb end) u), 0)::int as words,
             coalesce((select sum(least(10, v.value::int))
                 from jsonb_each_text(case when jsonb_typeof(st.data -> 'sentences') = 'object' then st.data -> 'sentences' else '{}'::jsonb end) v
                where v.value ~ '^[0-9]{1,2}$' and v.value::int >= 5), 0)::int as sents
        from kalimati.students st
       where st.nick is not null
    ) t;
  return jsonb_build_object('ok', true, 'rows', rows);
end $$;

-- 2) عدّاد محاولات التسجيل اليومية لكل طالب (يحمي حصة خدمة التعرف على الصوت)
create table if not exists kalimati.shadow_uses (
  student_id text not null references kalimati.students(id) on delete cascade,
  day date not null,
  n int not null default 0,
  primary key (student_id, day)
);
alter table kalimati.shadow_uses enable row level security;
revoke all on kalimati.shadow_uses from anon, authenticated;

-- 1) عدّاد محاولات كل جملة لكل طالب (خمس في اليوم)
create table if not exists kalimati.shadow_tries (
  student_id text not null references kalimati.students(id) on delete cascade,
  wid text not null,
  n int not null default 0,          -- العدّاد الكلي: يرقّم ملفات التسجيل
  day date,                          -- يوم آخر محاولة (بتوقيت الرياض)
  today_n int not null default 0,    -- محاولات اليوم (الحد 5 لكل جملة في اليوم)
  primary key (student_id, wid)
);
alter table kalimati.shadow_tries add column if not exists day date;
alter table kalimati.shadow_tries add column if not exists today_n int not null default 0;
alter table kalimati.shadow_tries enable row level security;
revoke all on kalimati.shadow_tries from anon, authenticated;

-- 2) الفحص قبل التسجيل: رمز الطالب + الحد اليومي + محاولات الجملة (لا يحسب شيئًا)
drop function if exists public.kal_shadow_gate(text);
create or replace function public.kal_shadow_gate(p_token text, p_wid text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare sid text; today date; used int := 0; tries int := 0; daily_max constant int := 40; tries_max constant int := 5;
begin
  sid := kalimati.student_of(p_token);
  if sid is null then return jsonb_build_object('error', 'auth'); end if;
  if p_wid is null or length(p_wid) not between 1 and 120 then return jsonb_build_object('error', 'bad'); end if;
  today := (now() at time zone 'Asia/Riyadh')::date;
  select u.n into used from kalimati.shadow_uses u where u.student_id = sid and u.day = today;
  if coalesce(used, 0) >= daily_max then return jsonb_build_object('error', 'limit'); end if;
  select t.today_n into tries from kalimati.shadow_tries t where t.student_id = sid and t.wid = p_wid and t.day = today;
  if coalesce(tries, 0) >= tries_max then return jsonb_build_object('error', 'tries', 'tries', tries); end if;
  return jsonb_build_object('ok', true, 'tries', coalesce(tries, 0));
end $$;

-- 3) بعد نجاح التعرف على الصوت: تُحسب المحاولة اليومية، وتُحسب محاولة الجملة إن سُمع كلام
create or replace function public.kal_shadow_count(p_token text, p_wid text, p_try boolean, p_text text default '', p_ext text default 'webm') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare sid text; today date; tries int := 0; clip_n int := 0; fpath text := null; ext text;
begin
  sid := kalimati.student_of(p_token);
  if sid is null then return jsonb_build_object('error', 'auth'); end if;
  if p_wid is null or length(p_wid) not between 1 and 120 then return jsonb_build_object('error', 'bad'); end if;
  today := (now() at time zone 'Asia/Riyadh')::date;
  delete from kalimati.shadow_uses where day < today - 7;
  insert into kalimati.shadow_uses (student_id, day, n) values (sid, today, 1)
    on conflict (student_id, day) do update set n = kalimati.shadow_uses.n + 1;
  if coalesce(p_try, false) then
    insert into kalimati.shadow_tries (student_id, wid, n, day, today_n) values (sid, p_wid, 1, today, 1)
      on conflict (student_id, wid) do update set
        n = kalimati.shadow_tries.n + 1,
        today_n = case when kalimati.shadow_tries.day = today then kalimati.shadow_tries.today_n + 1 else 1 end,
        day = today
    returning n, today_n into clip_n, tries;
    ext := case when coalesce(p_ext, '') ~ '^[a-z0-9]{2,4}$' then p_ext else 'webm' end;
    fpath := sid || '/' || regexp_replace(p_wid, '[^A-Za-z0-9._-]', '_', 'g') || '/' || clip_n || '.' || ext;
    insert into kalimati.shadow_clips (student_id, wid, n, path, heard)
      values (sid, p_wid, clip_n, fpath, left(coalesce(p_text, ''), 400))
      on conflict (student_id, wid, n) do update set path = excluded.path, heard = excluded.heard, at = now();
  else
    select t.today_n into tries from kalimati.shadow_tries t where t.student_id = sid and t.wid = p_wid and t.day = today;
  end if;
  return jsonb_build_object('ok', true, 'tries', coalesce(tries, 0), 'path', fpath);
end $$;

-- 2) فهرس التسجيلات: ملف لكل محاولة (لكل جملة حتى خمس محاولات)
create table if not exists kalimati.shadow_clips (
  student_id text not null references kalimati.students(id) on delete cascade,
  wid text not null,
  n int not null,
  path text not null,
  heard text not null default '',
  at timestamptz not null default now(),
  primary key (student_id, wid, n)
);
alter table kalimati.shadow_clips enable row level security;
revoke all on kalimati.shadow_clips from anon, authenticated;

-- 4) للمعلم: قائمة تسجيلات طالب (تستدعيها دالة Edge لإنشاء روابط الاستماع)
create or replace function public.kal_teacher_clips(p_token text, p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not kalimati.is_teacher(p_token) then return jsonb_build_object('error', 'auth'); end if;
  return jsonb_build_object('ok', true, 'clips', coalesce((
    select jsonb_agg(jsonb_build_object('wid', c.wid, 'n', c.n, 'path', c.path, 'heard', c.heard, 'at', c.at) order by c.wid, c.n)
      from kalimati.shadow_clips c where c.student_id = p_id), '[]'::jsonb));
end $$;

-- مساحة تخزين خاصة لتسجيلات الطلاب (لا يصل إليها إلا الخادم)
insert into storage.buckets (id, name, public) values ('shadow', 'shadow', false)
  on conflict (id) do update set public = false;

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

-- ================= جولات المنافسة وسحب الجوائز (migrations/2026-11-rounds.sql) =================
-- ---------- الجداول ----------

create table if not exists kalimati.rounds (
  id serial primary key,
  starts date not null,
  ends date not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  standings jsonb,                                         -- ترتيب الجولة عند الإغلاق: [{nick, grade, pct, pts}]
  winner_id text references kalimati.students(id) on delete set null,
  winner_nick text,
  winner_pct numeric,
  prize text,                                              -- الجائزة التي سُحبت
  drawn_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists rounds_one_open on kalimati.rounds (status) where status = 'open';

create table if not exists kalimati.round_base (
  round_id int not null references kalimati.rounds(id) on delete cascade,
  student_id text not null references kalimati.students(id) on delete cascade,
  words int not null default 0,
  sents int not null default 0,
  primary key (round_id, student_id)
);

create table if not exists kalimati.prizes (
  id serial primary key,
  name text not null check (length(btrim(name)) between 1 and 60),
  qty int not null default 1 check (qty >= 0 and qty <= 999)
);

alter table kalimati.rounds enable row level security;
alter table kalimati.round_base enable row level security;
alter table kalimati.prizes enable row level security;
revoke all on kalimati.rounds, kalimati.round_base, kalimati.prizes from anon, authenticated;
revoke all on all sequences in schema kalimati from anon, authenticated;

-- ---------- دوال داخلية ----------

-- نقاط الكلمات المحفوظة ونقاط الجمل (نفس صيغة kal_leaderboard)
create or replace function kalimati.words_of(d jsonb) returns int
language sql immutable set search_path = '' as $$
  select coalesce((select sum(greatest(0,
           case when jsonb_typeof(u.value #> '{lastTest,tested}') = 'array' then jsonb_array_length(u.value #> '{lastTest,tested}') else 0 end
         - case when jsonb_typeof(u.value #> '{lastTest,wrong}') = 'array' then jsonb_array_length(u.value #> '{lastTest,wrong}') else 0 end))
      from jsonb_each(case when jsonb_typeof(d -> 'units') = 'object' then d -> 'units' else '{}'::jsonb end) u), 0)::int
$$;

create or replace function kalimati.sents_of(d jsonb) returns int
language sql immutable set search_path = '' as $$
  select coalesce((select sum(least(10, v.value::int))
      from jsonb_each_text(case when jsonb_typeof(d -> 'sentences') = 'object' then d -> 'sentences' else '{}'::jsonb end) v
     where v.value ~ '^[0-9]{1,2}$' and v.value::int >= 5), 0)::int
$$;

create or replace function kalimati.today_riyadh() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'Asia/Riyadh')::date $$;

-- لقطة بداية الجولة لمن له لقب ولا لقطة له بعد (تُستدعى عند البدء وعند ظهور طالب جديد أثناء الجولة)
create or replace function kalimati.snap_round(p_round int) returns void
language sql security definer set search_path = '' as $$
  insert into kalimati.round_base (round_id, student_id, words, sents)
  select p_round, s.id, kalimati.words_of(s.data), kalimati.sents_of(s.data)
    from kalimati.students s
   where s.nick is not null
  on conflict do nothing
$$;

-- ترتيب جولة: الفرق في النقاط كنسبة من منهج الصف (grade_max يرفعه المعلم). من لا منهج معروفًا لصفه نسبته 0
create or replace function kalimati.round_standings(p_round int)
returns table (student_id text, nick text, grade text, pts int, pct numeric, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare gm jsonb;
begin
  select s.value into gm from kalimati.settings s where s.key = 'grade_max';
  return query
    select t.id, t.nick, t.grade, t.pts,
           case when t.mx is null then 0::numeric else least(100::numeric, round(t.pts::numeric / t.mx * 100, 1)) end,
           t.created_at
      from (
        select s.id, s.nick, s.grade, s.created_at,
               greatest(0, kalimati.words_of(s.data) - b.words) + greatest(0, kalimati.sents_of(s.data) - b.sents) as pts,
               nullif(case when gm is not null and (gm ->> s.grade) ~ '^[0-9]+(\.[0-9]+)?$' then (gm ->> s.grade)::numeric else 0 end, 0) as mx
          from kalimati.students s
          join kalimati.round_base b on b.student_id = s.id and b.round_id = p_round
         where s.nick is not null
      ) t;
end $$;

-- إغلاق جولة: يحفظ الترتيب ويُعلن المتميز إن بلغ الحد الأدنى
create or replace function kalimati.close_round(p_id int) returns void
language plpgsql security definer set search_path = '' as $$
declare st jsonb; w record; minpct numeric;
begin
  select coalesce((select (s.value #>> '{}')::numeric from kalimati.settings s where s.key = 'round_min_pct'), 5) into minpct;
  select coalesce(jsonb_agg(jsonb_build_object('nick', r.nick, 'grade', r.grade, 'pct', r.pct, 'pts', r.pts)
                            order by r.pct desc, r.pts desc, r.created_at), '[]'::jsonb)
    into st from kalimati.round_standings(p_id) r;
  select r.* into w from kalimati.round_standings(p_id) r order by r.pct desc, r.pts desc, r.created_at limit 1;
  update kalimati.rounds set
    status = 'closed',
    standings = st,
    winner_id = case when w.student_id is not null and w.pct >= minpct and w.pts > 0 then w.student_id end,
    winner_nick = case when w.student_id is not null and w.pct >= minpct and w.pts > 0 then w.nick end,
    winner_pct = case when w.student_id is not null and w.pct >= minpct and w.pts > 0 then w.pct end
  where id = p_id;
end $$;

-- إن انتهت الجولة المفتوحة: نغلقها ونفتح التي بعدها (من اليوم التالي لنهايتها، أو من اليوم إن مضى أكثر من جولة)
create or replace function kalimati.roll_rounds() returns void
language plpgsql security definer set search_path = '' as $$
declare r kalimati.rounds; today date := kalimati.today_riyadh(); nstart date; nid int;
begin
  select * into r from kalimati.rounds where status = 'open' for update;
  if not found or r.ends >= today then return; end if;
  perform kalimati.close_round(r.id);
  nstart := case when today > r.ends + 10 then today else r.ends + 1 end;
  insert into kalimati.rounds (starts, ends) values (nstart, nstart + 9) returning id into nid;
  perform kalimati.snap_round(nid);
end $$;

revoke all on function kalimati.words_of(jsonb), kalimati.sents_of(jsonb), kalimati.today_riyadh(), kalimati.snap_round(int),
  kalimati.round_standings(int), kalimati.close_round(int), kalimati.roll_rounds() from public, anon, authenticated;

-- ---------- دوال الواجهة ----------

-- حالة الجولة للطالب أو المعلم: الجولة الحالية، ونقاط كل لقب، والمتميزون السابقون
create or replace function public.kal_round_state(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare sid text; today date := kalimati.today_riyadh(); r kalimati.rounds; rows jsonb; hist jsonb; has_r boolean;
begin
  sid := kalimati.student_of(p_token);
  if sid is null and not kalimati.is_teacher(p_token) then return jsonb_build_object('error', 'auth'); end if;
  perform kalimati.roll_rounds();
  select * into r from kalimati.rounds where status = 'open';
  has_r := found;
  if has_r then
    perform kalimati.snap_round(r.id);
    select coalesce(jsonb_agg(jsonb_build_object(
             'nick', s.nick, 'grade', s.grade, 'words', kalimati.words_of(s.data), 'sents', kalimati.sents_of(s.data),
             'bw', b.words, 'bs', b.sents, 'me', s.id = sid)), '[]'::jsonb)
      into rows
      from kalimati.students s join kalimati.round_base b on b.student_id = s.id and b.round_id = r.id
     where s.nick is not null;
  end if;
  select coalesce(jsonb_agg(h order by h.id desc), '[]'::jsonb) into hist
    from (
      select c.id, c.starts, c.ends, c.winner_nick, c.winner_pct,
             (c.winner_id is not null and c.winner_id = sid) as mine,
             (c.winner_id is not null and c.winner_id = sid and c.drawn_at is null) as can_draw,
             case when c.winner_id = sid then c.prize end as prize
        from kalimati.rounds c where c.status = 'closed' order by c.id desc limit 8
    ) h;
  return jsonb_build_object('ok', true,
    'round', case when has_r then jsonb_build_object('id', r.id, 'starts', r.starts, 'ends', r.ends, 'days_left', greatest(0, r.ends - today + 1)) end,
    'rows', coalesce(rows, '[]'::jsonb), 'history', hist);
end $$;

-- المتميز يسحب جائزته (مرة واحدة)
create or replace function public.kal_round_draw(p_token text, p_round int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare sid text; r kalimati.rounds; pz kalimati.prizes;
begin
  sid := kalimati.student_of(p_token);
  if sid is null then return jsonb_build_object('error', 'auth'); end if;
  select * into r from kalimati.rounds where id = p_round and status = 'closed' for update;
  if not found or r.winner_id is distinct from sid then return jsonb_build_object('error', 'not-winner'); end if;
  if r.drawn_at is not null then return jsonb_build_object('ok', true, 'prize', r.prize, 'again', true); end if;
  select * into pz from kalimati.prizes where qty > 0 order by random() limit 1 for update;
  if not found then return jsonb_build_object('ok', true, 'none', true); end if;
  update kalimati.prizes set qty = qty - 1 where id = pz.id;
  update kalimati.rounds set prize = pz.name, drawn_at = now() where id = r.id;
  return jsonb_build_object('ok', true, 'prize', pz.name);
end $$;

-- المعلم: يرفع حجم منهج كل صف (لحساب نسبة التقدم في الخادم): {"g5": 530, "t1": 134}
create or replace function public.kal_teacher_set_grade_max(p_token text, p_map jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not kalimati.is_teacher(p_token) then return jsonb_build_object('error', 'auth'); end if;
  if p_map is null or jsonb_typeof(p_map) <> 'object' or exists (
       select 1 from jsonb_each(p_map) e
        where jsonb_typeof(e.value) <> 'number' or (e.value #>> '{}')::numeric not between 1 and 100000) then
    return jsonb_build_object('error', 'bad');
  end if;
  insert into kalimati.settings (key, value) values ('grade_max', p_map)
    on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- المعلم: يبدأ الجولة الأولى (أو جولة جديدة إن لم تكن هناك جولة مفتوحة)
create or replace function public.kal_teacher_round_start(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare today date := kalimati.today_riyadh(); nid int;
begin
  if not kalimati.is_teacher(p_token) then return jsonb_build_object('error', 'auth'); end if;
  perform kalimati.roll_rounds();
  if exists (select 1 from kalimati.rounds where status = 'open') then return jsonb_build_object('error', 'open'); end if;
  insert into kalimati.rounds (starts, ends) values (today, today + 9) returning id into nid;
  perform kalimati.snap_round(nid);
  return jsonb_build_object('ok', true, 'id', nid);
end $$;

-- المعلم: الجولات (مع الاسم الحقيقي للمتميز) والجوائز
create or replace function public.kal_teacher_rounds(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare today date := kalimati.today_riyadh();
begin
  if not kalimati.is_teacher(p_token) then return jsonb_build_object('error', 'auth'); end if;
  perform kalimati.roll_rounds();
  return jsonb_build_object('ok', true,
    'rounds', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'starts', c.starts, 'ends', c.ends, 'status', c.status,
        'days_left', case when c.status = 'open' then greatest(0, c.ends - today + 1) end,
        'winner_nick', c.winner_nick, 'winner_pct', c.winner_pct,
        'winner_name', (select s.name from kalimati.students s where s.id = c.winner_id),
        'prize', c.prize, 'drawn', c.drawn_at is not null) order by c.id desc)
      from (select * from kalimati.rounds order by id desc limit 20) c), '[]'::jsonb),
    'prizes', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'qty', p.qty) order by p.id) from kalimati.prizes p), '[]'::jsonb));
end $$;

create or replace function public.kal_teacher_prize_add(p_token text, p_name text, p_qty int default 1) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not kalimati.is_teacher(p_token) then return jsonb_build_object('error', 'auth'); end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 60 or p_qty is null or p_qty not between 1 and 999 then
    return jsonb_build_object('error', 'bad');
  end if;
  if (select count(*) from kalimati.prizes) >= 50 then return jsonb_build_object('error', 'bad'); end if;
  insert into kalimati.prizes (name, qty) values (btrim(p_name), p_qty);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.kal_teacher_prize_del(p_token text, p_id int) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not kalimati.is_teacher(p_token) then return jsonb_build_object('error', 'auth'); end if;
  delete from kalimati.prizes where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- صلاحيات الدوال الجديدة (للـAPI فقط، والدوال تتحقق من الرمز بنفسها)
revoke all on function public.kal_round_state(text), public.kal_round_draw(text, int), public.kal_teacher_set_grade_max(text, jsonb),
  public.kal_teacher_round_start(text), public.kal_teacher_rounds(text), public.kal_teacher_prize_add(text, text, int),
  public.kal_teacher_prize_del(text, int) from public;
grant execute on function public.kal_round_state(text), public.kal_round_draw(text, int), public.kal_teacher_set_grade_max(text, jsonb),
  public.kal_teacher_round_start(text), public.kal_teacher_rounds(text), public.kal_teacher_prize_add(text, text, int),
  public.kal_teacher_prize_del(text, int) to anon, authenticated;
