import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { alphabetFromFont } from '../src/alphabet';
import { defaultProject, layoutPanel } from '../src/layout';
import { LetterStore } from '../src/letters';
import { strokesOf } from '../src/strokes';
import { buildPasses, defaultMachine } from '../src/toolpath';
import type { ValleyLine } from '../src/valley';

const buf = readFileSync(new URL('../public/fonts/Cinzel-Regular.woff', import.meta.url));
const store = new LetterStore(alphabetFromFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'OFL'));
const machine = { ...defaultMachine, stockThickness: 20 };
const letters = layoutPanel(store, { ...defaultProject, machine, text: 'ABDEHIKMNOQRSTWXY', panelWidth: 600 }).letters;
const valleysOf = (ch: string) => letters.find((l) => l.char === ch)!.valleys;

/** Distance from a point to the nearest point of a path, mm. */
const near = (p: { x: number; y: number }, path: { x: number; y: number }[]) => Math.min(...path.map((q) => Math.hypot(q.x - p.x, q.y - p.y)));

/** A straight run of valley from a to b, `r` wide each side. */
const run = (ax: number, ay: number, bx: number, by: number, r: number): ValleyLine =>
  Array.from({ length: 21 }, (_, i) => ({ x: ax + ((bx - ax) * i) / 20, y: ay + ((by - ay) * i) / 20, r }));

describe('strokes at a junction (BRIEF.md, Decisions)', () => {
  it('each letter has the strokes a carver counts', () => {
    const counts = Object.fromEntries('ABDEHIKMNOQRSTWXY'.split('').map((ch) => [ch, strokesOf(valleysOf(ch)).length]));
    expect(counts).toEqual({ A: 3, B: 3, D: 2, E: 4, H: 3, I: 1, K: 3, M: 4, N: 3, O: 1, Q: 2, R: 3, S: 1, T: 2, W: 4, X: 2, Y: 3 });
  });

  it('A: crossbar, then thin left leg, then the thick right leg straight through in one cut', () => {
    const [bar, thin, thick] = strokesOf(valleysOf('A'));
    expect(bar.width).toBeLessThan(thin.width);
    expect(thin.width).toBeLessThan(thick.width);
    expect(thick.parts).toHaveLength(1);
    expect(thin.parts).toHaveLength(1);
    // The crossbar stops at each leg's valley line.
    const b = bar.parts[0];
    for (const end of [b[0], b[b.length - 1]]) expect(Math.min(near(end, thin.parts[0]), near(end, thick.parts[0]))).toBeLessThan(0.01);
    // The thick leg runs on past the crossbar: its one cut runs from the apex to the foot.
    const leg = thick.parts[0];
    expect(Math.abs(leg[0].y - leg[leg.length - 1].y)).toBeGreaterThan(20);
  });

  it('B: the stem, and one stroke for each bowl', () => {
    const s = strokesOf(valleysOf('B'));
    expect(s).toHaveLength(3);
    const stem = s[2]; // the thickest, cut last
    const xs = stem.parts[0].map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.5); // upright
  });

  it('X: the thin diagonal is cut first in two parts, each stopping at the thick one, which is then cut straight through', () => {
    const [thin, thick] = strokesOf(valleysOf('X'));
    expect(thin.width).toBeLessThan(thick.width);
    expect(thin.parts).toHaveLength(2);
    expect(thick.parts).toHaveLength(1);
    for (const part of thin.parts) {
      const inner = Math.min(near(part[0], thick.parts[0]), near(part[part.length - 1], thick.parts[0]));
      expect(inner).toBeLessThan(0.01);
    }
  });

  it('where strokes are equal width, the one cut second is continuous', () => {
    // A cross of equal strokes: the bar (higher) is cut first and stops; the upright goes through.
    const cross = [run(0, 10, 10, 10, 1), run(10, 10, 20, 10, 1), run(10, 0, 10, 10, 1), run(10, 10, 10, 30, 1)];
    const [first, second] = strokesOf(cross);
    expect(first.parts).toHaveLength(2);
    expect(second.parts).toHaveLength(1);
    expect(second.parts[0].length).toBeGreaterThan(30); // one cut, top to bottom
  });

  it('where one is thicker, the thicker goes through whichever way round', () => {
    const cross = [run(0, 10, 10, 10, 1.5), run(10, 10, 20, 10, 1.5), run(10, 0, 10, 10, 0.8), run(10, 10, 10, 30, 0.8)];
    const [first, second] = strokesOf(cross);
    expect(first.width).toBeCloseTo(1.6, 6); // the upright, thin: two parts
    expect(first.parts).toHaveLength(2);
    expect(second.width).toBeCloseTo(3, 6); // the bar, thick: straight through
    expect(second.parts).toHaveLength(1);
  });

  it('a thick stroke that ends at a thinner one (the stem of T) stops at its valley; the bar runs on', () => {
    const t = [run(0, 0, 10, 0, 0.6), run(10, 0, 20, 0, 0.6), run(10, 0, 10, 25, 1.2)];
    const [bar, stem] = strokesOf(t);
    expect(bar.parts).toHaveLength(1);
    expect(bar.parts[0][0].x).toBe(0);
    expect(bar.parts[0][bar.parts[0].length - 1].x).toBe(20);
    expect(stem.width).toBeCloseTo(2.4, 6);
  });
});

describe('the valley slit follows the strokes', () => {
  const l = layoutPanel(store, { ...defaultProject, machine, text: 'AX' });
  const slit = buildPasses(l, machine).find((p) => p.name === 'slit')!;

  it('each stroke is cut in turn, thin first, its forks straight after it', () => {
    for (const ch of 'AX') {
      const cuts = slit.cuts.filter((c) => c.item.startsWith(`${ch} `));
      const numbers = cuts.map((c) => c.stroke!);
      expect(numbers).toEqual([...numbers].sort((a, b) => a - b)); // stroke by stroke
      // Each stroke's own cut comes before its forks.
      for (let i = 1; i < cuts.length; i++) if (cuts[i].stroke !== cuts[i - 1].stroke) expect(cuts[i].fork).toBe(false);
    }
  });

  it('A is cut as three strokes; X as two, its thin diagonal in two parts', () => {
    const strokes = (ch: string) => new Set(slit.cuts.filter((c) => c.item.startsWith(`${ch} `)).map((c) => c.stroke)).size;
    expect(strokes('A')).toBe(3);
    expect(strokes('X')).toBe(2);
    const xThin = slit.cuts.filter((c) => c.item.startsWith('X ') && c.stroke === 1 && !c.fork);
    expect(xThin).toHaveLength(2);
  });
});
