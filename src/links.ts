// Linked letters (BRIEF.md, Decisions: "Linked letters"): neighbours on a
// line joined on purpose into one shape, cut as one letter.
//
// The right-hand letter slides left until the two shapes touch, then goes in
// by the link overlap. Where the two join thinner than a chisel can leave
// (THIN_JOINT), the join is filled with wood up to that thickness, so two
// serif tips become one continuous serif. The joined shape is the union of
// the letters' outlines and the fills; its valley lines, datum lines and
// strokes are worked out for it exactly as for a single letter, so a joined
// foot becomes one slab with one valley and stop cuts only at its far ends.
//
// Everything here is at unit scale (cap height 1), like the letters
// themselves, so a linked run is worked out once and scaled to any size.

import ClipperLib from 'clipper-lib';
import { signedArea, type Contour, type Pt } from './geometry';

/** How far the right-hand letter goes in past touching, mm as at KERN_CAP: the starting overlap of a new link. */
export const LINK_OVERLAP = 0.3;
/** A joint thinner than this, mm as at KERN_CAP, is too thin to chisel: a link fills its join up to it. */
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

/** The letters' outlines, each moved along by its pen position, joined into one shape (non-zero fill, each turned the same way round first). */
export function joinShapes(shapes: Contour[][], pens: number[]): Contour[] {
  return clip(ClipperLib.ClipType.ctUnion, shapes.map(facingOneWay), pens);
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

/** Where two letters join: at their feet on the baseline, at their heads on the cap line, or elsewhere (a Q's tail against a J). */
export type JointPlace = 'foot' | 'head' | 'elsewhere';

/** A joint between two neighbours in a run (cap heights; the first letter's pen at 0). */
export interface Joint {
  /**
   * How thick the joined shape is across the join, at right angles to the
   * baseline, at its thinnest between the two letters: the wood the chisel
   * leaves (BRIEF.md, Decisions: "Linked letters", rule 6).
   */
  width: number;
  /** Where it is: the middle of the fill, or else of the thinnest point. */
  at: Pt;
  place: JointPlace;
  /** The fill that builds this place up to the thickness wanted (rule 8), if one was needed and could be made. */
  fill: Contour | null;
  /** Every fill between the two letters, where they meet in more than one place (H H: at the head and the foot). */
  fills: Contour[];
}

/** A run of linked letters at unit scale: each letter's pen, the joined outline, and each joint. */
export interface UnitRun {
  /** Each letter's pen position from the first's, cap heights. */
  pens: number[];
  outline: Contour[];
  /** Between each two neighbours, the thinnest of the places they join (where they meet in more than one, as H H at head and foot). */
  joints: Joint[];
}

/**
 * Lay a run of letters out linked: each next letter slides in until it
 * touches the one before, then goes in by its overlap (cap heights). Where
 * two letters join thinner than `thin` (cap heights), the join is filled up
 * to that thickness before the shape is joined (BRIEF.md, Decisions: "Linked
 * letters", rule 8). Null if two neighbours never meet. (With `fill` off, the
 * joins are left as the letters make them: for measuring them as they are.)
 */
export function unitRun(shapes: Contour[][], overlaps: number[], touch: (i: number) => number | null, thin: number, fill = true): UnitRun | null {
  const pens = [0];
  for (let i = 1; i < shapes.length; i++) {
    const t = touch(i);
    if (t === null) return null;
    pens.push(pens[i - 1] + t - overlaps[i - 1]);
  }
  const placed = shapes.map((s, i) => s.map((c) => c.map((p) => ({ x: p.x + pens[i], y: p.y }))));
  // Each place two neighbours meet, and the fill it wants.
  const meets = placed.slice(1).map((b, i) => overlapOf(placed[i], b, 0).map((piece) => meeting(placed[i], b, piece, thin)));
  if (!fill) for (const m of meets.flat()) m.fill = null;
  const fills = meets.flat().flatMap((m) => (m.fill ? [m.fill] : []));
  const outline = joinShapes([...placed, ...fills.map((f) => [f])], [...placed.map(() => 0), ...fills.map(() => 0)]);
  // Measured on the joined shape itself, fills and all.
  const joints = meets.map((ms, i): Joint => {
    if (!ms.length) return { width: 0, at: { x: pens[i + 1], y: 0 }, place: 'elsewhere', fill: null, fills: [] };
    const measured = ms.map((m) => {
      const t = thinnest(outline, m);
      return { ...m, ...t, width: Number.isFinite(t.width) ? t.width : 0 };
    });
    const { width, at, place, fill } = measured.reduce((a, b) => (b.width < a.width ? b : a));
    return { width, at, place, fill, fills: ms.flatMap((m) => (m.fill ? [m.fill] : [])) };
  });
  return { pens, outline, joints };
}

/** A place where two letters meet, before it is measured: where it is, how far either side of it the letters run thin, and its fill. */
interface Meeting {
  place: JointPlace;
  /** The height the thickness is measured through: just inside the baseline or cap line, or the middle of the band elsewhere. */
  y: number;
  /** Between the two letters: from where the left letter is thick enough to where the right one is (or as far as either reaches). */
  x0: number;
  x1: number;
  centre: number;
  /** The middle of the overlap, top to bottom: where to measure from if the line itself holds no wood here. */
  mid: number;
  /** The overlap itself. */
  piece: Contour;
  /** The two letters, placed. */
  a: Contour[];
  b: Contour[];
  fill: Contour | null;
  at: Pt;
}

/**
 * A shape with its outer outline running the positive way round (its largest
 * contour's area positive), its counters the other. A font may draw some
 * characters the other way round from the rest (Cinzel's 1 and 7): joined
 * as they are, where two such letters overlap they would cancel and leave a
 * hole, not one shape.
 */
function facingOneWay(shape: Contour[]): Contour[] {
  let best = 0;
  for (const c of shape) {
    const a = signedArea(c);
    if (Math.abs(a) > Math.abs(best)) best = a;
  }
  return best < 0 ? shape.map((c) => [...c].reverse()) : shape;
}

/** How far into each letter to look for where it is thick enough, cap heights (5 mm at 25 mm). */
const REACH = 0.2;
const STEP = 0.001;
/** The fill starts a little inside each letter, where it is already thicker, so its corners never stand proud. */
const TUCK = 0.002;
/** Just inside the baseline or cap line, so a foot or head is measured through its wood. */
const SKIN = 0.001;
/** Following a band of wood elsewhere, the height is kept at least this far inside it (or a quarter of it, if thinner). */
const HOLD = 0.02;

/**
 * Where a piece of overlap between two letters is, and the fill it wants:
 * from the point in each letter where it is already `thin` thick, a straight
 * edged block, standing on the baseline for a foot, hanging from the cap
 * line for a head, and centred on the band elsewhere.
 */
function meeting(a: Contour[], b: Contour[], piece: Contour, thin: number): Meeting {
  const xs = piece.map((p) => p.x);
  const ys = piece.map((p) => p.y);
  const centre = (Math.min(...xs) + Math.max(...xs)) / 2;
  const lo = Math.max(...ys); // the piece's lowest point (y runs down)
  const hi = Math.min(...ys);
  let place: JointPlace = Math.abs(lo) < 0.03 ? 'foot' : Math.abs(hi + 1) < 0.03 ? 'head' : 'elsewhere';
  // A foot is measured from the baseline up, a head from the cap line down, through the wood just inside the line;
  // elsewhere through the overlap itself.
  const across = middleAcross(piece, centre) ?? (lo + hi) / 2;
  let y = place === 'foot' ? -SKIN : place === 'head' ? -1 + SKIN : across;
  let left = thickEnough(a, centre, -1, place, y, thin);
  let right = thickEnough(b, centre, 1, place, y, thin);
  // Only one of the two stands on the line here (a K's foot against the curve of an O; a 7, whose top is
  // a hair under the cap line, against a Z): the join is filled as one away from the lines, centred on it.
  if (place !== 'elsewhere' && (!left.band || !right.band)) {
    const l = thickEnough(a, centre, -1, 'elsewhere', across, thin);
    const r = thickEnough(b, centre, 1, 'elsewhere', across, thin);
    if (l.band && r.band) [place, y, left, right] = ['elsewhere', across, l, r];
  }
  const x0 = left.x;
  const x1 = right.x;
  let fill: Contour | null = null;
  // Both letters already thick enough where they meet: nothing to build up.
  if (left.band && right.band && x1 - x0 > 2 * STEP) {
    const [la, lb] = left.band;
    const [ra, rb] = right.band;
    const t = thin * 1.002; // a hair over, so the joined shape measures at least `thin`
    const xa = x0 - TUCK;
    const xb = x1 + TUCK;
    // A foot's fill stands on the baseline (y 0), a head's hangs from the cap line (y -1).
    if (place === 'foot') fill = [{ x: xa, y: 0 }, { x: xb, y: 0 }, { x: xb, y: -t }, { x: xa, y: -t }];
    else if (place === 'head') fill = [{ x: xa, y: -1 }, { x: xb, y: -1 }, { x: xb, y: -1 + t }, { x: xa, y: -1 + t }];
    else {
      // Centred on the join: at each end, as near the height of the join as the letter's wood there allows.
      const h = t / 2;
      const cl = Math.min(Math.max(left.y, la + h), lb - h);
      const cr = Math.min(Math.max(right.y, ra + h), rb - h);
      fill = [{ x: xa, y: cl - h }, { x: xb, y: cr - h }, { x: xb, y: cr + h }, { x: xa, y: cl + h }];
    }
  }
  const at = fill ? { x: (x0 + x1) / 2, y: place === 'foot' ? y - thin / 2 : place === 'head' ? y + thin / 2 : y } : { x: centre, y };
  return { place, y, x0: Math.min(x0, centre), x1: Math.max(x1, centre), centre, mid: (lo + hi) / 2, piece, a, b, fill, at };
}

/**
 * How thick a band of wood is, straight up and down: for a foot from the
 * baseline up, for a head from the cap line down (what hangs below the
 * baseline or stands above the cap line, as an overshoot or a pointed foot
 * does, is not counted), elsewhere all of it.
 */
const depth = (place: JointPlace, iv: [number, number]) => (place === 'foot' ? Math.min(0, iv[1]) - iv[0] : place === 'head' ? iv[1] - Math.max(-1, iv[0]) : iv[1] - iv[0]);

/**
 * The height to look for the same band of wood at the next step along: the
 * line itself for a foot or head; elsewhere the height of the join, moved
 * only as far as the band moves away from it (along a slanting stroke), so a
 * stroke met side on (a B's bowl against a stem) is not taken top to bottom.
 */
function follow(place: JointPlace, iv: [number, number], y: number): number {
  if (place !== 'elsewhere') return y;
  const keep = Math.min((iv[1] - iv[0]) / 4, HOLD);
  return Math.min(Math.max(y, iv[0] + keep), iv[1] - keep);
}

/**
 * Going from `x` along one letter (`dir` -1 left, 1 right), through its wood
 * at height `y` (following the band elsewhere), the first point where it is
 * `thin` thick straight up and down, and the band of wood there; or, if it
 * never is within REACH (it runs out, meeting at a slant or a point), how far
 * it went, and no band.
 */
function thickEnough(shape: Contour[], x: number, dir: 1 | -1, place: JointPlace, y: number, thin: number): { x: number; y: number; band: [number, number] | null } {
  let yc = y;
  let last = x;
  const at = (px: number): [number, number] | null => {
    const iv = band(shape, px, yc);
    if (iv) yc = follow(place, iv, yc);
    return iv;
  };
  for (let d = 0; d <= REACH + 1e-12; d += STEP) {
    const px = x + dir * d;
    const iv = at(px);
    if (!iv) {
      if (d > 0) return { x: last, y: yc, band: null }; // the letter has run out this way
      continue;
    }
    if (depth(place, iv) >= thin) {
      // Closer in, to a hundredth of a step.
      let near = Math.max(0, d - STEP);
      let far = d;
      let found = iv;
      const from = yc;
      for (let k = 0; k < 7 && far - near > 1e-6; k++) {
        const mid = (near + far) / 2;
        const m = band(shape, x + dir * mid, from);
        if (m && depth(place, m) >= thin) [far, found] = [mid, m];
        else near = mid;
      }
      return { x: x + dir * far, y: from, band: found };
    }
    last = px;
  }
  return { x: last, y: yc, band: null };
}

/** The middle of a piece's wood on the line straight up and down through x (its first band, top down), or null if it has none there. */
function middleAcross(piece: Contour, x: number): number | null {
  const ys: number[] = [];
  for (let i = 0, j = piece.length - 1; i < piece.length; j = i++) {
    const p = piece[j];
    const q = piece[i];
    if (p.x > x !== q.x > x) ys.push(p.y + ((x - p.x) / (q.x - p.x)) * (q.y - p.y));
  }
  if (ys.length < 2) return null;
  ys.sort((m, n) => m - n);
  return (ys[0] + ys[1]) / 2;
}

/** The band of a shape's wood on the line straight up and down through x that holds height y, or null. */
function band(shape: Contour[], x: number, y: number): [number, number] | null {
  const ys: number[] = [];
  for (const c of shape)
    for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
      const p = c[j];
      const q = c[i];
      if (p.x > x !== q.x > x) ys.push(p.y + ((x - p.x) / (q.x - p.x)) * (q.y - p.y));
    }
  ys.sort((m, n) => m - n);
  for (let i = 0; i + 1 < ys.length; i += 2) if (y >= ys[i] && y <= ys[i + 1]) return [ys[i], ys[i + 1]];
  return null;
}

/**
 * How thick the joined shape is across a join, at right angles to the
 * baseline, at its thinnest between the two letters, and where that is.
 */
function thinnest(outline: Contour[], m: Meeting): { width: number; at: Pt } {
  const found = measureAlong(outline, m, m.place, m.y);
  if (Number.isFinite(found.width)) return found;
  // No wood on the line itself between the two (they meet just off it): measured through the band where they overlap.
  const banded = measureAlong(outline, m, 'elsewhere', m.mid);
  if (Number.isFinite(banded.width)) return banded;
  // Gone deep into each other (the overlap itself an awkward shape): straight up and down through the overlap.
  const c = middleOf([m.piece])!;
  let width = Infinity;
  let at = c;
  for (const q of m.piece) {
    const p = { x: q.x + (c.x - q.x) * 0.2, y: q.y + (c.y - q.y) * 0.2 };
    const iv = band(outline, p.x, p.y);
    if (iv && iv[1] - iv[0] < width) [width, at] = [iv[1] - iv[0], p];
  }
  return { width, at };
}

function measureAlong(outline: Contour[], m: Meeting, place: JointPlace, y: number): { width: number; at: Pt } {
  let width = Infinity;
  let where: Pt = m.at;
  // From the middle of the join out each way, following the wood as it goes,
  // to where each letter is thick enough, or else just past the overlap
  // (where the one letter's wood ends and only the other's carries on).
  const px = m.piece.map((p) => p.x);
  const [p0, p1] = [Math.min(...px), Math.max(...px)];
  for (const side of [Math.min(m.x0, p0 - STEP), Math.max(m.x1, p1 + STEP)]) {
    const n = Math.max(1, Math.ceil(Math.abs(side - m.centre) / STEP));
    // Past the overlap, only the letter on that side carries the join (the other's serif running on past it is not the joint).
    const own = side < m.centre ? m.a : m.b;
    let yc = y;
    for (let k = 0; k <= n; k++) {
      const x = m.centre + ((side - m.centre) * k) / n;
      // Elsewhere, through the overlap where there is one: the wood that joins the two, not some other stroke.
      if (place === 'elsewhere') yc = middleAcross(m.piece, x) ?? yc;
      if ((x < p0 || x > p1) && !band(own, x, yc)) continue;
      const iv = band(outline, x, yc);
      if (!iv) continue;
      yc = follow(place, iv, yc);
      const d = depth(place, iv);
      if (d >= width) continue;
      width = d;
      if (!m.fill) where = { x, y: (iv[0] + iv[1]) / 2 };
    }
  }
  return { width, at: where };
}

/**
 * How far two letters go into each other, along the line from one to the
 * next, for each piece of their overlap (the narrowest piece counts); 0 if
 * they do not overlap at all. (The joint itself is measured as wood: Joint.)
 */
export function overlapWidth(pieces: Contour[]): number {
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
