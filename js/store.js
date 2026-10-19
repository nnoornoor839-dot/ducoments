// المنهج + حفظ بيانات الطلاب.
// التخزين المحلي (localStorage) هو الأساس. وإن فُعِّل الربط السحابي (js/config.js) يتزامن معه Supabase.

// ---------- المنهج ----------
const Cur = (() => {
  let data = { grades: [] };
  let index = {};
  const WORD_FIELDS = ['sentence', 'sentenceAr', 'page', 'form', 'key'];
  const unitNumOf = u => parseInt(String(u.id).replace(/\D/g, ''), 10) || 0;

  // يبني المنهج من مصدر (نسخة عميقة) ويعطي كل كلمة معرّفًا ثابتًا
  function build(src) {
    data = JSON.parse(JSON.stringify(src || { grades: [] }));
    index = {};
    data.grades.forEach(g => {
      g.units = g.units || [];
      g.units.forEach(u => { u.gradeId = g.id; if (u.num === undefined) u.num = unitNumOf(u); });
      g.units.sort((a, b) => a.num - b.num);
      g.units.forEach(u => (u.words = u.words || []).forEach(w => {
        const base = w.key || U.slug(w.en);
        let id = `${g.id}.${u.id}.${base}`;
        for (let i = 2; index[id]; i++) id = `${g.id}.${u.id}.${base}-${i}`;
        w.id = id; w.gradeId = g.id; w.unitId = u.id;
        index[id] = w;
      }));
    });
  }

  // أين تقع العبارة في الجملة؟ يُرجع النص كما كُتب في الجملة أو null
  function findIn(sentence, phrase) {
    const re = new RegExp('(^|[^A-Za-z])(' + U.escRe(phrase) + ')(?![A-Za-z])', 'i');
    const m = re.exec(sentence);
    return m ? { index: m.index + m[1].length, text: m[2] } : null;
  }

  const IRREGULAR = {
    go: ['goes', 'went', 'gone', 'going'], have: ['has', 'had', 'having'],
    be: ['is', 'are', 'am', 'was', 'were', 'been', 'being'], do: ['does', 'did', 'done', 'doing'],
    eat: ['ate', 'eaten'], see: ['saw', 'seen'], take: ['took', 'taken'], come: ['came'],
    get: ['got'], make: ['made'], write: ['wrote', 'written'], run: ['ran', 'running'],
    buy: ['bought'], give: ['gave', 'given'], know: ['knew', 'known'], sit: ['sat', 'sitting'],
    swim: ['swam', 'swimming'], drink: ['drank', 'drunk'], wake: ['woke', 'woken'],
    child: ['children'], man: ['men'], woman: ['women'], foot: ['feet'], mouse: ['mice']
  };

  // الكلمة قد ترد بصيغة مختلفة في الجملة (eat -> eats). نحاول تخمينها تلقائيًا.
  // يُرجع {found, form}: form فارغ إن كانت الكلمة موجودة كما هي.
  function guessForm(en, sentence) {
    if (!sentence || !en) return { found: false, form: '' };
    if (findIn(sentence, en)) return { found: true, form: '' };
    const parts = en.trim().split(/\s+/);
    const first = parts[0].toLowerCase();
    const rest = parts.slice(1).join(' ');
    const stems = new Set(['s', 'es', 'ed', 'd', 'ing', 'er', 'est', 'ly'].map(x => first + x));
    if (/y$/.test(first)) ['ies', 'ied', 'ier', 'iest'].forEach(x => stems.add(first.slice(0, -1) + x));
    if (/e$/.test(first)) stems.add(first.slice(0, -1) + 'ing');
    const last = first.slice(-1);
    stems.add(first + last + 'ing'); stems.add(first + last + 'ed'); stems.add(first + last + 'er');
    (IRREGULAR[first] || []).forEach(x => stems.add(x));
    for (const st of stems) {
      const hit = findIn(sentence, rest ? st + ' ' + rest : st);
      if (hit) return { found: true, form: hit.text };
    }
    return { found: false, form: '' };
  }

  build(window.CURRICULUM);

  return {
    get grades() { return data.grades; },
    grade: id => data.grades.find(g => g.id === id),
    unit: (gid, uid) => (data.grades.find(g => g.id === gid) || { units: [] }).units.find(u => u.id === uid),
    word: id => index[id],
    allWords: g => g.units.flatMap(u => u.words),
    reload: build,
    guessForm,
    // نسخة نظيفة قابلة للحفظ (بدون الحقول المحسوبة وقت التشغيل)
    snapshot() {
      return {
        grades: data.grades.map(g => ({
          id: g.id, name: g.name, short: g.short,
          units: g.units.map(u => ({
            id: u.id, title: u.title, num: u.num,
            words: u.words.map(w => {
              const o = { en: w.en, ar: w.ar || '' };
              WORD_FIELDS.forEach(k => { if (w[k]) o[k] = w[k]; });
              return o;
            })
          }))
        }))
      };
    },
    // الجملة مقسّمة حول الكلمة: {before, match, after} أو null
    blank(w) {
      if (!w.sentence) return null;
      const hit = findIn(w.sentence, w.form || w.en);
      if (!hit) return null;
      return { before: w.sentence.slice(0, hit.index), match: hit.text, after: w.sentence.slice(hit.index + hit.text.length) };
    }
  };
})();

// ---------- منطق التقدم (دوال نقية) ----------
const Progress = (() => {
  const LEVELS = ['مبتدئ', 'مستكشف', 'متعلم', 'ماهر', 'بطل', 'خبير', 'أسطورة'];
  const INTERVAL_DAYS = [0, 0.25, 1, 3, 7];  // موعد المراجعة حسب مستوى الحفظ
  const DAILY_GOAL = 10;
  const MASTERED_BOX = 3;

  function wordStatus(s, wid) {
    const r = s.words[wid];
    if (!r || !r.seen) return 'new';
    // محفوظة = أجاب صح من أول محاولة في آخر اختبار شمل هذه الكلمة
    const w = Cur.word(wid);
    if (!w) return 'learning';
    const key = w.gradeId + '.' + w.unitId;
    const ut = s.units && s.units[key];
    const lt = ut && ut.lastTest;
    if (!lt || !lt.tested) return 'learning';
    if (lt.tested.indexOf(wid) < 0) return 'learning'; // أُسندت بعد آخر اختبار
    if (lt.wrong && lt.wrong.indexOf(wid) >= 0) return 'learning';
    return 'mastered';
  }
  // النطاق المسند للطالب في وحدة: [من، إلى، نهاية الإسناد السابق] أو null إن لم يُسند شيء
  function rangeOf(s, unit) {
    const r = s.ranges && s.ranges[unit.gradeId + '.' + unit.id];
    if (!r || !(r[1] >= r[0]) || r[1] < 1) return null;
    const total = unit.words.length;
    const from = Math.max(1, r[0]);
    const to = Math.min(total, r[1]);
    if (to < from) return null;
    const prev = r[2] >= from - 1 && r[2] < to ? r[2] : to;
    return [from, to, prev];
  }
  // الكلمات المسندة (بالترتيب) مع رقم كل كلمة في قائمة الوحدة وهل هي جديدة
  function assigned(s, unit) {
    const r = rangeOf(s, unit);
    if (!r) return [];
    return unit.words.slice(r[0] - 1, r[1]).map((w, i) => ({ w, n: r[0] + i, isNew: r[0] + i > r[2] }));
  }
  // الدفعة الحالية: آخر كلمات أُسندت للطالب. النطاق القديم (بلا كلمات جديدة) يُعدّ دفعة واحدة كاملة.
  function batchOf(s, unit) {
    const r = rangeOf(s, unit);
    if (!r) return [];
    const start = r[2] < r[1] ? r[2] : r[0] - 1;
    return unit.words.slice(start, r[1]);
  }
  // هل أنجز الطالب دفعته؟ كلها اختُبرت ولا كلمة خاطئة معلّقة في الحصالة
  function batchCleared(s, unit) {
    const b = batchOf(s, unit);
    if (!b.length) return false;
    const ut = s.units && s.units[unit.gradeId + '.' + unit.id];
    const lt = ut && ut.lastTest;
    if (!lt || !lt.tested) return false;
    return b.every(w => lt.tested.indexOf(w.id) >= 0 && !(lt.wrong && lt.wrong.indexOf(w.id) >= 0));
  }
  function unitStats(s, unit) {
    let mastered = 0, learning = 0, fresh = 0;
    const list = assigned(s, unit);
    list.forEach(({ w }) => {
      const st = wordStatus(s, w.id);
      if (st === 'mastered') mastered++; else if (st === 'learning') learning++; else fresh++;
    });
    const total = list.length;
    const key = unit.gradeId + '.' + unit.id;
    const ut = s.units && s.units[key];
    const lt = ut && ut.lastTest;
    return { total, mastered, learning, fresh, all: unit.words.length, pct: total ? Math.round(mastered / total * 100) : 0, lastTest: lt || null };
  }
  function gradeStats(s, grade) {
    const t = { total: 0, mastered: 0, learning: 0, fresh: 0, pct: 0 };
    grade.units.forEach(u => {
      const x = unitStats(s, u);
      t.total += x.total; t.mastered += x.mastered; t.learning += x.learning; t.fresh += x.fresh;
    });
    t.pct = t.total ? Math.round(t.mastered / t.total * 100) : 0;
    return t;
  }
  function dueWords(s, grade) {
    const now = Date.now();
    return Cur.allWords(grade)
      .filter(w => { const r = s.words[w.id]; return r && r.seen && r.due <= now; })
      .sort((a, b) => s.words[a.id].box - s.words[b.id].box);
  }
  function levelInfo(xp) {
    const level = Math.floor(xp / 100) + 1;
    return { level, title: LEVELS[Math.min(level - 1, LEVELS.length - 1)], into: xp % 100, size: 100 };
  }
  // السلسلة الفعلية: تنقطع إن مرّ أكثر من يوم دون نشاط
  function streak(s) {
    if (!s.lastActive) return 0;
    return U.dayDiff(s.lastActive, U.ymd()) <= 1 ? s.streak : 0;
  }
  function dailyCount(s) { return s.daily && s.daily.date === U.ymd() ? s.daily.n : 0; }
  function starsFor(correct, total) {
    if (!total) return 0;
    const acc = correct / total;
    return acc >= 0.9 ? 3 : acc >= 0.7 ? 2 : acc >= 0.5 ? 1 : 0;
  }
  // كلمات يكثر فيها الخطأ (للمعلم)
  function hardWords(s, limit = 10) {
    return Object.entries(s.words)
      .filter(([id, r]) => r.wrong > 0 && Cur.word(id))
      .sort((a, b) => (b[1].wrong - a[1].wrong) || (a[1].box - b[1].box))
      .slice(0, limit)
      .map(([id, r]) => ({ word: Cur.word(id), wrong: r.wrong, seen: r.seen }));
  }

  // ملخص النشاط: أيام النشاط، عدد الاختبارات، مجموع التكرار
  function activitySummary(s) {
    const days = new Set();
    if (s.lastActive) days.add(s.lastActive);
    (s.log || []).forEach(l => { if (l.t) days.add(U.ymd(new Date(l.t))); });
    const tests = (s.log || []).filter(l => l.mode && l.mode !== 'reps').length;
    const reps = (s.reps && s.reps.total) || 0;
    return { days: days.size, tests, reps };
  }

  return { LEVELS, DAILY_GOAL, wordStatus, rangeOf, assigned, batchOf, batchCleared, unitStats, gradeStats, dueWords, levelInfo, streak, dailyCount, starsFor, hardWords, activitySummary, INTERVAL_DAYS };
})();

// ---------- التخزين ----------
const Store = (() => {
  const KEY = 'kalimati.v1';
  const TOKEN_KEY = 'kalimati.ttoken';
  const PROGRESS_KEYS = ['xp', 'streak', 'lastActive', 'daily', 'words', 'units', 'log', 'reps', 'ranges'];
  // عدد الكلمات المسندة في كل مرة حسب الصف (يغيّره المعلم من الإعدادات)
  const ASSIGN_KEY = 'kalimati.assignByGrade';
  const ASSIGN_DEFAULT = { t1: 5, g5: 5, g6: 10, m2: 10 };
  const ASSIGN_MAX = 30;
  function assignMap() {
    try { const m = JSON.parse(U.lsGet(ASSIGN_KEY, '{}')); return m && typeof m === 'object' ? m : {}; } catch (e) { return {}; }
  }
  function assignN(gid) {
    const v = Number(assignMap()[gid]);
    return Number.isInteger(v) && v >= 1 && v <= ASSIGN_MAX ? v : (ASSIGN_DEFAULT[gid] || 10);
  }
  const cloud = Cloud.enabled;
  let state = null;
  let online = true;      // هل نجح آخر اتصال بالسحابة؟
  let backoffUntil = 0;   // بعد فشل الاتصال نتوقف لحظات كي لا يتباطأ التنقل
  let lastPull = 0;
  let flushing = null;
  let flushTimer = null;
  let memToken = '';

  function fresh() { return { v: 1, teacher: null, students: {}, session: null, outbox: [] }; }
  function load() {
    try { state = JSON.parse(U.lsGet(KEY) || 'null') || fresh(); } catch (e) { state = fresh(); }
    if (!state.students) state.students = {};
    if (!state.outbox) state.outbox = [];
  }
  function save() { U.lsSet(KEY, JSON.stringify(state)); }
  load();

  const blank = () => ({ xp: 0, streak: 0, lastActive: null, daily: { date: '', n: 0 }, words: {}, units: {}, log: [] });
  const normalize = s => Object.assign(blank(), s);
  const withTimeout = (p, ms) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });

  // ---- رمز جلسة المعلم (يبقى في التبويب الحالي فقط) ----
  function teacherToken() {
    if (memToken) return memToken;
    try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }
  function setTeacherToken(t) {
    memToken = t || '';
    try { if (t) sessionStorage.setItem(TOKEN_KEY, t); else sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* تجاهل */ }
  }
  function setLocalTeacherAuthed(v) {
    try { sessionStorage.setItem('kalimati.teacher', v ? '1' : '0'); } catch (e) { /* تجاهل */ }
  }

  // ---- المزامنة: صندوق صادر لعمليات تُعاد محاولتها حتى تنجح (عملية واحدة لكل key) ----
  function queue(job) {
    if (!cloud) return;
    state.outbox = state.outbox.filter(j => j.key !== job.key);
    state.outbox.push(job);
    save();
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 1500);
  }
  const pending = key => state.outbox.some(j => j.key === key);

  // تقدم الطالب يُرفع كاملًا في كل مرة؛ آخر نسخة تحلّ محل ما قبلها
  function commitStudent(sid) {
    const s = state.students[sid];
    const sess = state.session;
    if (!cloud || !s || !sess || sess.role !== 'student' || sess.id !== sid || !sess.token) { save(); return; }
    const patch = {};
    PROGRESS_KEYS.forEach(k => { if (s[k] !== undefined) patch[k] = s[k]; });
    queue({ key: 'student:' + sid, op: 'student_save', token: sess.token, sid, epoch: s.epoch || 0, patch });
  }

  function runJob(job) {
    if (job.op === 'student_save') {
      return Cloud.rpc('kal_student_save', { p_token: job.token, p_patch: job.patch, p_epoch: job.epoch }, 10000);
    }
    const tok = teacherToken();
    if (job.op === 'range') {
      return Cloud.rpc('kal_teacher_patch', { p_token: tok, p_id: job.sid, p_patch: { ranges: { [job.rk]: job.range } } }, 10000);
    }
    if (job.op === 'retry') return Cloud.rpc('kal_teacher_set_retry', { p_token: tok, p_n: job.n }, 10000);
    if (job.op === 'assign_n') return Cloud.rpc('kal_teacher_set_assign_n', { p_token: tok, p_data: job.map }, 10000);
    if (job.op === 'curriculum') return Cloud.rpc('kal_teacher_set_curriculum', { p_token: tok, p_data: job.data }, 15000);
    return Promise.resolve({ error: 'bad' });
  }

  function dropStudentSession(sid, token) {
    if (state.session && state.session.token === token) {
      state.session = null;
      delete state.students[sid];
    }
  }

  // يُرجع false إن فشل الاتصال (تبقى العمليات للمحاولة لاحقًا). عمليات المعلم تُؤجَّل إن لم يكن مسجّلًا للدخول.
  function flush() {
    if (!cloud) return Promise.resolve(true);
    if (flushing) return flushing;
    flushing = (async () => {
      for (const job of state.outbox.slice()) {
        if (job.op !== 'student_save' && !teacherToken()) continue;
        let res;
        try {
          res = await runJob(job);
        } catch (e) {
          online = false;
          const rejected = e.status >= 400 && e.status < 500 && ![401, 403, 404, 408, 429].includes(e.status);
          if (!rejected) return false;
          res = { error: 'rejected' };
        }
        online = true;
        if (res && res.error === 'auth' && job.op !== 'student_save') { setTeacherToken(''); return false; }
        if (res && res.error === 'auth') dropStudentSession(job.sid, job.token);
        else if (res && res.error === 'stale' && res.student) state.students[job.sid] = normalize(res.student);
        else if (res && res.ok && job.op === 'curriculum') state.curriculumAt = res.curriculum_at || undefined;
        else if (res && res.error) console.warn('kalimati: تم تجاهل عملية مزامنة', job.op, res.error);
        state.outbox = state.outbox.filter(j => j !== job);
        save();
      }
      return true;
    })().finally(() => { flushing = null; });
    return flushing;
  }

  async function pullStudent() {
    const sess = state.session;
    if (!(await flush())) throw new Error('offline');
    const r = await Cloud.rpc('kal_student_get', { p_token: sess.token }, 5000);
    if (r.error === 'auth') { dropStudentSession(sess.id, sess.token); save(); return; }
    if (r.ok) { state.students[r.student.id] = normalize(r.student); save(); }
  }

  async function pullAll() {
    if (!(await flush())) throw new Error('offline');
    const r = await Cloud.rpc('kal_teacher_list', { p_token: teacherToken() }, 5000);
    if (r.error === 'auth') { setTeacherToken(''); return; }
    if (r.ok) {
      state.students = {};
      r.students.forEach(s => { state.students[s.id] = normalize(s); });
      save();
    }
  }

  // يجلب أحدث بيانات من السحابة (بمهلة قصيرة) ويكتفي بالنسخة المحلية إن تعذّر
  async function refresh(force) {
    if (!cloud) return;
    if (!force && (Date.now() < backoffUntil || Date.now() - lastPull < 15000)) return;
    const sess = state.session;
    const asTeacher = !!teacherToken();
    if (!asTeacher && !(sess && sess.role === 'student' && sess.token)) return;
    try {
      await withTimeout(asTeacher ? pullAll() : pullStudent(), 6000);
      lastPull = Date.now();
      online = true;
    } catch (e) {
      online = false;
      backoffUntil = Date.now() + 30000;
    }
  }

  // عملية للمعلم تُنفَّذ فورًا (إضافة/حذف/تصفير/تعديل رمز) ويُعرف نجاحها قبل تغيير النسخة المحلية
  async function teacherCall(fn, args) {
    const tok = teacherToken();
    if (!tok) return { error: 'auth' };
    let r;
    try {
      r = await Cloud.rpc(fn, { p_token: tok, ...args });
      online = true;
    } catch (e) {
      online = false;
      return { error: e.status ? 'server' : 'offline' };
    }
    if (r && r.error === 'auth') setTeacherToken('');
    return r || { error: 'server' };
  }

  async function cloudAuth(fn, pass) {
    let r;
    try {
      r = await Cloud.rpc(fn, { p_pass: pass });
      online = true;
    } catch (e) {
      online = false;
      return { error: e.status ? 'server' : 'offline' };
    }
    if (!r || !r.ok) return { error: (r && r.error) || 'server' };
    setTeacherToken(r.token);
    lastPull = 0; backoffUntil = 0;
    await init();
    flush();
    return { ok: true };
  }

  // إعدادات عامة ومنهج المعلم من السحابة. يُرجع true إن تغيّر المنهج.
  async function init() {
    if (!cloud) return false;
    let c;
    try {
      c = await Cloud.rpc('kal_config', { p_curriculum_at: state.curriculumAt || null }, 6000);
      online = true;
    } catch (e) {
      online = false;
      return false;
    }
    if (!pending('retry')) U.lsSet('kalimati.retryMax', String(c.retry_max));
    if (!pending('assign_n') && c.assign_n && typeof c.assign_n === 'object') U.lsSet(ASSIGN_KEY, JSON.stringify(c.assign_n));
    let changed = false;
    if (!pending('curriculum')) {
      if (c.curriculum_set) {
        if (c.curriculum) {
          state.curriculum = c.curriculum;
          state.curriculumBase = (window.CURRICULUM || {}).version || '';
          state.curriculumAt = c.curriculum_at;
          changed = true;
        }
      } else if (state.curriculumAt) {
        delete state.curriculum; delete state.curriculumBase; delete state.curriculumAt;
        changed = true;
      } else if (state.curriculum && teacherToken()) {
        queue({ key: 'curriculum', op: 'curriculum', data: state.curriculum });
      }
    }
    if (changed) { save(); Cur.reload(state.curriculum || window.CURRICULUM); }
    return changed;
  }

  if (cloud) {
    window.addEventListener('online', () => { backoffUntil = 0; flush(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  }

  // تشفير بسيط جدًا لكلمة مرور المعلم في الوضع المحلي فقط (مع السحابة تُحفظ مشفّرة على الخادم)
  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return String(h);
  }
  // أي نشاط حقيقي اليوم يحافظ على السلسلة
  function touchStreak(s, today) {
    if (s.lastActive !== today) {
      s.streak = s.lastActive && U.dayDiff(s.lastActive, today) === 1 ? s.streak + 1 : 1;
      s.lastActive = today;
    }
  }
  function newStudent({ name, grade, pin, demo }) {
    return {
      id: 's' + U.rid(), name: name.trim(), grade, pin: String(pin),
      createdAt: new Date().toISOString(), demo: !!demo,
      xp: 0, streak: 0, lastActive: null, daily: { date: '', n: 0 },
      words: {}, units: {}, log: []
    };
  }

  // ---- الإسناد التلقائي ----
  // يُسند الدفعة التالية متى أنجز الطالب دفعته الحالية (اجتاز اختبارها بلا أخطاء، أو أفرغ الحصالة باختبارها 100%).
  // بعد آخر دفعة في الوحدة تبدأ أول دفعة من الوحدة التالية بترتيب المنهج.
  // يُرجع {unitId, count, newUnit} إن أُسندت كلمات، أو {done:true} إن أنهى كل وحدات صفه، أو null إن بقي في دفعته.
  function setAuto(s, gid, unit, from, to, prev) {
    if (!s.ranges) s.ranges = {};
    s.ranges[gid + '.' + unit.id] = [from, to, prev];
  }
  function advance(sid) {
    const s = state.students[sid];
    const grade = s && Cur.grade(s.grade);
    if (!grade) return null;
    const n = assignN(grade.id);
    const units = grade.units.filter(u => u.words.length);
    // الوحدة الجارية: أول وحدة مسندة لم تنتهِ دفعاتها
    let cur = null;
    for (const u of units) {
      const r = Progress.rangeOf(s, u);
      if (r && !(r[1] >= u.words.length && Progress.batchCleared(s, u))) { cur = { u, r }; break; }
    }
    if (cur) {
      if (!Progress.batchCleared(s, cur.u)) return null;
      const to = Math.min(cur.u.words.length, cur.r[1] + n);
      setAuto(s, grade.id, cur.u, cur.r[0], to, cur.r[1]);
      commitStudent(sid);
      return { unitId: cur.u.id, count: to - cur.r[1], newUnit: false };
    }
    const next = units.find(u => !Progress.rangeOf(s, u));
    if (!next) return { done: true };
    const to = Math.min(next.words.length, n);
    setAuto(s, grade.id, next, 1, to, 0);
    commitStudent(sid);
    return { unitId: next.id, count: to, newUnit: true };
  }

  return {
    // الجلسة (الطالب يبقى مسجّلًا على جهازه؛ المعلم يحتاج دخولًا جديدًا في كل تبويب)
    getSession() {
      const sess = state.session;
      // جلسة طالب قديمة بلا رمز من الخادم لا تصلح مع السحابة
      if (cloud && sess && sess.role === 'student' && !sess.token) { state.session = null; save(); return null; }
      return sess;
    },
    clearSession() { state.session = null; save(); },
    teacherAuthed() {
      if (cloud) return !!teacherToken();
      try { return sessionStorage.getItem('kalimati.teacher') === '1'; } catch (e) { return false; }
    },

    // حالة حساب المعلم: true (موجود) | false (لم يُنشأ بعد) | {error} إن تعذّر الاتصال
    async teacherStatus() {
      if (!cloud) return !!state.teacher;
      try {
        const c = await Cloud.rpc('kal_config', { p_curriculum_at: state.curriculumAt || null }, 8000);
        online = true;
        return !!c.has_teacher;
      } catch (e) {
        online = false;
        return { error: e.status ? 'server' : 'offline' };
      }
    },
    async teacherSetup(pass) {
      if (cloud) return cloudAuth('kal_teacher_setup', pass);
      if (String(pass).length < 4) return { error: 'short' };
      state.teacher = { pass: hash(pass) }; save();
      setLocalTeacherAuthed(true);
      return { ok: true };
    },
    async teacherLogin(pass) {
      if (cloud) return cloudAuth('kal_teacher_login', pass);
      if (!state.teacher || state.teacher.pass !== hash(pass)) return { error: 'bad-password' };
      setLocalTeacherAuthed(true);
      return { ok: true };
    },
    async teacherLogout() {
      if (!cloud) { setLocalTeacherAuthed(false); return; }
      const tok = teacherToken();
      if (tok) {
        try { await withTimeout(flush(), 4000); } catch (e) { /* نكمل الخروج */ }
        setTeacherToken('');
        Cloud.rpc('kal_teacher_logout', { p_token: tok }, 4000).catch(() => {});
      }
      // لا نُبقي بيانات بقية الطلاب على هذا الجهاز بعد خروج المعلم
      const keep = state.session && state.session.role === 'student' ? state.students[state.session.id] : null;
      state.students = keep ? { [keep.id]: keep } : {};
      save();
    },

    // حالة المزامنة لعرضها للمعلم
    syncState() { return { cloud, online, pending: state.outbox.length }; },
    init,
    flush,

    async listStudents() {
      await refresh(true);
      return Object.values(state.students);
    },
    async getStudent(id) {
      await refresh();
      return state.students[id] || null;
    },
    async addStudent(info) {
      if (!this.isPinUnique(info.grade, info.pin)) return { error: 'pin-taken' };
      const s = newStudent(info);
      if (cloud) {
        const r = await teacherCall('kal_teacher_add', { p_student: s });
        if (r.error) return { error: r.error };
      }
      state.students[s.id] = s; save();
      return s;
    },
    async updateStudent(id, patch) {
      if (cloud) {
        const r = await teacherCall('kal_teacher_patch', { p_id: id, p_patch: patch });
        if (r.error) return { error: r.error };
      }
      if (state.students[id]) { Object.assign(state.students[id], patch); save(); }
      return state.students[id] || null;
    },
    async deleteStudent(id) {
      if (cloud) {
        const r = await teacherCall('kal_teacher_delete', { p_id: id });
        if (r.error) return { error: r.error };
      }
      delete state.students[id];
      if (state.session && state.session.id === id) state.session = null;
      save();
      return { ok: true };
    },
    async resetProgress(id) {
      const s = state.students[id];
      if (!s) return { error: 'not-found' };
      if (cloud) {
        const r = await teacherCall('kal_teacher_reset', { p_id: id });
        if (r.error) return { error: r.error };
        s.epoch = (s.epoch || 0) + 1;
      }
      Object.assign(s, { xp: 0, streak: 0, lastActive: null, daily: { date: '', n: 0 }, words: {}, units: {}, log: [], reps: { total: 0, byWord: {}, daily: { date: '', n: 0 } } });
      save();
      return { ok: true };
    },
    // يُرجع الطالب، أو null (رمز خاطئ)، أو {error: 'rate-limited' | 'offline' | 'server'}
    async loginByPin(gradeId, pin) {
      const p = String(pin).trim();
      if (cloud) {
        let r;
        try {
          r = await Cloud.rpc('kal_student_login', { p_grade: gradeId, p_pin: p });
          online = true;
        } catch (e) {
          online = false;
          return { error: e.status ? 'server' : 'offline' };
        }
        if (r.error === 'rate-limited') return { error: 'rate-limited' };
        if (!r.ok) return null;
        const s = normalize(r.student);
        state.students[s.id] = s;
        state.session = { role: 'student', id: s.id, token: r.token };
        lastPull = Date.now();
        save();
        return s;
      }
      const s = Object.values(state.students).find(s => s.grade === gradeId && s.pin === p);
      if (!s) return null;
      state.session = { role: 'student', id: s.id }; save();
      return s;
    },
    isPinUnique(gradeId, pin, excludeId) {
      const p = String(pin).trim();
      return !Object.values(state.students).some(s => s.grade === gradeId && s.pin === p && s.id !== excludeId);
    },

    // الإسناد تلقائي: ensureStarted يُسند أول دفعة لطالب لم يبدأ، و advance يُسند التالية عند إنجاز الدفعة
    ensureStarted(sid) {
      const s = state.students[sid], grade = s && Cur.grade(s.grade);
      if (!grade || grade.units.some(u => Progress.rangeOf(s, u))) return null;
      return advance(sid);
    },
    advance,
    getAssignN(gid) { return assignN(gid); },
    setAssignN(gid, n) {
      const v = Math.min(ASSIGN_MAX, Math.max(1, Math.round(Number(n)) || 1));
      const map = assignMap();
      map[gid] = v;
      U.lsSet(ASSIGN_KEY, JSON.stringify(map));
      queue({ key: 'assign_n', op: 'assign_n', map });
      return v;
    },

    // حصالة الكلمات: كلمات الطالب المسندة التي أخطأ فيها ولم يجتزها بعد في وحدة
    getWrongWords(s, gid, uid) {
      const unit = Cur.unit(gid, uid);
      if (!unit) return [];
      const ut = s.units && s.units[gid + '.' + uid];
      const wrong = (ut && ut.lastTest && ut.lastTest.wrong) || [];
      return Progress.assigned(s, unit).map(a => a.w).filter(w => wrong.indexOf(w.id) >= 0);
    },

    // عتبة إعادة الاختبار
    getRetryThreshold() { return Number(U.lsGet('kalimati.retryMax', '3')); },
    setRetryThreshold(n) {
      U.lsSet('kalimati.retryMax', String(n));
      queue({ key: 'retry', op: 'retry', n });
    },

    // ---- المنهج الذي يدخله المعلم (يُحفظ على الجهاز، ويُرفع للسحابة إن فُعِّلت) ----
    curriculumSource() { return state.curriculum || window.CURRICULUM; },
    isCustomCurriculum() { return !!state.curriculum; },
    // النسخة المحلية أقدم من الكلمات المضمّنة في التطبيق؟
    isCurriculumStale() { return !!state.curriculum && state.curriculumBase !== ((window.CURRICULUM || {}).version || ''); },
    saveCurriculum(data) {
      state.curriculum = data; state.curriculumBase = (window.CURRICULUM || {}).version || '';
      save(); Cur.reload(data);
      queue({ key: 'curriculum', op: 'curriculum', data });
    },
    resetCurriculum() {
      delete state.curriculum; delete state.curriculumBase;
      save(); Cur.reload(window.CURRICULUM);
      queue({ key: 'curriculum', op: 'curriculum', data: null });
    },

    // تسجيل مرات تكرار كلمة (للمعلم: كم كرّر الطالب)
    async recordReps(sid, wid, n) {
      const s = state.students[sid];
      if (!s || !n) return null;
      const today = U.ymd();
      const r = s.reps || (s.reps = { total: 0, byWord: {}, daily: { date: '', n: 0 } });
      r.total += n;
      r.byWord[wid] = (r.byWord[wid] || 0) + n;
      r.daily = { date: today, n: (r.daily.date === today ? r.daily.n : 0) + n };
      const xpGained = Math.min(20, Math.floor(n / 5));
      s.xp += xpGained;
      touchStreak(s, today);
      const w = Cur.word(wid);
      s.log.unshift({ t: Date.now(), mode: 'reps', gradeId: w ? w.gradeId : null, unitId: w ? w.unitId : null, wid, correct: n, total: n });
      s.log = s.log.slice(0, 60);
      commitStudent(sid);
      return { xpGained, total: r.total, today: r.daily.n };
    },

    // تسجيل إجابة واحدة على كلمة
    async recordAnswer(sid, wid, ok) {
      const s = state.students[sid];
      if (!s) return;
      const r = s.words[wid] || (s.words[wid] = { box: 0, seen: 0, correct: 0, wrong: 0, due: 0, last: 0 });
      r.seen++; r.last = Date.now();
      if (ok) { r.correct++; r.box = Math.min(4, r.box + 1); } else { r.wrong++; r.box = Math.max(0, r.box - 1); }
      r.due = Date.now() + Progress.INTERVAL_DAYS[r.box] * 864e5;
      commitStudent(sid);
    },

    // إنهاء جلسة لعب: يحدّث النقاط والسلسلة والنجوم والسجل
    async finishSession(sid, { mode, gradeId, unitId, correct, total, stars, wrongIds, testedIds }) {
      const s = state.students[sid];
      if (!s) return null;
      const before = Progress.levelInfo(s.xp).level;
      const today = U.ymd();
      const xpGained = correct * 10 + (total && correct / total >= 0.8 ? 20 : 0);
      s.xp += xpGained;

      touchStreak(s, today);
      // الهدف اليومي
      const wasDone = Progress.dailyCount(s) >= Progress.DAILY_GOAL;
      s.daily = { date: today, n: Progress.dailyCount(s) + correct };
      const goalReached = !wasDone && s.daily.n >= Progress.DAILY_GOAL;

      // أفضل نتيجة للوحدة + نتيجة آخر اختبار
      if (unitId && mode !== 'review') {
        const key = gradeId + '.' + unitId;
        const u = s.units[key] || (s.units[key] = { stars: 0, speedBest: 0 });
        if (mode === 'speed') u.speedBest = Math.max(u.speedBest || 0, correct);
        else if (mode !== 'bank') u.stars = Math.max(u.stars || 0, stars);
        if (testedIds) {
          // الاختبار على الدفعة الحالية فقط، فندمج نتيجته مع ما سبق بدل أن نستبدلها:
          // المختبَر يتراكم، والخطأ المعلّق يبقى حتى تُجاب الكلمة صحيحة في اختبار لاحق (اختبار الحصالة مثلًا)
          const old = u.lastTest || {};
          const tested = Array.from(new Set((old.tested || []).concat(testedIds)));
          const wrong = (old.wrong || []).filter(id => testedIds.indexOf(id) < 0).concat(wrongIds || []);
          u.lastTest = { date: today, correct, total, wrong, tested, sessionWrong: wrongIds || [] };
        }
      }
      s.log.unshift({ t: Date.now(), mode, gradeId, unitId: unitId || null, correct, total });
      s.log = s.log.slice(0, 60);
      // اجتياز الدفعة (أو اختبار الحصالة بنجاح) يُسند الدفعة التالية فورًا
      const advanced = (mode === 'dictation' || mode === 'bank') && s.grade === gradeId ? advance(sid) : null;
      commitStudent(sid);
      const after = Progress.levelInfo(s.xp);
      return { xpGained, streak: s.streak, levelUp: after.level > before ? after : null, goalReached, advanced };
    },

    // بيانات تجريبية لعرض لوحة المعلم
    async seedDemo() {
      const grade = Cur.grades.find(g => g.units.length) || Cur.grades[0];
      const names = [['سارة', 0, 0.9], ['عمر', 2, 0.55], ['ليان', 6, 0.25]];
      const made = [];
      names.forEach(([name, daysAgo, level], i) => {
        const s = newStudent({ name: name + ' (تجريبي)', grade: grade.id, pin: String(9001 + i), demo: true });
        Cur.allWords(grade).forEach(w => {
          if (Math.random() < level + 0.15) {
            const box = Math.random() < level ? 3 + Math.round(Math.random()) : 1 + Math.round(Math.random());
            const seen = box + Math.round(Math.random() * 3);
            const wrong = Math.random() < 0.5 ? Math.round(Math.random() * 4) : 0;
            s.words[w.id] = { box, seen, correct: Math.max(0, seen - wrong), wrong, due: Date.now() - 1000, last: Date.now() };
          }
        });
        // نضمن وجود بضع كلمات خاطئة ليظهر للمعلم كيف تبدو قائمة الكلمات الصعبة
        Object.values(s.words).slice(0, 2).forEach(r => { r.wrong = Math.max(r.wrong, 2); r.seen = Math.max(r.seen, r.wrong + r.correct); });
        const d = new Date(); d.setDate(d.getDate() - daysAgo);
        s.lastActive = U.ymd(d);
        s.streak = daysAgo === 0 ? 5 : 1;
        s.xp = Math.round(level * 420);
        s.ranges = {};
        grade.units.forEach((u, i) => {
          s.ranges[grade.id + '.' + u.id] = [1, u.words.length, u.words.length];
          s.units[grade.id + '.' + u.id] = { stars: Math.max(0, Math.round(level * 3) - (i % 2)), speedBest: Math.round(level * 14) };
          s.log.push({ t: d.getTime() - i * 36e5, mode: i % 2 ? 'cloze' : 'test', gradeId: grade.id, unitId: u.id, correct: Math.round(level * 9), total: 10 });
        });
        s.log.sort((a, b) => b.t - a.t);
        made.push(s);
      });
      if (cloud) {
        for (const s of made) {
          const r = await teacherCall('kal_teacher_add', { p_student: s });
          if (r.error && r.error !== 'pin-taken') return { error: r.error };
        }
        await refresh(true);
      } else {
        made.forEach(s => { state.students[s.id] = s; });
        save();
      }
      return { ok: true };
    }
  };
})();

// المنهج المحفوظ (إن أدخل المعلم كلماته) يحل محل الأمثلة
Cur.reload(Store.curriculumSource());
