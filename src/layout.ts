// Places the inscription on the panel, line by line.

import { datumLines } from './datum';
import type { Contour } from './geometry';
import { defaultGroups, groupPairKey, type KernGroups } from './groups';
import { defaultMachine, type MachineSettings } from './toolpath';
import type { Box, LetterStore, ShapeMode } from './letters';
import type { Pt } from './geometry';
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
   * Hand kerning for an exact letter pair (e.g. "AV"), wherever it occurs.
   * Overrides the pair's group kerning. Saved with the alphabet, so it
   * applies in every job. Like all hand kerning it is kept in mm as it would
   * be at KERN_CAP (25 mm) cap height, and scales with the letters.
   */
  kerning: Record<string, number>;
  /** Hand kerning by kerning group, keyed "right group|left group" (mm at KERN_CAP). Saved with the alphabet. */
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
   * Hand kerning for one gap only (mm at KERN_CAP), added on top of the pair's kerning.
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
  /** Heights of blank lines, mm, keyed by line number; a blank line not listed is one line spacing high. */
  spacers: Record<string, number>;
  /** The cap height hand kerning is kept at (always KERN_CAP; older saves lack it and are converted). */
  kernCap: number;
  /**
   * Letters linked on purpose into one shape (BRIEF.md, Decisions: "Linked
   * letters"), keyed by gap like one-gap kerning (see gapKey). The pair is
   * kept so that a link is ignored if the text changes under it. The overlap
   * is how far the right-hand letter goes in past touching, mm as at KERN_CAP
   * (it scales with the letters, like hand kerning).
   */
  links: Record<string, Link>;
}

export interface Link {
  pair: string;
  overlap: number;
}

/**
 * Hand kerning scales with the letters, as the alphabet's own kerning does
 * (BRIEF.md, Decisions: "Kerning scales with the letters"). It is kept as it
 * would be at this cap height, mm.
 */
export const KERN_CAP = 25;
/** Kept kerning to mm at a cap height. */
export const kernMm = (kept: number, capHeight: number) => (kept * capHeight) / KERN_CAP;
/** mm at a cap height to kept kerning. */
export const kernKept = (mm: number, capHeight: number) => Math.round(((mm * KERN_CAP) / capHeight) * 1e4) / 1e4;

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
  spacers: {},
  kernCap: KERN_CAP,
  links: {},
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

/** The pair kerning for a pair at the project's cap height, mm: its exact value if set, else its groups' value. */
export function pairKerning(p: Project, a: string, b: string): { mm: number; from: 'pair' | 'group' | 'none'; groupMm: number } {
  const gk = groupPairKey(p.groups, a, b);
  const groupMm = gk ? kernMm(p.groupKerning[gk] ?? 0, p.capHeight) : 0;
  const exact = p.kerning[a + b];
  if (exact !== undefined) return { mm: kernMm(exact, p.capHeight), from: 'pair', groupMm };
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
  /** The character, or for letters linked into one shape, each of them in order ("AM"). */
  char: string;
  line: number;
  /** Its place in its line's text (0 = the first character); for linked letters, the first one's. */
  pos: number;
  /** How many characters it is: 1, or more for letters linked into one shape. */
  span: number;
  outline: Contour[];
  valleys: ValleyLine[];
  datum: Contour[];
  box: Box;
  /** Linked letters: each joint between two neighbours, how wide (mm) and where. */
  joints?: { width: number; at: Pt }[];
  /** Linked letters: each character's own box, so what touches it can be named by the character it touches. */
  parts?: { char: string; pos: number; box: Box }[];
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
  /** Middle of the gap between the two letters' extremes, mm; for a linked gap, the middle of the joint. */
  x: number;
  /**
   * A linked gap: the two letters are joined into one shape (left and right
   * are then that one shape), the right-hand one going in past touching by
   * `overlap` mm. No kerning or spacing acts on it, and no space is measured
   * across it.
   */
  link: { overlap: number } | null;
}

export interface PlacedLine {
  /** 0 for the first line of the text, blank lines included. */
  index: number;
  /** The number shown to the carver: lettered lines only, 1, 2, 3…; null for a line with no letters. */
  number: number | null;
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

/** A blank line: a spacer whose height can be changed (Project.spacers). */
export interface Spacer {
  /** The blank line's place in the text (0 = first line). */
  index: number;
  /** The band of space it adds, mm from the panel's top edge: from where its cap line would be, `height` deep. */
  top: number;
  height: number;
  /** Its height was set by hand (else it is one line spacing). */
  custom: boolean;
}

export interface Layout {
  project: Project;
  letters: PlacedLetter[];
  gaps: Gap[];
  lines: PlacedLine[];
  spacers: Spacer[];
  /** Lettering that runs outside the margins. */
  overflow: { wide: boolean; tall: boolean };
  /** Some datum lines were left off in a quick layout. */
  datumPending: boolean;
  stops: PlacedStop[];
  /** Letters that could not be worked out, left as spaces: the character and its line (0 = first). */
  failed: { char: string; line: number }[];
  /** Some linked letters' valley lines are still being worked out (letters.ts): their outlines are shown meanwhile. */
  shapesPending: boolean;
  /** Linked letters that could not be joined, cut as separate letters: the pair, its line and its gap's key. */
  unjoined: { pair: string; line: number; key: string }[];
}

/**
 * The link at the gap before character `i` of a line, if it holds: its pair
 * still in that place, two letters (no space), and the two able to meet.
 */
export function linkAt(store: LetterStore, p: Project, line: number, chars: string[], i: number): Link | null {
  const l = p.links[gapKey(line, i)];
  if (!l || i < 1 || i >= chars.length || l.pair !== chars[i - 1] + chars[i]) return null;
  if (/\s/.test(chars[i - 1]) || /\s/.test(chars[i])) return null;
  return store.touch(chars[i - 1], chars[i]) === null ? null : l;
}

/**
 * With `quick` set, datum lines not already worked out are left off
 * (`datumPending` is then true) so that dragging a slider stays smooth.
 * `shapes` says how linked letters' valley lines are had when not yet worked
 * out (letters.ts, ShapeMode); by default as the store is set up.
 */
export function layoutPanel(store: LetterStore, p: Project, quick = false, shapes?: ShapeMode): Layout {
  const k = p.capHeight;
  const alphabet = store.alphabet;
  const texts = p.text.replace(/\r/g, '').split('\n');

  // Stack the lines so the block of capitals is centred top to bottom within the margins.
  const box = contentBox(p);
  // Each line sits one step below the line before. A lettered line's step is the
  // line spacing; a blank line is a spacer, and its step is its own height (one
  // line spacing unless set by hand). A blank line at the end adds its height
  // below the last lettered line.
  const steps = lineSteps(p, texts);
  const virtual: number[] = [];
  let run = 0;
  for (const st of steps) {
    virtual.push(run);
    run += st;
  }
  const last = texts.length - 1;
  const trailing = isBlank(texts[last]) ? steps[last] - p.lineSpacing : 0;
  const blockHeight = k + virtual[last] + trailing;
  const firstBaseline = box.y0 + (box.y1 - box.y0 - blockHeight) / 2 + k;
  const spacers: Spacer[] = [];
  texts.forEach((t, i) => {
    if (isBlank(t)) spacers.push({ index: i, top: firstBaseline + virtual[i] - k, height: steps[i], custom: String(i) in p.spacers });
  });

  const letters: PlacedLetter[] = [];
  const stops: PlacedStop[] = [];
  const failed: Layout['failed'] = [];
  const gaps: Gap[] = [];
  const lines: PlacedLine[] = [];
  let wide = false;
  let datumPending = false;
  let shapesPending = false;
  const unjoined: Layout['unjoined'] = [];
  const rule = { percent: p.datumPercent, minimum: p.datumMinimum };

  texts.forEach((text, li) => {
    const chars = [...text];
    // Pen position of each character from the start of the line.
    const pens: number[] = [];
    let pen = 0;
    const gapKern = (i: number) => {
      const g = p.gapKerning[gapKey(li, i)];
      return g && g.pair === chars[i - 1] + chars[i] ? kernMm(g.mm, k) : 0;
    };
    const extra = p.lineExtras[String(li)] ?? { letter: 0, word: 0 };
    // linked[i]: the link at the gap before character i, if it holds. A linked
    // letter sits where it touches the one before, less the overlap; no
    // kerning or spacing acts on it.
    const linked = chars.map((_, i) => linkAt(store, p, li, chars, i));
    chars.forEach((ch, i) => {
      pens.push(pen);
      const lk = linked[i + 1];
      if (lk) {
        pen = pens[i] + store.touch(ch, chars[i + 1])! * k - kernMm(lk.overlap, k);
        return;
      }
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
      let m: ReturnType<LetterStore['marks']> = null;
      try {
        m = store.marks(ch, k, { percent: p.datumPercent, minimum: p.datumMinimum }, true);
      } catch {
        m = null; // named in the problems below
      }
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
    const baselineY = place ? place.baseline : firstBaseline + virtual[li];
    const line: PlacedLine = { index: li, number: null, text, baselineY, x0, width, ink: null, placed: !!place, locked: !!place?.locked };
    lines.push(line);

    let prev: PlacedLetter | null = null;
    let lastInk: PlacedLetter | null = null;
    let spaceSince = false;
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      // Letters linked on from this one make one shape, to the end of the run.
      let end = i;
      while (linked[end + 1]) end++;
      let L: PlacedLetter | null = null;
      let ready = true;
      const dx = x0 + pens[i];
      const dy = baselineY;
      const move = (c: Contour) => c.map((q) => ({ x: q.x + dx, y: q.y + dy }));
      if (end > i) {
        const run = chars.slice(i, end + 1);
        try {
          const r = store.run(run, linked.slice(i + 1, end + 1).map((l) => l!.overlap / KERN_CAP), k, rule, quick, shapes);
          if (r) {
            L = {
              char: run.join(''),
              line: li,
              pos: i,
              span: run.length,
              outline: r.outline.map(move),
              valleys: r.valleys.map((v) => v.map((q) => ({ x: q.x + dx, y: q.y + dy, r: q.r }))),
              datum: (r.datum ?? []).map(move),
              box: { x0: r.box.x0 + dx, x1: r.box.x1 + dx, y0: r.box.y0 + dy, y1: r.box.y1 + dy },
              joints: r.joints.map((j) => ({ width: j.width, at: { x: j.at.x + dx, y: j.at.y + dy } })),
              parts: run.map((c, n) => {
                const b = store.marks(c, k, rule, true)?.box ?? { x0: 0, x1: 0, y0: 0, y1: 0 };
                const x = x0 + pens[i + n];
                return { char: c, pos: i + n, box: { x0: b.x0 + x, x1: b.x1 + x, y0: b.y0 + dy, y1: b.y1 + dy } };
              }),
            };
            if (r.pending) shapesPending = true;
            else if (!r.datum) datumPending = true;
          }
        } catch (err) {
          console.error(`Could not join “${run.join('')}” on line ${li + 1}:`, err);
        }
        // Not joined after all: cut as separate letters, where the link put them, and named in the problems.
        if (!L) {
          for (let j = i + 1; j <= end; j++) unjoined.push({ pair: chars[j - 1] + chars[j], line: li, key: gapKey(li, j) });
          end = i;
        }
      }
      if (!L) {
        let m: ReturnType<LetterStore['marks']> = null;
        try {
          m = store.marks(ch, k, rule, quick);
        } catch (err) {
          // Left as a space and named in the problems; the rest of the job carries on.
          if (!failed.some((f) => f.char === ch && f.line === li)) failed.push({ char: ch, line: li });
          console.error(`Could not work out “${ch}” on line ${li + 1}:`, err);
        }
        if (!m) {
          prev = null; // a space breaks the run: no gap to kern across it
          if (/\s/.test(ch)) spaceSince = true;
          continue;
        }
        L = {
          char: ch,
          line: li,
          pos: i,
          span: 1,
          outline: m.outline.map(move),
          valleys: m.valleys.map((v) => v.map((q) => ({ x: q.x + dx, y: q.y + dy, r: q.r }))),
          datum: (m.datum ?? []).map(move),
          box: { x0: m.box.x0 + dx, x1: m.box.x1 + dx, y0: m.box.y0 + dy, y1: m.box.y1 + dy },
        };
        ready = !!m.datum;
      }
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
      if (!ready) datumPending = true;
      if (L.box.x0 < box.x0 - 0.01 || L.box.x1 > box.x1 + 0.01) wide = true;
      if (prev) {
        const before = chars[i - 1];
        const pk = pairKerning(p, before, ch);
        const pairKern = pk.mm;
        const own = gapKern(i);
        gaps.push({
          pair: before + ch,
          line: li,
          key: gapKey(li, i),
          left: prev,
          right: L,
          pairKern,
          pairFrom: pk.from,
          groupKern: pk.groupMm,
          groupKey: groupPairKey(p.groups, before, ch),
          gapKern: own,
          kern: round1(pairKern + own),
          x: (prev.box.x1 + L.box.x0) / 2,
          link: null,
        });
      }
      // The links inside the run: gaps of their own, to select and unlink, but with nothing to kern or measure.
      for (let j = i + 1; j <= end; j++) {
        gaps.push({
          pair: chars[j - 1] + chars[j],
          line: li,
          key: gapKey(li, j),
          left: L,
          right: L,
          pairKern: 0,
          pairFrom: 'none',
          groupKern: 0,
          groupKey: groupPairKey(p.groups, chars[j - 1], chars[j]),
          gapKern: 0,
          kern: 0,
          x: L.joints?.[j - i - 1]?.at.x ?? x0 + pens[j],
          link: { overlap: kernMm(linked[j]!.overlap, k) },
        });
      }
      prev = L;
      i = end;
    }
  });

  const inked = lines.filter((l) => l.ink);
  inked.forEach((l, n) => (l.number = n + 1));
  const top = Math.min(...inked.map((l) => l.baselineY - k));
  const bottom = Math.max(...inked.map((l) => l.baselineY));
  const tall = inked.length > 0 && (top < box.y0 - 0.01 || bottom > box.y1 + 0.01);

  return { project: p, letters, gaps, lines, spacers, overflow: { wide, tall }, datumPending, stops, failed, shapesPending, unjoined };
}

/** A line with nothing on it but spaces: a spacer between lettered lines. */
export function isBlank(text: string): boolean {
  return !text.trim();
}

/**
 * How far below each line the next one sits, mm: the line spacing after a
 * lettered line, and a blank line's own height after a blank one.
 */
export function lineSteps(p: Project, texts = p.text.replace(/\r/g, '').split('\n')): number[] {
  return texts.map((t, i) => (isBlank(t) ? Math.max(0, p.spacers[String(i)] ?? p.lineSpacing) : p.lineSpacing));
}

/** The number the carver sees for a line (lettered lines only, from 1), from its place in the text. */
export function lineNumber(layout: Layout, index: number): number {
  return layout.lines[index]?.number ?? layout.lines.filter((l) => l.ink && l.index < index).length + 1;
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
