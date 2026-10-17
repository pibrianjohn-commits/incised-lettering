import { describe, expect, it } from 'vitest';
import { DEFAULT_ZONES, levelReadout, thicknessText, type Design, type Layer } from '../src/ornament/model';
import { SHAPED_LINE, designSvg, openSvg, sampleTemplate } from '../src/ornament/svgfile';
import { NO_PLAN_DEPTH, apply, edgeMismatches, fromAboveReady, keepLid, keptLid, lastSavedText, lidLayout, openLid, openLidPicked, saveLidSet } from '../src/ornament/lid';
import { readZip } from '../src/ornament/zip';

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
const memStore = () => {
  const kept = new Map<string, string>();
  return { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k) };
};
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
      expect(o.message).toMatch(/Nothing was opened/);
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

  it('Save lid design writes the places with layers, and they open again exactly as they were', () => {
    // A rectangular left hip, so a hip can carry layers too; the right hip has none.
    const files = lidFiles().map((f) =>
      f.name === 'hip-left.svg' ? { ...f, text: rectSvg('hip-left', 96, 30) } : f.name === 'hip-right.svg' ? { ...f, text: rectSvg('hip-right', 96, 30) } : f,
    );
    const o = openLid(files);
    if (o.kind !== 'lid') throw new Error('lid did not open');
    const lid = o.lid;
    lid.places.field!.design!.layers = [layer('Border band', 1, { finish: 'gold' }), layer('Centre', 2, { shape: { kind: 'zone', zone: 'centre' } })];
    lid.places['hip-left']!.design!.layers = [layer('Leaf', 1.5, { shape: { kind: 'rect', x: 10, y: 5, w: 20, h: 10 }, edge: 'v', finish: 'boxwood' })];
    const out = saveLidSet(memStore(), lid)!.files;
    expect(out.map((f) => f.place)).toEqual(['field', 'hip-left']);
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
  });
});

/** Every place rectangular, so every place can carry a layer. */
const rectLid = (lidName?: string) => {
  const files = [
    { name: 'field.svg', text: sampleTemplate(204, 96, 6) },
    { name: 'hip-front.svg', text: rectSvg('hip-front', 204, 30) },
    { name: 'hip-right.svg', text: rectSvg('hip-right', 96, 30) },
    { name: 'hip-back.svg', text: rectSvg('hip-back', 204, 30) },
    { name: 'hip-left.svg', text: rectSvg('hip-left', 96, 30) },
  ].map((f) => (lidName ? { ...f, text: f.text.replace('<svg ', `<svg data-lid="${lidName}" `) } : f));
  const o = openLid(files);
  if (o.kind !== 'lid') throw new Error('lid did not open');
  for (const p of PLACE_ORDER) o.lid.places[p]!.design!.layers = [layer('Band', 1)];
  return o.lid;
};
const PLACE_ORDER = ['field', 'hip-front', 'hip-right', 'hip-back', 'hip-left'] as const;

describe('ornament: numbered design sets (card 4)', () => {
  it('two saves give 001 then 002, all five places named', () => {
    const lid = rectLid('walnut-box');
    const store = memStore();
    const first = saveLidSet(store, lid)!;
    const second = saveLidSet(store, lid)!;
    expect(first.number).toBe(1);
    expect(first.files.map((f) => f.name)).toEqual(PLACE_ORDER.map((p) => `walnut-box_001_${p}.svg`));
    expect(second.files.map((f) => f.name)).toEqual(PLACE_ORDER.map((p) => `walnut-box_002_${p}.svg`));
    expect(second.name).toBe('walnut-box_002.zip');
    expect(lastSavedText(store, lid)).toBe('Last saved: walnut-box 002');
  });

  it('templates without data-lid save as lid_001_<place>.svg', () => {
    expect(saveLidSet(memStore(), rectLid())!.files.map((f) => f.name)).toEqual(PLACE_ORDER.map((p) => `lid_001_${p}.svg`));
  });
});

describe('ornament: save fixes (card 4a)', () => {
  const fieldOnly = () => {
    const o = openLid(lidFiles().map((f) => ({ ...f, text: f.text.replace('<svg ', '<svg data-lid="walnut-box" ') })));
    if (o.kind !== 'lid') throw new Error('lid did not open');
    o.lid.places.field!.design!.layers = [layer('Border band', 1, { finish: 'gold' }), layer('Rosette', 2, { shape: { kind: 'ellipse', x: 80, y: 30, w: 40, h: 36 }, finish: 'pearl' })];
    return o.lid;
  };

  it('a lid with layers on the field only saves a zip holding only the field file', async () => {
    const set = saveLidSet(memStore(), fieldOnly())!;
    expect(set.name).toBe('walnut-box_001.zip');
    const inside = await readZip(set.zip);
    expect(inside!.map((f) => f.name)).toEqual(['walnut-box_001_field.svg']);
    expect(inside![0].text).toBe(set.files[0].text);
  });

  it('a saved zip opens back with Open lid… exactly as it was', async () => {
    const lid = fieldOnly();
    const set = saveLidSet(memStore(), lid)!;
    // The layers change after saving; opening the set brings back the saved ones.
    const now = structuredClone(lid);
    now.places.field!.design!.layers = [];
    const back = await openLidPicked([{ name: set.name, bytes: set.zip }], now);
    expect(back.kind).toBe('lid');
    if (back.kind !== 'lid') return;
    expect(designSvg(back.lid.places.field!.design!)).toBe(designSvg(lid.places.field!.design!));
    for (const p of ['hip-front', 'hip-right', 'hip-back', 'hip-left'] as const) expect(back.lid.places[p]!.shaped!.text).toBe(lid.places[p]!.shaped!.text);
    expect(lidLayout(back.lid)).toEqual(lidLayout(lid));
    // Picked together with the lid's templates, with no lid open, it opens the same.
    const withTemplates = await openLidPicked([...lidFiles().map((f) => ({ name: f.name, bytes: new TextEncoder().encode(f.text.replace('<svg ', '<svg data-lid="walnut-box" ')) })), { name: set.name, bytes: set.zip }]);
    expect(withTemplates.kind).toBe('lid');
    if (withTemplates.kind === 'lid') expect(designSvg(withTemplates.lid.places.field!.design!)).toBe(designSvg(lid.places.field!.design!));
  });

  it('a pearl V layer and a pearl level-0 layer each show their stop', () => {
    const groove = layer('Pearl leaf', 2, { finish: 'pearl', edge: 'v' });
    const top = layer('Pearl dot', 0, { finish: 'pearl' });
    const r = levelReadout([layer('Band', 1), groove, top], 6);
    expect(r.problems.find((p) => p.key === `groove:${groove.id}`)!.text).toBe('“Pearl leaf”: Pearl and boxwood never go in a groove');
    expect(r.problems.find((p) => p.key === `seat:${top.id}`)!.text).toBe('“Pearl dot”: Pearl and boxwood need a seat: give the layer a level of 1 or more');
    // Each one-click fix cures its stop.
    for (const p of r.problems) for (const f of p.fixes) expect(levelReadout(f.apply([layer('Band', 1), groove, top]), 6).problems.map((q) => q.key)).not.toContain(p.key);
  });
});

describe('ornament: hip edge tolerance (card 2a)', () => {
  const withFront = (top: number) => openLid(lidFiles().map((f) => (f.name === 'hip-front.svg' ? { ...f, text: hipSvg('hip-front', top, 264, 30) } : f)));
  it('a 204.2 hip top against a 204 field edge opens with no note; a 206 one shows it', () => {
    const close = withFront(204.2);
    if (close.kind !== 'lid') throw new Error('lid did not open');
    expect(edgeMismatches(close.lid)).toEqual([]);
    const far = withFront(206);
    if (far.kind !== 'lid') throw new Error('lid did not open');
    expect(edgeMismatches(far.lid)).toEqual([expect.stringMatching(/front hip’s top edge is 206 long.*field edge it meets is 204.*may be from different lids/)]);
  });
});

// ---------------------------------------------------------------- card 3: From above

describe('ornament: the From above view (card 3)', () => {
  // Hips sloping at 40 deg, 32 deep seen from above: so 32 / cos 40 wide laid flat, and their feet 2 × 32 longer than their tops.
  const slant = 32 / Math.cos((40 * Math.PI) / 180);
  const pd = ' data-slope="40" data-plan-depth="32"';
  const aboveFiles = () => [
    { name: 'field.svg', text: sampleTemplate(204, 96, 6) },
    { name: 'hip-front.svg', text: hipSvg('hip-front', 204, 268, slant, pd) },
    { name: 'hip-right.svg', text: hipSvg('hip-right', 96, 160, slant, pd) },
    { name: 'hip-back.svg', text: hipSvg('hip-back', 204, 268, slant, pd) },
    { name: 'hip-left.svg', text: hipSvg('hip-left', 96, 160, slant, pd) },
  ];

  it('hips with data-plan-depth 32 draw 32 deep, and the corner lines meet within 0.01', () => {
    const o = openLid(aboveFiles());
    expect(o.kind).toBe('lid');
    if (o.kind !== 'lid') return;
    expect(o.lid.places['hip-front']!.shaped!.panel).toMatchObject({ slope: 40, planDepth: 32 });
    expect(fromAboveReady(o.lid).ok).toBe(true);
    const m = lidLayout(o.lid, 'above');
    // Each hip's ends, from its top edge to its foot, in lid mm: [left top, left foot, right top, right foot] as seen from outside.
    const ends = (place: 'hip-front' | 'hip-back' | 'hip-left' | 'hip-right', top: number, foot: number) => {
      const inset = (foot - top) / 2;
      return [apply(m[place]!, [inset, 0]), apply(m[place]!, [0, slant]), apply(m[place]!, [inset + top, 0]), apply(m[place]!, [foot, slant])];
    };
    const front = ends('hip-front', 204, 268);
    const back = ends('hip-back', 204, 268);
    const left = ends('hip-left', 96, 160);
    const right = ends('hip-right', 96, 160);
    // 32 deep, against the field edge with no gap: the front from 96 to 128, the back from 0 to -32, the left from 0 to -32, the right from 204 to 236.
    near(front.flat(), [0, 96, -32, 128, 204, 96, 236, 128]);
    near(back.flat(), [204, 0, 236, -32, 0, 0, -32, -32]);
    near(left.flat(), [0, 0, -32, -32, 0, 96, -32, 128]);
    near(right.flat(), [204, 96, 236, 128, 204, 0, 236, -32]);
    // Neighbouring hips meet on the corner lines: the front's right end is the right hip's left end, and so round.
    near([...front[2], ...front[3]], [...right[0], ...right[1]]);
    near([...right[2], ...right[3]], [...back[0], ...back[1]]);
    near([...back[2], ...back[3]], [...left[0], ...left[1]]);
    near([...left[2], ...left[3]], [...front[0], ...front[1]]);
    // Flat is as it was: 10 clear, the full width laid flat.
    near(apply(lidLayout(o.lid)['hip-front']!, [0, slant]), [-32, 96 + 10 + slant]);
  });

  it('a hip without data-plan-depth gives the plain line and stays on Flat', () => {
    const o = openLid(aboveFiles().map((f) => (f.name === 'hip-left.svg' ? { ...f, text: hipSvg('hip-left', 96, 160, slant) } : f)));
    expect(o.kind).toBe('lid');
    if (o.kind !== 'lid') return;
    expect(fromAboveReady(o.lid)).toEqual({ ok: false, message: NO_PLAN_DEPTH });
    expect(NO_PLAN_DEPTH).toBe('Export the templates again from Blender to see this view');
    expect(lidLayout(o.lid, 'above')).toEqual(lidLayout(o.lid, 'flat'));
  });
});
