import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { alphabetFromFont } from '../src/alphabet';
import { defaultProject, layoutPanel, type Project } from '../src/layout';
import { LetterStore } from '../src/letters';
import { depthAt, finishedRelief, machinedRelief } from '../src/relief';
import { buildPasses, defaultMachine, valleyDepth, type MachineSettings } from '../src/toolpath';

const buf = readFileSync(new URL('../public/fonts/Cinzel-Regular.woff', import.meta.url));
const store = new LetterStore(alphabetFromFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'OFL'));
const m: MachineSettings = { ...defaultMachine, stockThickness: 20 };
const lay = (c: Partial<Project> = {}) => layoutPanel(store, { ...defaultProject, ...c });
const RES = 0.05;

describe('3D: marked out', () => {
  const layout = lay();
  const passes = buildPasses(layout, m);
  const r = machinedRelief(passes, 150, 60, m, RES);

  it('is exactly as deep as the G-code goes', () => {
    expect(r.maxDepth).toBeCloseTo(Math.max(...passes.map((p) => p.deepest)), 6);
  });

  it('shows the hairline at its depth on the outline, and nothing far from any cut', () => {
    const p = layout.letters[0].outline[0][0];
    expect(depthAt(r, p.x, p.y)).toBeCloseTo(0.2, 1);
    expect(depthAt(r, 2, 2)).toBe(0);
  });

  it('a V-bit cut is as wide as its depth allows: 2 × depth × tan 15°', () => {
    // Slit down the middle of the K's stem, at mid-height.
    const K = layout.letters.find((l) => l.char === 'K')!;
    const y = layout.lines[0].baselineY - 12.5;
    let best = { x: 0, d: 0 };
    for (let x = K.box.x0; x < K.box.x0 + 6; x += RES / 2) {
      const d = depthAt(r, x, y);
      if (d > best.d) best = { x, d };
    }
    let w = 0;
    for (let x = best.x - 3; x < best.x + 3; x += RES) if (depthAt(r, x, y) > 0.35) w += RES; // wider than the datum line
    const expected = 2 * best.d * Math.tan((15 * Math.PI) / 180);
    expect(Math.abs(w - expected)).toBeLessThan(3 * RES);
  });
});

describe('3D: finished', () => {
  const layout = lay();
  const r = finishedRelief(layout, m, RES);

  it('the deepest point of a stroke is its valley depth at 60°', () => {
    const maxR = Math.max(...layout.letters.flatMap((l) => l.valleys.flat().map((p) => p.r)));
    expect(Math.abs(r.maxDepth - valleyDepth(maxR, 60))).toBeLessThan(0.1);
  });

  it('nothing is cut outside the letters', () => {
    expect(depthAt(r, 2, 2)).toBe(0);
    expect(depthAt(r, 75, 5)).toBe(0);
  });

  it('the inside of O is left standing', () => {
    const O = layout.letters[0];
    expect(depthAt(r, (O.box.x0 + O.box.x1) / 2, (O.box.y0 + O.box.y1) / 2)).toBe(0);
  });

  it('the machine slit never goes deeper than the finished letter: it stays in the waste', () => {
    const slitOnly = machinedRelief(buildPasses(layout, { ...m, passes: { hairline: false, datum: false, slit: true } }), 150, 60, m, RES);
    let worst = -Infinity;
    for (let k = 0; k < r.depth.length; k++) worst = Math.max(worst, slitOnly.depth[k] - r.depth[k]);
    // Allow for the cells: each holds its deepest point, up to half a cell either way.
    expect(worst).toBeLessThan(0.3);
  });

  it('a scribed border stays as the bit cut it', () => {
    const l = lay({ border: { style: 'single', inset: 6, gap: 1.5, width: 3 } });
    const f = finishedRelief(l, { ...m, scribeDepth: 0.6 }, RES);
    expect(depthAt(f, 6, 30)).toBeCloseTo(0.6, 1);
  });
});
