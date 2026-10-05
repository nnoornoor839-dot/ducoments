// التسميع: استمع واختر المعنى العربي، أو استمع واختر الكلمة الإنجليزية
const Games = (() => {
  // أسماء الأنماط: القديمة محفوظة لعرض سجل النشاط القديم في لوحة المعلم
  const MODES = {
    dictation: { icon: 'target', title: 'تسميع الكلمات', desc: 'استمع واختر المعنى أو الكلمة' },
    test: { icon: 'target', title: 'تسميع' },
    cloze: { icon: 'edit', title: 'أكمل الجملة' },
    listen: { icon: 'volume', title: 'استمع واختر' },
    scramble: { icon: 'shuffle', title: 'رتّب الجملة' },
    speed: { icon: 'zap', title: 'تحدي السرعة' },
    review: { icon: 'repeat', title: 'مراجعة' }
  };
  let active = null;

  const esc = U.esc;
  const norm = t => String(t).toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9\s']/g, ' ').replace(/\s+/g, ' ').trim();

  function hl(w) {
    const b = Cur.blank(w);
    return b ? `${esc(b.before)}<mark>${esc(b.match)}</mark>${esc(b.after)}` : esc(w.sentence || '');
  }

  // ---------- بناء الأسئلة ----------
  function options(w, pool, key, n = 4) {
    const used = new Set([String(w[key]).toLowerCase()]);
    const others = pool.filter(p => p.id !== w.id)
      .map(p => [(p.unitId === w.unitId ? 0 : 1) + Math.random() * 0.99, p])
      .sort((a, b) => a[0] - b[0]).map(x => x[1]);
    const out = [w];
    for (const p of others) {
      const k = String(p[key]).toLowerCase();
      if (p[key] && !used.has(k)) { used.add(k); out.push(p); if (out.length >= n) break; }
    }
    return U.shuffle(out);
  }

  function build(type, w, pool, extra = {}) {
    if ((type === 'listen' || type === 'meaning') && pool.length < 3) return null;
    const q = { type, w, ...extra };
    if (type === 'listen') q.opts = options(w, pool, 'en');
    if (type === 'meaning') q.opts = options(w, pool, 'ar');
    return q;
  }

  function plan(words, pool) {
    const qs = [];
    const shuffled = U.shuffle(words);
    shuffled.forEach(w => {
      // كل كلمة تحصل على نوعين من الأسئلة: اختر المعنى العربي + اختر الكلمة الإنجليزية
      if (w.ar && pool.length >= 3) {
        const q = build('meaning', w, pool);
        if (q) qs.push(q);
      }
      if (pool.length >= 3) {
        const q = build('listen', w, pool);
        if (q) qs.push(q);
      }
    });
    return U.shuffle(qs);
  }

  // ---------- تشغيل جولة ----------
  async function run({ gradeId, unitId, words, pool, student }) {
    const appEl = document.getElementById('app');
    const queue = plan(words, pool);
    if (!queue.length) {
      App.toast('لا توجد أسئلة كافية');
      App.go(`#/unit/${gradeId}/${unitId}`);
      return;
    }

    let idx = 0, firstTotal = 0, firstCorrect = 0, locked = false, finished = false;
    const wrongWords = new Map();
    let q = null;
    const backHash = `#/unit/${gradeId}/${unitId}`;

    appEl.innerHTML = `
      <section class="play">
        <div class="play-top">
          <button class="icon-btn" data-act="exit" aria-label="خروج">${ic('x')}</button>
          <div class="bar"><i id="pbar"></i></div>
          <div class="counter" id="counter"></div>
        </div>
        ${Views.speedBar()}
        <div class="q-card" id="qcard"></div>
        <div id="fb"></div>
      </section>`;
    const $q = document.getElementById('qcard');
    const $fb = document.getElementById('fb');
    const $bar = document.getElementById('pbar');

    function progress() {
      $bar.style.width = (idx / queue.length * 100) + '%';
      document.getElementById('counter').textContent = `${Math.min(idx + 1, queue.length)} من ${queue.length}`;
    }

    const playQ = () => { if (q) Speech.word(q.w.en); };

    function optBtn(o, key) {
      return `<button class="opt ${key === 'en' ? 'en' : ''}" data-act="opt" data-id="${o.id}">${esc(o[key])}</button>`;
    }

    function renderQ() {
      locked = false;
      $fb.innerHTML = '';
      q = queue[idx];
      progress();
      const w = q.w;
      let html = '';
      if (q.type === 'listen') {
        html = `<p class="q-title">استمع واختر الكلمة الصحيحة</p>
          <button class="big-play" data-act="q-play" aria-label="استمع">${ic('volume')}</button>
          <div class="opts">${q.opts.map(o => optBtn(o, 'en')).join('')}</div>`;
      } else if (q.type === 'meaning') {
        html = `<p class="q-title">استمع واختر المعنى الصحيح</p>
          <button class="big-play" data-act="q-play" aria-label="استمع">${ic('volume')}</button>
          <div class="opts one">${q.opts.map(o => optBtn(o, 'ar')).join('')}</div>`;
      }
      $q.innerHTML = html;
      playQ();
    }

    function retryOf(old) {
      const otherType = old.type === 'listen' ? 'meaning' : 'listen';
      if (otherType === 'meaning' && old.w.ar && pool.length >= 3) {
        const q2 = build('meaning', old.w, pool, { retry: true });
        if (q2) return q2;
      }
      const q2 = build('listen', old.w, pool, { retry: true });
      return q2 || build(old.type, old.w, pool, { retry: true });
    }

    async function answer(ok, correctHtml, chosenEl) {
      if (locked || finished) return;
      locked = true;
      Sfx[ok ? 'correct' : 'wrong']();
      Store.recordAnswer(student.id, q.w.id, ok).catch(console.error);
      if (!q.retry) {
        firstTotal++;
        if (ok) firstCorrect++; else wrongWords.set(q.w.id, q.w);
      }
      if (!ok && !q.retry) {
        const r = retryOf(q);
        if (r) queue.push(r);
      }

      $q.querySelectorAll('.opt').forEach(b => {
        b.disabled = true;
        if (b.dataset.id === q.w.id) b.classList.add('right');
      });
      if (chosenEl && !ok) chosenEl.classList.add('wrong');

      const last = idx + 1 >= queue.length;
      $fb.innerHTML = `
        <div class="fb ${ok ? 'ok' : 'bad'}">
          <div class="fb-title">${ic(ok ? 'check-circle' : 'x-circle')} ${ok ? 'أحسنت!' : 'الإجابة الصحيحة:'}</div>
          <div class="fb-body ${q.type === 'listen' ? 'en' : ''}" ${q.type === 'listen' ? 'dir="ltr"' : ''}>${correctHtml}</div>
          ${q.w.ar ? `<div class="fb-ar">${esc(q.w.en)} = ${esc(q.w.ar)}</div>` : ''}
          <button class="btn" data-act="next" id="next-btn">${last ? 'عرض النتيجة' : 'التالي'}</button>
        </div>`;
      const nb = document.getElementById('next-btn');
      if (nb) nb.focus();
      if (!ok) Speech.word(q.w.en);
    }

    function next() {
      if (finished) return;
      idx++;
      if (idx >= queue.length) finish(); else renderQ();
    }

    async function finish() {
      if (finished) return;
      finished = true;
      Speech.stop();
      const starsN = Progress.starsFor(firstCorrect, firstTotal);
      const res = await Store.finishSession(student.id, {
        mode: 'dictation', gradeId, unitId,
        correct: firstCorrect, total: firstTotal, stars: starsN,
        wrongIds: [...wrongWords.keys()],
        testedIds: words.map(w => w.id)
      }) || {};
      renderResult(starsN, res);
    }

    function renderResult(starsN, res) {
      const wrongList = [...wrongWords.values()];
      const threshold = Store.getRetryThreshold();
      const mustRetry = threshold > 0 && wrongList.length >= threshold;
      const titles = mustRetry
        ? ['يلزم إعادة الاختبار']
        : ['لا بأس، حاول مرة أخرى', 'محاولة جيدة', 'أحسنت', 'ممتاز، نتيجة رائعة'];
      const titleIdx = mustRetry ? 0 : starsN;
      if (!mustRetry && starsN >= 2) { Sfx.win(); confetti(); }
      appEl.innerHTML = `
        <section class="result card">
          <div class="stars-big">${[1, 2, 3].map(i => `<span class="${i <= starsN ? 'on' : ''}">★</span>`).join('')}</div>
          <h2>${titles[titleIdx]}</h2>
          <p class="score">${firstCorrect} من ${firstTotal} إجابة صحيحة</p>
          ${mustRetry ? `<p class="retry-msg">أخطأت في ${wrongList.length} كلمات — أعد الاختبار للتأكد من حفظها.</p>` : ''}
          <div class="chips">
            <span class="chip-stat">+${res.xpGained || 0} نقطة</span>
          </div>
          ${wrongList.length ? `<div class="wrong-list"><b>كلمات تحتاج مراجعة:</b><div class="en" dir="ltr">${wrongList.map(w => `<button class="tag" data-act="say" data-text="${esc(w.en)}">${esc(w.en)} = ${esc(w.ar || '')} ${ic('volume', 'sm')}</button>`).join('')}</div></div>` : ''}
          <div class="actions">
            ${mustRetry
              ? `<button class="btn" data-act="again">${ic('repeat', 'sm')} أعد الاختبار</button>`
              : `<button class="btn" data-act="again">${ic('repeat', 'sm')} مرة أخرى</button>`}
            <button class="btn ghost" data-go="${backHash}">العودة للوحدة</button>
          </div>
        </section>`;
    }

    function confetti() {
      const box = document.createElement('div');
      box.className = 'confetti';
      const colors = ['#F59E0B', '#3B82F6', '#10B981', '#EF4444', '#8B5CF6'];
      box.innerHTML = Array.from({ length: 36 }, () =>
        `<span style="left:${Math.random() * 100}%;background:${U.pick(colors)};animation-delay:${(Math.random() * 0.8).toFixed(2)}s"></span>`).join('');
      document.body.appendChild(box);
      setTimeout(() => box.remove(), 3500);
    }

    active = {
      abort() { finished = true; Speech.stop(); },
      on(act, el) {
        if (act === 'exit') {
          if (!finished && firstTotal > 0) {
            App.confirm('هل تريد الخروج؟ ستضيع نقاط هذه الجولة.', { okLabel: 'خروج', danger: true })
              .then(ok => { if (ok) App.go(backHash); });
          } else {
            App.go(backHash);
          }
        } else if (act === 'again') {
          route('dictation', gradeId, unitId);
        } else if (finished) {
          // شاشة النتيجة
        } else if (act === 'opt') {
          const ok = el.dataset.id === q.w.id;
          const correct = q.type === 'meaning' ? esc(q.w.ar) : esc(q.w.en);
          answer(ok, correct, el);
        } else if (act === 'q-play') {
          playQ();
        } else if (act === 'next') {
          next();
        }
      }
    };

    renderQ();
  }

  // ---------- المسار ----------
  async function route(mode, gid, uid) {
    const student = await App.currentStudent();
    if (!student) return App.go('#/login');
    const grade = Cur.grade(gid);
    if (!grade) return App.go('#/');
    const unit = Cur.unit(gid, uid);
    if (!unit || !unit.words.length) return App.go('#/');

    let words;
    if (mode === 'bank') {
      words = Store.getWrongWords(student, gid, uid);
      if (!words.length) { App.toast('لا توجد كلمات خاطئة'); return App.go(`#/unit/${gid}/${uid}`); }
    } else {
      const range = Store.getRange(student.id, gid, uid);
      if (!range) { App.toast('لم يحدد المعلم كلمات هذه الوحدة بعد. تواصل معه.'); return App.go(`#/unit/${gid}/${uid}`); }
      words = unit.words.slice(range[0] - 1, range[1]);
    }
    const pool = unit.words.concat(Cur.allWords(grade).filter(w => w.unitId !== unit.id));
    return run({ gradeId: gid, unitId: uid, words, pool, student });
  }

  ['exit', 'opt', 'q-play', 'next', 'again']
    .forEach(n => { U.actions[n] = el => active && active.on(n, el); });
  U.actions.say = el => Speech.word(el.dataset.text);

  return { MODES, route, hl, norm, abort() { if (active) { active.abort(); active = null; } } };
})();
