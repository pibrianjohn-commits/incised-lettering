// The lid in 3D (ornament/design/CARD_05_3d_view.md), with three.js, on the
// lettering's 3D view's machinery (view3d.ts): each place's surface is a fine
// grid pushed in by its depth map from the worker (relief.ts), shaded from
// the depths themselves so every wall catches or loses the light, with
// shadows traced across the cuts towards it. Each place is set where it sits
// on the box: the field level, the hips falling away at their slopes.
//
// One low light, swung round the lid and raised or lowered: ebony relief
// reads only by raking light. Finishes in colour: ebony a near-black satin,
// gold, white gold, pearl a soft white, boxwood a pale yellow.
//
// Mouse, as in the lettering's 3D view: left-drag orbits, right-drag pans,
// the wheel zooms. Loaded only when the 3D view is first opened.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { band } from '../view3d';
import type { Place } from './model';
import { onLid, type Frame, type LidResult, type Vec3 } from './relief';

const SHADER_COMMON = /* glsl */ `
uniform sampler2D uDepth;
uniform sampler2D uFinish;
uniform vec2 uMapSize;   // the map's width and height, mm
uniform vec2 uSize;      // the place's width and height, mm
uniform vec3 uO;
uniform vec3 uU;
uniform vec3 uV;
uniform vec3 uN;
float depthAt(vec2 q) { return texture2D(uDepth, q / uMapSize).r; }
`;

const VERTEX = /* glsl */ `
${SHADER_COMMON}
attribute float band;
uniform vec2 uStep;
uniform float uGridRows;
varying vec2 vP;
varying vec3 vW;
void main() {
  vec2 q = min(vec2(position.x * uStep.x, min(position.y + band, uGridRows) * uStep.y), uSize);
  vP = q;
  vec3 w = uO + q.x * uU + q.y * uV - depthAt(q) * uN;
  vW = w;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const FRAGMENT = /* glsl */ `
${SHADER_COMMON}
uniform float uRes;
uniform vec3 uLight;   // towards the light, on the lid
uniform int uSteps;
uniform vec3 uBase[5];
uniform vec3 uShine[5]; // strength, sharpness, metal (1) or not (0)
varying vec2 vP;
varying vec3 vW;

float height(vec2 q) { return -depthAt(q); }

void main() {
  float fi = floor(texture2D(uFinish, vP / uMapSize).r * 255.0 + 0.5);
  if (fi > 250.0) discard; // outside the place's outline
  // Seen from underneath (looking up under a hip): plain and dark.
  if (dot(cameraPosition - vW, uN) < 0.0) { gl_FragColor = vec4(0.05, 0.045, 0.04, 1.0); return; }
  int f = int(fi);
  vec3 base = uBase[0];
  vec3 shine = uShine[0];
  for (int i = 1; i < 5; i++) if (i == f) { base = uBase[i]; shine = uShine[i]; }

  float e = uRes;
  float hx = (height(vP + vec2(e, 0.0)) - height(vP - vec2(e, 0.0))) / (2.0 * e);
  float hy = (height(vP + vec2(0.0, e)) - height(vP - vec2(0.0, e))) / (2.0 * e);
  vec3 n = normalize(cross(uU + hx * uN, uV + hy * uN));
  if (dot(n, uN) < 0.0) n = -n;

  // Shadow: walk across the place towards the light until the ray clears its top.
  vec3 L = normalize(uLight);
  vec3 Ll = vec3(dot(L, uU), dot(L, uV), dot(L, uN));
  float lit = Ll.z > 0.0 ? 1.0 : 0.0;
  float h0 = height(vP);
  float lxy = length(Ll.xy);
  if (lit > 0.0 && h0 < -0.001 && lxy > 0.0001) {
    vec2 dir = Ll.xy / lxy;
    float rise = Ll.z / lxy;
    float reach = min(-h0 / rise, 40.0);
    for (int i = 1; i <= uSteps; i++) {
      float s = reach * float(i) / float(uSteps);
      if (height(vP + dir * s) > h0 + s * rise + 0.003) { lit = 0.0; break; }
    }
  }

  // The level top keeps its brightness whatever the light's height; walls and
  // hips turned to the light come up brighter, those turned away go dark.
  float diffuse = max(dot(n, L), 0.0) * lit;
  float ratio = min(diffuse / max(L.z, 0.1), 2.4);
  vec3 V = normalize(cameraPosition - vW);
  vec3 H = normalize(L + V);
  float spec = shine.x * pow(max(dot(n, H), 0.0), shine.y) * lit;
  vec3 specColour = shine.z > 0.5 ? base : vec3(1.0);
  float metal = shine.z;
  vec3 colour = base * (mix(0.22, 0.32, metal) + mix(0.78, 0.5, metal) * ratio) + specColour * spec;
  gl_FragColor = vec4(colour, 1.0);
}`;

/** Each finish's colour, and its shine: strength, sharpness, and whether it is a metal (its shine takes its colour). In the order of FINISHES. */
const LOOK: { base: [number, number, number]; shine: [number, number, number] }[] = [
  { base: [0.105, 0.094, 0.085], shine: [0.32, 26, 0] }, // ebony: a near-black satin
  { base: [0.86, 0.66, 0.26], shine: [0.9, 48, 1] }, // gold
  { base: [0.84, 0.82, 0.76], shine: [0.8, 48, 1] }, // white gold
  { base: [0.93, 0.92, 0.89], shine: [0.22, 14, 0] }, // pearl: a soft white
  { base: [0.93, 0.84, 0.56], shine: [0.1, 8, 0] }, // boxwood: a pale yellow
];

/** About this many grid points along the longest side of the lid: its shape; fine detail is shaded from the depths. */
const MESH = 900;

export type LidPlace = { place: Place; frame: Frame; w: number; h: number };

export class Lid3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private group = new THREE.Group();
  private textures: THREE.DataTexture[] = [];
  private materials: THREE.ShaderMaterial[] = [];
  private frame = 0;
  private light = new THREE.Vector3(-1, 0, 0.2);
  private dirty = true;
  private shown = false;
  private bounds = new THREE.Box3(new THREE.Vector3(0, -100, -10), new THREE.Vector3(200, 0, 0));
  private drawn: (() => void) | null = null;
  /** A place shown on its own: its edges, at its thickness, lit by the same light. */
  private sun = new THREE.DirectionalLight(0xffffff, 1.4);
  private edgeMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(0.105, 0.094, 0.085) });

  constructor(private host: HTMLElement) {
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
    this.controls.addEventListener('change', () => (this.dirty = true));
    this.scene.add(this.group);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.35), this.sun, this.sun.target);
    this.resize();
    const loop = () => {
      this.frame = requestAnimationFrame(loop);
      if (this.controls.update()) this.dirty = true;
      if (!this.dirty || !this.shown) return;
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

  get ready(): boolean {
    return this.shown;
  }

  resize() {
    const r = this.host.getBoundingClientRect();
    this.renderer.setSize(Math.max(1, r.width), Math.max(1, r.height));
    this.camera.aspect = Math.max(1, r.width) / Math.max(1, r.height);
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  private material(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: THREE.DoubleSide,
      uniforms: {
        uDepth: { value: null },
        uFinish: { value: null },
        uMapSize: { value: new THREE.Vector2(1, 1) },
        uSize: { value: new THREE.Vector2(1, 1) },
        uO: { value: new THREE.Vector3() },
        uU: { value: new THREE.Vector3(1, 0, 0) },
        uV: { value: new THREE.Vector3(0, -1, 0) },
        uN: { value: new THREE.Vector3(0, 0, 1) },
        uStep: { value: new THREE.Vector2(1, 1) },
        uGridRows: { value: 1 },
        uRes: { value: 1 },
        uLight: { value: this.light.clone() },
        uSteps: { value: 48 },
        uBase: { value: LOOK.map((l) => new THREE.Vector3(...l.base)) },
        uShine: { value: LOOK.map((l) => new THREE.Vector3(...l.shine)) },
      },
    });
  }

  /** Get the graphics chip's program ready, on a stand-in, while the lid is still being worked out. */
  async prepare() {
    const m = this.material();
    const d = new THREE.DataTexture(new Uint16Array(1), 1, 1, THREE.RedFormat, THREE.HalfFloatType);
    const f = new THREE.DataTexture(new Uint8Array(1), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
    d.needsUpdate = f.needsUpdate = true;
    m.uniforms.uDepth.value = d;
    m.uniforms.uFinish.value = f;
    const scene = new THREE.Scene();
    const b = band(1);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', b.geometry.getAttribute('position'));
    g.setIndex(b.geometry.getIndex());
    g.setAttribute('band', new THREE.InstancedBufferAttribute(new Float32Array(1), 1));
    g.instanceCount = 1;
    scene.add(new THREE.Mesh(g, m));
    await this.renderer.compileAsync(scene, this.camera).catch(() => {});
    m.dispose();
    d.dispose();
    f.dispose();
  }

  /**
   * Show the lid: each place's map from the worker, set where it sits.
   * `edges`: a place shown on its own, flat, has its edges drawn down to this
   * thickness. `drawn` is called once it is on screen.
   */
  setLid(result: LidResult, places: LidPlace[], edges: number | null, drawn?: () => void) {
    this.drawn = drawn ?? null;
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      if (child instanceof THREE.Mesh) child.geometry.dispose();
    }
    for (const t of this.textures) t.dispose();
    for (const m of this.materials) m.dispose();
    this.textures = [];
    this.materials = [];
    const longest = Math.max(1, ...places.map((p) => Math.max(p.w, p.h)));
    const box = new THREE.Box3();
    for (const map of result.maps) {
      const at = places.find((p) => p.place === map.place);
      if (!at) continue;
      const depth = new THREE.DataTexture(map.half, map.cols, map.rows, THREE.RedFormat, THREE.HalfFloatType);
      depth.magFilter = depth.minFilter = THREE.LinearFilter;
      depth.needsUpdate = true;
      const finish = new THREE.DataTexture(map.finish, map.cols, map.rows, THREE.RedFormat, THREE.UnsignedByteType);
      finish.magFilter = finish.minFilter = THREE.NearestFilter;
      finish.unpackAlignment = 1;
      finish.needsUpdate = true;
      this.textures.push(depth, finish);
      const m = this.material();
      this.materials.push(m);
      const u = m.uniforms;
      u.uDepth.value = depth;
      u.uFinish.value = finish;
      u.uMapSize.value.set(map.cols * result.res, map.rows * result.res);
      u.uSize.value.set(at.w, at.h);
      u.uO.value.set(...at.frame.o);
      u.uU.value.set(...at.frame.u);
      u.uV.value.set(...at.frame.v);
      u.uN.value.set(...at.frame.n);
      u.uRes.value = result.res;
      u.uLight.value.copy(this.light);
      // The grid: as fine across this place as across the longest side of the lid.
      const sx = Math.max(1, Math.round((at.w / longest) * MESH));
      const sy = Math.max(1, Math.round((at.h / longest) * MESH));
      const b = band(sx);
      const count = Math.ceil(sy / b.rows);
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', b.geometry.getAttribute('position'));
      g.setIndex(b.geometry.getIndex());
      g.setAttribute('band', new THREE.InstancedBufferAttribute(Float32Array.from({ length: count }, (_, i) => i * b.rows), 1));
      g.instanceCount = count;
      u.uStep.value.set(at.w / sx, at.h / sy);
      u.uGridRows.value = sy;
      const corners = [onLid(at.frame, 0, 0), onLid(at.frame, at.w, 0), onLid(at.frame, 0, at.h), onLid(at.frame, at.w, at.h), onLid(at.frame, 0, 0, Math.max(map.maxDepth, 0.01))];
      const pb = new THREE.Box3().setFromPoints(corners.map((c: Vec3) => new THREE.Vector3(...c)));
      box.union(pb);
      g.boundingBox = pb;
      g.boundingSphere = pb.getBoundingSphere(new THREE.Sphere());
      const mesh = new THREE.Mesh(g, m);
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    if (edges !== null && places.length === 1) {
      const { w, h } = places[0];
      const t = edges;
      const side = (len: number, place: (g: THREE.PlaneGeometry) => void) => {
        const g = new THREE.PlaneGeometry(len, t);
        place(g);
        this.group.add(new THREE.Mesh(g, this.edgeMat));
      };
      side(w, (g) => g.rotateX(Math.PI / 2).translate(w / 2, -h, -t / 2)); // front
      side(w, (g) => g.rotateX(-Math.PI / 2).translate(w / 2, 0, -t / 2)); // back
      side(h, (g) => g.rotateX(Math.PI / 2).rotateZ(-Math.PI / 2).translate(0, -h / 2, -t / 2)); // left
      side(h, (g) => g.rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(w, -h / 2, -t / 2)); // right
      box.expandByPoint(new THREE.Vector3(0, 0, -t));
    }
    const first = !this.shown;
    const moved = !box.equals(this.bounds);
    this.bounds = box;
    this.shown = true;
    this.setLight(...this.lightAngles);
    if (first || moved) this.view('fit');
    this.dirty = true;
  }

  /**
   * The light: `from` in degrees round the lid, 0 from the back, −90 from the
   * left, 90 from the right, ±180 from the front; `height` in degrees above
   * the lid.
   */
  private lightAngles: [number, number] = [-90, 8];
  setLight(from: number, height: number) {
    this.lightAngles = [from, height];
    const a = (from * Math.PI) / 180;
    const e = (height * Math.PI) / 180;
    this.light.set(Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)).normalize();
    for (const m of this.materials) m.uniforms.uLight.value.copy(this.light);
    const c = this.bounds.getCenter(new THREE.Vector3());
    this.sun.position.copy(c).addScaledVector(this.light, 1000);
    this.sun.target.position.copy(c);
    this.sun.target.updateMatrixWorld();
    this.dirty = true;
  }

  /** Stand back to see the whole lid, look straight down, or look along it from the front. */
  view(which: 'fit' | 'top' | 'front') {
    const centre = this.bounds.getCenter(new THREE.Vector3());
    centre.z = 0;
    const size = this.bounds.getSize(new THREE.Vector3());
    const dist = (Math.max(size.x / this.camera.aspect, size.y) / 2 / Math.tan((this.camera.fov * Math.PI) / 360)) * 1.2;
    const dir = which === 'top' ? new THREE.Vector3(0, -0.0001, 1) : which === 'front' ? new THREE.Vector3(0, -1, 0.35) : new THREE.Vector3(0, -0.75, 1);
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
    for (const t of this.textures) t.dispose();
    for (const m of this.materials) m.dispose();
    this.edgeMat.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
