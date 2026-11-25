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
const opts = { colour: 'ice', thick: 1, spin: true };

function init() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  maxDpr = Math.min(1.5, window.devicePixelRatio || 1); dpr = maxDpr;
  renderer.setPixelRatio(dpr);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  { // soft blue backdrop, like a photomicrograph – transmission refracts this through the ice
    const c = document.createElement('canvas'); c.width = 16; c.height = 512;
    const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 512);
    gr.addColorStop(0, '#9fb3e8'); gr.addColorStop(0.55, '#5f78c8'); gr.addColorStop(1, '#2c3a7a');
    g.fillStyle = gr; g.fillRect(0, 0, 16, 512);
    scene.background = new THREE.CanvasTexture(c); scene.background.colorSpace = THREE.SRGBColorSpace;
  }
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
  let loops = traceLoops(get, lo, hi, lo, hi).map(L => chaikin(dpClosed(L, 0.9))).filter(L => L.length >= 3 && Math.abs(area(L)) > 2);
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

function disposeGroup() {
  if (!group) return;
  group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { for (const k of ['map', 'bumpMap']) if (o.material[k]) o.material[k].dispose(); o.material.dispose(); } });
  scene.remove(group); group = null;
}

function iceMaterial(extra) {
  // clear, refractive ice (refractive index 1.31)
  return new THREE.MeshPhysicalMaterial(Object.assign({
    color: 0xffffff, roughness: 0.05, metalness: 0, transmission: 1, thickness: 4, ior: 1.31,
    clearcoat: 1, clearcoatRoughness: 0.03, specularIntensity: 1, envMapIntensity: 1.2, side: THREE.DoubleSide,
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
  const plateMat = iceMaterial({ map: mapTex, bumpMap: bumpTex, bumpScale: 6 });

  // Combine the two views. The side view gives, for every slice along the c-axis, its width and
  // the time it last grew sideways (tw). That slice's cross-section is the top-view crystal as it
  // was at time tw (cells attached by then), trimmed to the slice's width. So a capped column gets
  // a hexagonal core from early on and end plates with the full branched outline.
  const L = side.layers, dz = side.dz;
  const isPlate = L.length <= 7 || side.halfH < R * 0.05;
  const exag = isPlate ? opts.thick : 1;                  // exaggeration only makes sense for plates
  const hz = dz * exag;
  // group neighbouring slices with similar width into slabs
  const groups = [];
  for (let i = 0; i < L.length;) {
    let j = i; const w0 = L[i].w;
    while (j + 1 < L.length && Math.abs(L[j + 1].w - w0) <= Math.max(1.5, 0.06 * w0)) j++;
    let w = 0, tw = 0; for (let k = i; k <= j; k++) { w = Math.max(w, L[k].w); tw = Math.max(tw, L[k].tw || 0); }
    groups.push({ i, j, w, tw, T: L[i].T, t: L[i].t });
    i = j + 1;
  }
  const slabMask = new Uint8Array(G * G);
  const matCache = {};
  for (const g of groups) {
    const wr = Math.min(R, g.w) * 1.03 + 1;
    for (let o = 0; o < slabMask.length; o++) slabMask[o] = (mask[o] && tA[o] <= g.tw + 1e-6 && rP[o] <= wr) ? 1 : 0;
    // always keep at least the seed hexagon so thin early slices aren't empty
    const sh = shapesFromMask(slabMask, G, Rv, wr);
    if (!sh.length) continue;
    const z0 = g.i * hz, z1 = (g.j + 1) * hz, full = g.w >= R * 0.97;
    let mat = plateMat;
    if (opts.colour !== 'ice' && !full) {
      const c = opts.colour === 'temp' ? tColor(g.T) : timeColor(Math.min(1, g.t / Math.max(0.001, state.time)));
      const key = c.map(v => v | 0).join(',');
      mat = matCache[key] || (matCache[key] = iceMaterial({ color: new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255) }));
    }
    const mk = (yc, h) => {
      const geo = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: h > 1.5, bevelThickness: Math.min(h * 0.15, 2), bevelSize: Math.min(R * 0.003, h * 0.2, 1.5), bevelSegments: 1, curveSegments: 1 });
      geo.translate(0, 0, -h / 2);
      const m = new THREE.Mesh(geo, mat); m.rotation.x = -Math.PI / 2; m.position.y = yc; group.add(m);
    };
    if (g.i === 0) mk(0, 2 * z1); else { mk((z0 + z1) / 2, z1 - z0); mk(-(z0 + z1) / 2, z1 - z0); }
  }
  const halfLen = L.length * hz;
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
