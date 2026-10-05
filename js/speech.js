// نطق الكلمات والجمل بسرعات مختلفة (Web Speech API)
const Speech = (() => {
  const supported = typeof window !== 'undefined'
    && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

  const SPEEDS = [
    { id: 'vslow', label: 'بطيء جدًا', emoji: '🐢', rate: 0.35 },
    { id: 'slow', label: 'بطيء', emoji: '🚶', rate: 0.5 },
    { id: 'normal', label: 'عادي', emoji: '🏃', rate: 1 }
  ];

  let speedId = U.lsGet('kalimati.speed', 'slow');
  if (!SPEEDS.some(s => s.id === speedId)) speedId = 'slow';

  // الفاصل بين مرات التكرار: وقت ليردّد الطالب الكلمة بصوته
  const GAPS = [
    { ms: 1000, label: 'قصير', sec: '1 ث' },
    { ms: 2000, label: 'متوسط', sec: '2 ث' },
    { ms: 4000, label: 'طويل', sec: '4 ث' }
  ];
  let gapMs = Number(U.lsGet('kalimati.gap', '2000'));
  if (!GAPS.some(g => g.ms === gapMs)) gapMs = 2000;

  let voice = null;
  let token = 0;       // كل تشغيل جديد يلغي ما قبله
  let current = null;  // نحتفظ بالمرجع كي لا يحذفه المتصفح قبل انتهاء النطق

  function pickVoice() {
    if (!supported) return;
    const vs = speechSynthesis.getVoices().filter(v => /^en[-_]/i.test(v.lang));
    if (!vs.length) { voice = null; return; }
    const score = v =>
      (/en[-_]US/i.test(v.lang) ? 3 : /en[-_]GB/i.test(v.lang) ? 2 : 1) +
      (/google|microsoft|samantha|natural|online/i.test(v.name) ? 2 : 0);
    voice = vs.slice().sort((a, b) => score(b) - score(a))[0];
  }
  if (supported) {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
  }

  const rate = () => SPEEDS.find(s => s.id === speedId).rate;

  function one(text, r) {
    return new Promise(resolve => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      if (voice) u.voice = voice;
      u.rate = r;
      current = u;
      let done = false;
      let timer = null;
      const fin = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
      u.onend = fin;
      u.onerror = fin;
      timer = setTimeout(fin, 2500 + (text.length * 350) / r);  // احتياط إن لم يصل حدث الانتهاء
      speechSynthesis.speak(u);
    });
  }

  // items: نص، أو {text, rate}، أو {pause: ms}. يُرجع true إن اكتمل التشغيل دون إلغاء.
  async function say(items) {
    if (!supported) return false;
    const my = ++token;
    speechSynthesis.cancel();
    await U.wait(60);
    for (const it of items) {
      if (my !== token) return false;
      const o = typeof it === 'string' ? { text: it } : it;
      if (o.pause) { await U.wait(o.pause); continue; }
      await one(o.text, o.rate ?? rate());
    }
    return my === token;
  }

  // تكرار نص n مرة مع عدّاد حي. يُرجع عدد المرات التي اكتملت (أقل من n إن أُوقف).
  async function loop(text, n, onTick) {
    if (!supported) return 0;
    const my = ++token;
    speechSynthesis.cancel();
    await U.wait(60);
    let done = 0;
    for (let i = 1; i <= n; i++) {
      if (my !== token) return done;
      if (onTick) onTick(i, n);
      await one(text, rate());
      if (my !== token) return done;
      done = i;
      if (i < n) await pause(gapMs, my);
    }
    return done;
  }

  // انتظار يتوقف فورًا إذا بدأ تشغيل آخر أو ضُغط إيقاف
  async function pause(ms, my) {
    const end = Date.now() + ms;
    while (my === token && Date.now() < end) await U.wait(Math.min(100, end - Date.now()));
  }

  return {
    supported,
    SPEEDS,
    GAPS,
    loop,
    getGap: () => gapMs,
    setGap(ms) {
      if (GAPS.some(g => g.ms === ms)) { gapMs = ms; U.lsSet('kalimati.gap', String(ms)); }
    },
    getSpeed: () => speedId,
    setSpeed(id) {
      if (SPEEDS.some(s => s.id === id)) { speedId = id; U.lsSet('kalimati.speed', id); }
    },
    stop() { token++; if (supported) speechSynthesis.cancel(); },
    word: text => say([text]),
    sentence: text => say([text]),
    repeat: (text, n = 3) => say(Array.from({ length: n }, (_, i) => (i ? [{ pause: 550 }, text] : [text])).flat()),
    // تهجئة الحروف واحدًا واحدًا ثم نطق الكلمة
    spell(text) {
      const items = [];
      for (const ch of text.replace(/[^A-Za-z]/g, '')) items.push(ch.toUpperCase(), { pause: 220 });
      items.push({ pause: 250 }, text);
      return say(items);
    },
    // جملة بها فراغ: نقرأ ما قبله، نصمت، ثم نقرأ ما بعده
    blanked(before, after) {
      const items = [];
      if (before.trim()) items.push(before.trim());
      items.push({ pause: 800 });
      if (after.trim()) items.push(after.trim());
      return say(items);
    }
  };
})();
