// لوحة المعلم: متابعة الطلاب
const Teacher = (() => {
  const esc = U.esc;
  const app = () => document.getElementById('app');
  const IDLE_DAYS = 3;

  function idleDays(s) { return s.lastActive ? U.dayDiff(s.lastActive, U.ymd()) : Infinity; }
  const needsFollowUp = s => idleDays(s) >= IDLE_DAYS;

  // حالة الطالب في دفعته الحالية: هل دخل الكلمات؟ هل اختبر؟ درجته وأخطاؤه
  function monitorOf(s, g) {
    const units = g ? g.units : [];
    let cur = null;
    for (const u of units) {
      const r = Progress.rangeOf(s, u);
      if (!r) continue;
      cur = { u, r };
      if (!Progress.unitFinished(s, u)) break;
    }
    if (!cur) return { started: false, state: 'none', wrong: [] };
    const { u } = cur;
    const batch = Progress.batchOf(s, u);
    const lt = Progress.unitStats(s, u).lastTest;
    const seen = batch.filter(w => s.words[w.id] && s.words[w.id].seen > 0).length;
    const testedN = lt && lt.tested ? batch.filter(w => lt.tested.indexOf(w.id) >= 0).length : 0;
    const cleared = Progress.batchCleared(s, u);
    const wrong = Store.getWrongWords(s, g.id, u.id);
    const finished = Progress.unitFinished(s, u);
    const entered = seen > 0 || testedN > 0;
    const state = finished ? 'done' : cleared ? 'cleared' : testedN ? 'retry' : entered ? 'practice' : 'none';
    return { started: true, unit: u, batchN: batch.length, seen, testedN, entered, tested: testedN > 0, cleared, finished, wrong, state, score: lt && testedN ? lt : null };
  }
  const STATE_LABEL = { none: 'لم يدخل الكلمات', practice: 'تدرّب ولم يختبر', retry: `اختبر ولم يبلغ ${Math.round(Progress.PASS_RATE * 100)}%`, cleared: 'أنجز دفعته', done: 'أنهى الوحدة' };
  const STATE_CLASS = { none: 'bad', practice: 'warn', retry: 'warn', cleared: 'good', done: 'good' };
  const wrongLis = list => list.map(w => `<li><b class="en" dir="ltr">${esc(w.en)}</b> <span class="muted">${esc(w.ar || '')}</span></li>`).join('');

  function gradeName(id) { return (Cur.grade(id) || {}).name || ''; }

  const AUTH_ERRORS = {
    'bad-password': 'كلمة المرور غير صحيحة',
    'rate-limited': 'محاولات كثيرة. انتظر 10 دقائق ثم حاول مجددًا',
    offline: 'لا يوجد اتصال بالإنترنت',
    server: 'تعذر الوصول لقاعدة البيانات. تأكد من تشغيل ملف supabase/schema.sql',
    exists: 'حساب المعلم موجود مسبقًا. أعد تحميل الصفحة وادخل بكلمة المرور',
    'no-teacher': 'لم يُنشأ حساب المعلم بعد. أعد تحميل الصفحة',
    short: 'كلمة المرور قصيرة'
  };
  const OP_ERRORS = {
    offline: 'لا يوجد اتصال بالإنترنت — لم يتم الحفظ',
    auth: 'انتهت جلسة المعلم. ادخل من جديد',
    server: 'تعذر الحفظ. حاول مرة أخرى',
    'pin-taken': 'هذا الرمز مستخدم لطالب آخر في نفس الصف. اختر رمزًا مختلفًا.',
    'not-found': 'الطالب غير موجود',
    taken: 'هذا اللقب أُسند لطالب آخر. اختر لقبًا غيره.'
  };
  function failed(r) {
    App.toast(OP_ERRORS[r.error] || 'تعذر تنفيذ العملية');
    if (r.error === 'auth') App.go('#/teacher');
  }

  // ---------- الدخول ----------
  async function loginView() {
    const status = await Store.teacherStatus();
    if (typeof status === 'object') {
      app().innerHTML = `
        <section class="card login">
          <h1>${ic('board', 'lg')} دخول المعلم</h1>
          <p class="err">${AUTH_ERRORS[status.error]}</p>
          <button class="btn" data-go="#/teacher">إعادة المحاولة</button>
          <button class="btn ghost" data-go="#/login">رجوع</button>
        </section>`;
      return;
    }
    const first = !status;
    app().innerHTML = `
      <section class="card login">
        <h1>${ic('board', 'lg')} ${first ? 'إنشاء حساب المعلم' : 'دخول المعلم'}</h1>
        <p class="muted">${first ? 'اختر كلمة مرور للوحة المعلم (4 أحرف على الأقل).' : 'اكتب كلمة المرور.'}</p>
        <form data-form="t-login" class="stack">
          <input name="pass" type="password" autocomplete="${first ? 'new-password' : 'current-password'}" placeholder="كلمة المرور" required minlength="4" aria-label="كلمة المرور">
          ${first ? '<input name="pass2" type="password" autocomplete="new-password" placeholder="أعد كتابة كلمة المرور" required minlength="4" aria-label="تأكيد كلمة المرور">' : ''}
          <p class="err" id="t-err"></p>
          <button class="btn" type="submit">${first ? 'إنشاء' : 'دخول'}</button>
        </form>
        <button class="btn ghost" data-go="#/login">رجوع</button>
      </section>`;
  }

  U.forms['t-login'] = async form => {
    const err = document.getElementById('t-err');
    const btn = form.querySelector('button[type=submit]');
    const pass = form.elements.pass.value;
    const first = !!form.elements.pass2;
    if (first) {
      if (pass.length < 4) { err.textContent = 'كلمة المرور قصيرة'; return; }
      if (pass !== form.elements.pass2.value) { err.textContent = 'كلمتا المرور غير متطابقتين'; return; }
    }
    err.textContent = '';
    btn.disabled = true;
    const r = first ? await Store.teacherSetup(pass) : await Store.teacherLogin(pass);
    if (r.error) {
      btn.disabled = false;
      err.textContent = AUTH_ERRORS[r.error] || 'حدث خطأ، حاول مرة أخرى';
      return;
    }
    App.go('#/teacher');
  };

  // ---------- اللوحة: بطاقة لكل صف ----------
  async function dashboard() {
    const students = await Store.listStudents();
    if (!Store.teacherAuthed()) return loginView();
    const today = U.ymd();
    const active = students.filter(s => s.lastActive === today).length;
    const idle = students.filter(needsFollowUp).length;

    const cards = Cur.grades.map(g => {
      const list = students.filter(s => s.grade === g.id);
      const todayN = list.filter(s => s.lastActive === today).length;
      const idleN = list.filter(needsFollowUp).length;
      const words = Cur.allWords(g).length;
      const units = g.units.length;
      return `
        <button class="role-btn student grade-card" data-go="#/teacher/g/${g.id}">
          <span class="role-icon">${ic('cap')}</span>
          <b>${esc(g.name)}</b>
          <small>${list.length} ${list.length === 1 ? 'طالب' : 'طلاب'}</small>
          <small>${words ? `${units} ${units === 1 ? 'وحدة' : 'وحدات'} • ${words} كلمة` : 'لم تُضف كلمات بعد'}</small>
          ${todayN || idleN ? `<span class="gc-chips">
            ${todayN ? `<span class="chip-stat good">دخلوا اليوم: ${todayN}</span>` : ''}
            ${idleN ? `<span class="chip-stat">يحتاجون متابعة: ${idleN}</span>` : ''}
          </span>` : ''}
        </button>`;
    }).join('') + `
        <button class="role-btn grade-card add" data-act="t-add-grade">
          <span class="role-icon">${ic('plus')}</span>
          <b>إضافة صف جديد</b>
        </button>`;

    app().innerHTML = `
      <h2 class="section-title">${ic('board')} لوحة المعلم</h2>
      <div class="tiles">
        <div class="tile static"><b>${students.length}</b><small>كل الطلاب</small></div>
        <div class="tile static"><b>${active}</b><small>دخلوا اليوم</small></div>
        <div class="tile static ${idle ? 'alert' : ''}"><b>${idle}</b><small>يحتاجون متابعة</small></div>
      </div>
      <h3 class="section-title">الصفوف</h3>
      <div class="grade-cards">${cards}</div>
      ${syncNote()}`;
  }

  // ---------- صف واحد: طلابه وإدارة كلماته ----------
  async function gradeView(gid) {
    const g = Cur.grade(gid);
    if (!g) return App.go('#/teacher');
    const all = await Store.listStudents();
    if (!Store.teacherAuthed()) return loginView();
    const today = U.ymd();
    const students = all.filter(s => s.grade === g.id)
      .sort((a, b) => (needsFollowUp(b) - needsFollowUp(a)) || a.name.localeCompare(b.name, 'ar'));
    const active = students.filter(s => s.lastActive === today).length;
    const idle = students.filter(needsFollowUp).length;
    // الصف الذي أنشأه المعلم يُحذف إن كان فارغًا فقط (لا طلاب ولا وحدات)؛ الصفوف المضمّنة لا تُحذف
    const builtIn = ((window.CURRICULUM || {}).grades || []).some(x => x.id === g.id);
    const canDelete = !builtIn && !students.length && !g.units.length;

    const mons = new Map(students.map(s => [s.id, monitorOf(s, g)]));
    const rows = students.map(s => {
      const gs = Progress.gradeStats(s, g);
      const late = needsFollowUp(s);
      const m = mons.get(s.id);
      const errN = m.wrong.length;
      const dash = '<span class="muted">—</span>';
      const yn = (ok, n) => ok ? `<span class="st good">نعم</span><small class="muted">${n}/${m.batchN}</small>` : '<span class="st bad">لا</span>';
      const score = m.score ? `<b>${m.score.correct}/${m.score.total}</b><small class="muted">${U.ago(m.score.date)}</small>` : dash;
      return `
        <div class="t-student t-mon ${late ? 'late' : ''}" data-name="${esc(s.name)}" data-today="${s.lastActive === today}" data-late="${late}" data-untested="${m.started && !m.tested && !m.finished}" data-errors="${errN > 0}">
          <div class="tm-name" data-go="#/teacher/s/${s.id}" role="button" tabindex="0">
            <b>${esc(s.name)}</b>
            <small>${gs.total ? `${gs.pct}٪ محفوظ` : '<span class="warn-text">لم تبدأ</span>'} • ${ic('key', 'sm')} ${esc(s.pin)}</small>
            <small class="${late ? 'warn-text' : 'muted'}">${late ? ic('alert', 'sm') + ' ' : ''}آخر دخول: ${U.ago(s.lastActive)}</small>
          </div>
          <div class="tm-cell" data-l="الدفعة الحالية">${m.started ? `<span class="en" dir="ltr">${esc(m.unit.title.replace(/^Unit\s*/, 'U'))}</span><small class="muted">${m.batchN} كلمات</small>` : dash}</div>
          <div class="tm-cell" data-l="دخل الكلمات؟">${m.started ? yn(m.entered, m.seen) : dash}</div>
          <div class="tm-cell" data-l="اختبر؟">${m.started ? yn(m.tested, m.testedN) : dash}</div>
          <div class="tm-cell" data-l="الدرجة">${score}</div>
          <div class="tm-cell" data-l="الأخطاء">${errN ? `<details><summary><span class="st bad">${errN}</span></summary><ul class="plain tm-wrong">${wrongLis(m.wrong)}</ul></details>` : (m.started ? '<span class="st good">0</span>' : dash)}</div>
          <div class="tm-state ${STATE_CLASS[m.state]}">${STATE_LABEL[m.state]}</div>
        </div>`;
    }).join('');
    const untested = students.filter(s => { const m = mons.get(s.id); return m.started && !m.tested && !m.finished; }).length;
    const withErr = students.filter(s => mons.get(s.id).wrong.length).length;

    app().innerHTML = `
      <button class="back" data-go="#/teacher">‹ لوحة المعلم</button>
      <h2 class="section-title">${ic('cap')} ${esc(g.name)}</h2>
      <button class="btn big" data-go="#/teacher/add/${g.id}">${ic('plus')} إضافة طالب</button>
      <div class="t-filters">
        <button class="pill on" data-act="t-filter" data-f="all">الكل <b>${students.length}</b></button>
        <button class="pill" data-act="t-filter" data-f="today">دخلوا اليوم <b>${active}</b></button>
        <button class="pill ${untested ? 'alert' : ''}" data-act="t-filter" data-f="untested">لم يختبروا <b>${untested}</b></button>
        <button class="pill ${withErr ? 'alert' : ''}" data-act="t-filter" data-f="errors">عندهم أخطاء <b>${withErr}</b></button>
        <button class="pill ${idle ? 'alert' : ''}" data-act="t-filter" data-f="idle">غائبون <b>${idle}</b></button>
      </div>
      ${students.length > 3 ? `
        <div class="t-search">
          <input type="search" id="t-search-in" placeholder="ابحث عن طالب..." aria-label="بحث عن طالب" autocomplete="off">
        </div>` : ''}
      ${rows ? `<div class="t-list" id="t-list">
        <div class="t-mon t-head"><span>الطالب</span><span>الدفعة الحالية</span><span>دخل الكلمات؟</span><span>اختبر؟</span><span>الدرجة</span><span>الأخطاء</span><span>الحالة</span></div>${rows}</div>` : `<p class="card muted empty">لا يوجد طلاب في ${esc(g.name)} بعد. اضغط «إضافة طالب».</p>`}
      <button class="btn big words-btn" data-go="#/teacher/content/${g.id}">${ic('edit')} إدارة كلمات ${esc(g.name)}</button>
      ${canDelete ? `<button class="btn ghost danger-text" data-act="t-del-grade" data-id="${g.id}">${ic('trash', 'sm')} حذف هذا الصف</button>` : ''}
      ${syncNote()}`;

    const searchIn = document.getElementById('t-search-in');
    if (searchIn) {
      searchIn.addEventListener('input', () => {
        const q = searchIn.value.trim().toLowerCase();
        document.querySelectorAll('#t-list .t-student').forEach(el => {
          const name = (el.dataset.name || '').toLowerCase();
          el.style.display = !q || name.includes(q) ? '' : 'none';
        });
      });
    }
  }

  function syncNote() {
    const sync = Store.syncState();
    if (!sync.cloud) return '<p class="muted small note">ملاحظة: البيانات تُحفظ على هذا الجهاز فقط (الربط السحابي غير مفعّل).</p>';
    if (!sync.online) return `<p class="warn-text small note">${ic('alert', 'sm')} لا يوجد اتصال — تُعرض آخر بيانات محفوظة على هذا الجهاز وقد لا تكون محدّثة.</p>`;
    const waiting = sync.pending ? ` (${sync.pending} تغييرات بانتظار الرفع)` : '';
    return `<p class="muted small note">${ic('cloud', 'sm')} متصل بالسحابة — بيانات الطلاب تتزامن بين الأجهزة.${waiting}</p>`;
  }

  // ---------- إضافة طالب ----------
  function addView(gid) {
    const fixed = Cur.grade(gid);
    const pin = String(Math.floor(1000 + Math.random() * 9000));
    app().innerHTML = `
      <button class="back" data-go="${fixed ? '#/teacher/g/' + fixed.id : '#/teacher'}">‹ رجوع</button>
      <section class="card login">
        <h2>${ic('plus')} إضافة طالب${fixed ? ` — ${esc(fixed.name)}` : ''}</h2>
        <form data-form="t-add" class="stack">
          <label>اسم الطالب<input name="name" maxlength="20" required></label>
          ${fixed
            ? `<input type="hidden" name="grade" value="${fixed.id}">`
            : `<label>الصف<select name="grade">${Cur.grades.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select></label>`}
          <label>الرمز السري (4 أرقام)<input name="pin" value="${pin}" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required></label>
          <button class="btn" type="submit">حفظ</button>
        </form>
      </section>`;
  }

  U.forms['t-add'] = async form => {
    const name = form.elements.name.value.trim();
    const pin = form.elements.pin.value.trim();
    const grade = form.elements.grade.value;
    if (!name || !/^\d{4}$/.test(pin)) { App.toast('تأكد من الاسم والرمز (4 أرقام)'); return; }
    if (!Store.isPinUnique(grade, pin)) { failed({ error: 'pin-taken' }); return; }
    const result = await Store.addStudent({ name, grade, pin });
    if (result && result.error) { failed(result); return; }
    App.toast(`تمت إضافة ${name} — الرمز السري: ${pin}`);
    App.go('#/teacher/g/' + grade);
  };

  // ---------- تفاصيل طالب ----------
  function report(s) {
    const g = Cur.grade(s.grade);
    const lines = [`تقرير الطالب: ${s.name}`, `الصف: ${gradeName(s.grade)}`, ''];
    if (g) {
      g.units.forEach(u => {
        const r = Progress.rangeOf(s, u);
        if (!r) return;
        const st = Progress.unitStats(s, u);
        const remaining = st.total - st.mastered;
        const reviewCount = st.lastTest ? st.lastTest.wrong.filter(wid => {
          const w = Cur.word(wid);
          return w && w.unitId === u.id;
        }).length : 0;
        lines.push(u.title);
        lines.push(`المسند: ${st.total} كلمة`);
        lines.push(`المحفوظ: ${st.mastered} كلمة`);
        if (remaining > 0) {
          lines.push(`المتبقي: ${remaining} كلمة${reviewCount ? `، منها ${reviewCount} للمراجعة` : ''}`);
        }
        if (st.lastTest) {
          lines.push(`آخر اختبار: ${st.lastTest.correct}/${st.lastTest.total}`);
        }
        lines.push('');
      });
    }
    const act = Progress.activitySummary(s);
    if (act.days || act.tests || act.reps) {
      lines.push(`أيام النشاط: ${act.days} • الاختبارات: ${act.tests} • التكرار: ${act.reps} مرة`);
    }
    lines.push(`آخر دخول: ${U.ago(s.lastActive)}`);
    return lines.join('\n');
  }

  async function studentView(id) {
    const s = await Store.getStudent(id);
    if (!s) return App.go('#/teacher');
    const g = Cur.grade(s.grade);
    const gs = g ? Progress.gradeStats(s, g) : { pct: 0, mastered: 0, total: 0 };
    const late = needsFollowUp(s);
    const hard = Progress.hardWords(s, 8);
    const act = Progress.activitySummary(s);

    const everyone = await Store.listStudents();
    const usedNicks = new Set(everyone.filter(x => x.id !== s.id && x.nick).map(x => x.nick));
    const nickHtml = `
      <h3 class="section-title">${ic('cap')} لقب المنافسة</h3>
      <div class="card">
        <label>اللقب:
          <select id="t-nick">
            <option value="">— بلا لقب —</option>
            ${Compete.NICKS.filter(n => !usedNicks.has(n.id) || n.id === s.nick).map(n => `<option value="${n.id}" ${s.nick === n.id ? 'selected' : ''}>${esc(n.ar)} — ${esc(n.en)}</option>`).join('')}
          </select>
        </label>
        <p class="muted small">يظهر اسم اللقب وحده في المنافسة، والألقاب المأخوذة لا تظهر لطالب آخر.</p>
      </div>`;
    const mon = monitorOf(s, g);
    const monSummary = mon.started ? `
      <div class="card mon-sum">
        <div class="tm-state ${STATE_CLASS[mon.state]}">${STATE_LABEL[mon.state]}</div>
        <p><b class="en" dir="ltr">${esc(mon.unit.title)}</b> — دفعة من ${mon.batchN} كلمات</p>
        <p class="small">دخل الكلمات: <b>${mon.entered ? 'نعم (' + mon.seen + '/' + mon.batchN + ')' : 'لا'}</b> • اختبر: <b>${mon.tested ? 'نعم' : 'لا'}</b>${mon.score ? ` • الدرجة: <b>${mon.score.correct}/${mon.score.total}</b> (${U.ago(mon.score.date)})` : ''} • الأخطاء: <b>${mon.wrong.length}</b></p>
        ${mon.wrong.length ? `<ul class="plain tm-wrong">${wrongLis(mon.wrong)}</ul>` : ''}
      </div>` : '<p class="card muted">لم تبدأ الكلمات بعد.</p>';

    const unitRows = g ? g.units.map(u => {
      const st = Progress.unitStats(s, u);
      if (!st.total) return `<div class="u-row"><div class="u-top"><b class="en" dir="ltr">${esc(u.title)}</b><span class="muted small">لم تُسند كلمات</span></div></div>`;
      const remaining = st.total - st.mastered;
      const reviewCount = st.lastTest ? st.lastTest.wrong.filter(wid => {
        const w = Cur.word(wid);
        return w && w.unitId === u.id;
      }).length : 0;
      return `
        <div class="u-row">
          <div class="u-top"><b class="en" dir="ltr">${esc(u.title)}</b><span>${st.mastered}/${st.total}</span></div>
          <div class="meter"><i style="width:${st.pct}%"></i></div>
          <small class="u-detail">
            المحفوظ: ${st.mastered}
            ${remaining > 0 ? ` • المتبقي: ${remaining}${reviewCount ? ` (منها ${reviewCount} للمراجعة)` : ''}` : ''}
          </small>
          ${st.lastTest ? `<small class="u-test">آخر اختبار: <b>${st.lastTest.correct}/${st.lastTest.total}</b> — ${U.ago(st.lastTest.date)}</small>` : '<small class="muted">لم يختبر بعد</small>'}
        </div>`;
    }).join('') : '';

    const reps = s.reps || { total: 0, byWord: {}, daily: { date: '', n: 0 } };
    const topReps = Object.entries(reps.byWord).filter(([id]) => Cur.word(id)).sort((a, b) => b[1] - a[1]).slice(0, 6);

    const hardRows = hard.map(h => `
      <li><b class="en" dir="ltr">${esc(h.word.en)}</b> <span class="muted">${esc(h.word.ar || '')}</span>
        <span class="wrong-n">${h.wrong} ${h.wrong === 1 ? 'خطأ' : 'أخطاء'}</span>
        ${h.word.sentence ? `<div class="en sent" dir="ltr">${Games.hl(h.word)}</div>` : ''}</li>`).join('');

    const logRows = s.log.slice(0, 12).map(l => {
      if (l.mode === 'reps') {
        const rw = Cur.word(l.wid);
        return `<li><span>${ic('repeat', 'sm')} تكرار ${rw ? `«<span class="en" dir="ltr">${esc(rw.en)}</span>»` : 'كلمة'}</span>
          <span class="muted">${l.correct} مرة • ${U.ago(U.ymd(new Date(l.t)))}</span></li>`;
      }
      const m = Games.MODES[l.mode] || { icon: 'target', title: l.mode };
      const u = l.unitId ? Cur.unit(l.gradeId, l.unitId) : null;
      return `<li><span>${ic(m.icon, 'sm')} ${esc(m.title)}${u ? ` — <span class="en" dir="ltr">${esc(u.title)}</span>` : ''}</span>
        <span class="muted">${l.correct}/${l.total} • ${U.ago(U.ymd(new Date(l.t)))}</span></li>`;
    }).join('');

    // الإسناد تلقائي: المعلم يتابع فقط أين وصل الطالب في كل وحدة
    const autoHtml = g ? g.units.map(u => {
      const r = Progress.rangeOf(s, u);
      const total = u.words.length;
      if (!r) return `
        <div class="assign">
          <div class="assign-head"><b class="en" dir="ltr">${esc(u.title)}</b><span class="assign-off">لم تُفتح بعد</span></div>
        </div>`;
      const from = r[2] < r[1] ? r[2] + 1 : r[0];
      const cleared = Progress.batchCleared(s, u);
      const bank = Store.getWrongWords(s, g.id, u.id).length;
      const finished = Progress.unitFinished(s, u);
      return `
        <div class="assign">
          <div class="assign-head">
            <b class="en" dir="ltr">${esc(u.title)}</b>
            <span class="assign-on">أُسند ${r[1]} من ${total}</span>
          </div>
          <div class="meter"><i style="width:${Math.round(r[1] / total * 100)}%"></i></div>
          <p class="small muted">${finished ? 'أنهى الوحدة كاملة'
            : `الدفعة الحالية: الكلمات من ${from} إلى ${r[1]} — ${cleared ? 'أنجزها وتنتظر الدفعة التالية' : 'لم ينجزها بعد'}`}${bank ? ` • في الحصالة ${bank} ${bank === 1 ? 'كلمة' : 'كلمات'}` : ''}</p>
        </div>`;
    }).join('') : '<p class="muted">لا توجد وحدات.</p>';

    app().innerHTML = `
      <button class="back" data-go="#/teacher/g/${s.grade}">‹ ${esc(gradeName(s.grade))}</button>
      <section class="card hero">
        <div class="hero-main">
          <h2>${esc(s.name)}</h2>
          <p class="muted">${esc(gradeName(s.grade))} • الرمز السري: <b dir="ltr">${esc(s.pin)}</b></p>
        </div>
      </section>
      <div class="tiles">
        <div class="tile"><b>${gs.total ? gs.pct + '٪' : '—'}</b><small>${gs.total ? `الحفظ (${gs.mastered}/${gs.total})` : 'لم تُسند كلمات'}</small></div>
        <div class="tile ${late ? 'alert' : ''}"><b>${U.ago(s.lastActive)}</b><small>آخر دخول</small></div>
      </div>
      ${monSummary}
      <p class="muted small activity-line">${ic('clock', 'sm')} أيام النشاط: ${act.days} • الاختبارات: ${act.tests} • كرّر ${act.reps} مرة</p>

      <h3 class="section-title">الوحدات</h3>
      <div class="card">${unitRows || '<p class="muted">لا توجد وحدات لهذا الصف.</p>'}</div>

      ${nickHtml}

      <h3 class="section-title">${ic('volume')} تسجيلات قراءة الجمل</h3>
      <div class="card" id="t-clips">
        ${Store.syncState().cloud ? `<button class="btn" data-act="t-clips" data-id="${s.id}">${ic('play', 'sm')} عرض التسجيلات</button>
        <p class="muted small">تُحفظ كل محاولة (حتى خمس لكل جملة في اليوم) وتسمعها هنا. تُحذف حين تصفّر تقدم الطالب أو تحذفه.</p>` : '<p class="muted">تحتاج الربط السحابي.</p>'}
      </div>

      <h3 class="section-title">${ic('ruler')} الإسناد التلقائي</h3>
      <p class="muted small">تُسند الكلمات للطالب تلقائيًا دفعة بعد دفعة. ينتقل لدفعته التالية حين يجتاز اختبار الدفعة بلا أخطاء أو يجتاز اختبار الحصالة بنسبة ١٠٠٪، وبعد آخر دفعة تبدأ الوحدة التالية.</p>
      <div class="card">${autoHtml}</div>

      <h3 class="section-title">${ic('settings')} إعدادات الاختبار</h3>
      <div class="card">
        <label>عدد الكلمات في كل إسناد (${esc(gradeName(s.grade))}):
          <select id="t-assign-n">
            ${[...new Set([3, 5, 7, 10, 12, 15, 20, 25, 30, Store.getAssignN(s.grade)])].sort((a, b) => a - b).map(n => `<option value="${n}" ${Store.getAssignN(s.grade) === n ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </label>
        <label>أعد الاختبار إذا أخطأ في أكثر من:
          <select id="t-threshold">
            <option value="0" ${Store.getRetryThreshold() === 0 ? 'selected' : ''}>بدون إعادة</option>
            ${[1, 2, 3, 4, 5].map(n => `<option value="${n}" ${Store.getRetryThreshold() === n ? 'selected' : ''}>${n} ${n === 1 ? 'كلمة' : 'كلمات'}</option>`).join('')}
          </select>
        </label>
      </div>

      ${topReps.length ? `
      <h3 class="section-title">${ic('repeat')} التكرار</h3>
      <div class="card">
        <div class="chips en" dir="ltr">${topReps.map(([id, n]) => `<span class="chip-stat">${esc(Cur.word(id).en)} × ${n}</span>`).join('')}</div>
      </div>` : ''}

      ${hardRows ? `
      <h3 class="section-title">${ic('alert')} كلمات يكثر فيها الخطأ</h3>
      <div class="card"><ul class="plain">${hardRows}</ul></div>` : ''}

      ${logRows ? `
      <h3 class="section-title">آخر النشاط</h3>
      <div class="card"><ul class="plain log">${logRows}</ul></div>` : ''}

      <div class="row wrap">
        <button class="btn" data-act="t-copy" data-id="${s.id}">${ic('clipboard')} نسخ التقرير (لولي الأمر)</button>
        <button class="btn ghost" data-act="t-pin" data-id="${s.id}">${ic('key')} تغيير الرمز</button>
        <button class="btn ghost" data-act="t-reset" data-id="${s.id}">${ic('reset')} تصفير التقدم</button>
        <button class="btn danger" data-act="t-delete" data-id="${s.id}">${ic('trash')} حذف الطالب</button>
      </div>`;

    const nickSel = document.getElementById('t-nick');
    if (nickSel) {
      nickSel.addEventListener('change', async () => {
        const r = await Store.setNick(s.id, nickSel.value);
        if (r.error) { failed(r); nickSel.value = s.nick || ''; return; }
        s.nick = nickSel.value || null;
        App.toast(s.nick ? 'تم حفظ اللقب' : 'تمت إزالة اللقب');
      });
    }
    const assignSel = document.getElementById('t-assign-n');
    if (assignSel) {
      assignSel.addEventListener('change', () => {
        Store.setAssignN(s.grade, Number(assignSel.value));
        App.toast('تم حفظ عدد الكلمات لهذا الصف');
      });
    }
    const thresholdSel = document.getElementById('t-threshold');
    if (thresholdSel) {
      thresholdSel.addEventListener('change', () => {
        Store.setRetryThreshold(Number(thresholdSel.value));
        App.toast('تم حفظ إعداد الإعادة');
      });
    }
  }

  U.actions['t-clips'] = async el => {
    const box = document.getElementById('t-clips');
    if (!box) return;
    box.innerHTML = '<p class="muted">جارٍ التحميل…</p>';
    const r = await Store.studentClips(el.dataset.id);
    if (!r || !r.ok) { box.innerHTML = `<p class="warn-text">تعذّر تحميل التسجيلات${r && r.error === 'auth' ? ' (ادخل من جديد)' : ''}. تأكد أن الدالة السحابية محدّثة.</p>`; return; }
    if (!r.clips.length) { box.innerHTML = '<p class="muted">لا توجد تسجيلات بعد.</p>'; return; }
    const by = {};
    r.clips.forEach(c => { (by[c.wid] = by[c.wid] || []).push(c); });
    box.innerHTML = Object.keys(by).map(wid => {
      const w = Cur.word(wid);
      const sentence = w ? w.sentence : '';
      return `<div class="clip-group">
        <div class="en sh-sent" dir="ltr">${esc(sentence || wid)}</div>
        ${by[wid].sort((a, b) => a.n - b.n).map(c => {
          const g = sentence ? Shadow.grade(sentence, c.heard).score : null;
          return `<div class="clip-row">
            <span class="clip-n">محاولة ${c.n}</span>
            ${c.url ? `<audio controls preload="none" src="${esc(c.url)}"></audio>` : '<span class="muted small">الملف غير متاح</span>'}
            ${g === null ? '' : `<b class="${g >= 5 ? 'ok' : 'miss'}">${g}/10</b>`}
            <small class="en muted" dir="ltr">${esc(c.heard || '')}</small>
          </div>`;
        }).join('')}
      </div>`;
    }).join('');
  };

  // ---------- الإجراءات ----------
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* نجرب الطريقة القديمة */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }

  U.actions['t-copy'] = async el => {
    const s = await Store.getStudent(el.dataset.id);
    if (!s) return;
    const text = report(s);
    if (await copyText(text)) App.toast('تم نسخ التقرير. الصقه في واتساب');
    else App.showText('انسخ التقرير من هنا', text);
  };
  U.actions['t-pin'] = async el => {
    const s = await Store.getStudent(el.dataset.id);
    if (!s) return;
    const pin = await App.ask('الرمز السري الجديد (4 أرقام):', s.pin);
    if (pin === null) return;
    if (!/^\d{4}$/.test(pin.trim())) { App.toast('الرمز يجب أن يكون 4 أرقام'); return; }
    if (!Store.isPinUnique(s.grade, pin.trim(), s.id)) { failed({ error: 'pin-taken' }); return; }
    const r = await Store.updateStudent(s.id, { pin: pin.trim() });
    if (r && r.error) { failed(r); return; }
    App.toast('تم تغيير الرمز');
    studentView(s.id);
  };
  U.actions['t-reset'] = async el => {
    const s = await Store.getStudent(el.dataset.id);
    if (s && await App.confirm(`تصفير كل تقدم ${s.name}؟ لا يمكن التراجع.`, { okLabel: 'تصفير', danger: true })) {
      const r = await Store.resetProgress(s.id);
      if (r.error) { failed(r); return; }
      App.toast('تم التصفير');
      studentView(s.id);
    }
  };
  U.actions['t-delete'] = async el => {
    const s = await Store.getStudent(el.dataset.id);
    if (s && await App.confirm(`حذف الطالب ${s.name} نهائيًا؟`, { okLabel: 'حذف', danger: true })) {
      const r = await Store.deleteStudent(s.id);
      if (r.error) { failed(r); return; }
      App.go('#/teacher/g/' + s.grade);
    }
  };
  // البيانات التجريبية متاحة برمجيًا فقط (للاختبارات)
  U.actions['t-demo'] = async () => { const r = await Store.seedDemo(); if (r.error) failed(r); else dashboard(); };
  U.actions['t-demo-clear'] = async () => { for (const s of await Store.listStudents()) { if (s.demo) await Store.deleteStudent(s.id); } dashboard(); };
  U.actions['t-filter'] = el => {
    const f = el.dataset.f;
    document.querySelectorAll('.t-filters .pill').forEach(b => b.classList.toggle('on', b === el));
    document.querySelectorAll('.t-list .t-student').forEach(row => {
      if (f === 'all') { row.style.display = ''; return; }
      if (f === 'today') { row.style.display = row.dataset.today === 'true' ? '' : 'none'; return; }
      if (f === 'idle') { row.style.display = row.dataset.late === 'true' ? '' : 'none'; return; }
      if (f === 'untested') { row.style.display = row.dataset.untested === 'true' ? '' : 'none'; return; }
      if (f === 'errors') { row.style.display = row.dataset.errors === 'true' ? '' : 'none'; return; }
    });
  };

  // صف جديد: يُحفظ ضمن المنهج (ويصل للسحابة والأجهزة الأخرى مثل أي كلمات)
  U.actions['t-add-grade'] = async () => {
    const raw = await App.prompt('اسم الصف الجديد (مثل: الثالث الابتدائي):', '');
    if (raw === null) return;
    const name = raw.trim().slice(0, 40);
    if (!name) { App.toast('اكتب اسم الصف'); return; }
    if (Cur.grades.some(g => g.name === name)) { App.toast('هذا الصف موجود مسبقًا'); return; }
    let id;
    do { id = 'c' + U.rid(); } while (Cur.grade(id));
    const data = Cur.snapshot();
    data.grades.push({ id, name, short: name, units: [] });
    Store.saveCurriculum(data);
    App.toast(`تمت إضافة ${name}`);
    App.go('#/teacher/g/' + id);
  };
  U.actions['t-del-grade'] = async el => {
    const g = Cur.grade(el.dataset.id);
    if (!g) return;
    const students = (await Store.listStudents()).filter(s => s.grade === g.id);
    if (students.length || g.units.length) { App.toast('لا يمكن حذف صف فيه طلاب أو وحدات'); return; }
    if (!(await App.confirm(`حذف الصف «${g.name}»؟`, { okLabel: 'حذف', danger: true }))) return;
    const data = Cur.snapshot();
    data.grades = data.grades.filter(x => x.id !== g.id);
    Store.saveCurriculum(data);
    App.go('#/teacher');
  };

  U.actions['t-exit'] = async () => { await Store.teacherLogout(); App.go('#/login'); };

  // ---------- المسار ----------
  async function route(parts) {
    if (!Store.teacherAuthed()) return loginView();
    const [sub, id] = parts;
    if (sub === 'g' && id) return gradeView(id);
    if (sub === 'add') return addView(id);
    if (sub === 's' && id) return studentView(id);
    if (sub === 'content' || sub === 'unit') return Content.route(parts);
    return dashboard();
  }

  return { route };
})();
