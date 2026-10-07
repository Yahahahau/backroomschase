'use strict';
/* ===== State ===== */
let state = 'MENU';                                   // MENU | PLAYING | PAUSED | GAMEOVER
let sP = START_S, vP = 0, vT = 0, sM = START_S - GAP0, tGame = 0, msNow = 3.4;
let lunge = 0, lungeCD = 20, glance = null, glanceCD = 6, yawOff = 0;
let threatS = 0, ampS = 0, bobPhase = 0, yaw = 0, pitch = 0, camY = 0, yawErr = 0, snap = true, mYaw = 0;
let stepIdx = 0, mPh = 0, mStepIdx = 0, overT = 0, overShown = false, overSide = 1, zone = 'safe', best = parseInt(Store.get('br_best', '0'), 10) || 0;
const TAP = 1.7, HOLD = 2.0, HOLD_CAP = 4.5, GRACE = 2.2, MON_MAX = 10.5;
const curP = Level.cursor(), curLA = Level.cursor(), curM = Level.cursor(), curML = Level.cursor();
const A = { x: 0, y: 0, z: 0 }, B = { x: 0, y: 0, z: 0 };

/* ===== Input ===== */
const Input = { taps: 0, held: new Set(), key: false };
const btnRun = $('btnRun');
function pdown(e) { e.preventDefault(); Input.taps++; Input.held.add(e.pointerId); btnRun.classList.add('down'); try { btnRun.setPointerCapture(e.pointerId); } catch (_) {} }
function pup(e) { Input.held.delete(e.pointerId); if (!Input.held.size) btnRun.classList.remove('down'); }
btnRun.addEventListener('pointerdown', pdown);
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(n => btnRun.addEventListener(n, pup));
btnRun.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
document.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('keydown', e => {
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') { e.preventDefault(); if (!e.repeat) Input.taps++; Input.key = true; btnRun.classList.add('down'); }
  else if (e.code === 'KeyF') toggleFlash();
  else if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
});
window.addEventListener('keyup', e => { if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') { Input.key = false; btnRun.classList.remove('down'); } });
function toggleFlash() { const on = Flashlight.toggle(); $('btnFlash').classList.toggle('off', !on); }
function togglePause() { if (state === 'PLAYING') pauseGame(); else if (state === 'PAUSED') resumeGame(); }
$('btnFlash').addEventListener('click', toggleFlash);
$('btnPause').addEventListener('click', togglePause);
$('btnPlay').addEventListener('click', startGame);
$('btnRetry').addEventListener('click', startGame);
$('btnResume').addEventListener('click', resumeGame);
$('btnQuit').addEventListener('click', showMenu);
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'PLAYING') pauseGame(); });

/* ===== Quality (AUTO picks by device, and lowers itself when FPS drops) ===== */
let qMode = Store.get('br_q', 'auto'); if (qMode !== 'auto' && !QUALITY[qMode]) qMode = 'auto';
const qBtns = [];
function detect() {
  if (!isMobile) return 'high';
  return ((navigator.hardwareConcurrency || 4) >= 6 && (navigator.deviceMemory || 4) >= 4) ? 'medium' : 'low';
}
function setQMode(m) {
  qMode = m; Store.set('br_q', m); prScale = 1; applyQuality(m === 'auto' ? detect() : m);
  qBtns.forEach(b => b.classList.toggle('on', b.dataset.q === m));
}
['qMenu', 'qPause'].forEach(id => {
  ['auto', 'low', 'medium', 'high'].forEach(m => {
    const b = document.createElement('button'); b.dataset.q = m; b.textContent = m === 'auto' ? 'AUTO' : QUALITY[m].label;
    b.addEventListener('click', () => setQMode(m)); $(id).appendChild(b); qBtns.push(b);
  });
});
const Perf = {
  acc: 0, frames: 0, bad: 0, cool: 0,
  tick(raw) {
    if (qMode !== 'auto' || state !== 'PLAYING' || tGame < 3) return;
    this.acc += raw; this.frames++;
    if (this.acc < 1.5) return;
    const fps = this.frames / this.acc; this.acc = 0; this.frames = 0; this.cool -= 1.5;
    if (fps >= 27) { this.bad = 0; return; }
    if (++this.bad < 2 || this.cool > 0) return;
    this.bad = 0; this.cool = 4;
    if (qName === 'high') { applyQuality('medium'); toast('QUALITY: MEDIUM'); }
    else if (qName === 'medium') { applyQuality('low'); toast('QUALITY: LOW'); }
    else if (prScale > 0.6) { prScale -= 0.1; resize(); toast('RESOLUTION LOWERED'); }
  }
};
let toastT = 0;
function toast(s) { const t = $('toast'); t.textContent = s; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 1800); }

/* ===== UI ===== */
const el = { gap: $('gapNum'), fill: $('barFill'), chip: $('zoneChip'), flr: $('flrLbl'), spd: $('spdNum'), run: $('runNum'), warn: $('warn'), hint: $('hint'), red: $('fxRed'), vig: $('fxVig'), hud: $('hud'), panel: $('distPanel'), rf: $('runFill') };
const lastTxt = {};
function setText(k, e, v) { if (lastTxt[k] !== v) { lastTxt[k] = v; e.textContent = v; } }
const ZN = { safe: 'SAFE', warn: 'WARNING', danger: 'DANGER', crit: 'CRITICAL' };
function show(id, v) { $(id).classList.toggle('hide', !v); }
function updateHud(gap, dist, t) {
  setText('gap', el.gap, Math.max(0, gap).toFixed(0) + ' m');
  setText('spd', el.spd, String(Math.round(vP * 3.6)));
  setText('run', el.run, String(Math.floor(dist)));
  setText('flr', el.flr, 'FLOOR ' + (Math.round(A.y / H) + 3));
  const z = gap > 22 ? 'safe' : gap > 12 ? 'warn' : gap > 6 ? 'danger' : 'crit';
  if (z !== zone) {
    if (z === 'crit' && state === 'PLAYING') Sound.beep();
    zone = z; el.hud.className = 'z-' + z; setText('zone', el.chip, ZN[z]); el.warn.classList.toggle('on', z === 'crit');
  }
  el.fill.style.width = (clamp(gap / 40, 0.02, 1) * 100).toFixed(1) + '%';
  const sh = z === 'danger' ? 0.8 : z === 'crit' ? 1.8 : 0;
  el.panel.style.transform = sh ? 'translate(' + ((Math.random() - 0.5) * sh * 2).toFixed(1) + 'px,' + ((Math.random() - 0.5) * sh * 2).toFixed(1) + 'px)' : '';
  el.rf.style.transform = 'scaleX(' + clamp(vP / VMAX, 0, 1).toFixed(3) + ')';
  const bpm = lerp(60, 150, threatS), pulse = 1 + 0.12 * Math.sin(t * bpm / 60 * Math.PI * 2);
  el.red.style.opacity = (threatS * 0.5 * pulse).toFixed(3);
  el.vig.style.opacity = clamp(threatS * pulse, 0, 1).toFixed(3);
}

/* ===== Game flow ===== */
function worldReset() {
  Level.reset(); Level.init();
  sP = START_S; vP = vT = 0; sM = START_S - GAP0; tGame = 0; lunge = 0; lungeCD = rnd(18, 26); glance = null; glanceCD = rnd(5, 8); yawOff = 0;
  threatS = ampS = bobPhase = yaw = pitch = 0; snap = true; stepIdx = mStepIdx = 0; mPh = 0; msNow = 3.4; zone = 'x'; Monster.root.visible = false;
}
function showMenu() {
  worldReset(); state = 'MENU';
  $('bestMenu').textContent = best; show('menu', true); show('pause', false); show('over', false); el.hud.style.visibility = 'hidden';
  Sound.update(0, 0, 0, 1, false);
}
function startGame() {
  Sound.init(); worldReset();
  state = 'PLAYING'; show('menu', false); show('pause', false); show('over', false);
  el.hud.style.visibility = 'visible'; el.hint.style.opacity = 1; el.warn.classList.remove('on');
  if (!Flashlight.on) toggleFlash();
}
function pauseGame() { state = 'PAUSED'; show('pause', true); Sound.suspend(); Input.held.clear(); btnRun.classList.remove('down'); }
function resumeGame() { if (state !== 'PAUSED') return; show('pause', false); state = 'PLAYING'; Sound.resume(); }
function onCaught() {
  state = 'GAMEOVER'; overT = 0; overShown = false; overSide = chance(0.5) ? 1 : -1; vT = 0; glance = null;
  Sound.caught(); el.warn.classList.remove('on');
}
function showOver(dist) {
  const d = Math.floor(dist); const nb = d > best;
  if (nb) { best = d; Store.set('br_best', String(best)); }
  $('overDist').textContent = d; $('overBest').textContent = (nb ? 'NEW BEST ' : 'BEST ') + best + ' m';
  show('over', true); el.hud.style.visibility = 'hidden';
}

/* ===== Simulation ===== */
function threatFromGap(g) {
  const K = [[28, 0], [22, 0.08], [14, 0.2], [9, 0.35], [6, 0.5], [3, 0.65], [CATCH, 0.8]];
  if (g >= K[0][0]) return 0;
  for (let i = 1; i < K.length; i++) if (g >= K[i][0]) return lerp(K[i][1], K[i - 1][1], (g - K[i][0]) / (K[i - 1][0] - K[i][0]));
  return 0.8;
}
function simulate(dt) {
  tGame += dt;
  const held = Input.held.size > 0 || Input.key;
  vT = Math.max(0, vT - (0.9 + 0.28 * vT) * dt);                  // decay when not pressing
  if (Input.taps > 0) { vT = Math.min(VMAX, vT + TAP * Math.min(Input.taps, 3)); vP = Math.min(VMAX, vP + 0.5); Input.taps = 0; }
  if (held && vT < HOLD_CAP) vT = Math.min(HOLD_CAP, vT + HOLD * dt);
  vP = damp(vP, vT, vT > vP ? 4.5 : 2.4, dt);                     // smooth accel / decel
  sP += vP * dt;
  const dist = sP - START_S;
  if (tGame > GRACE) {                                            // monster is slow at first and speeds up with distance
    let ms = Math.min(MON_MAX, 3.4 + 0.0024 * dist);
    if (dist > 220) {
      lungeCD -= dt;
      if (lunge <= 0 && lungeCD <= 0) { lunge = 2.6; lungeCD = rnd(16, 28); Sound.roar(); glanceCD = Math.min(glanceCD, 0.2); }
    }
    if (lunge > 0) { lunge -= dt; ms *= 1 + 0.45 * Math.min(1, (2.6 - lunge) / 0.4) * Math.min(1, lunge / 0.6); }
    const g0 = sP - sM; if (g0 > 50) ms *= 1 + (g0 - 50) * 0.06;  // rubber band so the pressure never disappears
    msNow = ms; sM += ms * dt;
  }
  const gap = sP - sM;
  if (gap <= CATCH) { onCaught(); return; }
  threatS = damp(threatS, threatFromGap(gap), 5, dt);
  Level.ensure(sP, sM, clamp(dist / 2800, 0, 1));
  // glance back: briefly turn the head so the player can see the monster in the flashlight
  glanceCD -= dt;
  if (!glance && glanceCD <= 0 && gap < 24 && gap > 3 && Math.abs(yawErr) < 0.12) glance = { t: 0, dur: 1.15, side: chance(0.5) ? 1 : -1 };
  if (glance) {
    glance.t += dt; yawOff = glance.side * 2.5 * Math.sin(Math.PI * glance.t / glance.dur);
    if (glance.t >= glance.dur) { glance = null; yawOff = 0; glanceCD = gap < 8 ? rnd(4, 7) : rnd(7, 12); }
  }
  if (dist > 25 && vP > 6) el.hint.style.opacity = 0; else if (tGame > 8) el.hint.style.opacity = 0;
  updateHud(gap, dist, tGame);
  Lighting.update(dt, dist, threatS);
  const sn = clamp(vP / VMAX, 0, 1);
  Sound.update(dt, sn, threatS, Lighting.level, true);
  const si = Math.floor(bobPhase / Math.PI);
  if (si !== stepIdx) { stepIdx = si; if (vP > 0.8) Sound.step(sn); }
  mPh += dt * msNow * 0.6; const mi = Math.floor(mPh / Math.PI);
  if (mi !== mStepIdx) { mStepIdx = mi; if (gap < 30 && tGame > GRACE) Sound.mstep(threatS); }
}
function overSim(dt) {
  overT += dt; vP = damp(vP, 0, 6, dt); sP += vP * dt;
  sM = Math.min(sM + 16 * dt, sP - 0.55);
  yawOff = damp(yawOff, overSide * 2.9, 9, dt);
  threatS = damp(threatS, 1, 8, dt);
  const dist = sP - START_S;
  updateHud(0, dist, overT);
  Sound.update(dt, 0, 1, 1, false);
  if (!overShown && overT > 1.3) { overShown = true; showOver(dist); }
}

/* ===== Camera: auto-follow, head bob, shake ===== */
const nz = (x, s) => (Math.sin(x + s * 12.3) + 0.5 * Math.sin(x * 2.31 + s * 5.1) + 0.25 * Math.sin(x * 4.7 + s * 9.7)) / 1.75;
function updateCamera(dt, t, moving) {
  Level.sample(sP, A, curP); Level.sample(sP + 3.2, B, curLA);
  const dx = B.x - A.x, dz = B.z - A.z, hl = Math.hypot(dx, dz);
  if (hl > 1e-3) {
    const ty = Math.atan2(-dx, -dz); yawErr = angDiff(yaw, ty);
    yaw = snap ? ty : yaw + yawErr * (1 - Math.exp(-8 * dt));      // smooth automatic turning
  }
  pitch = damp(pitch, snap ? 0 : Math.atan2(B.y - A.y, Math.max(hl, 0.01)) * 0.55, 5, dt);
  const sn = clamp(vP / VMAX, 0, 1); ampS = damp(ampS, sn, 3.2, dt);
  if (vP > 0.05) bobPhase += Math.PI * (1.4 + 0.24 * vP) * dt;
  const bobA = 0.01 + 0.05 * ampS, swayA = 0.008 + 0.03 * ampS;
  const sh = 0.0025 + 0.01 * ampS + 0.035 * threatS * threatS, f = (7 + 8 * threatS) * t;   // shake grows with speed and danger
  const n1 = nz(f, 1), n2 = nz(f * 1.13, 2), n3 = nz(f * 0.9, 3);
  const by = Math.cos(bobPhase * 2) * bobA, bx = Math.sin(bobPhase) * swayA;
  camY = snap ? A.y + EYE : damp(camY, A.y + EYE, 12, dt);
  const rx = Math.cos(yaw), rz = -Math.sin(yaw), lat = bx + n1 * sh;
  camera.position.set(A.x + rx * lat, camY + by + n2 * sh * 0.8, A.z + rz * lat);
  camera.rotation.y = yaw + yawOff + n3 * sh * 1.1;
  camera.rotation.x = pitch + Math.sin(bobPhase * 2 + 0.7) * 0.004 * (0.5 + ampS * 2) + n2 * sh * 1.2;
  camera.rotation.z = Math.sin(bobPhase) * (0.003 + 0.015 * ampS) + n1 * sh * 1.2;
  const fov = camera.userData.baseFov + 4 * ampS + 3 * threatS;
  if (Math.abs(fov - camera.fov) > 0.02) { camera.fov = fov; camera.updateProjectionMatrix(); }
  Flashlight.root.position.set(0.2 + bx * 0.5, -0.22 + by * 0.6, -0.45);
  snap = false;
  // monster placement
  const gap = sP - sM;
  Monster.root.visible = state !== 'MENU' && gap < 40;
  if (Monster.root.visible) {
    Level.sample(sM, A, curM); Level.sample(sM + 3, B, curML);
    Monster.root.position.set(A.x, A.y, A.z);
    const ty = Math.atan2(B.x - A.x, B.z - A.z); mYaw += angDiff(mYaw, ty) * (1 - Math.exp(-10 * dt));
    Monster.root.rotation.y = mYaw;
    if (moving) Monster.update(dt, msNow, t, smooth(25, 3, gap));
    Level.sample(sP, A, curP);
  }
  Level.cull(camera.position);
}

/* ===== Main loop ===== */
let lastT = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const raw = Math.min((now - lastT) / 1000, 0.25); lastT = now;
  const dt = Math.min(raw, 0.05), t = now / 1000;
  if (state === 'PLAYING') { simulate(dt); }
  else if (state === 'GAMEOVER') overSim(dt);
  else if (state === 'MENU') { Input.taps = 0; Lighting.update(dt, 0, 0); }
  if (state !== 'PAUSED') updateCamera(dt, t, state !== 'MENU');
  Perf.tick(raw);
  renderer.render(scene, camera);
}

/* ===== Boot ===== */
Flashlight.set(true);
setQMode(qMode);
showMenu();
requestAnimationFrame(frame);
