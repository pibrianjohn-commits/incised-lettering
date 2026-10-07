import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { alphabetFromFont } from '../src/alphabet';
import { benchSheet, scaleName, sheetScale, strokeLabels } from '../src/benchsheet';
import { defaultProject, layoutPanel, type Project } from '../src/layout';
import { LetterStore } from '../src/letters';
import { bedFit } from '../src/panel';
import { buildPasses, checkPasses, defaultMachine, isFork } from '../src/toolpath';

const buf = readFileSync(new URL('../public/fonts/Cinzel-Regular.woff', import.meta.url));
const store = new LetterStore(alphabetFromFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'OFL'));
const machine = { ...defaultMachine, stockThickness: 20 };
const lay = (c: Partial<Project> = {}) => layoutPanel(store, { ...defaultProject, machine, ...c });

describe('stroke numbers', () => {
  const l = lay({ text: 'IODBRSAW', panelWidth: 300 });
  const slit = buildPasses(l, machine).find((p) => p.name === 'slit')!;
  const labels = strokeLabels(slit);
  const count = (ch: string) => labels.filter((t) => t.item.startsWith(`${ch} `)).length;

  it('one number for each stroke as the carver counts it, none for the forks', () => {
    for (const [ch, n] of Object.entries({ I: 1, O: 1, D: 2, B: 3, R: 3, S: 1, A: 3, W: 4 })) expect(count(ch), ch).toBe(n);
    // Every fork is still cut by the machine; it just carries no number of its own.
    expect(slit.cuts.filter((c) => c.item.startsWith('I ')).length).toBeGreaterThan(1);
  });

  it('start at 1 in every letter and follow the cutting order, thin first', () => {
    for (const ch of 'IODBRSAW') {
      const own = labels.filter((t) => t.item.startsWith(`${ch} `));
      expect(own.map((t) => t.n).sort((a, b) => a - b)).toEqual(own.map((_, i) => i + 1));
      const width = (n: number) => own.find((t) => t.n === n)!.cuts[0].width!;
      for (let n = 2; n <= own.length; n++) expect(width(n)).toBeGreaterThanOrEqual(width(n - 1) * 0.97);
    }
  });

  it('a stroke tapering to a point is still a stroke; a short branch to a corner is a fork', () => {
    const taper = Array.from({ length: 21 }, (_, i) => ({ x: i, y: 0, r: 1.5 * (1 - i / 20) + 0.01 }));
    expect(isFork(taper)).toBe(false); // 20 mm long, 3 mm wide at most
    const branch = Array.from({ length: 5 }, (_, i) => ({ x: i, y: i, r: 1.4 * (1 - i / 4) + 0.1 }));
    expect(isFork(branch)).toBe(true); // under 6 mm long, narrowing to a point
  });
});

describe('bench sheet', () => {
  const p: Project = { ...defaultProject, machine, text: 'OAK' };
  const l = layoutPanel(store, p);
  const passes = buildPasses(l, machine);
  const sheet = benchSheet({
    project: p,
    layout: l,
    strokes: passes.find((q) => q.name === 'slit')!,
    passes,
    checks: checkPasses(l, passes, machine, bedFit(p.panelWidth, p.panelHeight)),
    alphabet: 'Cinzel Regular',
    fileName: 'OAK.lettering',
    date: new Date('2026-10-07T12:00:00Z'),
  });

  it('a small panel is drawn full size, on a landscape page', () => {
    expect(sheet.scale).toBe(1);
    expect(sheet.orientation).toBe('landscape');
    expect(sheet.html).toContain('width="168.00mm"'); // 150 mm panel plus 9 mm each side, at 1 : 1
  });

  it('larger panels step down to a plain scale', () => {
    expect(sheetScale(300, 200, { w: 273, h: 146 })).toBe(0.5);
    expect(scaleName(1)).toBe('full size (1 : 1)');
    expect(scaleName(0.5)).toBe('1 : 2');
    expect(scaleName(0.75)).toBe('1 : 1.33');
  });

  it('has the drawing with stroke numbers, the cutting order and the settings used', () => {
    expect(sheet.html).toContain('<svg class="sheet-drawing"');
    expect((sheet.html.match(/class="sheet-num"/g) ?? []).length).toBe(strokeLabels(passes[2]).length);
    expect(sheet.html).toContain('Cutting order');
    expect(sheet.html).toContain('1. <b>O</b> <small>line 1</small>');
    for (const s of ['Cap height', '25 mm', 'Chisel angle', '60°', '20 mm thick, safe floor 3 mm', 'front left corner', '12000 rpm, set by hand'])
      expect(sheet.html).toContain(s);
    expect(sheet.html).toContain('OAK.lettering');
  });
});
