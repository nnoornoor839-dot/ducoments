// استدعاء دوال قاعدة البيانات (Supabase RPC) بدون مكتبات خارجية
const Cloud = (() => {
  const cfg = window.KALIMATI_CLOUD || {};
  const base = String(cfg.url || '').replace(/\/+$/, '');
  const enabled = !!(base && cfg.key);

  // يُرجع JSON الدالة. عند فشل الشبكة يرمي خطأ بلا status؛ وعند رفض الخادم يرمي خطأ فيه status.
  async function rpc(name, args = {}, timeout = 8000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    const body = JSON.stringify(args);
    try {
      const res = await fetch(`${base}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: { apikey: cfg.key, 'Content-Type': 'application/json' },
        body,
        signal: ctrl.signal,
        keepalive: body.length < 60000
      });
      if (!res.ok) {
        const e = new Error('HTTP ' + res.status);
        e.status = res.status;
        throw e;
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  return { enabled, rpc };
})();
