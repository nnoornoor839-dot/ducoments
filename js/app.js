// التنقل والشريط العلوي وربط الأحداث
const App = (() => {
  const app = () => document.getElementById('app');
  let toastTimer = null;

  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }

  // نافذة داخل الصفحة بدل confirm/prompt
  function modal({ title, message, input, numeric = true, textarea, editable = false, okLabel = 'موافق', cancelLabel = 'إلغاء', danger = false, cancel = true }) {
    return new Promise(resolve => {
      const wrap = document.createElement('div');
      wrap.className = 'modal-wrap';
      wrap.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true">
          ${title ? `<h3>${U.esc(title)}</h3>` : ''}
          ${message ? `<p>${U.esc(message)}</p>` : ''}
          ${input !== undefined ? `<input id="modal-in" value="${U.esc(input)}" ${numeric ? 'inputmode="numeric" maxlength="4"' : 'maxlength="40"'} autocomplete="off" aria-label="${U.esc(message || '')}">` : ''}
          ${textarea !== undefined ? `<textarea id="modal-ta" ${editable ? '' : 'readonly'} rows="9" dir="ltr" aria-label="${U.esc(title || '')}">${U.esc(textarea)}</textarea>` : ''}
          <div class="row">
            <button class="btn ${danger ? 'danger' : ''}" data-m="ok">${U.esc(okLabel)}</button>
            ${cancel ? `<button class="btn ghost" data-m="cancel">${U.esc(cancelLabel)}</button>` : ''}
          </div>
        </div>`;
      const field = wrap.querySelector('#modal-in');
      const area = wrap.querySelector('#modal-ta');
      const textual = !!field || (!!area && editable);
      const result = ok => (ok ? (field ? field.value : (textual ? area.value : true)) : (textual ? null : false));
      const close = ok => { document.removeEventListener('keydown', onKey); wrap.remove(); resolve(result(ok)); };
      function onKey(e) {
        if (e.key === 'Escape' && cancel) close(false);
        else if (e.key === 'Enter' && field) close(true);
      }
      wrap.addEventListener('click', e => {
        const b = e.target.closest('[data-m]');
        if (b) close(b.dataset.m === 'ok');
        else if (e.target === wrap && cancel) close(false);
      });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(wrap);
      if (field) { field.focus(); field.select(); }
      else if (area) { area.focus(); area.select(); }
      else wrap.querySelector('[data-m=ok]').focus();
    });
  }
  const confirmBox = (message, opts = {}) => modal({ message, okLabel: 'نعم', ...opts });
  const askBox = (message, value = '') => modal({ message, input: value });
  const alertBox = (title, message) => modal({ title, message, okLabel: 'حسنًا', cancel: false });
  const promptBox = (message, value = '') => modal({ message, input: value, numeric: false, okLabel: 'إضافة' });
  const showText = (title, text) => modal({ title, textarea: text, okLabel: 'تم', cancel: false });

  function go(hash) {
    if (location.hash === hash) route(); else location.hash = hash;
  }

  async function currentStudent() {
    const sess = Store.getSession();
    if (!sess || sess.role !== 'student') return null;
    const s = await Store.getStudent(sess.id);
    if (!s) Store.clearSession();
    return s;
  }

  function renderTop(teacherRoute, student) {
    let side = '';
    if (teacherRoute && Store.teacherAuthed()) {
      side = '<button class="top-btn" data-act="t-exit">خروج المعلم</button>';
    } else if (student) {
      side = `<span class="who">${U.esc(student.name)}</span><button class="top-btn" data-act="logout">خروج</button>`;
    }
    document.getElementById('topbar').innerHTML = `
      <a class="brand" href="#/"><img class="brand-logo" src="img/logo.png" width="36" height="36" alt=""><span>كلماتي</span></a>
      <div class="top-actions">${side}
        <button class="top-btn icon" data-act="toggle-sound" aria-label="تشغيل أو إيقاف الصوت">${ic(Sfx.isOn() ? 'volume' : 'volume-off')}</button>
      </div>`;
  }

  async function route() {
    Games.abort();
    Speech.stop();
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const [a, b, c, d] = parts;
    try {
      const student = await currentStudent();
      renderTop(a === 'teacher', student);
      // شاشة الدخول الأولى بلا شريط علوي: الشعار الكبير فيها يغني عنه
      document.body.classList.toggle('on-landing', a !== 'teacher' && (a === 'login' || !student));
      if (a === 'teacher') await Teacher.route(parts.slice(1));
      else if (a === 'login' || !student) await Views.login();
      else if (a === 'words') Views.wordList(student, b, c);
      else if (a === 'unit') Views.unit(student, b, c);
      else if (a === 'bank') Views.wordBank(student, b, c);
      else if (a === 'play') await Games.route(b, c, d);
      else await Views.home(student);
    } catch (e) {
      console.error(e);
      app().innerHTML = '<section class="card warn">حدث خطأ غير متوقع.<br><button class="btn" data-go="#/">الرئيسية</button></section>';
    }
    window.scrollTo(0, 0);
  }

  U.actions.logout = () => { Store.clearSession(); go('#/login'); };
  U.actions['toggle-sound'] = el => { el.innerHTML = ic(Sfx.toggle() ? 'volume' : 'volume-off'); };

  document.addEventListener('click', e => {
    const g = e.target.closest('[data-go]');
    if (g) { e.preventDefault(); go(g.dataset.go); return; }
    const a = e.target.closest('[data-act]');
    if (a && U.actions[a.dataset.act]) U.actions[a.dataset.act](a, e);
  });
  document.addEventListener('submit', e => {
    const f = e.target.closest('[data-form]');
    if (f) { e.preventDefault(); if (U.forms[f.dataset.form]) U.forms[f.dataset.form](f, e); }
  });
  window.addEventListener('hashchange', route);

  route();
  // المنهج والإعدادات من السحابة: نعرض المحفوظ فورًا ثم نحدّث الشاشة إن تغيّرت الكلمات
  Store.init().then(changed => { if (changed && !location.hash.startsWith('#/play')) route(); });
  return { toast, go, currentStudent, confirm: confirmBox, ask: askBox, prompt: promptBox, alert: alertBox, showText };
})();
