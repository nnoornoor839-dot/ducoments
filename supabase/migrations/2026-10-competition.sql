-- ترحيل: المنافسة (الألقاب والترتيب). الصقه كاملًا في Supabase ← SQL Editor ← Run (آمن للتكرار).

-- 1) لقب الطالب: فريد بين كل الطلاب، ويختاره الطالب مرة واحدة
alter table kalimati.students add column if not exists nick text;
create unique index if not exists students_nick_uq on kalimati.students (nick) where nick is not null;

-- 2) بيانات الطالب تتضمن لقبه
create or replace function kalimati.student_json(st kalimati.students) returns jsonb
language sql immutable set search_path = '' as $$
  select st.data || jsonb_build_object('id', st.id, 'name', st.name, 'grade', st.grade, 'pin', st.pin, 'epoch', st.epoch, 'nick', st.nick)
$$;

-- 3) اختيار اللقب: مرة واحدة فقط، والمأخوذ لا يُعطى لغيره
create or replace function public.kal_student_set_nick(p_token text, p_nick text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare sid text; cur text;
begin
  sid := kalimati.student_of(p_token);
  if sid is null then return jsonb_build_object('error', 'auth'); end if;
  if p_nick is null or p_nick !~ '^[a-z]{3,20}$' then return jsonb_build_object('error', 'bad'); end if;
  select s.nick into cur from kalimati.students s where s.id = sid;
  if cur is not null then return jsonb_build_object('error', 'locked', 'nick', cur); end if;
  begin
    update kalimati.students set nick = p_nick, updated_at = now() where id = sid;
  exception when unique_violation then
    return jsonb_build_object('error', 'taken');
  end;
  return jsonb_build_object('ok', true, 'nick', p_nick);
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
revoke all on function public.kal_student_set_nick(text, text) from public;
grant execute on function public.kal_student_set_nick(text, text) to anon, authenticated;
revoke all on function public.kal_leaderboard(text) from public;
grant execute on function public.kal_leaderboard(text) to anon, authenticated;
