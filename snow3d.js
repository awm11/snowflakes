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
const opts = { colour: 'ice', thick: 2, spin: true };

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

// ---- variable-thickness plate ----
// Sample the crystal on a G x G vertex grid covering [-Rv, Rv]^2 (cell units, +y = image up).
function sampleField(G, Rv) {
  const { sim } = S;
  const s3 = Math.sqrt(3) / 2, N = S.N, c0 = sim.c0;
  const mask = new Uint8Array(G * G), cv = new Float32Array(G * G), Tv = new Float32Array(G * G), tv = new Float32Array(G * G);
  for (let Y = 0; Y < G; Y++) for (let X = 0; X < G; X++) {
    const x = (X / (G - 1) * 2 - 1) * Rv, y = (1 - Y / (G - 1) * 2) * Rv;
    const r = y / s3, q = x - r / 2;
    let rx = Math.round(q), rz = Math.round(r), ry = Math.round(-q - r);
    const dx = Math.abs(rx - q), dy = Math.abs(ry + q + r), dz = Math.abs(rz - r);
    if (dx > dy && dx > dz) rx = -ry - rz; else if (dy <= dz) rz = -rx - ry;
    const i = rx + c0, j = rz + c0, o = Y * G + X;
    if (i >= 1 && j >= 1 && i < N - 1 && j < N - 1) {
      const k = j * N + i;
      if (sim.a[k]) { mask[o] = 1; cv[o] = sim.c[k]; Tv[o] = sim.TAt[k]; tv[o] = sim.tAt[k]; }
    }
  }
  return { mask, cv, Tv, tv };
}
// approximate Euclidean distance (in grid steps) from each inside vertex to the outside
function chamfer(mask, G) {
  const D = new Float32Array(G * G), A = 1, B = Math.SQRT2, BIG = 1e9;
  for (let i = 0; i < D.length; i++) D[i] = mask[i] ? BIG : 0;
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
    const o = y * G + x; if (!D[o]) continue;
    let v = D[o];
    if (x > 0) v = Math.min(v, D[o - 1] + A); else v = Math.min(v, A);
    if (y > 0) { v = Math.min(v, D[o - G] + A); if (x > 0) v = Math.min(v, D[o - G - 1] + B); if (x < G - 1) v = Math.min(v, D[o - G + 1] + B); } else v = Math.min(v, A);
    D[o] = v;
  }
  for (let y = G - 1; y >= 0; y--) for (let x = G - 1; x >= 0; x--) {
    const o = y * G + x; if (!D[o]) continue;
    let v = D[o];
    if (x < G - 1) v = Math.min(v, D[o + 1] + A); else v = Math.min(v, A);
    if (y < G - 1) { v = Math.min(v, D[o + G] + A); if (x < G - 1) v = Math.min(v, D[o + G + 1] + B); if (x > 0) v = Math.min(v, D[o + G - 1] + B); } else v = Math.min(v, A);
    D[o] = v;
  }
  return D;
}
function blur(F, G, mask, passes) {
  let a = F, b = new Float32Array(F.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      const o = y * G + x; if (!mask[o]) { b[o] = 0; continue; }
      let s = a[o] * 2, n = 2;
      if (x > 0 && mask[o - 1]) { s += a[o - 1]; n++; } if (x < G - 1 && mask[o + 1]) { s += a[o + 1]; n++; }
      if (y > 0 && mask[o - G]) { s += a[o - G]; n++; } if (y < G - 1 && mask[o + G]) { s += a[o + G]; n++; }
      b[o] = s / n;
    }
    const t = a; a = b; b = t === F ? new Float32Array(F.length) : t;
  }
  return a;
}
// Plate thickness model (qualitative, after Libbrecht's observations):
//  * aspect ratio set by the temperature each part grew at: thinnest near -15 C, thicker near -2 C
//    and in the column regime (uses the same plate factor as the growth model)
//  * thickest at the centre, tapering to razor-thin edges and thin branch tips
//  * raised ribs where the growth model laid down extra ice
function plateGeometry(field, G, Rv, R, exag) {
  const { mask, cv, Tv, tv } = field;
  const { state, tColor, timeColor, Sim } = S;
  const step = 2 * Rv / (G - 1);
  const dist = chamfer(mask, G);
  const D = 2 * R, lam = 0.035 * R / step; // edge taper length (grid steps)
  let H = new Float32Array(G * G);
  for (let Y = 0; Y < G; Y++) for (let X = 0; X < G; X++) {
    const o = Y * G + X; if (!mask[o]) continue;
    const x = (X / (G - 1) * 2 - 1) * Rv, y = (1 - Y / (G - 1) * 2) * Rv, r = Math.hypot(x, y);
    const P = Sim.plateFactor(Tv[o]);
    const ratio = 0.006 + 0.03 * Math.pow(1 - P, 1.5);          // centre thickness / diameter
    const centre = 0.55 + 0.45 * Math.exp(-(r * r) / (0.12 * R * R));
    const rib = 0.75 + 0.55 * Math.min(1, Math.max(0, (cv[o] - 0.9) / 1.0));
    H[o] = D * ratio * centre * rib;
  }
  H = blur(H, G, mask, 3);
  for (let o = 0; o < H.length; o++) if (mask[o]) {
    const e = 1 - Math.exp(-dist[o] / lam);                      // razor-thin edges
    H[o] = Math.max(H[o] * e, D * 0.0004) * exag;                  // ~1 um floor at the very edge
  }
  // build top + bottom surfaces and edge walls
  const idx = new Int32Array(G * G).fill(-1);
  const pos = [], col = [];
  const tNow = Math.max(0.001, state.time);
  let nv = 0;
  for (let o = 0; o < G * G; o++) if (mask[o]) {
    const X = o % G, Y = (o / G) | 0;
    const x = (X / (G - 1) * 2 - 1) * Rv, z = -(1 - Y / (G - 1) * 2) * Rv, h = H[o] / 2;
    let c;
    if (opts.colour === 'temp') c = tColor(Tv[o]);
    else if (opts.colour === 'time') c = timeColor(Math.min(1, tv[o] / tNow));
    else { const v = 0.35 + 0.65 * Math.min(1, Math.max(0, (cv[o] - 0.6) / 1.6)); c = [125 * v + 55, 175 * v + 50, 225 * v + 30]; }
    pos.push(x, h, z, x, -h, z);
    const cr = c[0] / 255, cg = c[1] / 255, cb = c[2] / 255; col.push(cr, cg, cb, cr, cg, cb);
    idx[o] = nv; nv += 2;
  }
  const ind = [], edges = new Map();
  const addTri = (a, b, c) => {
    ind.push(idx[a], idx[b], idx[c]);           // top (y up)
    ind.push(idx[a] + 1, idx[c] + 1, idx[b] + 1); // bottom, reversed winding
    for (const [u, v] of [[a, b], [b, c], [c, a]]) { const k = u < v ? u * G * G + v : v * G * G + u; edges.set(k, edges.has(k) ? null : [u, v]); }
  };
  for (let Y = 0; Y < G - 1; Y++) for (let X = 0; X < G - 1; X++) {
    const a = Y * G + X, b = a + 1, c = a + G, d = c + 1;
    const ma = mask[a], mb = mask[b], mc = mask[c], md = mask[d], n = ma + mb + mc + md;
    if (n === 4) { addTri(a, c, b); addTri(b, c, d); }
    else if (n === 3) { if (!ma) addTri(b, c, d); else if (!mb) addTri(a, c, d); else if (!mc) addTri(a, d, b); else addTri(a, c, b); }
  }
  for (const e of edges.values()) if (e) { const [u, v] = e; const tu = idx[u], tv2 = idx[v]; ind.push(tu, tu + 1, tv2, tv2, tu + 1, tv2 + 1); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(nv > 65535 ? new THREE.Uint32BufferAttribute(ind, 1) : new THREE.Uint16BufferAttribute(ind, 1));
  geo.computeVertexNormals();
  let maxH = 0; for (let o = 0; o < H.length; o++) if (H[o] > maxH) maxH = H[o];
  const mid = ((G - 1) >> 1) * G + ((G - 1) >> 1);
  return { geo, maxH, hC: H[mid] || maxH };
}

function disposeGroup() {
  if (!group) return;
  group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { for (const k of ['map', 'bumpMap']) if (o.material[k]) o.material[k].dispose(); o.material.dispose(); } });
  scene.remove(group); group = null;
}

function iceMaterial(extra) {
  return new THREE.MeshPhysicalMaterial(Object.assign({
    color: 0xdcecff, roughness: 0.28, metalness: 0, transparent: true, opacity: 0.88, ior: 1.31,
    clearcoat: 0.9, clearcoatRoughness: 0.06, envMapIntensity: 0.65, side: THREE.DoubleSide, specularIntensity: 1,
  }, extra));
}

function build() {
  if (!renderer) init();
  disposeGroup();
  const { sim, side, state, tColor, timeColor } = S;
  const R = Math.max(3, sim.radius), Rv = R * 1.03;
  const G = 560;
  const field = sampleField(G, Rv);
  group = new THREE.Group();
  const plateMat = iceMaterial({ vertexColors: true, color: 0xffffff, side: THREE.FrontSide });

  // structure along the c-axis from the side-view model (cell units)
  const L = side.layers, dz = side.dz, nEnd = Math.min(L.length, 4);
  const exag = opts.thick;
  const nInt = L.length - nEnd;                              // interior (column) layers
  const colHalf = nInt * dz;                                 // half-length of column body
  const isPlate = nInt <= 3 || colHalf < R * 0.05;
  // A column only gets separate end plates if they actually overhang it (a capped column).
  // Otherwise it's a plain column: hexagonal prisms all the way, with flat end faces.
  const colEndW = nInt > 0 ? L[nInt - 1].w : 0;
  const hasCaps = !isPlate && R > 1.25 * colEndW;
  const nCol = isPlate ? 0 : (hasCaps ? nInt : L.length);
  let maxH = 0, capT = 0;
  if (isPlate || hasCaps) {
    const pg = plateGeometry(field, G, Rv, R, exag);
    maxH = pg.maxH; capT = pg.hC;
    // caps sit with their centre resting on the end of the column
    const ys = isPlate ? [0] : [colHalf + pg.hC / 2, -colHalf - pg.hC / 2];
    ys.forEach((y, n) => { const m = new THREE.Mesh(n ? pg.geo.clone() : pg.geo, plateMat); m.position.y = y; group.add(m); });
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
  const um = v => (v * 0.025 / S.SC * 1000);
  note.textContent = (isPlate
    ? `Plate about ${(2 * R * 0.025 / S.SC).toFixed(1)} mm across, about ${um(maxH / exag).toFixed(0)} µm thick at the thickest point`
    : hasCaps ? `Capped column about ${(2 * side.halfH * 0.025 / S.SC).toFixed(2)} mm long with end plates ${(2 * R * 0.025 / S.SC).toFixed(2)} mm across`
    : `Column about ${(2 * side.halfH * 0.025 / S.SC).toFixed(2)} mm long and ${(2 * colEndW * 0.025 / S.SC).toFixed(2)} mm across`)
    + (isPlate || hasCaps ? (exag === 1 ? ' (true proportions).' : ` (plate thickness exaggerated ${exag}×).`) : ' (true proportions; the thickness setting only affects plates).')
    + ' Thickness is a qualitative model: thickest at the centre and along the ribs, tapering to razor‑thin edges, and thinner for ice that grew near −15 °C.';
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
