// The 3D view of the board (three.js). Loaded only when the 3D view is opened.
//
// The board lies flat with its top surface at height 0: x to the right, y
// from the front edge (nearest the carver, the bottom of the panel on screen)
// to the back, z up. Its top is a fine grid pushed down by the depth map; each
// point is shaded from the depth map itself, so the walls of every cut catch
// or lose the light, and shadows are traced across the cuts towards the light.
//
// Mouse, as in Kiri:Moto: left-drag orbits, right-drag pans, the wheel zooms.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { oakCanvas } from './oak';
import type { Relief } from './relief';

export type Colouring = 'wood' | 'depth';

const VERTEX = /* glsl */ `
uniform sampler2D uDepth;
varying vec2 vUv;
varying vec3 vPos;
void main() {
  vUv = uv;
  vec3 p = position;
  p.z -= texture2D(uDepth, uv).r;
  vPos = p;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uDepth;
uniform sampler2D uOak;  // the board's oak figure
uniform vec2 uTexel;     // one cell, in uv
uniform float uRes;      // one cell, in mm
uniform vec2 uSize;      // board width and depth front to back, mm
uniform vec3 uLight;     // towards the light
uniform float uMaxDepth;
uniform int uMode;       // 0 wood, 1 depth colours
varying vec2 vUv;
varying vec3 vPos;

float height(vec2 uv) { return -texture2D(uDepth, uv).r; }

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
  float hl = height(vUv - vec2(uTexel.x, 0.0));
  float hr = height(vUv + vec2(uTexel.x, 0.0));
  float hd = height(vUv - vec2(0.0, uTexel.y));
  float hu = height(vUv + vec2(0.0, uTexel.y));
  vec3 n = normalize(vec3((hl - hr) / (2.0 * uRes), (hd - hu) / (2.0 * uRes), 1.0));
  float h0 = height(vUv);

  // Shadow: walk from here towards the light until the ray clears the top surface.
  float lit = 1.0;
  float lxy = length(uLight.xy);
  if (h0 < -0.001 && lxy > 0.0001) {
    vec2 dir = uLight.xy / lxy;
    float rise = uLight.z / lxy;
    float reach = -h0 / rise;
    for (int i = 1; i <= 32; i++) {
      float s = reach * float(i) / 32.0;
      float ray = h0 + s * rise;
      if (height(vUv + dir * s / uSize) > ray + 0.003) { lit = 0.0; break; }
    }
  }

  // Oak, the same figure as the Proof view (oak.ts).
  vec3 wood = texture2D(uOak, vUv).rgb;
  float depth = -h0;
  vec3 base = wood;
  if (uMode == 1 && depth > 0.005) base = depthColour(clamp(depth / max(uMaxDepth, 0.001), 0.0, 1.0));

  // The flat top keeps its natural brightness whatever the light's height; walls
  // turned towards the light come up brighter, walls turned away and shadows go dark.
  vec3 L = normalize(uLight);
  float diffuse = max(dot(n, L), 0.0) * lit;
  float ratio = diffuse / max(L.z, 0.12);
  vec3 colour = base * (0.28 + 0.72 * min(ratio, 1.45));
  gl_FragColor = vec4(colour, 1.0);
}`;

export class Board3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private board = new THREE.Group();
  private sun = new THREE.DirectionalLight(0xffffff, 1.6);
  private material: THREE.ShaderMaterial | null = null;
  private texture: THREE.DataTexture | null = null;
  /** The oak figure, made again only when the board changes size. */
  private oak: { key: string; texture: THREE.CanvasTexture } | null = null;
  private size = { w: 100, h: 100, t: 20 };
  private frame = 0;
  private light = new THREE.Vector3(0, 0.6, 0.8);
  /** Draw again on the next frame: only when something has changed, to spare the graphics chip. */
  private dirty = true;

  constructor(private host: HTMLElement) {
    // Clear to nothing, so the page's own background (light or graphite) shows round the board.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
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
    this.resize();
    this.controls.addEventListener('change', () => (this.dirty = true));
    const loop = () => {
      this.frame = requestAnimationFrame(loop);
      if (this.controls.update()) this.dirty = true;
      if (!this.dirty) return;
      this.dirty = false;
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  resize() {
    const r = this.host.getBoundingClientRect();
    this.renderer.setSize(Math.max(1, r.width), Math.max(1, r.height));
    this.camera.aspect = Math.max(1, r.width) / Math.max(1, r.height);
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  /** Show a board of `width` × `height` mm and `thickness` mm, its top cut to `relief`. */
  setBoard(relief: Relief, width: number, height: number, thickness: number) {
    const first = !this.material;
    const resized = this.size.w !== width || this.size.h !== height || this.size.t !== thickness;
    this.size = { w: width, h: height, t: thickness };
    for (const child of [...this.board.children]) {
      this.board.remove(child);
      if (child instanceof THREE.Mesh) child.geometry.dispose();
    }
    this.texture?.dispose();
    this.material?.dispose();

    // The depth map as a texture, front row first (texture rows run front to back).
    const { cols, rows } = relief;
    const data = new Uint16Array(cols * rows);
    for (let j = 0; j < rows; j++) {
      const src = j * cols;
      const dst = (rows - 1 - j) * cols;
      for (let i = 0; i < cols; i++) data[dst + i] = THREE.DataUtils.toHalfFloat(relief.depth[src + i]);
    }
    this.texture = new THREE.DataTexture(data, cols, rows, THREE.RedFormat, THREE.HalfFloatType);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;

    // The oak, over the same area as the depth map (from the panel's top-left corner).
    const oakKey = `${cols * relief.res}x${rows * relief.res}x${height}`;
    if (this.oak?.key !== oakKey) {
      this.oak?.texture.dispose();
      const texture = new THREE.CanvasTexture(oakCanvas(cols * relief.res, rows * relief.res, height));
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      this.oak = { key: oakKey, texture };
    }

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uDepth: { value: this.texture },
        uOak: { value: this.oak.texture },
        uTexel: { value: new THREE.Vector2(1 / cols, 1 / rows) },
        uRes: { value: relief.res },
        uSize: { value: new THREE.Vector2(cols * relief.res, rows * relief.res) },
        uLight: { value: this.light.clone() },
        uMaxDepth: { value: relief.maxDepth },
        uMode: { value: 0 },
      },
    });

    // The top: a fine grid, pushed down where the wood is cut.
    // The shape comes from about 700 points along the longer side; the fine detail
    // (hairlines, the walls of each cut) is shaded from the full depth map.
    const along = Math.max(cols, rows);
    const seg = (n: number) => Math.max(1, Math.round((n / along) * Math.min(along, 700)));
    const top = new THREE.PlaneGeometry(cols * relief.res, rows * relief.res, seg(cols), seg(rows));
    top.translate((cols * relief.res) / 2, (rows * relief.res) / 2, 0);
    this.board.add(new THREE.Mesh(top, this.material));

    // The sides and underside, at the real thickness.
    const sideMat = new THREE.MeshLambertMaterial({ color: 0xc49a63 });
    const endMat = new THREE.MeshLambertMaterial({ color: 0xa97f4b }); // end grain, a little darker
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
    if (this.material) this.material.uniforms.uLight.value.copy(this.light);
    this.dirty = true;
  }

  setColouring(c: Colouring) {
    if (this.material) this.material.uniforms.uMode.value = c === 'depth' ? 1 : 0;
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
    this.material?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
