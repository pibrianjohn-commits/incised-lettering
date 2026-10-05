import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { alphabetFromFont } from '../src/alphabet';
import { toGcode, toMachine } from '../src/gcode';
import { defaultProject, layoutPanel, type Project } from '../src/layout';
import { LetterStore } from '../src/letters';
import { buildPasses, checkPasses, defaultMachine, slitDepth, valleyDepth, type MachineSettings } from '../src/toolpath';

const buf = readFileSync(new URL('../public/fonts/Cinzel-Regular.woff', import.meta.url));
const store = new LetterStore(alphabetFromFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'OFL'));
const m: MachineSettings = { ...defaultMachine, stockThickness: 20 };
const lay = (c: Partial<Project> = {}) => layoutPanel(store, { ...defaultProject, ...c });

/** Run the G-code through a tiny machine and record every position the bit visits. */
function simulate(g: string) {
  let x = 0, y = 0, z = 0;
  const visits: { x: number; y: number; z: number; rapid: boolean; zBefore: number }[] = [];
  for (const raw of g.split('\n')) {
    const line = raw.replace(/\(.*?\)/g, '').trim();
    if (!line) continue;
    const word = (l: string) => {
      const mm = line.match(new RegExp(`${l}(-?[0-9.]+)`));
      return mm ? Number(mm[1]) : null;
    };
    if (/^G[01]\b/.test(line)) {
      const zBefore = z;
      x = word('X') ?? x;
      y = word('Y') ?? y;
      z = word('Z') ?? z;
      visits.push({ x, y, z, rapid: line.startsWith('G0'), zBefore });
    }
  }
  return visits;
}

describe('depths', () => {
  it('valley depth is (w / 2) / tan(θ / 2): 0.87 × width at 60°', () => {
    expect(valleyDepth(1, 60)).toBeCloseTo(1.732, 3); // w = 2 mm → 1.73 mm
    expect(valleyDepth(1.5, 60) / 3).toBeCloseTo(0.866, 3);
    expect(slitDepth(1.5, m)).toBeCloseTo(valleyDepth(1.5, 60) - 0.3, 9);
    expect(slitDepth(0.1, m)).toBe(0); // too shallow: nothing below the surface
  });
});

describe('passes', () => {
  const layout = lay();
  const passes = buildPasses(layout, m);
  const [hair, datum, slit] = passes;

  it('three passes in order: hairline, datum line, valley slit', () => {
    expect(passes.map((p) => p.name)).toEqual(['hairline', 'datum', 'slit']);
    expect(hair.deepest).toBeCloseTo(0.2, 9);
    expect(datum.deepest).toBeCloseTo(0.3, 9);
  });

  it('the slit never cuts outside the waste: its width at the surface is less than the stroke there', () => {
    const tan15 = Math.tan((15 * Math.PI) / 180);
    for (const L of layout.letters) {
      for (const v of L.valleys) {
        for (const p of v) expect(slitDepth(p.r, m) * tan15).toBeLessThan(p.r + 1e-9);
      }
    }
  });

  it('the slit runs to the true valley depth less the margin', () => {
    const maxR = Math.max(...layout.letters.flatMap((l) => l.valleys.flat().map((p) => p.r)));
    expect(slit.deepest).toBeCloseTo(valleyDepth(maxR, 60) - 0.3, 6);
  });

  it('forks rise to nothing at the corners', () => {
    expect(slit.cuts.some((c) => c.points.some((p) => p.z === 0 || Object.is(p.z, -0)))).toBe(true);
  });

  it('within each letter, thin strokes are cut before thick ones', () => {
    const byItem = new Map<string, number[]>();
    for (const c of slit.cuts) byItem.set(c.item, [...(byItem.get(c.item) ?? []), c.width!]);
    for (const widths of byItem.values()) {
      for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1] - 1e-9);
    }
  });

  it('letters are taken in reading order', () => {
    const order = [...new Set(slit.cuts.map((c) => c.item.split(' ')[0]))];
    expect(order).toEqual(['O', 'A', 'K']);
  });

  it('a deep stroke is cut in steps no deeper than the step-down', () => {
    const big = buildPasses(lay({ capHeight: 60, panelWidth: 280, panelHeight: 120 }), { ...m, stockThickness: 30 }).find((p) => p.name === 'slit')!;
    expect(big.deepest).toBeGreaterThan(m.slitStep);
    for (const c of big.cuts) {
      // The first pass along a stroke goes no deeper than one step.
      // The first level ends where the bit first steps down on the spot.
      const step = c.points.findIndex((p, i) => i > 0 && p.x === c.points[i - 1].x && p.y === c.points[i - 1].y);
      const firstRun = step === -1 ? c.points : c.points.slice(0, step);
      for (const p of firstRun) expect(-p.z).toBeLessThanOrEqual(m.slitStep + 1e-9);
    }
  });
});

describe('scribed borders', () => {
  const border = { style: 'double' as const, inset: 6, gap: 1.5, width: 3 };
  it('are cut in the hairline pass at their own depth, 0.2 mm to start', () => {
    const hair = buildPasses(lay({ border }), m)[0];
    const lines = hair.cuts.filter((c) => c.item === 'border');
    expect(lines).toHaveLength(2);
    for (const c of lines) for (const p of c.points) expect(p.z).toBeCloseTo(-0.2, 9);
  });

  it('can be set deeper for a finished line, up to 1 mm and no further', () => {
    const at = (d: number) => buildPasses(lay({ border }), { ...m, scribeDepth: d })[0].cuts.find((c) => c.item === 'border')!.points[0].z;
    expect(at(0.8)).toBeCloseTo(-0.8, 9);
    expect(at(3)).toBeCloseTo(-1, 9);
    // The letters' hairline is unchanged.
    expect(buildPasses(lay({ border }), { ...m, scribeDepth: 0.8 })[0].cuts[0].points[0].z).toBeCloseTo(-0.2, 9);
  });

  it('an incised border keeps its edges at the hairline depth', () => {
    const hair = buildPasses(lay({ border: { ...border, style: 'incised' } }), { ...m, scribeDepth: 0.9 })[0];
    for (const c of hair.cuts.filter((x) => x.item === 'border')) expect(c.points[0].z).toBeCloseTo(-0.2, 9);
  });
});

describe('safety checks', () => {
  const layout = lay();
  it('no G-code without the stock thickness', () => {
    const checks = checkPasses(layout, buildPasses(layout, { ...m, stockThickness: 0 }), { ...m, stockThickness: 0 }, 'standard');
    expect(checks.some((c) => c.blocking && !c.ok)).toBe(true);
  });

  it('blocks a cut that would go below the stock less the safe floor', () => {
    const thin = { ...m, stockThickness: 4, safeFloor: 3 }; // only 1 mm allowed
    const checks = checkPasses(layout, buildPasses(layout, thin), thin, 'standard');
    expect(checks.find((c) => c.text.includes('below the limit'))?.ok).toBe(false);
  });

  it('passes with sensible stock', () => {
    const checks = checkPasses(layout, buildPasses(layout, m), m, 'standard');
    expect(checks.filter((c) => c.blocking && !c.ok)).toEqual([]);
  });

  it('blocks letters too big for the bit', () => {
    const l = lay({ capHeight: 120, panelWidth: 300, panelHeight: 200, text: 'I' });
    const big = { ...m, stockThickness: 40 };
    const checks = checkPasses(l, buildPasses(l, big), big, 'standard');
    expect(checks.find((c) => c.text.includes('cutting depth'))?.ok).toBe(false);
  });
});

describe('G-code', () => {
  const layout = lay();
  const passes = buildPasses(layout, m);
  const g = toGcode(passes, m, { title: 'OAK', panelWidth: 150, panelHeight: 60 }, new Date('2026-10-05T12:00:00Z'));
  const visits = simulate(g);

  it('millimetres, absolute, spindle on and off, ends cleanly', () => {
    expect(g).toContain('G21 G90');
    expect(g).toMatch(/M3 S12000/);
    expect(g.trim().split('\n').slice(-3)).toEqual(['M5', 'G0 X0 Y0', 'M30']);
  });

  it('only plain ASCII, as GRBL wants', () => {
    expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(g)).toBe(true);
  });

  it('never goes below the stock less the safe floor, and never above the surface while cutting', () => {
    const lowest = Math.min(...visits.map((v) => v.z));
    expect(lowest).toBeGreaterThanOrEqual(-(m.stockThickness - m.safeFloor));
    expect(lowest).toBeCloseTo(-passes[2].deepest, 3);
  });

  it('never moves sideways at rapid speed while the bit is in the wood', () => {
    for (const v of visits) if (v.rapid) expect(v.zBefore > 0 || v.z > 0).toBe(true);
  });

  it('every move stays on the panel (bottom-left zero: 0 ≤ X ≤ 150, 0 ≤ Y ≤ 60)', () => {
    for (const v of visits) {
      expect(v.x).toBeGreaterThanOrEqual(-1e-6);
      expect(v.x).toBeLessThanOrEqual(150 + 1e-6);
      expect(v.y).toBeGreaterThanOrEqual(-1e-6);
      expect(v.y).toBeLessThanOrEqual(60 + 1e-6);
    }
  });

  it('moves are long enough for the controller to stream smoothly (not thousands of tiny steps)', () => {
    const hair = passes[0];
    const segs = hair.cuts.reduce((s, c) => s + c.points.length - 1, 0);
    const len = hair.cutLength / segs;
    expect(len).toBeGreaterThan(0.3); // mm per move on average
  });

  it('thinning keeps the hairline on the true outline', () => {
    const O = layout.letters[0];
    const cut = passes[0].cuts.find((c) => c.item.startsWith('O'))!;
    const near = (pt: { x: number; y: number }) =>
      Math.min(...O.outline.flatMap((ring) => ring.map((q) => Math.hypot(q.x - pt.x, q.y - pt.y))));
    for (const pt of cut.points) expect(near(pt)).toBeLessThan(1e-9); // every point kept is a point of the outline
  });

  it('starts with X0 Y0 at the front left corner (BRIEF.md, Decisions)', () => {
    expect(defaultMachine.zeroCorner).toBe('bottom-left');
    // The panel's front-left corner (bottom left on screen) is X0 Y0; the back edge is +Y.
    expect(toMachine(0, 60, 150, 60, defaultMachine.zeroCorner)).toEqual({ X: 0, Y: 0 });
    expect(toMachine(0, 0, 150, 60, defaultMachine.zeroCorner)).toEqual({ X: 0, Y: 60 });
    expect(g).toContain('X0 Y0 at the front left corner');
  });

  it('zero corners', () => {
    expect(toMachine(0, 60, 150, 60, 'bottom-left')).toEqual({ X: 0, Y: 0 });
    expect(toMachine(0, 0, 150, 60, 'top-left')).toEqual({ X: 0, Y: -0 });
    expect(toMachine(150, 0, 150, 60, 'top-right')).toEqual({ X: 0, Y: -0 });
    expect(toMachine(150, 60, 150, 60, 'bottom-right')).toEqual({ X: 0, Y: 0 });
    expect(toMachine(10, 20, 150, 60, 'top-right')).toEqual({ X: -140, Y: -20 });
  });
});
