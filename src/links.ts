// Linked letters (BRIEF.md, Decisions: "Linked letters"): neighbours on a
// line joined on purpose into one shape, cut as one letter.
//
// The right-hand letter slides left until the two shapes touch, then goes in
// by the link overlap. The joined shape is the union of the letters'
// outlines; its valley lines, datum lines and strokes are worked out for the
// joined shape exactly as for a single letter, so a joined foot becomes one
// slab with one valley and stop cuts only at its far ends.
//
// Everything here is at unit scale (cap height 1), like the letters
// themselves, so a linked run is worked out once and scaled to any size.

import ClipperLib from 'clipper-lib';
import type { Contour, Pt } from './geometry';

/** How far the right-hand letter goes in past touching, mm as at KERN_CAP: the starting overlap of a new link. */
export const LINK_OVERLAP = 0.3;
/** A joint narrower than this, mm as at KERN_CAP, is too thin to chisel. */
export const THIN_JOINT = 0.6;

/** Clipper works in whole numbers: unit-scale points are multiplied by this (0.00025 mm at 25 mm cap height). */
const SCALE = 1e5;

type IntPath = ClipperLib.Path;
const toClipper = (cs: Contour[], dx = 0): IntPath[] => cs.map((c) => c.map((p) => ({ X: Math.round((p.x + dx) * SCALE), Y: Math.round(p.y * SCALE) })));
const fromClipper = (ps: IntPath[]): Contour[] => ps.filter((p) => p.length > 2).map((p) => p.map((q) => ({ x: q.X / SCALE, y: q.Y / SCALE })));

function clip(kind: ClipperLib.ClipType, subject: Contour[][], dxs: number[]): Contour[] {
  const c = new ClipperLib.Clipper();
  subject.forEach((cs, i) => c.AddPaths(toClipper(cs, dxs[i]), i === 0 || kind === ClipperLib.ClipType.ctUnion ? ClipperLib.PolyType.ptSubject : ClipperLib.PolyType.ptClip, true));
  const out: ClipperLib.Paths = [];
  c.Execute(kind, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return fromClipper(out);
}

/** The letters' outlines, each moved along by its pen position, joined into one shape (non-zero fill). */
export function joinShapes(shapes: Contour[][], pens: number[]): Contour[] {
  return clip(ClipperLib.ClipType.ctUnion, shapes, pens);
}

/** Where two shapes overlap: each piece of the overlap. */
export function overlapOf(a: Contour[], b: Contour[], dx: number): Contour[] {
  return clip(ClipperLib.ClipType.ctIntersection, [a, b], [0, dx]);
}

/**
 * How far apart two letters' pens are when, sliding the right-hand one in
 * from the right, the two shapes first touch; null if they never meet (no
 * height they share). Exact for outlines made of straight steps: the first
 * touch is where the right-most point of the left letter and the left-most
 * point of the right one at the same height are furthest across, and that is
 * at the height of a corner of one or the other.
 */
export function touchAdvance(a: Contour[], b: Contour[]): number | null {
  const ya = yRange(a);
  const yb = yRange(b);
  const y0 = Math.max(ya[0], yb[0]);
  const y1 = Math.min(ya[1], yb[1]);
  if (!(y1 >= y0)) return null;
  const ea = new Edges(a, y0, y1);
  const eb = new Edges(b, y0, y1);
  let best = -Infinity;
  const at = (y: number) => {
    const r = ea.extreme(y, 1);
    const l = eb.extreme(y, -1);
    if (r !== null && l !== null) best = Math.max(best, r - l);
  };
  for (const cs of [a, b]) for (const c of cs) for (const p of c) if (p.y >= y0 && p.y <= y1) at(p.y);
  at(y0);
  at(y1);
  return Number.isFinite(best) ? best : null;
}

function yRange(cs: Contour[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of cs)
    for (const p of c) {
      lo = Math.min(lo, p.y);
      hi = Math.max(hi, p.y);
    }
  return [lo, hi];
}

/** A shape's edges, sorted into bands by height, to find quickly how far it reaches across at any height. */
class Edges {
  private bands: number[][];
  private e: number[] = [];
  private y0: number;
  private h: number;
  constructor(cs: Contour[], y0: number, y1: number) {
    const n = 512;
    this.y0 = y0;
    this.h = Math.max(1e-9, (y1 - y0) / n);
    this.bands = Array.from({ length: n + 1 }, () => []);
    for (const c of cs)
      for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
        const p = c[j];
        const q = c[i];
        const lo = Math.min(p.y, q.y);
        const hi = Math.max(p.y, q.y);
        if (hi < y0 || lo > y1) continue;
        const k = this.e.length;
        this.e.push(p.x, p.y, q.x, q.y);
        for (let b = this.band(lo); b <= this.band(hi); b++) this.bands[b].push(k);
      }
  }
  private band(y: number) {
    return Math.min(this.bands.length - 1, Math.max(0, Math.floor((y - this.y0) / this.h)));
  }
  /** The furthest right (side 1) or left (side -1) the outline reaches at height y, or null if nowhere. */
  extreme(y: number, side: 1 | -1): number | null {
    let best: number | null = null;
    for (const k of this.bands[this.band(y)]) {
      const [x0, y0, x1, y1] = [this.e[k], this.e[k + 1], this.e[k + 2], this.e[k + 3]];
      if (y < Math.min(y0, y1) || y > Math.max(y0, y1)) continue;
      // A level edge counts at both its ends.
      const xs = y0 === y1 ? [x0, x1] : [x0 + ((y - y0) / (y1 - y0)) * (x1 - x0)];
      for (const x of xs) if (best === null || x * side > best * side) best = x;
    }
    return best;
  }
}

/** A run of linked letters at unit scale: each letter's pen, the joined outline, and each joint. */
export interface UnitRun {
  /** Each letter's pen position from the first's, cap heights. */
  pens: number[];
  outline: Contour[];
  /** The narrowest joint between each two neighbours, cap heights (0 where they do not meet at all). */
  joints: number[];
  /** Where each joint is: the middle of its narrowest piece, where two letters meet in more than one place (H H) (pen of the first letter at 0). */
  jointSpots: Pt[];
}

/**
 * Lay a run of letters out linked: each next letter slides in until it
 * touches the one before, then goes in by its overlap (cap heights). Null if
 * two neighbours never meet.
 */
export function unitRun(shapes: Contour[][], overlaps: number[], touch: (i: number) => number | null): UnitRun | null {
  const pens = [0];
  for (let i = 1; i < shapes.length; i++) {
    const t = touch(i);
    if (t === null) return null;
    pens.push(pens[i - 1] + t - overlaps[i - 1]);
  }
  const outline = joinShapes(shapes, pens);
  const pieces = shapes.slice(1).map((s, i) => overlapOf(shapes[i], s, pens[i + 1] - pens[i]).map((c) => c.map((p) => ({ x: p.x + pens[i], y: p.y }))));
  const joints = pieces.map(jointWidth);
  const jointSpots = pieces.map((ps, i) => {
    const narrowest = ps.find((c) => jointWidth([c]) === joints[i]);
    return (narrowest && middleOf([narrowest])) ?? { x: pens[i + 1], y: 0 };
  });
  return { pens, outline, joints, jointSpots };
}

/**
 * How wide a joint is: how far the two letters go into each other, along the
 * line from one to the next (BRIEF.md, Decisions: "Linked letters", rule 6:
 * "joined by only 0.3 mm"), for each piece of their overlap; the narrowest
 * piece counts. 0 if they do not overlap at all.
 */
export function jointWidth(pieces: Contour[]): number {
  if (!pieces.length) return 0;
  return Math.min(
    ...pieces.map((c) => {
      const xs = c.map((p) => p.x);
      return Math.max(...xs) - Math.min(...xs);
    }),
  );
}

/** The middle of a set of points: where a joint is, for marking it. */
export function middleOf(cs: Contour[]): Pt | null {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const c of cs)
    for (const p of c) {
      x += p.x;
      y += p.y;
      n++;
    }
  return n ? { x: x / n, y: y / n } : null;
}
