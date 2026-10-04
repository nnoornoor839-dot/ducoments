// شاشات الطالب: الدخول، الرئيسية، الوحدة
const Views = (() => {
  const esc = U.esc;
  const app = () => document.getElementById('app');
  const STATUS = { new: 'جديدة', learning: 'أتعلمها', mastered: 'محفوظة' };
  let pendingStudent = null;

  function speedBar() {
    const cur = Speech.getSpeed();
    return `<div class="speedbar" role="group" aria-label="سرعة النطق">${Speech.SPEEDS.map(s =>
      `<button class="sp ${s.id === cur ? 'on' : ''}" data-act="speed" data-id="${s.id}">${s.emoji} ${s.label}</button>`).join('')}</div>`;
  }

  function stars(n, total = 3) {
    return Array.from({ length: total }, (_, i) => `<span class="${i < n ? 'on' : ''}">★</span>`).join('');
  }

  // ---------- الدخول ----------
  async function login() {
    const students = (await Store.listStudents()).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    pendingStudent = null;
    app().innerHTML = `
      <section class="card login">
        <h1>أهلًا بك 👋</h1>
        <p class="muted">اختر اسمك للدخول</p>
        <div class="student-list">${students.map(s => `
          <button class="student-pick" data-act="pick-student" data-id="${s.id}">
            <span class="av">${s.avatar}</span><b>${esc(s.name)}</b><small>${esc((Cur.grade(s.grade) || {}).short || '')}</small>
          </button>`).join('') || '<p class="muted empty">لا يوجد طلاب على هذا الجهاز بعد. ادخل كمعلم لإضافة الطلاب، أو جرّب التطبيق مباشرة.</p>'}
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
    const info = Progress.levelInfo(s.xp);
    const streak = Progress.streak(s);
    const daily = Math.min(Progress.dailyCount(s), Progress.DAILY_GOAL);
    const due = grade ? Progress.dueWords(s, grade).length : 0;
    const gs = grade ? Progress.gradeStats(s, grade) : { total: 0, mastered: 0, pct: 0 };

    const units = grade ? grade.units.map(u => {
      const st = Progress.unitStats(s, u);
      const n = (s.units[grade.id + '.' + u.id] || {}).stars || 0;
      return `
        <button class="unit-card" data-go="#/unit/${grade.id}/${u.id}">
          <b class="en" dir="ltr">${esc(u.title)}</b>
          <span class="stars">${stars(n)}</span>
          <span class="meter"><i style="width:${st.pct}%"></i></span>
          <small>${st.mastered} من ${st.total} كلمة محفوظة</small>
        </button>`;
    }).join('') : '';

    app().innerHTML = `
      <section class="hero card">
        <div class="av big">${s.avatar}</div>
        <div class="hero-main">
          <h2>أهلًا ${esc(s.name)} 👋</h2>
          <p class="muted">${esc(grade ? grade.name : '')} • المستوى ${info.level}: ${esc(info.title)}</p>
          <div class="meter xp" title="${info.into} / ${info.size}"><i style="width:${info.into}%"></i></div>
          <div class="chips">
            <span class="chip-stat">🔥 ${streak} ${streak === 1 ? 'يوم' : 'أيام'} متتالية</span>
            <span class="chip-stat">⭐ ${s.xp} نقطة</span>
          </div>
        </div>
      </section>

      <section class="card goal">
        <div class="goal-head"><b>🎯 هدف اليوم</b><span>${daily} من ${Progress.DAILY_GOAL} إجابة صحيحة</span></div>
        <div class="meter ${daily >= Progress.DAILY_GOAL ? 'done' : ''}"><i style="width:${daily / Progress.DAILY_GOAL * 100}%"></i></div>
        ${gs.total ? `<p class="muted small">حفظت ${gs.mastered} من ${gs.total} كلمة في صفك (${gs.pct}٪)</p>` : ''}
      </section>

      ${due ? `<button class="btn big review" data-go="#/play/review/${grade.id}/all">🔁 مراجعة اليوم <span class="badge-num">${due}</span></button>` : ''}

      <h3 class="section-title">وحداتك</h3>
      ${units ? `<div class="units">${units}</div>` : '<p class="card muted empty">لم تُضف وحدات هذا الصف بعد. سيضيفها المعلم قريبًا.</p>'}`;
  }

  // ---------- الوحدة ----------
  function wordCard(s, w) {
    const st = Progress.wordStatus(s, w.id);
    return `
      <article class="wcard st-${st}" data-wid="${w.id}">
        <div class="w-head">
          <button class="w-en en" data-act="word" dir="ltr">${esc(w.en)} <i class="spk">🔊</i></button>
          <span class="badge ${st}">${STATUS[st]}</span>
        </div>
        ${w.ar ? `<div class="w-ar">${esc(w.ar)}</div>` : ''}
        ${w.sentence ? `
          <button class="w-sent en" data-act="sent" dir="ltr">${Games.hl(w)} <i class="spk">🔊</i></button>
          ${w.sentenceAr ? `<div class="w-tr hidden">${esc(w.sentenceAr)}</div>` : ''}` : ''}
        <div class="w-actions">
          <button class="mini" data-act="rep">🔁 ×3</button>
          <button class="mini" data-act="spell">🔤 تهجئة</button>
          ${w.sentenceAr ? '<button class="mini" data-act="tr">🈯 ترجمة الجملة</button>' : ''}
          ${w.page ? `<span class="pg">📖 صفحة ${esc(w.page)}</span>` : ''}
        </div>
      </article>`;
  }

  function unit(s, gid, uid) {
    const grade = Cur.grade(gid), u = Cur.unit(gid, uid);
    if (!grade || !u) return App.go('#/');
    const st = Progress.unitStats(s, u);
    const n = (s.units[gid + '.' + uid] || {}).stars || 0;
    const best = (s.units[gid + '.' + uid] || {}).speedBest || 0;
    const modes = ['test', 'cloze', 'listen', 'scramble', 'speed'].map(id => {
      const m = Games.MODES[id];
      return `<button class="mode" data-go="#/play/${id}/${gid}/${uid}"><span class="ic">${m.icon}</span><b>${m.title}</b><small>${m.desc}</small></button>`;
    }).join('');

    app().innerHTML = `
      <button class="back" data-go="#/">‹ رجوع للوحدات</button>
      <section class="card unit-head">
        <h2 class="en" dir="ltr">${esc(u.title)}</h2>
        <div class="stars">${stars(n)}</div>
        <div class="meter"><i style="width:${st.pct}%"></i></div>
        <p class="muted small">${st.mastered} محفوظة • ${st.learning} أتعلمها • ${st.fresh} جديدة${best ? ` • أفضل تحدٍّ: ${best}` : ''}</p>
      </section>

      <h3 class="section-title">العب وتدرّب</h3>
      <div class="modes">${modes}</div>

      <h3 class="section-title">كلمات الوحدة <small class="muted">(اضغط على الكلمة أو الجملة لتسمعها)</small></h3>
      ${Speech.supported ? '' : '<p class="card warn">متصفحك لا يدعم نطق الكلمات. جرّب Chrome أو Safari.</p>'}
      <div class="sticky-speed">${speedBar()}</div>
      <div class="words">${u.words.map(w => wordCard(s, w)).join('')}</div>`;
  }

  // ---------- أحداث الوحدة والسرعة ----------
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
  U.actions.rep = el => speak(el, w => Speech.repeat(w.en, 3));
  U.actions.spell = el => speak(el, w => Speech.spell(w.en));
  U.actions.tr = el => {
    const ctx = wordOf(el);
    const tr = ctx && ctx.card.querySelector('.w-tr');
    if (tr) tr.classList.toggle('hidden');
  };
  U.actions.speed = el => {
    Speech.setSpeed(el.dataset.id);
    document.querySelectorAll('.speedbar .sp').forEach(b => b.classList.toggle('on', b.dataset.id === el.dataset.id));
  };

  return { speedBar, login, quick, home, unit };
})();
