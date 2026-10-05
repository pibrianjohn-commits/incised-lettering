import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { alphabetFromFont } from '../src/alphabet';
import { borderMarks } from '../src/border';
import { distToSegment } from '../src/geometry';
import { contentBox, defaultProject, layoutPanel, type Project } from '../src/layout';
import { LetterStore } from '../src/letters';
import { bedFit, fitToLettering } from '../src/panel';

const buf = readFileSync(new URL('../public/fonts/Cinzel-Regular.woff', import.meta.url));
const store = new LetterStore(alphabetFromFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'OFL'));
const proj = (c: Partial<Project> = {}): Project => ({ ...defaultProject, ...c });
const rule = { percent: 20, minimum: 0.2 };

describe('border', () => {
  it('single and double borders are scribed lines at the inset', () => {
    expect(borderMarks({ style: 'single', inset: 6, gap: 1.5, width: 3 }, 150, 60, rule).scribes).toHaveLength(1);
    const d = borderMarks({ style: 'double', inset: 6, gap: 1.5, width: 3 }, 150, 60, rule).scribes;
    expect(d.map((c) => c[0])).toEqual([{ x: 6, y: 6 }, { x: 7.5, y: 7.5 }]);
  });

  it('an incised border has edges, a centre valley forking to each outer corner, and datum lines by the rule', () => {
    const m = borderMarks({ style: 'incised', inset: 6, gap: 1.5, width: 4 }, 150, 60, rule);
    expect(m.outline[0][0]).toEqual({ x: 6, y: 6 });
    expect(m.outline[1]).toContainEqual({ x: 10, y: 10 });
    expect(m.outline[1]).toContainEqual({ x: 140, y: 50 });
    expect(m.valleys).toHaveLength(5); // the ring + four corner forks
    expect(m.valleys[0][0]).toEqual({ x: 8, y: 8, r: 2 });
    expect(m.valleys[1]).toEqual([{ x: 8, y: 8, r: 2 }, { x: 6, y: 6, r: 0 }]);
    // 20% of 4 mm = 0.8 mm in from each edge.
    expect(m.datum.map((c) => c[0])).toEqual([{ x: 6.8, y: 6.8 }, { x: 9.2, y: 9.2 }]);
  });

  it('an incised band too narrow for datum lines gets none', () => {
    const m = borderMarks({ style: 'incised', inset: 6, gap: 1.5, width: 0.3 }, 150, 60, rule);
    expect(m.datum).toHaveLength(0);
  });

  it('the corner forks run along the mitre, equally far from both edges', () => {
    const m = borderMarks({ style: 'incised', inset: 5, gap: 1, width: 3 }, 100, 80, rule);
    const [a, b] = m.valleys[3]; // bottom-right corner
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    expect(100 - 5 - mid.x).toBeCloseTo(80 - 5 - mid.y, 9);
    expect(distToSegment(b, { x: 95, y: 5 }, { x: 95, y: 75 })).toBeCloseTo(0, 9);
  });
});

describe('margins', () => {
  it('are measured from the panel edge with no border, and from the border inner edge with one', () => {
    const margins = { top: 10, right: 12, bottom: 14, left: 16 };
    expect(contentBox(proj({ margins }))).toEqual({ x0: 16, y0: 10, x1: 150 - 12, y1: 60 - 14 });
    const border = { style: 'incised' as const, inset: 5, gap: 1.5, width: 3 };
    expect(contentBox(proj({ margins, border }))).toEqual({ x0: 24, y0: 18, x1: 150 - 20, y1: 60 - 22 });
  });

  it('left alignment starts the line at the left margin, inside the border', () => {
    const p = proj({ align: 'left', border: { style: 'single', inset: 6, gap: 1.5, width: 3 }, margins: { top: 8, right: 8, bottom: 8, left: 9 } });
    expect(layoutPanel(store, p).lines[0].ink!.x0).toBeCloseTo(15, 6);
  });
});

describe('panel size', () => {
  it('bed check, either way round', () => {
    expect(bedFit(300, 205)).toBe('standard');
    expect(bedFit(205, 300)).toBe('standard');
    expect(bedFit(300, 206)).toBe('extended');
    expect(bedFit(400, 300)).toBe('extended');
    expect(bedFit(301, 401)).toBe('too-big');
  });

  it('fit to lettering: lettering plus margins plus border', () => {
    const p = proj({ text: 'OAK\nOAK', border: { style: 'single', inset: 5, gap: 1.5, width: 3 } });
    const l = layoutPanel(store, p);
    const f = fitToLettering(l)!;
    const ink = l.lines[0].ink!;
    expect(f.width).toBeCloseTo(ink.x1 - ink.x0 + 10 + 10 + 10, 1);
    expect(f.height).toBeCloseTo(25 + 40 + 10 + 10 + 10, 1);
    // After fitting, the lettering sits on the margins.
    const fitted = layoutPanel(store, { ...p, panelWidth: f.width, panelHeight: f.height });
    expect(fitted.lines[0].baselineY - 25).toBeCloseTo(15, 1);
    expect(fitted.lines[1].baselineY).toBeCloseTo(f.height - 15, 1);
    expect(fitted.overflow).toEqual({ wide: false, tall: false });
  });
});
