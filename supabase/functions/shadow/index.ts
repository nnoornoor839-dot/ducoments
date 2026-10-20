// دالة Edge: قراءة الجمل.
//  - الافتراضي (الطالب): يحوّل تسجيله إلى نص (Whisper عبر Groq)، ويحفظ التسجيل في مساحة خاصة ليسمعه المعلم.
//  - action=sign (المعلم): روابط مؤقتة لتشغيل تسجيلات طالب.
//  - action=purge (المعلم): حذف ملفات تسجيلات طالب (قبل تصفير تقدمه أو حذفه).
// الأسرار: GROQ_API_KEY (يضيفها المعلم). SUPABASE_URL و SUPABASE_ANON_KEY و SUPABASE_SERVICE_ROLE_KEY تُحقن تلقائيًا.
// يجب إيقاف "Verify JWT" لهذه الدالة: نتحقق بأنفسنا من رمز الطالب أو المعلم عبر دوال قاعدة البيانات.

const MAX_BYTES = 2 * 1024 * 1024;
const BUCKET = 'shadow';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, content-type, authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const SB = () => Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const rpc = async (name: string, args: Record<string, unknown>) => {
  const r = await fetch(`${SB()}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '', 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  });
  return await r.json().catch(() => ({}));
};
const storage = (path: string, init: RequestInit) =>
  fetch(`${SB()}/storage/v1/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${SERVICE()}`, apikey: SERVICE(), ...(init.headers || {}) }
  });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'bad' }, 405);

  let form: FormData;
  try { form = await req.formData(); } catch (_) { return json({ error: 'bad' }, 400); }
  const token = String(form.get('token') || '');
  const action = String(form.get('action') || '');
  if (!token) return json({ error: 'bad' }, 400);

  // ---------- المعلم: روابط الاستماع / الحذف ----------
  if (action === 'sign' || action === 'purge') {
    const sid = String(form.get('sid') || '');
    if (!sid || sid.length > 80) return json({ error: 'bad' }, 400);
    const list = await rpc('kal_teacher_clips', { p_token: token, p_id: sid });
    if (!list || !list.ok) return json({ error: 'auth' }, 403);
    const clips = (list.clips || []) as Array<{ path: string; wid: string; n: number; heard: string; at: string }>;
    if (!clips.length) return json({ ok: true, clips: [] });
    const paths = clips.map(c => c.path);
    if (action === 'purge') {
      const r = await storage(`object/${BUCKET}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: paths })
      });
      return json({ ok: r.ok, deleted: paths.length });
    }
    const r = await storage(`object/sign/${BUCKET}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 3600, paths })
    });
    const signed = await r.json().catch(() => []);
    const byPath = new Map<string, string>();
    if (Array.isArray(signed)) {
      signed.forEach((s: { path?: string; signedURL?: string }) => {
        if (s && s.path && s.signedURL) byPath.set(s.path, `${SB()}/storage/v1${s.signedURL}`);
      });
    }
    return json({ ok: true, clips: clips.map(c => ({ ...c, url: byPath.get(c.path) || null })) });
  }

  // ---------- الطالب: تحويل التسجيل إلى نص ----------
  const wid = String(form.get('wid') || '');
  const audio = form.get('audio');
  if (!wid || wid.length > 120 || !(audio instanceof File)) return json({ error: 'bad' }, 400);
  if (audio.size < 1000) return json({ error: 'empty' }, 400);
  if (audio.size > MAX_BYTES) return json({ error: 'too-big' }, 413);

  // 1) رمز الطالب + الحد اليومي + محاولات هذه الجملة (خمس كحد أقصى)
  const gate = await rpc('kal_shadow_gate', { p_token: token, p_wid: wid });
  if (!gate || !gate.ok) {
    const e = gate?.error || 'auth';
    return json({ error: e, tries: gate?.tries }, e === 'limit' || e === 'tries' ? 429 : 403);
  }

  // 2) التعرف على الكلام
  const body = new FormData();
  body.append('file', audio, audio.name || 'speech.webm');
  body.append('model', 'whisper-large-v3-turbo');
  body.append('language', 'en');
  body.append('temperature', '0');
  body.append('response_format', 'json');
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('GROQ_API_KEY')}` },
    body
  });
  if (!res.ok) return json({ error: res.status === 429 ? 'busy' : 'server' }, 502);
  const out = await res.json().catch(() => ({}));
  const text = String(out.text || '').slice(0, 400);

  // 3) تُحسب المحاولة (للجملة) فقط إن سُمع كلام؛ الصمت لا يستهلك محاولات الطالب
  const ext = (audio.name.split('.').pop() || 'webm').toLowerCase();
  const counted = await rpc('kal_shadow_count', { p_token: token, p_wid: wid, p_try: text.trim() !== '', p_text: text, p_ext: ext });

  // 4) نحفظ التسجيل في المساحة الخاصة ليسمعه المعلم (فشل الحفظ لا يمنع نتيجة الطالب)
  if (counted?.path && SERVICE()) {
    try {
      await storage(`object/${BUCKET}/${counted.path}`, {
        method: 'POST', headers: { 'Content-Type': audio.type || 'audio/webm', 'x-upsert': 'true' }, body: audio
      });
    } catch (_) { /* تجاهل */ }
  }
  return json({ ok: true, text, tries: counted?.tries ?? gate.tries });
});
