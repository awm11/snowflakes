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
const opts = { colour: 'ice', thick: 1, spin: true };

function init() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
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
  renderer.setAnimationLoop(() => { if (!visible) return; controls.update(); renderer.render(scene, camera); });
}
function resize() {
  if (!renderer) return;
  const w = wrap.clientWidth, h = wrap.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}

// ---- crystal sampling ----
function crystalCanvases(G, Rv) {
  // colour + bump textures covering [-Rv, Rv]^2 in cell units (image y up = +y)
  const { sim, state, tColor, timeColor, attachedAt } = S;
  const col = document.createElement('canvas'); col.width = col.height = G;
  const bmp = document.createElement('canvas'); bmp.width = bmp.height = G;
  const ci = col.getContext('2d').createImageData(G, G), bi = bmp.getContext('2d').createImageData(G, G);
  const s3 = Math.sqrt(3) / 2, N = S.N, c0 = sim.c0, tNow = Math.max(0.001, state.time);
  const mask = new Uint8Array(G * G);
  for (let Y = 0; Y < G; Y++) for (let X = 0; X < G; X++) {
    const x = ((X + 0.5) / G * 2 - 1) * Rv, y = (1 - (Y + 0.5) / G * 2) * Rv;
    const r = y / s3, q = x - r / 2;
    let rx = Math.round(q), rz = Math.round(r), ry = Math.round(-q - r);
    const dx = Math.abs(rx - q), dy = Math.abs(ry + q + r), dz = Math.abs(rz - r);
    if (dx > dy && dx > dz) rx = -ry - rz; else if (dy <= dz) rz = -rx - ry;
    const i = rx + c0, j = rz + c0, o = (Y * G + X) * 4;
    let on = 0, k = -1;
    if (i >= 1 && j >= 1 && i < N - 1 && j < N - 1) { k = j * N + i; on = sim.a[k]; }
    mask[Y * G + X] = on;
    let c = [235, 245, 255], h = 0;
    if (on) {
      h = Math.max(0, Math.min(1, (sim.c[k] - 0.6) / 1.6));
      if (opts.colour === 'temp') c = tColor(sim.TAt[k]);
      else if (opts.colour === 'time') c = timeColor(Math.min(1, sim.tAt[k] / tNow));
      else { const v = 0.45 + 0.55 * h; c = [95 * v + 60, 160 * v + 70, 230 * v + 25]; }
    }
    ci.data[o] = c[0]; ci.data[o + 1] = c[1]; ci.data[o + 2] = c[2]; ci.data[o + 3] = 255;
    const g = on ? 60 + 195 * h : 0;
    bi.data[o] = bi.data[o + 1] = bi.data[o + 2] = g; bi.data[o + 3] = 255;
  }
  col.getContext('2d').putImageData(ci, 0, 0); bmp.getContext('2d').putImageData(bi, 0, 0);
  return { col, bmp, mask };
}

function chaikin(L) { // one round of corner cutting: softer, more ice-like edges
  const out = [];
  for (let i = 0; i < L.length; i++) { const a = L[i], b = L[(i + 1) % L.length];
    out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]); }
  return out;
}
function shapesFromMask(mask, G, Rv) {
  const { traceLoops, dpClosed, area } = S;
  const get = (X, Y) => (X >= 0 && Y >= 0 && X < G && Y < G && mask[Y * G + X]) ? 1 : 0;
  let loops = traceLoops(get, 0, G - 1, 0, G - 1).map(L => chaikin(dpClosed(L, 0.9))).filter(L => L.length >= 3 && Math.abs(area(L)) > 2);
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
  return new THREE.MeshPhysicalMaterial(Object.assign({
    color: 0xdcecff, roughness: 0.22, metalness: 0, transparent: true, opacity: 0.86, ior: 1.31,
    clearcoat: 0.9, clearcoatRoughness: 0.06, envMapIntensity: 0.9, side: THREE.DoubleSide, specularIntensity: 1,
  }, extra));
}

function build() {
  if (!renderer) init();
  disposeGroup();
  const { sim, side, state, tColor, timeColor } = S;
  const R = Math.max(3, sim.radius), Rv = R * 1.03;
  const G = 768;
  const { col, bmp, mask } = crystalCanvases(G, Rv);
  const shapes = shapesFromMask(mask, G, Rv);
  group = new THREE.Group();
  const mapTex = new THREE.CanvasTexture(col); mapTex.colorSpace = THREE.SRGBColorSpace;
  const bumpTex = new THREE.CanvasTexture(bmp);
  for (const t of [mapTex, bumpTex]) { t.repeat.set(1 / (2 * Rv), 1 / (2 * Rv)); t.offset.set(0.5, 0.5); t.anisotropy = 4; }
  const plateMat = iceMaterial({ map: mapTex, bumpMap: bumpTex, bumpScale: 6 });

  // Geometry along the c-axis comes straight from the side-view model (cell units):
  // every layer of the side view becomes a slice of the 3D crystal.
  const L = side.layers, dz = side.dz, nEnd = Math.min(L.length, 4);
  const exag = opts.thick;
  const nInt = L.length - nEnd;                              // interior (column) layers
  const colHalf = nInt * dz;                                 // half-length of column body
  const isPlate = nInt <= 3 || colHalf < R * 0.05;
  // end plates only when they overhang the column (capped column); otherwise a plain column
  // typical column width = median of the interior layers (layers added late may already be plate-wide)
  const colEndW = nInt > 0 ? L.slice(0, nInt).map(l => l.w).sort((x, y) => x - y)[nInt >> 1] : 0;
  const hasCaps = !isPlate && R > 1.25 * colEndW;
  const nCol = isPlate ? 0 : (hasCaps ? nInt : L.length);
  const capT = nEnd * dz * exag;                             // each end plate, as in the side view
  const plates = [];
  if (isPlate) plates.push({ y: 0, t: 2 * side.halfH * exag });
  else if (hasCaps) { plates.push({ y: colHalf + capT / 2, t: capT }); plates.push({ y: -colHalf - capT / 2, t: capT }); }
  for (const p of plates) {
    const geo = new THREE.ExtrudeGeometry(shapes, { depth: p.t, bevelEnabled: true, bevelThickness: p.t * 0.18, bevelSize: Math.min(R * 0.004, p.t * 0.3), bevelSegments: 2, curveSegments: 1 });
    geo.translate(0, 0, -p.t / 2);
    const m = new THREE.Mesh(geo, plateMat);
    m.rotation.x = -Math.PI / 2; m.position.y = p.y;
    group.add(m);
  }
  if (nCol) {
    // column body: hexagonal prisms grouped by similar width, vertices pointing along the arms
    const colMats = {};
    let i = 0;
    while (i < nCol) {
      let j = i; const w0 = L[i].w;
      while (j + 1 < nCol && Math.abs(L[j + 1].w - w0) <= Math.max(1.5, 0.08 * w0)) j++;
      const w = Math.max(1, L[j].w), z0 = i * dz, z1 = (j + 1) * dz;
      let c = [150, 195, 240];
      if (opts.colour === 'temp') c = tColor(L[i].T);
      else if (opts.colour === 'time') c = timeColor(Math.min(1, L[i].t / Math.max(0.001, state.time)));
      const colr = new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255), ck = colr.getHexString();
      const mat = colMats[ck] || (colMats[ck] = iceMaterial({ color: colr }));
      const mk = (yc, h) => { const g = new THREE.CylinderGeometry(w, w, h, 6, 1, false, Math.PI / 2); const m = new THREE.Mesh(g, mat); m.position.y = yc; group.add(m); };
      if (i === 0) mk(0, 2 * z1); else { mk((z0 + z1) / 2, z1 - z0); mk(-(z0 + z1) / 2, z1 - z0); }
      i = j + 1;
    }
  }
  scene.add(group);
  // frame the camera
  const ext = Math.max(R, isPlate ? 0 : (hasCaps ? colHalf + capT : side.halfH));
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
    : `Column about ${mm(2 * side.halfH).toFixed(2)} mm long and ${mm(2 * colEndW).toFixed(2)} mm across`)
    + (exag === 1 ? ', matching the side view.' : ` (plate thickness exaggerated ${exag}× compared with the side view).`)
    + ' The shape along the c‑axis comes from the side‑view model; the outline and surface ridges come from the top view.';
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
  show() { visible = true; try { build(); resize(); } catch (e) { msg.textContent = '3D view could not start: ' + e.message; console.error(e); } },
  hide() { visible = false; },
};
if (S.state.tab === 'three') window.Snow3D.show();
