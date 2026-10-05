// Basic 2D geometry helpers. All coordinates are millimetres, y pointing down
// (screen / SVG convention), unless stated otherwise.

export interface Pt {
  x: number;
  y: number;
}

/** A closed contour; the last point is NOT repeated. */
export type Contour = Pt[];

export type PathCommand =
  | { type: 'M'; x: number; y: number }
  | { type: 'L'; x: number; y: number }
  | { type: 'Q'; x1: number; y1: number; x: number; y: number }
  | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'Z' };

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Signed area (shoelace). Positive = clockwise on a y-down screen. */
export function signedArea(c: Contour): number {
  let a = 0;
  for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
    a += (c[j].x * c[i].y - c[i].x * c[j].y);
  }
  return a / 2;
}

/** Even-odd point-in-polygon test across all contours of a shape. */
export function insideShape(p: Pt, contours: Contour[]): boolean {
  let inside = false;
  for (const c of contours) {
    for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
      const a = c[i];
      const b = c[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/** Distance from a point to the nearest point on any contour edge. */
export function distanceToBoundary(p: Pt, contours: Contour[]): number {
  let best = Infinity;
  for (const c of contours) {
    for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
      best = Math.min(best, distToSegment(p, c[j], c[i]));
    }
  }
  return best;
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Flatten path commands (lines and Bézier curves) into closed polygons.
 * `tol` is the maximum chord length used when subdividing curves, in mm.
 */
export function flattenPath(cmds: PathCommand[], tol = 0.05): Contour[] {
  const out: Contour[] = [];
  let cur: Contour = [];
  let p: Pt = { x: 0, y: 0 };
  const close = () => {
    if (cur.length > 2) {
      // drop a duplicated closing point
      if (dist(cur[0], cur[cur.length - 1]) < 1e-9) cur.pop();
      out.push(cur);
    }
    cur = [];
  };
  for (const c of cmds) {
    switch (c.type) {
      case 'M':
        close();
        p = { x: c.x, y: c.y };
        cur.push(p);
        break;
      case 'L':
        p = { x: c.x, y: c.y };
        cur.push(p);
        break;
      case 'Q': {
        const p0 = p;
        const n = Math.max(2, Math.ceil((dist(p0, { x: c.x1, y: c.y1 }) + dist({ x: c.x1, y: c.y1 }, c)) / tol));
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const u = 1 - t;
          cur.push({
            x: u * u * p0.x + 2 * u * t * c.x1 + t * t * c.x,
            y: u * u * p0.y + 2 * u * t * c.y1 + t * t * c.y,
          });
        }
        p = { x: c.x, y: c.y };
        break;
      }
      case 'C': {
        const p0 = p;
        const len = dist(p0, { x: c.x1, y: c.y1 }) + dist({ x: c.x1, y: c.y1 }, { x: c.x2, y: c.y2 }) + dist({ x: c.x2, y: c.y2 }, c);
        const n = Math.max(2, Math.ceil(len / tol));
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const u = 1 - t;
          cur.push({
            x: u * u * u * p0.x + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
            y: u * u * u * p0.y + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y,
          });
        }
        p = { x: c.x, y: c.y };
        break;
      }
      case 'Z':
        close();
        break;
    }
  }
  close();
  return out;
}

/** Resample a closed contour so that no edge is longer than `step`. Original vertices are kept. */
export function densify(c: Contour, step: number): Contour {
  const out: Contour = [];
  for (let i = 0; i < c.length; i++) {
    const a = c[i];
    const b = c[(i + 1) % c.length];
    const n = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let k = 0; k < n; k++) {
      out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    }
  }
  return out;
}

/** Douglas–Peucker simplification of an open polyline. */
export function simplify<T extends Pt>(pts: T[], tol: number): T[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distToSegment(pts[i], pts[s], pts[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > tol) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

export function contourToSvg(c: Contour): string {
  return c.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join('') + 'Z';
}

export function polylineToSvg(pl: Pt[]): string {
  return pl.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join('');
}
