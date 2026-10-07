'use strict';
/* ===== Utils & config ===== */
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (c, t, l, dt) => c + (t - c) * (1 - Math.exp(-l * dt));
const rnd = (a, b) => a + Math.random() * (b - a);
const rint = (a, b) => Math.floor(rnd(a, b + 1));
const chance = p => Math.random() < p;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

const C = 4, HALF = 2, NH = 0.9, H = 3, EYE = 1.55;        // cell size, half, narrow half-width, ceiling height, eye height
const VMAX = 15, START_S = 32, GAP0 = 30, CATCH = 1.6;
const DX = [0, 1, 0, -1], DZ = [-1, 0, 1, 0];               // N E S W

const Store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
};
const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));

/* ===== Quality presets ===== */
const QUALITY = {
  low:    { label: 'LOW',    pr: 0.75, shadow: 512,  soft: false, fog: 0.07,  ahead: 62,  cull: 46, tex: 64,  fill: false },
  medium: { label: 'MEDIUM', pr: 1.0,  shadow: 1024, soft: false, fog: 0.055, ahead: 82,  cull: 60, tex: 128, fill: true },
  high:   { label: 'HIGH',   pr: 1.5,  shadow: 2048, soft: true,  fog: 0.046, ahead: 105, cull: 76, tex: 256, fill: true }
};
let Q = QUALITY.medium, qName = 'medium', prScale = 1;

/* ===== Renderer / scene / camera ===== */
let renderer;
try {
  if (typeof THREE === 'undefined') throw new Error('no three');
  renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: !isMobile, powerPreference: 'high-performance' });
} catch (e) { $('fatal').classList.remove('hide'); throw e; }
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setClearColor(0x120f07, 1);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x120f07);
scene.fog = new THREE.FogExp2(0x1a1609, 0.055);
const camera = new THREE.PerspectiveCamera(80, 1, 0.05, 100);
camera.rotation.order = 'YXZ';
scene.add(camera);

/* ===== Lights ===== */
const hemi = new THREE.HemisphereLight(0xfff0b0, 0x6a5a28, 0.62);
scene.add(hemi);
const fill = new THREE.PointLight(0xffe9a0, 0.5, 10, 2);          // soft glow around the player
fill.position.set(0, 0.2, 0.3); camera.add(fill);
const spot = new THREE.SpotLight(0xfff1cf, 2.6, 30, 0.42, 0.5, 1.4);   // flashlight
spot.position.set(0.12, -0.1, -0.25);
spot.castShadow = true;
spot.shadow.bias = -0.0006; spot.shadow.normalBias = 0.02;
spot.shadow.camera.near = 0.4; spot.shadow.camera.far = 26;
spot.target.position.set(0.02, 0, -8);
camera.add(spot); camera.add(spot.target);

/* ===== Procedural textures ===== */
function speckle(g, s, n, a) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,' + (a * Math.random()) + ')' : 'rgba(255,255,220,' + (a * Math.random()) + ')';
    g.fillRect(Math.random() * s, Math.random() * s, 1, 1);
  }
}
function stains(g, s, n, rgb, amax) {
  for (let i = 0; i < n; i++) {
    const x = Math.random() * s, y = Math.random() * s, r = s * (0.08 + Math.random() * 0.18);
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, 'rgba(' + rgb + ',' + (0.05 + Math.random() * amax) + ')'); rg.addColorStop(1, 'rgba(' + rgb + ',0)');
    g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}
function drawWall(g, s) {
  g.fillStyle = '#cdbb5c'; g.fillRect(0, 0, s, s);
  const n = 8, w = s / n;
  for (let i = 0; i < n; i++) {                                    // wallpaper stripes
    g.fillStyle = i % 2 ? 'rgba(110,90,20,0.10)' : 'rgba(255,245,170,0.12)'; g.fillRect(i * w, 0, w, s);
    g.fillStyle = 'rgba(90,70,10,0.22)'; g.fillRect(i * w, 0, Math.max(1, s / 96), s);
  }
  const gr = g.createLinearGradient(0, 0, 0, s);                   // grime near floor
  gr.addColorStop(0, 'rgba(60,45,5,0.10)'); gr.addColorStop(0.2, 'rgba(0,0,0,0)');
  gr.addColorStop(0.8, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(50,35,0,0.38)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  stains(g, s, 7, '88,60,12', 0.16);
  speckle(g, s, s * s / 5, 0.10);
}
function drawFloor(g, s) {
  g.fillStyle = '#8a7739'; g.fillRect(0, 0, s, s);
  speckle(g, s, s * s / 2, 0.22);
  g.fillStyle = 'rgba(0,0,0,0.05)';
  for (let i = 0; i < s; i += s / 16) { g.fillRect(0, i, s, 1); g.fillRect(i, 0, 1, s); }
  stains(g, s, 6, '50,30,5', 0.22);
}
function drawCeil(g, s) {
  g.fillStyle = '#cfc7a0'; g.fillRect(0, 0, s, s);
  g.strokeStyle = 'rgba(70,60,25,0.55)'; g.lineWidth = Math.max(2, s / 24); g.strokeRect(0, 0, s, s);
  g.fillStyle = 'rgba(60,50,20,0.25)';
  for (let i = 0; i < s * s / 90; i++) g.fillRect(Math.random() * s, Math.random() * s, 1, 1);
  stains(g, s, 3, '110,90,30', 0.14);
}
const Mats = {
  wall: new THREE.MeshLambertMaterial({ color: 0xffffff }),
  floor: new THREE.MeshLambertMaterial({ color: 0xffffff }),
  ceil: new THREE.MeshLambertMaterial({ color: 0xffffff }),
  pillar: new THREE.MeshLambertMaterial({ color: 0xffffff }),
  panel: new THREE.MeshBasicMaterial({ color: 0xe6ffd2 })
};
const Tex = {
  size: 0, all: [],
  build(size) {
    if (this.size === size) return;
    this.size = size; this.all.forEach(t => t.dispose()); this.all = [];
    const aniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    const mk = fn => {
      const c = document.createElement('canvas'); c.width = c.height = size; fn(c.getContext('2d'), size);
      const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; this.all.push(t); return t;
    };
    const wall = mk(drawWall);
    const pil = new THREE.CanvasTexture(wall.image); pil.wrapS = pil.wrapT = THREE.RepeatWrapping;
    pil.repeat.set(1 / 3, 1); pil.anisotropy = aniso; this.all.push(pil);
    const set = (m, t) => { m.map = t; m.needsUpdate = true; };
    set(Mats.wall, wall); set(Mats.floor, mk(drawFloor)); set(Mats.ceil, mk(drawCeil)); set(Mats.pillar, pil);
  }
};

/* ===== Quality / resize ===== */
function resize() {
  const w = window.innerWidth, h = window.innerHeight, a = w / h;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.pr) * prScale);
  renderer.setSize(w, h, false);
  camera.aspect = a;
  camera.userData.baseFov = clamp(2 * Math.atan(Math.tan(0.61) / a) * 180 / Math.PI, 62, 90);   // keep a decent horizontal FOV in portrait
  camera.fov = camera.userData.baseFov; camera.updateProjectionMatrix();
}
function applyQuality(name) {
  qName = name; Q = QUALITY[name];
  Tex.build(Q.tex);
  if (spot.shadow.mapSize.x !== Q.shadow) {
    spot.shadow.mapSize.set(Q.shadow, Q.shadow);
    if (spot.shadow.map) { spot.shadow.map.dispose(); spot.shadow.map = null; }
  }
  const type = Q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  if (renderer.shadowMap.type !== type) {
    renderer.shadowMap.type = type;
    scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  }
  scene.fog.density = Q.fog;
  fill.visible = Q.fill;
  resize();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));
