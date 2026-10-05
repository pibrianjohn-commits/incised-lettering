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

  /** Crossings of the line x = const (vertical) or y = const by a set of closed lines. */
  const crossings = (contours: { x: number; y: number }[][], axis: 'x' | 'y', at: number) => {
    const out: number[] = [];
    const o = axis === 'x' ? 'y' : 'x';
    for (const c of contours)
      for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
        const p = c[j];
        const q = c[i];
        if ((p[axis] > at) === (q[axis] > at)) continue;
        out.push(p[o] + ((at - p[axis]) * (q[o] - p[o])) / (q[axis] - p[axis]));
      }
    return out.sort((u, v) => u - v);
  };

  it('the datum line is set in by a percentage of the local stroke width', () => {
    for (const percent of [15, 20, 30]) {
      const K = lay({ datumPercent: percent, datumMinimum: 0.2 }).letters.find((l) => l.char === 'K')!;
      const y = baselineY - 12.5; // half way up the stem
      const [o0, o1] = crossings(K.outline, 'y', y); // the stem's two edges
      const [d0, d1] = crossings(K.datum, 'y', y);
      const width = o1 - o0;
      expect(width).toBeGreaterThan(2); // a thick stroke
      expect(d0 - o0).toBeCloseTo((percent / 100) * width, 2);
      expect(o1 - d1).toBeCloseTo((percent / 100) * width, 2);
    }
  });

  // The A crossbar is about 1.05 mm thick at its middle, 8.7 to 9.75 mm up.
  const crossbar = (change: Partial<Project>) => {
    const A = lay(change).letters.find((l) => l.char === 'A')!;
    const x = (A.box.x0 + A.box.x1) / 2;
    const heights = (cs: typeof A.outline) => crossings(cs, 'x', x).map((y) => baselineY - y).filter((h) => h > 8 && h < 10.5);
    return { outline: heights(A.outline), datum: heights(A.datum) };
  };

  it('on a hairline the minimum distance takes over', () => {
    // 5% of 1.05 mm is about 0.05 mm, so the 0.2 mm minimum applies.
    const { outline, datum } = crossbar({ datumPercent: 5, datumMinimum: 0.2 });
    expect(datum.length).toBe(2);
    expect(Math.abs(datum[0] - outline[0])).toBeCloseTo(0.2, 2);
    expect(Math.abs(outline[1] - datum[1])).toBeCloseTo(0.2, 2);
  });

  it('the datum line stops where the stroke is too narrow for it', () => {
    expect(crossbar({ datumPercent: 20, datumMinimum: 0.2 }).datum.length).toBe(2);
    // A 0.6 mm minimum each side needs 1.2 mm: the crossbar is too narrow.
    expect(crossbar({ datumPercent: 20, datumMinimum: 0.6 }).datum.length).toBe(0);
  });

  it('the datum line is always inside the letter and never nearer the outline than the minimum', () => {
    for (const L of lay({ text: 'OAK', datumPercent: 20, datumMinimum: 0.3 }).letters) {
      expect(L.datum.length).toBeGreaterThan(0);
      for (const p of L.datum.flat()) {
        expect(insideShape(p, L.outline)).toBe(true);
        expect(distanceToBoundary(p, L.outline)).toBeGreaterThan(0.3 - 0.005);
      }
    }
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

  it('a pair adjustment applies to every place the pair occurs', () => {
    const l = lay({ text: 'AVAV', kerning: { AV: -0.5 } });
    expect(l.gaps.filter((g) => g.pair === 'AV').map((g) => g.kern)).toEqual([-0.5, -0.5]);
  });

  it('a this-gap-only adjustment moves that one gap and no other', () => {
    const before = lay({ text: 'AVAV' });
    const after = lay({ text: 'AVAV', gapKerning: { '0:3': { pair: 'AV', mm: -1 } } });
    const rel = (l: typeof before, i: number) => l.letters[i].box.x0 - l.letters[0].box.x0;
    expect(rel(after, 1) - rel(before, 1)).toBeCloseTo(0, 6); // first AV unchanged
    expect(rel(after, 2) - rel(before, 2)).toBeCloseTo(0, 6);
    expect(rel(after, 3) - rel(before, 3)).toBeCloseTo(-1, 6); // last AV closed up
    expect(after.gaps.map((g) => g.gapKern)).toEqual([0, 0, -1]);
  });

  it('a this-gap-only adjustment is ignored if different letters now sit there', () => {
    const l = lay({ text: 'AVAK', gapKerning: { '0:3': { pair: 'AV', mm: -1 } } });
    expect(l.gaps.every((g) => g.gapKern === 0)).toBe(true);
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
    const s = negativeSpace(g, l.lines[0].baselineY, 25, Infinity);
    // Measure the gap at mid-height directly and compare: the serifs make it smaller near the lines.
    expect(s.area).toBeGreaterThan(0);
    expect(s.area).toBeLessThan((g.right.box.x0 - g.left.box.x1 + 10) * 25);
    // Closing the pair up by 1 mm removes 25 mm² (1 mm × the full cap height, where they don't touch).
    const l2 = lay({ text: 'II', kerning: { II: -1 } });
    const s2 = negativeSpace(l2.gaps[0], l2.lines[0].baselineY, 25, Infinity);
    expect(s.area - s2.area).toBeCloseTo(25, 0);
  });

  it('the depth limit trims the bays of an open letter but not a closed one', () => {
    const space = (text: string, depth: number) => {
      const l = lay({ text });
      return negativeSpace(l.gaps[0], l.lines[0].baselineY, 25, depth);
    };
    // E's bays open to the right: limiting the depth takes a big bite.
    const eFull = space('EI', Infinity);
    const eCut = space('EI', 6);
    expect(eCut.area).toBeLessThan(eFull.area - 30);
    expect(eCut.cutoffs.some((c) => c.length > 10)).toBe(true);
    // Between two I's nothing reaches 6 mm into a letter, so nothing changes.
    expect(space('II', 6).area).toBeCloseTo(space('II', Infinity).area, 6);
    expect(space('II', 6).cutoffs.length).toBe(0);
  });
});
