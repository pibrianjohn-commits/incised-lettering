import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { alphabetFromFont } from '../src/alphabet';
import { contentBox, defaultProject, kernKept, layoutPanel, lineNumber, pairKerning, type Project } from '../src/layout';
import { LetterStore } from '../src/letters';
import { BED, bedFit, fitLetteringToPanel, fitToLettering, letteringBox, resizeLettering, shrinkDesignToBed } from '../src/panel';
import { layoutProblems, machineProblems, passDepths } from '../src/problems';
import { buildPasses, checkPasses } from '../src/toolpath';
import { normaliseProject } from '../src/projectfile';
import { remapForEdit } from '../src/remap';
import { fitBlock } from '../src/spacing';

const buf = readFileSync(new URL('../public/fonts/Cinzel-Regular.woff', import.meta.url));
const store = new LetterStore(alphabetFromFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'OFL'));
const proj = (c: Partial<Project> = {}): Project => ({ ...structuredClone(defaultProject), ...c });
const lay = (p: Project) => layoutPanel(store, p);
const apply = (p: Project, change: Partial<Project> | null) => ({ ...p, ...change });

describe('kerning scales with the letters', () => {
  it('a pair kerned −0.6 mm at 25 mm is −1.2 mm at 50 mm', () => {
    const p = proj({ text: 'AV', kerning: { AV: -0.6 } });
    expect(pairKerning(p, 'A', 'V').mm).toBeCloseTo(-0.6, 9);
    expect(pairKerning({ ...p, capHeight: 50 }, 'A', 'V').mm).toBeCloseTo(-1.2, 9);
    expect(kernKept(-1.2, 50)).toBeCloseTo(-0.6, 9);
  });

  it('older saves, kept in mm at their own size, are converted once', () => {
    const old = { text: 'AV', capHeight: 50, kerning: { AV: -1 }, groupKerning: {}, gapKerning: { '0:1': { pair: 'AV', mm: -0.5 } } };
    const p = normaliseProject(old);
    expect(p.kernCap).toBe(25);
    expect(pairKerning(p, 'A', 'V').mm).toBeCloseTo(-1, 6); // the same as before, at the same size
    expect(p.gapKerning['0:1'].mm).toBeCloseTo(-0.25, 6);
    expect(normaliseProject(p)).toEqual(p); // and only once
  });
});

describe('blank lines', () => {
  const text = 'IN\n\nMEMORY';

  it('are not numbered: lettered lines are 1, 2, 3…', () => {
    const l = lay(proj({ text, panelHeight: 120 }));
    expect(l.lines.map((x) => x.number)).toEqual([1, null, 2]);
    expect(lineNumber(l, 2)).toBe(2);
  });

  it('are spacers one line spacing high, as before, until set by hand', () => {
    const p = proj({ text, panelHeight: 140, lineSpacing: 40 });
    const l = lay(p);
    expect(l.lines[2].baselineY - l.lines[0].baselineY).toBeCloseTo(80, 6);
    expect(l.spacers).toHaveLength(1);
    expect(l.spacers[0].height).toBe(40);
    const l2 = lay({ ...p, spacers: { '1': 15 } });
    expect(l2.lines[2].baselineY - l2.lines[0].baselineY).toBeCloseTo(55, 6);
    // The spacer's band runs down to the next line's cap line.
    expect(l2.spacers[0].top + l2.spacers[0].height).toBeCloseTo(l2.lines[2].baselineY - p.capHeight, 6);
    // The block stays centred top to bottom.
    const box = contentBox(p);
    const ink = letteringBox(l2)!;
    expect((ink.y0 + ink.y1) / 2).toBeCloseTo((box.y0 + box.y1) / 2, 6);
  });

  it('keep their height through edits to the lines around them', () => {
    const p = proj({ text, spacers: { '1': 15 } });
    expect(remapForEdit(p, 'IN\n\nMEMORY AND LOVE').spacers).toEqual({ '1': 15 });
    expect(remapForEdit(p, 'TO\nIN\n\nMEMORY').spacers).toEqual({ '2': 15 });
    expect(remapForEdit(p, 'IN\nMEMORY').spacers).toEqual({}); // the blank line taken out
  });

  it('fitting a block keeps a blank line’s own height and opens the line spacing', () => {
    const p = proj({ text: 'A\n\nB\nC', spacers: { '1': 10 }, panelHeight: 200 });
    const r = fitBlock(store, p, 100, 130, 'letter');
    // First cap line to last baseline: 25 + (ls + 10 + ls) = 130 → ls = 47.5
    expect(r.lineSpacing).toBeCloseTo(47.5, 3);
  });
});

describe('fit lettering to panel', () => {
  const p = proj({ text: 'OAK', panelWidth: 150, panelHeight: 60 });
  const box = contentBox(p);

  it('across the width: the lettering runs from margin to margin', () => {
    const q = apply(p, fitLetteringToPanel(lay(p), 'width'));
    const ink = letteringBox(lay(q))!;
    expect(ink.x0).toBeGreaterThanOrEqual(box.x0 - 1e-6);
    expect(ink.x1).toBeLessThanOrEqual(box.x1 + 1e-6);
    expect(ink.x1 - ink.x0).toBeGreaterThan(box.x1 - box.x0 - 0.6); // within the 0.1 mm cap-height rounding
    expect(q.capHeight).toBeGreaterThan(p.capHeight);
  });

  it('up the height, and both ways (as big as fits both)', () => {
    const tall = apply(p, fitLetteringToPanel(lay(p), 'height'));
    expect(tall.capHeight).toBe(40); // 60 less 10 mm margins top and bottom
    const both = apply(p, fitLetteringToPanel(lay(p), 'both'));
    const ink = letteringBox(lay(both))!;
    expect(ink.x0).toBeGreaterThanOrEqual(box.x0 - 1e-6);
    expect(ink.x1).toBeLessThanOrEqual(box.x1 + 1e-6);
    expect(ink.y0).toBeGreaterThanOrEqual(box.y0 - 1e-6);
    expect(ink.y1).toBeLessThanOrEqual(box.y1 + 1e-6);
  });

  it('shrinks lettering that runs off the board, and scales the spacing and placed lines with it', () => {
    const big = proj({ text: 'IN MEMORIAM\nOAK', capHeight: 30, letterSpacing: 1, lineSpacing: 45, panelWidth: 150, panelHeight: 100, lines: { '1': { x: 75, align: 'centre', baseline: 90 } }, kerning: { AV: -0.6 } });
    const q = apply(big, fitLetteringToPanel(lay(big), 'both'));
    const s = q.capHeight! / big.capHeight;
    expect(s).toBeLessThan(1);
    expect(q.letterSpacing).toBeCloseTo(1 * s, 3);
    expect(q.lineSpacing).toBeCloseTo(45 * s, 3);
    const l = lay(q);
    const b = contentBox(q);
    for (const t of l.letters) {
      expect(t.box.x0).toBeGreaterThanOrEqual(b.x0 - 0.5);
      expect(t.box.x1).toBeLessThanOrEqual(b.x1 + 0.5);
    }
    expect(l.overflow).toEqual({ wide: false, tall: false });
    expect(q.kerning).toEqual(big.kerning); // kept the same: it scales with the letters by itself
  });

  it('does nothing with no lettering, or no room', () => {
    expect(fitLetteringToPanel(lay(proj({ text: '' })), 'both')).toBeNull();
    expect(fitLetteringToPanel(lay(proj({ panelWidth: 15 })), 'both')).toBeNull();
  });
});

describe('fit panel to lettering', () => {
  it('counts a blank line at the end as space asked for, so nothing then runs past a margin', () => {
    const p = proj({ text: 'OAK\n', capHeight: 20 });
    const f = fitToLettering(lay(p))!;
    expect(f.height).toBeCloseTo(20 + 40 + 20, 6); // cap height, one line spacing for the blank line, margins
    const q = { ...p, panelWidth: f.width, panelHeight: f.height };
    expect(lay(q).overflow).toEqual({ wide: false, tall: false });
  });
});

describe('problems and their fixes', () => {
  const has = (ch: string) => !!store.alphabet.letter(ch)?.contours.length;
  const edges = (p: Project) => layoutProblems(lay(p), has).filter((q) => q.kind === 'edges');

  it('lettering past the top and bottom margins: one problem, fixed by fitting either way', () => {
    const p = proj({ text: 'IN\nMEMORY', capHeight: 20, lineSpacing: 30, panelWidth: 200, panelHeight: 60 });
    const list = edges(p);
    expect(list.map((q) => q.text)).toEqual(['Lines 1 and 2 run past the top and bottom margins, by up to 5.0 mm.']);
    const ids = list[0].fixes.map((f) => f.id);
    expect(ids).toEqual(['fit-lettering', 'fit-panel']);
    expect(edges(apply(p, fitLetteringToPanel(lay(p), 'both')))).toEqual([]);
    const f = fitToLettering(lay(p))!;
    expect(edges({ ...p, panelWidth: f.width, panelHeight: f.height })).toEqual([]);
  });

  it('a line placed off the board: move it in, return it to auto, or fit the panel', () => {
    const p = proj({ text: 'IN\nOAK', capHeight: 12, lineSpacing: 20, panelWidth: 150, panelHeight: 60, lines: { '1': { x: 150, align: 'centre', baseline: 45 } } });
    const list = edges(p);
    expect(list).toHaveLength(1);
    expect(list[0].level).toBe('bad');
    expect(list[0].text).toMatch(/^Line 2 runs off the board at the right by \d+\.\d mm\.$/);
    expect(list[0].fixes.map((f) => f.id)).toEqual(['inside-line:1', 'auto-line:1', 'fit-panel']);
    expect(edges({ ...p, lines: {} })).toEqual([]);
  });

  it('lines that run into each other: open the line spacing just enough', () => {
    const p = proj({ text: 'MOON\nMOON', capHeight: 20, lineSpacing: 15, panelWidth: 200, panelHeight: 100 });
    const q = layoutProblems(lay(p), has).find((x) => x.kind === 'lines')!;
    const fix = q.fixes.find((f) => f.id.startsWith('line-spacing:'))!;
    const ls = Number(fix.id.split(':')[1]);
    expect(ls).toBeGreaterThan(15);
    expect(layoutProblems(lay({ ...p, lineSpacing: ls }), has).some((x) => x.kind === 'lines')).toBe(false);
  });

  it('small letters with an alphabet of capitals only: offered as capitals', () => {
    const caps = (ch: string) => /[A-Z]/.test(ch);
    const q = layoutProblems(lay(proj({ text: 'Oak' })), caps).find((x) => x.kind === 'letters')!;
    expect(q.fixes.map((f) => f.id)).toEqual(['caps', 'remove-missing']);
  });

  it('a panel too big for the machine: everything shrinks evenly to fit the bed', () => {
    const p = proj({ text: 'OAK', capHeight: 100, panelWidth: 600, panelHeight: 240, margins: { top: 20, right: 40, bottom: 20, left: 40 } });
    const q = layoutProblems(lay(p), has).find((x) => x.kind === 'bed')!;
    expect(q.level).toBe('bad');
    expect(q.fixes.map((f) => f.id)).toEqual(['bed-extended', 'bed-standard']);
    const s = apply(p, shrinkDesignToBed(p, BED));
    expect(bedFit(s.panelWidth, s.panelHeight)).toBe('standard');
    expect(s.panelWidth).toBe(300);
    expect(s.margins).toEqual({ top: 10, right: 20, bottom: 10, left: 20 });
    expect(s.capHeight).toBe(50);
    expect(edges(s)).toEqual([]);
  });

  it('a cut too deep for the stock: smaller letters by just enough', () => {
    const p = proj({ text: 'OAK', capHeight: 60, panelWidth: 290, panelHeight: 100, machine: { ...defaultProject.machine, stockThickness: 6 } });
    const check = (q: Project) => {
      const l = layoutPanel(store, q);
      const passes = buildPasses(l, q.machine);
      return { checks: checkPasses(l, passes, q.machine, 'standard'), depths: passDepths(passes) };
    };
    const { checks, depths } = check(p);
    const problem = machineProblems(checks, depths, p.machine, p.capHeight).find((x) => x.text.startsWith('Deepest cut'))!;
    const fix = problem.fixes.find((f) => f.id.startsWith('cap-height:'))!;
    const cap = Number(fix.id.split(':')[1]);
    expect(cap).toBeLessThan(60);
    const q = apply(p, resizeLettering(lay(p), cap));
    expect(check(q).checks.find((c) => c.id === 'floor')!.ok).toBe(true);
    // and not much smaller than it need be
    expect(check({ ...q, ...resizeLettering(lay(q), cap + 0.5) }).checks.find((c) => c.id === 'floor')!.ok).toBe(false);
  });
});
