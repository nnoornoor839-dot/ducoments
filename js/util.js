// أدوات صغيرة مشتركة
const U = {
  actions: {},   // معالجات الضغط: data-act="name"
  forms: {},     // معالجات النماذج: data-form="name"

  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  },
  escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); },
  rid() { return Math.random().toString(36).slice(2, 9); },
  slug(s) { return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); },
  shuffle(a) {
    const r = a.slice();
    for (let i = r.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [r[i], r[j]] = [r[j], r[i]];
    }
    return r;
  },
  pick(a) { return a[Math.floor(Math.random() * a.length)]; },
  wait(ms) { return new Promise(r => setTimeout(r, ms)); },

  // تاريخ محلي بصيغة YYYY-MM-DD
  ymd(d = new Date()) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },
  // عدد الأيام من تاريخ a إلى تاريخ b
  dayDiff(a, b) {
    const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
    return Math.round((new Date(pb[0], pb[1] - 1, pb[2]) - new Date(pa[0], pa[1] - 1, pa[2])) / 864e5);
  },
  ago(ymd) {
    if (!ymd) return 'لم يدخل بعد';
    const d = U.dayDiff(ymd, U.ymd());
    if (d <= 0) return 'اليوم';
    if (d === 1) return 'أمس';
    if (d === 2) return 'قبل يومين';
    if (d <= 10) return `قبل ${d} أيام`;
    return `قبل ${d} يومًا`;
  },
  // قراءة/كتابة آمنة في التخزين المحلي (قد يكون محجوبًا)
  lsGet(k, fallback = null) {
    try { const v = localStorage.getItem(k); return v === null ? fallback : v; } catch (e) { return fallback; }
  },
  lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* تجاهل */ } }
};
