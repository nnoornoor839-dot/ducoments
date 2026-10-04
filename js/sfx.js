// مؤثرات صوتية قصيرة (بدون ملفات) باستخدام WebAudio
const Sfx = (() => {
  let ctx = null;
  let on = U.lsGet('kalimati.sound', '1') !== '0';

  function ac() {
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (C) { try { ctx = new C(); } catch (e) { ctx = null; } }
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, start, dur, type = 'sine', vol = 0.14) {
    if (!on) return;
    const c = ac();
    if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    const t = c.currentTime + start;
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }

  return {
    isOn: () => on,
    toggle() { on = !on; U.lsSet('kalimati.sound', on ? '1' : '0'); return on; },
    correct() { tone(660, 0, 0.12); tone(880, 0.1, 0.2); },
    wrong() { tone(220, 0, 0.2, 'triangle'); tone(170, 0.14, 0.28, 'triangle'); },
    win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.22)); },
    tick() { tone(1000, 0, 0.05, 'square', 0.05); }
  };
})();
