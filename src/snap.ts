// Snapping a line while it is dragged: to the panel centre, the margins, the border, the
// ruler guides, the ends and centres of other lines and their setting-out lines
// (baseline, cap line, mid line, and x-height, ascender and descender lines
// where they have them), and to positions that make the spacing between lines
// equal. Ruler guides and the measure tool snap to the same lines and places.

import { borderDepth, contentBox, type Layout } from './layout';
import { SET_NAMES, type LineSet, type SetKind } from './settingout';

/** Which part of the moving line a target lines up with. */
export type Feature = 'left' | 'centre' | 'right' | 'base' | 'cap' | 'mid' | 'x' | 'asc' | 'desc';

/**
 * Which of a moving line's own setting-out lines each kind of line snaps:
 * like to like, and also a line's cap line to another's descender line and
 * its descender line to another's cap line, so the tails of one line can be
 * brought just to the capitals of the next.
 */
const SNAPS: Record<SetKind, Feature[]> = { cap: ['cap', 'desc'], mid: ['mid'], x: ['x'], asc: ['asc'], base: ['base'], desc: ['desc', 'cap'] };

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

/** The nearest target within `tol` mm of a point (a ruler guide, an end of the measure), whatever the target is for. */
export function nearestTo(at: number, targets: SnapTarget[], tol: number): SnapTarget | null {
  let best: SnapTarget | null = null;
  for (const t of targets) if (Math.abs(t.at - at) <= tol && (!best || Math.abs(t.at - at) < Math.abs(best.at - at))) best = t;
  return best;
}

/**
 * Everything the line numbered `index` can snap to; -1 for no line (a ruler
 * guide or the measure tool). `sets` are the lines' setting-out lines
 * (settingout.ts); without them, each line's cap line, mid line and baseline.
 */
export function snapTargets(layout: Layout, index: number, sets?: LineSet[]): { x: SnapTarget[]; y: SnapTarget[] } {
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
    const set = sets?.find((q) => q.index === o.index)?.lines ?? [
      { kind: 'cap' as const, y: o.baselineY - k },
      { kind: 'mid' as const, y: o.baselineY - k / 2 },
      { kind: 'base' as const, y: o.baselineY },
    ];
    for (const l of set) y.push({ at: l.y, label: `line ${n} ${SET_NAMES[l.kind]}`, for: SNAPS[l.kind] });
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

/**
 * What a ruler guide or an end of the measure snaps to: every line and place
 * a dragged line snaps to (but equal spacing, which is for lines), less the
 * guide being moved, if one is.
 */
export function pointTargets(layout: Layout, sets: LineSet[], moving?: { axis: 'x' | 'y'; at: number }): { x: SnapTarget[]; y: SnapTarget[] } {
  const t = snapTargets(layout, -1, sets);
  const keep = (axis: 'x' | 'y') => (q: SnapTarget) =>
    q.label !== 'equal spacing' && !(moving && moving.axis === axis && q.label === 'guide' && q.at === moving.at);
  return { x: t.x.filter(keep('x')), y: t.y.filter(keep('y')) };
}

function round(v: number) {
  return Math.round(v * 1000) / 1000;
}
