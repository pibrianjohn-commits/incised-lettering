// Negative space between two neighbouring letters: the area enclosed by the
// right-hand edge of the first letter, the left-hand edge of the second, the
// cap line and the baseline. Balancing these areas by eye is the classic way
// of spacing capitals evenly.
//
// Open letters (E, C, F, L, the mouth of G) would otherwise count their whole
// bays as space. The carver's rule (BRIEF.md, Decisions): space counts only a
// limited depth into a letter, measured in from the letter's furthest point
// on that side. Where that limit cuts the space off, the cut-off is drawn.

import type { Contour, Pt } from './geometry';
import type { Gap } from './layout';

export interface NegativeSpace {
  gap: Gap;
  /** Closed outline of the space, for shading. */
  shape: Pt[];
  /** mm² */
  area: number;
  /** Where the depth limit cuts the space off, as lines to draw. */
  cutoffs: Pt[][];
}

/**
 * `depth` is how far into each letter the space may reach, mm (Infinity for
 * no limit). `rows` horizontal slices are taken between cap line and baseline.
 */
export function negativeSpace(gap: Gap, baselineY: number, capHeight: number, depth: number, rows = 200): NegativeSpace {
  const top = baselineY - capHeight;
  const dy = capHeight / rows;
  const leftEdge: Pt[] = [];
  const rightEdge: Pt[] = [];
  let area = 0;
  const limitL = gap.left.box.x1 - depth;
  const limitR = gap.right.box.x0 + depth;
  const cutoffs: Pt[][] = [];
  let runL: Pt[] | null = null;
  let runR: Pt[] | null = null;
  for (let i = 0; i <= rows; i++) {
    const y = top + i * dy;
    // Rightmost ink of the left letter, leftmost ink of the right letter.
    let a = extremeX(gap.left.outline, y, 'max') ?? gap.left.box.x1;
    let b = extremeX(gap.right.outline, y, 'min') ?? gap.right.box.x0;
    // No deeper into either letter than the depth limit.
    const cutL = a < limitL;
    const cutR = b > limitR;
    if (cutL) a = limitL;
    if (cutR) b = limitR;
    runL = track(cutoffs, runL, cutL, { x: limitL, y });
    runR = track(cutoffs, runR, cutR, { x: limitR, y });
    if (b < a) a = b = (a + b) / 2; // letters overlap here: no space
    leftEdge.push({ x: a, y });
    rightEdge.push({ x: b, y });
    // Trapezium rule between slices.
    if (i > 0) {
      const w0 = rightEdge[i - 1].x - leftEdge[i - 1].x;
      area += ((w0 + (b - a)) / 2) * dy;
    }
  }
  return { gap, shape: [...leftEdge, ...rightEdge.reverse()], area, cutoffs };
}

/** Grow a run of cut-off rows into a line; start a new line after a break. */
function track(out: Pt[][], run: Pt[] | null, cut: boolean, p: Pt): Pt[] | null {
  if (!cut) return null;
  if (!run) {
    run = [];
    out.push(run);
  }
  run.push(p);
  return run;
}

/** Furthest left or right crossing of a horizontal line through the outline. */
function extremeX(contours: Contour[], y: number, which: 'min' | 'max'): number | null {
  let best: number | null = null;
  for (const c of contours) {
    for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
      const p = c[j];
      const q = c[i];
      if ((p.y > y) === (q.y > y)) continue;
      const x = p.x + ((y - p.y) * (q.x - p.x)) / (q.y - p.y);
      if (best === null || (which === 'max' ? x > best : x < best)) best = x;
    }
  }
  return best;
}
