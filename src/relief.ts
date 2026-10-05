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

import { borderMarks } from './border';
import type { Contour } from './geometry';
import type { Layout } from './layout';
import type { MachineSettings, Pass } from './toolpath';

export interface Relief {
  cols: number;
  rows: number;
  /** Cell size, mm. */
  res: number;
  /** Depth in mm, row by row from the panel's top edge (as on screen), left to right. */
  depth: Float32Array;
  maxDepth: number;
}

/** A cell size that keeps the map to about `maxCells` cells along the longer side, and no finer than 0.04 mm. */
export function chooseRes(width: number, height: number, maxCells = 4096): number {
  return Math.max(0.04, Math.max(width, height) / maxCells);
}

function blank(width: number, height: number, res: number): Relief {
  const cols = Math.max(1, Math.ceil(width / res));
  const rows = Math.max(1, Math.ceil(height / res));
  return { cols, rows, res, depth: new Float32Array(cols * rows), maxDepth: 0 };
}

/**
 * Stamp one straight move of the V-bit, from a to b (depths positive, varying
 * evenly along the move). At a sideways distance s from the bit's axis the
 * cone cuts depth − s ÷ tan(half the bit angle).
 */
function stampSegment(r: Relief, ax: number, ay: number, ad: number, bx: number, by: number, bd: number, tanHalf: number) {
  const reach = Math.max(ad, bd) * tanHalf + r.res;
  if (Math.max(ad, bd) <= 0) return;
  const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach) / r.res));
  const x1 = Math.min(r.cols - 1, Math.floor((Math.max(ax, bx) + reach) / r.res));
  const y0 = Math.max(0, Math.floor((Math.min(ay, by) - reach) / r.res));
  const y1 = Math.min(r.rows - 1, Math.floor((Math.max(ay, by) + reach) / r.res));
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const half = r.res / 2; // the cell's deepest point: up to half a cell nearer the bit
  for (let j = y0; j <= y1; j++) {
    const py = (j + 0.5) * r.res;
    for (let i = x0; i <= x1; i++) {
      const px = (i + 0.5) * r.res;
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const s = Math.max(0, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) - half);
      const d = ad + t * (bd - ad) - s / tanHalf;
      const k = j * r.cols + i;
      if (d > r.depth[k]) r.depth[k] = d;
    }
  }
}

/** The board as the V-bit leaves it after the given passes. */
export function machinedRelief(passes: Pass[], width: number, height: number, m: MachineSettings, res = chooseRes(width, height)): Relief {
  const r = blank(width, height, res);
  const tanHalf = Math.tan(((m.toolAngle / 2) * Math.PI) / 180); // sideways reach per mm of depth
  for (const pass of passes)
    for (const cut of pass.cuts)
      for (let i = 1; i < cut.points.length; i++) {
        const a = cut.points[i - 1];
        const b = cut.points[i];
        stampSegment(r, a.x, a.y, -a.z, b.x, b.y, -b.z, tanHalf);
      }
  finish(r);
  return r;
}

/** Fill the cells inside closed outlines (holes, such as the inside of O, left out). */
function fillShapes(mask: Uint8Array, r: Relief, shapes: Contour[][]) {
  for (const contours of shapes) {
    let ymin = Infinity;
    let ymax = -Infinity;
    for (const c of contours) for (const p of c) [ymin, ymax] = [Math.min(ymin, p.y), Math.max(ymax, p.y)];
    const j0 = Math.max(0, Math.floor(ymin / r.res));
    const j1 = Math.min(r.rows - 1, Math.ceil(ymax / r.res));
    for (let j = j0; j <= j1; j++) {
      const y = (j + 0.5) * r.res;
      const xs: number[] = [];
      for (const c of contours)
        for (let a = 0, b = c.length - 1; a < c.length; b = a++) {
          const p = c[b];
          const q = c[a];
          if ((p.y > y) !== (q.y > y)) xs.push(p.x + ((y - p.y) * (q.x - p.x)) / (q.y - p.y));
        }
      xs.sort((u, v) => u - v);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil(xs[k] / r.res - 0.5));
        const i1 = Math.min(r.cols - 1, Math.floor(xs[k + 1] / r.res - 0.5));
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

/** For every cell inside the mask, the distance (mm) from its centre to the nearest cell outside. */
function distanceInside(mask: Uint8Array, r: Relief): Float64Array {
  const { cols, rows } = r;
  const INF = 1e20;
  const g = new Float64Array(cols * rows);
  for (let k = 0; k < g.length; k++) g[k] = mask[k] ? INF : 0;
  const n = Math.max(cols, rows);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) f[j] = g[j * cols + i];
    edt1d(f, rows, d, v, z);
    for (let j = 0; j < rows; j++) g[j * cols + i] = d[j];
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) f[i] = g[j * cols + i];
    edt1d(f, cols, d, v, z);
    for (let i = 0; i < cols; i++) g[j * cols + i] = Math.sqrt(d[i]) * r.res;
  }
  return g;
}

/** The board with every letter carved to the chisel angle, as the carver leaves it. */
export function finishedRelief(layout: Layout, m: MachineSettings, res?: number): Relief {
  const p = layout.project;
  const r = blank(p.panelWidth, p.panelHeight, res ?? chooseRes(p.panelWidth, p.panelHeight));
  const mask = new Uint8Array(r.cols * r.rows);
  const bm = borderMarks(p.border, p.panelWidth, p.panelHeight, { percent: p.datumPercent, minimum: p.datumMinimum });
  fillShapes(mask, r, [...layout.letters.map((l) => l.outline), ...layout.stops.map((s) => s.outline), ...(bm.outline.length ? [bm.outline] : [])]);
  const dist = distanceInside(mask, r);
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
  finish(r);
  return r;
}

function finish(r: Relief) {
  let max = 0;
  for (let k = 0; k < r.depth.length; k++) if (r.depth[k] > max) max = r.depth[k];
  r.maxDepth = max;
}

/** Depth at a point (mm), from the cell it falls in. */
export function depthAt(r: Relief, x: number, y: number): number {
  const i = Math.min(r.cols - 1, Math.max(0, Math.floor(x / r.res)));
  const j = Math.min(r.rows - 1, Math.max(0, Math.floor(y / r.res)));
  return r.depth[j * r.cols + i];
}
