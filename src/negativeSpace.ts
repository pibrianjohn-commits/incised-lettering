// Negative space between two neighbouring letters: the area enclosed by the
// right-hand edge of the first letter, the left-hand edge of the second, the
// cap line and the baseline. Balancing these areas by eye is the classic way
// of spacing capitals evenly.

import type { Contour, Pt } from './geometry';
import type { Gap } from './layout';

export interface NegativeSpace {
  gap: Gap;
  /** Closed outline of the space, for shading. */
  shape: Pt[];
  /** mm² */
  area: number;
}

/** `rows` horizontal slices are taken between the cap line and the baseline. */
export function negativeSpace(gap: Gap, baselineY: number, capHeight: number, rows = 200): NegativeSpace {
  const top = baselineY - capHeight;
  const dy = capHeight / rows;
  const leftEdge: Pt[] = [];
  const rightEdge: Pt[] = [];
  let area = 0;
  for (let i = 0; i <= rows; i++) {
    const y = top + i * dy;
    // Rightmost ink of the left letter, leftmost ink of the right letter.
    let a = extremeX(gap.left.outline, y, 'max') ?? gap.left.box.x1;
    let b = extremeX(gap.right.outline, y, 'min') ?? gap.right.box.x0;
    if (b < a) a = b = (a + b) / 2; // letters overlap here: no space
    leftEdge.push({ x: a, y });
    rightEdge.push({ x: b, y });
    // Trapezium rule between slices.
    if (i > 0) {
      const w0 = rightEdge[i - 1].x - leftEdge[i - 1].x;
      area += ((w0 + (b - a)) / 2) * dy;
    }
  }
  return { gap, shape: [...leftEdge, ...rightEdge.reverse()], area };
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
