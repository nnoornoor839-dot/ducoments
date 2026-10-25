-- ترحيل: خمس محاولات لكل جملة في اليوم (تُفتح من جديد في اليوم التالي، وتُحتسب أعلى درجة). الصقه كاملًا في Supabase ← SQL Editor ← Run (آمن للتكرار).
-- يتطلب أن تكون ترحيلات قراءة الجمل (2026-10-shadowing / shadow-tries / recordings) قد شُغّلت قبله.
-- لا حاجة لإعادة نشر دالة shadow: الواجهة نفسها (kal_shadow_gate / kal_shadow_count) والمُخرجات نفسها.

-- n يبقى العدّاد الكلي (يرقّم ملفات التسجيل فلا يُكتب فوق تسجيل يوم سابق)، وللعدّاد اليومي عمودان
alter table kalimati.shadow_tries add column if not exists day date;
alter table kalimati.shadow_tries add column if not exists today_n int not null default 0;

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

-- صلاحيات الدالتين محفوظة بعد إعادة الإنشاء؛ نعيد منحها احتياطًا
revoke all on function public.kal_shadow_gate(text, text) from public;
grant execute on function public.kal_shadow_gate(text, text) to anon, authenticated;
revoke all on function public.kal_shadow_count(text, text, boolean, text, text) from public;
grant execute on function public.kal_shadow_count(text, text, boolean, text, text) to anon, authenticated;
