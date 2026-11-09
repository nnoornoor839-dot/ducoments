// المنافسة: ألقاب فريدة وترتيب بالنسبة المئوية من منهج الصف
const Compete = (() => {
  const esc = U.esc;
  const app = () => document.getElementById('app');

  // الكلمة المحفوظة = نقطة. الجملة تُحتسب بدرجتها من 10 (5 فأكثر)، وفي كل وحدة ثلاث جمل
  const WORD_PTS = 1;
  const SENT_MAX = 10;
  const SENTS_PER_UNIT = 3;

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

  // ---------- جولة الـ10 أيام ----------
  const roundPts = r => Math.max(0, r.words - r.bw) + Math.max(0, r.sents - r.bs);
  function roundScore(r) {
    const pts = roundPts(r), max = maxPts(r.grade);
    return { pts, pct: max ? Math.min(100, Math.round(pts / max * 1000) / 10) : 0 };
  }
  const MIN_PCT = 5;   // أقل تقدّم يُعلن به متميز (كما في الخادم)

  function roundHtml(rs) {
    const medals = ['🥇', '🥈', '🥉'];
    const rows = (rs.rows || []).map(r => Object.assign({}, r, roundScore(r))).filter(r => nickOf(r.nick))
      .sort((a, b) => (b.pct - a.pct) || (b.pts - a.pts) || nickOf(a.nick).ar.localeCompare(nickOf(b.nick).ar, 'ar'));
    const list = rows.map((r, i) => `
        <div class="b-row ${r.me ? 'me' : ''}">
          <span class="b-rank">${r.pts > 0 ? (medals[i] || i + 1) : '–'}</span>
          <span class="b-name"><b>${esc(nickOf(r.nick).ar)}</b>
            <span class="meter"><i style="width:${Math.min(100, r.pct * 4)}%"></i></span></span>
          <span class="b-pct"><b>${r.pct}٪</b><small>${r.pts} نقطة</small></span>
        </div>`).join('');
    const days = rs.round ? rs.round.days_left : 0;
    const head = rs.round
      ? `<p><b>الجولة الحالية</b> — ${days > 1 ? `باقي ${days} أيام` : days === 1 ? 'آخر يوم' : 'تنتهي اليوم'}</p>
         <p class="muted small">يُعلن متميز الجولة صاحب أعلى تقدّم خلالها (لا يقل عن ${MIN_PCT}٪ من منهج صفه)، ويسحب جائزته.</p>`
      : '<p class="muted">لم تبدأ جولة بعد. سيبدأها معلمك قريبًا.</p>';
    const hist = rs.history || [];
    const last = hist[0];
    const mineDraw = hist.find(h => h.can_draw);
    const banner = mineDraw
      ? `<section class="card prize-card">
           <h3>🎉 أنت متميز الجولة الماضية!</h3>
           <p>افتح صندوق الجائزة لتعرف جائزتك.</p>
           <button class="btn big" data-act="open-prize" data-round="${mineDraw.id}">🎁 افتح الصندوق</button>
           <p class="muted small" id="prize-out"></p>
         </section>`
      : hist.find(h => h.mine && h.prize)
        ? `<section class="card prize-card"><p>🎁 جائزتك: <b>${esc(hist.find(h => h.mine && h.prize).prize)}</b></p></section>` : '';
    const winners = hist.length ? `
      <h3 class="section-title">متميزو الجولات</h3>
      <section class="card">${hist.map(h => `
        <div class="b-row ${h.mine ? 'me' : ''}">
          <span class="b-rank">${h.winner_nick ? '🏆' : '–'}</span>
          <span class="b-name"><b>${h.winner_nick && nickOf(h.winner_nick) ? esc(nickOf(h.winner_nick).ar) : 'لا متميز'}</b>
            <small class="muted">${esc(h.starts)} → ${esc(h.ends)}</small></span>
          <span class="b-pct"><b>${h.winner_pct != null ? h.winner_pct + '٪' : ''}</b></span>
        </div>`).join('')}</section>` : '';
    return `
      ${banner}
      <section class="card">${head}</section>
      ${rs.round && list ? `<div class="board">${list}</div>` : ''}
      ${winners}`;
  }

  U.actions['open-prize'] = async el => {
    el.disabled = true;
    const out = document.getElementById('prize-out');
    const r = await Store.drawPrize(Number(el.dataset.round));
    if (r.error) { el.disabled = false; App.toast(ERRORS[r.error] || 'تعذّر فتح الصندوق الآن، حاول لاحقًا'); return; }
    Sfx.win();
    if (r.none) { if (out) out.textContent = 'لا توجد جوائز الآن. اطلب من معلمك أن يضيفها ثم افتح الصندوق.'; el.disabled = false; return; }
    el.parentElement.innerHTML = `<h3>🎁 جائزتك</h3><p class="prize-name"><b>${esc(r.prize)}</b></p><p class="muted small">أخبر معلمك ليسلّمك إياها.</p>`;
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
    const rs = await Store.getRound();   // جولة الـ10 أيام؛ إن لم يُشغَّل ترحيلها بعد نكتفي بالترتيب العام
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
      ${rs.ok ? roundHtml(rs) : ''}
      <h3 class="section-title">الترتيب العام</h3>
      <section class="card">
        ${myIdx >= 0 ? `<p>ترتيبك: <b>${myIdx + 1}</b> من ${rows.length}</p>` : ''}
        <p class="muted small">الترتيب بالنسبة المئوية لما حفظته من منهج صفّك: كل كلمة محفوظة بنقطة، وكل جملة تقرؤها بصوتك بدرجتها من 10 (من 5 فأكثر). فيتنافس الجميع بعدل مهما اختلف الصف.</p>
      </section>
      ${list ? `<div class="board">${list}</div>` : '<p class="card muted empty">لم يختر أحد لقبه بعد.</p>'}`;
  }

  return { NICKS, nickOf, route, score, maxPts, WORD_PTS, SENT_MAX, SENTS_PER_UNIT };
})();
