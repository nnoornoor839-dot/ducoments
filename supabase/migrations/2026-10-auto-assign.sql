-- ترحيل: الإسناد التلقائي. الصقه كاملًا في Supabase ← SQL Editor ← Run (آمن للتكرار).

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
   where e.key in ('xp', 'streak', 'lastActive', 'daily', 'words', 'units', 'log', 'reps', 'ranges');
  update kalimati.students set data = data || clean, updated_at = now() where id = sid;
  return jsonb_build_object('ok', true);
end $$;

-- صلاحيات الدالة الجديدة (kal_config و kal_student_save محفوظة صلاحياتهما)
revoke all on function public.kal_teacher_set_assign_n(text, jsonb) from public;
grant execute on function public.kal_teacher_set_assign_n(text, jsonb) to anon, authenticated;
