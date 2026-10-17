import { describe, expect, it } from 'vitest';
import { DEFAULT_ZONES, levelReadout, thicknessText, type Design, type Layer } from '../src/ornament/model';
import { SHAPED_LINE, designSvg, openSvg, sampleTemplate } from '../src/ornament/svgfile';

const layer = (name: string, level: number, extra: Partial<Layer> = {}): Layer => ({
  id: name,
  name,
  shape: { kind: 'zone', zone: 'border' },
  level,
  edge: 'square',
  finish: 'ebony',
  ...extra,
});

describe('ornament: opening a template', () => {
  it('a 204 x 96 field template opens at 204 x 96 with its thickness', () => {
    const o = openSvg(sampleTemplate(204, 96, 6));
    expect(o.kind).toBe('design');
    if (o.kind !== 'design') return;
    expect(o.isTemplate).toBe(true);
    expect(o.design.panel).toMatchObject({ place: 'field', w: 204, h: 96, thickness: 6, width: '204mm', height: '96mm', viewBox: '0 0 204 96' });
    expect(o.design.layers).toEqual([]);
  });

  it('a trapezoid template gives the plain "shaped panels" line', () => {
    const hip = `<svg xmlns="http://www.w3.org/2000/svg" width="204mm" height="30mm" viewBox="0 0 204 30" data-place="hip-front" data-thickness="6">
      <path id="outline" d="M 30 0 L 174 0 L 204 30 L 0 30 Z"/></svg>`;
    const o = openSvg(hip);
    expect(o.kind).toBe('shaped');
    if (o.kind === 'shaped') {
      expect(o.message).toBe(SHAPED_LINE);
      expect(o.panel).toMatchObject({ place: 'hip-front', w: 204, h: 30 });
    }
  });
});

describe('ornament: saving a design', () => {
  it('saving and reopening a design with three layers gives the same layers, levels, edges, finishes and shapes', () => {
    const opened = openSvg(sampleTemplate());
    if (opened.kind !== 'design') throw new Error('template did not open');
    const design: Design = {
      panel: opened.design.panel,
      zones: { ...DEFAULT_ZONES, centreShape: 'rect', centreWidth: 40.25, gapToCentre: 5 },
      layers: [
        layer('Border band', 1, { edge: 'v', finish: 'gold' }),
        layer('Centre', 2, { shape: { kind: 'zone', zone: 'centre' }, finish: 'pearl' }),
        layer('Rosette', 3.5, { shape: { kind: 'ellipse', x: 20.123, y: 30.5, w: 15.257, h: 12 }, finish: 'white-gold', edge: 'v' }),
      ],
    };
    const back = openSvg(designSvg(design));
    expect(back.kind).toBe('design');
    if (back.kind !== 'design') return;
    expect(back.isTemplate).toBe(false);
    expect(back.design.panel).toEqual(design.panel);
    expect(back.design.zones).toEqual(design.zones);
    expect(back.design.layers.length).toBe(3);
    back.design.layers.forEach((l, i) => {
      const was = design.layers[i];
      expect({ name: l.name, level: l.level, edge: l.edge, finish: l.finish, kind: l.shape.kind }).toEqual({
        name: was.name,
        level: was.level,
        edge: was.edge,
        finish: was.finish,
        kind: was.shape.kind,
      });
      if (l.shape.kind === 'zone' && was.shape.kind === 'zone') expect(l.shape.zone).toBe(was.shape.zone);
      if (l.shape.kind === 'ellipse' && was.shape.kind === 'ellipse')
        for (const k of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(l.shape[k] - was.shape[k])).toBeLessThan(0.01);
    });
    // And saved again, the same drawing.
    expect(designSvg(back.design)).toBe(designSvg(design));
  });
});

describe('ornament: level rules', () => {
  it('a step of 0.5 is reported', () => {
    const r = levelReadout([layer('A', 2), layer('B', 2.5)], 6);
    expect(r.problems.map((p) => p.key)).toEqual(['step:A|B']);
    expect(r.problems[0].text).toMatch(/only 0\.5 apart/);
  });

  it('a level deeper than thickness minus 1 is reported', () => {
    const r = levelReadout([layer('A', 1), layer('B', 5.5)], 6);
    expect(r.allowed).toBe(5);
    expect(r.deepest).toBe(5.5);
    expect(r.problems.map((p) => p.key)).toEqual(['deep:B']);
    expect(r.problems[0].text).toMatch(/deeper than allowed/);
  });
});

describe('ornament: a template without a thickness (card 1a)', () => {
  const hipNoThickness = `<svg xmlns="http://www.w3.org/2000/svg" width="204mm" height="30mm" viewBox="0 0 204 30" data-place="hip-front">
    <path id="outline" d="M 0 0 L 204 0 L 204 30 L 0 30 Z"/></svg>`;

  it('opens and shows "Thickness not given: depth limit not checked", and still checks the 1 mm steps', () => {
    const o = openSvg(hipNoThickness);
    expect(o.kind).toBe('design');
    if (o.kind !== 'design') return;
    expect(o.design.panel.thickness).toBeNull();
    expect(thicknessText(o.design.panel)).toBe('Thickness not given: depth limit not checked');
    const r = levelReadout([layer('A', 2), layer('B', 2.5), layer('C', 40)], o.design.panel.thickness);
    expect(r.allowed).toBeNull();
    expect(r.problems.map((p) => p.key)).toEqual(['step:A|B']);
  });
});
