// Panel sizing: the machine bed check, and fitting the panel to the lettering.

import { borderDepth, type Layout, type Project } from './layout';

/** The Genmitsu 3020-PRO Ultra bed, mm (see BRIEF.md, Inputs and settings). */
export const BED = { width: 300, height: 205 };
export const BED_EXTENDED = { width: 300, height: 400 };

export type BedFit = 'standard' | 'extended' | 'too-big';

/** Whether a panel fits the bed, either way round. */
export function bedFit(w: number, h: number): BedFit {
  const fits = (a: number, b: number) => (w <= a && h <= b) || (w <= b && h <= a);
  if (fits(BED.width, BED.height)) return 'standard';
  if (fits(BED_EXTENDED.width, BED_EXTENDED.height)) return 'extended';
  return 'too-big';
}

/**
 * The panel size that just holds the lettering plus the margins (and the
 * border), and how far to shift everything so the lettering sits inside it.
 * The lettering is measured from its cap lines to its baselines, and from the
 * left end of its longest line to the right end.
 */
export function fitToLettering(layout: Layout): { width: number; height: number; dx: number; dy: number } | null {
  const p: Project = layout.project;
  const inked = layout.lines.filter((l) => l.ink);
  if (!inked.length) return null;
  const x0 = Math.min(...inked.map((l) => l.ink!.x0));
  const x1 = Math.max(...inked.map((l) => l.ink!.x1));
  const y0 = Math.min(...inked.map((l) => l.baselineY - p.capHeight));
  const y1 = Math.max(...inked.map((l) => l.baselineY));
  const d = borderDepth(p.border);
  // Round up to the next 0.1 mm, so the lettering never ends up a hair outside the margins.
  const r1 = (v: number) => Math.ceil(v * 10 - 1e-6) / 10;
  return {
    width: r1(x1 - x0 + p.margins.left + p.margins.right + 2 * d),
    height: r1(y1 - y0 + p.margins.top + p.margins.bottom + 2 * d),
    dx: d + p.margins.left - x0,
    dy: d + p.margins.top - y0,
  };
}
