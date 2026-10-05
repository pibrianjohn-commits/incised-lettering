// Figures for the inspection panel: per-line measurements and the balance
// of the lettering on the panel.

import type { Contour } from './geometry';
import type { Layout, PlacedLetter } from './layout';

export interface LineStats {
  index: number;
  text: string;
  /** Length of the line's letters, end to end, mm. */
  length: number;
  /** That length as a percentage of the panel width. */
  percentOfPanel: number;
  capHeight: number;
  /** Left end of the letters and the baseline, mm from the panel's left and top edges. */
  left: number;
  baseline: number;
  /** How much of the line's band (its length × cap height) is letter, %: its "colour". */
  colour: number;
  placed: boolean;
  locked: boolean;
}

export interface Balance {
  /** Clear space from the lettering to the panel edges, mm. */
  top: number;
  bottom: number;
  left: number;
  right: number;
  /** The visual centre of the lettering: the balance point of all the letter shapes, mm. */
  centre: { x: number; y: number };
  /** The visual centre's distance from the panel centre, mm (positive = right of / below it). */
  offset: { x: number; y: number };
}

/** Area and balance point of a letter's shapes (holes, such as the inside of O, taken out). */
function areaAndCentroid(contours: Contour[]): { area: number; cx: number; cy: number } {
  // Outer edges and holes run opposite ways round, so their signed areas take each other off.
  let a = 0;
  let mx = 0;
  let my = 0;
  for (const c of contours) {
    for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
      const cross = c[j].x * c[i].y - c[i].x * c[j].y;
      a += cross;
      mx += (c[j].x + c[i].x) * cross;
      my += (c[j].y + c[i].y) * cross;
    }
  }
  if (a === 0) return { area: 0, cx: 0, cy: 0 };
  return { area: Math.abs(a / 2), cx: mx / (3 * a), cy: my / (3 * a) };
}

export function letterArea(l: PlacedLetter): number {
  return areaAndCentroid(l.outline).area;
}

export function lineStats(layout: Layout): LineStats[] {
  const p = layout.project;
  const k = p.capHeight;
  return layout.lines
    .filter((l) => l.ink)
    .map((l) => {
      const length = l.ink!.x1 - l.ink!.x0;
      const ink = layout.letters.filter((t) => t.line === l.index).reduce((s, t) => s + letterArea(t), 0);
      return {
        index: l.index,
        text: l.text,
        length,
        percentOfPanel: (100 * length) / p.panelWidth,
        capHeight: k,
        left: l.ink!.x0,
        baseline: l.baselineY,
        colour: length > 0 ? (100 * ink) / (length * k) : 0,
        placed: l.placed,
        locked: l.locked,
      };
    });
}

export function balance(layout: Layout): Balance | null {
  const p = layout.project;
  const inked = layout.lines.filter((l) => l.ink);
  if (!inked.length) return null;
  const x0 = Math.min(...inked.map((l) => l.ink!.x0));
  const x1 = Math.max(...inked.map((l) => l.ink!.x1));
  const y0 = Math.min(...inked.map((l) => l.baselineY - p.capHeight));
  const y1 = Math.max(...inked.map((l) => l.baselineY));
  let A = 0;
  let X = 0;
  let Y = 0;
  for (const t of layout.letters) {
    const { area, cx, cy } = areaAndCentroid(t.outline);
    A += area;
    X += area * cx;
    Y += area * cy;
  }
  const centre = A > 0 ? { x: X / A, y: Y / A } : { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  return {
    top: y0,
    bottom: p.panelHeight - y1,
    left: x0,
    right: p.panelWidth - x1,
    centre,
    offset: { x: centre.x - p.panelWidth / 2, y: centre.y - p.panelHeight / 2 },
  };
}
