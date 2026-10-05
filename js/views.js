// شاشات الطالب: اختيار الصف، الدخول، الرئيسية، الوحدة، قائمة الكلمات
const Views = (() => {
  const esc = U.esc;
  const app = () => document.getElementById('app');
  let pendingStudent = null;
  let selectedGrade = null;
  const REP_STEPS = [3, 5, 10, 15, 20, 30, 50, 100];
  const repDefault = () => { const v = Number(U.lsGet('kalimati.repn', '10')); return REP_STEPS.includes(v) ? v : 10; };

  function speedBar() {
    const cur = Speech.getSpeed();
    return `<div class="speedbar" role="group" aria-label="سرعة النطق">${Speech.SPEEDS.map(s =>
      `<button class="sp ${s.id === cur ? 'on' : ''}" data-act="speed" data-id="${s.id}">${s.emoji} ${s.label}</button>`).join('')}</div>`;
  }

  // ---------- الدخول: اختر الصف → ابحث عن اسمك → الرمز السري ----------
  async function login() {
    selectedGrade = null;
    pendingStudent = null;
    const gradesWithUnits = Cur.grades.filter(g => g.units.length);

    app().innerHTML = `
      <section class="card login">
        <h1>📚 كلماتي</h1>
        <p class="muted">اختر صفك للدخول</p>
        <div class="grade-list">
          ${gradesWithUnits.map(g => `
            <button class="grade-pick" data-act="pick-grade" data-id="${g.id}">
              <span class="grade-icon">📘</span>
              <b>${esc(g.name)}</b>
            </button>`).join('') || '<p class="muted">لا توجد صفوف بها وحدات بعد.</p>'}
        </div>
        <div id="grade-students" class="hidden">
          <p class="muted" id="grade-label"></p>
          <div class="student-list" id="student-grid"></div>
        </div>
        <form id="pin-form" data-form="pin" class="pin-form hidden">
          <p id="pin-who"></p>
          <input id="pin-in" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="الرمز السري (4 أرقام)" aria-label="الرمز السري">
          <button class="btn" type="submit">دخول</button>
          <p class="err" id="pin-err"></p>
        </form>
        <div class="login-links">
          <button class="btn ghost" data-go="#/quick">🚀 تجربة سريعة</button>
          <button class="btn ghost" data-go="#/teacher">👩‍🏫 دخول المعلم</button>
        </div>
      </section>`;
    const input = document.getElementById('pin-in');
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '');
      if (input.value.length === 4) U.forms.pin();
    });
  }

  U.actions['pick-grade'] = async el => {
    selectedGrade = el.dataset.id;
    document.querySelectorAll('.grade-pick').forEach(b => b.classList.toggle('on', b.dataset.id === selectedGrade));

    const students = (await Store.listStudents())
      .filter(s => s.grade === selectedGrade)
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));

    const container = document.getElementById('grade-students');
    const grid = document.getElementById('student-grid');
    const label = document.getElementById('grade-label');

    label.textContent = students.length ? 'اختر اسمك:' : 'لا يوجد طلاب في هذا الصف بعد. ادخل كمعلم لإضافة الطلاب.';
    grid.innerHTML = students.map(s => `
      <button class="student-pick" data-act="pick-student" data-id="${s.id}">
        <span class="av">${s.avatar}</span><b>${esc(s.name)}</b>
      </button>`).join('');
    container.classList.remove('hidden');

    // إخفاء نموذج الرمز إن كان ظاهرًا
    document.getElementById('pin-form').classList.add('hidden');
    pendingStudent = null;
  };

  U.actions['pick-student'] = async el => {
    const s = await Store.getStudent(el.dataset.id);
    if (!s) return;
    pendingStudent = s.id;
    document.querySelectorAll('.student-pick').forEach(b => b.classList.toggle('on', b === el));
    document.getElementById('pin-who').textContent = `مرحبًا ${s.name}، اكتب رمزك السري:`;
    document.getElementById('pin-err').textContent = '';
    const f = document.getElementById('pin-form');
    f.classList.remove('hidden');
    const input = document.getElementById('pin-in');
    input.value = '';
    input.focus();
  };

  U.forms.pin = async () => {
    if (!pendingStudent) return;
    const input = document.getElementById('pin-in');
    const s = await Store.loginStudent(pendingStudent, input.value);
    if (s) { App.go('#/'); return; }
    document.getElementById('pin-err').textContent = 'الرمز غير صحيح، حاول مرة أخرى';
    input.value = '';
    input.focus();
  };

  // ---------- تجربة سريعة ----------
  function quick() {
    app().innerHTML = `
      <section class="card login">
        <h1>تجربة سريعة 🚀</h1>
        <p class="muted">أنشئ حسابًا تجريبيًا على هذا الجهاز وابدأ فورًا.</p>
        <form data-form="quick" class="stack">
          <label>الاسم<input name="name" value="ضيف" maxlength="20" required></label>
          <label>الصف<select name="grade">${Cur.grades.map(g =>
            `<option value="${g.id}" ${g.units.length ? '' : 'disabled'}>${esc(g.name)}${g.units.length ? '' : ' (لا وحدات بعد)'}</option>`).join('')}</select></label>
          <button class="btn" type="submit">ابدأ</button>
        </form>
        <button class="btn ghost" data-go="#/login">رجوع</button>
      </section>`;
    const sel = document.querySelector('select[name=grade]');
    const firstWithUnits = Cur.grades.find(g => g.units.length);
    if (firstWithUnits) sel.value = firstWithUnits.id;
  }

  U.forms.quick = async form => {
    const name = form.elements.name.value.trim() || 'ضيف';
    const s = await Store.addStudent({ name, grade: form.elements.grade.value, pin: '0000' });
    Store.setSession({ role: 'student', id: s.id });
    App.go('#/');
  };

  // ---------- الرئيسية ----------
  async function home(s) {
    const grade = Cur.grade(s.grade);

    const units = grade ? grade.units.map(u => {
      const st = Progress.unitStats(s, u);
      return `
        <button class="unit-card" data-go="#/unit/${grade.id}/${u.id}">
          <b class="en" dir="ltr">${esc(u.title)}</b>
          <span class="meter"><i style="width:${st.pct}%"></i></span>
          <small>${st.mastered} من ${st.total} كلمة محفوظة</small>
        </button>`;
    }).join('') : '';

    app().innerHTML = `
      <section class="card" style="text-align:center">
        <div class="av big">${s.avatar}</div>
        <h2>أهلًا ${esc(s.name)} 👋</h2>
        <p class="muted">${esc(grade ? grade.name : '')}</p>
      </section>

      <h3 class="section-title">الوحدات</h3>
      ${units ? `<div class="units">${units}</div>` : '<p class="card muted empty">لم تُضف وحدات هذا الصف بعد. سيضيفها المعلم قريبًا.</p>'}`;
  }

  // ---------- صفحة الوحدة: أيقونتان ----------
  function unit(s, gid, uid) {
    const grade = Cur.grade(gid), u = Cur.unit(gid, uid);
    if (!grade || !u) return App.go('#/');
    const st = Progress.unitStats(s, u);

    app().innerHTML = `
      <button class="back" data-go="#/">‹ رجوع للوحدات</button>
      <section class="card unit-head">
        <h2 class="en" dir="ltr">${esc(u.title)}</h2>
        <div class="meter"><i style="width:${st.pct}%"></i></div>
        <p class="muted small">${st.mastered} من ${st.total} كلمة محفوظة</p>
      </section>

      <div class="unit-actions">
        <button class="unit-action-btn" data-go="#/words/${gid}/${uid}">
          <span class="unit-action-icon">📖</span>
          <b>كلمات الوحدة</b>
          <small>اعرض الكلمات والجمل واستمع لها</small>
        </button>
        <button class="unit-action-btn" data-go="#/play/dictation/${gid}/${uid}">
          <span class="unit-action-icon">🎯</span>
          <b>تسميع الكلمات</b>
          <small>استمع واختر المعنى أو الكلمة</small>
        </button>
      </div>`;
  }

  // ---------- قائمة الكلمات ----------
  const repsOf = (s, wid) => (s.reps && s.reps.byWord && s.reps.byWord[wid]) || 0;

  function gapBar() {
    const cur = Speech.getGap();
    return `<div class="gapbar" role="group" aria-label="التوقف بين مرات التكرار">
      <span class="muted small">⏱ التوقف بين المرات:</span>
      ${Speech.GAPS.map(g => `<button class="sp ${g.ms === cur ? 'on' : ''}" data-act="gap" data-ms="${g.ms}">${g.label} ${g.sec}</button>`).join('')}
    </div>`;
  }

  function wordCard(s, w) {
    return `
      <article class="wcard" data-wid="${w.id}">
        <div class="w-head">
          <button class="w-en en" data-act="word" dir="ltr">${esc(w.en)} <i class="spk">🔊</i></button>
        </div>
        ${w.ar ? `<div class="w-ar">${esc(w.ar)}</div>` : ''}
        ${w.sentence ? `
          <button class="w-sent en" data-act="sent" dir="ltr">${Games.hl(w)} <i class="spk">🔊</i></button>
          ${w.sentenceAr ? `<div class="w-tr">${esc(w.sentenceAr)}</div>` : ''}` : ''}
        ${w.page ? `<span class="pg">📖 صفحة ${esc(w.page)}</span>` : ''}
        <div class="reps">
          <div class="rep-set">
            <span class="rep-lbl">🔁 كرّر</span>
            <button class="step" data-act="rep-minus" aria-label="أقل">−</button>
            <b class="rep-n" data-n="${repDefault()}">${repDefault()}</b>
            <button class="step" data-act="rep-plus" aria-label="أكثر">+</button>
            <span class="rep-lbl">مرة</span>
          </div>
          <div class="rep-go">
            <button class="mini go" data-act="rep-word">▶ الكلمة</button>
            ${w.sentence ? '<button class="mini go" data-act="rep-sent">▶ الجملة</button>' : ''}
          </div>
        </div>
        <div class="rep-live hidden">
          <b class="rep-count">1 من 1</b>
          <span class="meter"><i></i></span>
          <button class="mini stop" data-act="rep-stop">⏹ إيقاف</button>
        </div>
        <small class="rep-total muted">${repsOf(s, w.id) ? `مجموع تكرارك: ${repsOf(s, w.id)} مرة` : ''}</small>
      </article>`;
  }

  function wordList(s, gid, uid) {
    const grade = Cur.grade(gid), u = Cur.unit(gid, uid);
    if (!grade || !u) return App.go('#/');

    app().innerHTML = `
      <button class="back" data-go="#/unit/${gid}/${uid}">‹ رجوع للوحدة</button>
      <h2 class="section-title">📖 كلمات الوحدة: <span class="en" dir="ltr">${esc(u.title)}</span></h2>
      ${Speech.supported ? '' : '<p class="card warn">متصفحك لا يدعم نطق الكلمات. جرّب Chrome أو Safari.</p>'}
      ${gapBar()}
      <div class="sticky-speed">${speedBar()}</div>
      <div class="words">${u.words.map(w => wordCard(s, w)).join('')}</div>`;
  }

  // ---------- أحداث الكلمات والسرعة ----------
  function wordOf(el) {
    const card = el.closest('[data-wid]');
    return card ? { card, w: Cur.word(card.dataset.wid) } : null;
  }
  function speak(el, fn) {
    const ctx = wordOf(el);
    if (!ctx) return;
    if (!Speech.supported) { App.toast('المتصفح لا يدعم النطق'); return; }
    document.querySelectorAll('.wcard.playing').forEach(c => c.classList.remove('playing'));
    ctx.card.classList.add('playing');
    Promise.resolve(fn(ctx.w)).finally(() => ctx.card.classList.remove('playing'));
  }

  U.actions.word = el => speak(el, w => Speech.word(w.en));
  U.actions.sent = el => speak(el, w => Speech.sentence(w.sentence));
  function stepRep(el, dir) {
    const b = el.closest('.wcard').querySelector('.rep-n');
    const i = Math.max(0, Math.min(REP_STEPS.length - 1, REP_STEPS.indexOf(Number(b.dataset.n)) + dir));
    b.dataset.n = REP_STEPS[i];
    b.textContent = REP_STEPS[i];
    U.lsSet('kalimati.repn', String(REP_STEPS[i]));
  }
  U.actions['rep-minus'] = el => stepRep(el, -1);
  U.actions['rep-plus'] = el => stepRep(el, 1);

  async function runReps(el, kind) {
    const ctx = wordOf(el);
    if (!ctx) return;
    if (!Speech.supported) { App.toast('المتصفح لا يدعم النطق'); return; }
    const { card, w } = ctx;
    const n = Number(card.querySelector('.rep-n').dataset.n);
    const set = card.querySelector('.reps'), live = card.querySelector('.rep-live');
    const count = live.querySelector('.rep-count'), bar = live.querySelector('.meter i');
    document.querySelectorAll('.wcard.playing').forEach(c => c.classList.remove('playing'));
    set.classList.add('hidden');
    live.classList.remove('hidden');
    card.classList.add('playing');
    count.textContent = `0 من ${n}`;
    bar.style.width = '0';
    const done = await Speech.loop(kind === 'sent' ? w.sentence : w.en, n, i => {
      count.textContent = `${i} من ${n}`;
      bar.style.width = (i / n * 100) + '%';
    });
    set.classList.remove('hidden');
    live.classList.add('hidden');
    card.classList.remove('playing');
    if (!done) return;
    const sess = Store.getSession();
    const res = sess ? await Store.recordReps(sess.id, w.id, done) : null;
    const mine = sess ? await Store.getStudent(sess.id) : null;
    const total = card.querySelector('.rep-total');
    if (total && mine) total.textContent = `مجموع تكرارك: ${repsOf(mine, w.id)} مرة`;
    App.toast(done === n
      ? `أحسنت! كرّرت ${done} مرة 🎉${res && res.xpGained ? ` (+${res.xpGained} نقطة)` : ''}`
      : `كرّرت ${done} مرة`);
  }
  U.actions['rep-word'] = el => runReps(el, 'word');
  U.actions['rep-sent'] = el => runReps(el, 'sent');
  U.actions['rep-stop'] = () => Speech.stop();
  U.actions.gap = el => {
    Speech.setGap(Number(el.dataset.ms));
    document.querySelectorAll('.gapbar .sp').forEach(b => b.classList.toggle('on', b.dataset.ms === el.dataset.ms));
  };
  U.actions.speed = el => {
    Speech.setSpeed(el.dataset.id);
    document.querySelectorAll('.speedbar .sp').forEach(b => b.classList.toggle('on', b.dataset.id === el.dataset.id));
  };

  return { speedBar, login, quick, home, unit, wordList };
})();
