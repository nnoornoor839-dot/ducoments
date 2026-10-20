-- ترحيل: المنافسة (الألقاب والترتيب). الصقه كاملًا في Supabase ← SQL Editor ← Run (آمن للتكرار).

-- 1) لقب الطالب: فريد بين كل الطلاب، ويسنده المعلم
alter table kalimati.students add column if not exists nick text;
create unique index if not exists students_nick_uq on kalimati.students (nick) where nick is not null;

-- 2) بيانات الطالب تتضمن لقبه
create or replace function kalimati.student_json(st kalimati.students) returns jsonb
language sql immutable set search_path = '' as $$
  select st.data || jsonb_build_object('id', st.id, 'name', st.name, 'grade', st.grade, 'pin', st.pin, 'epoch', st.epoch, 'nick', st.nick)
$$;

-- (إن كانت نسخة سابقة من الترحيل شُغّلت فنزيل دالة اختيار الطالب)
drop function if exists public.kal_student_set_nick(text, text);

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
             case when (st.data ->> 'sentencePts') ~ '^[0-9]{1,6}$' then (st.data ->> 'sentencePts')::int else 0 end as sents
        from kalimati.students st
       where st.nick is not null
    ) t;
  return jsonb_build_object('ok', true, 'rows', rows);
end $$;

-- صلاحيات الدوال الجديدة
revoke all on function public.kal_teacher_set_nick(text, text, text) from public;
grant execute on function public.kal_teacher_set_nick(text, text, text) to anon, authenticated;
revoke all on function public.kal_leaderboard(text) from public;
grant execute on function public.kal_leaderboard(text) to anon, authenticated;
