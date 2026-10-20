// المنافسة: ألقاب فريدة وترتيب بالنسبة المئوية من منهج الصف
const Compete = (() => {
  const esc = U.esc;
  const app = () => document.getElementById('app');

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

  const ERRORS = {
    offline: 'لا يوجد اتصال بالإنترنت',
    auth: 'انتهت الجلسة، ادخل من جديد'
  };

  // ---------- صفحة الترتيب ----------
  async function route(student) {
    if (!student.nick) {
      app().innerHTML = `
        <button class="back" data-go="#/">‹ الرئيسية</button>
        <section class="card notice">
          <span class="notice-ic">${ic('trophy')}</span>
          <div><b>لم يُسند لك لقب بعد</b><p class="muted">سيُسند لك معلمك لقبًا لتدخل المنافسة.</p></div>
        </section>`;
      return;
    }
    const res = await Store.getLeaderboard(student.id);
    if (res.error) {
      app().innerHTML = `
        <button class="back" data-go="#/">‹ الرئيسية</button>
        <section class="card warn">تعذّر تحميل الترتيب الآن (${esc(ERRORS[res.error] || 'حاول لاحقًا')}).</section>`;
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

  return { NICKS, nickOf, route, score, maxPts, WORD_PTS, SENT_MAX, SENTS_PER_UNIT };
})();
