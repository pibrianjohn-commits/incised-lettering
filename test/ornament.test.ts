import { describe, expect, it } from 'vitest';
import { DEFAULT_ZONES, levelReadout, thicknessText, type Design, type Layer } from '../src/ornament/model';
import { SHAPED_LINE, designSvg, openSvg, sampleTemplate } from '../src/ornament/svgfile';
import { apply, keepLid, keptLid, lidDesignFiles, lidLayout, openLid } from '../src/ornament/lid';

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

// ---------------------------------------------------------------- card 2: the whole lid

const hipSvg = (place: string, top: number, foot: number, h: number, extra = '') => {
  const inset = (foot - top) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${foot}mm" height="${h}mm" viewBox="0 0 ${foot} ${h}" data-place="${place}"${extra}>
  <path id="outline" d="M ${inset} 0 L ${inset + top} 0 L ${foot} ${h} L 0 ${h} Z"/></svg>`;
};
const rectSvg = (place: string, w: number, h: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" data-place="${place}">
  <path id="outline" d="M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z"/></svg>`;
const lidFiles = () => [
  { name: 'field.svg', text: sampleTemplate(204, 96, 6) },
  { name: 'hip-front.svg', text: hipSvg('hip-front', 204, 264, 30) },
  { name: 'hip-right.svg', text: hipSvg('hip-right', 96, 156, 30) },
  { name: 'hip-back.svg', text: hipSvg('hip-back', 204, 264, 30) },
  { name: 'hip-left.svg', text: hipSvg('hip-left', 96, 156, 30) },
];
const near = (a: number[], b: number[]) => a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(0.01));

describe('ornament: the whole lid', () => {
  it('five templates open into the layout, each hip’s top edge along its field edge, 10 clear', () => {
    const o = openLid(lidFiles());
    expect(o.kind).toBe('lid');
    if (o.kind !== 'lid') return;
    expect(o.lid.whole).toBe(true);
    expect(Object.keys(o.lid.places).sort()).toEqual(['field', 'hip-back', 'hip-front', 'hip-left', 'hip-right']);
    expect(o.lid.places.field?.design?.panel).toMatchObject({ w: 204, h: 96 });
    const m = lidLayout(o.lid);
    near(apply(m.field!, [0, 0]), [0, 0]);
    // Each hip's top edge, from its left end to its right end as seen from outside, then a point on its foot.
    const top = (place: 'hip-front' | 'hip-back', inset = 30) => [apply(m[place]!, [inset, 0]), apply(m[place]!, [inset + 204, 0]), apply(m[place]!, [0, 30])];
    const side = (place: 'hip-left' | 'hip-right') => [apply(m[place]!, [30, 0]), apply(m[place]!, [126, 0]), apply(m[place]!, [0, 30])];
    // Front: along the field's front edge (y = 96), 10 below; left end under the front-left corner; foot further out.
    const [fl, fr, ff] = top('hip-front');
    near(fl, [0, 106]);
    near(fr, [204, 106]);
    expect(ff[1]).toBeGreaterThan(106);
    // Back: along the back edge (y = 0), 10 above; seen from behind its left is the field's right.
    const [bl, br, bf] = top('hip-back');
    near(bl, [204, -10]);
    near(br, [0, -10]);
    expect(bf[1]).toBeLessThan(-10);
    // Left: along the left edge (x = 0), 10 clear; seen from the left its left is the back.
    const [ll, lr, lf] = side('hip-left');
    near(ll, [-10, 0]);
    near(lr, [-10, 96]);
    expect(lf[0]).toBeLessThan(-10);
    // Right: along the right edge (x = 204), 10 clear; seen from the right its left is the front.
    const [rl, rr, rf] = side('hip-right');
    near(rl, [214, 96]);
    near(rr, [214, 0]);
    expect(rf[0]).toBeGreaterThan(214);
  });

  it('a set with one file missing names it and opens nothing', () => {
    const o = openLid(lidFiles().filter((f) => f.name !== 'hip-back.svg'));
    expect(o.kind).toBe('error');
    if (o.kind === 'error') {
      expect(o.message).toMatch(/Missing: the back hip\./);
      expect(o.message).toMatch(/nothing was opened/);
    }
    const twice = openLid([...lidFiles(), { name: 'hip-left copy.svg', text: hipSvg('hip-left', 96, 156, 30) }]);
    expect(twice.kind).toBe('error');
    if (twice.kind === 'error') expect(twice.message).toMatch(/Two files are the left hip: “hip-left.svg” and “hip-left copy.svg”/);
  });

  it('after a reload the same lid comes back with its layers', () => {
    const o = openLid(lidFiles());
    if (o.kind !== 'lid') throw new Error('lid did not open');
    const lid = o.lid;
    lid.places.field!.design!.layers = [
      layer('Border band', 1, { edge: 'v', finish: 'gold' }),
      layer('Rosette', 2, { shape: { kind: 'ellipse', x: 20, y: 30, w: 15, h: 12 }, finish: 'pearl' }),
    ];
    lid.current = 'hip-right';
    const kept = new Map<string, string>();
    const store = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k) };
    keepLid(store, lid, { field: 'saved earlier' });
    const back = keptLid(store);
    expect(back).not.toBeNull();
    expect(back!.lid.whole).toBe(true);
    expect(back!.lid.current).toBe('hip-right');
    expect(back!.savedAs).toEqual({ field: 'saved earlier' });
    expect(designSvg(back!.lid.places.field!.design!)).toBe(designSvg(lid.places.field!.design!));
    expect(back!.lid.places.field!.design!.layers.map((l) => [l.name, l.level, l.finish])).toEqual([
      ['Border band', 1, 'gold'],
      ['Rosette', 2, 'pearl'],
    ]);
    for (const p of ['hip-front', 'hip-right', 'hip-back', 'hip-left'] as const) expect(back!.lid.places[p]!.shaped!.text).toBe(lid.places[p]!.shaped!.text);
    expect(lidLayout(back!.lid)).toEqual(lidLayout(lid));
  });

  it('Save lid design writes one file per place with layers, and they open again exactly as they were', () => {
    // A rectangular left hip, so a hip can carry layers too; the right hip has none.
    const files = lidFiles().map((f) =>
      f.name === 'hip-left.svg' ? { ...f, text: rectSvg('hip-left', 96, 30) } : f.name === 'hip-right.svg' ? { ...f, text: rectSvg('hip-right', 96, 30) } : f,
    );
    const o = openLid(files);
    if (o.kind !== 'lid') throw new Error('lid did not open');
    const lid = o.lid;
    lid.places.field!.design!.layers = [layer('Border band', 1, { finish: 'gold' }), layer('Centre', 2, { shape: { kind: 'zone', zone: 'centre' } })];
    lid.places['hip-left']!.design!.layers = [layer('Leaf', 1.5, { shape: { kind: 'rect', x: 10, y: 5, w: 20, h: 10 }, edge: 'v', finish: 'boxwood' })];
    const out = lidDesignFiles(lid);
    expect(out.map((f) => f.name)).toEqual(['field-design.svg', 'hip-left-design.svg']);
    for (const f of out) {
      const again = openSvg(f.text);
      expect(again.kind).toBe('design');
      if (again.kind !== 'design') continue;
      const was = lid.places[f.place]!.design!;
      expect(again.design.panel).toEqual(was.panel);
      expect(again.design.zones).toEqual(was.zones);
      expect(again.design.layers.map(({ id: _, ...l }) => l)).toEqual(was.layers.map(({ id: _, ...l }) => l));
      expect(designSvg(again.design)).toBe(f.text);
    }
    // And all five open again as the lid, the field and left hip with their layers.
    const reopened = openLid(files.map((f) => out.find((x) => x.name === f.name.replace('.svg', '-design.svg')) ?? f));
    expect(reopened.kind).toBe('lid');
    if (reopened.kind === 'lid') expect(lidDesignFiles(reopened.lid).map((f) => f.text)).toEqual(out.map((f) => f.text));
  });
});
