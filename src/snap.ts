// Snapping a line while it is dragged: to the panel centre, the margins, the border, the
// ruler guides, the ends, centres, baselines and cap lines of other lines, and
// to positions that make the spacing between lines equal.

import { borderDepth, contentBox, type Layout } from './layout';

/** Which part of the moving line a target lines up with. */
export type Feature = 'left' | 'centre' | 'right' | 'base' | 'cap' | 'mid';

export interface SnapTarget {
  at: number; // mm
  label: string;
  for: Feature[];
}

export interface Snap {
  /** How far to shift the line so the feature lands on the target, mm. */
  offset: number;
  target: SnapTarget;
  feature: Feature;
}

/** The nearest target within `tol` mm of any feature, or null. */
export function nearest(features: { f: Feature; at: number }[], targets: SnapTarget[], tol: number): Snap | null {
  let best: Snap | null = null;
  for (const t of targets)
    for (const { f, at } of features) {
      if (!t.for.includes(f)) continue;
      const offset = t.at - at;
      if (Math.abs(offset) <= tol && (!best || Math.abs(offset) < Math.abs(best.offset))) best = { offset, target: t, feature: f };
    }
  return best;
}

/** Everything the line numbered `index` can snap to. */
export function snapTargets(layout: Layout, index: number): { x: SnapTarget[]; y: SnapTarget[] } {
  const p = layout.project;
  const k = p.capHeight;
  const box = contentBox(p);
  const x: SnapTarget[] = [
    { at: p.panelWidth / 2, label: 'panel centre', for: ['centre'] },
    { at: box.x0, label: 'left margin', for: ['left'] },
    { at: box.x1, label: 'right margin', for: ['right'] },
  ];
  const y: SnapTarget[] = [
    { at: p.panelHeight / 2, label: 'panel centre', for: ['mid'] },
    { at: box.y0, label: 'top margin', for: ['cap'] },
    { at: box.y1, label: 'bottom margin', for: ['base'] },
  ];
  // The border's inner edge, as well as the margins inside it.
  const d = borderDepth(p.border);
  if (d > 0) {
    x.push({ at: d, label: 'border', for: ['left'] }, { at: p.panelWidth - d, label: 'border', for: ['right'] });
    y.push({ at: d, label: 'border', for: ['cap'] }, { at: p.panelHeight - d, label: 'border', for: ['base'] });
  }
  for (const g of p.guides.x) x.push({ at: g, label: 'guide', for: ['left', 'centre', 'right'] });
  for (const g of p.guides.y) y.push({ at: g, label: 'guide', for: ['base', 'cap', 'mid'] });

  const others = layout.lines.filter((l) => l.index !== index && l.ink);
  for (const o of others) {
    const n = o.number ?? o.index + 1;
    x.push({ at: o.ink!.x0, label: `line ${n} left end`, for: ['left'] });
    x.push({ at: (o.ink!.x0 + o.ink!.x1) / 2, label: `line ${n} centre`, for: ['centre'] });
    x.push({ at: o.ink!.x1, label: `line ${n} right end`, for: ['right'] });
    y.push({ at: o.baselineY, label: `line ${n} baseline`, for: ['base'] });
    y.push({ at: o.baselineY - k, label: `line ${n} cap line`, for: ['cap'] });
  }

  // Equal spacing: the same baseline-to-baseline distance as the other lines
  // already have between them (or as the line-spacing setting), above or
  // below any other line, or exactly half way between two of them.
  const bases = others.map((o) => o.baselineY).sort((a, b) => a - b);
  const steps = new Set<number>([round(p.lineSpacing)]);
  for (let i = 1; i < bases.length; i++) steps.add(round(bases[i] - bases[i - 1]));
  for (const b of bases)
    for (const s of steps) {
      if (s <= 0) continue;
      y.push({ at: b + s, label: 'equal spacing', for: ['base'] });
      y.push({ at: b - s, label: 'equal spacing', for: ['base'] });
    }
  for (let i = 1; i < bases.length; i++) y.push({ at: (bases[i] + bases[i - 1]) / 2, label: 'equal spacing', for: ['base'] });

  return { x, y };
}

function round(v: number) {
  return Math.round(v * 1000) / 1000;
}
