// Every character the alphabet has, punctuation and numerals included, run
// through the whole job on its own: the layout, the stroke numbering, the
// G-code passes and the G-code itself, and both 3D boards. Any character that
// cannot be worked out is a failing test, named (BRIEF.md, Decisions: "Dots").

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'opentype.js';
import { alphabetFromFont } from '../src/alphabet';
import { strokeLabels } from '../src/benchsheet';
import { toGcode } from '../src/gcode';
import { defaultProject, layoutPanel, type Project } from '../src/layout';
import { LetterStore } from '../src/letters';
import { layoutProblems, machineProblems, passDepths } from '../src/problems';
import { finishedInput, packCuts, packShapes } from '../src/relief';
import { runJob } from '../src/relief-job';
import { strokesOf } from '../src/strokes';
import { buildPasses, checkPasses, defaultMachine, slitDepth } from '../src/toolpath';

const buf = readFileSync(new URL('../public/fonts/Cinzel-Regular.woff', import.meta.url));
const font = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const store = new LetterStore(alphabetFromFont(font, 'OFL'));
const machine = { ...defaultMachine, stockThickness: 20 };

/** Every character the font has a letter for, but spaces. */
const chars = Object.keys((parse(font).tables.cmap as unknown as { glyphIndexMap: Record<string, number> }).glyphIndexMap)
  .map(Number)
  .filter((c) => c > 32)
  .map((c) => String.fromCodePoint(c))
  .filter((ch) => !/\s/.test(ch) && store.alphabet.letter(ch)?.contours.length);

const name = (ch: string) => `“${ch}” (U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})`;

describe('every character in the alphabet', () => {
  it('includes the punctuation and numerals a real inscription has', () => {
    for (const ch of '0123456789.,:;!?\'"‘’“”-–—()&/') expect(chars, ch).toContain(ch);
    expect(chars.length).toBeGreaterThan(150);
  });

  it.each(chars.map((ch) => [name(ch), ch]))('%s: layout, strokes, G-code and both 3D boards', (_, ch) => {
    const p: Project = { ...structuredClone(defaultProject), text: `H${ch}H`, capHeight: 8, panelWidth: 40, panelHeight: 24, machine };
    const has = (c: string) => !!store.alphabet.letter(c)?.contours.length;

    // Layout: placed, nothing left out.
    const layout = layoutPanel(store, p);
    expect(layout.failed).toEqual([]);
    expect(layout.letters.map((l) => l.char)).toEqual(['H', ch, 'H']);
    const letter = layout.letters[1];
    const id = `${ch} (line 1)#1`;
    expect(layoutProblems(layout, has).filter((q) => q.kind === 'letters')).toEqual([]);

    // Strokes: at least one, each with somewhere to cut; a dot is one plunge at its centre.
    const strokes = strokesOf(letter.valleys);
    if (letter.valleys.length) expect(strokes.length).toBeGreaterThan(0);
    for (const s of strokes) {
      expect(s.parts.length).toBeGreaterThan(0);
      for (const part of s.parts) expect(part.length).toBeGreaterThan(0);
      expect(Number.isFinite(s.width)).toBe(true);
    }

    // The G-code passes: nothing left out, every stroke numbered once on the bench sheet.
    const passes = buildPasses(layout, machine);
    expect(passes.flatMap((q) => q.failed)).toEqual([]);
    const slit = passes.find((q) => q.name === 'slit')!;
    const mine = slit.cuts.filter((c) => c.item === id);
    const numbers = [...new Set(mine.filter((c) => !c.fork).map((c) => c.stroke))];
    // (A stroke too narrow for the slit to reach has no cut, and so no number on the sheet.)
    const cut = strokes.map((s, i) => (s.parts.some((v) => v.some((q) => slitDepth(q.r, machine) > 0)) ? i + 1 : 0)).filter(Boolean);
    expect(numbers).toEqual(cut);
    const labels = strokeLabels(slit).filter((l) => l.item === id);
    expect(labels).toHaveLength(numbers.length);
    for (const c of slit.cuts) for (const q of c.points) expect(Number.isFinite(q.x + q.y + q.z)).toBe(true);
    const checks = checkPasses(layout, passes, machine, 'standard');
    expect(machineProblems(checks, passDepths(passes), machine, p.capHeight).filter((q) => q.text.includes('could not be worked out'))).toEqual([]);
    const g = toGcode(passes, machine, { title: ch, panelWidth: p.panelWidth, panelHeight: p.panelHeight });
    expect(g).not.toMatch(/NaN|undefined|Infinity/);

    // Both 3D boards: cut where the letter is, and nowhere deeper than the cuts.
    const marked = runJob({ id: 1, state: 'marked', width: p.panelWidth, height: p.panelHeight, machine, area: null, cuts: packCuts(passes) });
    // As deep as the G-code goes, to within what a 0.04 mm cell can show of a V-bit's point.
    const deepest = Math.max(...passes.map((q) => q.deepest));
    expect(marked.maxDepth).toBeLessThanOrEqual(deepest + 1e-3);
    expect(marked.maxDepth).toBeGreaterThan(deepest - 0.05);
    const f = finishedInput(layout);
    const finished = runJob({ id: 2, state: 'finished', width: p.panelWidth, height: p.panelHeight, machine, area: null, shapes: packShapes(f.shapes), border: f.border, datum: f.datum, widest: f.widest });
    expect(finished.maxDepth).toBeGreaterThan(0);
    expect(Number.isFinite(finished.maxDepth)).toBe(true);
  });
});

describe('dots', () => {
  const marks = (ch: string) => store.marks(ch, 25, { percent: 20, minimum: 0.2 }, true)!;
  const isDot = (s: ReturnType<typeof strokesOf>[number]) => s.parts.length === 1 && s.parts[0].length === 1;

  it('a full stop is one stroke: a plunge at its centre, its deepest point, with its stop cuts', () => {
    const m = marks('.');
    const [dot, ...rest] = strokesOf(m.valleys);
    expect(rest).toEqual([]);
    expect(isDot(dot)).toBe(true);
    const deepest = Math.max(...m.valleys.flat().map((q) => q.r));
    expect(dot.parts[0][0].r).toBe(deepest);
    expect(dot.extras.length).toBeGreaterThan(0);
    expect(dot.width).toBeCloseTo(2 * deepest, 9);
  });

  it('a colon is two dots, cut top first (equal widths: left to right, then top to bottom)', () => {
    const s = strokesOf(marks(':').valleys);
    expect(s.map(isDot)).toEqual([true, true]);
    expect(s[0].parts[0][0].y).toBeLessThan(s[1].parts[0][0].y);
  });

  it('! and ? keep their stroke and gain the dot as a stroke of its own; letters gain nothing', () => {
    for (const ch of '!?') expect(strokesOf(marks(ch).valleys).map(isDot)).toEqual([false, true]);
    for (const ch of 'AYW1') expect(strokesOf(marks(ch).valleys).some(isDot)).toBe(false);
  });

  it('cut as a single plunge, in steps, to the valley depth less the slit margin', () => {
    const p: Project = { ...structuredClone(defaultProject), text: 'No. 1312', capHeight: 30, panelWidth: 200, panelHeight: 60, machine };
    const layout = layoutPanel(store, p);
    const slit = buildPasses(layout, machine).find((q) => q.name === 'slit')!;
    const dotCut = slit.cuts.find((c) => c.item.startsWith('. (') && !c.fork)!;
    expect(new Set(dotCut.points.map((q) => `${q.x},${q.y}`)).size).toBe(1); // all at its centre
    const centre = layout.letters.find((l) => l.char === '.')!.valleys.flat().reduce((a, b) => (b.r > a.r ? b : a));
    expect(-Math.min(...dotCut.points.map((q) => q.z))).toBeCloseTo(slitDepth(centre.r, machine), 9);
    // Each step down is no more than the slit step.
    const zs = dotCut.points.map((q) => -q.z);
    for (let i = 1; i < zs.length; i++) expect(zs[i] - zs[i - 1]).toBeLessThanOrEqual(machine.slitStep + 1e-9);
  });
});

describe('real inscriptions', () => {
  for (const text of ['No. 1312', 'A.D. 1920', '12th March 1920 – 3rd May 2001', 'IN MEMORIAM:\n\nJOHN SMITH, R.N.', '“REST IN PEACE.”', 'Lodge No. 1312; Est. 1884!']) {
    it(JSON.stringify(text), () => {
      const p: Project = { ...structuredClone(defaultProject), text, capHeight: 12, panelWidth: 300, panelHeight: 120, machine };
      const layout = layoutPanel(store, p);
      expect(layout.failed).toEqual([]);
      const passes = buildPasses(layout, machine);
      expect(passes.flatMap((q) => q.failed)).toEqual([]);
      expect(checkPasses(layout, passes, machine, 'standard').find((c) => c.id === 'failed')).toBeUndefined();
      expect(runJob({ id: 1, state: 'marked', width: 300, height: 120, machine, area: null, cuts: packCuts(passes) }).maxDepth).toBeGreaterThan(0);
    });
  }
});

describe('a letter that cannot be worked out', () => {
  const has = (c: string) => !!store.alphabet.letter(c)?.contours.length;

  it('in the layout: left as a space, named plainly in the problems with a fix, the rest carries on', () => {
    const broken = Object.create(store, {
      marks: { value: (ch: string, ...rest: unknown[]) => (ch === 'Q' ? (null as unknown as { x: number }).x : (store.marks as (...a: unknown[]) => unknown).call(store, ch, ...rest)) },
    }) as LetterStore;
    const layout = layoutPanel(broken, { ...structuredClone(defaultProject), text: 'OAK\nQUAY', panelWidth: 300, panelHeight: 120 });
    expect(layout.failed).toEqual([{ char: 'Q', line: 1 }]);
    expect(layout.letters.map((l) => l.char).join('')).toBe('OAKUAY');
    const q = layoutProblems(layout, has).find((x) => x.kind === 'letters')!;
    expect(q.text).toBe('“Q” on line 2 could not be worked out, so it is left as a space.');
    expect(q.fixes).toEqual([{ id: 'remove-char:Q', label: 'Take “Q” out of the text' }]);
  });

  it('in the G-code: left out, named plainly, the G-code held back with a fix, the rest still cut', () => {
    const layout = layoutPanel(store, { ...structuredClone(defaultProject), text: 'OAK', machine });
    const K = layout.letters.findIndex((l) => l.char === 'K');
    layout.letters[K] = { ...layout.letters[K], valleys: null as never };
    const passes = buildPasses(layout, machine);
    const slit = passes.find((q) => q.name === 'slit')!;
    expect(slit.failed).toEqual([`K (line 1)#${K}`]);
    expect(slit.cuts.some((c) => c.item.startsWith('O ('))).toBe(true);
    expect(slit.cuts.some((c) => c.item.startsWith('K ('))).toBe(false);
    const check = checkPasses(layout, passes, machine, 'standard').find((c) => c.id === 'failed')!;
    expect(check).toMatchObject({ ok: false, blocking: true, text: 'The cuts for “K” on line 1 could not be worked out, so it is left out of the marking-out.' });
    const problem = machineProblems([check], passDepths(passes), machine, 25)[0];
    expect(problem.fixes).toEqual([{ id: 'remove-char:K', label: 'Take “K” out of the text' }]);
    expect(problem.text).not.toMatch(/Error|undefined|null/);
  });
});
