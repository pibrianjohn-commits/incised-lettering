// Linked letters (BRIEF.md, Decisions: "Linked letters", decided for the
// carver by his adviser, 8 Oct 2026): neighbours joined on purpose into one
// shape, cut as one letter.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { alphabetFromFont } from '../src/alphabet';
import { findCollisions } from '../src/collisions';
import { insideShape, type Pt } from '../src/geometry';
import { toGcode } from '../src/gcode';
import { defaultProject, kernKept, layoutPanel, type Layout, type PlacedLetter, type Project } from '../src/layout';
import { LetterStore } from '../src/letters';
import { LINK_OVERLAP, middleOf, overlapOf, THIN_JOINT } from '../src/links';
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
      const bridge = strokes.findIndex((s) => s.parts.some((v) => v.some((q) => joints.some((j) => near(q, j, 0.6)))));
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

  it('a joint too thin to chisel is named, with a fix that overlaps them more', () => {
    // At the starting overlap (0.3 mm at 25 mm) the joint is under the 0.6 mm minimum.
    const p = proj({ text: 'AMAZBALLS', capHeight: 25, links: linked('AMAZBALLS', ['0:1', '0:2']) });
    const thin = everyFixCures(p).filter((q) => q.kind === 'link');
    expect(thin.map((q) => q.text)).toEqual(['The A and M in line 1 are joined by only 0.3 mm.', 'The M and A in line 1 are joined by only 0.3 mm.']);
    expect(thin.map((q) => q.fixes.map((f) => f.label))).toEqual([['Overlap them 0.3 mm more'], ['Overlap them 0.3 mm more']]);
    expect(THIN_JOINT).toBe(0.6);
    // Deep enough, nothing is said.
    const deep = proj({ text: 'AMAZBALLS', capHeight: 25, links: linked('AMAZBALLS', ['0:1', '0:2'], 0.6) });
    expect(layoutProblems(lay(deep), has).filter((q) => q.kind === 'link')).toEqual([]);
    // The minimum scales with the letters: 0.6 mm at 25 mm is 1.2 mm at 50 mm, and so is the overlap.
    const big = proj({ text: 'AM', capHeight: 50, panelWidth: 300, panelHeight: 120, links: linked('AM', ['0:1'], 0.6) });
    expect(layoutProblems(lay(big), has).filter((q) => q.kind === 'link')).toEqual([]);
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
      links: linked(text, ['0:1', '0:2', '1:3', '2:3', '4:1', '4:2', '4:3'], 0.6),
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
