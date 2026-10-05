import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { alphabetFromFont } from '../src/alphabet';
import { distanceToBoundary, insideShape } from '../src/geometry';
import { layoutPanel } from '../src/layout';

const buf = readFileSync(new URL('../public/fonts/Cinzel-Regular.woff', import.meta.url));
const alphabet = alphabetFromFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'OFL');
const layout = layoutPanel(alphabet, { text: 'OAK', capHeight: 25, panelWidth: 150, panelHeight: 60, datumOffset: 0.75 });
const all = (fn: (L: (typeof layout.letters)[number]) => number[]) => layout.letters.flatMap(fn);

describe('OAK at 25 mm cap height', () => {
  it('flat-topped capitals stand exactly 25 mm tall', () => {
    const K = layout.letters.find((l) => l.char === 'K')!;
    const ys = K.outline.flat().map((p) => p.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(25, 2);
    expect(Math.max(...ys)).toBeCloseTo(layout.baselineY, 2);
  });

  it('every letter has valley lines', () => {
    for (const L of layout.letters) expect(L.valleys.length).toBeGreaterThan(0);
  });

  it('valley points lie inside the letter, midway between the walls', () => {
    const errs = all((L) =>
      L.valleys.flat().map((p) => {
        expect(insideShape(p, L.outline)).toBe(true);
        return Math.abs(distanceToBoundary(p, L.outline) - p.r);
      }),
    );
    expect(Math.max(...errs)).toBeLessThan(0.03);
  });

  it('the valley of O is a closed ring with no forks', () => {
    const O = layout.letters.find((l) => l.char === 'O')!;
    expect(O.valleys.length).toBe(1);
    const v = O.valleys[0];
    expect(Math.hypot(v[0].x - v[v.length - 1].x, v[0].y - v[v.length - 1].y)).toBeLessThan(0.1);
  });

  it('the datum line sits 0.75 mm inside (within 0.005 mm) the outline', () => {
    const d = all((L) => L.datum.flat().map((p) => {
      expect(insideShape(p, L.outline)).toBe(true);
      return distanceToBoundary(p, L.outline);
    }));
    expect(Math.min(...d)).toBeGreaterThan(0.745);
    expect(Math.max(...d)).toBeLessThan(0.755);
  });
});
