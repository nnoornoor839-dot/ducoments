-- ترحيل: خمس محاولات فقط لكل جملة (تُحتسب أعلى درجة). الصقه كاملًا في Supabase ← SQL Editor ← Run (آمن للتكرار).
-- يتطلب أن يكون ترحيل قراءة الجمل (2026-10-shadowing.sql) قد شُغّل قبله.

-- 1) عدّاد محاولات كل جملة لكل طالب
create table if not exists kalimati.shadow_tries (
  student_id text not null references kalimati.students(id) on delete cascade,
  wid text not null,
  n int not null default 0,
  primary key (student_id, wid)
);
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
  select t.n into tries from kalimati.shadow_tries t where t.student_id = sid and t.wid = p_wid;
  if coalesce(tries, 0) >= tries_max then return jsonb_build_object('error', 'tries', 'tries', tries); end if;
  return jsonb_build_object('ok', true, 'tries', coalesce(tries, 0));
end $$;

-- 3) بعد نجاح التعرف على الصوت: تُحسب المحاولة اليومية، وتُحسب محاولة الجملة إن سُمع كلام
create or replace function public.kal_shadow_count(p_token text, p_wid text, p_try boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare sid text; today date; tries int := 0;
begin
  sid := kalimati.student_of(p_token);
  if sid is null then return jsonb_build_object('error', 'auth'); end if;
  if p_wid is null or length(p_wid) not between 1 and 120 then return jsonb_build_object('error', 'bad'); end if;
  today := (now() at time zone 'Asia/Riyadh')::date;
  delete from kalimati.shadow_uses where day < today - 7;
  insert into kalimati.shadow_uses (student_id, day, n) values (sid, today, 1)
    on conflict (student_id, day) do update set n = kalimati.shadow_uses.n + 1;
  if coalesce(p_try, false) then
    insert into kalimati.shadow_tries (student_id, wid, n) values (sid, p_wid, 1)
      on conflict (student_id, wid) do update set n = kalimati.shadow_tries.n + 1
    returning n into tries;
  else
    select t.n into tries from kalimati.shadow_tries t where t.student_id = sid and t.wid = p_wid;
  end if;
  return jsonb_build_object('ok', true, 'tries', coalesce(tries, 0));
end $$;

-- 4) الطالب يحفظ عدّاد محاولاته (للعرض فقط؛ الحد الفعلي يُفرض في الخادم)
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

-- 5) تصفير تقدم الطالب يعيد له محاولات الجمل أيضًا
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
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.kal_shadow_gate(text, text) from public;
grant execute on function public.kal_shadow_gate(text, text) to anon, authenticated;
revoke all on function public.kal_shadow_count(text, text, boolean) from public;
grant execute on function public.kal_shadow_count(text, text, boolean) to anon, authenticated;
