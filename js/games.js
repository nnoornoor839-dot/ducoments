// الألعاب والاختبارات: تسميع الوحدة، أكمل الجملة، استمع واختر، رتّب الجملة، تحدي السرعة، المراجعة
const Games = (() => {
  const MODES = {
    test: { id: 'test', icon: '🎯', title: 'تسميع الوحدة', desc: 'اختبار شامل: سماع ومعنى وإملاء وجمل' },
    cloze: { id: 'cloze', icon: '🧩', title: 'أكمل الجملة', desc: 'اختر الكلمة الناقصة في جملة الكتاب' },
    listen: { id: 'listen', icon: '👂', title: 'استمع واختر', desc: 'اسمع الكلمة واختر الصحيحة' },
    scramble: { id: 'scramble', icon: '🔀', title: 'رتّب الجملة', desc: 'رتّب كلمات الجملة بالترتيب الصحيح' },
    speed: { id: 'speed', icon: '⚡', title: 'تحدي السرعة', desc: 'كم كلمة تجيب في 60 ثانية؟' },
    review: { id: 'review', icon: '🔁', title: 'مراجعة اليوم', desc: 'كلمات حان وقت مراجعتها' }
  };
  const SPEED_SECONDS = 60;
  let active = null;

  const esc = U.esc;
  const tokens = w => (w.sentence ? w.sentence.trim().split(/\s+/) : []);
  // مقارنة الإملاء: نتجاهل حالة الأحرف وعلامات الترقيم والأقواس (smell (good) = smell good)
  const norm = t => String(t).toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[^a-z0-9\s']/g, ' ').replace(/\s+/g, ' ').trim();

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

  function typesFor(w, pool) {
    const t = [];
    if (pool.length >= 3) {
      t.push('listen');
      if (w.ar) t.push('meaning');
      if (Cur.blank(w)) t.push('cloze', 'listenCloze');
    }
    t.push('spell');
    return t;
  }

  function build(type, w, pool, extra = {}) {
    if ((type === 'listen' || type === 'meaning' || type === 'cloze' || type === 'listenCloze') && pool.length < 3) type = 'spell';
    const q = { type, w, ...extra };
    if (type === 'listen' || type === 'cloze' || type === 'listenCloze') q.opts = options(w, pool, 'en');
    if (type === 'meaning') q.opts = options(w, pool, 'ar');
    if (type === 'cloze' || type === 'listenCloze') q.b = Cur.blank(w);
    if (type === 'scramble') {
      const toks = tokens(w);
      let order = toks.map((_, i) => i);
      for (let i = 0; i < 10; i++) {
        order = U.shuffle(order);
        if (order.some((v, k) => toks[v] !== toks[k])) break;
      }
      q.toks = toks; q.bank = order; q.placed = [];
    }
    return q;
  }

  function plan(mode, words, pool) {
    const mk = (type, w) => build(type, w, pool);
    let qs = [];
    if (mode === 'test') {
      words.forEach(w => U.shuffle(typesFor(w, pool)).slice(0, 2).forEach(t => qs.push(mk(t, w))));
      qs = U.shuffle(qs).slice(0, 20);
    } else if (mode === 'cloze') {
      U.shuffle(words.filter(w => Cur.blank(w))).slice(0, 12)
        .forEach(w => qs.push(mk(Math.random() < 0.5 ? 'cloze' : 'listenCloze', w)));
    } else if (mode === 'listen') {
      U.shuffle(words).slice(0, 12).forEach(w => qs.push(mk('listen', w)));
    } else if (mode === 'scramble') {
      U.shuffle(words.filter(w => tokens(w).length >= 3)).slice(0, 8).forEach(w => qs.push(mk('scramble', w)));
    } else if (mode === 'review') {
      qs = U.shuffle(words.slice(0, 10).map(w => mk(U.pick(typesFor(w, pool)), w)));
    }
    return qs;
  }

  // ---------- تشغيل جولة ----------
  async function run({ mode, gradeId, unitId, words, pool, student }) {
    const app = document.getElementById('app');
    const timed = mode === 'speed';
    let lastWordId = null;
    const nextSpeed = () => {
      let w = U.pick(words);
      for (let i = 0; i < 5 && words.length > 1 && w.id === lastWordId; i++) w = U.pick(words);
      lastWordId = w.id;
      const types = typesFor(w, pool).filter(t => t !== 'spell');
      return build(types.length ? U.pick(types) : 'spell', w, pool);
    };

    const queue = timed ? [nextSpeed()] : plan(mode, words, pool);
    if (!queue.length) {
      App.toast('لا توجد أسئلة كافية لهذا النمط في هذه الوحدة');
      App.go(unitId ? `#/unit/${gradeId}/${unitId}` : '#/');
      return;
    }

    let idx = 0, firstTotal = 0, firstCorrect = 0, locked = false, finished = false;
    let timeLeft = SPEED_SECONDS, timer = null;
    const wrongWords = new Map();
    let q = null;
    const backHash = unitId ? `#/unit/${gradeId}/${unitId}` : '#/';

    app.innerHTML = `
      <section class="play">
        <div class="play-top">
          <button class="icon-btn" data-act="exit" aria-label="خروج">✕</button>
          <div class="bar"><i id="pbar"></i></div>
          ${timed ? '<div class="timer" id="timer">60</div>' : '<div class="counter" id="counter"></div>'}
        </div>
        ${Views.speedBar()}
        <div class="q-card" id="qcard"></div>
        <div id="fb"></div>
      </section>`;
    const $q = document.getElementById('qcard');
    const $fb = document.getElementById('fb');
    const $bar = document.getElementById('pbar');

    function progress() {
      if (timed) {
        document.getElementById('timer').textContent = timeLeft;
        $bar.style.width = (timeLeft / SPEED_SECONDS * 100) + '%';
      } else {
        $bar.style.width = (idx / queue.length * 100) + '%';
        document.getElementById('counter').textContent = `${Math.min(idx + 1, queue.length)} من ${queue.length}`;
      }
    }

    const playQ = () => {
      if (!q) return;
      if (q.type === 'listen' || q.type === 'spell' || q.type === 'meaning') Speech.word(q.w.en);
      else if (q.type === 'listenCloze') Speech.blanked(q.b.before, q.b.after);
    };

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
        html = `<p class="q-title">استمع ثم اختر الكلمة الصحيحة</p>
          <button class="big-play" data-act="q-play" aria-label="استمع">🔊</button>
          <div class="opts">${q.opts.map(o => optBtn(o, 'en')).join('')}</div>`;
      } else if (q.type === 'meaning') {
        html = `<p class="q-title">ما معنى هذه الكلمة؟</p>
          <button class="q-word en" data-act="q-play">${esc(w.en)} <i>🔊</i></button>
          <div class="opts one">${q.opts.map(o => optBtn(o, 'ar')).join('')}</div>`;
      } else if (q.type === 'cloze') {
        html = `<p class="q-title">اختر الكلمة المناسبة للجملة</p>
          <p class="q-sent en" dir="ltr">${esc(q.b.before)}<span class="blank">_____</span>${esc(q.b.after)}</p>
          ${w.sentenceAr ? `<button class="link" data-act="sent-hint">💡 ترجمة الجملة</button><p class="q-ar hidden" id="sent-hint">${esc(w.sentenceAr)}</p>` : ''}
          <div class="opts">${q.opts.map(o => optBtn(o, 'en')).join('')}</div>`;
      } else if (q.type === 'listenCloze') {
        html = `<p class="q-title">استمع للجملة: ما الكلمة الناقصة؟</p>
          <button class="big-play" data-act="q-play" aria-label="استمع">🔊</button>
          <p class="q-note">في الجملة صمت قصير مكان الكلمة الناقصة</p>
          <div class="opts">${q.opts.map(o => optBtn(o, 'en')).join('')}</div>`;
      } else if (q.type === 'spell') {
        html = `<p class="q-title">استمع واكتب الكلمة</p>
          <button class="big-play" data-act="q-play" aria-label="استمع">🔊</button>
          <p class="q-ar">${esc(w.ar || '')}</p>
          <form data-form="spell" class="spell-form">
            <input id="spell-in" class="spell-in en" dir="ltr" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="${'_ '.repeat(Math.min(w.en.length, 14)).trim()}" aria-label="اكتب الكلمة">
            <button class="btn" type="submit">تحقق</button>
          </form>
          <button class="link" data-act="hint">💡 أول حرف</button>`;
      } else if (q.type === 'scramble') {
        html = `<p class="q-title">رتّب الكلمات لتكوين الجملة</p>
          ${w.sentenceAr ? `<p class="q-ar">${esc(w.sentenceAr)}</p>` : ''}
          <div class="slots en" dir="ltr" id="slots"></div>
          <div class="bank en" dir="ltr" id="bank"></div>
          <button class="btn" id="check-btn" data-act="check-scramble" disabled>تحقق</button>`;
      }
      $q.innerHTML = html;
      if (q.type === 'scramble') renderScramble();
      if (q.type === 'spell') setTimeout(() => { const i = document.getElementById('spell-in'); if (i) i.focus(); }, 50);
      if (q.type !== 'cloze' && q.type !== 'scramble') playQ();
    }

    function renderScramble() {
      const chips = (arr, act) => arr.map(i => `<button class="chip" data-act="${act}" data-i="${i}">${esc(q.toks[i])}</button>`).join('');
      document.getElementById('slots').innerHTML = chips(q.placed, 'chip-del') || '<span class="slots-empty">اضغط على الكلمات بالترتيب</span>';
      document.getElementById('bank').innerHTML = chips(q.bank.filter(i => !q.placed.includes(i)), 'chip-add');
      document.getElementById('check-btn').disabled = q.placed.length !== q.toks.length;
    }

    function retryOf(old) {
      const types = typesFor(old.w, pool).filter(t => t === 'listen' || t === 'meaning' || t === 'spell');
      return build(U.pick(types), old.w, pool, { retry: true });
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
      if (!ok && !q.retry && !timed) queue.push(retryOf(q));

      $q.querySelectorAll('.opt').forEach(b => {
        b.disabled = true;
        if (b.dataset.id === q.w.id) b.classList.add('right');
      });
      if (chosenEl && !ok) chosenEl.classList.add('wrong');

      if (timed) {
        await U.wait(ok ? 350 : 800);
        if (finished) return;
        queue.push(nextSpeed());
        idx++;
        renderQ();
        return;
      }

      const last = idx + 1 >= queue.length;
      $fb.innerHTML = `
        <div class="fb ${ok ? 'ok' : 'bad'}">
          <div class="fb-title">${ok ? '✅ أحسنت!' : '❌ الإجابة الصحيحة:'}</div>
          <div class="fb-body en" dir="ltr">${correctHtml}</div>
          ${q.w.ar ? `<div class="fb-ar">${esc(q.w.en)} = ${esc(q.w.ar)}</div>` : ''}
          <button class="btn" data-act="next" id="next-btn">${last ? 'عرض النتيجة' : 'التالي'}</button>
        </div>`;
      const nb = document.getElementById('next-btn');
      if (nb) nb.focus();
      if (q.type === 'cloze' || q.type === 'listenCloze' || q.type === 'scramble') { if (q.w.sentence) Speech.sentence(q.w.sentence); }
      else if (q.type === 'spell' || !ok) Speech.word(q.w.en);
    }

    function next() {
      if (finished) return;
      idx++;
      if (idx >= queue.length) finish(); else renderQ();
    }

    async function finish() {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      Speech.stop();
      const stars = timed
        ? (firstCorrect >= 12 ? 3 : firstCorrect >= 8 ? 2 : firstCorrect >= 4 ? 1 : 0)
        : Progress.starsFor(firstCorrect, firstTotal);
      const res = await Store.finishSession(student.id, { mode, gradeId, unitId, correct: firstCorrect, total: firstTotal, stars }) || {};
      renderResult(stars, res);
    }

    function renderResult(stars, res) {
      const titles = ['لا بأس، حاول مرة أخرى 💪', 'محاولة جيدة 👍', 'أحسنت! 👏', 'ممتاز! أنت بطل 🌟'];
      const wrongList = [...wrongWords.values()];
      if (stars >= 2) { Sfx.win(); confetti(); }
      app.innerHTML = `
        <section class="result card">
          <div class="stars-big">${[1, 2, 3].map(i => `<span class="${i <= stars ? 'on' : ''}">★</span>`).join('')}</div>
          <h2>${titles[stars]}</h2>
          <p class="score">${timed ? `أجبت ${firstCorrect} إجابة صحيحة من ${firstTotal}` : `${firstCorrect} من ${firstTotal} إجابة صحيحة من أول مرة`}</p>
          <div class="chips">
            <span class="chip-stat">+${res.xpGained || 0} نقطة ⭐</span>
            <span class="chip-stat">🔥 سلسلة ${res.streak || 0} ${(res.streak || 0) === 1 ? 'يوم' : 'أيام'}</span>
            ${res.goalReached ? '<span class="chip-stat good">🎯 حققت هدف اليوم!</span>' : ''}
          </div>
          ${res.levelUp ? `<p class="level-up">🎉 ارتفع مستواك إلى «${esc(res.levelUp.title)}»</p>` : ''}
          ${wrongList.length ? `<div class="wrong-list"><b>كلمات تحتاج تركيزًا:</b><div class="en" dir="ltr">${wrongList.map(w => `<button class="tag" data-act="say" data-text="${esc(w.en)}">${esc(w.en)} 🔊</button>`).join('')}</div></div>` : ''}
          <div class="actions">
            <button class="btn" data-act="again">🔁 مرة أخرى</button>
            <button class="btn ghost" data-go="${backHash}">${unitId ? 'العودة للوحدة' : 'الرئيسية'}</button>
          </div>
        </section>`;
    }

    function confetti() {
      const box = document.createElement('div');
      box.className = 'confetti';
      box.innerHTML = Array.from({ length: 26 }, () =>
        `<span style="left:${Math.random() * 100}%;animation-delay:${(Math.random() * 0.8).toFixed(2)}s">${U.pick(['🎉', '⭐', '✨', '🎈', '🌟'])}</span>`).join('');
      document.body.appendChild(box);
      setTimeout(() => box.remove(), 3500);
    }

    function checkSpell() {
      const input = document.getElementById('spell-in');
      if (!input || locked) return;
      const val = input.value.trim().toLowerCase();
      if (!val) return;
      const ok = norm(val) === norm(q.w.en);
      input.disabled = true;
      input.classList.add(ok ? 'right' : 'wrong');
      answer(ok, esc(q.w.en));
    }

    active = {
      abort() { finished = true; clearInterval(timer); Speech.stop(); },
      on(act, el) {
        if (act === 'exit') {
          if (!finished && firstTotal > 0) {
            App.confirm('هل تريد الخروج؟ ستضيع نقاط هذه الجولة.', { okLabel: 'خروج', danger: true })
              .then(ok => { if (ok) App.go(backHash); });
          } else {
            App.go(backHash);
          }
        } else if (act === 'again') {
          route(mode, gradeId, unitId);
        } else if (finished) {
          // شاشة النتيجة: لا شيء آخر
        } else if (act === 'opt') {
          const ok = el.dataset.id === q.w.id;
          const correct = q.type === 'meaning' ? `${esc(q.w.en)}` : (q.w.sentence ? hl(q.w) : esc(q.w.en));
          answer(ok, q.type === 'listen' ? esc(q.w.en) : correct, el);
        } else if (act === 'q-play') {
          if (q.type === 'cloze') return;
          playQ();
        } else if (act === 'next') {
          next();
        } else if (act === 'hint') {
          const i = document.getElementById('spell-in');
          if (i && !i.value) { i.value = q.w.en[0]; i.focus(); }
        } else if (act === 'sent-hint') {
          const p = document.getElementById('sent-hint');
          if (p) p.classList.toggle('hidden');
        } else if (act === 'chip-add') {
          if (locked) return;
          q.placed.push(Number(el.dataset.i));
          Sfx.tick();
          renderScramble();
        } else if (act === 'chip-del') {
          if (locked) return;
          q.placed = q.placed.filter(i => i !== Number(el.dataset.i));
          renderScramble();
        } else if (act === 'check-scramble') {
          if (locked || q.placed.length !== q.toks.length) return;
          const ok = q.placed.every((v, k) => q.toks[v] === q.toks[k]);
          document.getElementById('slots').classList.add(ok ? 'right' : 'wrong');
          answer(ok, esc(q.w.sentence));
        } else if (act === 'spell-submit') {
          checkSpell();
        }
      }
    };

    if (timed) {
      timer = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 5 && timeLeft > 0) Sfx.tick();
        if (timeLeft <= 0) { timeLeft = 0; progress(); finish(); } else progress();
      }, 1000);
    }
    renderQ();
  }

  // ---------- المسار ----------
  async function route(mode, gid, uid) {
    const student = await App.currentStudent();
    if (!student) return App.go('#/login');
    const grade = Cur.grade(gid);
    if (!grade || !MODES[mode]) return App.go('#/');
    let words, unit = null;
    if (mode === 'review') {
      words = Progress.dueWords(student, grade).slice(0, 10);
      if (!words.length) { App.toast('لا توجد كلمات للمراجعة الآن 👍'); return App.go('#/'); }
    } else {
      unit = Cur.unit(gid, uid);
      if (!unit || !unit.words.length) return App.go('#/');
      words = unit.words;
    }
    const pool = unit
      ? unit.words.concat(Cur.allWords(grade).filter(w => w.unitId !== unit.id))
      : Cur.allWords(grade);
    return run({ mode, gradeId: gid, unitId: unit ? unit.id : null, words, pool, student });
  }

  // معالجات الضغط تُمرَّر للجولة الجارية
  ['exit', 'opt', 'q-play', 'next', 'hint', 'sent-hint', 'chip-add', 'chip-del', 'check-scramble', 'again']
    .forEach(n => { U.actions[n] = el => active && active.on(n, el); });
  U.forms.spell = () => active && active.on('spell-submit');
  U.actions.say = el => Speech.word(el.dataset.text);

  return { MODES, route, hl, norm, abort() { if (active) { active.abort(); active = null; } } };
})();
