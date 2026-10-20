-- ترحيل: قراءة الجمل (الشادوينج). الصقه كاملًا في Supabase ← SQL Editor ← Run (آمن للتكرار).
-- يتطلب أن يكون ترحيل المنافسة (2026-10-competition.sql) قد شُغّل قبله.

-- 1) الطالب يحفظ أفضل درجة لكل جملة (sentences)
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
   where e.key in ('xp', 'streak', 'lastActive', 'daily', 'words', 'units', 'log', 'reps', 'ranges', 'sentences');
  update kalimati.students set data = data || clean, updated_at = now() where id = sid;
  return jsonb_build_object('ok', true);
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

-- تستدعيها دالة التعرف على الصوت قبل كل تسجيل: تتحقق من رمز الطالب وتحسب المحاولة
create or replace function public.kal_shadow_gate(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare sid text; today date; cnt int; daily_max constant int := 40;
begin
  sid := kalimati.student_of(p_token);
  if sid is null then return jsonb_build_object('error', 'auth'); end if;
  today := (now() at time zone 'Asia/Riyadh')::date;
  delete from kalimati.shadow_uses where day < today - 7;
  insert into kalimati.shadow_uses (student_id, day, n) values (sid, today, 0) on conflict do nothing;
  update kalimati.shadow_uses set n = n + 1
   where student_id = sid and day = today and n < daily_max
  returning n into cnt;
  if cnt is null then return jsonb_build_object('error', 'limit'); end if;
  return jsonb_build_object('ok', true, 'left', daily_max - cnt);
end $$;

-- 3) الترتيب يضمّ نقاط الجمل: كل جملة بأفضل درجة لها (5 فأكثر، حتى 10)
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

revoke all on function public.kal_shadow_gate(text) from public;
grant execute on function public.kal_shadow_gate(text) to anon, authenticated;
