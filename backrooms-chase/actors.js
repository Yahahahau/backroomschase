'use strict';
/* ===== Flashlight: model + visible beam cone (the SpotLight itself lives in core.js) ===== */
const Flashlight = (function () {
  const root = new THREE.Group(); root.position.set(0.2, -0.22, -0.45); root.rotation.y = 0.07; camera.add(root);
  const metal = new THREE.MeshLambertMaterial({ color: 0x555555, emissive: 0x1e1e1e });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.2, 10), metal); body.rotation.x = Math.PI / 2; body.position.z = 0.1; root.add(body);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.032, 0.07, 12), metal); head.rotation.x = Math.PI / 2; head.position.z = -0.03; root.add(head);
  const lensMat = new THREE.MeshBasicMaterial({ color: 0xfff3c0 });
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.04, 12), lensMat); lens.position.z = -0.066; lens.rotation.y = Math.PI; root.add(lens);
  const LEN = 16, ang = 0.4;
  const geo = new THREE.ConeGeometry(LEN * Math.tan(ang), LEN, 24, 1, true); geo.translate(0, -LEN / 2, 0); geo.rotateX(Math.PI / 2);   // apex at origin, opens toward -z
  const beam = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { k: { value: 0.2 } },
    vertexShader: 'varying vec3 vN;varying vec3 vV;varying float vT;void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);vN=normalize(normalMatrix*normal);vV=normalize(-mv.xyz);vT=clamp(-position.z/' + LEN.toFixed(1) + ',0.0,1.0);gl_Position=projectionMatrix*mv;}',
    fragmentShader: 'uniform float k;varying vec3 vN;varying vec3 vV;varying float vT;void main(){float f=abs(dot(normalize(vN),normalize(vV)));float a=pow(f,1.6)*pow(1.0-vT,1.4)*smoothstep(0.0,0.08,vT)*k;gl_FragColor=vec4(vec3(1.0,0.95,0.7)*a,a);}'
  }));
  beam.renderOrder = 10; beam.frustumCulled = false; root.add(beam);
  let on = true;
  return {
    root,
    get on() { return on; },
    set(v) { on = v; spot.visible = v; beam.visible = v; lensMat.color.setHex(v ? 0xfff3c0 : 0x554f3c); },
    toggle() { this.set(!on); return on; }
  };
})();

/* ===== Lighting: darkness grows with distance, fluorescent flicker ===== */
const Lighting = (function () {
  let timer = rnd(3, 6), dur = 0, f = 1, spotBase = spot.intensity;
  return {
    level: 1,
    update(dt, dist, threat) {
      const dark = smooth(300, 3500, dist) * 0.35;                    // lights slowly dim the farther you run
      if (dur > 0) { dur -= dt; f = dur > 0 ? rnd(0.15, 0.75) : 1; }
      else { timer -= dt; if (timer <= 0) { dur = rnd(0.08, 0.3); timer = rnd(4, 11) / (1 + dark * 3 + threat * 2); } }
      this.level = f;
      hemi.intensity = 0.62 * (1 - dark) * (0.55 + 0.45 * f);
      const k = (1 - dark * 0.6) * (0.35 + 0.65 * f);
      Mats.panel.color.setRGB(0.9 * k, 1.0 * k, 0.82 * k);
      spot.intensity = spotBase * (threat > 0.5 && chance(0.04) ? 0.55 : 1);
    }
  };
})();

/* ===== Monster: procedural pale long-limbed runner (faces +Z in local space) ===== */
const Monster = (function () {
  const root = new THREE.Group(), rig = new THREE.Group(); root.add(rig); scene.add(root);
  const skin = new THREE.MeshLambertMaterial({ color: 0x9b9078, emissive: 0x1d1812 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x0a0806 });
  const eyeM = new THREE.MeshBasicMaterial({ color: 0xfff2c8 });
  const teeth = new THREE.MeshBasicMaterial({ color: 0xe8e4d4 });
  const put = (geo, mat, parent, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
  const grp = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };

  const torso = grp(rig, 0, 1.1, 0);
  put(new THREE.CylinderGeometry(0.2, 0.14, 0.9, 8), skin, torso, 0, 0.45, 0);
  const neck = grp(torso, 0, 0.92, 0.02);
  put(new THREE.CylinderGeometry(0.05, 0.06, 0.28, 6), skin, neck, 0, 0.14, 0.02);
  const head = grp(neck, 0, 0.3, 0.05);
  const skull = put(new THREE.SphereGeometry(1, 10, 8), skin, head, 0, 0.14, 0); skull.scale.set(0.13, 0.19, 0.15);
  for (const s of [-1, 1]) {
    put(new THREE.SphereGeometry(0.045, 8, 6), dark, head, s * 0.055, 0.17, 0.095);
    put(new THREE.SphereGeometry(0.022, 8, 6), eyeM, head, s * 0.055, 0.17, 0.128);
  }
  put(new THREE.BoxGeometry(0.12, 0.1, 0.05), dark, head, 0, 0.06, 0.125);
  for (let i = -2; i <= 2; i++) { put(new THREE.BoxGeometry(0.012, 0.03, 0.01), teeth, head, i * 0.023, 0.095, 0.15); put(new THREE.BoxGeometry(0.012, 0.025, 0.01), teeth, head, i * 0.023, 0.03, 0.15); }
  const arms = [], legs = [];
  for (const s of [-1, 1]) {
    const sh = grp(torso, s * 0.27, 0.85, 0);
    put(new THREE.CylinderGeometry(0.045, 0.035, 0.65, 6), skin, sh, 0, -0.325, 0);
    const el = grp(sh, 0, -0.65, 0);
    put(new THREE.CylinderGeometry(0.035, 0.025, 0.8, 6), skin, el, 0, -0.4, 0);
    for (let f = -1; f <= 1; f++) { const c = put(new THREE.ConeGeometry(0.014, 0.24, 5), dark, el, f * 0.026, -0.9, 0); c.rotation.x = Math.PI; }
    arms.push({ sh, el, s });
    const hip = grp(rig, s * 0.16, 1.1, 0);
    put(new THREE.CylinderGeometry(0.075, 0.055, 0.62, 6), skin, hip, 0, -0.31, 0);
    const kn = grp(hip, 0, -0.62, 0);
    put(new THREE.CylinderGeometry(0.05, 0.035, 0.62, 6), skin, kn, 0, -0.31, 0);
    put(new THREE.BoxGeometry(0.09, 0.05, 0.22), skin, kn, 0, -0.63, 0.07);
    legs.push({ hip, kn, s });
  }
  root.scale.setScalar(1.12);
  root.visible = false;
  let ph = 0;
  return {
    root, eyeM,
    update(dt, speed, t, reach) {
      ph += dt * (speed * 1.25 + 2.5);
      const sw = Math.sin(ph);
      for (const l of legs) { const q = Math.sin(ph + (l.s > 0 ? Math.PI : 0)); l.hip.rotation.x = -q * 0.95; l.kn.rotation.x = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(ph + (l.s > 0 ? Math.PI : 0) - 1.2)); }
      for (const a of arms) { const q = Math.sin(ph + (a.s > 0 ? 0 : Math.PI)); a.sh.rotation.x = -(0.7 + reach * 0.7) + q * 0.35; a.el.rotation.x = -0.45; }
      torso.rotation.x = 0.3; torso.rotation.z = sw * 0.06;
      head.rotation.z = Math.sin(t * 1.7) * 0.22; head.rotation.x = -0.15 + Math.sin(t * 2.3) * 0.05;
      rig.position.y = Math.abs(sw) * 0.07;
    }
  };
})();
