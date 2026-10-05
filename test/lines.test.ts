import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { alphabetFromFont } from '../src/alphabet';
import { defaultProject, layoutPanel, type Project } from '../src/layout';
import { LetterStore } from '../src/letters';
import { nearest, snapTargets } from '../src/snap';

const buf = readFileSync(new URL('../public/fonts/Cinzel-Regular.woff', import.meta.url));
const store = new LetterStore(alphabetFromFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'OFL'));
const lay = (change: Partial<Project> = {}) =>
  layoutPanel(store, { ...defaultProject, text: 'ONE\nTWO\nTHREE', panelHeight: 150, ...change });

describe('lines', () => {
  it('a placed line stays put when line spacing and alignment change; auto lines follow', () => {
    const lines = { '1': { x: 40, align: 'left' as const, baseline: 70 } };
    const a = lay({ lines, lineSpacing: 40 });
    const b = lay({ lines, lineSpacing: 30, align: 'right' });
    expect(b.lines[1].baselineY).toBe(70);
    expect(b.lines[1].x0).toBe(40);
    expect(a.lines[1].placed).toBe(true);
    expect(b.lines[0].baselineY).not.toBe(a.lines[0].baselineY); // auto line follows the slider
  });

  it('a centre-anchored line stays centred on its anchor when its text changes', () => {
    const lines = { '0': { x: 75, align: 'centre' as const, baseline: 40 } };
    for (const text of ['ONE', 'ONE MORE']) {
      const l = lay({ text, lines }).lines[0];
      expect(l.x0 + l.width / 2).toBeCloseTo(75, 6);
    }
  });

  it('kerning inside a moved line is unchanged', () => {
    const lines = { '0': { x: 20, align: 'left' as const, baseline: 40 } };
    const kerning = { NE: -0.7 };
    const gaps = (c: Partial<Project>) => lay({ kerning, ...c }).letters.filter((l) => l.line === 0).map((l) => l.box.x0);
    const rel = (xs: number[]) => xs.map((x) => x - xs[0]);
    expect(rel(gaps({ lines }))).toEqual(rel(gaps({})).map((x) => expect.closeTo(x, 9)));
  });

  it('snaps a line centre to the panel centre and a baseline to another line', () => {
    const l = lay({ align: 'left' }); // other lines away from the centre
    const t = snapTargets(l, 1);
    const s = nearest([{ f: 'centre', at: 74.2 }], t.x, 1);
    expect(s?.target.label).toBe('panel centre');
    expect(s?.offset).toBeCloseTo(0.8, 6);
    const base0 = l.lines[0].baselineY;
    const y = nearest([{ f: 'base', at: base0 + 0.5 }], t.y, 1);
    expect(y?.target.label).toBe('line 1 baseline');
  });

  it('offers equal spacing above and below other lines', () => {
    const l = lay({ lineSpacing: 30 });
    const t = snapTargets(l, 2);
    const want = l.lines[1].baselineY + 30;
    const y = nearest([{ f: 'base', at: want + 0.4 }], t.y, 1);
    expect(y?.offset).toBeCloseTo(-0.4, 6);
    expect(['equal spacing', 'line 3 baseline']).toContain(y?.target.label);
  });

  it('snaps to ruler guides', () => {
    const l = lay({ guides: { x: [3], y: [] } }); // near the panel edge, clear of everything else
    const s = nearest([{ f: 'left', at: 3.5 }], snapTargets(l, 0).x, 1);
    expect(s?.target.label).toBe('guide');
  });

  it('nothing in range means no snap', () => {
    expect(nearest([{ f: 'left', at: 1000 }], snapTargets(lay(), 0).x, 1)).toBeNull();
  });
});
