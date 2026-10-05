// إدارة الكلمات: يدخل المعلم الكلمات لكل صف ووحدة مع الجملة ورقم الصفحة
const Content = (() => {
  const esc = U.esc;
  const app = () => document.getElementById('app');
  const ctx = { gid: null, uid: null };
  let lastPage = '';       // رقم الصفحة الأخير: الكلمات المتتالية غالبًا من صفحة واحدة
  let editingId = null;    // كلمة قيد التعديل
  let openSection = null;  // 'quick' | 'single'
  let pending = [];        // معاينة الإدخال السريع

  // ---------- مساعدات ----------
  function mutate(fn) {
    const data = Cur.snapshot();
    fn(data);
    Store.saveCurriculum(data);
  }
  const gradeCount = g => g.units.reduce((n, u) => n + u.words.length, 0);
  function pageRange(u) {
    const nums = u.words.map(w => parseInt(w.page, 10)).filter(n => !isNaN(n));
    if (!nums.length) return '';
    const a = Math.min(...nums), b = Math.max(...nums);
    return a === b ? `صفحة ${a}` : `الصفحات ${a}–${b}`;
  }
  function wordFrom({ en, ar, sentence, sentenceAr, page, form }) {
    const w = { en: en.trim(), ar: (ar || '').trim() };
    if (sentence && sentence.trim()) w.sentence = sentence.trim();
    if (sentenceAr && sentenceAr.trim()) w.sentenceAr = sentenceAr.trim();
    if (page && String(page).trim()) w.page = String(page).trim();
    if (form && form.trim()) w.form = form.trim();
    w.key = U.slug(w.en) + '-' + U.rid().slice(0, 3);
    return w;
  }
  // يملأ شكل الكلمة تلقائيًا إن اختلف في الجملة. يُرجع true إن وُجدت الكلمة في الجملة.
  function resolveForm(w) {
    if (!w.sentence) return true;
    const g = Cur.guessForm(w.form || w.en, w.sentence);
    if (!w.form && g.form) w.form = g.form;
    return g.found;
  }
  const unitData = d => {
    const g = d.grades.find(x => x.id === ctx.gid);
    return { g, u: g && g.units.find(x => x.id === ctx.uid) };
  };

  // ---------- الإدخال السريع: كلمة | معنى | جملة | صفحة | ترجمة ----------
  function parseQuick(text, defPage, existing) {
    const seen = new Set(existing.map(e => e.toLowerCase()));
    const rows = [];
    text.split(/\r?\n/).forEach(raw => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) return;
      const cols = (line.includes('\t') ? line.split('\t') : line.split('|')).map(c => c.trim());
      const [en = '', ar = '', sentence = '', page = '', sentenceAr = ''] = cols;
      if (!rows.length && /^(word|الكلمة)$/i.test(en)) return;  // سطر عناوين
      const row = { en, ar, sentence, sentenceAr, page: page || defPage || '', notes: [], skip: false };
      if (!en) { row.notes.push('بدون كلمة'); row.skip = true; }
      else if (seen.has(en.toLowerCase())) { row.notes.push('مكررة'); row.skip = true; }
      else seen.add(en.toLowerCase());
      if (!row.skip) {
        if (!ar) row.notes.push('بدون معنى');
        if (!sentence) row.notes.push('بدون جملة');
        else {
          const g = Cur.guessForm(en, sentence);
          if (g.form) row.form = g.form;
          if (!g.found) row.notes.push('الكلمة غير موجودة في الجملة');
        }
      }
      rows.push(row);
    });
    return rows;
  }

  function previewHtml() {
    if (!pending.length) return '<p class="muted small">لم أجد أسطرًا. اكتب سطرًا لكل كلمة.</p>';
    const ok = pending.filter(r => !r.skip);
    return `
      <div class="preview"><table class="pv">
        <thead><tr><th></th><th>الكلمة</th><th>المعنى</th><th>الجملة</th><th>ص</th><th>ملاحظات</th></tr></thead>
        <tbody>${pending.map(r => `
          <tr>
            <td>${r.skip ? `<span class="st-bad">${ic('x-circle', 'sm')}</span>` : r.notes.length ? `<span class="st-warn">${ic('alert', 'sm')}</span>` : `<span class="st-ok">${ic('check-circle', 'sm')}</span>`}</td>
            <td class="en" dir="ltr">${esc(r.en)}</td>
            <td>${esc(r.ar)}</td>
            <td class="en" dir="ltr">${esc(r.sentence)}${r.form ? ` <small class="muted">(${esc(r.form)})</small>` : ''}</td>
            <td>${esc(r.page)}</td>
            <td class="${r.skip ? 'bad' : 'warn-t'}">${esc(r.notes.join('، '))}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
      <button class="btn" data-act="c-quick-add" ${ok.length ? '' : 'disabled'}>إضافة ${ok.length} كلمة</button>`;
  }

  // ---------- شاشة الصف ----------
  function home(gid) {
    const grades = Cur.grades;
    const g = Cur.grade(gid) || grades.find(x => x.units.length) || grades[0];
    app().innerHTML = `
      <button class="back" data-go="#/teacher">‹ رجوع للوحة</button>
      <h2 class="section-title">${ic('edit')} إدارة الكلمات</h2>
      ${Store.isCurriculumStale() ? `
        <div class="card warn small">
          نُشرت <b>كلمات جديدة</b> في التطبيق، وما تراه الآن نسخة قديمة محفوظة على هذا الجهاز.
          انسخ كلماتك أولًا (من «نسخ كل الكلمات») إن أضفت شيئًا تريد الاحتفاظ به.
          <div class="row"><button class="btn" data-act="c-reset">${ic('reset')} تحميل الكلمات الجديدة</button></div>
        </div>` : (!Store.isCustomCurriculum() && (window.CURRICULUM || {}).sample ? `
        <div class="card warn small">
          الكلمات الحالية <b>أمثلة تجريبية</b> وضعتها للتجربة.
          <div class="row"><button class="btn ghost" data-act="c-clear">${ic('trash')} حذف الأمثلة والبدء بكلماتك</button></div>
        </div>` : '')}
      <div class="gchips">${grades.map(x =>
        `<button class="gchip ${x.id === g.id ? 'on' : ''}" data-go="#/teacher/content/${x.id}">${esc(x.name)} <small>(${gradeCount(x)})</small></button>`).join('')}</div>
      <h3>${esc(g.name)}</h3>
      ${g.units.map(u => `
        <div class="c-unit">
          <div><b class="en" dir="ltr">${esc(u.title)}</b>
            <small class="muted">${u.words.length} كلمة${pageRange(u) ? ' • ' + pageRange(u) : ''}</small></div>
          <button class="btn ghost" data-go="#/teacher/unit/${g.id}/${u.id}">تعديل</button>
        </div>`).join('') || '<p class="card muted empty">لا توجد وحدات لهذا الصف بعد.</p>'}
      <button class="btn big" data-go="#/teacher/unit/${g.id}/new">${ic('plus')} وحدة جديدة في ${esc(g.name)}</button>

      <h3 class="section-title">نقل الكلمات بين الأجهزة</h3>
      <p class="muted small">الكلمات تُحفظ على هذا الجهاز. انسخها هنا والصقها على جهاز آخر، مثل جهاز الطلاب.</p>
      <div class="row wrap">
        <button class="btn ghost" data-act="c-export">${ic('upload')} نسخ كل الكلمات</button>
        <button class="btn ghost" data-act="c-import">${ic('download')} استيراد كلمات</button>
        ${Store.isCustomCurriculum() ? `<button class="btn ghost" data-act="c-reset">${ic('reset')} العودة للكلمات المضمّنة</button>` : ''}
      </div>`;
  }

  // ---------- شاشة الوحدة ----------
  function unitView(gid, uid) {
    const g = Cur.grade(gid);
    if (!g) return App.go('#/teacher/content');
    ctx.gid = gid; ctx.uid = uid;
    pending = [];
    if (uid === 'new') return newUnitView(g);
    const u = Cur.unit(gid, uid);
    if (!u) return App.go('#/teacher/content/' + gid);
    const editing = editingId ? Cur.word(editingId) : null;
    const ed = editing || {};
    const secOpen = s => (openSection === s || (s === 'quick' && !openSection && !u.words.length)) ? 'open' : '';

    app().innerHTML = `
      <button class="back" data-go="#/teacher/content/${gid}">‹ ${esc(g.name)}</button>
      <section class="card unit-head">
        <h2 class="en" dir="ltr">${esc(u.title)}</h2>
        <p class="muted small">${u.words.length} كلمة${pageRange(u) ? ' • ' + pageRange(u) : ''}</p>
      </section>

      <details class="card" ${secOpen('quick')}>
        <summary>${ic('zap', 'sm')} إدخال سريع (الصق عدة كلمات)</summary>
        <p class="muted small">سطر لكل كلمة، والأعمدة مفصولة بـ <b>|</b> بهذا الترتيب:<br>
          <b>الكلمة | المعنى | الجملة من الكتاب | رقم الصفحة | ترجمة الجملة (اختياري)</b><br>
          ويمكنك نسخ الجدول من Excel ولصقه مباشرة.</p>
        <label>رقم الصفحة الافتراضي (للأسطر التي بدون صفحة)
          <input id="q-page" inputmode="numeric" value="${esc(lastPage)}" placeholder="مثل: 24"></label>
        <textarea id="q-text" class="big" dir="ltr" spellcheck="false" aria-label="الكلمات"
          placeholder="bread | خبز | I eat bread for breakfast. | 24&#10;milk | حليب | My brother drinks milk every morning. | 24"></textarea>
        <button class="btn" data-act="c-preview">معاينة</button>
        <div id="q-preview"></div>
      </details>

      <details class="card" id="word-form" ${secOpen('single') || (editing ? 'open' : '')}>
        <summary>${editing ? ic('pencil', 'sm') + ' تعديل كلمة' : ic('plus', 'sm') + ' إضافة كلمة واحدة'}</summary>
        <form data-form="c-word" class="form-grid">
          <div class="form-2">
            <label>الكلمة<input name="en" dir="ltr" required value="${esc(ed.en || '')}" autocomplete="off"></label>
            <label>المعنى بالعربي<input name="ar" value="${esc(ed.ar || '')}" autocomplete="off"></label>
          </div>
          <label>الجملة من الكتاب<input name="sentence" dir="ltr" value="${esc(ed.sentence || '')}" autocomplete="off"></label>
          <label>ترجمة الجملة (اختياري)<input name="sentenceAr" value="${esc(ed.sentenceAr || '')}" autocomplete="off"></label>
          <div class="form-2">
            <label>رقم الصفحة<input name="page" inputmode="numeric" value="${esc(editing ? (ed.page || '') : lastPage)}" autocomplete="off"></label>
            <label>شكل الكلمة في الجملة (اختياري)<input name="form" dir="ltr" value="${esc(ed.form || '')}" placeholder="مثل: eats" autocomplete="off"></label>
          </div>
          <div class="row">
            <button class="btn" type="submit">${editing ? 'حفظ التعديل' : 'إضافة الكلمة'}</button>
            ${editing ? '<button class="btn ghost" type="button" data-act="c-cancel-edit">إلغاء</button>' : ''}
          </div>
        </form>
      </details>

      <h3 class="section-title">كلمات الوحدة (${u.words.length})</h3>
      <div class="card">${u.words.length ? `<ul class="plain">${u.words.map(w => `
        <li class="c-word">
          <div class="c-word-head">
            <span><b class="en" dir="ltr">${esc(w.en)}</b> <span class="muted">${esc(w.ar)}</span></span>
            <span class="c-actions">
              <button class="mini" data-act="c-edit" data-id="${w.id}" aria-label="تعديل">${ic('pencil', 'sm')}</button>
              <button class="mini" data-act="c-del" data-id="${w.id}" aria-label="حذف">${ic('trash', 'sm')}</button>
            </span>
          </div>
          ${w.sentence ? `<small class="en muted" dir="ltr">${Games.hl(w)}</small>` : ''}
          <small class="muted">${w.page ? ic('book', 'sm') + ' صفحة ' + esc(w.page) : ''}${w.sentence && !Cur.blank(w) ? ` <span class="warn-t">${ic('alert', 'sm')} الكلمة غير موجودة في الجملة</span>` : ''}</small>
        </li>`).join('')}</ul>` : '<p class="muted empty">لا توجد كلمات بعد. استخدم الإدخال السريع أعلاه.</p>'}
      </div>
      <div class="row wrap">
        <button class="btn ghost" data-go="#/teacher/content/${gid}">تم</button>
        <button class="btn danger" data-act="c-del-unit">${ic('trash')} حذف الوحدة</button>
      </div>`;
  }

  function newUnitView(g) {
    const nextNum = Math.max(0, ...g.units.map(x => x.num)) + 1;
    app().innerHTML = `
      <button class="back" data-go="#/teacher/content/${g.id}">‹ ${esc(g.name)}</button>
      <section class="card login">
        <h2>${ic('plus')} وحدة جديدة — ${esc(g.name)}</h2>
        <form data-form="c-unit-new" class="stack">
          <label>رقم الوحدة<input name="num" type="number" min="1" max="99" value="${nextNum}" required></label>
          <label>عنوان الوحدة كما في الكتاب (اختياري)<input name="title" dir="ltr" placeholder="Unit ${nextNum}: At the Zoo" autocomplete="off"></label>
          <button class="btn" type="submit">إنشاء ثم إدخال الكلمات</button>
        </form>
      </section>`;
  }

  // ---------- النماذج ----------
  U.forms['c-unit-new'] = form => {
    const g = Cur.grade(ctx.gid);
    if (!g) return;
    const num = Math.max(1, parseInt(form.elements.num.value, 10) || 1);
    const title = form.elements.title.value.trim() || `Unit ${num}`;
    let id = 'u' + num;
    if (g.units.some(u => u.id === id)) id = `u${num}-${U.rid().slice(0, 3)}`;
    mutate(d => d.grades.find(x => x.id === g.id).units.push({ id, title, num, words: [] }));
    openSection = 'quick';
    App.go(`#/teacher/unit/${g.id}/${id}`);
  };

  U.forms['c-word'] = form => {
    const f = form.elements;
    const en = f.en.value.trim();
    if (!en) { App.toast('اكتب الكلمة'); return; }
    const fields = { en, ar: f.ar.value, sentence: f.sentence.value, sentenceAr: f.sentenceAr.value, page: f.page.value, form: f.form.value };
    const unit = Cur.unit(ctx.gid, ctx.uid);
    const dup = unit.words.some(w => w.en.toLowerCase() === en.toLowerCase() && w.id !== editingId);
    if (dup) { App.toast('هذه الكلمة موجودة مسبقًا في الوحدة'); return; }
    const w = wordFrom(fields);
    const found = resolveForm(w);
    if (fields.page.trim()) lastPage = fields.page.trim();
    if (editingId) {
      const old = Cur.word(editingId);
      const wi = unit.words.findIndex(x => x.id === editingId);
      if (old) w.key = old.key || U.slug(old.en);  // نفس المعرّف كي لا يضيع تقدّم الطلاب
      mutate(d => { unitData(d).u.words[wi] = w; });
      editingId = null;
    } else {
      mutate(d => unitData(d).u.words.push(w));
    }
    openSection = 'single';
    unitView(ctx.gid, ctx.uid);
    App.toast(found ? 'تم الحفظ' : 'تم الحفظ، لكن الكلمة غير موجودة في الجملة. أضف شكلها في خانة «شكل الكلمة».');
  };

  // ---------- الإجراءات ----------
  U.actions['c-preview'] = () => {
    const unit = Cur.unit(ctx.gid, ctx.uid);
    const text = document.getElementById('q-text').value;
    pending = parseQuick(text, document.getElementById('q-page').value.trim(), unit.words.map(w => w.en));
    document.getElementById('q-preview').innerHTML = previewHtml();
  };
  U.actions['c-quick-add'] = () => {
    const rows = pending.filter(r => !r.skip);
    if (!rows.length) return;
    const pageVal = document.getElementById('q-page').value.trim();
    if (pageVal) lastPage = pageVal;
    mutate(d => {
      const { u } = unitData(d);
      rows.forEach(r => u.words.push(wordFrom(r)));
    });
    pending = [];
    openSection = 'quick';
    unitView(ctx.gid, ctx.uid);
    App.toast(`أُضيفت ${rows.length} كلمة`);
  };
  U.actions['c-edit'] = el => {
    editingId = el.dataset.id;
    openSection = 'single';
    unitView(ctx.gid, ctx.uid);
    const f = document.getElementById('word-form');
    if (f) f.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  U.actions['c-cancel-edit'] = () => { editingId = null; unitView(ctx.gid, ctx.uid); };
  U.actions['c-del'] = async el => {
    const w = Cur.word(el.dataset.id);
    if (!w || !(await App.confirm(`حذف الكلمة «${w.en}»؟`, { okLabel: 'حذف', danger: true }))) return;
    const unit = Cur.unit(ctx.gid, ctx.uid);
    const wi = unit.words.findIndex(x => x.id === w.id);
    mutate(d => unitData(d).u.words.splice(wi, 1));
    if (editingId === w.id) editingId = null;
    unitView(ctx.gid, ctx.uid);
  };
  U.actions['c-del-unit'] = async () => {
    const u = Cur.unit(ctx.gid, ctx.uid);
    if (!u || !(await App.confirm(`حذف الوحدة «${u.title}» وكل كلماتها؟`, { okLabel: 'حذف الوحدة', danger: true }))) return;
    mutate(d => { const { g } = unitData(d); g.units = g.units.filter(x => x.id !== ctx.uid); });
    App.go('#/teacher/content/' + ctx.gid);
  };
  U.actions['c-clear'] = async () => {
    if (!(await App.confirm('حذف الأمثلة التجريبية والبدء بقائمة فارغة؟', { okLabel: 'حذف الأمثلة', danger: true }))) return;
    Store.saveCurriculum({ grades: Cur.grades.map(g => ({ id: g.id, name: g.name, short: g.short, units: [] })) });
    home(ctx.gid);
  };
  U.actions['c-reset'] = async () => {
    if (!(await App.confirm('العودة للكلمات المضمّنة في التطبيق؟ ستُحذف التعديلات التي أدخلتها على هذا الجهاز.', { okLabel: 'نعم، استبدلها', danger: true }))) return;
    Store.resetCurriculum();
    home(ctx.gid);
  };

  // ---------- نقل الكلمات ----------
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* نجرب الطريقة القديمة */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }
  U.actions['c-export'] = async () => {
    const text = JSON.stringify(Cur.snapshot());
    if (await copyText(text)) App.toast('تم نسخ كل الكلمات. الصقها في الجهاز الآخر');
    else App.showText('انسخ هذا النص', text);
  };

  // يتحقق من النص الملصوق وينظّفه قبل الاستبدال
  function sanitize(raw) {
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.grades)) throw new Error('شكل غير صحيح');
    const str = v => (v === undefined || v === null ? '' : String(v));
    const grades = Cur.grades.map(base => {
      const src = data.grades.find(g => g && g.id === base.id);
      const units = (src && Array.isArray(src.units) ? src.units : []).filter(u => u && u.id).map(u => ({
        id: str(u.id), title: str(u.title) || `Unit ${u.num || ''}`.trim(),
        num: Number(u.num) || parseInt(str(u.id).replace(/\D/g, ''), 10) || 0,
        words: (Array.isArray(u.words) ? u.words : []).filter(w => w && w.en).map(w => {
          const o = { en: str(w.en), ar: str(w.ar) };
          ['sentence', 'sentenceAr', 'page', 'form', 'key'].forEach(k => { if (w[k]) o[k] = str(w[k]); });
          return o;
        })
      }));
      return { id: base.id, name: base.name, short: base.short, units };
    });
    return { grades };
  }
  U.actions['c-import'] = async () => {
    const raw = await App.paste('استيراد كلمات', 'الصق هنا النص الذي نسخته من الجهاز الآخر. سيحل محل الكلمات الحالية.');
    if (raw === null || !raw.trim()) return;
    let data;
    try { data = sanitize(raw); } catch (e) { App.toast('النص غير صحيح. انسخه من «نسخ كل الكلمات» ثم الصقه كاملًا.'); return; }
    const count = data.grades.reduce((n, g) => n + g.units.reduce((m, u) => m + u.words.length, 0), 0);
    Store.saveCurriculum(data);
    App.toast(`تم استيراد ${count} كلمة`);
    home(ctx.gid);
  };

  // ---------- المسار ----------
  function route(parts) {
    const [sub, a, b] = parts;
    if (sub === 'unit' && a) {
      if (ctx.gid !== a || ctx.uid !== b) { editingId = null; openSection = null; }
      return unitView(a, b);
    }
    ctx.gid = a || ctx.gid;
    return home(a);
  }

  return { route, parseQuick };
})();
