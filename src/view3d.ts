// The 3D view of the board (three.js). Loaded only when the 3D view is opened.
//
// The board lies flat with its top surface at height 0: x to the right, y
// from the front edge (nearest the carver, the bottom of the panel on screen)
// to the back, z up. Its top is a fine grid pushed down by the depth map; each
// point is shaded from the depth map itself, so the walls of every cut catch
// or lose the light, and shadows are traced across the cuts towards the light.
//
// The top is a plain, matte, light neutral surface, chosen to show the cuts
// and their shadows as clearly as possible (BRIEF.md, Decisions: "The 3D
// view"); realistic oak is kept for the Proof view.
//
// The depth maps are worked out in a worker (relief-job.ts) and arrive ready
// to use. "Sharper" adds a second, finer map over the area in view, drawn in
// place of that part of the board.
//
// Mouse, as in Kiri:Moto: left-drag orbits, right-drag pans, the wheel zooms.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Area } from './relief';
import type { ReliefResult } from './relief-job';

export type Colouring = 'plain' | 'depth';

/** The board's colour: light, neutral and matte, with room above it for walls turned to the light to show brighter. */
const SURFACE = 0.76;

// Depth anywhere on the board, from the whole board's map or, inside its
// area, the sharper one. Positions are mm from the panel's top-left corner.
const DEPTH = /* glsl */ `
uniform sampler2D uDepth;
uniform vec4 uMap;      // the board's map: left, top, width, height (mm)
uniform sampler2D uFine;
uniform vec4 uFineMap;  // the sharper map, the same way
uniform vec4 uFineArea; // where the sharper map is used: left, top, right, bottom
uniform int uHasFine;
uniform float uPanelH;

bool inFine(vec2 q) {
  return uHasFine == 1 && q.x >= uFineArea.x && q.x <= uFineArea.z && q.y >= uFineArea.y && q.y <= uFineArea.w;
}
float sampleMap(sampler2D t, vec4 m, vec2 q) {
  return texture2D(t, vec2((q.x - m.x) / m.z, 1.0 - (q.y - m.y) / m.w)).r;
}
// The board itself only reads its own map; the sharper patch reads its own
// inside its area and the board's beyond it (for shadows cast from outside).
float depthAt(vec2 q) {
#if PATCH
  return inFine(q) ? sampleMap(uFine, uFineMap, q) : sampleMap(uDepth, uMap, q);
#else
  return sampleMap(uDepth, uMap, q);
#endif
}`;

// The mesh is one band of the grid, repeated up the board (band: its first
// row); its corners are column and row numbers, placed by uGrid.
const VERTEX = /* glsl */ `
${DEPTH}
attribute float band;
uniform vec4 uGrid;      // left, front (mm, from the board's front edge), and one step across and back
uniform float uGridRows; // rows of steps in all
varying vec2 vP;
void main() {
  vec3 p = vec3(uGrid.x + position.x * uGrid.z, uGrid.y + min(position.y + band, uGridRows) * uGrid.w, 0.0);
  vP = vec2(p.x, uPanelH - p.y);
  p.z -= depthAt(vP);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const FRAGMENT = /* glsl */ `
${DEPTH}
uniform float uRes;      // one cell of the board's map, mm
uniform float uFineRes;  // one cell of the sharper map, mm
uniform vec3 uLight;     // towards the light
uniform float uMaxDepth;
uniform int uMode;       // 0 plain, 1 depth colours
uniform vec3 uSurface;
uniform int uSteps;      // steps along each shadow ray
varying vec2 vP;

float height(vec2 q) { return -depthAt(q); }

vec3 depthColour(float t) {
  // shallow pale gold, through orange and red, to deep purple
  vec3 a = vec3(0.98, 0.90, 0.55);
  vec3 b = vec3(0.96, 0.58, 0.20);
  vec3 c = vec3(0.80, 0.18, 0.18);
  vec3 d = vec3(0.35, 0.10, 0.45);
  if (t < 0.33) return mix(a, b, t / 0.33);
  if (t < 0.66) return mix(b, c, (t - 0.33) / 0.33);
  return mix(c, d, (t - 0.66) / 0.34);
}

void main() {
#if PATCH
  float e = uFineRes;
#else
  if (inFine(vP)) discard; // the sharper patch is drawn here instead
  float e = uRes;
#endif
  float hl = height(vP - vec2(e, 0.0));
  float hr = height(vP + vec2(e, 0.0));
  float hf = height(vP + vec2(0.0, e)); // towards the front
  float hb = height(vP - vec2(0.0, e)); // towards the back
  vec3 n = normalize(vec3((hl - hr) / (2.0 * e), (hf - hb) / (2.0 * e), 1.0));
  float h0 = height(vP);

  // Shadow: walk from here towards the light until the ray clears the top surface.
  float lit = 1.0;
  float lxy = length(uLight.xy);
  if (h0 < -0.001 && lxy > 0.0001) {
    vec2 dir = vec2(uLight.x, -uLight.y) / lxy; // on the panel, y runs to the front
    float rise = uLight.z / lxy;
    float reach = -h0 / rise;
    // A loop the graphics chip need not unroll, so the program is quick to prepare.
    for (int i = 1; i <= uSteps; i++) {
      float s = reach * float(i) / float(uSteps);
      float ray = h0 + s * rise;
      if (height(vP + dir * s) > ray + 0.003) { lit = 0.0; break; }
    }
  }

  float depth = -h0;
  vec3 base = uSurface;
  if (uMode == 1 && depth > 0.005) base = depthColour(clamp(depth / max(uMaxDepth, 0.001), 0.0, 1.0));

  // The flat top keeps its natural brightness whatever the light's height; walls
  // turned towards the light come up brighter, walls turned away and shadows go dark.
  vec3 L = normalize(uLight);
  float diffuse = max(dot(n, L), 0.0) * lit;
  float ratio = diffuse / max(L.z, 0.12);
  vec3 colour = base * (0.28 + 0.72 * min(ratio, 1.45));
  gl_FragColor = vec4(colour, 1.0);
}`;

/** A map from the worker as a texture for the graphics chip. */
function mapTexture(r: ReliefResult): THREE.DataTexture {
  const t = new THREE.DataTexture(r.half, r.cols, r.rows, THREE.RedFormat, THREE.HalfFloatType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** About this many points along the longer side of a mesh: its shape; the fine detail is shaded from the depths. */
const MESH = 700;

/** One band of a grid `cols` steps across, as many rows as fit in 65 536 corners, kept for reuse. */
const bands = new Map<number, THREE.BufferGeometry>();
function band(cols: number): { geometry: THREE.BufferGeometry; rows: number } {
  const rows = Math.max(1, Math.floor(65536 / (cols + 1)) - 1);
  let g = bands.get(cols);
  if (!g) {
    const corners = new Uint16Array((cols + 1) * (rows + 1) * 2);
    let k = 0;
    for (let j = 0; j <= rows; j++)
      for (let i = 0; i <= cols; i++) {
        corners[k++] = i;
        corners[k++] = j;
      }
    const index = new Uint16Array(cols * rows * 6);
    k = 0;
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const a = j * (cols + 1) + i;
        const c = a + cols + 1;
        index.set([a, a + 1, c, a + 1, c + 1, c], k);
        k += 6;
      }
    g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(corners, 2));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    bands.set(cols, g);
  }
  return { geometry: g, rows };
}

/** The mesh over a map from the worker: one band repeated up its area, placed by its material's uniforms. */
function mapMesh(r: ReliefResult, area: Area, panelH: number, material: THREE.ShaderMaterial): THREE.Mesh {
  const along = Math.max(r.cols, r.rows);
  const steps = (n: number) => Math.max(1, Math.round((n / along) * Math.min(along, MESH)));
  const sx = steps(r.cols);
  const sy = steps(r.rows);
  const b = band(sx);
  const count = Math.ceil(sy / b.rows);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', b.geometry.getAttribute('position'));
  g.setIndex(b.geometry.getIndex());
  g.setAttribute('band', new THREE.InstancedBufferAttribute(Float32Array.from({ length: count }, (_, i) => i * b.rows), 1));
  g.instanceCount = count;
  const front = panelH - area.y1;
  material.uniforms.uGrid.value.set(area.x0, front, (area.x1 - area.x0) / sx, (area.y1 - area.y0) / sy);
  material.uniforms.uGridRows.value = sy;
  // Its bounds, given rather than measured (the depths move it down, which three.js can't see).
  g.boundingBox = new THREE.Box3(new THREE.Vector3(area.x0, front, -Math.max(r.maxDepth, 0.01)), new THREE.Vector3(area.x1, panelH - area.y0, 0));
  g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
  const mesh = new THREE.Mesh(g, material);
  mesh.frustumCulled = false;
  return mesh;
}

export class Board3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private board = new THREE.Group();
  private sun = new THREE.DirectionalLight(0xffffff, 1.6);
  private material: THREE.ShaderMaterial;
  private patchMaterial: THREE.ShaderMaterial;
  private texture: THREE.DataTexture | null = null;
  private fineTexture: THREE.DataTexture | null = null;
  private patch: THREE.Mesh | null = null;
  /** The sides and underside, a little darker than the top. */
  private sideMat = new THREE.MeshLambertMaterial({ color: 0xa6a6a4 });
  private endMat = new THREE.MeshLambertMaterial({ color: 0x959593 });
  private size = { w: 0, h: 0, t: 0 };
  private frame = 0;
  private light = new THREE.Vector3(0, 0.6, 0.8);
  /** Draw again on the next frame: only when something has changed, to spare the graphics chip. */
  private dirty = true;
  /** The sharper area, if there is one. */
  detail: Area | null = null;
  /** Called once the board just set has been drawn. */
  private drawn: (() => void) | null = null;

  constructor(private host: HTMLElement) {
    // Clear to nothing, so the page's own background (light or graphite) shows round the board.
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setClearColor(0x000000, 0);
    host.append(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(30, 1, 1, 10000);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.scene.add(this.board);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    this.scene.add(this.sun);
    const uniforms = () => ({
      uDepth: { value: null as THREE.Texture | null },
      uMap: { value: new THREE.Vector4(0, 0, 1, 1) },
      uFine: { value: null as THREE.Texture | null },
      uFineMap: { value: new THREE.Vector4(0, 0, 1, 1) },
      uFineArea: { value: new THREE.Vector4(0, 0, 0, 0) },
      uHasFine: { value: 0 },
      uPanelH: { value: 1 },
      uRes: { value: 1 },
      uFineRes: { value: 1 },
      uLight: { value: this.light.clone() },
      uMaxDepth: { value: 1 },
      uMode: { value: 0 },
      uSteps: { value: 32 },
      uGrid: { value: new THREE.Vector4(0, 0, 1, 1) },
      uGridRows: { value: 1 },
      uSurface: { value: new THREE.Vector3(SURFACE, SURFACE, SURFACE) },
    });
    this.material = new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms: uniforms(), defines: { PATCH: 0 } });
    this.patchMaterial = new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms: uniforms(), defines: { PATCH: 1 } });
    this.resize();
    this.controls.addEventListener('change', () => (this.dirty = true));
    const loop = () => {
      this.frame = requestAnimationFrame(loop);
      if (this.controls.update()) this.dirty = true;
      if (!this.dirty || !this.texture) return;
      this.dirty = false;
      this.renderer.render(this.scene, this.camera);
      if (this.drawn) {
        const f = this.drawn;
        this.drawn = null;
        f();
      }
    };
    loop();
  }

  /** Whether a board has been shown yet. */
  get ready(): boolean {
    return !!this.texture;
  }

  resize() {
    const r = this.host.getBoundingClientRect();
    this.renderer.setSize(Math.max(1, r.width), Math.max(1, r.height));
    this.camera.aspect = Math.max(1, r.width) / Math.max(1, r.height);
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  /** Both materials' uniforms, to set alike. */
  private set(name: string, value: unknown) {
    for (const m of [this.material, this.patchMaterial]) {
      const u = m.uniforms[name];
      if (u.value instanceof THREE.Vector3 || u.value instanceof THREE.Vector4) u.value.copy(value as never);
      else u.value = value;
    }
  }

  /**
   * Show a board of `width` × `height` mm and `thickness` mm, its top cut to
   * the depth map `map` (from the worker). Any sharper area is dropped: it
   * belonged to the board as it was.
   */
  setBoard(map: ReliefResult, width: number, height: number, thickness: number, drawn?: () => void) {
    this.drawn = drawn ?? null;
    const first = !this.texture;
    const resized = this.size.w !== width || this.size.h !== height || this.size.t !== thickness;
    this.size = { w: width, h: height, t: thickness };
    this.setDetail(null);
    for (const child of [...this.board.children]) {
      this.board.remove(child);
      if (child instanceof THREE.Mesh) child.geometry.dispose();
    }
    this.texture?.dispose();
    this.texture = mapTexture(map);
    this.set('uDepth', this.texture);
    this.set('uMap', new THREE.Vector4(map.x0, map.y0, map.cols * map.res, map.rows * map.res));
    this.set('uRes', map.res);
    this.set('uPanelH', height);
    this.set('uMaxDepth', map.maxDepth);
    this.board.add(mapMesh(map, { x0: 0, y0: 0, x1: width, y1: height }, height, this.material));

    // The sides and underside, at the real thickness.
    const { sideMat, endMat } = this;
    const t = thickness;
    const side = (w: number, mat: THREE.Material, place: (g: THREE.PlaneGeometry) => void) => {
      const g = new THREE.PlaneGeometry(w, t);
      place(g);
      this.board.add(new THREE.Mesh(g, mat));
    };
    side(width, sideMat, (g) => g.rotateX(Math.PI / 2).translate(width / 2, 0, -t / 2)); // front
    side(width, sideMat, (g) => g.rotateX(-Math.PI / 2).translate(width / 2, height, -t / 2)); // back
    side(height, endMat, (g) => g.rotateX(Math.PI / 2).rotateZ(-Math.PI / 2).translate(0, height / 2, -t / 2)); // left
    side(height, endMat, (g) => g.rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(width, height / 2, -t / 2)); // right
    const under = new THREE.PlaneGeometry(width, height);
    under.rotateX(Math.PI).translate(width / 2, height / 2, -t);
    this.board.add(new THREE.Mesh(under, endMat));

    this.applyLight();
    if (first || resized) this.view('fit');
    this.dirty = true;
  }

  /**
   * Get the graphics chip's programs ready, on a stand-in board, while the
   * real one is still being worked out, so the two happen side by side. Where
   * the browser can, this is done without holding up the page at all.
   */
  async prepare() {
    const map: ReliefResult = { id: 0, x0: 0, y0: 0, cols: 1, rows: 1, res: 1, maxDepth: 0, half: new Uint16Array(1) };
    const t = mapTexture(map);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.55), new THREE.DirectionalLight(0xffffff, 1.6));
    for (const m of [this.material, this.patchMaterial]) {
      m.uniforms.uDepth.value = t;
      m.uniforms.uFine.value = t;
      scene.add(mapMesh(map, { x0: 0, y0: 0, x1: 1, y1: 1 }, 1, m));
    }
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.sideMat), new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.endMat));
    await this.renderer.compileAsync(scene, this.camera).catch(() => {});
    for (const m of [this.material, this.patchMaterial])
      for (const u of ['uDepth', 'uFine']) if (m.uniforms[u].value === t) m.uniforms[u].value = null;
    t.dispose();
  }

  /** Show a sharper map over its area, or (null) go back to the board's own. */
  setDetail(map: ReliefResult | null, area: Area | null = null) {
    if (this.patch) {
      this.board.remove(this.patch);
      this.patch.geometry.dispose();
      this.patch = null;
    }
    this.fineTexture?.dispose();
    this.fineTexture = null;
    this.detail = null;
    this.set('uHasFine', 0);
    if (map && area) {
      this.fineTexture = mapTexture(map);
      this.detail = area;
      this.set('uFine', this.fineTexture);
      this.set('uFineMap', new THREE.Vector4(map.x0, map.y0, map.cols * map.res, map.rows * map.res));
      this.set('uFineArea', new THREE.Vector4(area.x0, area.y0, area.x1, area.y1));
      this.set('uFineRes', map.res);
      this.set('uHasFine', 1);
      this.patch = mapMesh(map, area, this.size.h, this.patchMaterial);
      this.board.add(this.patch);
    }
    this.dirty = true;
  }

  /**
   * The part of the board on screen, mm from the panel's top-left corner: where
   * the view's edges meet the board, kept within the board.
   */
  areaInView(): Area | null {
    const { w, h } = this.size;
    if (!w || !h) return null;
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const xs: number[] = [];
    const ys: number[] = [];
    let missed = false;
    for (let a = -1; a <= 1; a += 0.5)
      for (let b = -1; b <= 1; b += 0.5) {
        if (Math.abs(a) < 1 && Math.abs(b) < 1) continue; // the edges of the view are enough
        ray.setFromCamera(new THREE.Vector2(a, b), this.camera);
        const hit = ray.ray.intersectPlane(plane, new THREE.Vector3());
        if (!hit) {
          missed = true; // looking out past the board towards the horizon
          continue;
        }
        xs.push(hit.x);
        ys.push(hit.y);
      }
    if (missed || !xs.length) return { x0: 0, y0: 0, x1: w, y1: h };
    const x0 = Math.max(0, Math.min(...xs));
    const x1 = Math.min(w, Math.max(...xs));
    const yb = Math.max(0, Math.min(...ys));
    const yt = Math.min(h, Math.max(...ys));
    if (x1 <= x0 || yt <= yb) return null; // the board is not in view
    return { x0, x1, y0: h - yt, y1: h - yb };
  }

  /**
   * The light: `across` from −90 (from the left) through 0 (from the back,
   * the top of the panel) to 90 (from the right); `height` in degrees above
   * the board.
   */
  setLight(across: number, height: number) {
    const a = (across * Math.PI) / 180;
    const e = (height * Math.PI) / 180;
    this.light.set(Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)).normalize();
    this.applyLight();
  }

  private applyLight() {
    const { w, h } = this.size;
    this.sun.position.set(w / 2 + this.light.x * 1000, h / 2 + this.light.y * 1000, this.light.z * 1000);
    this.sun.target.position.set(w / 2, h / 2, 0);
    this.sun.target.updateMatrixWorld();
    this.set('uLight', this.light);
    this.dirty = true;
  }

  setColouring(c: Colouring) {
    this.set('uMode', c === 'depth' ? 1 : 0);
    this.dirty = true;
  }

  /** Stand back to see the whole board, look straight down, or look along it from the front. */
  view(which: 'fit' | 'top' | 'front') {
    const { w, h } = this.size;
    const centre = new THREE.Vector3(w / 2, h / 2, 0);
    // Far enough back for the whole board to fill most of the view.
    const dist = (Math.max(w / this.camera.aspect, h) / 2 / Math.tan((this.camera.fov * Math.PI) / 360)) * 1.3;
    const dir =
      which === 'top' ? new THREE.Vector3(0, -0.0001, 1) : which === 'front' ? new THREE.Vector3(0, -1, 0.35) : new THREE.Vector3(0, -0.75, 1);
    this.controls.target.copy(centre);
    this.camera.position.copy(centre).add(dir.normalize().multiplyScalar(dist));
    this.controls.update();
    this.dirty = true;
  }

  /** The current picture, as a PNG data URL (for checking). */
  snapshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.controls.dispose();
    this.texture?.dispose();
    this.fineTexture?.dispose();
    this.material.dispose();
    this.patchMaterial.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
