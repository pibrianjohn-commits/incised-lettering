// Letters that run into each other (BRIEF.md, Decisions: "Collisions"): two
// letters whose outlines touch or overlap, or come closer than the hairline
// cut is wide (so their hairlines would run together), on the same line or on
// different lines. Boxes are compared first, and outlines only where two
// boxes come within reach, so the check stays quick on an ordinary laptop.
//
// Layout only: nothing here reads the machine settings (CLAUDE.md, "One
// program; editions later"). The width the hairline cuts is handed in.

import { insideShape, type Pt } from './geometry';
import type { Layout, PlacedLetter } from './layout';
import type { Box } from './letters';

/** The width a V-bit cuts at a depth: 2 × depth × tan(half its angle), mm. */
export function cutWidth(depth: number, angleDeg: number): number {
  return 2 * depth * Math.tan((angleDeg * Math.PI) / 360);
}

/** The starting hairline, 0.2 mm deep with the 30° bit: about 0.11 mm wide. */
export const HAIRLINE = cutWidth(0.2, 30);

export interface Collision {
  /** The two letters by line and place in the line's text, "2:0|4:1": the same pair from one moment to the next. */
  key: string;
  /** The first of the two in reading order, and the second. */
  a: PlacedLetter;
  b: PlacedLetter;
  /** The outlines touch or overlap; else they only come closer than the hairline is wide. */
  touch: boolean;
  /** The closest the outlines come, mm (0 when they touch or overlap). */
  gap: number;
  /** Where they meet, mm. */
  spot: Pt;
}

/**
 * Every pair of letters that collide, in reading order of the first letter.
 * With `first` set, each pair is only found, not measured: its gap and spot
 * are from the first place they come too close, which is quicker where
 * letters overlap a long way (for trying fixes on a copy).
 */
export function findCollisions(layout: Layout, clearance = HAIRLINE, first = false): Collision[] {
  const out: Collision[] = [];
  const ls = layout.letters;
  for (let i = 0; i < ls.length; i++)
    for (let j = i + 1; j < ls.length; j++) {
      const a = ls[i];
      const b = ls[j];
      if (!near(a.box, b.box, clearance)) continue;
      const c = contact(a, b, clearance, 0, 0, first);
      if (!c.spot || c.gap >= clearance) continue;
      out.push({ key: `${a.line}:${a.pos}|${b.line}:${b.pos}`, a, b, touch: c.gap < 1e-6, gap: c.gap, spot: c.spot });
    }
  return out;
}

/**
 * How far `b` must move along `dir` (a unit step, such as straight down or
 * straight right) for the two outlines to be at least `target` apart, to the
 * next `step` up; null if not within `limit` mm.
 */
export function parting(a: PlacedLetter, b: PlacedLetter, dir: Pt, target: number, step: number, limit: number): number | null {
  // One place too close is enough to say they are not clear yet.
  const clear = (s: number) => contact(a, b, target, s * dir.x, s * dir.y, true, true).gap >= target;
  if (clear(0)) return 0;
  // Out until clear, then halve back to a hundredth of a millimetre.
  let lo = 0;
  let hi = step;
  while (!clear(hi)) {
    lo = hi;
    hi *= 2;
    if (hi > limit * 2) return null;
  }
  while (hi - lo > 0.005) {
    const m = (lo + hi) / 2;
    if (clear(m)) hi = m;
    else lo = m;
  }
  // Rounded up to the step, and checked there: outlines need not part evenly.
  for (let s = Math.ceil(hi / step - 1e-9) * step; s <= limit + 1e-9; s += step) {
    const r = Math.round(s / step) * step;
    if (clear(r)) return Number(r.toFixed(6));
  }
  return null;
}

/** Two boxes come within `reach` of each other. */
function near(a: Box, b: Box, reach: number): boolean {
  return a.x0 - reach <= b.x1 && b.x0 - reach <= a.x1 && a.y0 - reach <= b.y1 && b.y0 - reach <= a.y1;
}

const grow = (b: Box, r: number): Box => ({ x0: b.x0 - r, y0: b.y0 - r, x1: b.x1 + r, y1: b.y1 + r });
const shift = (b: Box, dx: number, dy: number): Box => ({ x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy });

/** A letter's outline edges, x0, y0, x1, y1 each, kept while the letter is in use. */
const edgeStore = new WeakMap<PlacedLetter, Float64Array>();
function edgesOf(l: PlacedLetter): Float64Array {
  let e = edgeStore.get(l);
  if (e) return e;
  let n = 0;
  for (const c of l.outline) n += c.length;
  e = new Float64Array(n * 4);
  let k = 0;
  for (const c of l.outline)
    for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
      e[k++] = c[j].x;
      e[k++] = c[j].y;
      e[k++] = c[i].x;
      e[k++] = c[i].y;
    }
  edgeStore.set(l, e);
  return e;
}

/**
 * A letter's edges that come into a region, sorted into square cells over the
 * region and `reach` round it, each edge in every cell within `reach` of it.
 * Edges are kept as their place in edgesOf.
 */
interface Grid {
  x0: number;
  y0: number;
  cell: number;
  nx: number;
  ny: number;
  cells: (number[] | undefined)[];
}
function gridIn(l: PlacedLetter, r: Box, reach: number): Grid {
  const e = edgesOf(l);
  const x0 = r.x0 - reach;
  const y0 = r.y0 - reach;
  const w = Math.max(0, r.x1 - r.x0) + 2 * reach;
  const h = Math.max(0, r.y1 - r.y0) + 2 * reach;
  const cell = Math.max(0.25, Math.sqrt((w * h) / 4096));
  const nx = Math.max(1, Math.ceil(w / cell));
  const ny = Math.max(1, Math.ceil(h / cell));
  const cells: (number[] | undefined)[] = new Array(nx * ny);
  const cx = (x: number) => Math.min(nx - 1, Math.max(0, Math.floor((x - x0) / cell)));
  const cy = (y: number) => Math.min(ny - 1, Math.max(0, Math.floor((y - y0) / cell)));
  for (let k = 0; k < e.length; k += 4) {
    const lx = Math.min(e[k], e[k + 2]);
    const hx = Math.max(e[k], e[k + 2]);
    const ly = Math.min(e[k + 1], e[k + 3]);
    const hy = Math.max(e[k + 1], e[k + 3]);
    if (hx < r.x0 || lx > r.x1 || hy < r.y0 || ly > r.y1) continue;
    const i0 = cx(lx - reach);
    const i1 = cx(hx + reach);
    const j0 = cy(ly - reach);
    const j1 = cy(hy + reach);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) (cells[j * nx + i] ??= []).push(k);
  }
  return { x0, y0, cell, nx, ny, cells };
}

/** The whole letter's grid, kept while the letter is in use: for measuring one pair again and again as it is moved apart. */
const gridStore = new WeakMap<PlacedLetter, Map<number, Grid>>();
function gridOf(l: PlacedLetter, reach: number): Grid {
  let byReach = gridStore.get(l);
  if (!byReach) gridStore.set(l, (byReach = new Map()));
  let g = byReach.get(reach);
  if (!g) byReach.set(reach, (g = gridIn(l, grow(l.box, reach), reach)));
  return g;
}

/** Marks the edges already measured against the one in hand, so none is measured twice. */
let seen = new Int32Array(0);
let stamp = 0;

/**
 * How close two letters come, with `b` moved by (dx, dy): the least distance
 * between their outlines where it is under `reach` (else Infinity), and the
 * middle of the places where they come that close (null if nowhere).
 */
function contact(a: PlacedLetter, b: PlacedLetter, reach: number, dx = 0, dy = 0, first = false, again = false): { gap: number; spot: Pt | null } {
  const bBox = shift(b.box, dx, dy);
  if (!near(a.box, bBox, reach)) return { gap: Infinity, spot: null };
  // a's edges near b, measured against a grid of b's edges in b's own place: just
  // where the two could meet, or (measured `again` and again) the whole of b, made once.
  const meet = shift(grow(a.box, reach), -dx, -dy);
  const g = again
    ? gridOf(b, reach)
    : gridIn(b, { x0: Math.max(meet.x0, b.box.x0 - reach), y0: Math.max(meet.y0, b.box.y0 - reach), x1: Math.min(meet.x1, b.box.x1 + reach), y1: Math.min(meet.y1, b.box.y1 + reach) }, reach);
  const ea = edgesOf(a);
  const eb = edgesOf(b);
  if (seen.length < eb.length / 4) seen = new Int32Array(eb.length / 4);
  const r = grow(bBox, reach);
  const gx1 = g.x0 + g.nx * g.cell;
  const gy1 = g.y0 + g.ny * g.cell;
  let gap = Infinity;
  let sx = 0;
  let sy = 0;
  let hits = 0;
  const mid = { x: 0, y: 0 };
  for (let k = 0; k < ea.length; k += 4) {
    if (Math.max(ea[k], ea[k + 2]) < r.x0 || Math.min(ea[k], ea[k + 2]) > r.x1 || Math.max(ea[k + 1], ea[k + 3]) < r.y0 || Math.min(ea[k + 1], ea[k + 3]) > r.y1) continue;
    const ax0 = ea[k] - dx;
    const ay0 = ea[k + 1] - dy;
    const ax1 = ea[k + 2] - dx;
    const ay1 = ea[k + 3] - dy;
    const lx = Math.min(ax0, ax1);
    const hx = Math.max(ax0, ax1);
    const ly = Math.min(ay0, ay1);
    const hy = Math.max(ay0, ay1);
    if (hx < g.x0 || lx > gx1 || hy < g.y0 || ly > gy1) continue;
    const i0 = Math.max(0, Math.floor((lx - g.x0) / g.cell));
    const i1 = Math.min(g.nx - 1, Math.floor((hx - g.x0) / g.cell));
    const j0 = Math.max(0, Math.floor((ly - g.y0) / g.cell));
    const j1 = Math.min(g.ny - 1, Math.floor((hy - g.y0) / g.cell));
    if (++stamp > 2e9) {
      stamp = 1;
      seen.fill(0);
    }
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const list = g.cells[j * g.nx + i];
        if (!list) continue;
        for (const m of list) {
          if (seen[m >> 2] === stamp) continue;
          seen[m >> 2] = stamp;
          const d = edgeDistance(ax0, ay0, ax1, ay1, eb[m], eb[m + 1], eb[m + 2], eb[m + 3], mid);
          if (d >= reach) continue;
          if (first) return { gap: d, spot: { x: mid.x + dx, y: mid.y + dy } };
          gap = Math.min(gap, d);
          sx += mid.x + dx;
          sy += mid.y + dy;
          hits++;
        }
      }
    // Touching, and enough places found to mark where: letters overlapping a long way need no more.
    if (gap === 0 && hits >= 24) break;
  }
  if (hits) return { gap, spot: { x: sx / hits, y: sy / hits } };
  // No edges within reach: one letter may still lie wholly inside the other.
  const overlap = a.box.x0 < bBox.x1 && bBox.x0 < a.box.x1 && a.box.y0 < bBox.y1 && bBox.y0 < a.box.y1;
  if (overlap) {
    for (const c of b.outline) if (c.length && insideShape({ x: c[0].x + dx, y: c[0].y + dy }, a.outline)) return { gap: 0, spot: { x: c[0].x + dx, y: c[0].y + dy } };
    for (const c of a.outline) if (c.length && insideShape({ x: c[0].x - dx, y: c[0].y - dy }, b.outline)) return { gap: 0, spot: { ...c[0] } };
  }
  return { gap: Infinity, spot: null };
}

/**
 * The least distance between two edges, and the point midway between their
 * nearest points (where they cross, if they do) put in `mid`.
 */
function edgeDistance(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number, mid: Pt): number {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    const t = d1 / (d1 - d2);
    mid.x = ax + t * (bx - ax);
    mid.y = ay + t * (by - ay);
    return 0;
  }
  let best = Infinity;
  const tryPoint = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => {
    const ux = rx - qx;
    const uy = ry - qy;
    const len2 = ux * ux + uy * uy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - qx) * ux + (py - qy) * uy) / len2)) : 0;
    const nx = qx + t * ux;
    const ny = qy + t * uy;
    const d = Math.hypot(px - nx, py - ny);
    if (d < best) {
      best = d;
      mid.x = (px + nx) / 2;
      mid.y = (py + ny) / 2;
    }
  };
  tryPoint(ax, ay, cx, cy, dx, dy);
  tryPoint(bx, by, cx, cy, dx, dy);
  tryPoint(cx, cy, ax, ay, bx, by);
  tryPoint(dx, dy, ax, ay, bx, by);
  return best;
}
