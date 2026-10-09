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
  /** Its heights, for the setting-out lines (BRIEF.md, Decisions: "The setting-out lines"). */
  heights: AlphabetHeights;
}

/**
 * An alphabet's heights in cap heights (the cap height is 1), measured from
 * its own letters once, when it loads; never taken from a font's metrics
 * table, which need not say where its letters are (Cinzel's says its
 * x-height is 500/700, but its small capitals stand 0.857 tall). An alphabet
 * drawn as SVG will have them set by hand.
 */
export interface AlphabetHeights {
  /** The top of its x; null if it has no x. */
  xHeight: number | null;
  /** The top of the tallest of b d h k l; null if it has none of them. */
  ascender: number | null;
  /** How far its O goes past the cap line or the baseline, whichever is more (0 if it has no O). Kept for later; not drawn. */
  overshoot: number;
  /** How far a character goes below the baseline, from its own outline (0 if it does not, or the alphabet has no shape for it). */
  descent(char: string): number;
  /** How far a character rises above the baseline, from its own outline (0 if the alphabet has no shape for it). */
  rise(char: string): number;
}

/** Measure an alphabet's heights from its letters (see AlphabetHeights). */
export function measureHeights(letter: (char: string) => LetterShape | null): AlphabetHeights {
  const ends = new Map<string, { top: number; bottom: number } | null>();
  // y points down: the top of a letter is its least y, the bottom its greatest.
  const extent = (char: string) => {
    if (ends.has(char)) return ends.get(char)!;
    const pts = letter(char)?.contours.flat() ?? [];
    const e = pts.length ? { top: -Math.min(...pts.map((p) => p.y)), bottom: Math.max(...pts.map((p) => p.y)) } : null;
    ends.set(char, e);
    return e;
  };
  const tops = [...'bdhkl'].map((c) => extent(c)?.top).filter((t): t is number => t !== undefined);
  const o = extent('O');
  return {
    xHeight: extent('x')?.top ?? null,
    ascender: tops.length ? Math.max(...tops) : null,
    overshoot: o ? Math.max(0, o.top - 1, o.bottom) : 0,
    descent: (char) => Math.max(0, extent(char)?.bottom ?? 0),
    rise: (char) => extent(char)?.top ?? 0,
  };
}

/** Load a TrueType / OpenType / WOFF font as an alphabet. */
export function alphabetFromFont(buffer: ArrayBuffer, licence: string): Alphabet {
  const font: Font = parse(buffer);
  const capUnits = capHeightUnits(font);
  // Flatten curves finely: 0.002 cap heights = 0.05 mm at 25 mm.
  const tol = 0.002;
  const cache = new Map<string, LetterShape | null>();

  const alphabet: Alphabet = {
    name: font.getEnglishName('fullName') || 'Font',
    licence,
    heights: null as unknown as AlphabetHeights, // measured below, from the letters
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
  // Its x-height, ascender and overshoot are measured now, once; each letter's
  // own descent and rise when first asked, from the same outline it is drawn with.
  alphabet.heights = measureHeights((char) => alphabet.letter(char));
  return alphabet;
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
