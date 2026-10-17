// The lid in 3D (ornament/design/CARD_05_3d_view.md): every place's surface
// cut to its layers' levels, and where each place sits on the assembled lid.
// Worked out without the browser, so the tests use exactly what the view
// shows; the heavy part runs in the 3D view's worker (relief.worker.ts).
//
// A place's surface is a grid of square cells `res` mm across over its own
// mm (as its file has them: x across, y down from its top edge). Each cell
// holds how deep it is cut, and which finish shows there. Later layers win
// where they overlap, as the lid add-on builds them. A square edge is a
// square wall; a V edge is a wall at the V-bit's angle, sloping on the deeper
// side of the layer's outline, as the bit leaves it.

import { FINISHES, PLACES, type Design, type Panel, type Place, type Ring } from './model';
import { layerRings, pathRings } from './svgfile';
import { lidLayout, slotPanel, type Lid } from './lid';

/** Cells outside the place's outline. */
export const OUTSIDE = 255;

/** One place's surface, ready for the view. Rows from the place's top edge (y = 0) down. */
export interface PlaceMap {
  place: Place;
  cols: number;
  rows: number;
  res: number;
  /** mm below the surface, per cell. */
  depth: Float32Array;
  /** Index into FINISHES per cell, or OUTSIDE. */
  finish: Uint8Array;
  maxDepth: number;
}

/** What one place needs to be cut: its outline and its layers, in its own mm. Plain numbers, quick to hand to the worker. */
export interface PlaceCut {
  place: Place;
  w: number;
  h: number;
  outline: Ring[];
  layers: { rings: Ring[]; level: number; v: boolean; finish: number }[];
}

export function placeCut(panel: Panel, design: Design | null): PlaceCut {
  const layers = (design?.layers ?? []).map((l) => {
    const { rings, twin } = layerRings(design!, l);
    return { rings: [...rings, ...twin], level: l.level, v: l.edge === 'v', finish: FINISHES.indexOf(l.finish) };
  });
  return { place: panel.place, w: panel.w, h: panel.h, outline: pathRings(panel.outline).rings, layers };
}

/** About this many cells for the whole lid, so an ordinary laptop draws it smoothly. */
export const LID_CELLS = 2_500_000;
/** No finer than this, mm. */
export const FINEST = 0.05;
/** No more cells than this along a side (the graphics chip's limit for a picture). */
const MAX_SIDE = 4096;

/** One cell size for every place, so the lid is equally sharp all over. */
export function lidRes(cuts: { w: number; h: number }[], cells = LID_CELLS): number {
  const area = cuts.reduce((s, c) => s + c.w * c.h, 0);
  const longest = cuts.reduce((m, c) => Math.max(m, c.w, c.h), 0);
  return Math.max(FINEST, Math.sqrt(area / cells), longest / MAX_SIDE);
}

/** Fill `into` (cols × rows) with `value` wherever a cell's centre is inside the rings, even-odd. */
function fill(rings: Ring[], cols: number, rows: number, res: number, visit: (k: number) => void) {
  const edges: [number, number, number, number][] = [];
  for (const r of rings)
    for (let i = 0; i < r.length; i++) {
      const a = r[i];
      const b = r[(i + 1) % r.length];
      if (a[1] !== b[1]) edges.push([a[0], a[1], b[0], b[1]]);
    }
  const xs: number[] = [];
  for (let j = 0; j < rows; j++) {
    const y = (j + 0.5) * res;
    xs.length = 0;
    for (const [ax, ay, bx, by] of edges) if ((ay <= y) !== (by <= y)) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil(xs[k] / res - 0.5));
      const i1 = Math.min(cols - 1, Math.floor(xs[k + 1] / res - 0.5));
      for (let i = i0; i <= i1; i++) visit(j * cols + i);
    }
  }
}

/** Distance from each cell's centre to the nearest edge of the rings, for cells within `reach`; the rest stay Infinity. */
function edgeDistance(rings: Ring[], cols: number, rows: number, res: number, reach: number): Float32Array {
  const dist = new Float32Array(cols * rows).fill(Infinity);
  for (const r of rings)
    for (let s = 0; s < r.length; s++) {
      const [ax, ay] = r[s];
      const [bx, by] = r[(s + 1) % r.length];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy || 1e-12;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach) / res));
      const i1 = Math.min(cols - 1, Math.floor((Math.max(ax, bx) + reach) / res));
      const j0 = Math.max(0, Math.floor((Math.min(ay, by) - reach) / res));
      const j1 = Math.min(rows - 1, Math.floor((Math.max(ay, by) + reach) / res));
      for (let j = j0; j <= j1; j++) {
        const y = (j + 0.5) * res;
        for (let i = i0; i <= i1; i++) {
          const x = (i + 0.5) * res;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
          const d = Math.hypot(x - ax - t * dx, y - ay - t * dy);
          const k = j * cols + i;
          if (d < dist[k]) dist[k] = d;
        }
      }
    }
  return dist;
}

/**
 * One place's surface. `vAngle` is the V-bit's included angle in degrees: a
 * V wall drops 1 ÷ tan(half of it) mm for every mm across.
 */
export function placeMap(cut: PlaceCut, res: number, vAngle: number, progress: (done: number) => void = () => {}): PlaceMap {
  const cols = Math.max(1, Math.ceil(cut.w / res - 1e-9));
  const rows = Math.max(1, Math.ceil(cut.h / res - 1e-9));
  const depth = new Float32Array(cols * rows);
  const finish = new Uint8Array(cols * rows).fill(OUTSIDE);
  const ebony = FINISHES.indexOf('ebony');
  // An outline that can't be read: the whole box, rather than nothing.
  if (cut.outline.length) fill(cut.outline, cols, rows, res, (k) => (finish[k] = ebony));
  else finish.fill(ebony);
  // One cell more all round, so neighbouring places meet without a hairline of background between them.
  const edge: number[] = [];
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      if (finish[k] !== OUTSIDE) continue;
      if ((i > 0 && finish[k - 1] === ebony) || (i < cols - 1 && finish[k + 1] === ebony) || (j > 0 && finish[k - cols] === ebony) || (j < rows - 1 && finish[k + cols] === ebony)) edge.push(k);
    }
  for (const k of edge) finish[k] = ebony;
  const steep = 1 / Math.tan((Math.max(1, Math.min(179, vAngle)) / 2) * (Math.PI / 180));
  const deepest = cut.layers.reduce((m, l) => Math.max(m, l.level), 0);
  const inside = new Uint8Array(cols * rows);
  cut.layers.forEach((l, n) => {
    inside.fill(0);
    fill(l.rings, cols, rows, res, (k) => (inside[k] = 1));
    if (!l.v) {
      for (let k = 0; k < inside.length; k++) if (inside[k] && finish[k] !== OUTSIDE) (depth[k] = l.level), (finish[k] = l.finish);
    } else {
      // The wall runs from the layer's outline at the surface it meets, down to the deeper of the two.
      const dist = edgeDistance(l.rings, cols, rows, res, deepest / steep + 2 * res);
      for (let k = 0; k < inside.length; k++) {
        if (finish[k] === OUTSIDE) continue;
        const was = depth[k];
        if (inside[k]) {
          depth[k] = was < l.level ? Math.min(l.level, was + dist[k] * steep) : l.level;
          finish[k] = l.finish;
        } else if (was > l.level && dist[k] < Infinity) depth[k] = Math.min(was, l.level + dist[k] * steep);
      }
    }
    progress((n + 1) / cut.layers.length);
  });
  let maxDepth = 0;
  for (let k = 0; k < depth.length; k++) if (finish[k] !== OUTSIDE && depth[k] > maxDepth) maxDepth = depth[k];
  return { place: cut.place, cols, rows, res, depth, finish, maxDepth };
}

/** The depth at a point of a place, mm (the cell it falls in); null outside the outline. */
export function depthAt(m: PlaceMap, x: number, y: number): number | null {
  const i = Math.floor(x / m.res);
  const j = Math.floor(y / m.res);
  if (i < 0 || j < 0 || i >= m.cols || j >= m.rows) return null;
  const k = j * m.cols + i;
  return m.finish[k] === OUTSIDE ? null : m.depth[k];
}

// ---------------------------------------------------------------- the lid as assembled

export type Vec3 = [number, number, number];

/**
 * Where a place sits on the lid, in lid mm: X to the right, Y to the back,
 * Z up, the field's top at Z = 0 with its back-left corner at the origin. A
 * point x, y of the place, d deep, is at o + x·u + y·v − d·n.
 */
export interface Frame {
  o: Vec3;
  u: Vec3;
  v: Vec3;
  n: Vec3;
}

/** Shown when a hip's template says neither its slope nor its depth seen from above. */
export const NO_SLOPE = 'Export the templates again from Blender to see the lid in 3D';

/** A hip's slope in degrees down from the field: as the template says, or from its depth seen from above. */
export function hipSlope(p: Panel): number | null {
  if (p.slope !== null) return p.slope;
  if (p.planDepth !== null && p.planDepth <= p.h) return (Math.acos(p.planDepth / p.h) * 180) / Math.PI;
  return null;
}

const HIPS = ['hip-front', 'hip-back', 'hip-left', 'hip-right'] as const;

/** Whether the 3D view can show the lid: every hip saying how it slopes (one template on its own lies flat). */
export function lid3dReady(lid: Lid): { ok: true } | { ok: false; message: string } {
  if (!slotPanel(lid.places[lid.current])) return { ok: false, message: 'Open the lid (or a template) to see it in 3D.' };
  if (!lid.whole) return { ok: true };
  const older = HIPS.filter((h) => {
    const p = slotPanel(lid.places[h]);
    return !p || hipSlope(p) === null;
  });
  return older.length ? { ok: false, message: NO_SLOPE } : { ok: true };
}

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * Each place where it sits on the box: the field level, and each hip
 * against its field edge, falling away from it at its slope, as on the box.
 * One template on its own lies flat.
 */
export function lidFrames(lid: Lid): Partial<Record<Place, Frame>> {
  const out: Partial<Record<Place, Frame>> = {};
  const flat: Frame = { o: [0, 0, 0], u: [1, 0, 0], v: [0, -1, 0], n: [0, 0, 1] };
  if (!lid.whole) {
    if (slotPanel(lid.places[lid.current])) out[lid.current] = flat;
    return out;
  }
  // The hips seen from above, squashed across to how far they reach out at their slope.
  const layout = lidLayout(lid, 'above', (p) => Math.cos(((hipSlope(p) ?? 0) * Math.PI) / 180));
  for (const place of PLACES) {
    const m = layout[place];
    const p = slotPanel(lid.places[place]);
    if (!m || !p) continue;
    if (place === 'field') {
      out.field = flat;
      continue;
    }
    const s = ((hipSlope(p) ?? 0) * Math.PI) / 180;
    const [a, b, c, d, e, f] = m;
    // Lid plan y runs to the front; here Y runs to the back.
    const u: Vec3 = [a, -b, 0];
    // Down the hip: outward from the field edge seen from above, and down at its slope.
    const len = Math.hypot(c, d) || 1;
    const vv: Vec3 = [(c / len) * Math.cos(s), (-d / len) * Math.cos(s), -Math.sin(s)];
    let n = cross(u, vv);
    if (n[2] < 0) n = [-n[0], -n[1], -n[2]];
    out[place] = { o: [e, -f, 0], u, v: vv, n };
  }
  return out;
}

/** A point of a place, d deep, on the lid. */
export function onLid(f: Frame, x: number, y: number, d = 0): Vec3 {
  return [0, 1, 2].map((i) => f.o[i] + x * f.u[i] + y * f.v[i] - d * f.n[i]) as Vec3;
}

// ---------------------------------------------------------------- the work, for the worker

export interface LidJob {
  kind: 'ornament3d';
  id: number;
  cuts: PlaceCut[];
  vAngle: number;
}

export interface LidResult {
  id: number;
  res: number;
  /** Depths as half-precision numbers, as the graphics chip takes them. */
  maps: { place: Place; cols: number; rows: number; half: Uint16Array; finish: Uint8Array; maxDepth: number }[];
}

export function runLidJob(job: LidJob, progress: (done: number) => void = () => {}, toHalf: (v: number) => number): LidResult {
  const res = lidRes(job.cuts);
  const total = job.cuts.reduce((s, c) => s + c.w * c.h, 0) || 1;
  let before = 0;
  const maps = job.cuts.map((c) => {
    const share = (c.w * c.h) / total;
    const m = placeMap(c, res, job.vAngle, (f) => progress(before + share * f * 0.9));
    before += share * 0.9;
    const half = new Uint16Array(m.depth.length);
    for (let k = 0; k < half.length; k++) half[k] = toHalf(m.depth[k]);
    return { place: m.place, cols: m.cols, rows: m.rows, half, finish: m.finish, maxDepth: m.maxDepth };
  });
  progress(1);
  return { id: job.id, res, maps };
}

/** The lid's places as they are now, ready to cut. */
export function lidCuts(lid: Lid): PlaceCut[] {
  const frames = lidFrames(lid);
  return PLACES.flatMap((place) => {
    const sl = lid.places[place];
    const p = slotPanel(sl);
    return p && frames[place] ? [placeCut(p, sl?.design ?? null)] : [];
  });
}
