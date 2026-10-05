// لوحة المعلم: متابعة الطلاب
const Teacher = (() => {
  const esc = U.esc;
  const app = () => document.getElementById('app');
  const IDLE_DAYS = 3;

  function idleDays(s) { return s.lastActive ? U.dayDiff(s.lastActive, U.ymd()) : Infinity; }
  const needsFollowUp = s => idleDays(s) >= IDLE_DAYS;

  function gradeName(id) { return (Cur.grade(id) || {}).name || ''; }

  // ---------- الدخول ----------
  function loginView() {
    const first = !Store.hasTeacher();
    app().innerHTML = `
      <section class="card login">
        <h1>👩‍🏫 ${first ? 'إنشاء حساب المعلم' : 'دخول المعلم'}</h1>
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

  U.forms['t-login'] = form => {
    const err = document.getElementById('t-err');
    const pass = form.elements.pass.value;
    if (!Store.hasTeacher()) {
      if (pass.length < 4) { err.textContent = 'كلمة المرور قصيرة'; return; }
      if (pass !== form.elements.pass2.value) { err.textContent = 'كلمتا المرور غير متطابقتين'; return; }
      Store.setTeacherPassword(pass);
    } else if (!Store.checkTeacherPassword(pass)) {
      err.textContent = 'كلمة المرور غير صحيحة';
      return;
    }
    Store.setTeacherAuthed(true);
    App.go('#/teacher');
  };

  // ---------- اللوحة ----------
  async function dashboard() {
    const students = await Store.listStudents();
    const today = U.ymd();
    const active = students.filter(s => s.lastActive === today).length;
    const idle = students.filter(needsFollowUp).length;

    const sorted = students.slice().sort((a, b) =>
      (needsFollowUp(b) - needsFollowUp(a)) || a.name.localeCompare(b.name, 'ar'));

    const rows = sorted.map(s => {
      const g = Cur.grade(s.grade);
      const gs = g ? Progress.gradeStats(s, g) : { pct: 0, mastered: 0, total: 0 };
      const info = Progress.levelInfo(s.xp);
      const late = needsFollowUp(s);
      const activeToday = s.lastActive === today;
      return `
        <button class="t-student ${late ? 'late' : ''}" data-go="#/teacher/s/${s.id}" data-name="${esc(s.name)}" data-today="${activeToday}" data-late="${late}">
          <span class="t-main">
            <b>${esc(s.name)}</b>
            <small>${esc(gradeName(s.grade))} • مستوى ${info.level} • <span class="t-pin">🔑 ${esc(s.pin)}</span></small>
            <span class="meter"><i style="width:${gs.pct}%"></i></span>
          </span>
          <span class="t-side">
            <b>${gs.pct}٪</b>
            <small class="${late ? 'warn-text' : ''}">${late ? '⚠️ ' : ''}${U.ago(s.lastActive)}</small>
          </span>
        </button>`;
    }).join('');

    app().innerHTML = `
      <h2 class="section-title">👩‍🏫 لوحة المعلم</h2>
      <div class="tiles">
        <button class="tile on" data-act="t-filter" data-f="all"><b>${students.length}</b><small>الكل</small></button>
        <button class="tile" data-act="t-filter" data-f="today"><b>${active}</b><small>دخلوا اليوم</small></button>
        <button class="tile ${idle ? 'alert' : ''}" data-act="t-filter" data-f="idle"><b>${idle}</b><small>يحتاجون متابعة</small></button>
      </div>
      <button class="btn big" data-go="#/teacher/content">📝 إدارة الكلمات (الصفوف والوحدات والصفحات)</button>
      <div class="row">
        <button class="btn" data-go="#/teacher/add">➕ إضافة طالب</button>
        ${students.some(s => s.demo)
          ? '<button class="btn ghost" data-act="t-demo-clear">🗑️ حذف الطلاب التجريبيين</button>'
          : '<button class="btn ghost" data-act="t-demo">🧪 بيانات تجريبية للعرض</button>'}
      </div>
      ${students.length > 3 ? `
        <div class="t-search">
          <input type="search" id="t-search-in" placeholder="🔍 ابحث عن طالب..." aria-label="بحث عن طالب" autocomplete="off">
        </div>` : ''}
      ${rows ? `<div class="t-list" id="t-list">${rows}</div>` : '<p class="card muted empty">لا يوجد طلاب بعد. أضف أول طالب، أو حمّل بيانات تجريبية لترى كيف تبدو اللوحة.</p>'}
      <p class="muted small note">ملاحظة: في هذه النسخة التجريبية تُحفظ البيانات على هذا الجهاز فقط. الربط بقاعدة بيانات سحابية (لمتابعة الطلاب من أجهزتهم) هو الخطوة التالية.</p>`;

    // تفعيل البحث
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

  // ---------- إضافة طالب ----------
  function addView() {
    const pin = String(Math.floor(1000 + Math.random() * 9000));
    app().innerHTML = `
      <button class="back" data-go="#/teacher">‹ رجوع</button>
      <section class="card login">
        <h2>➕ إضافة طالب</h2>
        <form data-form="t-add" class="stack">
          <label>اسم الطالب<input name="name" maxlength="20" required></label>
          <label>الصف<select name="grade">${Cur.grades.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select></label>
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
    if (!Store.isPinUnique(grade, pin)) { App.toast('هذا الرمز مستخدم لطالب آخر في نفس الصف. اختر رمزًا مختلفًا.'); return; }
    const result = await Store.addStudent({ name, grade, pin });
    if (result && result.error === 'pin-taken') { App.toast('هذا الرمز مستخدم لطالب آخر في نفس الصف.'); return; }
    App.toast(`تمت إضافة ${name} — الرمز السري: ${pin}`);
    App.go('#/teacher');
  };

  // ---------- تفاصيل طالب ----------
  function report(s) {
    const g = Cur.grade(s.grade);
    const gs = g ? Progress.gradeStats(s, g) : { mastered: 0, total: 0, pct: 0 };
    const info = Progress.levelInfo(s.xp);
    const hard = Progress.hardWords(s, 5).map(h => h.word.en).join('، ');
    const units = g ? g.units.map(u => {
      const st = Progress.unitStats(s, u);
      return `- ${u.title}: ${st.mastered}/${st.total}`;
    }).join('\n') : '';
    return [
      `📊 تقرير الطالب: ${s.name}`,
      `الصف: ${gradeName(s.grade)}`,
      `المستوى: ${info.level} (${info.title}) | السلسلة: ${Progress.streak(s)} يوم`,
      `الكلمات المحفوظة: ${gs.mastered} من ${gs.total} (${gs.pct}٪)`,
      `آخر دخول: ${U.ago(s.lastActive)}`,
      units ? `\nالوحدات:\n${units}` : '',
      hard ? `\nكلمات تحتاج مراجعة: ${hard}` : ''
    ].filter(Boolean).join('\n');
  }

  async function studentView(id) {
    const s = await Store.getStudent(id);
    if (!s) return App.go('#/teacher');
    const g = Cur.grade(s.grade);
    const gs = g ? Progress.gradeStats(s, g) : { pct: 0, mastered: 0, total: 0 };
    const info = Progress.levelInfo(s.xp);
    const late = needsFollowUp(s);
    const hard = Progress.hardWords(s, 8);

    const unitRows = g ? g.units.map(u => {
      const st = Progress.unitStats(s, u);
      const rec = s.units[g.id + '.' + u.id] || {};
      return `
        <div class="u-row">
          <div class="u-top"><b class="en" dir="ltr">${esc(u.title)}</b><span>${st.mastered}/${st.total}</span></div>
          <div class="meter"><i style="width:${st.pct}%"></i></div>
          <small class="muted">النجوم: ${'★'.repeat(rec.stars || 0)}${'☆'.repeat(3 - (rec.stars || 0))}</small>
        </div>`;
    }).join('') : '';

    const reps = s.reps || { total: 0, byWord: {}, daily: { date: '', n: 0 } };
    const todayReps = reps.daily.date === U.ymd() ? reps.daily.n : 0;
    const topReps = Object.entries(reps.byWord).filter(([id]) => Cur.word(id)).sort((a, b) => b[1] - a[1]).slice(0, 6);

    const hardRows = hard.map(h => `
      <li><b class="en" dir="ltr">${esc(h.word.en)}</b> <span class="muted">${esc(h.word.ar || '')}</span>
        <span class="wrong-n">${h.wrong} ${h.wrong === 1 ? 'خطأ' : 'أخطاء'}</span>
        ${h.word.sentence ? `<div class="en sent" dir="ltr">${Games.hl(h.word)}</div>` : ''}</li>`).join('');

    const logRows = s.log.slice(0, 12).map(l => {
      if (l.mode === 'reps') {
        const rw = Cur.word(l.wid);
        return `<li><span>🔁 تكرار ${rw ? `«<span class="en" dir="ltr">${esc(rw.en)}</span>»` : 'كلمة'}</span>
          <span class="muted">${l.correct} مرة • ${U.ago(U.ymd(new Date(l.t)))}</span></li>`;
      }
      const m = Games.MODES[l.mode] || { icon: '•', title: l.mode };
      const u = l.unitId ? Cur.unit(l.gradeId, l.unitId) : null;
      return `<li><span>${m.icon} ${esc(m.title)}${u ? ` — <span class="en" dir="ltr">${esc(u.title)}</span>` : ''}</span>
        <span class="muted">${l.correct}/${l.total} • ${U.ago(U.ymd(new Date(l.t)))}</span></li>`;
    }).join('');

    app().innerHTML = `
      <button class="back" data-go="#/teacher">‹ رجوع للوحة</button>
      <section class="card hero">
        <div class="hero-main">
          <h2>${esc(s.name)}</h2>
          <p class="muted">${esc(gradeName(s.grade))} • الرمز السري: <b dir="ltr">${esc(s.pin)}</b></p>
        </div>
      </section>
      <div class="tiles">
        <div class="tile"><b>${gs.pct}٪</b><small>الحفظ (${gs.mastered}/${gs.total})</small></div>
        <div class="tile"><b>🔥 ${Progress.streak(s)}</b><small>أيام متتالية</small></div>
        <div class="tile ${late ? 'alert' : ''}"><b>${U.ago(s.lastActive)}</b><small>آخر دخول</small></div>
      </div>
      <p class="muted small">المستوى ${info.level} (${esc(info.title)}) • ${s.xp} نقطة</p>

      <h3 class="section-title">الوحدات</h3>
      <div class="card">${unitRows || '<p class="muted">لا توجد وحدات لهذا الصف.</p>'}</div>

      <h3 class="section-title">📏 نطاق الاختبار</h3>
      <div class="card">${g ? g.units.map(u => {
        const range = Store.getRange(s.id, g.id, u.id);
        const from = range ? range[0] : 1;
        const to = range ? range[1] : u.words.length;
        return `
          <div class="range-row" data-gid="${g.id}" data-uid="${u.id}">
            <b class="en" dir="ltr">${esc(u.title)}</b> <small class="muted">(${u.words.length} كلمة)</small>
            <div class="range-controls">
              <label>من <input type="number" class="range-in" data-k="from" min="1" max="${u.words.length}" value="${from}"></label>
              <label>إلى <input type="number" class="range-in" data-k="to" min="1" max="${u.words.length}" value="${to}"></label>
              <button class="btn small-btn" data-act="t-set-range" data-sid="${s.id}" data-gid="${g.id}" data-uid="${u.id}">حفظ</button>
            </div>
          </div>`;
      }).join('') : '<p class="muted">لا توجد وحدات.</p>'}
      </div>

      <h3 class="section-title">⚙️ إعدادات الاختبار</h3>
      <div class="card">
        <label>أعد الاختبار إذا أخطأ في أكثر من:
          <select id="t-threshold">
            <option value="0" ${Store.getRetryThreshold() === 0 ? 'selected' : ''}>بدون إعادة</option>
            ${[1, 2, 3, 4, 5].map(n => `<option value="${n}" ${Store.getRetryThreshold() === n ? 'selected' : ''}>${n} ${n === 1 ? 'كلمة' : 'كلمات'}</option>`).join('')}
          </select>
        </label>
      </div>

      <h3 class="section-title">🔁 التكرار</h3>
      <div class="card">
        <p>كرّر <b>${reps.total}</b> مرة (اليوم: <b>${todayReps}</b>)</p>
        ${topReps.length
          ? `<div class="chips en" dir="ltr">${topReps.map(([id, n]) => `<span class="chip-stat">${esc(Cur.word(id).en)} × ${n}</span>`).join('')}</div>`
          : '<p class="muted small">لم يستخدم التكرار بعد.</p>'}
      </div>

      <h3 class="section-title">⚠️ كلمات يكثر فيها الخطأ</h3>
      <div class="card">${hardRows ? `<ul class="plain">${hardRows}</ul>` : '<p class="muted">لا توجد أخطاء مسجلة بعد.</p>'}</div>

      <h3 class="section-title">آخر النشاط</h3>
      <div class="card">${logRows ? `<ul class="plain log">${logRows}</ul>` : '<p class="muted">لم يلعب بعد.</p>'}</div>

      <div class="row wrap">
        <button class="btn" data-act="t-copy" data-id="${s.id}">📋 نسخ التقرير (لولي الأمر)</button>
        <button class="btn ghost" data-act="t-pin" data-id="${s.id}">🔑 تغيير الرمز</button>
        <button class="btn ghost" data-act="t-reset" data-id="${s.id}">♻️ تصفير التقدم</button>
        <button class="btn danger" data-act="t-delete" data-id="${s.id}">🗑️ حذف الطالب</button>
      </div>`;

    const thresholdSel = document.getElementById('t-threshold');
    if (thresholdSel) {
      thresholdSel.addEventListener('change', () => {
        Store.setRetryThreshold(Number(thresholdSel.value));
        App.toast('تم حفظ إعداد الإعادة ✅');
      });
    }
  }

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
    if (await copyText(text)) App.toast('تم نسخ التقرير ✅ الصقه في واتساب');
    else App.showText('انسخ التقرير من هنا', text);
  };
  U.actions['t-pin'] = async el => {
    const s = await Store.getStudent(el.dataset.id);
    if (!s) return;
    const pin = await App.ask('الرمز السري الجديد (4 أرقام):', s.pin);
    if (pin === null) return;
    if (!/^\d{4}$/.test(pin.trim())) { App.toast('الرمز يجب أن يكون 4 أرقام'); return; }
    if (!Store.isPinUnique(s.grade, pin.trim(), s.id)) { App.toast('هذا الرمز مستخدم لطالب آخر في نفس الصف.'); return; }
    await Store.updateStudent(s.id, { pin: pin.trim() });
    App.toast('تم تغيير الرمز');
    studentView(s.id);
  };
  U.actions['t-reset'] = async el => {
    const s = await Store.getStudent(el.dataset.id);
    if (s && await App.confirm(`تصفير كل تقدم ${s.name}؟ لا يمكن التراجع.`, { okLabel: 'تصفير', danger: true })) {
      await Store.resetProgress(s.id);
      App.toast('تم التصفير');
      studentView(s.id);
    }
  };
  U.actions['t-delete'] = async el => {
    const s = await Store.getStudent(el.dataset.id);
    if (s && await App.confirm(`حذف الطالب ${s.name} نهائيًا؟`, { okLabel: 'حذف', danger: true })) {
      await Store.deleteStudent(s.id);
      App.go('#/teacher');
    }
  };
  U.actions['t-demo'] = async () => { await Store.seedDemo(); dashboard(); };
  U.actions['t-demo-clear'] = async () => {
    for (const s of await Store.listStudents()) if (s.demo) await Store.deleteStudent(s.id);
    dashboard();
  };
  U.actions['t-set-range'] = el => {
    const row = el.closest('.range-row');
    const sid = el.dataset.sid, gid = el.dataset.gid, uid = el.dataset.uid;
    const from = Number(row.querySelector('[data-k="from"]').value);
    const to = Number(row.querySelector('[data-k="to"]').value);
    if (from < 1 || to < from) { App.toast('تأكد من النطاق'); return; }
    Store.setRange(sid, gid, uid, from, to);
    App.toast(`تم حفظ النطاق: كلمة ${from} إلى ${to} ✅`);
  };

  U.actions['t-filter'] = el => {
    const f = el.dataset.f;
    document.querySelectorAll('.tiles .tile').forEach(b => b.classList.toggle('on', b === el));
    document.querySelectorAll('#t-list .t-student').forEach(row => {
      if (f === 'all') { row.style.display = ''; return; }
      if (f === 'today') { row.style.display = row.dataset.today === 'true' ? '' : 'none'; return; }
      if (f === 'idle') { row.style.display = row.dataset.late === 'true' ? '' : 'none'; return; }
    });
  };

  U.actions['t-exit'] = () => { Store.setTeacherAuthed(false); App.go('#/login'); };

  // ---------- المسار ----------
  async function route(parts) {
    if (!Store.teacherAuthed()) return loginView();
    const [sub, id] = parts;
    if (sub === 'add') return addView();
    if (sub === 's' && id) return studentView(id);
    if (sub === 'content' || sub === 'unit') return Content.route(parts);
    return dashboard();
  }

  return { route };
})();
