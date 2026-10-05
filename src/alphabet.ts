// An alphabet supplies letter shapes. Today the only source is a font file;
// later the carver's own drawn letters (SVG) will provide the same interface,
// so nothing downstream needs to change.

import { parse, type Font } from 'opentype.js';
import { flattenPath, type Contour, type PathCommand } from './geometry';

/**
 * A letter normalised so that the cap height is 1 unit.
 * Origin at the left side bearing on the baseline, y pointing down
 * (so the top of a flat capital such as H sits at y = -1).
 */
export interface LetterShape {
  char: string;
  contours: Contour[];
  advance: number;
}

export interface Alphabet {
  name: string;
  licence: string;
  /** Returns null if the alphabet has no shape for this character. */
  letter(char: string): LetterShape | null;
  /** Extra space between a pair, in cap-height units (negative = closer). */
  kerning(left: string, right: string): number;
}

/** Load a TrueType / OpenType / WOFF font as an alphabet. */
export function alphabetFromFont(buffer: ArrayBuffer, licence: string): Alphabet {
  const font: Font = parse(buffer);
  const capUnits = capHeightUnits(font);
  // Flatten curves finely: 0.002 cap heights = 0.05 mm at 25 mm.
  const tol = 0.002;
  const cache = new Map<string, LetterShape | null>();

  return {
    name: font.getEnglishName('fullName') || 'Font',
    licence,
    letter(char) {
      if (cache.has(char)) return cache.get(char)!;
      const glyph = font.charToGlyph(char);
      let shape: LetterShape | null = null;
      if (glyph && glyph.index !== 0) {
        // getPath(x, y, size) returns a y-down path with the baseline at y.
        const path = glyph.getPath(0, 0, font.unitsPerEm / capUnits);
        shape = {
          char,
          contours: flattenPath(path.commands as PathCommand[], tol),
          advance: (glyph.advanceWidth ?? 0) / capUnits,
        };
      }
      cache.set(char, shape);
      return shape;
    },
    kerning(left, right) {
      return font.getKerningValue(font.charToGlyph(left), font.charToGlyph(right)) / capUnits;
    },
  };
}

/**
 * Cap height in font units. Taken from the font's own figure when present,
 * otherwise measured from the top of a flat-topped capital (H).
 */
function capHeightUnits(font: Font): number {
  const os2 = font.tables.os2 as { sCapHeight?: number } | undefined;
  if (os2?.sCapHeight) return os2.sCapHeight;
  return font.charToGlyph('H').getBoundingBox().y2;
}
