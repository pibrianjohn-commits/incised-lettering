// Places the inscription on the panel, line by line.

import { datumLines } from './datum';
import type { Contour } from './geometry';
import { defaultGroups, groupPairKey, type KernGroups } from './groups';
import { defaultMachine, type MachineSettings } from './toolpath';
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
  /**
   * Clear space round the lettering, mm, per side. Measured from the
   * border's inner edge, or from the panel edge where there is no border.
   */
  margins: Margins;
  border: Border;
  /** Picture placed behind the layout to trace or match; the picture itself is stored separately. */
  refImage: RefImage | null;
  /** Datum line set in from the outline by this percentage of the local stroke width… */
  datumPercent: number;
  /** …but never closer to the outline than this, mm. */
  datumMinimum: number;
  /**
   * Hand kerning in mm for an exact letter pair (e.g. "AV"), wherever it
   * occurs. Overrides the pair's group kerning. Saved with the alphabet, so
   * it applies in every job.
   */
  kerning: Record<string, number>;
  /** Hand kerning in mm by kerning group, keyed "right group|left group". Saved with the alphabet. */
  groupKerning: Record<string, number>;
  /** Which letters share a side shape, for group kerning. Saved with the alphabet. */
  groups: KernGroups;
  /** Even-up spacing settings. Saved with the alphabet. */
  evenUp: EvenUpSettings;
  /** Extra spacing per line from fitting it to a width, mm, keyed by line number. */
  lineExtras: Record<string, LineExtra>;
  wordStops: WordStops;
  /** Stock, tool, feeds, depths and which passes to run, for the G-code. */
  machine: MachineSettings;
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
  /** Guide lines dragged out of the rulers, mm from the panel's top-left corner. */
  guides: { x: number[]; y: number[] };
  /** Lines placed or locked by hand, keyed by line number (0 = first line). */
  lines: Record<string, LinePlacement>;
}

/**
 * A line placed by hand. It keeps its place when the line-spacing slider or
 * alignment changes, until it is returned to auto. `x` is where the line is
 * anchored, read according to `align`: its left end, its centre, or its
 * right end (pen positions, so editing the text keeps it anchored the same way).
 */
export interface LinePlacement {
  x: number;
  align: Align;
  baseline: number;
  locked?: boolean;
}

export const defaultProject: Project = {
  text: 'OAK',
  capHeight: 25,
  letterSpacing: 0,
  lineSpacing: 40,
  align: 'centre',
  panelWidth: 150,
  panelHeight: 60,
  margins: { top: 10, right: 10, bottom: 10, left: 10 },
  border: { style: 'none', inset: 6, gap: 1.5, width: 3 },
  refImage: null,
  datumPercent: 20,
  datumMinimum: 0.2,
  kerning: {},
  groupKerning: {},
  groups: defaultGroups,
  evenUp: { reference: 'HH', round: 1, straight: 1, diagonal: 1 },
  lineExtras: {},
  wordStops: { on: false, size: 22, height: 45, point: 'down' },
  machine: defaultMachine,
  gapKerning: {},
  spaceDepth: 6,
  guides: { x: [], y: [] },
  lines: {},
};

export interface EvenUpSettings {
  /** The pair set by eye, whose space every other pair is matched to. */
  reference: string;
  /** How much space a round, straight or diagonal side wants, relative to the reference. */
  round: number;
  straight: number;
  diagonal: number;
}

/** Extra spacing on one line, from fitting it to a width. */
export interface LineExtra {
  /** Added between every pair of characters on the line, mm. */
  letter: number;
  /** Added to every word space on the line, mm. */
  word: number;
}

export interface WordStops {
  on: boolean;
  /** Side of the triangle, % of cap height. */
  size: number;
  /** Height of its centre above the baseline, % of cap height. */
  height: number;
  point: 'up' | 'down';
}

/** A word stop: a small incised triangle between two words. */
export interface PlacedStop {
  line: number;
  outline: Contour[];
  valleys: ValleyLine[];
  datum: Contour[];
}

/** The pair kerning for a pair: its exact value if set, else its groups' value. */
export function pairKerning(p: Project, a: string, b: string): { mm: number; from: 'pair' | 'group' | 'none'; groupMm: number } {
  const gk = groupPairKey(p.groups, a, b);
  const groupMm = gk ? (p.groupKerning[gk] ?? 0) : 0;
  const exact = p.kerning[a + b];
  if (exact !== undefined) return { mm: exact, from: 'pair', groupMm };
  if (gk && p.groupKerning[gk] !== undefined) return { mm: groupMm, from: 'group', groupMm };
  return { mm: 0, from: 'none', groupMm };
}

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type BorderStyle = 'none' | 'single' | 'double' | 'incised';

export interface Border {
  style: BorderStyle;
  /** Distance from the panel edge to the border's outer edge, mm. */
  inset: number;
  /** Double border: distance between the two lines, mm. */
  gap: number;
  /** Incised border: width of the cut band, mm. */
  width: number;
}

export interface RefImage {
  /** Top-left corner, mm from the panel's top-left corner. */
  x: number;
  y: number;
  /** Width on the panel, mm; the height follows from the picture's shape. */
  width: number;
  /** Height ÷ width of the picture. */
  aspect: number;
  opacity: number; // 0–1
  locked: boolean;
  visible: boolean;
}

/** How far in from the panel edge the border's inner edge is (0 with no border), mm. */
export function borderDepth(b: Border): number {
  switch (b.style) {
    case 'none':
      return 0;
    case 'single':
      return b.inset;
    case 'double':
      return b.inset + b.gap;
    case 'incised':
      return b.inset + b.width;
  }
}

/** The area the lettering sits in: inside the border and the margins, mm. */
export function contentBox(p: Project): { x0: number; y0: number; x1: number; y1: number } {
  const d = borderDepth(p.border);
  return {
    x0: d + p.margins.left,
    y0: d + p.margins.top,
    x1: p.panelWidth - d - p.margins.right,
    y1: p.panelHeight - d - p.margins.bottom,
  };
}

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
  /** Hand kerning for this pair wherever it occurs (exact pair, else its groups), mm. */
  pairKern: number;
  /** Where pairKern comes from. */
  pairFrom: 'pair' | 'group' | 'none';
  /** The groups' kerning for this pair (overridden if the exact pair is set), mm. */
  groupKern: number;
  /** "right group|left group" for this pair, or null if a letter has no group. */
  groupKey: string | null;
  /** Extra hand kerning for this gap only, mm. */
  gapKern: number;
  /** Total hand kerning at this gap, mm. */
  kern: number;
  /** Middle of the gap between the two letters' extremes, mm. */
  x: number;
}

export interface PlacedLine {
  /** 0 for the first line. Shown to the carver as 1, 2, 3… */
  index: number;
  text: string;
  baselineY: number;
  /** Pen start of the line, mm. */
  x0: number;
  /** Pen width of the line (from the first pen position to the last), mm. */
  width: number;
  /** Extent of the letters themselves, mm; null for a line with no letters. */
  ink: { x0: number; x1: number } | null;
  placed: boolean;
  locked: boolean;
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
  stops: PlacedStop[];
}

/**
 * With `quick` set, datum lines not already worked out are left off
 * (`datumPending` is then true) so that dragging a slider stays smooth.
 */
export function layoutPanel(store: LetterStore, p: Project, quick = false): Layout {
  const k = p.capHeight;
  const alphabet = store.alphabet;
  const texts = p.text.replace(/\r/g, '').split('\n');

  // Stack the lines so the block of capitals is centred top to bottom within the margins.
  const box = contentBox(p);
  const blockHeight = k + (texts.length - 1) * p.lineSpacing;
  const firstBaseline = box.y0 + (box.y1 - box.y0 - blockHeight) / 2 + k;

  const letters: PlacedLetter[] = [];
  const stops: PlacedStop[] = [];
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
    const extra = p.lineExtras[String(li)] ?? { letter: 0, word: 0 };
    chars.forEach((ch, i) => {
      pens.push(pen);
      pen += (alphabet.letter(ch)?.advance ?? 0.3) * k;
      if (/\s/.test(ch)) pen += extra.word;
      const next = chars[i + 1];
      if (next !== undefined) {
        pen += alphabet.kerning(ch, next) * k + pairKerning(p, ch, next).mm + gapKern(i + 1) + p.letterSpacing + extra.letter;
      }
    });
    const width = pen;
    // Where the letters themselves start and end, measured from the pen start.
    // Auto lines are aligned by their letters, as a carver measures them, not
    // by the invisible space each letter carries either side.
    let inkL = Infinity;
    let inkR = -Infinity;
    chars.forEach((ch, i) => {
      const m = store.marks(ch, k, { percent: p.datumPercent, minimum: p.datumMinimum }, true);
      if (!m) return;
      inkL = Math.min(inkL, pens[i] + m.box.x0);
      inkR = Math.max(inkR, pens[i] + m.box.x1);
    });
    if (inkL > inkR) inkL = inkR = 0; // no letters on this line
    const place = p.lines[String(li)];
    const x0 = place
      ? lineStart(place.x, place.align, width)
      : p.align === 'left'
        ? box.x0 - inkL
        : p.align === 'right'
          ? box.x1 - inkR
          : (box.x0 + box.x1) / 2 - (inkL + inkR) / 2;
    const baselineY = place ? place.baseline : firstBaseline + li * p.lineSpacing;
    const line: PlacedLine = { index: li, text, baselineY, x0, width, ink: null, placed: !!place, locked: !!place?.locked };
    lines.push(line);

    let prev: PlacedLetter | null = null;
    let lastInk: PlacedLetter | null = null;
    let spaceSince = false;
    chars.forEach((ch, i) => {
      const m = store.marks(ch, k, { percent: p.datumPercent, minimum: p.datumMinimum }, quick);
      if (!m) {
        prev = null; // a space breaks the run: no gap to kern across it
        if (/\s/.test(ch)) spaceSince = true;
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
      // A word stop goes in the middle of each word space, between the letters either side.
      if (p.wordStops.on && spaceSince && lastInk) {
        stops.push(wordStop((lastInk.box.x1 + L.box.x0) / 2, baselineY, li, p));
      }
      lastInk = L;
      spaceSince = false;
      line.ink = line.ink
        ? { x0: Math.min(line.ink.x0, L.box.x0), x1: Math.max(line.ink.x1, L.box.x1) }
        : { x0: L.box.x0, x1: L.box.x1 };
      if (!m.datum) datumPending = true;
      if (L.box.x0 < box.x0 - 0.01 || L.box.x1 > box.x1 + 0.01) wide = true;
      if (prev) {
        const pair = prev.char + ch;
        const pk = pairKerning(p, prev.char, ch);
        const pairKern = pk.mm;
        const own = gapKern(i);
        gaps.push({
          pair,
          line: li,
          key: gapKey(li, i),
          left: prev,
          right: L,
          pairKern,
          pairFrom: pk.from,
          groupKern: pk.groupMm,
          groupKey: groupPairKey(p.groups, prev.char, ch),
          gapKern: own,
          kern: round1(pairKern + own),
          x: (prev.box.x1 + L.box.x0) / 2,
        });
      }
      prev = L;
    });
  });

  const inked = lines.filter((l) => l.ink);
  const top = Math.min(...inked.map((l) => l.baselineY - k));
  const bottom = Math.max(...inked.map((l) => l.baselineY));
  const tall = inked.length > 0 && (top < box.y0 - 0.01 || bottom > box.y1 + 0.01);

  return { project: p, letters, gaps, lines, overflow: { wide, tall }, datumPending, stops };
}

/**
 * A word stop centred at x, cut like a letter: an equilateral triangle whose
 * valley runs from its centre out to each corner, with datum lines by the
 * same rule as the letters.
 */
export function wordStop(x: number, baselineY: number, line: number, p: Project): PlacedStop {
  const k = p.capHeight;
  const side = (p.wordStops.size / 100) * k;
  const h = (side * Math.sqrt(3)) / 2;
  const cy = baselineY - (p.wordStops.height / 100) * k;
  const s = p.wordStops.point === 'up' ? -1 : 1; // which way the point goes
  // The centre sits a third of the way up from the flat side.
  const tip = { x, y: cy + s * ((2 * h) / 3) };
  const a = { x: x - side / 2, y: cy - s * (h / 3) };
  const b = { x: x + side / 2, y: cy - s * (h / 3) };
  const r = h / 3; // distance from the centre to each side
  const valleys = [tip, a, b].map((c) => [
    { x, y: cy, r },
    { x: c.x, y: c.y, r: 0 },
  ]);
  return {
    line,
    outline: [[tip, b, a]],
    valleys,
    datum: datumLines(valleys, { percent: p.datumPercent, minimum: p.datumMinimum }),
  };
}

function round1(v: number) {
  return Math.round(v * 10) / 10;
}

/** Pen start of a line of pen width `width` anchored at `x` by `align`. */
export function lineStart(x: number, align: Align, width: number): number {
  return align === 'left' ? x : align === 'right' ? x - width : x - width / 2;
}

/** The anchor that puts a line of pen width `width` starting at `x0`, for `align`. */
export function lineAnchor(x0: number, align: Align, width: number): number {
  return align === 'left' ? x0 : align === 'right' ? x0 + width : x0 + width / 2;
}
