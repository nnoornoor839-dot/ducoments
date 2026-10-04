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
      side = `<span class="who">${student.avatar} ${U.esc(student.name)}</span><button class="top-btn" data-act="logout">خروج</button>`;
    }
    document.getElementById('topbar').innerHTML = `
      <a class="brand" href="#/">📚 كلماتي</a>
      <div class="top-actions">${side}
        <button class="top-btn icon" data-act="toggle-sound" aria-label="تشغيل أو إيقاف الصوت">${Sfx.isOn() ? '🔊' : '🔇'}</button>
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
      if (a === 'teacher') await Teacher.route(parts.slice(1));
      else if (a === 'quick') Views.quick();
      else if (a === 'login' || !student) await Views.login();
      else if (a === 'unit') Views.unit(student, b, c);
      else if (a === 'play') await Games.route(b, c, d);
      else await Views.home(student);
    } catch (e) {
      console.error(e);
      app().innerHTML = '<section class="card warn">حدث خطأ غير متوقع.<br><button class="btn" data-go="#/">الرئيسية</button></section>';
    }
    window.scrollTo(0, 0);
  }

  U.actions.logout = () => { Store.clearSession(); go('#/login'); };
  U.actions['toggle-sound'] = el => { el.textContent = Sfx.toggle() ? '🔊' : '🔇'; };

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

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* اختياري */ });
  }

  route();
  return { toast, go, currentStudent };
})();
