-- ترحيل: جولات المنافسة (كل 10 أيام) ومتميز الجولة وسحب الجوائز.
-- الصقه كاملًا في Supabase ← SQL Editor ← Run (آمن للتكرار). يتطلب ترحيل الألقاب (nick) الموجود في schema.sql.
--
-- الفكرة:
--   * المعلم يبدأ الجولة الأولى بزر؛ كل جولة 10 أيام (بتوقيت الرياض) ثم تبدأ التي بعدها تلقائيًا.
--   * عند بداية كل جولة تُحفظ نقاط كل طالب (له لقب)؛ ترتيب الجولة بالفرق عنها كنسبة من منهج صفه.
--   * تُغلق الجولة تلقائيًا في الخادم عند أول طلب بعد انتهائها، ويُعلن المتميز إن بلغ الحد الأدنى (5% افتراضيًا).
--   * المتميز يسحب جائزته مرة واحدة، والسحب عشوائي في الخادم من جوائز المعلم (كل جائزة تُستهلك بعد سحبها).

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
