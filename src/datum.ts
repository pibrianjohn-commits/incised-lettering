// Datum line: a line set in from the outline, where the carver's first
// chisel cut starts.
//
// The carver's rule (BRIEF.md, Decisions): the distance in from the outline
// is a percentage of the local stroke width, so it follows the thick and thin,
// but never less than a minimum distance, so it never crowds the hairline.
// Where the stroke is too narrow to fit a datum line each side, it stops.
//
// Method: every point on a valley line knows the stroke's half-width there
// (r). A circle centred on the valley point with radius r touches the outline
// on both sides. Shrink it to r - d, where d is the wanted set-in distance, and
// its edge sits d in from the outline. The datum line is the outer edge of all
// these shrunken circles together. With a fixed d this gives exactly the
// outline set in by d; with d following the width it follows the thick and thin.
// Between neighbouring valley points the circles are joined by their common
// tangents, and Clipper merges the pieces into clean lines.

import ClipperLib from 'clipper-lib';
import { signedArea, type Contour, type Pt } from './geometry';
import type { ValleyLine } from './valley';

export interface DatumRule {
  /** Set-in distance as a percentage of the local stroke width. */
  percent: number;
  /** Never closer to the outline than this, mm. */
  minimum: number;
}

/** The set-in distance for a stroke of width w (mm). */
export function datumDistance(w: number, rule: DatumRule): number {
  return Math.max((rule.percent / 100) * w, rule.minimum);
}

const SCALE = 10000; // Clipper works in integers: 1 unit = 0.1 µm
/** Crumbs smaller than this, left where a stroke only just has room, are dropped. mm². */
const MIN_PIECE_AREA = 0.05;
/** Chord error allowed when drawing circle arcs, mm. */
const ARC_TOL = 0.01;

export function datumLines(valleys: ValleyLine[], rule: DatumRule): Contour[] {
  const pieces: ClipperLib.Paths = [];
  // Radius of the shrunken circle at a valley point; negative means no room.
  const rho = (r: number) => r - datumDistance(2 * r, rule);

  for (const line of valleys) {
    for (let i = 1; i < line.length; i++) {
      let a: Pt & { k: number } = { x: line[i - 1].x, y: line[i - 1].y, k: rho(line[i - 1].r) };
      let b: Pt & { k: number } = { x: line[i].x, y: line[i].y, k: rho(line[i].r) };
      if (a.k <= 0 && b.k <= 0) continue; // too narrow along this whole stretch
      // Too narrow at one end: stop the datum where the room runs out.
      if (a.k <= 0 || b.k <= 0) {
        const t = a.k / (a.k - b.k);
        const cut = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), k: 0 };
        if (a.k <= 0) a = cut;
        else b = cut;
      }
      const hull = capsule(a, a.k, b, b.k);
      if (hull.length >= 3) pieces.push(hull.map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) })));
    }
  }

  const merged: ClipperLib.Paths = [];
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(pieces, ClipperLib.PolyType.ptSubject, true);
  clipper.Execute(ClipperLib.ClipType.ctUnion, merged, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);

  return merged
    .map((path) => path.map((p) => ({ x: p.X / SCALE, y: p.Y / SCALE })))
    .filter((c) => Math.abs(signedArea(c)) >= MIN_PIECE_AREA);
}

/**
 * Outline around two circles and the straight tangents joining them: a
 * tapered capsule. Arc round the far side of the first circle, then round the
 * far side of the second.
 */
function capsule(a: Pt, ra: number, b: Pt, rb: number): Pt[] {
  ra = Math.max(0, ra);
  rb = Math.max(0, rb);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  // One circle swallows the other: the capsule is just the bigger circle.
  if (len <= Math.abs(ra - rb)) return ra >= rb ? circle(a, ra) : circle(b, rb);
  const base = Math.atan2(b.y - a.y, b.x - a.x);
  // The tangent lines touch each circle at ±beta from the line of centres.
  const beta = Math.acos((ra - rb) / len);
  return [...arc(a, ra, base + beta, base + 2 * Math.PI - beta), ...arc(b, rb, base - beta, base + beta)];
}

/** Points along a circle from angle t0 to t1 (radians), both ends included. */
function arc(c: Pt, r: number, t0: number, t1: number): Pt[] {
  if (r === 0) return [{ x: c.x, y: c.y }];
  const n = Math.max(1, Math.ceil((t1 - t0) / arcStep(r)));
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    pts.push({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) });
  }
  return pts;
}

function circle(c: Pt, r: number): Pt[] {
  return arc(c, r, 0, 2 * Math.PI).slice(0, -1);
}

/** Angle between points so the chords stay within ARC_TOL of the true circle. */
function arcStep(r: number): number {
  return 2 * Math.acos(Math.max(-1, 1 - ARC_TOL / r));
}
