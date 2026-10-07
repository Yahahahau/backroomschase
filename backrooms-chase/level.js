'use strict';
/* ===== Procedural level =====
   Grid of 4x4 cells. A "piece" is a list of ops (F forward, T turn, room) planned on the grid,
   validated against occupied cells (with a 1-cell margin), then committed and turned into
   merged geometry. Walls are drawn on every cell edge that is not explicitly linked, so
   there are never gaps or holes. The heading can only be N/E/W (never back south), which
   makes self-intersection impossible in practice; the margin check handles the rest. */
const Level = (function () {
  const grid = new Map(), chunks = [], cursors = [];
  const P = { x: [], y: [], z: [], s: [] };                         // dense centre-line path
  let last = null, deferred = null, heading = 0, bal = 0, yy = 0, ord = 0, gid = 1;
  let pieceNo = 0, prevKind = '', pendCell = null, df = 0;
  const root = new THREE.Group(); scene.add(root);

  /* ---- instanced props (light panels, pillars) ---- */
  function Pool(geo, mat, cap, shadow) {
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.frustumCulled = false; mesh.count = 0; mesh.castShadow = shadow; scene.add(mesh);
    const free = [], zero = new THREE.Matrix4().makeScale(0, 0, 0); let top = 0;
    return {
      add(m) { let i = free.length ? free.pop() : top++; if (i >= cap) i = cap - 1; mesh.setMatrixAt(i, m); mesh.count = Math.max(mesh.count, i + 1); mesh.instanceMatrix.needsUpdate = true; return i; },
      remove(i) { mesh.setMatrixAt(i, zero); free.push(i); mesh.instanceMatrix.needsUpdate = true; },
      reset() { free.length = 0; top = 0; mesh.count = 0; }
    };
  }
  const panelGeo = new THREE.PlaneGeometry(1.2, 2.4); panelGeo.rotateX(Math.PI / 2);     // faces down
  const pillarGeo = new THREE.BoxGeometry(1, H, 1); pillarGeo.translate(0, H / 2, 0);
  const panels = Pool(panelGeo, Mats.panel, 500, false);
  const pillars = Pool(pillarGeo, Mats.pillar, 160, true);
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  function inst(pool, x, y, z, rotY, sx) {
    _p.set(x, y, z); _q.setFromAxisAngle(UP, rotY); _s.set(sx, 1, sx); _m.compose(_p, _q, _s); return pool.add(_m);
  }

  /* ---- geometry helpers ---- */
  const mkList = sc => ({ p: [], n: [], u: [], sc });
  // quad a,b,c,d (planar); winding is auto-flipped so the face looks toward hint (hx,hy,hz)
  function quad(L, a, b, c, d, hx, hy, hz) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    if (nx * hx + ny * hy + nz * hz < 0) { const t = b; b = d; d = t; nx = -nx; ny = -ny; nz = -nz; }
    const vs = [a, b, c, d], ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const v = vs[i]; L.p.push(v[0], v[1], v[2]); L.n.push(nx, ny, nz);
      let u, w;
      if (ay >= ax && ay >= az) { u = v[0]; w = v[2]; } else if (ax >= az) { u = v[2]; w = v[1]; } else { u = v[0]; w = v[1]; }
      L.u.push(u / L.sc, w / L.sc);
    }
  }
  function addFlat(c, Ls) {
    const x = c.i * C, z = c.j * C, y = c.y0, h = HALF;
    quad(Ls.floor, [x - h, y, z - h], [x + h, y, z - h], [x + h, y, z + h], [x - h, y, z + h], 0, 1, 0);
    quad(Ls.ceil, [x - h, y + H, z - h], [x + h, y + H, z - h], [x + h, y + H, z + h], [x - h, y + H, z + h], 0, -1, 0);
    for (let d = 0; d < 4; d++) {
      if (c.open[d]) continue;
      const o = (c.narrow && (d & 1) !== c.axis) ? NH : h;           // narrow cells pull their side walls inward
      const ex = x + DX[d] * o, ez = z + DZ[d] * o, px = -DZ[d], pz = DX[d];
      quad(Ls.wall, [ex - px * h, y, ez - pz * h], [ex + px * h, y, ez + pz * h], [ex + px * h, y + H, ez + pz * h], [ex - px * h, y + H, ez - pz * h], -DX[d], 0, -DZ[d]);
    }
    if (c.narrow) for (const e of [c.capB ? (c.d + 2) & 3 : -1, c.capF ? c.d : -1]) {   // close the gap between narrow and wide cells
      if (e < 0) continue;
      const ex = x + DX[e] * h, ez = z + DZ[e] * h, px = -DZ[e], pz = DX[e];
      for (const s of [-1, 1]) {
        const a0 = NH * s, a1 = h * s;
        quad(Ls.wall, [ex + px * a0, y, ez + pz * a0], [ex + px * a1, y, ez + pz * a1], [ex + px * a1, y + H, ez + pz * a1], [ex + px * a0, y + H, ez + pz * a0], DX[e], 0, DZ[e]);
      }
    }
  }
  function addStair(c, Ls) {                                          // 4 real steps per cell, sloped ceiling and walls
    const x = c.i * C, z = c.j * C, d = c.d, r = (d + 1) & 3, fx = DX[d], fz = DZ[d], rx = DX[r], rz = DZ[r];
    const y0 = c.y0, y1 = c.y1, dy = y1 - y0, N = 4, h = HALF, up = dy > 0;
    const Pt = (t, s, y) => [x + fx * (t - 0.5) * C + rx * s, y, z + fz * (t - 0.5) * C + rz * s];
    const rh = up ? -1 : 1;
    for (let k = 0; k < N; k++) {
      const t0 = k / N, t1 = (k + 1) / N, ym = y0 + dy * (k + 0.5) / N, prev = k === 0 ? y0 : y0 + dy * (k - 0.5) / N;
      quad(Ls.floor, Pt(t0, -h, ym), Pt(t1, -h, ym), Pt(t1, h, ym), Pt(t0, h, ym), 0, 1, 0);
      quad(Ls.floor, Pt(t0, -h, prev), Pt(t0, h, prev), Pt(t0, h, ym), Pt(t0, -h, ym), fx * rh, 0, fz * rh);
    }
    quad(Ls.floor, Pt(1, -h, y0 + dy * (N - 0.5) / N), Pt(1, h, y0 + dy * (N - 0.5) / N), Pt(1, h, y1), Pt(1, -h, y1), fx * rh, 0, fz * rh);
    for (const s of [-1, 1])
      quad(Ls.wall, Pt(0, s * h, y0 - 0.6), Pt(1, s * h, y1 - 0.6), Pt(1, s * h, y1 + H), Pt(0, s * h, y0 + H), -rx * s, 0, -rz * s);
    quad(Ls.ceil, Pt(0, -h, y0 + H), Pt(1, -h, y1 + H), Pt(1, h, y1 + H), Pt(0, h, y0 + H), 0, -1, 0);
  }
  function buildChunk(list) {
    const Ls = { floor: mkList(2), wall: mkList(3), ceil: mkList(2) };
    const ch = { meshes: [], props: [], cells: list, endS: P.s.length ? P.s[P.s.length - 1] + C : 0, cx: 0, cz: 0, r: 0 };
    for (const c of list) {
      const x = c.i * C, z = c.j * C;
      if (c.kind === 'stair') addStair(c, Ls); else addFlat(c, Ls);
      ch.cx += x; ch.cz += z;
      if (c.light && c.kind === 'flat') ch.props.push([panels, inst(panels, x, c.y0 + H - 0.02, z, c.axis ? Math.PI / 2 : 0, 1)]);
      if (c.pil) ch.props.push([pillars, inst(pillars, x, c.y0, z, 0, 1.1)]);
      if (c.col) {
        const r = (c.d + 1) & 3, o = HALF - 0.4;
        ch.props.push([pillars, inst(pillars, x + DX[r] * c.col * o, c.y0, z + DZ[r] * c.col * o, 0, 0.8)]);
      }
    }
    if (list.length) { ch.cx /= list.length; ch.cz /= list.length; }
    for (const c of list) ch.r = Math.max(ch.r, Math.hypot(c.i * C - ch.cx, c.j * C - ch.cz));
    ch.r += 3;
    const mats = { floor: Mats.floor, wall: Mats.wall, ceil: Mats.ceil };
    for (const k in Ls) {
      const L = Ls[k]; if (!L.p.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(L.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(L.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(L.u, 2));
      const m = new THREE.Mesh(g, mats[k]); m.receiveShadow = true; m.matrixAutoUpdate = false;
      root.add(m); ch.meshes.push(m);
    }
    chunks.push(ch);
  }
  function dropChunk(ch) {
    for (const m of ch.meshes) { root.remove(m); m.geometry.dispose(); }
    for (const [pool, i] of ch.props) pool.remove(i);
    for (const c of ch.cells) grid.delete(c.i + ',' + c.j);
  }

  /* ---- centre-line path (what player and monster follow) ---- */
  function addPt(x, y, z) {
    const n = P.x.length; let s = 0;
    if (n) s = P.s[n - 1] + Math.hypot(x - P.x[n - 1], y - P.y[n - 1], z - P.z[n - 1]);
    P.x.push(x); P.y.push(y); P.z.push(z); P.s.push(s);
  }
  function emit(c, next) {
    const x = c.i * C, z = c.j * C;
    if (c.kind === 'stair') { addPt(x - DX[c.d] * HALF, c.y0, z - DZ[c.d] * HALF); addPt(x + DX[c.d] * HALF, c.y1, z + DZ[c.d] * HALF); return; }
    const din = c.d, dout = next.d;
    if (din === dout) { addPt(x, c.y0, z); return; }
    const ax = x - DX[din] * HALF, az = z - DZ[din] * HALF, bx = x + DX[dout] * HALF, bz = z + DZ[dout] * HALF;   // rounded corner
    for (let k = 0; k <= 6; k++) { const t = k / 6, u = 1 - t; addPt(u * u * ax + 2 * u * t * x + t * t * bx, c.y0, u * u * az + 2 * u * t * z + t * t * bz); }
  }

  /* ---- planning ---- */
  const mkCell = (i, j, d, o) => ({ i, j, d, ord: o, axis: d & 1, kind: 'flat', y0: 0, y1: 0, open: [false, false, false, false], narrow: false, capB: false, capF: false, light: false, col: 0, pil: false, grp: 0 });
  const F = (n, extra) => Object.assign({ t: 'F', n }, extra), T = dir => ({ t: 'T', dir });
  function plan(ops, force) {
    let d = heading, b = bal, y = yy, od = ord, cur = last;
    const pm = new Map(), cells = [], chain = [], links = [];
    const ok = (i, j, o, g) => {
      if (force) return !grid.has(i + ',' + j) && !pm.has(i + ',' + j);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const n = grid.get((i + dx) + ',' + (j + dz)) || pm.get((i + dx) + ',' + (j + dz));
        if (!n) continue;
        if (dx === 0 && dz === 0) return false;
        if (g && n.grp === g) continue;
        if (Math.abs(n.ord - o) <= 2) continue;               // consecutive path cells may touch
        return false;
      }
      return true;
    };
    const add = c => { pm.set(c.i + ',' + c.j, c); cells.push(c); };
    const lk = (a, c, dd) => { links.push([a, c, dd]); if (a !== last) a.open[dd] = true; c.open[(dd + 2) & 3] = true; };
    for (const op of ops) {
      if (op.t === 'T') { b += op.dir; if (Math.abs(b) > 1) return null; d = (d + op.dir + 4) & 3; }
      else if (op.t === 'F') {
        for (let k = 0; k < op.n; k++) {
          const i = cur.i + DX[d], j = cur.j + DZ[d]; od++;
          if (!ok(i, j, od, 0)) return null;
          const c = mkCell(i, j, d, od);
          if (op.stair) { c.kind = 'stair'; c.y0 = y + op.dy * k / op.n; c.y1 = y + op.dy * (k + 1) / op.n; }
          else {
            c.y0 = c.y1 = y;
            if (((i + j) & 1) === 0) c.light = true;
            if (op.narrow) { c.narrow = true; c.capB = k === 0; c.capF = k === op.n - 1; }
            else if (k < op.n - 1 && op.n >= 3 && Math.random() < 0.15 + df * 0.1) c.col = chance(0.5) ? 1 : -1;   // wall-hugging column
          }
          add(c); lk(cur, c, d); chain.push(c); cur = c;
        }
        if (op.stair) y += op.dy;
      }
      else if (op.t === 'room') {
        const half = (op.w - 1) >> 1, f = d, r = (d + 1) & 3, g = gid++, bi = cur.i, bj = cur.j, rows = [];
        for (let k = 0; k < op.l; k++) {
          od++; const row = {};
          for (let c = -half; c <= half; c++) {
            const i = bi + DX[f] * (k + 1) + DX[r] * c, j = bj + DZ[f] * (k + 1) + DZ[r] * c;
            if (!ok(i, j, od, g)) return null;
            const cell = mkCell(i, j, f, od); cell.y0 = cell.y1 = y; cell.grp = g;
            if (((i + j) & 1) === 0) { cell.light = true; if (c !== 0 && op.pillars && Math.random() < 0.75) cell.pil = true; }
            add(cell); row[c] = cell;
          }
          rows.push(row);
        }
        for (let k = 0; k < op.l; k++) for (let c = -half; c <= half; c++) {
          if (c < half) lk(rows[k][c], rows[k][c + 1], r);
          if (k < op.l - 1) lk(rows[k][c], rows[k + 1][c], f);
        }
        lk(cur, rows[0][0], f);
        for (let k = 0; k < op.l; k++) chain.push(rows[k][0]);
        cur = rows[op.l - 1][0];
      }
    }
    return chain.length ? { cells, chain, links, d, b, y, ord: od } : null;
  }
  function commit(p) {
    for (const [a, c, dd] of p.links) { a.open[dd] = true; c.open[(dd + 2) & 3] = true; }
    for (const c of p.cells) grid.set(c.i + ',' + c.j, c);
    const nl = p.chain[p.chain.length - 1], list = deferred ? [deferred] : [];   // the last cell is built with the next piece (its exit edge is not known yet)
    for (const c of p.cells) if (c !== nl) list.push(c);
    for (const c of p.chain) { if (pendCell) emit(pendCell, c); pendCell = c; }
    buildChunk(list);
    deferred = last = nl; heading = p.d; bal = p.b; yy = p.y; ord = p.ord;
  }

  /* ---- piece catalogue ---- */
  const PIECES = {
    straight: () => [F(rint(3, 5))],
    long: () => [F(rint(7, 11))],
    left: () => [F(rint(1, 2)), T(-1), F(rint(2, 4))],
    right: () => [F(rint(1, 2)), T(1), F(rint(2, 4))],
    LR: () => [F(1), T(-1), F(rint(2, 3)), T(1), F(rint(2, 3))],
    RL: () => [F(1), T(1), F(rint(2, 3)), T(-1), F(rint(2, 3))],
    zig: () => { const s = chance(0.5) ? 1 : -1, o = [F(1)]; for (let k = rint(2, 3); k > 0; k--) o.push(T(s), F(rint(2, 3)), T(-s), F(rint(2, 3))); return o; },
    narrow: () => [F(2), F(rint(3, 6), { narrow: true }), F(1)],
    room: () => [F(1), { t: 'room', w: chance(0.5) ? 3 : 5, l: rint(3, 5), pillars: true }, F(1)],
    stairUp: () => [F(1), F(3, { stair: true, dy: H }), F(2)],
    stairDown: () => [F(1), F(3, { stair: true, dy: -H }), F(2)]
  };
  const KINDS = [['straight', 3, 0], ['long', 2, 0], ['left', 3, 0], ['right', 3, 0], ['LR', 1.4, 0.06], ['RL', 1.4, 0.06],
    ['room', 1.5, 0.05], ['narrow', 1.3, 0.1], ['stairUp', 1.5, 0.08], ['stairDown', 1.5, 0.08], ['zig', 1.4, 0.18]];
  const FORCED = ['straight', 'right', 'straight', 'left'];
  function order() {
    const rel = Math.round(yy / H), pool = [];
    for (const [k, w0, min] of KINDS) {
      if (df < min) continue;
      let w = w0 * ((k === 'straight' || k === 'long') ? 1 - 0.65 * df : 0.7 + 0.9 * df);
      if (k.startsWith('stair')) {                                  // keep floors within [-2, 5], no stairs back to back
        if (prevKind.startsWith('stair')) continue;
        if (k === 'stairUp' && rel >= 5) continue;
        if (k === 'stairDown' && rel <= -2) continue;
        if (k === 'stairUp' && rel <= -2) w *= 3;
        if (k === 'stairDown' && rel >= 5) w *= 3;
      }
      if (k === prevKind) w *= 0.3;
      pool.push([k, w]);
    }
    const out = [];
    if (pieceNo < FORCED.length) out.push(FORCED[pieceNo]);
    while (pool.length) {
      let tot = 0; for (const e of pool) tot += e[1];
      let r = Math.random() * tot, i = 0;
      while (i < pool.length - 1 && r > pool[i][1]) { r -= pool[i][1]; i++; }
      out.push(pool[i][0]); pool.splice(i, 1);
    }
    return out;
  }
  function genPiece() {
    for (const k of order()) {
      const p = plan(PIECES[k]());
      if (p) { commit(p); prevKind = k; pieceNo++; return; }
    }
    const back = heading === 0 ? [F(2)] : [T(heading === 1 ? -1 : 1), F(2)];     // always-valid fallback: head north again
    let p = plan(back) || plan([F(2)], true) || plan([F(1)], true);
    if (p) { commit(p); prevKind = 'fb'; pieceNo++; }
  }

  /* ---- public API ---- */
  return {
    cursor() { const c = { k: 0 }; cursors.push(c); return c; },
    reset() {
      for (const ch of chunks) dropChunk(ch);
      chunks.length = 0; grid.clear(); panels.reset(); pillars.reset();
      P.x.length = P.y.length = P.z.length = P.s.length = 0;
      cursors.forEach(c => c.k = 0);
      pendCell = deferred = last = null; heading = bal = yy = ord = 0; pieceNo = 0; prevKind = ''; df = 0;
    },
    init() {
      const seed = mkCell(0, 0, 0, 0); grid.set('0,0', seed);
      last = deferred = pendCell = seed;
      const p = plan([F(12)]); commit(p);
      while (P.s[P.s.length - 1] < START_S + Q.ahead) genPiece();
    },
    ensure(sP, sM, difficulty) {
      df = difficulty;
      for (let n = 0; n < 2 && P.s[P.s.length - 1] - sP < Q.ahead; n++) genPiece();
      while (chunks.length > 1 && chunks[0].endS < sM - 35) dropChunk(chunks.shift());
      let k = 0; while (k < P.s.length - 2 && P.s[k + 1] < sM - 45) k++;
      if (k > 60) { P.x.splice(0, k); P.y.splice(0, k); P.z.splice(0, k); P.s.splice(0, k); cursors.forEach(c => c.k = Math.max(0, c.k - k)); }
    },
    cull(cam) {                                                       // hide chunks beyond the view distance
      for (const ch of chunks) {
        const v = Math.hypot(cam.x - ch.cx, cam.z - ch.cz) - ch.r < Q.cull;
        for (const m of ch.meshes) m.visible = v;
      }
    },
    sample(s, out, cur) {
      const n = P.s.length;
      if (n < 2) { out.x = P.x[0] || 0; out.y = P.y[0] || 0; out.z = P.z[0] || 0; return; }
      let k = clamp(cur.k, 0, n - 2);
      while (k < n - 2 && P.s[k + 1] < s) k++;
      while (k > 0 && P.s[k] > s) k--;
      const len = P.s[k + 1] - P.s[k], t = len > 1e-6 ? clamp((s - P.s[k]) / len, 0, 1) : 0;
      out.x = P.x[k] + (P.x[k + 1] - P.x[k]) * t; out.y = P.y[k] + (P.y[k + 1] - P.y[k]) * t; out.z = P.z[k] + (P.z[k + 1] - P.z[k]) * t;
      cur.k = k;
    },
    get chunkCount() { return chunks.length; },
    get end() { return P.s[P.s.length - 1]; },
    path: P
  };
})();
