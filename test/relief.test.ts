import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { alphabetFromFont } from '../src/alphabet';
import { defaultProject, layoutPanel, type Project } from '../src/layout';
import { LetterStore } from '../src/letters';
import { chooseRes, depthAt, finishedInput, finishedRelief, FINEST, machinedRelief, MAX_CELLS, MAX_SIDE, packCuts, packShapes } from '../src/relief';
import { runJob, toHalf, type ReliefJob } from '../src/relief-job';
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

describe('3D: size of the depth map', () => {
  it('is held to about 2 million cells in all, whatever the board, and never finer than 0.04 mm', () => {
    for (const [w, h] of [
      [300, 196],
      [300, 205],
      [1000, 1000],
      [1000, 10],
      [12, 8],
    ]) {
      const res = chooseRes(w, h);
      const cells = Math.ceil(w / res) * Math.ceil(h / res);
      expect(cells).toBeLessThan(MAX_CELLS * 1.01 + 2 * (w + h) / res);
      expect(res).toBeGreaterThanOrEqual(FINEST);
      expect(Math.max(w, h) / res).toBeLessThanOrEqual(MAX_SIDE + 1e-9);
    }
    expect(chooseRes(12, 8)).toBe(FINEST); // a small board at full detail
    expect(chooseRes(300, 205)).toBeCloseTo(Math.sqrt((300 * 205) / MAX_CELLS), 9);
  });

  it('is kept in single precision', () => {
    const r = machinedRelief(buildPasses(lay(), m), 150, 60, m);
    expect(r.depth).toBeInstanceOf(Float32Array);
  });
});

describe('3D: sharper, for just an area', () => {
  const layout = lay();
  const area = { x0: 20, y0: 15, x1: 60, y1: 45 };
  const inside = (r: { x0: number; y0: number; cols: number; rows: number; res: number }, x: number, y: number) =>
    x > r.x0 && y > r.y0 && x < r.x0 + r.cols * r.res && y < r.y0 + r.rows * r.res;

  it('marked out: the same cuts as the whole board, where they overlap', () => {
    const passes = buildPasses(layout, m);
    const whole = machinedRelief(passes, 150, 60, m, RES);
    const part = machinedRelief(passes, 150, 60, m, RES, area);
    expect(part.x0).toBe(20);
    expect(part.cols * part.rows).toBeLessThan(whole.cols * whole.rows);
    let worst = 0;
    for (let y = 16; y < 44; y += 0.37) for (let x = 21; x < 59; x += 0.41) if (inside(part, x, y)) worst = Math.max(worst, Math.abs(depthAt(part, x, y) - depthAt(whole, x, y)));
    expect(worst).toBeLessThan(1e-6);
  });

  it('finished: a letter cut by the edge of the area is as deep as on the whole board', () => {
    const whole = finishedRelief(layout, m, RES);
    const part = finishedRelief(layout, m, RES, area);
    let worst = 0;
    for (let y = 16; y < 44; y += 0.37) for (let x = 21; x < 59; x += 0.41) if (inside(part, x, y)) worst = Math.max(worst, Math.abs(depthAt(part, x, y) - depthAt(whole, x, y)));
    expect(worst).toBeLessThan(1e-4);
  });

  it('the work for the worker gives the same map, in half precision, ready for the graphics chip', () => {
    const job: ReliefJob = { id: 7, state: 'marked', width: 150, height: 60, machine: m, area, cuts: packCuts(buildPasses(layout, m)) };
    const out = runJob(job);
    expect(out.id).toBe(7);
    expect(out.res).toBe(FINEST); // a small area: full detail
    expect(out.half).toHaveLength(out.cols * out.rows);
    const direct = machinedRelief(buildPasses(layout, m), 150, 60, m, FINEST, area);
    // Rows go front first for the graphics chip: the top row of the map is the last.
    const j = 10;
    const i = 25;
    const half = out.half[(out.rows - 1 - j) * out.cols + i];
    expect(Math.abs(fromHalf(half) - direct.depth[j * direct.cols + i])).toBeLessThan(0.002);
    const fin: ReliefJob = { id: 8, state: 'finished', width: 150, height: 60, machine: m, area: null, ...packFinished(layout) };
    expect(runJob(fin).maxDepth).toBeCloseTo(finishedRelief(layout, m).maxDepth, 6);
  });

  it('half precision: small and large depths alike', () => {
    for (const v of [0, 0.0001, 0.003, 0.2, 1.5, 7.25, 30]) expect(Math.abs(fromHalf(toHalf(v)) - v)).toBeLessThanOrEqual(Math.max(v * 0.001, 1e-4));
  });
});

/** A half-precision number back to an ordinary one. */
function fromHalf(h: number): number {
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  return e === 0 ? f * 2 ** -24 : (1 + f / 1024) * 2 ** (e - 15);
}

function packFinished(layout: ReturnType<typeof lay>) {
  const f = finishedInput(layout);
  return { shapes: packShapes(f.shapes), border: f.border, datum: f.datum, widest: f.widest };
}
