// Spacing intelligence: even-up suggestions calibrated from a reference pair,
// and fitting lines to a width (and a block to a height).
//
// Nothing here changes the project. Suggestions are handed to the carver to
// accept, refuse or tweak; fitting returns the extra spacing to apply.

import { sideShape, type SideShape } from './groups';
import { contentBox, isBlank, layoutPanel, type Layout, type LineExtra, type Project } from './layout';
import type { LetterStore } from './letters';
import { negativeSpace } from './negativeSpace';

export interface Suggestion {
  pair: string;
  /** The pair's measured space now, and the space it should have, mm². */
  area: number;
  target: number;
  /** Change to the pair's spacing that would give it the target space, mm (negative = closer). */
  change: number;
  /** The pair's own kerning now, mm (the change is added to this). */
  current: number;
  shapes: [SideShape, SideShape];
}

export interface EvenUp {
  reference: { pair: string; area: number } | null;
  suggestions: Suggestion[];
  /** Pairs already within 0.05 mm of even. */
  even: string[];
}

/** Lay out two letters on their own, with everything else as in the project, and measure the space between them. */
export function pairArea(store: LetterStore, p: Project, pair: string): number | null {
  const solo: Project = { ...p, text: pair, lines: {}, lineExtras: {}, gapKerning: {}, wordStops: { ...p.wordStops, on: false } };
  const l = layoutPanel(store, solo, true);
  const g = l.gaps[0];
  if (!g) return null;
  return negativeSpace(g, l.lines[0].baselineY, p.capHeight, p.spaceDepth).area;
}

/**
 * Match every pair in the inscription to the reference pair's space. A pair
 * of sides that want more or less space than straight ones (the round,
 * straight and diagonal factors) gets the reference space times the average
 * of its two sides' factors. Moving two letters apart by d mm adds d × cap
 * height of space between them, so the change needed is the shortfall
 * divided by the cap height.
 */
export function evenUp(store: LetterStore, layout: Layout): EvenUp {
  const p = layout.project;
  const ref = [...p.evenUp.reference].slice(0, 2).join('');
  const refArea = ref.length === 2 ? pairArea(store, p, ref) : null;
  const out: EvenUp = { reference: refArea === null ? null : { pair: ref, area: refArea }, suggestions: [], even: [] };
  if (refArea === null) return out;
  const factor = (s: SideShape) => p.evenUp[s];
  const seen = new Set<string>();
  for (const g of layout.gaps) {
    if (seen.has(g.pair) || g.pair === ref) continue;
    seen.add(g.pair);
    const area = pairArea(store, p, g.pair);
    if (area === null) continue;
    const shapes: [SideShape, SideShape] = [sideShape(g.left.char, 'right'), sideShape(g.right.char, 'left')];
    const target = (refArea * (factor(shapes[0]) + factor(shapes[1]))) / 2;
    const change = Math.round(((target - area) / p.capHeight) * 10) / 10;
    if (Math.abs(change) < 0.05) out.even.push(g.pair);
    else out.suggestions.push({ pair: g.pair, area, target, change, current: g.pairKern, shapes });
  }
  return out;
}

export type FitBy = 'letter' | 'word';

/**
 * The extra spacing that makes line `index` exactly `width` mm long (letters
 * end to end). Spacing grows the line in direct proportion, so two trial
 * layouts give the answer. Null if the line can't be fitted that way (one
 * letter, or no word spaces when fitting by word spacing).
 */
export function fitLine(store: LetterStore, p: Project, index: number, width: number, by: FitBy): LineExtra | null {
  const measure = (extra: LineExtra) => {
    const l = layoutPanel(store, { ...p, lineExtras: { ...p.lineExtras, [String(index)]: extra } }, true).lines[index];
    return l?.ink ? l.ink.x1 - l.ink.x0 : null;
  };
  const base = p.lineExtras[String(index)] ?? { letter: 0, word: 0 };
  const zero: LineExtra = by === 'letter' ? { ...base, letter: 0 } : { ...base, word: 0 };
  const one: LineExtra = by === 'letter' ? { ...base, letter: 1 } : { ...base, word: 1 };
  const w0 = measure(zero);
  const w1 = measure(one);
  if (w0 === null || w1 === null || Math.abs(w1 - w0) < 1e-9) return null;
  const e = Math.round(((width - w0) / (w1 - w0)) * 1000) / 1000;
  return by === 'letter' ? { ...base, letter: e } : { ...base, word: e };
}

/**
 * Fit every line to `width`, and if `height` is given, set the line spacing
 * so the block runs from the first cap line to the last baseline in exactly
 * that height (blank lines set to their own height keep it; the others open
 * or close with the line spacing). Returns the changes to make; `skipped`
 * lists the numbers of lines that could not be fitted.
 */
export function fitBlock(
  store: LetterStore,
  p: Project,
  width: number,
  height: number | null,
  by: FitBy,
): { lineExtras: Record<string, LineExtra>; lineSpacing?: number; skipped: number[] } {
  const lineExtras = { ...p.lineExtras };
  const skipped: number[] = [];
  const texts = p.text.replace(/\r/g, '').split('\n');
  const layout = layoutPanel(store, p, true);
  for (let i = 0; i < texts.length; i++) {
    const line = layout.lines[i];
    if (!line?.ink) continue;
    const e = fitLine(store, { ...p, lineExtras }, i, width, by);
    if (e) lineExtras[String(i)] = e;
    else skipped.push(line.number ?? i + 1);
  }
  const result: { lineExtras: Record<string, LineExtra>; lineSpacing?: number; skipped: number[] } = { lineExtras, skipped };
  const lettered = texts.map((t, i) => (isBlank(t) ? -1 : i)).filter((i) => i >= 0);
  if (height !== null && lettered.length > 1) {
    let fixed = 0;
    let n = 0;
    for (let i = lettered[0]; i < lettered[lettered.length - 1]; i++) {
      if (isBlank(texts[i]) && String(i) in p.spacers) fixed += p.spacers[String(i)];
      else n++;
    }
    if (n > 0) result.lineSpacing = Math.round(((height - p.capHeight - fixed) / n) * 1000) / 1000;
  }
  return result;
}

/** The width and height inside the margins: the default box to fit to. */
export function defaultBox(p: Project): { width: number; height: number } {
  const b = contentBox(p);
  return { width: Math.round((b.x1 - b.x0) * 10) / 10, height: Math.round((b.y1 - b.y0) * 10) / 10 };
}
