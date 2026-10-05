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

  // حالة الكلمات: هل يعرض هذا الجهاز الكلمات المنشورة أم نسخة محفوظة عليه، وهل هي محدّثة
  function versionNote() {
    const v = String((window.CURRICULUM || {}).version || '');
    const when = /^\d{12}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)} ${v.slice(8, 10)}:${v.slice(10, 12)} UTC` : v;
    const state = !Store.isCustomCurriculum()
      ? 'هذا الجهاز يعرض الكلمات المنشورة في التطبيق، وتتحدّث تلقائيًا.'
      : Store.isCurriculumStale()
        ? '<b class="warn-t">نسختك المحفوظة على هذا الجهاز أقدم من الكلمات المنشورة.</b>'
        : 'نسختك المحفوظة على هذا الجهاز محدّثة.';
    return `<p class="muted small data-status">${ic('info', 'sm')} إصدار الكلمات المنشورة: <b dir="ltr">${esc(when)}</b> • ${state}</p>`;
  }

  // ---------- شاشة الصف ----------
  function home(gid) {
    const g = Cur.grade(gid);
    if (!g) return App.go('#/teacher');
    app().innerHTML = `
      <button class="back" data-go="#/teacher/g/${g.id}">‹ ${esc(g.name)}</button>
      <h2 class="section-title">${ic('edit')} إدارة الكلمات — ${esc(g.name)}</h2>
      ${versionNote()}
      ${Store.isCurriculumStale() ? `
        <div class="card warn small">
          نُشرت <b>كلمات جديدة</b> في التطبيق، وما تراه الآن نسخة قديمة محفوظة على هذا الجهاز.
          تحميل الكلمات الجديدة <b>يستبدل</b> الكلمات التي أدخلتها أنت.
          <div class="row"><button class="btn" data-act="c-reset">${ic('reset')} تحميل الكلمات الجديدة</button></div>
        </div>` : (!Store.isCustomCurriculum() && (window.CURRICULUM || {}).sample ? `
        <div class="card warn small">
          الكلمات الحالية <b>أمثلة تجريبية</b> وضعتها للتجربة.
          <div class="row"><button class="btn ghost" data-act="c-clear">${ic('trash')} حذف الأمثلة والبدء بكلماتك</button></div>
        </div>` : '')}
      ${g.units.map(u => `
        <div class="c-unit">
          <div><b class="en" dir="ltr">${esc(u.title)}</b>
            <small class="muted">${u.words.length} كلمة${pageRange(u) ? ' • ' + pageRange(u) : ''}</small></div>
          <button class="btn ghost" data-go="#/teacher/unit/${g.id}/${u.id}">تعديل</button>
        </div>`).join('') || '<p class="card muted empty">لا توجد وحدات لهذا الصف بعد.</p>'}
      <button class="btn big" data-go="#/teacher/unit/${g.id}/new">${ic('plus')} وحدة جديدة في ${esc(g.name)}</button>

      <h3 class="section-title">${ic('upload')} استيراد من Excel</h3>
      <p class="muted small">حمّل القالب، املأه بكلماتك في Excel، ثم ارفعه هنا. يمكنك إضافة عدة وحدات في ملف واحد، والسطر الذي لا يحدد الصف يُضاف إلى ${esc(g.name)}.</p>
      <div class="row wrap">
        <button class="btn ghost" data-act="c-excel-template">${ic('download')} تحميل قالب Excel</button>
        <label class="btn ghost file-label">${ic('upload')} استيراد ملف Excel
          <input type="file" accept=".xlsx,.xls,.csv" data-act="c-excel-import" class="hidden-file">
        </label>
      </div>`;
  }

  // ---------- شاشة الوحدة ----------
  function unitView(gid, uid) {
    const g = Cur.grade(gid);
    if (!g) return App.go('#/teacher');
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
        <p class="muted small">${esc(g.name)} • ${u.words.length} كلمة${pageRange(u) ? ' • ' + pageRange(u) : ''}</p>
      </section>

      <details class="card" id="unit-edit" ${openSection === 'unit-edit' ? 'open' : ''}>
        <summary>${ic('pencil', 'sm')} تعديل الوحدة (الاسم والرقم والصف)</summary>
        <form data-form="c-unit-edit" class="form-grid">
          <label>عنوان الوحدة<input name="title" dir="ltr" value="${esc(u.title)}" required autocomplete="off"></label>
          <div class="form-2">
            <label>رقم الوحدة<input name="num" type="number" min="1" max="99" value="${u.num}" required></label>
            <label>الصف<select name="grade">${Cur.grades.map(x => `<option value="${x.id}" ${x.id === gid ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
          </div>
          <p class="muted small">وضعت الوحدة في صف خاطئ؟ غيّر «الصف» ثم احفظ لتنتقل الوحدة بكلماتها.</p>
          <button class="btn" type="submit">حفظ</button>
        </form>
        ${builtInUnit(gid, uid) ? `<button class="btn ghost" data-act="c-restore-unit">${ic('reset', 'sm')} استعادة كلمات هذه الوحدة الأصلية من التطبيق</button>` : ''}
      </details>

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

  // الوحدة كما هي مضمّنة في التطبيق (إن وُجدت لنفس الصف ورمز الوحدة)
  function builtInUnit(gid, uid) {
    const g = ((window.CURRICULUM || {}).grades || []).find(x => x.id === gid);
    return (g && g.units.find(x => x.id === uid)) || null;
  }

  // تعديل عنوان الوحدة ورقمها، أو نقلها إلى صف آخر
  U.forms['c-unit-edit'] = async form => {
    const f = form.elements;
    const g = Cur.grade(ctx.gid), u = Cur.unit(ctx.gid, ctx.uid);
    const to = Cur.grade(f.grade.value);
    if (!g || !u || !to) return;
    const title = f.title.value.trim();
    const num = parseInt(f.num.value, 10);
    if (!title || !(num >= 1)) { App.toast('اكتب عنوان الوحدة ورقمها'); return; }

    if (to.id === g.id) {
      if (g.units.some(x => x.id !== u.id && x.num === num)) { App.toast('توجد وحدة أخرى بنفس الرقم في هذا الصف'); return; }
      mutate(d => { const { u: du } = unitData(d); du.title = title; du.num = num; });
      openSection = 'unit-edit';
      unitView(ctx.gid, ctx.uid);
      App.toast('تم حفظ التعديل');
      return;
    }

    if (to.units.some(x => x.num === num)) { App.toast(`توجد في ${to.name} وحدة بنفس الرقم. غيّر الرقم أولًا ثم انقل`); return; }
    const ok = await App.confirm(
      `نقل «${iso(u.title)}» (${u.words.length} كلمة) من ${g.name} إلى ${to.name}؟\nسيفقد طلاب ${g.name} إسناد هذه الوحدة وتقدمهم فيها، وتظهر لطلاب ${to.name} غير مسندة.`,
      { okLabel: 'نقل الوحدة' });
    if (!ok) return;
    let newId = 'u' + num;
    if (to.units.some(x => x.id === newId)) newId = `u${num}-${U.rid().slice(0, 3)}`;
    mutate(d => {
      const from = d.grades.find(x => x.id === g.id), dest = d.grades.find(x => x.id === to.id);
      const moved = from.units.splice(from.units.findIndex(x => x.id === u.id), 1)[0];
      moved.id = newId; moved.title = title; moved.num = num;
      dest.units.push(moved);
    });
    openSection = null;
    App.toast(`تم نقل الوحدة إلى ${to.name}`);
    App.go(`#/teacher/unit/${to.id}/${newId}`);
  };

  // إرجاع وحدة مضمّنة إلى حالتها الأصلية (إصلاح وحدة اختلطت كلماتها)
  U.actions['c-restore-unit'] = async () => {
    const b = builtInUnit(ctx.gid, ctx.uid), u = Cur.unit(ctx.gid, ctx.uid);
    if (!b || !u) return;
    const ok = await App.confirm(
      `استعادة «${iso(b.title)}» كما هي في التطبيق (${b.words.length} كلمة)؟ ستُحذف الكلمات الحالية في هذه الوحدة، وأي كلمة أضفتها بنفسك إليها.`,
      { okLabel: 'استعادة', danger: true });
    if (!ok) return;
    mutate(d => {
      const { u: du } = unitData(d);
      du.title = b.title;
      du.words = JSON.parse(JSON.stringify(b.words));
    });
    unitView(ctx.gid, ctx.uid);
    App.toast('تمت استعادة الوحدة');
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

  // ---------- استيراد Excel ----------
  const EXCEL_HEADERS = {
    grade: 'الصف (grade)',
    unit: 'رقم الوحدة (unit)',
    unit_title: 'عنوان الوحدة (unit_title)',
    word: 'الكلمة (word)',
    meaning: 'المعنى (meaning)',
    sentence: 'الجملة (sentence)',
    sentence_ar: 'ترجمة الجملة (sentence_ar)',
    page: 'الصفحة (page)',
    form: 'شكل الكلمة في الجملة (form)'
  };

  U.actions['c-excel-template'] = () => {
    if (typeof XLSX === 'undefined') { App.toast('مكتبة Excel غير متوفرة. تأكد من اتصالك بالإنترنت وأعد تحميل الصفحة.'); return; }
    const headers = Object.values(EXCEL_HEADERS);
    const open = Cur.grade(ctx.gid) || Cur.grades[0] || { id: 'm2', name: '' };
    // الورقة الأولى للكلمات (فارغة)، والثانية تعليمات ومثال. التطبيق يقرأ الأولى فقط.
    const ws = XLSX.utils.aoa_to_sheet([headers]);
    ws['!cols'] = headers.map((_, i) => ({ wch: i === 5 || i === 6 ? 40 : i === 2 ? 30 : 15 }));
    const help = XLSX.utils.aoa_to_sheet([
      ['تعليمات استيراد الكلمات'],
      [''],
      ['1. املأ الورقة الأولى (كلمات): سطر لكل كلمة، والأعمدة كما في السطر الأول.'],
      ['2. الصف: اكتب اسم الصف كما في التطبيق أو رمزه. إن تركته فارغًا يُضاف السطر إلى الصف المفتوح وقت الاستيراد.'],
      ['   الصفوف المتاحة: ' + Cur.grades.map(g => `${g.name} (${g.id})`).join(' ، ')],
      ['3. رقم الوحدة: رقم فقط، مثل 2 (مطلوب). وعنوان الوحدة اختياري.'],
      ['4. قبل الإضافة يعرض التطبيق ملخصًا بالصف والوحدة وعدد الكلمات لتتأكد منه. وإن لم يعرف الصف المكتوب يرفض الملف ولا يضيف شيئًا.'],
      [''],
      ['مثال (لا تنسخه إلى الورقة الأولى):'],
      headers,
      [open.id, '2', 'Unit 2: House Designs', 'basement', 'قبو', 'Downstairs is the basement.', 'القبو في الأسفل.', '23', '']
    ]);
    help['!cols'] = [{ wch: 110 }, ...headers.slice(1).map(() => ({ wch: 20 }))];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'كلمات');
    XLSX.utils.book_append_sheet(wb, help, 'تعليمات');
    XLSX.writeFile(wb, 'kalimati-template.xlsx');
    App.toast('تم تحميل القالب. املأ الورقة الأولى ثم ارفعه هنا.');
  };

  // تطبيع اسم الصف كي يُفهم «خامس» و«الصف الخامس الابتدائي» و«5 ابتدائي» و«g5» على أنها نفس الصف
  const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
  function gradeKey(s) {
    return String(s || '').toLowerCase()
      .replace(/[٠-٩]/g, d => AR_DIGITS.indexOf(d))
      .replace(/[ً-ْـ]/g, '')
      .replace(/[إأآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
      .replace(/(^|\s)(الصف|صف)(?=\s|$)/g, '$1')
      .replace(/(^|\s)ال/g, '$1')
      .replace(/[\s_\-.]+/g, '');
  }
  // مفتاح مكرر بين صفين (غامض) يُهمل بدل أن يُختار أحدهما
  function gradeIndex() {
    const idx = new Map(), dead = new Set();
    const put = (k, g) => {
      if (!k || dead.has(k)) return;
      const cur = idx.get(k);
      if (cur && cur !== g) { idx.delete(k); dead.add(k); } else idx.set(k, g);
    };
    Cur.grades.forEach(g => {
      [g.id, g.name, g.short].forEach(x => put(gradeKey(x), g));
      const stage = /ابتدائي/.test(g.name) ? 'ابتدائي' : /متوسط/.test(g.name) ? 'متوسط' : '';
      if (stage) put(gradeKey(g.name).replace(gradeKey(stage), ''), g);
      const dm = String(g.id).match(/^[gm](\d)$/);
      if (dm) put(dm[1], g);
    });
    return idx;
  }

  // يبني المنهج الجديد وخطة الإضافة دون حفظ شيء. أي صف أو وحدة غير مفهومة تُفشل الاستيراد كله.
  function parseExcel(wb) {
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (!rows.length) return { error: 'الورقة الأولى فارغة. املأ الكلمات في الورقة الأولى من القالب.' };

    // تعيين أسماء الأعمدة (يدعم الأسماء العربية والإنجليزية)
    const colMap = {};
    const mappings = [
      ['grade', /grade|الصف/i], ['unit', /^unit$|رقم.*وحد|\(unit\)/i], ['unit_title', /unit.?title|عنوان.*وحد/i],
      ['word', /\(word\)|^word$|الكلمة/i], ['meaning', /meaning|المعنى/i], ['sentence', /\(sentence\)|^sentence$|^الجملة/i],
      ['sentence_ar', /sentence.?ar|ترجمة/i], ['page', /page|الصفح/i], ['form', /\(form\)|^form$|شكل/i]
    ];
    Object.keys(rows[0]).forEach(k => {
      for (const [field, re] of mappings) {
        if (re.test(k) && !colMap[field]) { colMap[field] = k; break; }
      }
    });
    if (!colMap.word) return { error: 'لم أجد عمود الكلمة (word). تأكد من استخدام القالب.' };
    if (!colMap.unit) return { error: 'لم أجد عمود رقم الوحدة (unit). تأكد من استخدام القالب.' };

    const idx = gradeIndex();
    const open = Cur.grade(ctx.gid) || Cur.grades[0];
    const data = Cur.snapshot();
    const plan = new Map();
    const badGrades = new Set(), badUnits = [];
    let skipped = 0;

    rows.forEach((row, ri) => {
      const en = String(row[colMap.word] || '').trim();
      if (!en) { skipped++; return; }
      const line = ri + 2;

      const gradeRaw = colMap.grade ? String(row[colMap.grade]).trim() : '';
      let g = open;
      if (gradeRaw) {
        g = idx.get(gradeKey(gradeRaw));
        if (!g) { badGrades.add(gradeRaw); return; }
      }
      const unitMatch = String(row[colMap.unit]).match(/\d+/);
      const unitNum = unitMatch ? parseInt(unitMatch[0], 10) : 0;
      if (!unitNum) { badUnits.push(line); return; }
      const fileTitle = String(colMap.unit_title ? row[colMap.unit_title] : '').trim();

      const dg = data.grades.find(x => x.id === g.id);
      const key = g.id + '|' + unitNum;
      let p = plan.get(key);
      if (!p) {
        let du = dg.units.find(x => x.num === unitNum);
        const existed = !!du;
        if (!du) {
          let id = 'u' + unitNum;
          if (dg.units.some(x => x.id === id)) id = `u${unitNum}-${U.rid().slice(0, 3)}`;
          du = { id, title: fileTitle || `Unit ${unitNum}`, num: unitNum, words: [] };
          dg.units.push(du);
        }
        // عنوان الوحدة الموجودة لا يُستبدل أبدًا من الملف
        p = { g, du, existed, before: du.words.length, added: 0, fileTitle, titleDiff: existed && !!fileTitle && fileTitle !== du.title };
        plan.set(key, p);
      }
      const du = p.du;
      if (du.words.some(w => w.en.toLowerCase() === en.toLowerCase())) { skipped++; return; }

      const w = wordFrom({
        en,
        ar: colMap.meaning ? String(row[colMap.meaning] || '') : '',
        sentence: colMap.sentence ? String(row[colMap.sentence] || '') : '',
        sentenceAr: colMap.sentence_ar ? String(row[colMap.sentence_ar] || '') : '',
        page: colMap.page ? String(row[colMap.page] || '') : '',
        form: colMap.form ? String(row[colMap.form] || '') : ''
      });
      if (!w.form) resolveForm(w);
      du.words.push(w);
      p.added++;
    });

    if (badGrades.size) {
      return { error: `الصف غير معروف في الملف: «${[...badGrades].slice(0, 3).join('»، «')}». اكتب اسم الصف كما في التطبيق (مثل: ${Cur.grades.map(x => x.name).join('، ')}) أو رمزه، أو اتركه فارغًا. لم يُضف شيء.` };
    }
    if (badUnits.length) {
      return { error: `رقم الوحدة مفقود أو غير واضح في الأسطر: ${badUnits.slice(0, 8).join('، ')}. لم يُضف شيء.` };
    }
    const groups = [...plan.values()].filter(p => p.added > 0);
    const added = groups.reduce((n, p) => n + p.added, 0);
    if (!added) return { error: `لم تُضف كلمات. ${skipped ? `تم تجاوز ${skipped} سطر (مكررة أو فارغة).` : ''}` };

    // وحدة أُنشئت ولم تُضف إليها كلمة لا تبقى فارغة
    plan.forEach(p => {
      if (!p.existed && !p.added) {
        const dg = data.grades.find(x => x.id === p.g.id);
        dg.units = dg.units.filter(x => x !== p.du);
      }
    });
    data.grades.forEach(g => g.units.sort((a, b) => a.num - b.num));
    return { data, added, skipped, groups };
  }

  // يعزل النص الإنجليزي داخل جملة عربية كي لا يتبدل ترتيب السطر
  const iso = t => '\u2068' + t + '\u2069';

  function importSummary(r) {
    const lines = r.groups.map(p => {
      const state = p.existed ? `وحدة موجودة فيها ${p.before} كلمة` : 'وحدة جديدة';
      const diff = p.titleDiff ? `\n   عنوان الوحدة في الملف مختلف («${iso(p.fileTitle)}») وسيبقى العنوان الحالي.` : '';
      return `• ${p.g.name} — ${iso(p.du.title)} : ${p.added} كلمة (${state})${diff}`;
    });
    return `سيتم إضافة ${r.added} كلمة إلى:\n${lines.join('\n')}${r.skipped ? `\nتم تجاوز ${r.skipped} سطر مكرر أو فارغ.` : ''}\n\nتأكد من الصف والوحدة قبل الإضافة.`;
  }

  // معالج رفع الملف
  document.addEventListener('change', async e => {
    const input = e.target;
    if (!input.matches('[data-act="c-excel-import"]')) return;
    const file = input.files && input.files[0];
    if (!file) return;
    input.value = ''; // أتح الرفع مرة أخرى

    if (typeof XLSX === 'undefined') { App.toast('مكتبة Excel غير متوفرة. تأكد من اتصالك بالإنترنت وأعد تحميل الصفحة.'); return; }

    let result;
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      result = parseExcel(wb);
    } catch (err) {
      console.error('خطأ في قراءة الملف:', err);
      App.toast('تعذر قراءة الملف. تأكد من أنه ملف Excel (.xlsx) صحيح.');
      return;
    }
    if (result.error) { await App.alert('تعذر الاستيراد', result.error); return; }
    if (!(await App.confirm(importSummary(result), { okLabel: 'إضافة' }))) return;

    Store.saveCurriculum(result.data);
    App.toast(`تم استيراد ${result.added} كلمة`);
    const first = result.groups[0];
    App.go(result.groups.length === 1
      ? `#/teacher/unit/${first.g.id}/${first.du.id}`
      : `#/teacher/content/${first.g.id}`);
  });

  // ---------- المسار ----------
  function route(parts) {
    const [sub, a, b] = parts;
    if (sub === 'unit' && a) {
      if (ctx.gid !== a || ctx.uid !== b) { editingId = null; openSection = null; }
      return unitView(a, b);
    }
    if (!a || !Cur.grade(a)) return App.go('#/teacher');
    ctx.gid = a;
    return home(a);
  }

  return { route, parseQuick };
})();
