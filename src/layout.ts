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
  datumOffset: number; // mm
  /**
   * Hand kerning in mm, keyed by the letter pair (e.g. "AV"). Applies to
   * every place that pair occurs, on top of the alphabet's own kerning.
   */
  kerning: Record<string, number>;
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
  datumOffset: 0.75,
  kerning: {},
};

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
  /** Hand kerning for this pair, mm. */
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
}

export function layoutPanel(store: LetterStore, p: Project): Layout {
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

  texts.forEach((text, li) => {
    const chars = [...text];
    // Pen position of each character from the start of the line.
    const pens: number[] = [];
    let pen = 0;
    chars.forEach((ch, i) => {
      pens.push(pen);
      pen += (alphabet.letter(ch)?.advance ?? 0.3) * k;
      const next = chars[i + 1];
      if (next !== undefined) {
        pen += alphabet.kerning(ch, next) * k + (p.kerning[ch + next] ?? 0) + p.letterSpacing;
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
      const m = store.marks(ch, k, p.datumOffset);
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
        datum: m.datum.map(move),
        box: { x0: m.box.x0 + dx, x1: m.box.x1 + dx, y0: m.box.y0 + dy, y1: m.box.y1 + dy },
      };
      letters.push(L);
      if (L.box.x0 < p.margin - 0.01 || L.box.x1 > p.panelWidth - p.margin + 0.01) wide = true;
      if (prev) {
        const pair = prev.char + ch;
        gaps.push({ pair, line: li, left: prev, right: L, kern: p.kerning[pair] ?? 0, x: (prev.box.x1 + L.box.x0) / 2 });
      }
      prev = L;
    });
  });

  const top = firstBaseline - k;
  const bottom = firstBaseline + (texts.length - 1) * p.lineSpacing;
  const tall = top < p.margin - 0.01 || bottom > p.panelHeight - p.margin + 0.01;

  return { project: p, letters, gaps, lines, overflow: { wide, tall } };
}
