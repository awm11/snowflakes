// True 3D tab: grows the crystal with the 3D lattice model (sim3d) in a background thread,
// shows it in perspective (three.js) and as an orthographic top view of the same crystal.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const H = window.__snow, M3 = window.Snow3Sim;
const RMAX = 150, ZMAX = 150, STEP_T = 0.01;          // model seconds per step
const UM_PER_CELL = 15;                               // ~4.5 mm across at full size
const S3 = M3.makeSim3(RMAX, ZMAX);                   // lookup tables only (the worker does the growing)
const $ = id => document.getElementById(id);
const clamp = H.clamp, lerp = H.lerp;

const st = { T: -15, S: 0.3, running: true, done: false, auto: false, autoPh: [0, 0, 0, 0], autoT0: 0, autoFrom: null,
  journey: null, trail: [], mtime: 0, colour: 'ice', visible: false, steps: 0, Rc: 0.5, Hc: 0 };
let snap = null;           // latest crystal data from the worker
let gen = 0, busy = false, wantSnap = true, lastSnapT = 0, meshDirty = true, lastMeshT = 0, topDirty = true, diaDirty = true;

// ---------------- worker ----------------
const worker = new Worker(URL.createObjectURL(new Blob([$('sim3dSrc').textContent + `
  let S = null, gen = 0;
  onmessage = e => {
    const m = e.data;
    if (m.type === 'init') S = Snow3Sim.makeSim3(m.Rmax, m.Zmax);
    else if (m.type === 'reset') { gen = m.gen; Object.assign(S.params, m.params); Snow3Sim.reset3(S, m.params.rho); }
    else if (m.type === 'run') {
      if (m.gen !== gen) { postMessage({ type: 'stale' }); return; }
      Object.assign(S.params, m.params);
      const t0 = performance.now(); let n = 0;
      while (performance.now() - t0 < m.budget && n < m.max) { Snow3Sim.step3(S, m.T); n++; }
      const out = { type: 'done', gen, n, steps: S.steps, Rc: S.Rc, Hc: S.Hc };
      if (m.snap) {
        const nC = Snow3Sim.countR(S, S.Rc + 1.5), nz = Math.min(S.Zmax, S.Hc + 2), M2 = S.M2;
        const A = new Uint8Array(nC * nz), TA = new Uint8Array(nC * nz);
        for (let z = 0; z < nz; z++) for (let i = 0; i < nC; i++) { A[z * nC + i] = S.a[z * M2 + i]; TA[z * nC + i] = S.TA[z * M2 + i]; }
        Object.assign(out, { nC, nz, A, TA });
        postMessage(out, [A.buffer, TA.buffer]);
      } else postMessage(out);
    }
  };`], { type: 'text/javascript' })));
worker.postMessage({ type: 'init', Rmax: RMAX, Zmax: ZMAX });
worker.onmessage = e => {
  const m = e.data; busy = false;
  if (m.type !== 'done' || m.gen !== gen) return;
  st.steps = m.steps; st.Rc = m.Rc; st.Hc = m.Hc; st.mtime = m.steps * STEP_T;
  if (m.A) { snap = m; topDirty = true; meshDirty = true; }
  if (m.Rc >= RMAX * 0.93 || m.Hc >= ZMAX - 6) { st.done = true; wantSnap = true; }
};
function newCrystal() {
  gen++; userCam = false; st.done = false; st.steps = 0; st.mtime = 0; st.Rc = 0.5; st.Hc = 0; st.trail = []; snap = null;
  worker.postMessage({ type: 'reset', gen, params: M3.mapParams3(st.T, st.S) });
  busy = false; wantSnap = true; meshDirty = topDirty = diaDirty = true;
}

// ---------------- conditions: diagram + sliders ----------------
const dia = $('t3dDia'), dctx = dia.getContext('2d');
function drawDia() {
  dctx.clearRect(0, 0, dia.width, dia.height);
  dctx.drawImage(H.getDiagramBase(), 0, 0);
  const tr = st.trail;
  dctx.lineWidth = 2.5; dctx.lineCap = 'round';
  for (let i = 1; i < tr.length; i++) {
    const c = H.tColor(tr[i].T);
    dctx.strokeStyle = `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${0.35 + 0.65 * i / tr.length})`;
    dctx.beginPath(); dctx.moveTo(H.xOf(tr[i - 1].T), H.yOf(tr[i - 1].S)); dctx.lineTo(H.xOf(tr[i].T), H.yOf(tr[i].S)); dctx.stroke();
  }
  const X = H.xOf(st.T), Y = H.yOf(st.S);
  dctx.strokeStyle = 'rgba(124,196,255,.45)'; dctx.setLineDash([3, 4]); dctx.lineWidth = 1;
  dctx.beginPath(); dctx.moveTo(X, Y); dctx.lineTo(X, H.yOf(0)); dctx.stroke();
  dctx.strokeStyle = 'rgba(255,210,124,.45)'; dctx.beginPath(); dctx.moveTo(X, Y); dctx.lineTo(H.xOf(0), Y); dctx.stroke(); dctx.setLineDash([]);
  dctx.beginPath(); dctx.arc(X, Y, 10, 0, Math.PI * 2); dctx.fillStyle = 'rgba(255,255,255,.18)'; dctx.fill();
  dctx.beginPath(); dctx.arc(X, Y, 6.5, 0, Math.PI * 2); dctx.fillStyle = '#fff'; dctx.fill(); dctx.lineWidth = 2.5; dctx.strokeStyle = '#2f6db5'; dctx.stroke();
  diaDirty = false;
}
const slT = H.makeSlider($('t3dST'), { min: -30, max: 0, reverse: true, vertical: false, stepKey: 0.5, fmt: v => v.toFixed(1) + ' °C', get: () => st.T, onInput: v => userSet(v, st.S) });
const slS = H.makeSlider($('t3dSS'), { min: 0, max: 0.35, vertical: true, stepKey: 0.005, fmt: v => v.toFixed(3), get: () => st.S, onInput: v => userSet(st.T, v) });
function layoutDia() {
  const r = dia.getBoundingClientRect(); if (!r.width) return; const k = r.width / dia.width;
  const x0 = H.xOf(0) * k, x1 = H.xOf(-30) * k, y0 = H.yOf(0) * k, y1 = H.yOf(0.35) * k;
  slT.place(x0, y0 + 2, x1 - x0, 30); slS.place(x0 - 32, y1, y0 - y1, 30);
}
window.addEventListener('resize', () => { if (st.visible) { layoutDia(); resize3(); } });
function setCond(T, S) { st.T = clamp(T, -30, 0); st.S = clamp(S, 0, 0.35); slT.set(st.T); slS.set(st.S); diaDirty = true; }
function userSet(T, S) { stopAuto(); stopJourney(); setCond(T, S); }
let dragging = false;
const diaEv = e => { const r = dia.getBoundingClientRect(), k = dia.width / r.width; userSet(H.TofX((e.clientX - r.left) * k), H.SofY((e.clientY - r.top) * k)); };
dia.addEventListener('pointerdown', e => { dia.setPointerCapture(e.pointerId); dragging = true; diaEv(e); });
dia.addEventListener('pointermove', e => { if (dragging) diaEv(e); });
dia.addEventListener('pointerup', () => dragging = false);

// auto-drift and journeys run on model time, so the same path gives the same crystal on any device
const autoBtn = $('t3dAuto');
function startAuto() { stopJourney(); st.auto = true; st.autoT0 = st.mtime; st.autoFrom = { T: st.T, S: st.S }; st.autoPh = [0, 1, 2, 3].map(() => Math.random() * 6.28); autoBtn.classList.add('on'); autoBtn.textContent = '✦ Auto‑drift: on'; }
function stopAuto() { if (!st.auto) return; st.auto = false; autoBtn.classList.remove('on'); autoBtn.textContent = '✦ Auto‑drift'; }
autoBtn.onclick = () => st.auto ? stopAuto() : startAuto();
const PRESETS3 = {
  thin: { T: -15, S: 0.08 }, thick: { T: -2, S: 0.07 }, sector: { T: -15, S: 0.2 }, stellar: { T: -15, S: 0.3 },
  column: { T: -7, S: 0.08 }, hollow: { T: -6, S: 0.15 }, needle: { T: -5, S: 0.27 },
  capped: { journey: [{ T: -6, S: 0.15, dur: 50 }, { T: -15, S: 0.22, dur: 1e9 }], name: 'Capped column: a column grows at −6 °C, then the crystal drops into −15 °C air and plates grow from both ends.' },
  tipped: { journey: [{ T: -15, S: 0.26, dur: 15 }, { T: -12, S: 0.07, dur: 25 }, { T: -15, S: 0.27, dur: 1e9 }], name: 'Branches, then dry air makes the tips facet, then branching resumes.' },
};
function stopJourney() { if (!st.journey) return; st.journey = null; $('t3dJourney').textContent = ''; }
function journeyCond(J) {
  let t = st.mtime, i = 0;
  while (i < J.length - 1 && t > J[i].dur) { t -= J[i].dur; i++; }
  const seg = J[i], prev = i > 0 ? J[i - 1] : seg, u = clamp(t / 2, 0, 1), e = u * u * (3 - 2 * u);
  return { T: lerp(prev.T, seg.T, e), S: lerp(prev.S, seg.S, e) };
}
document.querySelectorAll('[data-p3]').forEach(b => b.onclick = () => {
  const p = PRESETS3[b.dataset.p3];
  stopAuto(); stopJourney();
  if (p.journey) { st.journey = p.journey; $('t3dJourney').textContent = p.name; setCond(p.journey[0].T, p.journey[0].S); }
  else setCond(p.T, p.S);
  newCrystal(); if (!st.running) togglePlay();
});
const playBtn = $('t3dPlay');
function togglePlay() { st.running = !st.running; playBtn.textContent = st.running ? '⏸ Pause' : '▶ Grow'; wantSnap = true; }
playBtn.onclick = togglePlay;
$('t3dReset').onclick = () => { stopJourney(); newCrystal(); if (!st.running) togglePlay(); };

// ---------------- orthographic top view ----------------
const top = $('t3dTop'), tctx = top.getContext('2d'), TW = top.width;
const topImg = tctx.createImageData(TW, TW), topLocal = new Int32Array(TW * TW);
const topView = RMAX * 1.04;
(function buildTopMap() {
  const s3 = Math.sqrt(3) / 2, N = S3.N, c0 = S3.c0;
  for (let Y = 0; Y < TW; Y++) for (let X = 0; X < TW; X++) {
    const x = ((X + 0.5) / TW * 2 - 1) * topView, y = ((Y + 0.5) / TW * 2 - 1) * topView;
    const r = y / s3, q = x - r / 2;
    let rx = Math.round(q), rz = Math.round(r), ry = Math.round(-q - r);
    const dx = Math.abs(rx - q), dy = Math.abs(ry + q + r), dz = Math.abs(rz - r);
    if (dx > dy && dx > dz) rx = -ry - rz; else if (dy <= dz) rz = -rx - ry;
    const i = rx + c0, j = rz + c0;
    topLocal[Y * TW + X] = (i >= 0 && j >= 0 && i < N && j < N) ? S3.local[j * N + i] : -1;
  }
})();
function drawTop() {
  const px = topImg.data, th = new Float32Array(TW * TW), topT = new Float32Array(TW * TW);
  let thick = null, tTop = null, nC = 0, maxT = 1;
  if (snap) {
    nC = snap.nC; thick = new Uint16Array(nC); tTop = new Uint8Array(nC);
    for (let z = 0; z < snap.nz; z++) for (let i = 0; i < nC; i++) if (snap.A[z * nC + i]) { thick[i] += z ? 2 : 1; tTop[i] = snap.TA[z * nC + i]; }
    for (let i = 0; i < nC; i++) if (thick[i] > maxT) maxT = thick[i];
  }
  for (let o = 0; o < th.length; o++) { const k = topLocal[o]; if (thick && k >= 0 && k < nC) { th[o] = thick[k]; topT[o] = tTop[k]; } }
  const scaleT = Math.max(4, Math.min(maxT, 30));
  for (let Y = 0; Y < TW; Y++) for (let X = 0; X < TW; X++) {
    const o = Y * TW + X, p4 = o * 4, t = th[o];
    let R, G, B;
    if (t > 0) {
      // microscope-style: brighter where thicker, with relief from the thickness gradient (light from top-left)
      const gx = (X > 0 ? th[o - 1] : 0) - (X < TW - 1 ? th[o + 1] : 0), gy = (Y > 0 ? th[o - TW] : 0) - (Y < TW - 1 ? th[o + TW] : 0);
      const relief = clamp((gx + gy) / scaleT * 1.5, -0.5, 0.6);
      const edge = (X > 0 && th[o - 1] === 0) || (X < TW - 1 && th[o + 1] === 0) || (Y > 0 && th[o - TW] === 0) || (Y < TW - 1 && th[o + TW] === 0) ? 0.35 : 0;
      const v = clamp(0.55 + 0.4 * Math.min(1, t / scaleT) + relief * 0.5 + edge, 0.2, 1.2);
      let c = [200, 228, 255];
      if (st.colour === 'temp') c = H.tColor(-topT[o] / 8);
      R = c[0] * v; G = c[1] * v; B = c[2] * v;
    } else {
      const r = Math.hypot(X - TW / 2, Y - TW / 2) / (TW / 2);
      const f = r > 0.8 ? 1 - (r - 0.8) * 1.5 : 1;
      R = 14 * f; G = 24 * f; B = 52 * f;
    }
    px[p4] = R; px[p4 + 1] = G; px[p4 + 2] = B; px[p4 + 3] = 255;
  }
  tctx.putImageData(topImg, 0, 0);
  // scale bar: 1 mm
  const pxPerCell = TW / (2 * topView), mm = 1000 / UM_PER_CELL * pxPerCell;
  tctx.fillStyle = 'rgba(232,238,252,.8)'; tctx.fillRect(TW / 2 - mm / 2, TW - 46, mm, 3);
  tctx.font = '13px system-ui'; tctx.textAlign = 'center'; tctx.fillText('1 mm', TW / 2, TW - 52);
  topDirty = false;
}

// ---------------- perspective 3D view ----------------
const canvas = $('t3dCanvas'), wrap = $('t3dWrap');
let renderer, scene, camera, controls, group, needsRender = true, spin = true, framed = false, userCam = false, lastTall = null;
function init3() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, '#9fb3e8'); gr.addColorStop(0.55, '#5f78c8'); gr.addColorStop(1, '#2c3a7a');
  g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
  const rg = g.createRadialGradient(256, 256, 0, 256, 256, 240); rg.addColorStop(0, 'rgba(255,255,255,.6)'); rg.addColorStop(0.4, 'rgba(225,235,255,.25)'); rg.addColorStop(1, 'rgba(200,215,255,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 512, 512);
  scene.background = new THREE.CanvasTexture(c); scene.background.colorSpace = THREE.SRGBColorSpace;
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  camera = new THREE.PerspectiveCamera(35, 1, 1, 20000);
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.autoRotate = spin; controls.autoRotateSpeed = 1.2;
  controls.addEventListener('change', () => { needsRender = true; });
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(1, 2, 1.5); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9cc7ff, 1.4); rim.position.set(-2, -0.5, -1.5); scene.add(rim);
  scene.add(new THREE.AmbientLight(0x6080c0, 0.35));
  new ResizeObserver(resize3).observe(wrap); resize3();
}
function resize3() {
  if (!renderer) return; const w = wrap.clientWidth, h = wrap.clientHeight; if (!w || !h) return;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); needsRender = true;
}
// real plates are only a few cells (tens of µm) thick, so perfectly clear glass would be invisible:
// partly transmissive ice with a faint blue body colour and strong surface reflections
const iceMat = color => new THREE.MeshPhysicalMaterial({ color, roughness: 0.15, metalness: 0, transmission: 0.72, thickness: 2, ior: 1.31,
  clearcoat: 1, clearcoatRoughness: 0.05, specularIntensity: 1, envMapIntensity: 1.3, side: THREE.DoubleSide,
  attenuationColor: new THREE.Color(0xbfe0ff), attenuationDistance: 12 });
function chaikin(L) { const o = []; for (let i = 0; i < L.length; i++) { const a = L[i], b = L[(i + 1) % L.length]; o.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]); } return o; }
function shapesFrom(mask, G, Rv) {
  const get = (X, Y) => (X >= 0 && Y >= 0 && X < G && Y < G && mask[Y * G + X]) ? 1 : 0;
  const dedupe = L => L.filter((p, i) => { const q = L[(i + 1) % L.length]; return Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) > 0.05; });
  const loops = H.traceLoops(get, 0, G - 1, 0, G - 1).map(L => dedupe(chaikin(H.dpClosed(L, 0.8)))).filter(L => L.length >= 3 && Math.abs(H.area(L)) > 1.5);
  const toW = ([X, Y]) => new THREE.Vector2(((X + 0.5) / G * 2 - 1) * Rv, (1 - (Y + 0.5) / G * 2) * Rv);
  const polys = loops.map(L => { const pts = L.map(toW); return { pts, a: THREE.ShapeUtils.area(pts) }; });
  if (!polys.length) return [];
  let big = polys[0]; for (const p of polys) if (Math.abs(p.a) > Math.abs(big.a)) big = p;
  const sg = Math.sign(big.a), outers = polys.filter(p => Math.sign(p.a) === sg), holes = polys.filter(p => Math.sign(p.a) !== sg);
  const inside = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) c = !c; } return c; };
  return outers.map(o => { const sh = new THREE.Shape(sg > 0 ? o.pts : o.pts.slice().reverse());
    for (const h of holes) if (inside(h.pts[0], o.pts)) sh.holes.push(new THREE.Path(sg > 0 ? h.pts.slice().reverse() : h.pts)); return sh; });
}
function buildMesh() {
  if (!renderer) init3();
  if (group) { group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); scene.remove(group); group = null; }
  group = new THREE.Group();
  if (snap) {
    const { nC, nz, A, TA } = snap, Rv = st.Rc * 1.04 + 2;
    const G = Math.round(clamp(Rv * 2.4, 120, 560));
    // pixel -> stored cell index, at roughly one pixel per lattice cell
    const map = new Int32Array(G * G), s3 = Math.sqrt(3) / 2, N = S3.N, c0 = S3.c0;
    for (let Y = 0; Y < G; Y++) for (let X = 0; X < G; X++) {
      const x = ((X + 0.5) / G * 2 - 1) * Rv, y = (1 - (Y + 0.5) / G * 2) * Rv, r = y / s3, q = x - r / 2;
      let rx = Math.round(q), rz = Math.round(r), ry = Math.round(-q - r);
      const dx = Math.abs(rx - q), dy = Math.abs(ry + q + r), dz = Math.abs(rz - r);
      if (dx > dy && dx > dz) rx = -ry - rz; else if (dy <= dz) rz = -rx - ry;
      const i = rx + c0, j = rz + c0, k = (i >= 0 && j >= 0 && i < N && j < N) ? S3.local[j * N + i] : -1;
      map[Y * G + X] = k < nC ? k : -1;
    }
    // group identical consecutive layers into slabs
    const same = (z1, z2) => { for (let i = 0; i < nC; i++) if (A[z1 * nC + i] !== A[z2 * nC + i]) return false; return true; };
    const empty = z => { for (let i = 0; i < nC; i++) if (A[z * nC + i]) return false; return true; };
    const mask = new Uint8Array(G * G), mats = {};
    for (let z0 = 0; z0 < nz && !empty(z0);) {
      let z1 = z0; while (z1 + 1 < nz && !empty(z1 + 1) && same(z0, z1 + 1)) z1++;
      for (let o = 0; o < mask.length; o++) { const k = map[o]; mask[o] = k >= 0 && A[z0 * nC + k] ? 1 : 0; }
      const shapes = shapesFrom(mask, G, Rv);
      if (shapes.length) {
        let color = 0xd6eaff;
        if (st.colour === 'temp') { let s = 0, n = 0; for (let i = 0; i < nC; i++) if (A[z0 * nC + i]) { s += TA[z0 * nC + i]; n++; } const c = H.tColor(-(s / Math.max(1, n)) / 8); color = new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255).getHex(); }
        const mat = mats[color] || (mats[color] = iceMat(color));
        const slab = (yc, h) => {
          const hh = Math.max(h - 0.04, h * 0.99);  // hair-line gap between slabs: no z-fighting
          const geo = new THREE.ExtrudeGeometry(shapes, { depth: hh, bevelEnabled: false, curveSegments: 1 });
          const nrm = geo.attributes.normal.array;
          for (let i = 0; i < nrm.length; i += 3) if (!(Math.abs(nrm[i]) + Math.abs(nrm[i + 1]) + Math.abs(nrm[i + 2]) > 0)) { nrm[i] = 0; nrm[i + 1] = 0; nrm[i + 2] = 1; }
          geo.translate(0, 0, -hh / 2);
          const m = new THREE.Mesh(geo, mat); m.rotation.x = -Math.PI / 2; m.position.y = yc; group.add(m);
        };
        // layer z spans [z - 0.5, z + 0.5]; the lower half mirrors the upper
        if (z0 === 0) slab(0, 2 * z1 + 1); else { const a = z0 - 0.5, b = z1 + 0.5; slab((a + b) / 2, b - a); slab(-(a + b) / 2, b - a); }
      }
      z0 = z1 + 1;
    }
  }
  scene.add(group);
  const ext = Math.max(Math.hypot(st.Rc, st.Hc + 0.5), 8);
  // fit using whichever field of view is narrower (the panel can be taller than it is wide)
  const vHalf = THREE.MathUtils.degToRad(camera.fov / 2), hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
  const fit = ext / Math.sin(Math.min(vHalf, hHalf)) * 1.15;
  // keep the growing crystal in frame until the user takes over the camera
  // plates are best seen from above at an angle; columns and capped columns from the side
  const tall = st.Hc > 0.25 * st.Rc, dir = tall ? new THREE.Vector3(0.45, 0.28, 0.85) : new THREE.Vector3(0.35, 0.6, 0.72);
  if (!framed || resetView || (!userCam && tall !== lastTall)) { camera.position.copy(dir.normalize().multiplyScalar(fit)); controls.target.set(0, 0, 0); framed = true; resetView = false; userCam = false; }
  else if (!userCam) { camera.position.sub(controls.target).setLength(fit).add(controls.target); }
  lastTall = tall;
  camera.near = fit / 200; camera.far = fit * 20; camera.updateProjectionMatrix();
  controls.minDistance = ext * 0.3; controls.maxDistance = fit * 4;
  meshDirty = false; needsRender = true;
}
let resetView = false;
$('t3dView').onclick = () => { resetView = true; buildMesh(); };
const spinBtn = $('t3dSpin');
spinBtn.onclick = () => { spin = !spin; spinBtn.classList.toggle('on', spin); if (controls) controls.autoRotate = spin; needsRender = true; };
canvas.addEventListener('wheel', () => { userCam = true; }, { passive: true });
canvas.addEventListener('pointerdown', () => { userCam = true; if (spin) { spin = false; spinBtn.classList.remove('on'); if (controls) controls.autoRotate = false; } });
{ const el = $('t3dColour'); el.querySelectorAll('button').forEach(b => b.onclick = () => { el.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); st.colour = b.dataset.v; topDirty = meshDirty = true; }); }

// ---------------- loop ----------------
const statusEl = $('t3dStatus');
let lastStatus = '', trailClock = 0, last = performance.now(), growthFrames = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!st.visible) return;
  // conditions follow model time
  if (st.journey) { const c = journeyCond(st.journey); setCond(c.T, c.S); }
  else if (st.auto) {
    const t = st.mtime - st.autoT0, p = st.autoPh, b = clamp(t / 3, 0, 1);
    const T = clamp(-13 + 9 * Math.sin(0.09 * t + p[0]) + 5 * Math.sin(0.23 * t + p[1]), -28, -0.8);
    const S = clamp(0.17 + 0.09 * Math.sin(0.13 * t + p[2]) + 0.05 * Math.sin(0.31 * t + p[3]), 0.02, 0.33);
    setCond(lerp(st.autoFrom.T, T, b), lerp(st.autoFrom.S, S, b));
  }
  if (st.running && !st.done && !busy) {
    const snapNow = wantSnap || now - lastSnapT > 300;
    if (snapNow) { lastSnapT = now; wantSnap = false; }
    busy = true;
    worker.postMessage({ type: 'run', gen, T: st.T, params: M3.mapParams3(st.T, st.S), budget: 40, max: 400, snap: snapNow });
  } else if (!busy && wantSnap) { wantSnap = false; busy = true; worker.postMessage({ type: 'run', gen, T: st.T, params: M3.mapParams3(st.T, st.S), budget: 0, max: 0, snap: true }); }
  if (st.running && !st.done) {
    trailClock += dt;
    if (trailClock > 0.2) { trailClock = 0; const L = st.trail[st.trail.length - 1];
      if (!L || Math.abs(L.T - st.T) > 0.05 || Math.abs(L.S - st.S) > 0.001) { st.trail.push({ T: st.T, S: st.S }); if (st.trail.length > 600) st.trail.shift(); diaDirty = true; } }
  }
  if (topDirty) drawTop();
  if (diaDirty) drawDia();
  // the 3D mesh is rebuilt at most every 1.5 s while growing (immediately once paused or finished)
  if (meshDirty && snap && (!st.running || st.done || now - lastMeshT > 1500)) { buildMesh(); lastMeshT = performance.now(); }
  if (renderer) { const moved = controls.update(); if (moved || needsRender) { renderer.render(scene, camera); needsRender = false; } }
  const um = UM_PER_CELL;
  const s = st.done ? `❄ Fully grown · ${(2 * st.Rc * um / 1000).toFixed(2)} mm across · ${((2 * st.Hc + 1) * um).toFixed(0)} µm along the c‑axis`
    : !st.running ? 'Paused'
    : `Growing · ${st.mtime.toFixed(0)} s · ${(2 * st.Rc * um / 1000).toFixed(2)} mm across · ${((2 * st.Hc + 1) * um).toFixed(0)} µm along the c‑axis`;
  if (s !== lastStatus) { statusEl.textContent = s; lastStatus = s; }
}
requestAnimationFrame(frame);

window.True3D = {
  show() { st.visible = true; if (!renderer) init3(); layoutDia(); setCond(st.T, st.S); resize3(); topDirty = diaDirty = true; meshDirty = true; if (!started) { started = true; newCrystal(); } },
  hide() { st.visible = false; },
};
let started = false;
if (H.state.tab === 'true3d') window.True3D.show();
