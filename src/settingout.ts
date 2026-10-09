// The setting-out lines (BRIEF.md, Decisions: "The setting-out lines"): for
// every lettered line, the lines a letterer rules before drawing the letters,
// cap line, mid line and baseline, and where its letters need them the
// x-height, ascender and descender lines; and the panel's centre lines.
// Worked out from the layout and the alphabet's own heights only, never from
// the machine settings (CLAUDE.md: "One program; editions later"), and never
// scribed by the machine.

import type { AlphabetHeights } from './alphabet';
import type { Box } from './letters';
import type { Layout } from './layout';

export type SetKind = 'cap' | 'mid' | 'x' | 'asc' | 'base' | 'desc';

/** Each kind's short name, on its label beside the line. */
export const SET_SHORT: Record<SetKind, string> = { cap: 'cap', mid: 'mid', x: 'x', asc: 'asc', base: 'base', desc: 'desc' };
/** Each kind's full name, as the snap labels give it ("line 2 mid line"). */
export const SET_NAMES: Record<SetKind, string> = {
  cap: 'cap line',
  mid: 'mid line',
  x: 'x-height line',
  asc: 'ascender line',
  base: 'baseline',
  desc: 'descender line',
};

export interface SetLine {
  kind: SetKind;
  /** mm from the panel's top edge. */
  y: number;
  /** Height above the baseline, mm (negative below it). */
  height: number;
}

/** One lettered line's setting-out lines. */
export interface LineSet {
  /** The line's place in the text (0 = the first line). */
  index: number;
  /** The number the carver sees. */
  number: number;
  baselineY: number;
  /** From the top down: cap, (ascender), (x-height), mid, baseline, (descender). */
  lines: SetLine[];
  /** The character that goes deepest below the baseline, where there is a descender line. */
  deepest: string | null;
}

/**
 * A dip below the baseline (or a rise above the x-height) no bigger than this
 * many overshoots is overshoot, as an O goes past the lines, and draws no
 * line: Cinzel's O dips 0.02 of the cap height, its 6 a hair more.
 */
export const OVERSHOOTS = 2;

/** The setting-out lines of every lettered line, from the alphabet's own heights. */
export function lineSets(layout: Layout, h: AlphabetHeights): LineSet[] {
  const k = layout.project.capHeight;
  const spare = OVERSHOOTS * h.overshoot + 1e-3;
  const sets: LineSet[] = [];
  for (const line of layout.lines) {
    if (!line.ink) continue; // a blank line has none
    const chars = layout.letters.filter((l) => l.line === line.index).flatMap((l) => [...l.char]);
    const b = line.baselineY;
    const at = (kind: SetKind, height: number): SetLine => ({ kind, y: b - height, height });
    const lines = [at('cap', k)];
    const lower = chars.filter((c) => /\p{Ll}/u.test(c));
    const x = h.xHeight;
    if (lower.length && x !== null) {
      if (h.ascender !== null && lower.some((c) => h.rise(c) > x + spare)) lines.push(at('asc', h.ascender * k));
      lines.push(at('x', x * k));
    }
    lines.push(at('mid', k / 2), at('base', 0));
    let deepest: string | null = null;
    let depth = spare;
    for (const c of chars) {
      const d = h.descent(c);
      if (d > depth) [depth, deepest] = [d, c];
    }
    if (deepest) lines.push(at('desc', -depth * k));
    lines.sort((a, c) => a.y - c.y);
    sets.push({ index: line.index, number: line.number ?? line.index + 1, baselineY: b, lines, deepest });
  }
  return sets;
}

/** The panel's centre lines: the upright one across at `x`, the level one down at `y`, mm. */
export function panelCentre(layout: Layout): { x: number; y: number } {
  return { x: layout.project.panelWidth / 2, y: layout.project.panelHeight / 2 };
}

/** −9.0, with a true minus. */
const fig = (v: number) => `${v < -0.05 ? '−' : ''}${Math.abs(v).toFixed(1)}`;

/**
 * A line's label: its height above the baseline in mm ("cap 31.5", "mid 15.8",
 * "desc −9.0"); the baseline its distance from the panel's top, as the rulers
 * and the line tools give it ("base 114.8").
 */
export function setLabel(l: SetLine): string {
  return `${SET_SHORT[l.kind]} ${fig(l.kind === 'base' ? l.y : l.height)}`;
}

/**
 * Which label is kept where two come closer than a label is tall: the
 * baseline's first (each line's own place), then the descender's (each line's
 * own depth), then the cap line's and mid line's (the same on every line)…
 */
const KEEP: SetKind[] = ['base', 'desc', 'cap', 'mid', 'x', 'asc'];

export interface PlacedLabel {
  text: string;
  kind: SetKind;
  /** The line's place in the text. */
  line: number;
  /** Where the label's text ends (anchor 'end') or starts ('start'), and the middle of its height. */
  x: number;
  y: number;
  anchor: 'start' | 'end';
  box: Box;
}

export interface LabelRoom {
  /** Panel mm down the page to the units the labels are placed in (screen px, or mm on paper). */
  sy: (y: number) => number;
  /**
   * Where a line's labels go: ending at `end` (beside the line number, on its
   * left), or, where that would run past `minX`, starting at `start` (on its right).
   */
  column: (set: LineSet) => { end: number; start: number };
  minX: number;
  /** Things labels are never put over: the letters, in the same units. */
  avoid: Box[];
  /** A label's height, and a generous width per character, in the same units. */
  height: number;
  charWidth: number;
}

/**
 * Where the labels go, at each line's left end beside its number: fixed in
 * size, dropped where its line comes closer to another kept label's than a
 * label is tall, and never over the letters. They make one column, all on
 * the numbers' left, or all on their right where there is no room on the left.
 */
export function placeLabels(sets: LineSet[], shown: (kind: SetKind) => boolean, room: LabelRoom): PlacedLabel[] {
  const kept: PlacedLabel[] = [];
  const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const widest = Math.max(0, ...sets.flatMap((set) => set.lines.filter((l) => shown(l.kind)).map((l) => setLabel(l).length * room.charWidth)));
  const anchor = sets.every((set) => room.column(set).end - widest >= room.minX) ? 'end' : 'start';
  for (const kind of KEEP) {
    if (!shown(kind)) continue;
    for (const set of sets) {
      const l = set.lines.find((q) => q.kind === kind);
      if (!l) continue;
      const text = setLabel(l);
      const y = room.sy(l.y);
      if (!Number.isFinite(y) || kept.some((q) => Math.abs(q.y - y) < room.height)) continue;
      const w = text.length * room.charWidth;
      const col = room.column(set);
      const x = anchor === 'end' ? col.end : col.start;
      const box = { x0: anchor === 'end' ? x - w : x, x1: anchor === 'end' ? x : x + w, y0: y - room.height / 2, y1: y + room.height / 2 };
      if (room.avoid.some((b) => hit(box, b))) continue;
      kept.push({ text, kind, line: set.index, x, y, anchor, box });
    }
  }
  return kept;
}
