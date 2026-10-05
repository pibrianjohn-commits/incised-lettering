// Places the inscription on the panel, line by line.

import type { Contour } from './geometry';
import type { Box, LetterStore } from './letters';
import type { ValleyLine } from './valley';

export type Align = 'left' | 'centre' | 'right';

export interface Project {
  /** The inscription; each line of text is a line on the panel. */
  text: string;
  capHeight: number; // mm
  /** Extra space added between every pair of letters, mm (negative = tighter). */
  letterSpacing: number;
  /** Baseline to baseline, mm. */
  lineSpacing: number;
  align: Align;
  panelWidth: number; // mm
  panelHeight: number; // mm
  margin: number; // mm, clear space inside the panel edge
  /** Datum line set in from the outline by this percentage of the local stroke width… */
  datumPercent: number;
  /** …but never closer to the outline than this, mm. */
  datumMinimum: number;
  /**
   * Hand kerning in mm, keyed by the letter pair (e.g. "AV"). Applies to
   * every place that pair occurs, on top of the alphabet's own kerning.
   */
  kerning: Record<string, number>;
  /**
   * Hand kerning for one gap only, mm, added on top of the pair's kerning.
   * Keyed by gap (see gapKey); the pair is kept so that if the text is edited
   * and different letters end up in that place, the adjustment is ignored.
   */
  gapKerning: Record<string, { pair: string; mm: number }>;
  /**
   * Negative space counts no further than this into a letter, measured in
   * from the letter's furthest point on that side, mm. Stops open letters
   * (E, C, F, L, the mouth of G) counting their bays as space.
   */
  spaceDepth: number;
}

export const defaultProject: Project = {
  text: 'OAK',
  capHeight: 25,
  letterSpacing: 0,
  lineSpacing: 40,
  align: 'centre',
  panelWidth: 150,
  panelHeight: 60,
  margin: 10,
  datumPercent: 20,
  datumMinimum: 0.2,
  kerning: {},
  gapKerning: {},
  spaceDepth: 6,
};

/** Identifies a gap by its line and the position of the letter after it. */
export function gapKey(line: number, index: number): string {
  return `${line}:${index}`;
}

export interface PlacedLetter {
  char: string;
  line: number;
  outline: Contour[];
  valleys: ValleyLine[];
  datum: Contour[];
  box: Box;
}

/** The space between two neighbouring letters on a line. */
export interface Gap {
  pair: string;
  line: number;
  left: PlacedLetter;
  right: PlacedLetter;
  /** Identifies this gap for one-gap kerning. */
  key: string;
  /** Hand kerning for this pair wherever it occurs, mm. */
  pairKern: number;
  /** Extra hand kerning for this gap only, mm. */
  gapKern: number;
  /** Total hand kerning at this gap, mm. */
  kern: number;
  /** Middle of the gap between the two letters' extremes, mm. */
  x: number;
}

export interface PlacedLine {
  baselineY: number;
  x0: number;
  width: number;
}

export interface Layout {
  project: Project;
  letters: PlacedLetter[];
  gaps: Gap[];
  lines: PlacedLine[];
  /** Lettering that runs outside the margins. */
  overflow: { wide: boolean; tall: boolean };
  /** Some datum lines were left off in a quick layout. */
  datumPending: boolean;
}

/**
 * With `quick` set, datum lines not already worked out are left off
 * (`datumPending` is then true) so that dragging a slider stays smooth.
 */
export function layoutPanel(store: LetterStore, p: Project, quick = false): Layout {
  const k = p.capHeight;
  const alphabet = store.alphabet;
  const texts = p.text.replace(/\r/g, '').split('\n');

  // Stack the lines so the block of capitals is centred top to bottom.
  const blockHeight = k + (texts.length - 1) * p.lineSpacing;
  const firstBaseline = (p.panelHeight - blockHeight) / 2 + k;

  const letters: PlacedLetter[] = [];
  const gaps: Gap[] = [];
  const lines: PlacedLine[] = [];
  let wide = false;
  let datumPending = false;

  texts.forEach((text, li) => {
    const chars = [...text];
    // Pen position of each character from the start of the line.
    const pens: number[] = [];
    let pen = 0;
    const gapKern = (i: number) => {
      const g = p.gapKerning[gapKey(li, i)];
      return g && g.pair === chars[i - 1] + chars[i] ? g.mm : 0;
    };
    chars.forEach((ch, i) => {
      pens.push(pen);
      pen += (alphabet.letter(ch)?.advance ?? 0.3) * k;
      const next = chars[i + 1];
      if (next !== undefined) {
        pen += alphabet.kerning(ch, next) * k + (p.kerning[ch + next] ?? 0) + gapKern(i + 1) + p.letterSpacing;
      }
    });
    const width = pen;
    const inner = p.panelWidth - 2 * p.margin;
    const x0 =
      p.align === 'left' ? p.margin : p.align === 'right' ? p.panelWidth - p.margin - width : p.margin + (inner - width) / 2;
    const baselineY = firstBaseline + li * p.lineSpacing;
    lines.push({ baselineY, x0, width });

    let prev: PlacedLetter | null = null;
    chars.forEach((ch, i) => {
      const m = store.marks(ch, k, { percent: p.datumPercent, minimum: p.datumMinimum }, quick);
      if (!m) {
        prev = null; // a space breaks the run: no gap to kern across it
        return;
      }
      const dx = x0 + pens[i];
      const dy = baselineY;
      const move = (c: Contour) => c.map((q) => ({ x: q.x + dx, y: q.y + dy }));
      const L: PlacedLetter = {
        char: ch,
        line: li,
        outline: m.outline.map(move),
        valleys: m.valleys.map((v) => v.map((q) => ({ x: q.x + dx, y: q.y + dy, r: q.r }))),
        datum: (m.datum ?? []).map(move),
        box: { x0: m.box.x0 + dx, x1: m.box.x1 + dx, y0: m.box.y0 + dy, y1: m.box.y1 + dy },
      };
      letters.push(L);
      if (!m.datum) datumPending = true;
      if (L.box.x0 < p.margin - 0.01 || L.box.x1 > p.panelWidth - p.margin + 0.01) wide = true;
      if (prev) {
        const pair = prev.char + ch;
        const pairKern = p.kerning[pair] ?? 0;
        const own = gapKern(i);
        gaps.push({
          pair,
          line: li,
          key: gapKey(li, i),
          left: prev,
          right: L,
          pairKern,
          gapKern: own,
          kern: round1(pairKern + own),
          x: (prev.box.x1 + L.box.x0) / 2,
        });
      }
      prev = L;
    });
  });

  const top = firstBaseline - k;
  const bottom = firstBaseline + (texts.length - 1) * p.lineSpacing;
  const tall = top < p.margin - 0.01 || bottom > p.panelHeight - p.margin + 0.01;

  return { project: p, letters, gaps, lines, overflow: { wide, tall }, datumPending };
}

function round1(v: number) {
  return Math.round(v * 10) / 10;
}
