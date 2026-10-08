// Works out each letter's marks once and keeps them, so sliders stay quick.
//
// Outline and valley lines scale exactly with letter size, so they are worked
// out once per character at a cap height of 1 and scaled. The datum line has
// a minimum distance in millimetres, so it is worked out per size and rule.
//
// Letters linked into one shape (links.ts) are kept the same way, once per
// run of characters and overlaps. Their valley lines take a moment (a tenth
// to a third of a second each on a fast computer), and their datum lines at
// each size longer than the letters' own, so in the app both are asked of a
// worker: the run shows its outline, then its valleys, until they come.

import type { Alphabet } from './alphabet';
import { datumLines, type DatumRule } from './datum';
import type { Contour, Pt } from './geometry';
import { KERN_CAP } from './layout';
import { THIN_JOINT, touchAdvance, unitRun, type JointPlace, type UnitRun } from './links';
import { letterValleyOptions, valleyLines, type ValleyLine } from './valley';

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A letter's marks in millimetres, origin on the baseline at the pen position. */
export interface LetterMarks {
  outline: Contour[];
  valleys: ValleyLine[];
  /** null when asked for quickly and not worked out yet (see `marks`). */
  datum: Contour[] | null;
  box: Box;
}

interface UnitLetter {
  outline: Contour[];
  valleys: ValleyLine[];
}

type Sized = Omit<LetterMarks, 'datum'>;

/** Letters linked into one shape, at a cap height (links.ts). */
export interface RunMarks extends LetterMarks {
  /** Each letter's pen from the first's, mm. */
  pens: number[];
  /**
   * Each joint between two neighbours (from the first letter's pen): how
   * thick the wood is across it at its thinnest, mm; where it is; at the
   * feet, the heads or elsewhere; and the fill that built it up, if any.
   */
  joints: { width: number; at: Pt; place: JointPlace; fill: Contour | null; fills: Contour[] }[];
  /** Its valley lines are still being worked out: the outline is ready, the valleys and datum are not. */
  pending: boolean;
}

/**
 * How a run's valley lines are had if they are not worked out yet: on the
 * spot ('now'), from the worker, the run waiting meanwhile ('ask'), or not at
 * all, just its outline ('outline': for trying fixes on a copy).
 */
export type ShapeMode = 'now' | 'ask' | 'outline';

/** Names a run: its characters and each overlap (cap heights). */
export const runKey = (chars: string[], overlaps: number[]) => `${chars.join('')}|${overlaps.map((o) => o.toFixed(6)).join(',')}`;

export class LetterStore {
  private unit = new Map<string, UnitLetter | null>();
  private sized = new Map<string, Sized | null>();
  private datums = new Map<string, Contour[]>();
  private touches = new Map<string, number | null>();
  private runs = new Map<string, UnitRun | null>();
  private runValleys = new Map<string, ValleyLine[]>();
  private asked = new Set<string>();
  /** In the app: hands a run's joined outline (unit scale) to the worker, which answers with putValleys. */
  ask: ((key: string, outline: Contour[]) => void) | null = null;
  /** In the app: hands a run's valley lines at a size to the worker, for its datum lines; it answers with putDatum. */
  askDatum: ((key: string, valleys: ValleyLine[], rule: DatumRule) => void) | null = null;

  constructor(readonly alphabet: Alphabet) {}

  /**
   * How far apart two letters' pens are, at cap height 1, when the second,
   * sliding in from the right, first touches the first; null if they never
   * meet (links.ts, touchAdvance).
   */
  touch(a: string, b: string): number | null {
    const key = `${a}\u0000${b}`;
    if (this.touches.has(key)) return this.touches.get(key)!;
    const sa = this.alphabet.letter(a);
    const sb = this.alphabet.letter(b);
    const t = sa?.contours.length && sb?.contours.length ? touchAdvance(sa.contours, sb.contours) : null;
    this.touches.set(key, t);
    return t;
  }

  /** A run's valley lines, worked out elsewhere (the worker), at cap height 1. */
  putValleys(key: string, valleys: ValleyLine[]) {
    this.runValleys.set(key, valleys);
    this.asked.delete(key);
  }

  /** A run's datum lines at a size, worked out elsewhere (the worker). */
  putDatum(key: string, datum: Contour[]) {
    if (this.datums.size > 2000) this.datums.clear();
    this.datums.set(key, datum);
    this.asked.delete(key);
  }

  /** Work out a run's valley lines here and now, from its kept outline (when the worker cannot be had). */
  valleysNow(key: string) {
    const unit = this.runs.get(key);
    if (unit && !this.runValleys.has(key)) this.putValleys(key, valleyLines(unit.outline, letterValleyOptions));
  }

  /** Whether a run's valley lines are known (so it can be laid out in full without waiting). */
  hasValleys(key: string): boolean {
    return this.runValleys.has(key);
  }

  /**
   * Letters linked into one shape, at this cap height, `overlaps` in cap
   * heights; null if two neighbours never meet or a letter has no shape.
   */
  run(chars: string[], overlaps: number[], capHeight: number, rule: DatumRule, quick = false, mode: ShapeMode = this.ask ? 'ask' : 'now'): RunMarks | null {
    const key = runKey(chars, overlaps);
    let unit = this.runs.get(key);
    if (unit === undefined) {
      const shapes = chars.map((ch) => this.alphabet.letter(ch)?.contours ?? []);
      unit = shapes.every((s) => s.length) ? unitRun(shapes, overlaps, (i) => this.touch(chars[i - 1], chars[i]), THIN_JOINT / KERN_CAP) : null;
      if (this.runs.size > 500) this.runs.clear();
      this.runs.set(key, unit);
    }
    if (!unit) return null;
    let valleys = this.runValleys.get(key) ?? null;
    if (!valleys && mode === 'now') {
      valleys = valleyLines(unit.outline, letterValleyOptions);
      this.putValleys(key, valleys);
    } else if (!valleys && mode === 'ask' && !this.asked.has(key)) {
      this.asked.add(key);
      this.ask?.(key, unit.outline);
    }
    const k = capHeight;
    const outline = unit.outline.map((c) => c.map((p) => ({ x: p.x * k, y: p.y * k })));
    const sizedValleys = (valleys ?? []).map((l) => l.map((p) => ({ x: p.x * k, y: p.y * k, r: p.r * k })));
    let datum: Contour[] | null = null;
    if (valleys) {
      const dkey = `${key}|${k}|${rule.percent}|${rule.minimum}`;
      datum = this.datums.get(dkey) ?? null;
      if (!datum && !quick && (mode === 'now' || !this.askDatum)) {
        datum = datumLines(sizedValleys, rule);
        this.putDatum(dkey, datum);
      } else if (!datum && !quick && mode === 'ask' && !this.asked.has(dkey)) {
        this.asked.add(dkey);
        this.askDatum?.(dkey, sizedValleys, rule);
      }
    }
    return {
      outline,
      valleys: sizedValleys,
      datum,
      box: boxOf(outline),
      pens: unit.pens.map((x) => x * k),
      joints: unit.joints.map((j) => ({
        width: j.width * k,
        at: { x: j.at.x * k, y: j.at.y * k },
        place: j.place,
        fill: j.fill ? j.fill.map((p) => ({ x: p.x * k, y: p.y * k })) : null,
        fills: j.fills.map((f) => f.map((p) => ({ x: p.x * k, y: p.y * k }))),
      })),
      pending: !valleys,
    };
  }

  /**
   * The letter's marks at this cap height. Datum lines are the slowest part;
   * with `quick` set they are only returned if already worked out, so a
   * slider being dragged stays smooth, and are filled in afterwards.
   */
  marks(char: string, capHeight: number, rule: DatumRule, quick = false): LetterMarks | null {
    const m = this.sizedLetter(char, capHeight);
    if (!m) return null;
    const key = `${char}|${capHeight}|${rule.percent}|${rule.minimum}`;
    let datum = this.datums.get(key) ?? null;
    if (!datum && !quick) {
      datum = datumLines(m.valleys, rule);
      if (this.datums.size > 2000) this.datums.clear();
      this.datums.set(key, datum);
    }
    return { ...m, datum };
  }

  private sizedLetter(char: string, capHeight: number): Sized | null {
    const key = `${char}|${capHeight}`;
    if (this.sized.has(key)) return this.sized.get(key)!;
    const u = this.unitLetter(char);
    let m: Sized | null = null;
    if (u) {
      const k = capHeight;
      const outline = u.outline.map((c) => c.map((p) => ({ x: p.x * k, y: p.y * k })));
      const valleys = u.valleys.map((l) => l.map((p) => ({ x: p.x * k, y: p.y * k, r: p.r * k })));
      m = { outline, valleys, box: boxOf(outline) };
    }
    if (this.sized.size > 2000) this.sized.clear();
    this.sized.set(key, m);
    return m;
  }

  private unitLetter(char: string): UnitLetter | null {
    if (this.unit.has(char)) return this.unit.get(char)!;
    const shape = this.alphabet.letter(char);
    let u: UnitLetter | null = null;
    if (shape && shape.contours.length) {
      u = { outline: shape.contours, valleys: valleyLines(shape.contours, letterValleyOptions) };
    }
    this.unit.set(char, u);
    return u;
  }
}

export function boxOf(contours: Contour[]): Box {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const c of contours)
    for (const p of c) {
      b.x0 = Math.min(b.x0, p.x);
      b.x1 = Math.max(b.x1, p.x);
      b.y0 = Math.min(b.y0, p.y);
      b.y1 = Math.max(b.y1, p.y);
    }
  return b;
}
