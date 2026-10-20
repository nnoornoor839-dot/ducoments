-- ترحيل: حفظ تسجيلات الطلاب ليسمعها المعلم. الصقه كاملًا في Supabase ← SQL Editor ← Run (آمن للتكرار).
-- يتطلب أن يكون ترحيل المحاولات (2026-10-shadow-tries.sql) قد شُغّل قبله.

-- 1) مساحة تخزين خاصة (لا يصل إليها إلا الخادم، ويصل المعلم عبر روابط مؤقتة)
insert into storage.buckets (id, name, public) values ('shadow', 'shadow', false)
  on conflict (id) do update set public = false;

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

-- 3) العدّ يسجّل أيضًا مسار الملف والنص المسموع
drop function if exists public.kal_shadow_count(text, text, boolean);
create or replace function public.kal_shadow_count(p_token text, p_wid text, p_try boolean, p_text text default '', p_ext text default 'webm') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare sid text; today date; tries int := 0; fpath text := null; ext text;
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
    ext := case when coalesce(p_ext, '') ~ '^[a-z0-9]{2,4}$' then p_ext else 'webm' end;
    fpath := sid || '/' || regexp_replace(p_wid, '[^A-Za-z0-9._-]', '_', 'g') || '/' || tries || '.' || ext;
    insert into kalimati.shadow_clips (student_id, wid, n, path, heard)
      values (sid, p_wid, tries, fpath, left(coalesce(p_text, ''), 400))
      on conflict (student_id, wid, n) do update set path = excluded.path, heard = excluded.heard, at = now();
  else
    select t.n into tries from kalimati.shadow_tries t where t.student_id = sid and t.wid = p_wid;
  end if;
  return jsonb_build_object('ok', true, 'tries', coalesce(tries, 0), 'path', fpath);
end $$;

-- 4) للمعلم: قائمة تسجيلات طالب (تستدعيها دالة Edge لإنشاء روابط الاستماع)
create or replace function public.kal_teacher_clips(p_token text, p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not kalimati.is_teacher(p_token) then return jsonb_build_object('error', 'auth'); end if;
  return jsonb_build_object('ok', true, 'clips', coalesce((
    select jsonb_agg(jsonb_build_object('wid', c.wid, 'n', c.n, 'path', c.path, 'heard', c.heard, 'at', c.at) order by c.wid, c.n)
      from kalimati.shadow_clips c where c.student_id = p_id), '[]'::jsonb));
end $$;

-- 5) تصفير التقدم يمسح فهرس التسجيلات (والملفات تُحذف قبلها عبر دالة Edge)
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

revoke all on function public.kal_shadow_count(text, text, boolean, text, text) from public;
grant execute on function public.kal_shadow_count(text, text, boolean, text, text) to anon, authenticated;
revoke all on function public.kal_teacher_clips(text, text) from public;
grant execute on function public.kal_teacher_clips(text, text) to anon, authenticated;
