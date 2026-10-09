// Linked letters (BRIEF.md, Decisions: "Linked letters", decided for the
// carver by his adviser, 8 Oct 2026): neighbours joined on purpose into one
// shape, cut as one letter.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { alphabetFromFont } from '../src/alphabet';
import { findCollisions } from '../src/collisions';
import { insideShape, signedArea, type Pt } from '../src/geometry';
import { toGcode } from '../src/gcode';
import { defaultProject, kernKept, layoutPanel, type Layout, type PlacedLetter, type Project } from '../src/layout';
import { LetterStore } from '../src/letters';
import { benchSheet } from '../src/benchsheet';
import { LINK_OVERLAP, middleOf, overlapOf, THIN_JOINT, touchAdvance, unitRun } from '../src/links';
import { bedFit } from '../src/panel';
import { attachFixes, layoutProblems, triedFixes, type Problem } from '../src/problems';
import { normaliseProject, projectFileText, readProjectFile } from '../src/projectfile';
import { finishedInput, packCuts, packShapes } from '../src/relief';
import { runJob } from '../src/relief-job';
import { remapForEdit } from '../src/remap';
import { evenUp, fitLine } from '../src/spacing';
import { EQUAL_WIDTH, isFork, strokesOf } from '../src/strokes';
import { buildPasses, checkPasses, defaultMachine } from '../src/toolpath';

const buf = readFileSync(new URL('../public/fonts/Cinzel-Regular.woff', import.meta.url));
const font = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const store = new LetterStore(alphabetFromFont(font, 'OFL'));
const has = (ch: string) => !!store.alphabet.letter(ch)?.contours.length;
const machine = { ...defaultMachine, stockThickness: 20 };
const proj = (c: Partial<Project> = {}): Project => ({ ...structuredClone(defaultProject), panelWidth: 300, panelHeight: 120, ...c });
const lay = (p: Project) => layoutPanel(store, p);
/** Links at these gaps (line:index of the right-hand letter), at the starting overlap unless given. */
const linked = (text: string, keys: string[], overlap = LINK_OVERLAP): Project['links'] => {
  const lines = text.split('\n');
  return Object.fromEntries(
    keys.map((k) => {
      const [li, i] = k.split(':').map(Number);
      const chars = [...lines[li]];
      return [k, { pair: chars[i - 1] + chars[i], overlap }];
    }),
  );
};
const letter = (l: Layout, char: string) => l.letters.find((x) => x.char === char)!;
/** Contours that are not inside another: the outer shapes. */
const outers = (l: PlacedLetter) => l.outline.filter((c, i) => !l.outline.some((o, j) => j !== i && insideShape(c[0], [o])));
const near = (a: Pt, b: Pt, d: number) => Math.hypot(a.x - b.x, a.y - b.y) <= d;
/** The least distance from a point to a line made of straight steps. */
const toLine = (p: Pt, line: Pt[]) =>
  Math.min(
    ...line.slice(1).map((b, i) => {
      const a = line[i];
      const [ux, uy] = [b.x - a.x, b.y - a.y];
      const len2 = ux * ux + uy * uy;
      const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * ux + (p.y - a.y) * uy) / len2)) : 0;
      return Math.hypot(p.x - (a.x + t * ux), p.y - (a.y + t * uy));
    }),
    line.length === 1 ? Math.hypot(p.x - line[0].x, p.y - line[0].y) : Infinity,
  );
/** The wood straight up and down through (x, y) in a shape: its top and bottom, or null. */
function bandAt(outline: Pt[][], x: number, y: number): [number, number] | null {
  const ys: number[] = [];
  for (const c of outline)
    for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
      const [a, b] = [c[j], c[i]];
      if (a.x > x !== b.x > x) ys.push(a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y));
    }
  ys.sort((m, n) => m - n);
  for (let i = 0; i + 1 < ys.length; i += 2) if (y >= ys[i] && y <= ys[i + 1]) return [ys[i], ys[i + 1]];
  return null;
}
const xRange = (c: Pt[]) => [Math.min(...c.map((q) => q.x)), Math.max(...c.map((q) => q.x))];
const yRange = (c: Pt[]) => [Math.min(...c.map((q) => q.y)), Math.max(...c.map((q) => q.y))];
/** The narrow end of each fork: where it runs out to a corner or serif tip. */
const forkTips = (l: PlacedLetter) => l.valleys.filter(isFork).map((v) => (v[0].r < v[v.length - 1].r ? v[0] : v[v.length - 1]));

describe('a linked pair is one letter', () => {
  for (const pair of ['AM', 'HH', 'LL']) {
    it(`${pair}: one outline, no stop cuts at the join, those at the far ends kept, the bridge cut thin first`, () => {
      const k = 31.5;
      const p = proj({ text: pair, capHeight: k, links: linked(pair, ['0:1']) });
      const l = lay(p);
      expect(l.letters).toHaveLength(1);
      const run = l.letters[0];
      expect(run.char).toBe(pair);
      expect(run.span).toBe(2);
      // One shape: one outer outline (A's counter, and the space H+H close in, are holes in it).
      expect(outers(run)).toHaveLength(1);
      expect(l.gaps).toHaveLength(1);
      expect(l.gaps[0].link).not.toBeNull();

      // The same two letters, each on its own, where the link puts them.
      const r = store.run([...pair], [LINK_OVERLAP / 25], k, { percent: p.datumPercent, minimum: p.datumMinimum })!;
      const dx = run.box.x0 - r.box.x0;
      const dy = run.box.y0 - r.box.y0;
      const apart = [...pair].map((ch, i) => {
        const m = store.marks(ch, k, { percent: p.datumPercent, minimum: p.datumMinimum })!;
        const x = r.pens[i] + dx;
        return { ...run, valleys: m.valleys.map((v) => v.map((q) => ({ ...q, x: q.x + x, y: q.y + dy }))) } as PlacedLetter;
      });
      // Every place the two letters meet (H and H meet at the top and at the foot).
      const shapes = [...pair].map((ch) => store.alphabet.letter(ch)!.contours);
      const unit = (r.pens[1] - r.pens[0]) / k;
      const joints = overlapOf(shapes[0], shapes[1], unit).map((c) => {
        const m = middleOf([c])!;
        return { x: m.x * k + r.pens[0] + dx, y: m.y * k + dy };
      });
      expect(joints.length).toBe(pair === 'HH' ? 2 : 1);
      const tipsApart = apart.flatMap(forkTips);
      const tipsJoined = forkTips(run);
      // Each letter on its own had stop cuts running out to the serif tips that now meet…
      const atJoin = tipsApart.filter((t) => joints.some((j) => near(t, j, 1.5)));
      expect(atJoin.length).toBeGreaterThan(0);
      // …the joined shape has none there…
      expect(tipsJoined.filter((t) => joints.some((j) => near(t, j, 1.5)))).toEqual([]);
      // …and keeps every other, the far ends of the joined serif included.
      for (const t of tipsApart.filter((x) => !joints.some((j) => near(x, j, 3)))) expect(tipsJoined.some((u) => near(t, u, 0.6)), `a stop cut kept at (${t.x.toFixed(1)}, ${t.y.toFixed(1)})`).toBe(true);

      // Thin before thick across the whole joined shape; the bridge across the join is numbered before the thickest stroke.
      const strokes = strokesOf(run.valleys);
      for (let i = 1; i < strokes.length; i++) expect(strokes[i].width).toBeGreaterThanOrEqual(strokes[i - 1].width * (1 - EQUAL_WIDTH) - 1e-9);
      const bridge = strokes.findIndex((s) => s.parts.some((v) => joints.some((j) => toLine(j, v) <= 0.6)));
      expect(bridge).toBeGreaterThanOrEqual(0);
      const thickest = strokes.reduce((b, s, i) => (s.width > strokes[b].width ? i : b), 0);
      expect(bridge).toBeLessThan(thickest);
    });
  }

  it('A+M: from 3 and 4 strokes to 8, as the adviser found; H+H from 6 to 8', () => {
    const count = (text: string, links: string[]) => strokesOf(letter(lay(proj({ text, capHeight: 31.5, links: linked(text, links) })), text).valleys).length;
    expect(count('AM', ['0:1'])).toBe(8);
    expect(count('HH', ['0:1'])).toBe(8);
  });

  it('three or more in a row (A M A) make one shape; a whole line can be one', () => {
    const l = lay(proj({ text: 'AMA', links: linked('AMA', ['0:1', '0:2']) }));
    expect(l.letters.map((x) => x.char)).toEqual(['AMA']);
    expect(l.letters[0].joints).toHaveLength(2);
    expect(outers(l.letters[0])).toHaveLength(1);
    expect(l.gaps.map((g) => !!g.link)).toEqual([true, true]);
  });

  it('is one letter in the cutting order, at the place of its first letter', () => {
    const text = 'BAMAZ';
    const l = lay(proj({ text, links: linked(text, ['0:2', '0:3']) }));
    const passes = buildPasses(l, machine);
    const items = [...new Set(passes.find((q) => q.name === 'slit')!.cuts.map((c) => c.item))].map((id) => id.split(' (')[0]);
    expect(items).toEqual(['B', 'AMA', 'Z']);
  });

  it('keeps its shape at any size: worked out once, and scaled', () => {
    const at = (k: number) => letter(lay(proj({ text: 'AM', capHeight: k, links: linked('AM', ['0:1']) })), 'AM');
    const [a, b] = [at(20), at(40)];
    const rel = (l: PlacedLetter) => l.outline[0].slice(0, 50).map((q) => ({ x: q.x - l.box.x0, y: q.y - l.box.y0 }));
    rel(a).forEach((q, i) => {
      expect(rel(b)[i].x).toBeCloseTo(q.x * 2, 6);
      expect(rel(b)[i].y).toBeCloseTo(q.y * 2, 6);
    });
    // The overlap is kept as at 25 mm and scales with the letters.
    expect(a.joints![0].width / 20).toBeCloseTo(b.joints![0].width / 40, 6);
  });

  it('the alphabet’s kerning, the letter spacing and the line’s own spacing do not move linked letters', () => {
    const base = proj({ text: 'VY', links: linked('VY', ['0:1']) });
    const box = (p: Project) => letter(lay(p), 'VY').box;
    const w = box(base).x1 - box(base).x0;
    for (const change of [{ kerning: { VY: -2 } }, { letterSpacing: 3 }, { lineExtras: { '0': { letter: 2, word: 0 } } }, { gapKerning: { '0:1': { pair: 'VY', mm: 1 } } }]) {
      const b = box({ ...base, ...change });
      expect(b.x1 - b.x0).toBeCloseTo(w, 6);
    }
  });
});

describe('the joint, measured as wood and filled', () => {
  const k = 25;
  const at25 = (text: string, keys = ['0:1']) => {
    const l = lay(proj({ text, capHeight: k, links: linked(text, keys) }));
    return Object.assign(l.letters.find((x) => x.span > 1)!, { base: l.lines[0].baselineY });
  };
  const T = (THIN_JOINT * k) / 25;

  it("measured as the adviser did: Cinzel's serif tip is 0.36 mm, and A and M's joined foot stays about that until they overlap 1.5 mm, nearing 0.6 mm only at 3 mm", () => {
    const [a, m] = ['A', 'M'].map((c) => store.alphabet.letter(c)!.contours);
    const t = touchAdvance(a, m)!;
    const unfilled = (mm: number) => unitRun([a, m], [mm / 25], () => t, THIN_JOINT / 25, false)!.joints[0].width * 25;
    expect(unfilled(0.3)).toBeCloseTo(0.36, 2);
    expect(unfilled(1)).toBeCloseTo(0.36, 2);
    expect(unfilled(1.5)).toBeLessThan(0.4);
    expect(unfilled(3)).toBeGreaterThan(0.5);
    expect(unfilled(3)).toBeLessThan(0.6);
  });

  it('A and M: the joined foot is filled, standing on the baseline, from where each letter is already 0.6 mm thick', () => {
    const run = at25('AM');
    const j = run.joints![0];
    expect(j.place).toBe('foot');
    const base = run.base;
    const fill = j.fill!;
    const [fy0, fy1] = yRange(fill);
    expect(fy1).toBeCloseTo(base, 6); // stands on the baseline
    expect(base - fy0).toBeCloseTo(T, 2); // up to 0.6 mm
    const [fx0, fx1] = xRange(fill);
    expect(fx1 - fx0).toBeGreaterThan(2.5); // about 1.5 mm into each serif
    expect(fx1 - fx0).toBeLessThan(3.5);
    // Straight up and down anywhere along the fill, the joined shape is at least 0.6 mm thick from the baseline up.
    for (let x = fx0 + 0.05; x < fx1 - 0.05; x += 0.1) {
      const b = bandAt(run.outline, x, base - 0.01)!;
      expect(base - b[0]).toBeGreaterThanOrEqual(T - 0.002);
    }
    expect(j.width).toBeGreaterThanOrEqual(T - 0.001);
  });

  it('H and H: joined at the head and the foot, both filled, the head hanging from the cap line', () => {
    const run = at25('HH');
    const fills = run.joints![0].fills;
    expect(fills).toHaveLength(2);
    const base = run.base;
    const cap = base - k;
    const [foot, head] = [...fills].sort((p, q) => yRange(q)[1] - yRange(p)[1]);
    expect(yRange(foot)[1]).toBeCloseTo(base, 6);
    expect(yRange(head)[0]).toBeCloseTo(cap, 6);
    for (const [f, y, down] of [
      [foot, base - 0.01, false],
      [head, cap + 0.01, true],
    ] as const) {
      const [x0, x1] = xRange(f);
      for (let x = x0 + 0.05; x < x1 - 0.05; x += 0.1) {
        const b = bandAt(run.outline, x, y)!;
        expect(down ? b[1] - cap : base - b[0]).toBeGreaterThanOrEqual(T - 0.002);
      }
    }
    expect(run.joints![0].width).toBeGreaterThanOrEqual(T - 0.001);
  });

  it('L and L: the first L’s arm is already thick at the join, so the fill runs from there to where the second L’s serif is', () => {
    const run = at25('LL');
    const j = run.joints![0];
    expect(j.place).toBe('foot');
    const [fx0, fx1] = xRange(j.fill!);
    expect(fx1 - fx0).toBeGreaterThan(1);
    expect(fx1 - fx0).toBeLessThan(2);
    expect(j.width).toBeGreaterThanOrEqual(T - 0.001);
  });

  it('a join away from both lines (a Q’s tail against a J) is measured through its band, and needs no fill when already thick', () => {
    const run = at25('QJ');
    const j = run.joints![0];
    expect(j.place).toBe('elsewhere');
    expect(j.fill).toBeNull();
    expect(j.width).toBeGreaterThan(T);
    expect(j.at.y).toBeGreaterThan(run.base); // below the baseline, where the tails meet
  });

  it('a bowl against the side of a stem (B B) is measured through the neck between them, not up the stem', () => {
    const j = at25('BB').joints![0];
    expect(j.place).toBe('elsewhere');
    expect(j.fill).toBeNull();
    expect(j.width).toBeGreaterThan(3);
    expect(j.width).toBeLessThan(6);
  });

  it('a G’s beard against a stem is filled centred on the join, not slanting off to the middle of the stem', () => {
    const run = at25('GB');
    const j = run.joints![0];
    expect(j.place).toBe('elsewhere');
    const [fy0, fy1] = yRange(j.fill!);
    expect(fy1 - fy0).toBeLessThan(T + 0.3);
    expect(Math.abs((fy0 + fy1) / 2 - j.at.y)).toBeLessThan(0.2);
    expect(j.width).toBeGreaterThanOrEqual(T - 0.001);
  });

  it('letters the alphabet draws the other way round (Cinzel’s 1 and 7) still join into one shape, with no hole where they overlap', () => {
    for (const pair of ['E1', '71', '17', 'B7', 'H1', '77']) {
      const [a, b] = [...pair].map((c) => store.alphabet.letter(c)!.contours);
      const t = touchAdvance(a, b)!;
      const run = unitRun([a, b], [LINK_OVERLAP / 25], () => t, THIN_JOINT / 25, false)!;
      const pieces = overlapOf(a, b.map((c) => c.map((q) => ({ x: q.x + run.pens[1], y: q.y }))), 0);
      expect(pieces.length).toBeGreaterThan(0);
      for (const piece of pieces) expect(insideShape(middleOf([piece])!, run.outline), pair).toBe(true);
    }
  });

  it('every pair of capitals and figures, linked at the starting overlap: each join is filled to 0.6 mm or already that thick, and no fill shuts in a speck of wood', () => {
    const chars = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789&'];
    const holes = (cs: Pt[][]) => {
      const big = cs.reduce((m, c) => (Math.abs(signedArea(c)) > Math.abs(m) ? signedArea(c) : m), 0);
      return cs.filter((c) => Math.sign(signedArea(c)) !== Math.sign(big)).length;
    };
    let filled = 0;
    for (const x of chars)
      for (const y of chars) {
        const [a, b] = [x, y].map((c) => store.alphabet.letter(c)!.contours);
        const t = touchAdvance(a, b);
        if (t === null) continue;
        const run = unitRun([a, b], [LINK_OVERLAP / 25], () => t, THIN_JOINT / 25)!;
        const j = run.joints[0];
        expect(j.width, x + y).toBeGreaterThanOrEqual(THIN_JOINT / 25 - 1e-6);
        expect(j.width, x + y).toBeLessThan(1);
        if (j.fill) {
          filled++;
          expect(holes(run.outline), x + y).toBeLessThanOrEqual(holes(unitRun([a, b], [LINK_OVERLAP / 25], () => t, THIN_JOINT / 25, false)!.outline));
        }
      }
    expect(filled).toBeGreaterThan(300);
  }, 120000);

  it('a figure’s flag or a beard meeting the side of a bowl reads as the wood that joins them, not the bowl’s height (“A.D. 1910”: 9 and 1)', () => {
    const p = proj({ text: 'A.D. 1910', capHeight: 25, links: linked('A.D. 1910', ['0:7']) });
    const l = lay(p);
    const j = letter(l, '91').joints![0];
    expect(j.fill).not.toBeNull();
    expect(j.width).toBeGreaterThanOrEqual(0.6 - 0.001);
    expect(j.width).toBeLessThan(0.7);
    for (const pair of ['&V', '81', 'G9']) {
      const [a, b] = [...pair].map((c) => store.alphabet.letter(c)!.contours);
      const t = touchAdvance(a, b)!;
      expect(unitRun([a, b], [LINK_OVERLAP / 25], () => t, THIN_JOINT / 25)!.joints[0].width * 25, pair).toBeLessThan(0.7);
    }
  });

  it('where an S’s tail divides into its body and the beak at its tip, the joint is read through the body (O and S), and is not filled', () => {
    const [a, b] = ['O', 'S'].map((c) => store.alphabet.letter(c)!.contours);
    const t = touchAdvance(a, b)!;
    const j = unitRun([a, b], [LINK_OVERLAP / 25], () => t, THIN_JOINT / 25)!.joints[0];
    expect(j.width * 25).toBeGreaterThan(3);
    expect(j.fills).toEqual([]);
  });

  it('linked deep, a fill stays a short block at the join: none where the letters already run into each other thick enough, none slanting up a stroke', () => {
    const run = (pair: string, mm: number) => {
      const [a, b] = [...pair].map((c) => store.alphabet.letter(c)!.contours);
      const t = touchAdvance(a, b)!;
      return unitRun([a, b], [mm / 25], () => t, THIN_JOINT / 25)!;
    };
    // Found 9 Oct 2026: a round letter and a diagonal linked 2 to 3 mm deep run into each other along a long
    // crescent, already 1.1 to 1.8 mm thick across, and were given a fill 10 or 11 mm long that ran out across
    // a counter; and a Y against a 4 or 1 a block slanting nearly the height of the letter.
    for (const [pair, mm] of [['XO', 3.3], ['DX', 2.3], ['DX', 2.8], ['QX', 2.8], ['YG', 1.8], ['AV', 2.8], ['CH', 2.8], ['FN', 2.3], ['Y4', 2.3], ['Y4', 2.8], ['Y1', 1.8]] as const) {
      const j = run(pair, mm).joints[0];
      for (const f of j.fills) {
        const xs = f.map((p) => p.x);
        const ys = f.map((p) => p.y);
        expect((Math.max(...xs) - Math.min(...xs)) * 25, `${pair} at ${mm} mm`).toBeLessThan(5);
        expect((Math.max(...ys) - Math.min(...ys)) * 25, `${pair} at ${mm} mm`).toBeLessThan(2);
      }
    }
    for (const [pair, mm] of [['XO', 3.3], ['AV', 2.8], ['YG', 1.8]] as const) {
      const j = run(pair, mm).joints[0];
      expect(j.fills, `${pair} at ${mm} mm`).toEqual([]);
      expect(j.width * 25, `${pair} at ${mm} mm`).toBeGreaterThan(1);
    }
  });

  /** Two letters linked `mm` deep at 25 mm cap height, filled or (with `fill` off) as the letters make it. */
  const pairRun = (pair: string, mm: number, fill = true) => {
    const [a, b] = [...pair].map((c) => store.alphabet.letter(c)!.contours);
    const t = touchAdvance(a, b)!;
    return unitRun([a, b], [mm / 25], () => t, THIN_JOINT / 25, fill)!;
  };

  it('a foot is measured from the baseline up and a head from the cap line down: what runs below or above the line is not wood to chisel against', () => {
    // An L's foot serif ends in a wedge on the top of a figure's curve, which runs on below the baseline: above
    // the line only 0.15 mm of wood joins them (found by review, 9 Oct 2026; measured all the way down, about 1 mm).
    for (const pair of ['L3', 'L5', 'Z5']) {
      expect(pairRun(pair, 0.3, false).joints[0].width * 25, pair).toBeLessThan(0.2);
      const j = pairRun(pair, 0.3).joints[0];
      expect(j.place, pair).toBe('foot');
      expect(j.fill, pair).not.toBeNull();
      expect(j.width * 25, pair).toBeGreaterThanOrEqual(0.6 - 0.001);
    }
    const zt = pairRun('ZT', 0.3).joints[0];
    expect(pairRun('ZT', 0.3, false).joints[0].width * 25).toBeLessThan(0.4);
    expect([zt.place, zt.fill !== null]).toEqual(['head', true]);
  });

  it('a foot or head already thick enough is not filled', () => {
    for (const [pair, mm] of [['7Z', 0.3], ['ET', 1.3], ['TT', 1.3], ['AJ', 2.3], ['EB', 2.3]] as const) {
      const j = pairRun(pair, mm).joints[0];
      expect(j.fills, `${pair} at ${mm} mm`).toEqual([]);
      expect(j.width * 25, `${pair} at ${mm} mm`).toBeGreaterThan(0.75);
    }
  });

  it('linked deep, a Y’s serif over the flat top of a 4 or 1 gets a level fill hanging from the cap line', () => {
    // Found by review, 9 Oct 2026: once the Y's serif tip passes the end of the figure's top, the figure's wood on
    // the cap line lies wholly within the overlap; its thick point was not looked for there, and the joint was left
    // 0.41 to 0.59 mm thick with no fill, though the same fill cures it a hair shallower.
    for (const [pair, mm] of [['Y4', 2.05], ['Y4', 2.3], ['Y4', 2.5], ['Y4', 2.8], ['Y1', 1.8], ['Y1', 1.9]] as const) {
      const j = pairRun(pair, mm).joints[0];
      expect(j.width * 25, `${pair} at ${mm} mm`).toBeGreaterThanOrEqual(0.6 - 0.001);
      const f = j.fills.find((g) => g.some((p) => Math.abs(p.y + 1) < 1e-9));
      expect(f, `${pair} at ${mm} mm`).toBeDefined();
      for (const p of f!) expect(p.y, `${pair} at ${mm} mm`).toBeLessThanOrEqual(-1 + (0.61 / 25));
    }
  });

  it('a joint is read at the join, not at the far end of a stem past it (Y 1, P D, G I linked deep), nor at a corner just past the overlap (3 S)', () => {
    for (const [pair, mm] of [['Y1', 2.8], ['PD', 2.8], ['GI', 2.8], ['V1', 2.8]] as const) {
      const r = pairRun(pair, mm);
      const [a, b] = [...pair].map((c) => store.alphabet.letter(c)!.contours);
      const ys = overlapOf(a, b.map((c) => c.map((p) => ({ x: p.x + r.pens[1], y: p.y }))), 0).flat().map((p) => p.y);
      const at = r.joints[0].at.y;
      expect(at, `${pair} at ${mm} mm`).toBeGreaterThan(Math.min(...ys) - 1 / 25);
      expect(at, `${pair} at ${mm} mm`).toBeLessThan(Math.max(...ys) + 1 / 25);
    }
    for (const mm of [0.348, 0.35, 0.352]) expect(pairRun('3S', mm).joints[0].width * 25, `3S at ${mm} mm`).toBeGreaterThan(2);
  });

  it('a fill leaves no speck of wood shut in beside it, for the hairline to go round (I S, A S, S N, 6 M)', () => {
    for (const text of ['IS', 'AS', 'SN', '6M', 'MS', 'XC']) {
      const l = lay(proj({ text, capHeight: 25, links: linked(text, ['0:1']) }));
      const run = l.letters.find((x) => x.span > 1)!;
      const big = run.outline.reduce((m, c) => (Math.abs(signedArea(c)) > Math.abs(m) ? signedArea(c) : m), 0);
      const inner = run.outline.filter((c) => Math.sign(signedArea(c)) !== Math.sign(big));
      // Only the letters' own counters (A's, 6's) and spaces wider than the 0.6 mm minimum are left.
      for (const c of inner) {
        const xs = c.map((q) => q.x);
        const ys = c.map((q) => q.y);
        expect(Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)), text).toBeGreaterThan(0.6);
      }
    }
  }, 60000);

  it('the joint mark sits at the fill, and the gap tools and bench sheet read the thickness', () => {
    const p = proj({ text: 'AMAZBALLS', capHeight: 31.5, machine, links: linked('AMAZBALLS', ['0:1', '0:2']) });
    const l = lay(p);
    for (const g of l.gaps.filter((x) => x.link)) {
      const j = g.left.joints![Number(g.key.split(':')[1]) - g.left.pos - 1];
      const [fx0, fx1] = xRange(j.fill!);
      expect(g.x).toBeGreaterThan(fx0);
      expect(g.x).toBeLessThan(fx1);
    }
    const passes = buildPasses(l, machine);
    const sheet = benchSheet({ project: p, layout: l, strokes: passes.find((q) => q.name === 'slit')!, passes, checks: checkPasses(l, passes, machine, bedFit(p.panelWidth, p.panelHeight)), alphabet: 'Cinzel', fileName: null, date: new Date('2026-10-08T12:00:00Z') });
    expect(sheet.html).toMatch(/A M on line 1, joined 0\.7\d mm thick, filled, overlap 0\.4 mm; M A on line 1, joined 0\.7\d mm thick, filled, overlap 0\.4 mm/);
  });

  it('the filled foot is one slab: no stop cuts at the join, one valley along it', () => {
    const run = at25('AM');
    const [fx0, fx1] = xRange(run.joints![0].fill!);
    const base = run.base;
    // No fork runs out to a point under the fill.
    const tips = run.valleys.filter(isFork).map((v) => (v[0].r < v[v.length - 1].r ? v[0] : v[v.length - 1]));
    expect(tips.filter((t) => t.x > fx0 && t.x < fx1 && t.y > base - 1)).toEqual([]);
    // A valley line runs along the slab, through the middle of the fill.
    const mid = { x: (fx0 + fx1) / 2, y: base - T / 2 };
    expect(Math.min(...run.valleys.map((v) => toLine(mid, v)))).toBeLessThan(T / 2);
  });
});

describe('links in the job', () => {
  it('follow their letters when the text is edited, and are dropped quietly when the letters change', () => {
    const p = proj({ text: 'AMAZ', links: linked('AMAZ', ['0:1', '0:2']) });
    const moved = { ...p, text: 'XAMAZ', ...remapForEdit(p, 'XAMAZ') };
    expect(Object.keys(moved.links).sort()).toEqual(['0:2', '0:3']);
    expect(lay(moved).letters.map((x) => x.char)).toEqual(['X', 'AMA', 'Z']);
    // The M changed to N: neither link holds; the letters are spaced as usual, and nothing is said.
    const changed = { ...p, text: 'ANAZ', ...remapForEdit(p, 'ANAZ') };
    expect(lay(changed).letters.map((x) => x.char)).toEqual(['A', 'N', 'A', 'Z']);
    // A link left under different letters (as from an older edit) is ignored.
    const stale = lay({ ...p, text: 'ANAZ' });
    expect(stale.letters.map((x) => x.char)).toEqual(['A', 'N', 'A', 'Z']);
    expect(layoutProblems(stale, has).filter((q) => q.kind === 'link')).toEqual([]);
  });

  it('are saved in project files; an older file opens unchanged, with none', () => {
    const p = proj({ text: 'AMAZBALLS', links: linked('AMAZBALLS', ['0:1', '0:2']) });
    const back = readProjectFile(projectFileText(p, 'Cinzel', null)).project;
    expect(back.links).toEqual(p.links);
    const old = normaliseProject({ text: 'AMAZBALLS', capHeight: 30, kernCap: 25 });
    expect(old.links).toEqual({});
    expect(lay({ ...proj(), ...old }).letters).toHaveLength(9);
  });

  it('a pair that can never meet cannot be linked: a link there is ignored', () => {
    // An apostrophe and a full stop share no height.
    expect(store.touch('’', '.')).toBeNull();
    const l = lay(proj({ text: '’.', links: { '0:1': { pair: '’.', overlap: LINK_OVERLAP } } }));
    expect(l.letters.map((x) => x.char)).toEqual(['’', '.']);
  });

  it('a link at the end of a line, and across a word space (which breaks a run), behave', () => {
    const l = lay(proj({ text: 'ZA M', links: { ...linked('ZA M', ['0:1']), '0:3': { pair: ' M', overlap: LINK_OVERLAP } } }));
    expect(l.letters.map((x) => x.char)).toEqual(['ZA', 'M']);
  });

  it('no space is measured, evened up or fitted across a link', () => {
    const p = proj({ text: 'VY HH', links: linked('VY HH', ['0:1']) });
    const l = lay(p);
    expect(evenUp(store, l).suggestions.map((s) => s.pair)).not.toContain('VY');
    // A line that is all one linked shape can't be spread by spacing.
    const all = proj({ text: 'AMMA', links: linked('AMMA', ['0:1', '0:2', '0:3']) });
    expect(fitLine(store, all, 0, 200, 'letter')).toBeNull();
  });
});

describe('problems with linked letters', () => {
  /** Problems with their fixes tried, as the app shows them. */
  const problemsOf = (p: Project) => {
    const l = lay(p);
    return attachFixes(layoutProblems(l, has), triedFixes(l, has, (q) => layoutPanel(store, q, true, 'outline')));
  };
  /** Every fix offered, carried out afresh: it cures its own problem and causes no new one. */
  function everyFixCures(p: Project): Problem[] {
    const list = problemsOf(p);
    const before = new Set(list.flatMap((q) => q.facts ?? []));
    for (const q of list.filter((x) => x.key))
      for (const f of q.fixes) {
        const after = layoutProblems(lay({ ...p, ...f.change }), has);
        expect(after.some((x) => x.key === q.key), `“${f.label}” cures “${q.text}”`).toBe(false);
        expect(after.flatMap((x) => x.facts ?? []).filter((x) => !before.has(x)), `“${f.label}” causes nothing new`).toEqual([]);
      }
    return list;
  }

  it('no collision on a link; one still on an unlinked touching pair, which offers "Link them"', () => {
    const p = proj({ text: 'WAVY' });
    const vy = problemsOf(p).find((q) => q.text === 'The V and Y in line 1 touch.')!;
    expect(vy.fixes.map((f) => f.label)).toContain('Link them');
    const l = lay({ ...p, links: linked('WAVY', ['0:3']) });
    expect(findCollisions(l).filter((c) => c.a.char.includes('V') || c.b.char.includes('V'))).toEqual([]);
  });

  it('"Link them" and "Link every pair that touches" cure their problems and leave a joint that can be chiselled', () => {
    const p = proj({ text: 'AMAZBALLS', capHeight: 31.5, letterSpacing: -0.5 });
    const list = everyFixCures(p).filter((q) => q.kind === 'collision');
    const every = list[0].fixes.find((f) => f.label === 'Link every pair that touches')!;
    const l = lay({ ...p, ...every.change });
    expect(l.letters.map((x) => x.char)).toEqual(['AMA', 'Z', 'B', 'A', 'L', 'L', 'S']);
    expect(layoutProblems(l, has).filter((q) => q.kind === 'link' || q.kind === 'collision')).toEqual([]);
  });

  it('the three A–M joins in the carver’s layout, linked at the starting overlap, are filled: no thin joint', () => {
    const BRIAN = proj({
      text: 'AMBER IS....\n\nJUST\n\nAMAZBALLS',
      capHeight: 31.5,
      letterSpacing: -0.5,
      lineSpacing: 20,
      panelWidth: 300,
      panelHeight: 200,
      lines: { '2': { x: 130, align: 'centre', baseline: 114.8 }, '4': { x: 150, align: 'centre', baseline: 154.9 } },
    });
    const p = { ...BRIAN, links: { ...linked(BRIAN.text, ['0:1', '4:1', '4:2']) } };
    const l = lay(p);
    expect(layoutProblems(l, has).filter((q) => q.kind === 'link')).toEqual([]);
    const thick = (THIN_JOINT * 31.5) / 25;
    const joints = l.letters.flatMap((x) => x.joints ?? []);
    expect(joints).toHaveLength(3);
    for (const j of joints) {
      expect(j.place).toBe('foot');
      expect(j.fill).not.toBeNull();
      expect(j.width).toBeGreaterThanOrEqual(thick - 0.001);
    }
  });

  it('a join the fill cannot build up (the tail of a quote running to a point against a C) is still named, with a fix that overlaps them more, or one that parts them', () => {
    // Linked 1 mm deep, the quote's tail runs out to a point inside the C before it is 0.6 mm thick: there is nothing to fill from.
    const p = proj({ text: 'O’CONNOR', capHeight: 25, links: linked('O’CONNOR', ['0:2'], 1) });
    const thin = everyFixCures(p).filter((q) => q.kind === 'link');
    expect(thin.map((q) => q.text)).toEqual([expect.stringMatching(/^The “’” and C in line 1 are joined by only 0\.\d\d mm of wood\.$/)]);
    // The least of the deeper overlaps that cures it, tried first; or part them again.
    expect(thin[0].fixes.map((f) => f.label)).toEqual([expect.stringMatching(/^Overlap them [\d.]+ mm more$/), 'Unlink them']);
  });

  it('two letters linked so that they only touch are said to have no wood joining them, not to be joined by 0.00 mm', () => {
    const p = proj({ text: 'AM', capHeight: 25, links: linked('AM', ['0:1'], 0) });
    const thin = everyFixCures(p).filter((q) => q.kind === 'link');
    expect(thin.map((q) => q.text)).toEqual(['The A and M in line 1 are linked, but no wood joins them.']);
    expect(thin[0].fixes.map((f) => f.label)).toEqual(['Overlap them 0.5 mm more', 'Unlink them']);
  });

  it('linked deep, a serif running free across the overlap is not read as the joint (7 and A at 2.8 mm)', () => {
    for (const mm of [2.3, 2.8, 3.3]) {
      const p = proj({ text: '7A', capHeight: 25, links: linked('7A', ['0:1'], mm) });
      expect(problemsOf(p).filter((q) => q.kind === 'link'), `${mm} mm`).toEqual([]);
    }
  });

  it('the thin-joint minimum scales with the letters: 0.6 mm at 25 mm is 1.2 mm at 50 mm', () => {
    expect(THIN_JOINT).toBe(0.6);
    const big = lay(proj({ text: 'AM', capHeight: 50, panelWidth: 300, panelHeight: 120, links: linked('AM', ['0:1']) }));
    expect(big.letters[0].joints![0].width).toBeGreaterThanOrEqual(1.2 - 0.002);
    expect(layoutProblems(big, has).filter((q) => q.kind === 'link')).toEqual([]);
    expect(kernKept(1.2, 50)).toBeCloseTo(0.6, 9);
  });

  it('letters that could not be joined are cut separately, named, with "Unlink them", tried first', () => {
    class Broken extends LetterStore {
      run(): never {
        throw new Error('test');
      }
    }
    const broken = new Broken(store.alphabet);
    const p = proj({ text: 'AM', links: linked('AM', ['0:1']) });
    const l = layoutPanel(broken, p);
    expect(l.letters.map((x) => x.char)).toEqual(['A', 'M']);
    const list = attachFixes(layoutProblems(l, has), triedFixes(l, has, (q) => layoutPanel(broken, q, true, 'outline')));
    const q = list.find((x) => x.key === 'unjoined:0:1')!;
    expect(q.text).toBe('The linked A and M in line 1 could not be joined into one shape, so they are cut as separate letters.');
    expect(q.fixes.map((f) => f.label)).toEqual(['Unlink them']);
    expect(layoutProblems(layoutPanel(broken, { ...p, ...q.fixes[0].change }), has).some((x) => x.key === q.key)).toBe(false);
  });
});

describe('real inscriptions with linked letters, through the whole job', () => {
  it('AMAZBALLS (AM and MA linked), HALL, WAVY (V and Y linked), A.D. 1920, and a line entirely linked', () => {
    const text = 'AMAZBALLS\nHALL\nWAVY\nA.D. 1920\nAMMA';
    const p = proj({
      text,
      capHeight: 12,
      lineSpacing: 18,
      panelWidth: 200,
      panelHeight: 120,
      machine,
      links: linked(text, ['0:1', '0:2', '1:3', '2:3', '4:1', '4:2', '4:3']),
    });
    const l = lay(p);
    expect(l.failed).toEqual([]);
    expect(l.unjoined).toEqual([]);
    expect(l.shapesPending).toBe(false);
    expect(l.letters.map((x) => x.char)).toEqual(['AMA', 'Z', 'B', 'A', 'L', 'L', 'S', 'H', 'A', 'LL', 'W', 'A', 'VY', 'A', '.', 'D', '.', '1', '9', '2', '0', 'AMMA']);
    expect(layoutProblems(l, has).filter((q) => q.kind === 'letters' || q.kind === 'link')).toEqual([]);
    const passes = buildPasses(l, machine);
    expect(passes.flatMap((q) => q.failed)).toEqual([]);
    const checks = checkPasses(l, passes, machine, 'standard');
    expect(checks.filter((c) => !c.ok && c.blocking)).toEqual([]);
    const g = toGcode(passes, machine, { title: 'linked', panelWidth: p.panelWidth, panelHeight: p.panelHeight });
    expect(g).not.toMatch(/NaN|undefined|Infinity/);
    // Both 3D boards.
    const marked = runJob({ id: 1, state: 'marked', width: p.panelWidth, height: p.panelHeight, machine, area: null, cuts: packCuts(passes) });
    expect(marked.maxDepth).toBeGreaterThan(0);
    const fin = finishedInput(l);
    const finished = runJob({ id: 2, state: 'finished', width: p.panelWidth, height: p.panelHeight, machine, area: null, shapes: packShapes(fin.shapes), border: p.border, datum: fin.datum, widest: fin.widest });
    expect(finished.maxDepth).toBeGreaterThan(0);
  }, 60_000);
});
