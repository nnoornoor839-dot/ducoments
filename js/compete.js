// المنافسة: ألقاب فريدة وترتيب بالنسبة المئوية من منهج الصف
const Compete = (() => {
  const esc = U.esc;
  const app = () => document.getElementById('app');
  const SKIP_KEY = 'kalimati.nickSkip';

  // الكلمة المحفوظة = نقطة. الجملة تُحتسب بدرجتها من 10 (5 فأكثر) حين تُفعَّل قراءة الجمل
  const WORD_PTS = 1;
  const SENT_MAX = 10;
  const SENTS_PER_UNIT = 0;

  // [المعرّف، العربي، الإنجليزي]
  const NICKS = [
    ['falcon', 'الصقر', 'Falcon'], ['lion', 'الأسد', 'Lion'], ['eagle', 'النسر', 'Eagle'], ['hawk', 'العقاب', 'Hawk'],
    ['cheetah', 'الفهد', 'Cheetah'], ['leopard', 'النمر', 'Leopard'], ['wolf', 'الذئب', 'Wolf'], ['oryx', 'المها', 'Oryx'],
    ['gazelle', 'الغزال', 'Gazelle'], ['stallion', 'الجواد', 'Stallion'], ['shaheen', 'الشاهين', 'Shaheen'], ['panther', 'الفهد الأسود', 'Panther'],
    ['fox', 'الثعلب', 'Fox'], ['lynx', 'الوشق', 'Lynx'], ['ibex', 'الوعل', 'Ibex'], ['shark', 'القرش', 'Shark'],
    ['dolphin', 'الدلفين', 'Dolphin'], ['phoenix', 'العنقاء', 'Phoenix'], ['dragon', 'التنين', 'Dragon'], ['knight', 'الفارس', 'Knight'],
    ['champion', 'البطل', 'Champion'], ['star', 'النجم', 'Star'], ['comet', 'المذنب', 'Comet'], ['thunder', 'الرعد', 'Thunder'],
    ['storm', 'العاصفة', 'Storm'], ['rocket', 'الصاروخ', 'Rocket'], ['spark', 'الشرارة', 'Spark'], ['lightning', 'البرق', 'Lightning']
  ].map(([id, ar, en]) => ({ id, ar, en }));
  const byId = Object.fromEntries(NICKS.map(n => [n.id, n]));
  const nickOf = id => byId[id] || null;

  const skipped = () => { try { return sessionStorage.getItem(SKIP_KEY) === '1'; } catch (e) { return false; } };

  function maxPts(gid) {
    const g = Cur.grade(gid);
    if (!g) return 0;
    return Cur.allWords(g).length * WORD_PTS + g.units.length * SENTS_PER_UNIT * SENT_MAX;
  }
  function score(row) {
    const pts = row.words * WORD_PTS + row.sents;
    const max = maxPts(row.grade);
    return { pts, pct: max ? Math.min(100, Math.round(pts / max * 1000) / 10) : 0 };
  }

  const PICK_ERRORS = {
    taken: 'سبقك أحد إلى هذا اللقب، اختر لقبًا آخر',
    locked: 'لقبك محفوظ مسبقًا',
    offline: 'لا يوجد اتصال بالإنترنت',
    auth: 'انتهت الجلسة، ادخل من جديد'
  };

  // ---------- اختيار اللقب (أول دخول) ----------
  async function pick(student) {
    const res = await Store.getLeaderboard(student.id);
    const unavailable = !!res.error;
    const taken = new Set((res.rows || []).map(r => r.nick));
    const items = NICKS.map(n => `
      <button class="nick-btn" data-act="pick-nick" data-id="${n.id}" ${taken.has(n.id) ? 'disabled' : ''}>
        <b>${esc(n.ar)}</b>
        <small class="en" dir="ltr">${esc(n.en)}${taken.has(n.id) ? ' • محجوز' : ''}</small>
      </button>`).join('');
    app().innerHTML = `
      <section class="card">
        <h2>${ic('trophy')} اختر لقبك</h2>
        <p class="muted">هذا هو اسمك في المنافسة، يراه زملاؤك بدل اسمك الحقيقي. <b>اللقب الذي تختاره يبقى لك ولا يستطيع غيرك أخذه، ولا يمكن تغييره بعد ذلك.</b></p>
        ${unavailable ? '<p class="warn-text small">تعذّر تحميل الألقاب المحجوزة الآن. يمكنك المحاولة لاحقًا.</p>' : ''}
      </section>
      <div class="nick-grid">${items}</div>
      <button class="btn ghost" data-act="skip-nick">لاحقًا</button>`;
  }

  U.actions['pick-nick'] = async el => {
    const n = nickOf(el.dataset.id);
    const student = await App.currentStudent();
    if (!n || !student) return;
    const ok = await App.confirm(`هل تريد اللقب «${n.ar} — ${n.en}»؟ لن تستطيع تغييره بعد ذلك.`, { okLabel: 'نعم، هذا لقبي' });
    if (!ok) return;
    const r = await Store.setNick(student.id, n.id);
    if (r.ok) { App.toast(`أصبح لقبك: ${n.ar}`); App.go('#/'); return; }
    App.toast(PICK_ERRORS[r.error] || 'تعذّر حفظ اللقب، حاول مرة أخرى');
    if (r.error === 'taken') pick(student);
  };
  U.actions['skip-nick'] = () => {
    try { sessionStorage.setItem(SKIP_KEY, '1'); } catch (e) { /* تجاهل */ }
    App.go('#/');
  };

  // ---------- صفحة الترتيب ----------
  async function route(student) {
    if (!student.nick) return pick(student);
    const res = await Store.getLeaderboard(student.id);
    if (res.error) {
      app().innerHTML = `
        <button class="back" data-go="#/">‹ الرئيسية</button>
        <section class="card warn">تعذّر تحميل الترتيب الآن (${esc(PICK_ERRORS[res.error] || 'حاول لاحقًا')}).</section>`;
      return;
    }
    const rows = res.rows
      .map(r => Object.assign({}, r, score(r)))
      .filter(r => nickOf(r.nick))
      .sort((a, b) => (b.pct - a.pct) || (b.pts - a.pts) || nickOf(a.nick).ar.localeCompare(nickOf(b.nick).ar, 'ar'));
    const medals = ['🥇', '🥈', '🥉'];
    const myIdx = rows.findIndex(r => r.me);
    const list = rows.map((r, i) => {
      const n = nickOf(r.nick);
      return `
        <div class="b-row ${r.me ? 'me' : ''}">
          <span class="b-rank">${medals[i] || i + 1}</span>
          <span class="b-name"><b>${esc(n.ar)}</b><small class="en" dir="ltr">${esc(n.en)}</small>
            <span class="meter"><i style="width:${r.pct}%"></i></span></span>
          <span class="b-pct"><b>${r.pct}٪</b><small>${r.pts} نقطة</small></span>
        </div>`;
    }).join('');
    app().innerHTML = `
      <button class="back" data-go="#/">‹ الرئيسية</button>
      <h2 class="section-title">${ic('trophy')} المنافسة</h2>
      <section class="card">
        ${myIdx >= 0 ? `<p>ترتيبك: <b>${myIdx + 1}</b> من ${rows.length}</p>` : ''}
        <p class="muted small">الترتيب بالنسبة المئوية لما حفظته من منهج صفّك: كل كلمة محفوظة بنقطة. فيتنافس الجميع بعدل مهما اختلف الصف.</p>
      </section>
      ${list ? `<div class="board">${list}</div>` : '<p class="card muted empty">لم يختر أحد لقبه بعد.</p>'}`;
  }

  return { NICKS, nickOf, skipped, pick, route, score, maxPts, WORD_PTS, SENT_MAX, SENTS_PER_UNIT };
})();
