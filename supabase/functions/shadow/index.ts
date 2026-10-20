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
  const audio = form.get('audio');
  if (!token || !(audio instanceof File)) return json({ error: 'bad' }, 400);
  if (audio.size < 1000) return json({ error: 'empty' }, 400);
  if (audio.size > MAX_BYTES) return json({ error: 'too-big' }, 413);

  // 1) رمز الطالب + الحد اليومي
  const gateRes = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/kal_shadow_gate`, {
    method: 'POST',
    headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '', 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_token: token })
  });
  const gate = await gateRes.json().catch(() => ({}));
  if (!gate || !gate.ok) return json({ error: gate?.error || 'auth' }, gate?.error === 'limit' ? 429 : 403);

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
  return json({ ok: true, text: String(out.text || '').slice(0, 400), left: gate.left });
});
