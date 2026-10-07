// Depth maps of the board's top surface, for the 3D view.
//
// The surface is a grid of square cells `res` mm across. Each cell holds how
// deep the wood is cut there, in mm (0 = untouched). A cell stores the
// deepest cut anywhere within it, so even a hairline narrower than a cell
// still shows.
//
//  - Marked out: stamped from the exact cuts the G-code makes, with the V-bit's
//    cone. Nothing else, so it matches the saved file.
//  - Finished: every letter (and word stop, and incised border) carved to the
//    chisel angle: depth = distance to the letter's edge ÷ tan(half the angle),
//    the same rule as the valley depths. Scribed border lines stay as cut.
//
// A map covers the whole board, or just an area of it (for "Sharper"). Its
// size is held to about MAX_CELLS cells in all, whatever the board's shape,
// so a big board is never too much for an ordinary laptop (BRIEF.md,
// Decisions: "The 3D view"). The work is done in a worker (relief.worker.ts).

import { borderMarks } from './border';
import type { Contour } from './geometry';
import type { Border, Layout } from './layout';
import type { MachineSettings, Pass } from './toolpath';

export interface Relief {
  cols: number;
  rows: number;
  /** Cell size, mm. */
  res: number;
  /** Where the map's top-left corner is on the board, mm from the panel's top-left corner. */
  x0: number;
  y0: number;
  /** Depth in mm, row by row from the top edge (as on screen), left to right. */
  depth: Float32Array;
  maxDepth: number;
}

/** An area of the board, mm from the panel's top-left corner. */
export interface Area {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** About this many cells in a map, in all. */
export const MAX_CELLS = 2_000_000;
/** The finest cell, mm: full detail. */
export const FINEST = 0.04;
/** No more cells than this along either side (the graphics chip's limit for a picture). */
export const MAX_SIDE = 4096;

/** Called now and then with how far through the work is, 0 to 1. */
export type Progress = (done: number) => void;

/** A cell size that keeps a map of `width` × `height` mm to about `maxCells` cells in all, and no finer than full detail. */
export function chooseRes(width: number, height: number, maxCells = MAX_CELLS): number {
  return Math.max(FINEST, Math.sqrt((width * height) / maxCells), Math.max(width, height) / MAX_SIDE);
}

function blank(area: Area, res: number): Relief {
  const cols = Math.max(1, Math.ceil((area.x1 - area.x0) / res - 1e-9));
  const rows = Math.max(1, Math.ceil((area.y1 - area.y0) / res - 1e-9));
  return { cols, rows, res, x0: area.x0, y0: area.y0, depth: new Float32Array(cols * rows), maxDepth: 0 };
}

/**
 * Stamp one straight move of the V-bit, from a to b (depths positive, varying
 * evenly along the move). At a sideways distance s from the bit's axis the
 * cone cuts depth − s ÷ tan(half the bit angle).
 */
function stampSegment(r: Relief, ax: number, ay: number, ad: number, bx: number, by: number, bd: number, tanHalf: number) {
  if (Math.max(ad, bd) <= 0) return;
  const reach = Math.max(ad, bd) * tanHalf + r.res;
  const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - r.x0) / r.res));
  const x1 = Math.min(r.cols - 1, Math.floor((Math.max(ax, bx) + reach - r.x0) / r.res));
  const y0 = Math.max(0, Math.floor((Math.min(ay, by) - reach - r.y0) / r.res));
  const y1 = Math.min(r.rows - 1, Math.floor((Math.max(ay, by) + reach - r.y0) / r.res));
  if (x0 > x1 || y0 > y1) return; // outside this map
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const half = r.res / 2; // the cell's deepest point: up to half a cell nearer the bit
  const cot = 1 / tanHalf;
  const depth = r.depth;
  for (let j = y0; j <= y1; j++) {
    const py = r.y0 + (j + 0.5) * r.res;
    const row = j * r.cols;
    for (let i = x0; i <= x1; i++) {
      const px = r.x0 + (i + 0.5) * r.res;
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = px - (ax + t * dx);
      const ey = py - (ay + t * dy);
      const s = Math.sqrt(ex * ex + ey * ey) - half;
      const d = ad + t * (bd - ad) - (s > 0 ? s : 0) * cot;
      if (d > depth[row + i]) depth[row + i] = d;
    }
  }
}

/**
 * The cuts of the given passes packed into one list of numbers, quick to hand
 * to the worker: for each cut, how many points, then each point's x, y and
 * depth (mm, depth positive).
 */
export function packCuts(passes: Pass[]): Float32Array {
  let n = 0;
  for (const pass of passes) for (const cut of pass.cuts) n += 1 + 3 * cut.points.length;
  const out = new Float32Array(n);
  let k = 0;
  for (const pass of passes)
    for (const cut of pass.cuts) {
      out[k++] = cut.points.length;
      for (const q of cut.points) {
        out[k++] = q.x;
        out[k++] = q.y;
        out[k++] = -q.z;
      }
    }
  return out;
}

/** The board (or an area of it) as the V-bit leaves it after the given passes. */
export function machinedRelief(
  passes: Pass[],
  width: number,
  height: number,
  m: MachineSettings,
  res?: number,
  area: Area = { x0: 0, y0: 0, x1: width, y1: height },
  progress?: Progress,
): Relief {
  return machinedReliefPacked(packCuts(passes), m.toolAngle, area, res ?? chooseRes(area.x1 - area.x0, area.y1 - area.y0), progress);
}

/** The same, from cuts packed by packCuts. */
export function machinedReliefPacked(cuts: Float32Array, toolAngle: number, area: Area, res: number, progress?: Progress): Relief {
  const r = blank(area, res);
  const tanHalf = Math.tan(((toolAngle / 2) * Math.PI) / 180); // sideways reach per mm of depth
  let k = 0;
  let n = 0;
  while (k < cuts.length) {
    const count = cuts[k++];
    for (let i = 1; i < count; i++) {
      const a = k + 3 * (i - 1);
      stampSegment(r, cuts[a], cuts[a + 1], cuts[a + 2], cuts[a + 3], cuts[a + 4], cuts[a + 5], tanHalf);
    }
    k += 3 * count;
    if (progress && ++n % 64 === 0) progress(k / cuts.length);
  }
  finish(r);
  return r;
}

/** Closed shapes (each a list of contours) packed into one list of numbers: shapes, then for each its contours, then for each its points. */
export function packShapes(shapes: Contour[][]): Float32Array {
  const out: number[] = [shapes.length];
  for (const contours of shapes) {
    out.push(contours.length);
    for (const c of contours) {
      out.push(c.length);
      for (const q of c) out.push(q.x, q.y);
    }
  }
  return Float32Array.from(out);
}

export function unpackShapes(f: Float32Array): Contour[][] {
  let k = 0;
  const shapes: Contour[][] = [];
  const nShapes = f[k++];
  for (let s = 0; s < nShapes; s++) {
    const contours: Contour[] = [];
    const nc = f[k++];
    for (let c = 0; c < nc; c++) {
      const np = f[k++];
      const pts: Contour = [];
      for (let i = 0; i < np; i++, k += 2) pts.push({ x: f[k], y: f[k + 1] });
      contours.push(pts);
    }
    shapes.push(contours);
  }
  return shapes;
}

/** What the finished board is carved from: the letters' and word stops' outlines, and the border. */
export interface FinishedInput {
  shapes: Contour[][];
  width: number;
  height: number;
  border: Border;
  datum: { percent: number; minimum: number };
  /** Half the width of the widest stroke, mm: how far a letter's depth can depend on an edge. */
  widest: number;
}

export function finishedInput(layout: Layout): FinishedInput {
  const p = layout.project;
  return {
    shapes: [...layout.letters.map((l) => l.outline), ...layout.stops.map((s) => s.outline)],
    width: p.panelWidth,
    height: p.panelHeight,
    border: p.border,
    datum: { percent: p.datumPercent, minimum: p.datumMinimum },
    widest: Math.max(0, ...layout.letters.flatMap((l) => l.valleys.flat().map((q) => q.r))),
  };
}

/** Fill the cells inside closed outlines (holes, such as the inside of O, left out). */
function fillShapes(mask: Uint8Array, r: Relief, shapes: Contour[][]) {
  for (const contours of shapes) {
    let ymin = Infinity;
    let ymax = -Infinity;
    for (const c of contours) for (const p of c) [ymin, ymax] = [Math.min(ymin, p.y), Math.max(ymax, p.y)];
    const j0 = Math.max(0, Math.floor((ymin - r.y0) / r.res));
    const j1 = Math.min(r.rows - 1, Math.ceil((ymax - r.y0) / r.res));
    for (let j = j0; j <= j1; j++) {
      const y = r.y0 + (j + 0.5) * r.res;
      const xs: number[] = [];
      for (const c of contours)
        for (let a = 0, b = c.length - 1; a < c.length; b = a++) {
          const p = c[b];
          const q = c[a];
          if ((p.y > y) !== (q.y > y)) xs.push(p.x + ((y - p.y) * (q.x - p.x)) / (q.y - p.y));
        }
      xs.sort((u, v) => u - v);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - r.x0) / r.res - 0.5));
        const i1 = Math.min(r.cols - 1, Math.floor((xs[k + 1] - r.x0) / r.res - 0.5));
        for (let i = i0; i <= i1; i++) mask[j * r.cols + i] = 1;
      }
    }
  }
}

/** Squared distance transform along one line (Felzenszwalb & Huttenlocher). */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/**
 * For every cell inside the mask, the distance (mm) from its centre to the
 * nearest cell outside. The grid is kept in single precision (Float32), half
 * the memory of double; each line is worked in double, so nothing is lost.
 */
function distanceInside(mask: Uint8Array, r: Relief, progress?: Progress): Float32Array {
  const { cols, rows } = r;
  const INF = 1e20;
  const g = new Float32Array(cols * rows);
  for (let k = 0; k < g.length; k++) g[k] = mask[k] ? INF : 0;
  const n = Math.max(cols, rows);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let i = 0; i < cols; i++) {
    let any = false;
    for (let j = 0; j < rows; j++) {
      f[j] = g[j * cols + i];
      if (f[j]) any = true;
    }
    if (any) {
      edt1d(f, rows, d, v, z);
      for (let j = 0; j < rows; j++) g[j * cols + i] = d[j];
    }
    if (progress && i % 256 === 0) progress((0.5 * i) / cols);
  }
  for (let j = 0; j < rows; j++) {
    const row = j * cols;
    let any = false;
    for (let i = 0; i < cols; i++) {
      f[i] = g[row + i];
      if (f[i]) any = true;
    }
    if (any) {
      edt1d(f, cols, d, v, z);
      for (let i = 0; i < cols; i++) g[row + i] = Math.sqrt(d[i]) * r.res;
    }
    if (progress && j % 256 === 0) progress(0.5 + (0.5 * j) / rows);
  }
  return g;
}

/** The board (or an area of it) with every letter carved to the chisel angle, as the carver leaves it. */
export function finishedRelief(layout: Layout, m: MachineSettings, res?: number, area?: Area, progress?: Progress): Relief {
  return finishedReliefFrom(finishedInput(layout), m, res, area, progress);
}

export function finishedReliefFrom(input: FinishedInput, m: MachineSettings, res?: number, area?: Area, progress?: Progress): Relief {
  const want = area ?? { x0: 0, y0: 0, x1: input.width, y1: input.height };
  const cell = res ?? chooseRes(want.x1 - want.x0, want.y1 - want.y0);
  // A letter cut by the edge of an area carries on beyond it, and the depth
  // anywhere in it is set by its nearest edge, which may lie outside the
  // area. So the work is done over the area widened by the widest stroke,
  // whole cells each way, and trimmed back after.
  const pad = area ? Math.ceil(input.widest / cell) + 2 : 0;
  const r = blank({ x0: want.x0 - pad * cell, y0: want.y0 - pad * cell, x1: want.x1 + pad * cell, y1: want.y1 + pad * cell }, cell);
  const mask = new Uint8Array(r.cols * r.rows);
  const bm = borderMarks(input.border, input.width, input.height, input.datum);
  fillShapes(mask, r, [...input.shapes, ...(bm.outline.length ? [bm.outline] : [])]);
  progress?.(0.1);
  const dist = distanceInside(mask, r, progress && ((f) => progress(0.1 + 0.85 * f)));
  const cot = 1 / Math.tan(((m.chiselAngle / 2) * Math.PI) / 180);
  // The edge is about half a cell beyond the centre of the first cell outside it.
  for (let k = 0; k < mask.length; k++) if (mask[k]) r.depth[k] = Math.max(0, dist[k] - r.res / 2) * cot;
  // A scribed border is a cut line and stays as the bit left it.
  if (bm.scribes.length) {
    const tanHalf = Math.tan(((m.toolAngle / 2) * Math.PI) / 180);
    const d = Math.min(m.scribeDepth, 1);
    for (const c of bm.scribes)
      for (let i = 0; i < c.length; i++) {
        const a = c[i];
        const b = c[(i + 1) % c.length];
        stampSegment(r, a.x, a.y, d, b.x, b.y, d, tanHalf);
      }
  }
  const out = pad ? trim(r, pad, want) : r;
  finish(out);
  return out;
}

/** The map without `pad` cells round its edge. */
function trim(r: Relief, pad: number, want: Area): Relief {
  const t = blank(want, r.res);
  for (let j = 0; j < t.rows; j++) {
    const from = (j + pad) * r.cols + pad;
    t.depth.set(r.depth.subarray(from, from + t.cols), j * t.cols);
  }
  return t;
}

function finish(r: Relief) {
  let max = 0;
  for (let k = 0; k < r.depth.length; k++) if (r.depth[k] > max) max = r.depth[k];
  r.maxDepth = max;
}

/** Depth at a point (mm), from the cell it falls in. */
export function depthAt(r: Relief, x: number, y: number): number {
  const i = Math.min(r.cols - 1, Math.max(0, Math.floor((x - r.x0) / r.res)));
  const j = Math.min(r.rows - 1, Math.max(0, Math.floor((y - r.y0) / r.res)));
  return r.depth[j * r.cols + i];
}
