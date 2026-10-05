// Works out each letter's marks once and keeps them, so sliders stay quick.
//
// Outline and valley lines scale exactly with letter size, so they are worked
// out once per character at a cap height of 1 and scaled. The datum line is a
// fixed distance in millimetres, so it is worked out per size and offset.

import type { Alphabet } from './alphabet';
import { datumLines } from './datum';
import type { Contour } from './geometry';
import { valleyLines, type ValleyLine } from './valley';

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
  datum: Contour[];
  box: Box;
}

interface UnitLetter {
  outline: Contour[];
  valleys: ValleyLine[];
}

export class LetterStore {
  private unit = new Map<string, UnitLetter | null>();
  private sized = new Map<string, LetterMarks | null>();

  constructor(readonly alphabet: Alphabet) {}

  marks(char: string, capHeight: number, datumOffset: number): LetterMarks | null {
    const key = `${char}|${capHeight}|${datumOffset}`;
    if (this.sized.has(key)) return this.sized.get(key)!;
    const u = this.unitLetter(char);
    let m: LetterMarks | null = null;
    if (u) {
      const k = capHeight;
      const outline = u.outline.map((c) => c.map((p) => ({ x: p.x * k, y: p.y * k })));
      const valleys = u.valleys.map((l) => l.map((p) => ({ x: p.x * k, y: p.y * k, r: p.r * k })));
      m = { outline, valleys, datum: datumLines(outline, datumOffset), box: boxOf(outline) };
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
      // Steps are in cap heights: 0.0015 is 0.04 mm on a 25 mm letter.
      u = {
        outline: shape.contours,
        valleys: valleyLines(shape.contours, { step: 0.0015, minAngleDeg: 30, simplifyTol: 0.0003 }),
      };
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
