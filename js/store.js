// المنهج + حفظ بيانات الطلاب.
// ملاحظة: التخزين الآن محلي (localStorage) على نفس الجهاز. دوال الطلاب كلها async
// لنستبدل التخزين لاحقًا بقاعدة بيانات سحابية دون تغيير بقية الشاشات.

// ---------- المنهج ----------
const Cur = (() => {
  const data = window.CURRICULUM || { grades: [] };
  const index = {};
  data.grades.forEach(g => g.units.forEach(u => u.words.forEach(w => {
    let id = `${g.id}.${u.id}.${U.slug(w.en)}`;
    for (let i = 2; index[id]; i++) id = `${g.id}.${u.id}.${U.slug(w.en)}-${i}`;
    w.id = id; w.gradeId = g.id; w.unitId = u.id;
    index[id] = w;
  })));
  return {
    grades: data.grades,
    grade: id => data.grades.find(g => g.id === id),
    unit: (gid, uid) => (data.grades.find(g => g.id === gid) || { units: [] }).units.find(u => u.id === uid),
    word: id => index[id],
    allWords: g => g.units.flatMap(u => u.words),
    // الجملة مقسّمة حول الكلمة: {before, match, after} أو null
    blank(w) {
      if (!w.sentence) return null;
      const re = new RegExp('(^|[^A-Za-z])(' + U.escRe(w.form || w.en) + ')(?![A-Za-z])', 'i');
      const m = re.exec(w.sentence);
      if (!m) return null;
      const start = m.index + m[1].length;
      return { before: w.sentence.slice(0, start), match: m[2], after: w.sentence.slice(start + m[2].length) };
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
    return r.box >= MASTERED_BOX ? 'mastered' : 'learning';
  }
  function unitStats(s, unit) {
    let mastered = 0, learning = 0, fresh = 0;
    unit.words.forEach(w => {
      const st = wordStatus(s, w.id);
      if (st === 'mastered') mastered++; else if (st === 'learning') learning++; else fresh++;
    });
    const total = unit.words.length;
    return { total, mastered, learning, fresh, pct: total ? Math.round(mastered / total * 100) : 0 };
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

  return { LEVELS, DAILY_GOAL, wordStatus, unitStats, gradeStats, dueWords, levelInfo, streak, dailyCount, starsFor, hardWords, INTERVAL_DAYS };
})();

// ---------- التخزين ----------
const Store = (() => {
  const KEY = 'kalimati.v1';
  const AVATARS = ['🦁', '🐼', '🦊', '🐯', '🐸', '🐵', '🦄', '🐙', '🐧', '🦉', '🐬', '🐢'];
  let state = null;

  function fresh() { return { v: 1, teacher: null, students: {}, session: null }; }
  function load() {
    try { state = JSON.parse(U.lsGet(KEY) || 'null') || fresh(); } catch (e) { state = fresh(); }
    if (!state.students) state.students = {};
  }
  function save() { U.lsSet(KEY, JSON.stringify(state)); }
  load();

  // تشفير بسيط جدًا لكلمة مرور المعلم (النسخة المحلية فقط؛ الأمان الحقيقي مع الخادم لاحقًا)
  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return String(h);
  }
  function newStudent({ name, grade, pin, demo }) {
    return {
      id: 's' + U.rid(), name: name.trim(), grade, pin: String(pin),
      avatar: U.pick(AVATARS), createdAt: new Date().toISOString(), demo: !!demo,
      xp: 0, streak: 0, lastActive: null, daily: { date: '', n: 0 },
      words: {}, units: {}, log: []
    };
  }

  return {
    // الجلسة (الطالب يبقى مسجّلًا على جهازه؛ المعلم يحتاج دخولًا جديدًا في كل تبويب)
    getSession() { return state.session; },
    setSession(sess) { state.session = sess; save(); },
    clearSession() { state.session = null; save(); },
    teacherAuthed() { try { return sessionStorage.getItem('kalimati.teacher') === '1'; } catch (e) { return false; } },
    setTeacherAuthed(v) { try { sessionStorage.setItem('kalimati.teacher', v ? '1' : '0'); } catch (e) { /* تجاهل */ } },
    hasTeacher() { return !!state.teacher; },
    setTeacherPassword(p) { state.teacher = { pass: hash(p) }; save(); },
    checkTeacherPassword(p) { return !!state.teacher && state.teacher.pass === hash(p); },

    async listStudents() { return Object.values(state.students); },
    async getStudent(id) { return state.students[id] || null; },
    async addStudent(info) {
      const s = newStudent(info);
      state.students[s.id] = s; save();
      return s;
    },
    async updateStudent(id, patch) {
      if (state.students[id]) { Object.assign(state.students[id], patch); save(); }
      return state.students[id] || null;
    },
    async deleteStudent(id) {
      delete state.students[id];
      if (state.session && state.session.id === id) state.session = null;
      save();
    },
    async resetProgress(id) {
      const s = state.students[id];
      if (!s) return;
      Object.assign(s, { xp: 0, streak: 0, lastActive: null, daily: { date: '', n: 0 }, words: {}, units: {}, log: [] });
      save();
    },
    async loginStudent(id, pin) {
      const s = state.students[id];
      if (!s || s.pin !== String(pin).trim()) return null;
      state.session = { role: 'student', id }; save();
      return s;
    },

    // تسجيل إجابة واحدة على كلمة
    async recordAnswer(sid, wid, ok) {
      const s = state.students[sid];
      if (!s) return;
      const r = s.words[wid] || (s.words[wid] = { box: 0, seen: 0, correct: 0, wrong: 0, due: 0, last: 0 });
      r.seen++; r.last = Date.now();
      if (ok) { r.correct++; r.box = Math.min(4, r.box + 1); } else { r.wrong++; r.box = Math.max(0, r.box - 1); }
      r.due = Date.now() + Progress.INTERVAL_DAYS[r.box] * 864e5;
      save();
    },

    // إنهاء جلسة لعب: يحدّث النقاط والسلسلة والنجوم والسجل
    async finishSession(sid, { mode, gradeId, unitId, correct, total, stars }) {
      const s = state.students[sid];
      if (!s) return null;
      const before = Progress.levelInfo(s.xp).level;
      const today = U.ymd();
      const xpGained = correct * 10 + (total && correct / total >= 0.8 ? 20 : 0);
      s.xp += xpGained;

      // السلسلة
      if (s.lastActive !== today) {
        s.streak = s.lastActive && U.dayDiff(s.lastActive, today) === 1 ? s.streak + 1 : 1;
        s.lastActive = today;
      }
      // الهدف اليومي
      const wasDone = Progress.dailyCount(s) >= Progress.DAILY_GOAL;
      s.daily = { date: today, n: Progress.dailyCount(s) + correct };
      const goalReached = !wasDone && s.daily.n >= Progress.DAILY_GOAL;

      // أفضل نتيجة للوحدة
      if (unitId && mode !== 'review') {
        const key = gradeId + '.' + unitId;
        const u = s.units[key] || (s.units[key] = { stars: 0, speedBest: 0 });
        if (mode === 'speed') u.speedBest = Math.max(u.speedBest || 0, correct);
        else u.stars = Math.max(u.stars || 0, stars);
      }
      s.log.unshift({ t: Date.now(), mode, gradeId, unitId: unitId || null, correct, total });
      s.log = s.log.slice(0, 60);
      save();
      const after = Progress.levelInfo(s.xp);
      return { xpGained, streak: s.streak, levelUp: after.level > before ? after : null, goalReached };
    },

    // بيانات تجريبية لعرض لوحة المعلم
    async seedDemo() {
      const grade = Cur.grades.find(g => g.units.length) || Cur.grades[0];
      const names = [['سارة', 0, 0.9], ['عمر', 2, 0.55], ['ليان', 6, 0.25]];
      names.forEach(([name, daysAgo, level]) => {
        const s = newStudent({ name: name + ' (تجريبي)', grade: grade.id, pin: '1234', demo: true });
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
        grade.units.forEach((u, i) => {
          s.units[grade.id + '.' + u.id] = { stars: Math.max(0, Math.round(level * 3) - (i % 2)), speedBest: Math.round(level * 14) };
          s.log.push({ t: d.getTime() - i * 36e5, mode: i % 2 ? 'cloze' : 'test', gradeId: grade.id, unitId: u.id, correct: Math.round(level * 9), total: 10 });
        });
        s.log.sort((a, b) => b.t - a.t);
        state.students[s.id] = s;
      });
      save();
    }
  };
})();
