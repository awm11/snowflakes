// 3D view of the grown crystal (three.js)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const S = window.__snow;
const canvas = document.getElementById('threeCanvas');
const wrap = document.getElementById('threeWrap');
const msg = document.getElementById('threeMsg');
const note = document.getElementById('t3Note');

let renderer, scene, camera, controls, group, visible = false, built = false, lastPlate = null;
// render only when something changes; adapt pixel density to keep frames quick
let needsRender = true, dpr = 1, maxDpr = 1, frameEma = 16, lastFrame = 0, framesSince = 0;
const opts = { colour: 'ice', thick: 1, spin: true, back: 0.5 };

// Backlight: the crystal sits in front of a lamp glow, as under a microscope. The glow is part of
// the background, so the refractive ice bends it through the branches and edges.
function setBacklight(b) {
  const W = 512, c = document.createElement('canvas'); c.width = c.height = W;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, W);                       // soft blue backdrop
  gr.addColorStop(0, '#9fb3e8'); gr.addColorStop(0.55, '#5f78c8'); gr.addColorStop(1, '#2c3a7a');
  g.fillStyle = gr; g.fillRect(0, 0, W, W);
  if (b > 0) {                                                         // lamp glow behind the crystal
    const rg = g.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W * (0.25 + 0.35 * b));
    rg.addColorStop(0, `rgba(255,255,255,${Math.min(1, 0.35 + 0.65 * b)})`);
    rg.addColorStop(0.35, `rgba(225,235,255,${0.55 * b})`);
    rg.addColorStop(1, 'rgba(200,215,255,0)');
    g.fillStyle = rg; g.fillRect(0, 0, W, W);
  }
  if (scene.background && scene.background.dispose) scene.background.dispose();
  scene.background = new THREE.CanvasTexture(c); scene.background.colorSpace = THREE.SRGBColorSpace;
  renderer.toneMappingExposure = 0.85 + 0.45 * b;
  needsRender = true;
}
function init() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  maxDpr = Math.min(1.5, window.devicePixelRatio || 1); dpr = maxDpr;
  renderer.setPixelRatio(dpr);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  setBacklight(opts.back);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  camera = new THREE.PerspectiveCamera(35, 1, 1, 20000);
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.autoRotate = opts.spin; controls.autoRotateSpeed = 1.2;
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(1, 2, 1.5); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9cc7ff, 1.4); rim.position.set(-2, -0.5, -1.5); scene.add(rim);
  scene.add(new THREE.AmbientLight(0x6080c0, 0.35));
  new ResizeObserver(resize).observe(wrap);
  resize();
  controls.addEventListener('change', () => { needsRender = true; });
  renderer.setAnimationLoop(now => {
    if (!visible) return;
    const moved = controls.update();
    if (!moved && !needsRender) { lastFrame = 0; return; }   // idle: nothing to draw
    renderer.render(scene, camera); needsRender = false;
    // adaptive resolution while moving: drop pixel density if frames are slow, restore when quick
    if (lastFrame) { frameEma = frameEma * 0.9 + (now - lastFrame) * 0.1; framesSince++; }
    lastFrame = now;
    if (framesSince > 45) {
      framesSince = 0;
      let nd = dpr;
      if (frameEma > 26 && dpr > 0.75) nd = Math.max(0.75, dpr * 0.8);
      else if (frameEma < 18 && dpr < maxDpr) nd = Math.min(maxDpr, dpr * 1.15);
      if (nd !== dpr) { dpr = nd; renderer.setPixelRatio(dpr); resize(); }
    }
  });
}
function resize() {
  if (!renderer) return;
  const w = wrap.clientWidth, h = wrap.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  needsRender = true;
}

// ---- crystal sampling ----
function crystalCanvases(G, Rv) {
  // colour + bump textures covering [-Rv, Rv]^2 in cell units (image y up = +y)
  const { sim, state, tColor, timeColor, attachedAt } = S;
  const col = document.createElement('canvas'); col.width = col.height = G;
  const bmp = document.createElement('canvas'); bmp.width = bmp.height = G;
  const ci = col.getContext('2d').createImageData(G, G), bi = bmp.getContext('2d').createImageData(G, G);
  const s3 = Math.sqrt(3) / 2, N = S.N, c0 = sim.c0, tNow = Math.max(0.001, state.time);
  const mask = new Uint8Array(G * G), tA = new Float32Array(G * G).fill(Infinity), rP = new Float32Array(G * G);
  for (let Y = 0; Y < G; Y++) for (let X = 0; X < G; X++) {
    const x = ((X + 0.5) / G * 2 - 1) * Rv, y = (1 - (Y + 0.5) / G * 2) * Rv;
    const r = y / s3, q = x - r / 2;
    let rx = Math.round(q), rz = Math.round(r), ry = Math.round(-q - r);
    const dx = Math.abs(rx - q), dy = Math.abs(ry + q + r), dz = Math.abs(rz - r);
    if (dx > dy && dx > dz) rx = -ry - rz; else if (dy <= dz) rz = -rx - ry;
    const i = rx + c0, j = rz + c0, o = (Y * G + X) * 4;
    let on = 0, k = -1;
    if (i >= 1 && j >= 1 && i < N - 1 && j < N - 1) { k = j * N + i; on = sim.a[k]; }
    mask[Y * G + X] = on; rP[Y * G + X] = Math.hypot(x, y); if (on) tA[Y * G + X] = sim.tAt[k];
    let c = [235, 245, 255], h = 0;
    if (on) {
      h = Math.max(0, Math.min(1, (sim.c[k] - 0.6) / 1.6));
      if (opts.colour === 'temp') c = tColor(sim.TAt[k]);
      else if (opts.colour === 'time') c = timeColor(Math.min(1, sim.tAt[k] / tNow));
      else { c = [255, 255, 255]; }
    }
    ci.data[o] = c[0]; ci.data[o + 1] = c[1]; ci.data[o + 2] = c[2]; ci.data[o + 3] = 255;
    const g = on ? 60 + 195 * h : 0;
    bi.data[o] = bi.data[o + 1] = bi.data[o + 2] = g; bi.data[o + 3] = 255;
  }
  col.getContext('2d').putImageData(ci, 0, 0); bmp.getContext('2d').putImageData(bi, 0, 0);
  { // soften the bump map: cell-sized steps make the bump shader produce extreme normals (black specks)
    const tmp = document.createElement('canvas'); tmp.width = tmp.height = G;
    const tg = tmp.getContext('2d'); tg.filter = 'blur(1.5px)'; tg.drawImage(bmp, 0, 0);
    const bg = bmp.getContext('2d'); bg.clearRect(0, 0, G, G); bg.drawImage(tmp, 0, 0);
  }
  return { col, bmp, mask, tA, rP };
}

function chaikin(L) { // one round of corner cutting: softer, more ice-like edges
  const out = [];
  for (let i = 0; i < L.length; i++) { const a = L[i], b = L[(i + 1) % L.length];
    out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]); }
  return out;
}
function shapesFromMask(mask, G, Rv, rad) {
  const { traceLoops, dpClosed, area } = S;
  const get = (X, Y) => (X >= 0 && Y >= 0 && X < G && Y < G && mask[Y * G + X]) ? 1 : 0;
  const h = rad == null ? G : Math.min(G, Math.ceil(rad / Rv * G / 2) + 3), lo = Math.max(0, (G >> 1) - h), hi = Math.min(G - 1, (G >> 1) + h);
  const dedupe = L => L.filter((p, i) => { const q = L[(i + 1) % L.length]; return Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) > 0.05; });
  let loops = traceLoops(get, lo, hi, lo, hi).map(L => dedupe(chaikin(dpClosed(L, 0.9)))).filter(L => L.length >= 3 && Math.abs(area(L)) > 2);
  const toW = ([X, Y]) => new THREE.Vector2((X / G * 2 - 1) * Rv, (1 - Y / G * 2) * Rv);
  const polys = loops.map(L => { const pts = L.map(toW); return { pts, a: THREE.ShapeUtils.area(pts) }; });
  if (!polys.length) return [];
  let big = polys[0]; for (const p of polys) if (Math.abs(p.a) > Math.abs(big.a)) big = p;
  const outerSign = Math.sign(big.a);
  const outers = polys.filter(p => Math.sign(p.a) === outerSign), holes = polys.filter(p => Math.sign(p.a) !== outerSign);
  const inside = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]; if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) c = !c; } return c; };
  return outers.map(o => {
    const sh = new THREE.Shape(outerSign > 0 ? o.pts : o.pts.slice().reverse());
    for (const h of holes) if (inside(h.pts[0], o.pts)) sh.holes.push(new THREE.Path(outerSign > 0 ? h.pts.slice().reverse() : h.pts));
    return sh;
  });
}

// approximate distance (pixels) from each inside pixel to the outside
function chamfer(mask, G) {
  const D = new Float32Array(G * G), B = Math.SQRT2, BIG = 1e9;
  for (let i = 0; i < D.length; i++) D[i] = mask[i] ? BIG : 0;
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
    const o = y * G + x; if (!D[o]) continue; let v = D[o];
    v = Math.min(v, x > 0 ? D[o - 1] + 1 : 1);
    if (y > 0) { v = Math.min(v, D[o - G] + 1); if (x > 0) v = Math.min(v, D[o - G - 1] + B); if (x < G - 1) v = Math.min(v, D[o - G + 1] + B); } else v = Math.min(v, 1);
    D[o] = v;
  }
  for (let y = G - 1; y >= 0; y--) for (let x = G - 1; x >= 0; x--) {
    const o = y * G + x; if (!D[o]) continue; let v = D[o];
    v = Math.min(v, x < G - 1 ? D[o + 1] + 1 : 1);
    if (y < G - 1) { v = Math.min(v, D[o + G] + 1); if (x < G - 1) v = Math.min(v, D[o + G + 1] + B); if (x > 0) v = Math.min(v, D[o + G - 1] + B); } else v = Math.min(v, 1);
    D[o] = v;
  }
  return D;
}
function disposeGroup() {
  if (!group) return;
  group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { for (const k of ['map', 'bumpMap']) if (o.material[k]) o.material[k].dispose(); o.material.dispose(); } });
  scene.remove(group); group = null;
}

function iceMaterial(extra) {
  // clear, refractive ice (refractive index 1.31)
  return new THREE.MeshPhysicalMaterial(Object.assign({
    color: 0xffffff, roughness: 0.05, metalness: 0, transmission: 1, thickness: 4, ior: 1.31,
    clearcoat: 1, clearcoatRoughness: 0.03, specularIntensity: 1, envMapIntensity: 1.2, side: THREE.FrontSide,
  }, extra));
}

function build() {
  if (!renderer) init();
  if (S.ensureUnfolded) S.ensureUnfolded();
  disposeGroup();
  const { sim, side, state, tColor, timeColor } = S;
  const R = Math.max(3, sim.radius), Rv = R * 1.03;
  const G = 768;
  const { col, bmp, mask, tA, rP } = crystalCanvases(G, Rv);
  group = new THREE.Group();
  const mapTex = new THREE.CanvasTexture(col); mapTex.colorSpace = THREE.SRGBColorSpace;
  const bumpTex = new THREE.CanvasTexture(bmp);
  for (const t of [mapTex, bumpTex]) { t.repeat.set(1 / (2 * Rv), 1 / (2 * Rv)); t.offset.set(0.5, 0.5); t.anisotropy = 4; }
  const plateMat = iceMaterial({ map: mapTex, bumpMap: bumpTex, bumpScale: 2 });

  // Combine the two views. The side view gives, for every slice along the c-axis, its width and
  // the time it last grew sideways (tw). That slice's cross-section is the top-view crystal as it
  // was at time tw (cells attached by then), trimmed to the slice's width. So a capped column gets
  // a hexagonal core from early on and end plates with the full branched outline.
  const L = side.layers, Lo = side.lower || side.layers, dz = side.dz;
  const isPlate = Math.max(L.length, Lo.length) <= 7 || Math.max(side.halfH, side.halfHLow || 0) < R * 0.05;
  const exag = isPlate ? opts.thick : 1;                  // exaggeration only makes sense for plates
  const hz = dz * exag;
  const slabMask = new Uint8Array(G * G);
  const matCache = {};
  // the upper half builds upwards from the centre, the lower half downwards (they can differ: double plates)
  for (const [Lh, dir] of [[L, 1], [Lo, -1]]) {
    // group neighbouring slices with similar width into slabs
    const groups = [];
    for (let i = 0; i < Lh.length;) {
      let j = i; const w0 = Lh[i].w;
      while (j + 1 < Lh.length && Math.abs(Lh[j + 1].w - w0) <= Math.max(1.5, 0.06 * w0)) j++;
      let w = 0, tw = 0; for (let k = i; k <= j; k++) { w = Math.max(w, Lh[k].w); tw = Math.max(tw, Lh[k].tw || 0); }
      groups.push({ i, j, w, tw, T: Lh[i].T, t: Lh[i].t });
      i = j + 1;
    }
    // Rounded plate edges: in a real plate the molecular layers get shorter towards each basal face,
    // so the edge has a curved profile. Wherever a slab's face is exposed (the next slab is narrower),
    // the slab is cut into thin slices whose outlines are pulled in along a quarter circle.
    const pxPerCell = G / (2 * Rv), maxR = 6 * dz * exag;
    groups.forEach((g, gi) => {
      const wr = Math.min(R, g.w) * 1.03 + 1;
      for (let o = 0; o < slabMask.length; o++) slabMask[o] = (mask[o] && tA[o] <= g.tw + 1e-6 && rP[o] <= wr) ? 1 : 0;
      const z0 = g.i * hz, z1 = (g.j + 1) * hz, h = z1 - z0, full = g.w >= R * 0.97;
      let mat = plateMat;
      if (opts.colour !== 'ice' && !full) {
        const c = opts.colour === 'temp' ? tColor(g.T) : timeColor(Math.min(1, g.t / Math.max(0.001, state.time)));
        const key = c.map(v => v | 0).join(',');
        mat = matCache[key] || (matCache[key] = iceMaterial({ color: new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255) }));
      }
      const outer = groups[gi + 1], inner = groups[gi - 1];
      const roundOut = !outer || outer.w < 0.9 * g.w;          // outward face exposed
      const roundIn = gi > 0 && inner.w < 0.9 * g.w;            // inward face exposed (e.g. a plate on a column)
      let rOut = roundOut ? Math.min(maxR, roundIn ? h / 2 : h) : 0;
      let rIn = roundIn ? Math.min(maxR, roundOut ? h / 2 : h) : 0;
      // slices: [start, end, erosion in cells]
      const slices = [], n = 5;
      const core0 = z0 + rIn, core1 = z1 - rOut;
      for (let k = 0; k < n && rIn > 0; k++) { const v = 1 - (k + 0.5) / n; slices.push([z0 + rIn * k / n, z0 + rIn * (k + 1) / n, rIn * (1 - Math.sqrt(1 - v * v))]); }
      if (core1 > core0 + 1e-6) slices.push([core0, core1, 0]);
      for (let k = 0; k < n && rOut > 0; k++) { const v = (k + 0.5) / n; slices.push([core1 + rOut * k / n, core1 + rOut * (k + 1) / n, rOut * (1 - Math.sqrt(1 - v * v))]); }
      const dist = (rIn > 0 || rOut > 0) ? chamfer(slabMask, G) : null;
      const em = new Uint8Array(G * G);
      for (const [a0, a1, e] of slices) {
        let m2 = slabMask;
        if (e > 0) { const ep = e * pxPerCell; for (let o = 0; o < em.length; o++) em[o] = slabMask[o] && dist[o] > ep ? 1 : 0; m2 = em; }
        const sh = shapesFromMask(m2, G, Rv, wr);
        if (!sh.length) continue;
        const t = a1 - a0, tt = Math.max(t * 0.985, t - 0.3);   // hair-line gap between stacked slices: no z-fighting
        const geo = new THREE.ExtrudeGeometry(sh, { depth: tt, bevelEnabled: false, curveSegments: 1 });
        const nrm = geo.attributes.normal.array;
        for (let i = 0; i < nrm.length; i += 3) if (!(Math.abs(nrm[i]) + Math.abs(nrm[i + 1]) + Math.abs(nrm[i + 2]) > 0)) { nrm[i] = 0; nrm[i + 1] = 0; nrm[i + 2] = 1; }
        geo.translate(0, 0, -tt / 2);
        const m = new THREE.Mesh(geo, mat); m.rotation.x = -Math.PI / 2; m.position.y = dir * (a0 + a1) / 2; group.add(m);
      }
    });
  }
  const halfLen = Math.max(L.length, Lo.length) * hz;
  let coreW = R; { const ws = L.map(l => l.w).sort((x, y) => x - y); coreW = ws[ws.length >> 1]; }
  const hasCaps = !isPlate && R > 1.25 * coreW;
  scene.add(group);
  needsRender = true;
  // frame the camera
  const ext = Math.max(R, halfLen);
  const fitDist = ext / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * (isPlate ? 1.1 : 1.45);
  if (!built || resetNext || lastPlate !== isPlate) {
    lastPlate = isPlate;
    if (isPlate) camera.position.set(0, fitDist * 0.78, fitDist * 0.62);
    else camera.position.set(fitDist * 0.3, fitDist * 0.35, fitDist * 0.89);
    controls.target.set(0, 0, 0);
    resetNext = false;
  }
  camera.near = fitDist / 100; camera.far = fitDist * 20; camera.updateProjectionMatrix();
  controls.minDistance = ext * 0.3; controls.maxDistance = fitDist * 4;
  built = true;
  const realRatio = (2 * side.halfH) / (2 * R);
  const mm = v => (v * 0.025 / S.SC);
  note.textContent = (isPlate
    ? `Plate about ${mm(2 * R).toFixed(1)} mm across and ${(mm(2 * side.halfH) * 1000).toFixed(0)} µm thick`
    : hasCaps ? `Capped column about ${mm(2 * side.halfH).toFixed(2)} mm long with end plates ${mm(2 * R).toFixed(2)} mm across`
    : `Column about ${mm(2 * side.halfH).toFixed(2)} mm long and ${mm(2 * coreW).toFixed(2)} mm across`)
    + (exag === 1 ? ', matching the side view.' : ` (plate thickness exaggerated ${exag}× compared with the side view).`)
    + ' Each slice along the c‑axis has the side view’s width and the top‑view outline the crystal had when that slice stopped growing sideways.';
  msg.textContent = S.sim.radius < 4 ? 'Grow a crystal first, then come back here.' : '';
}
let resetNext = false;

function seg(id, cb) {
  const el = document.getElementById(id);
  el.querySelectorAll('button').forEach(b => b.onclick = () => { el.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); cb(b.dataset.v); });
}
seg('t3Colour', v => { opts.colour = v; build(); });
seg('t3Thick', v => { opts.thick = +v; build(); });
const backEl = document.getElementById('t3Back'), backVal = document.getElementById('t3BackVal');
backEl.addEventListener('input', () => { opts.back = backEl.value / 100; backVal.textContent = backEl.value + '%'; if (renderer) setBacklight(opts.back); });
document.getElementById('t3Refresh').onclick = () => build();
document.getElementById('t3Reset').onclick = () => { resetNext = true; build(); };
const spinBtn = document.getElementById('t3Spin');
spinBtn.onclick = () => { opts.spin = !opts.spin; spinBtn.classList.toggle('on', opts.spin); if (controls) controls.autoRotate = opts.spin; };
canvas.addEventListener('pointerdown', () => { if (controls && opts.spin) { opts.spin = false; controls.autoRotate = false; spinBtn.classList.remove('on'); } });

window.Snow3D = {
  show() { visible = true; needsRender = true; lastFrame = 0; try { build(); resize(); } catch (e) { msg.textContent = '3D view could not start: ' + e.message; console.error(e); } },
  hide() { visible = false; },
};
if (S.state.tab === 'three') window.Snow3D.show();
