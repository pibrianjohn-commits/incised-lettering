import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { alphabetFromFont } from '../src/alphabet';
import { distanceToBoundary, insideShape } from '../src/geometry';
import { defaultProject, layoutPanel, type Project } from '../src/layout';
import { LetterStore } from '../src/letters';
import { negativeSpace } from '../src/negativeSpace';

const buf = readFileSync(new URL('../public/fonts/Cinzel-Regular.woff', import.meta.url));
const alphabet = alphabetFromFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'OFL');
const store = new LetterStore(alphabet);
const lay = (change: Partial<Project> = {}) => layoutPanel(store, { ...defaultProject, ...change });

describe('OAK at 25 mm cap height', () => {
  const layout = lay();
  const baselineY = layout.lines[0].baselineY;

  it('flat-topped capitals stand exactly 25 mm tall on the baseline', () => {
    const K = layout.letters.find((l) => l.char === 'K')!;
    expect(K.box.y1 - K.box.y0).toBeCloseTo(25, 2);
    expect(K.box.y1).toBeCloseTo(baselineY, 2);
  });

  it('valley points lie inside the letter, midway between the walls', () => {
    for (const L of layout.letters) {
      expect(L.valleys.length).toBeGreaterThan(0);
      for (const p of L.valleys.flat()) {
        expect(insideShape(p, L.outline)).toBe(true);
        expect(Math.abs(distanceToBoundary(p, L.outline) - p.r)).toBeLessThan(0.03);
      }
    }
  });

  it('the valley of O is a closed ring with no forks', () => {
    const O = layout.letters.find((l) => l.char === 'O')!;
    expect(O.valleys.length).toBe(1);
    const v = O.valleys[0];
    expect(Math.hypot(v[0].x - v[v.length - 1].x, v[0].y - v[v.length - 1].y)).toBeLessThan(0.1);
  });

  it('the datum line sits at the datum offset inside the outline', () => {
    for (const off of [0.5, 0.75, 1]) {
      for (const L of lay({ datumOffset: off }).letters) {
        for (const p of L.datum.flat()) {
          expect(insideShape(p, L.outline)).toBe(true);
          expect(Math.abs(distanceToBoundary(p, L.outline) - off)).toBeLessThan(0.005);
        }
      }
    }
  });

  it('the datum line stops where a stroke is too narrow for it', () => {
    // The A crossbar is about 1.05 mm thick at its middle (8.7 to 9.75 mm up).
    // Count datum lines crossing a vertical line through its middle.
    const crossings = (off: number) => {
      const A = lay({ datumOffset: off }).letters.find((l) => l.char === 'A')!;
      const x = (A.box.x0 + A.box.x1) / 2;
      let n = 0;
      for (const c of A.datum)
        for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
          const a = c[j];
          const b = c[i];
          if ((a.x > x) === (b.x > x)) continue;
          const y = baselineY - (a.y + ((x - a.x) * (b.y - a.y)) / (b.x - a.x));
          if (y > 8 && y < 10.5) n++;
        }
      return n;
    };
    expect(crossings(0.4)).toBe(2); // room for a line each side
    expect(crossings(0.75)).toBe(0); // no room: the line stops
  });
});

describe('layout tools', () => {
  it('kerning a pair moves the following letters by exactly that much', () => {
    const before = lay();
    const after = lay({ kerning: { OA: -0.3 } });
    // Centred, so the whole word shifts by half; A and K move 0.3 mm relative to O.
    const rel = (l: typeof before, i: number) => l.letters[i].box.x0 - l.letters[0].box.x0;
    expect(rel(after, 1) - rel(before, 1)).toBeCloseTo(-0.3, 6);
    expect(rel(after, 2) - rel(before, 2)).toBeCloseTo(-0.3, 6);
    expect(after.gaps[0].kern).toBe(-0.3);
  });

  it('letter spacing is added between every pair', () => {
    const a = lay();
    const b = lay({ letterSpacing: 2 });
    const rel = (l: typeof a, i: number) => l.letters[i].box.x0 - l.letters[0].box.x0;
    expect(rel(b, 2) - rel(a, 2)).toBeCloseTo(4, 6);
  });

  it('several lines stack at the line spacing, centred as a block', () => {
    const l = lay({ text: 'OAK\nOAK\nOAK', panelHeight: 150, lineSpacing: 40 });
    expect(l.lines.map((x) => x.baselineY)).toEqual([47.5, 87.5, 127.5]);
    // Block runs from the first cap line to the last baseline.
    expect(l.lines[0].baselineY - 25 - 0).toBeCloseTo(150 - l.lines[2].baselineY, 6);
  });

  it('left and right alignment sit on the margins', () => {
    const left = lay({ align: 'left', margin: 12 });
    expect(left.lines[0].x0).toBe(12);
    const right = lay({ align: 'right', margin: 12 });
    expect(right.lines[0].x0 + right.lines[0].width).toBeCloseTo(150 - 12, 6);
  });

  it('a space breaks the run, so no kerning gap spans a word space', () => {
    expect(lay({ text: 'OA K' }).gaps.map((g) => g.pair)).toEqual(['OA']);
  });

  it('negative space between two upright stems is width × cap height', () => {
    // Two stems of I with a measured gap between them.
    const l = lay({ text: 'II' });
    const g = l.gaps[0];
    const s = negativeSpace(g, l.lines[0].baselineY, 25);
    // Measure the gap at mid-height directly and compare: the serifs make it smaller near the lines.
    expect(s.area).toBeGreaterThan(0);
    expect(s.area).toBeLessThan((g.right.box.x0 - g.left.box.x1 + 10) * 25);
    // Closing the pair up by 1 mm removes 25 mm² (1 mm × the full cap height, where they don't touch).
    const l2 = lay({ text: 'II', kerning: { II: -1 } });
    const s2 = negativeSpace(l2.gaps[0], l2.lines[0].baselineY, 25);
    expect(s.area - s2.area).toBeCloseTo(25, 0);
  });
});
