'use strict';
/* ===== Audio: everything synthesised with Web Audio (no files). Must be created from a user gesture. ===== */
const Sound = (function () {
  let ctx = null, master, noise, humG, breathG, breathD, breathL, growlG, nextBeat = 0;

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor(); master = ctx.createGain(); master.gain.value = 0.9;
    master.connect(comp); comp.connect(ctx.destination);
    const len = ctx.sampleRate * 2; noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const osc = (type, f, g, lp, dest) => {
      const o = ctx.createOscillator(), v = ctx.createGain(), lf = ctx.createBiquadFilter();
      o.type = type; o.frequency.value = f; v.gain.value = g; lf.type = 'lowpass'; lf.frequency.value = lp;
      o.connect(lf); lf.connect(v); v.connect(dest); o.start(); return o;
    };
    humG = ctx.createGain(); humG.gain.value = 1; humG.connect(master);            // fluorescent hum
    osc('sawtooth', 100, 0.014, 380, humG); osc('sine', 50, 0.03, 200, humG); osc('square', 120, 0.006, 500, humG);
    const dr = ctx.createGain(); dr.gain.value = 1; dr.connect(master);              // low drone
    osc('sine', 41, 0.05, 300, dr); osc('sine', 43.3, 0.05, 300, dr);
    const loop = () => { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; return s; };
    const hs = loop(), hf = ctx.createBiquadFilter(), hg = ctx.createGain();           // electric hiss
    hf.type = 'bandpass'; hf.frequency.value = 6000; hf.Q.value = 2; hg.gain.value = 0.004; hs.connect(hf); hf.connect(hg); hg.connect(humG); hs.start();
    const bs = loop(), bf = ctx.createBiquadFilter();                                  // breathing
    bf.type = 'bandpass'; bf.frequency.value = 900; bf.Q.value = 0.8; breathG = ctx.createGain(); breathG.gain.value = 0;
    bs.connect(bf); bf.connect(breathG); breathG.connect(master); bs.start();
    breathL = ctx.createOscillator(); breathL.frequency.value = 1; breathD = ctx.createGain(); breathD.gain.value = 0;
    breathL.connect(breathD); breathD.connect(breathG.gain); breathL.start();
    growlG = ctx.createGain(); growlG.gain.value = 0; growlG.connect(master);          // monster rumble
    osc('sawtooth', 62, 0.5, 220, growlG); osc('sawtooth', 65.5, 0.5, 220, growlG);
    const tr = ctx.createOscillator(), td = ctx.createGain(); tr.frequency.value = 11; td.gain.value = 0.25; tr.connect(td); td.connect(growlG.gain); tr.start();
  }
  function thump(f0, f1, dur, vol) {
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.03);
  }
  function burst(f, q, dur, vol, type, sweep) {
    const t = ctx.currentTime, s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise; fl.type = type || 'bandpass'; fl.frequency.setValueAtTime(f, t); if (sweep) fl.frequency.exponentialRampToValueAtTime(sweep, t + dur); fl.Q.value = q;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(master); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }
  function tone(type, f0, f1, dur, vol) {
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.03);
  }
  const ok = () => ctx && ctx.state === 'running';
  return {
    init() { init(); this.resume(); },
    resume() { if (ctx && ctx.state !== 'running') ctx.resume(); },
    suspend() { if (ctx) ctx.suspend(); },
    step(sn) { if (!ok()) return; thump(110, 55, 0.09, 0.05 + 0.14 * sn); burst(500, 0.7, 0.08, 0.03 + 0.1 * sn, 'lowpass'); },
    mstep(th) { if (!ok()) return; thump(80, 36, 0.16, 0.12 + 0.35 * th); burst(300, 0.6, 0.1, 0.05 + 0.1 * th, 'lowpass'); },
    beep() { if (!ok()) return; tone('square', 520, 500, 0.12, 0.05); setTimeout(() => ok() && tone('square', 390, 380, 0.12, 0.05), 150); },
    roar() { if (!ok()) return; tone('sawtooth', 220, 70, 1.1, 0.12); burst(800, 1.5, 1.0, 0.1, 'bandpass', 200); },
    caught() { if (!ok()) return; burst(1200, 0.5, 0.9, 0.5, 'lowpass', 150); thump(120, 30, 0.6, 0.8); tone('sawtooth', 600, 1500, 0.35, 0.15); setTimeout(() => ok() && tone('sawtooth', 1500, 300, 0.6, 0.15), 330); },
    update(dt, sn, threat, flick, active) {
      if (!ctx) return;
      const t = ctx.currentTime;
      humG.gain.setTargetAtTime(0.7 + 0.3 * flick, t, 0.03);
      const bv = active ? 0.01 + 0.07 * sn + 0.06 * threat : 0.0;
      breathG.gain.setTargetAtTime(bv, t, 0.15); breathD.gain.setTargetAtTime(bv, t, 0.15);
      breathL.frequency.setTargetAtTime(0.9 + 1.8 * sn + 1.2 * threat, t, 0.3);
      growlG.gain.setTargetAtTime(active ? 0.09 * smooth(0.25, 0.9, threat) : 0, t, 0.2);
      if (active && threat > 0.1 && ok()) {                                         // heartbeat, faster and louder when close
        if (nextBeat < t - 1) nextBeat = t;
        if (t >= nextBeat) {
          const bpm = lerp(60, 150, threat), vol = lerp(0.25, 1, threat);
          thump(75, 40, 0.14, 0.5 * vol); setTimeout(() => ok() && thump(65, 36, 0.12, 0.3 * vol), 170 * (60 / bpm) * 1.3);
          nextBeat += 60 / bpm;
        }
      }
    }
  };
})();
