// Valley lines: the bottom of each V-section trench.
//
// Geometrically the valley is the medial axis of the letter: the set of
// points that are equally far from two or more parts of the outline. At a
// stroke end the medial axis splits and runs out into each corner, which is
// exactly the fork the carver needs for the termination stop cuts.
//
// Method: sample the outline densely, build the Voronoi diagram of the
// samples (via its dual, the Delaunay triangulation), and keep the Voronoi
// edges that lie inside the letter and separate two genuinely different
// parts of the outline. Edges between neighbouring samples on the same bit
// of outline are noise from the sampling and are thrown away.

import Delaunator from 'delaunator';
import { densify, insideShape, simplify, type Contour, type Pt } from './geometry';

/** A point on a valley line. `r` is the distance to the outline, i.e. half the stroke width there. */
export interface ValleyPt extends Pt {
  r: number;
}

export type ValleyLine = ValleyPt[];

export interface ValleyOptions {
  /** Outline sampling step, mm. Smaller is more accurate and slower. */
  step: number;
  /**
   * Minimum angle (degrees) that the two nearest outline points make as seen
   * from a valley point. Real valleys sit between opposite walls (close to
   * 180°) or between the two sides of a corner (180° minus the corner angle).
   * Sampling noise makes a tiny angle.
   */
  minAngleDeg: number;
  /** Simplification tolerance for the output lines, mm. */
  simplifyTol: number;
}

export const defaultValleyOptions: ValleyOptions = {
  step: 0.05,
  minAngleDeg: 30,
  simplifyTol: 0.01,
};

export function valleyLines(contours: Contour[], opts: ValleyOptions = defaultValleyOptions): ValleyLine[] {
  const sites: Pt[] = [];
  for (const c of contours) sites.push(...densify(c, opts.step));
  if (sites.length < 3) return [];

  const coords = new Float64Array(sites.length * 2);
  sites.forEach((p, i) => {
    coords[2 * i] = p.x;
    coords[2 * i + 1] = p.y;
  });
  const del = new Delaunator(coords);
  const { triangles, halfedges } = del;
  const nTri = triangles.length / 3;

  // Voronoi vertices are the triangle circumcentres.
  const centre: (ValleyPt | null)[] = new Array(nTri);
  const inside = new Uint8Array(nTri);
  for (let t = 0; t < nTri; t++) {
    const a = sites[triangles[3 * t]];
    const b = sites[triangles[3 * t + 1]];
    const c = sites[triangles[3 * t + 2]];
    const cc = circumcentre(a, b, c);
    centre[t] = cc;
    inside[t] = cc !== null && insideShape(cc, contours) ? 1 : 0;
  }

  const minAngle = (opts.minAngleDeg * Math.PI) / 180;
  const adj = new Map<number, number[]>();
  const link = (u: number, v: number) => {
    if (!adj.has(u)) adj.set(u, []);
    adj.get(u)!.push(v);
  };

  for (let e = 0; e < halfedges.length; e++) {
    const h = halfedges[e];
    if (h < e) continue; // each shared edge once; hull edges have h = -1
    const t1 = Math.floor(e / 3);
    const t2 = Math.floor(h / 3);
    if (!inside[t1] || !inside[t2]) continue;
    const sa = sites[triangles[e]];
    const sb = sites[triangles[e % 3 === 2 ? e - 2 : e + 1]];
    const ang = Math.max(angleAt(centre[t1]!, sa, sb), angleAt(centre[t2]!, sa, sb));
    if (ang < minAngle) continue;
    link(t1, t2);
    link(t2, t1);
  }

  return chain(adj, centre as ValleyPt[]).map((line) => simplify(line, opts.simplifyTol));
}

function circumcentre(a: Pt, b: Pt, c: Pt): ValleyPt | null {
  const bx = b.x - a.x;
  const by = b.y - a.y;
  const cx = c.x - a.x;
  const cy = c.y - a.y;
  const d = 2 * (bx * cy - by * cx);
  if (Math.abs(d) < 1e-12) return null; // degenerate (collinear)
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const ux = (cy * b2 - by * c2) / d;
  const uy = (bx * c2 - cx * b2) / d;
  return { x: a.x + ux, y: a.y + uy, r: Math.hypot(ux, uy) };
}

function angleAt(v: Pt, a: Pt, b: Pt): number {
  const ax = a.x - v.x;
  const ay = a.y - v.y;
  const bx = b.x - v.x;
  const by = b.y - v.y;
  return Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
}

/** Join the kept Voronoi edges into continuous lines, breaking at forks and ends. */
function chain(adj: Map<number, number[]>, pts: ValleyPt[]): ValleyLine[] {
  const lines: ValleyLine[] = [];
  const used = new Set<string>();
  const key = (u: number, v: number) => (u < v ? `${u},${v}` : `${v},${u}`);

  const walk = (start: number, next: number) => {
    const line: ValleyLine = [pts[start]];
    let prev = start;
    let cur = next;
    used.add(key(prev, cur));
    for (;;) {
      line.push(pts[cur]);
      const nb = adj.get(cur)!;
      if (nb.length !== 2) break;
      const nxt = nb[0] === prev ? nb[1] : nb[0];
      if (used.has(key(cur, nxt))) break;
      used.add(key(cur, nxt));
      prev = cur;
      cur = nxt;
    }
    lines.push(line);
  };

  // Lines that end at a fork or a free end.
  for (const [u, nb] of adj) {
    if (nb.length === 2) continue;
    for (const v of nb) if (!used.has(key(u, v))) walk(u, v);
  }
  // Closed loops with no forks (e.g. the valley of a plain O ring).
  for (const [u, nb] of adj) {
    for (const v of nb) if (!used.has(key(u, v))) walk(u, v);
  }
  return lines;
}
