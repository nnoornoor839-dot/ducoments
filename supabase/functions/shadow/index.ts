// دالة Edge: تحويل تسجيل الطالب إلى نص (Whisper عبر Groq) لتقييم قراءة الجمل.
// الأسرار: GROQ_API_KEY (يضيفها المعلم في Supabase). SUPABASE_URL و SUPABASE_ANON_KEY تُحقن تلقائيًا.
// يجب إيقاف "Verify JWT" لهذه الدالة: نتحقق بأنفسنا من رمز الطالب عبر kal_shadow_gate.
// لا يُحفظ أي تسجيل: يُرسل إلى Groq ثم يُنسى، ويُرجَع النص فقط.

const MAX_BYTES = 2 * 1024 * 1024;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, content-type, authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'bad' }, 405);

  let form: FormData;
  try { form = await req.formData(); } catch (_) { return json({ error: 'bad' }, 400); }
  const token = String(form.get('token') || '');
  const wid = String(form.get('wid') || '');
  const audio = form.get('audio');
  if (!token || !wid || wid.length > 120 || !(audio instanceof File)) return json({ error: 'bad' }, 400);
  if (audio.size < 1000) return json({ error: 'empty' }, 400);
  if (audio.size > MAX_BYTES) return json({ error: 'too-big' }, 413);

  const rpc = async (name: string, args: Record<string, unknown>) => {
    const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '', 'Content-Type': 'application/json' },
      body: JSON.stringify(args)
    });
    return await r.json().catch(() => ({}));
  };

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
  const counted = await rpc('kal_shadow_count', { p_token: token, p_wid: wid, p_try: text.trim() !== '' });
  return json({ ok: true, text, tries: counted?.tries ?? gate.tries });
});
