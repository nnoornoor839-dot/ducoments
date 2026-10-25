// قراءة الجمل (شادوينج): يسمع الطالب الجملة ثم يقرؤها، فتُحوَّل قراءته إلى نص ويُقارن بالجملة ويأخذ درجة من 10
const Shadow = (() => {
  const esc = U.esc;
  const app = () => document.getElementById('app');
  const FN = 'smart-responder';  // اسم دالة Edge في Supabase
  const MAX_TRIES = 5;       // محاولات كل جملة في اليوم (تُحتسب أعلى درجة)
  const SLOTS = 3;           // عدد الجمل لكل وحدة
  const MAX_SEC = 15;        // أقصى مدة تسجيل
  const MIN_SEC = 1.5;       // أقل مدة مقبولة
  const PASS = 5;            // أقل درجة تُحتسب
  const SIM = 0.7;           // تشابه الكلمة المقبول (يتسامح مع اللكنة)
  const SKIP = new Set(['a', 'an', 'the']);

  // جمل الوحدة: ثلاث كلمات موزعة على الوحدة ولها جملة من الكتاب (وإلا أي جملة)
  function slotsOf(unit) {
    const ws = unit.words.filter(w => w.sentence);
    const book = ws.filter(w => w.page);
    const pool = book.length >= SLOTS ? book : ws;
    if (pool.length <= SLOTS) return pool;
    return Array.from({ length: SLOTS }, (_, i) => pool[Math.floor((2 * i + 1) * pool.length / (2 * SLOTS))]);
  }

  const words = t => String(t).toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/).filter(Boolean);
  function sim(a, b) {
    if (a === b) return 1;
    const m = a.length, n = b.length;
    if (!m || !n) return 0;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return 1 - prev[n] / Math.max(m, n);
  }
  // الدرجة من 10 = نسبة كلمات الجملة التي نطقها (بتسامح مع اللكنة)
  function grade(target, spoken) {
    const tw = words(target);
    const heard = words(spoken).filter(x => !SKIP.has(x));
    const used = new Array(heard.length).fill(false);
    const marks = tw.map(w => {
      if (SKIP.has(w)) return { w, ok: true, skip: true };
      let best = -1, bs = 0;
      heard.forEach((h, i) => { if (!used[i]) { const s = sim(w, h); if (s > bs) { bs = s; best = i; } } });
      if (best >= 0 && bs >= SIM) { used[best] = true; return { w, ok: true }; }
      return { w, ok: false };
    });
    const real = marks.filter(m => !m.skip);
    const hit = real.filter(m => m.ok).length;
    return { score: real.length ? Math.round(hit / real.length * 10) : 0, marks };
  }

  // محاولات اليوم فقط: كل يوم خمس محاولات جديدة لكل جملة (الأرقام القديمة إجمالية فلا تُحتسب)
  function triesOf(s, wid) { const v = s.sentenceTries && s.sentenceTries[wid]; return v && typeof v === 'object' && v.d === U.ymd() && Number.isInteger(v.n) ? Math.min(v.n, MAX_TRIES) : 0; }
  function triesLine(n) { return n >= MAX_TRIES ? 'انتهت محاولاتك الخمس اليوم، تُفتح غدًا' : `المحاولات المتبقية اليوم: <b>${MAX_TRIES - n}</b> من ${MAX_TRIES}`; }
  function best(s, wid) { const v = s.sentences && s.sentences[wid]; return Number.isInteger(v) ? v : 0; }
  const ERR = {
    limit: 'وصلت لحد المحاولات لهذا اليوم، عُد غدًا',
    tries: 'انتهت محاولاتك الخمس لهذه الجملة اليوم، وتُفتح من جديد غدًا. أعلى درجة حصلت عليها هي التي تُحتسب',
    busy: 'الخدمة مشغولة الآن، حاول بعد قليل',
    auth: 'انتهت الجلسة، ادخل من جديد',
    empty: 'لم أسمع صوتًا، اقترب من الميكروفون وحاول مرة أخرى',
    offline: 'لا يوجد اتصال بالإنترنت',
    server: 'تعذّر التقييم الآن، حاول مرة أخرى'
  };

  // ---------- الشاشة ----------
  function view(student, gid, uid) {
    const u = Cur.unit(gid, uid);
    if (!u) return App.go('#/');
    const slots = slotsOf(u);
    const open = new Set(Progress.assigned(student, u).map(a => a.w.id));
    const cards = slots.map(w => {
      const unlocked = open.has(w.id);
      const b = best(student, w.id);
      const used = triesOf(student, w.id);
      return `
        <article class="shadow-card ${unlocked ? '' : 'locked'}" data-wid="${w.id}">
          <div class="en sh-sent" dir="ltr">${esc(w.sentence)}</div>
          ${w.sentenceAr ? `<div class="sh-ar">${esc(w.sentenceAr)}</div>` : ''}
          ${unlocked ? `
            <div class="sh-best">${b >= PASS ? `أفضل درجة: <b>${b}/10</b>` : 'لم تقرأها بعد'} <span class="muted small sh-tries">• ${triesLine(used)}</span></div>
            <div class="sh-actions">
              <button class="btn ghost" data-act="sh-listen" data-wid="${w.id}">${ic('volume', 'sm')} استمع</button>
              <button class="btn" data-act="sh-rec" data-wid="${w.id}" ${used >= MAX_TRIES ? 'disabled' : ''}>${ic('play', 'sm')} اقرأ</button>
            </div>
            <div class="sh-out" id="out-${esc(w.id)}"></div>` : '<div class="sh-best muted">تُفتح حين تصلك كلمتها</div>'}
        </article>`;
    }).join('');
    app().innerHTML = `
      <button class="back" data-go="#/unit/${gid}/${uid}">‹ رجوع للوحدة</button>
      <h2 class="section-title">${ic('volume')} قراءة الجمل: <span class="en" dir="ltr">${esc(u.title)}</span></h2>
      <p class="muted small">استمع للجملة ثم اضغط «اقرأ» وانطقها بصوت واضح. تأخذ نقاطًا بقدر درجتك من 10 (من 5 فأكثر)، ولكل جملة <b>خمس محاولات في اليوم</b> (تتجدد غدًا) وتُحتسب أعلى درجة لك.</p>
      ${Cloud.enabled ? '' : '<p class="card warn">قراءة الجمل تحتاج اتصالًا بالإنترنت.</p>'}
      <p class="small">درّب نفسك أولًا على <b>السرعة البطيئة</b>: استمع للجملة ببطء، كررها بصوتك، ثم اقرأها للتقييم.</p>
      <div class="sticky-speed">${Views.speedBar()}</div>
      <div class="shadow-list">${slots.length ? cards : '<p class="card muted empty">لا توجد جمل في هذه الوحدة.</p>'}</div>`;
  }

  // ---------- التسجيل ----------
  let rec = null;   // {recorder, stream, chunks, timer, started, wid, btn}
  function stopTracks() { if (rec && rec.stream) rec.stream.getTracks().forEach(t => t.stop()); }
  function abort() {
    if (!rec) return;
    clearTimeout(rec.timer); clearInterval(rec.tick);
    try { rec.recorder.onstop = null; if (rec.recorder.state !== 'inactive') rec.recorder.stop(); } catch (e) { /* تجاهل */ }
    stopTracks(); rec = null;
  }
  const mimeOf = () => ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';

  async function start(btn) {
    const wid = btn.dataset.wid;
    if (rec) { stopRecording(); return; }
    const me = await App.currentStudent();
    if (me && triesOf(me, wid) >= MAX_TRIES) { App.toast(ERR.tries); return; }
    if (!window.MediaRecorder || !navigator.mediaDevices) { App.toast('متصفحك لا يدعم التسجيل'); return; }
    Speech.stop();
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { App.toast('اسمح للتطبيق باستخدام الميكروفون ثم حاول مرة أخرى'); return; }
    const mime = mimeOf();
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    rec = { recorder, stream, chunks, wid, btn, started: Date.now(), mime: recorder.mimeType || mime };
    recorder.onstop = () => finish();
    recorder.start();
    btn.innerHTML = `${ic('stop', 'sm')} إيقاف <span id="sh-t">0</span>`;
    rec.tick = setInterval(() => { const el = document.getElementById('sh-t'); if (el) el.textContent = Math.floor((Date.now() - rec.started) / 1000); }, 250);
    rec.timer = setTimeout(stopRecording, MAX_SEC * 1000);
  }
  function stopRecording() { if (rec && rec.recorder.state !== 'inactive') rec.recorder.stop(); }

  async function finish() {
    const r = rec; if (!r) return;
    clearTimeout(r.timer); clearInterval(r.tick); stopTracks(); rec = null;
    const sec = (Date.now() - r.started) / 1000;
    r.btn.innerHTML = `${ic('play', 'sm')} اقرأ`;
    const out = document.getElementById('out-' + r.wid);
    const student = await App.currentStudent();
    const w = Cur.word(r.wid);
    if (!out || !student || !w) return;
    if (sec < MIN_SEC) { out.innerHTML = `<p class="warn-text small">${ERR.empty}</p>`; return; }
    out.innerHTML = '<p class="muted small">جارٍ التقييم…</p>';
    const ext = /mp4/.test(r.mime) ? 'm4a' : /ogg/.test(r.mime) ? 'ogg' : 'webm';
    const fd = new FormData();
    fd.append('token', Store.studentToken());
    fd.append('wid', w.id);
    fd.append('audio', new Blob(r.chunks, { type: r.mime || 'audio/webm' }), 'speech.' + ext);
    let res;
    try { res = await Cloud.fn(FN, fd, 25000); }
    catch (e) { out.innerHTML = `<p class="warn-text small">${ERR[e.code] || (e.status ? ERR.server : ERR.offline)}</p>`; return; }
    if (res && res.error === 'tries') {
      Store.markSentenceExhausted(student.id, w.id, MAX_TRIES);
      out.innerHTML = `<p class="warn-text small">${ERR.tries}</p>`;
      refreshCard(w.id, await App.currentStudent());
      return;
    }
    if (!res || !res.ok) { out.innerHTML = `<p class="warn-text small">${ERR[res && res.error] || ERR.server}</p>`; return; }
    if (!String(res.text).trim()) { out.innerHTML = `<p class="warn-text small">${ERR.empty}</p>`; return; }
    const g = grade(w.sentence, res.text);
    const prev = best(student, w.id);
    const saved = Store.recordSentence(student.id, w.id, g.score, Number.isInteger(res.tries) ? res.tries : undefined);
    const gained = Math.max(0, (g.score >= PASS ? g.score : 0) - (prev >= PASS ? prev : 0));
    out.innerHTML = `
      <div class="sh-result ${g.score >= PASS ? 'ok' : 'bad'}">
        <b class="sh-score">${g.score}/10</b>
        <div class="en sh-marks" dir="ltr">${g.marks.map(m => `<span class="${m.ok ? 'ok' : 'miss'}">${esc(m.w)}</span>`).join(' ')}</div>
        <p class="small">${g.score >= PASS ? (gained ? `أحسنت! حصلت على ${gained} ${gained === 1 ? 'نقطة جديدة' : 'نقاط جديدة'}` : 'أحسنت! أفضل درجتك السابقة أعلى أو تساويها') : 'حاول مرة أخرى، استمع للجملة ثم اقرأها ببطء ووضوح'}</p>
        <p class="muted small">سمعتُ: <span class="en" dir="ltr">${esc(res.text)}</span></p>
      </div>`;
    refreshCard(w.id, student);
    if (g.score >= 8) { Sfx.win(); }
  }

  // يحدّث سطر أفضل درجة والمحاولات وزر القراءة لجملة
  function refreshCard(wid, student) {
    const card = document.querySelector(`.shadow-card[data-wid="${CSS.escape(wid)}"]`);
    if (!card || !student) return;
    const b = best(student, wid), used = triesOf(student, wid);
    const el = card.querySelector('.sh-best');
    if (el) el.innerHTML = `${b >= PASS ? `أفضل درجة: <b>${b}/10</b>` : 'لم تقرأها بعد'} <span class="muted small sh-tries">• ${triesLine(used)}</span>`;
    const btn = card.querySelector('[data-act="sh-rec"]');
    if (btn && used >= MAX_TRIES) btn.disabled = true;
  }

  U.actions['sh-listen'] = el => { const w = Cur.word(el.dataset.wid); if (w) Speech.sentence(w.sentence); };
  U.actions['sh-rec'] = el => { start(el); };

  async function route(gid, uid) {
    const student = await App.currentStudent();
    if (!student) return App.go('#/login');
    view(student, gid, uid);
  }

  return { route, abort, slotsOf, grade, SLOTS, PASS, MAX_TRIES };
})();
