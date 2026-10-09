// The setting-out lines (BRIEF.md, Decisions: "The setting-out lines").

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { alphabetFromFont, measureHeights, type LetterShape } from '../src/alphabet';
import { benchSheet } from '../src/benchsheet';
import { History } from '../src/history';
import { lineStats } from '../src/inspect';
import { lineListHtml } from '../src/inspector';
import { defaultProject, layoutPanel, type Layout, type Project } from '../src/layout';
import { LetterStore } from '../src/letters';
import { bedFit } from '../src/panel';
import { lineSets, panelCentre, placeLabels, setLabel, type LineSet, type SetKind } from '../src/settingout';
import { SHORTCUTS } from '../src/shortcuts';
import { nearest, nearestTo, pointTargets, snapTargets } from '../src/snap';
import { buildPasses, checkPasses, defaultMachine } from '../src/toolpath';
import { LAYERS, PRESETS, SETTING_OUT, STAGE_VIEWS, viewsFromBefore } from '../src/views';

const buf = readFileSync(new URL('../public/fonts/Cinzel-Regular.woff', import.meta.url));
const font = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const alphabet = alphabetFromFont(font, 'OFL');
const store = new LetterStore(alphabet);
const h = alphabet.heights;
const lay = (c: Partial<Project> = {}) => layoutPanel(store, { ...defaultProject, ...c });
const kinds = (set: LineSet) => set.lines.map((l) => l.kind);
const within = (a: number, b: number, tol = 0.005) => expect(Math.abs(a - b), `${a} against ${b}`).toBeLessThanOrEqual(tol);

// The carver's layout (test/collisions.test.ts).
const BRIAN: Partial<Project> = {
  text: 'AMBER IS....\n\nJUST\n\nAMAZBALLS',
  capHeight: 31.5,
  letterSpacing: -0.5,
  lineSpacing: 20,
  panelWidth: 300,
  panelHeight: 200,
  lines: { '2': { x: 130, align: 'centre', baseline: 114.8 }, '4': { x: 150, align: 'centre', baseline: 154.9 } },
};

describe('the alphabet measures its heights from its own letters', () => {
  it('Cinzel: small capitals 0.857 of the cap height, Q 0.341 below and J 0.286, O 0.02 past the lines', () => {
    within(h.xHeight!, 0.857); // 21.43 mm at 25 mm
    within(h.xHeight! * 25, 21.43, 0.01);
    within(h.descent('Q'), 0.341);
    within(h.descent('J'), 0.286);
    within(h.overshoot, 0.02); // 0.5 mm at 25 mm
    within(h.overshoot * 25, 0.5, 0.01);
  });

  it('Cinzel: no lowercase letter stands above the cap line, nor above its small capitals', () => {
    expect(h.ascender).not.toBeNull();
    expect(h.ascender!).toBeLessThanOrEqual(1);
    within(h.ascender!, h.xHeight!); // b d h k l are small capitals too
  });

  it('not from the font’s own metrics table, which says the x-height is 500/700', () => {
    expect(Math.abs(h.xHeight! - 500 / 700)).toBeGreaterThan(0.1);
  });

  it('a flat foot has no descent, a pointed one dips only by the overshoot, and a letter not in the alphabet has none', () => {
    for (const c of 'HEL') expect(h.descent(c), c).toBe(0);
    for (const c of 'MVW') expect(h.descent(c), c).toBeLessThanOrEqual(h.overshoot + 1e-9);
    expect(h.descent('一')).toBe(0);
  });
});

describe('each line’s setting-out lines', () => {
  it('a line of capitals has a cap line, a mid line at half the cap height, and a baseline only', () => {
    for (const text of ['AMAZBALLS', 'HOLD', 'AMBER IS....', 'OAK']) {
      const [set] = lineSets(lay({ text, capHeight: 31.5 }), h);
      expect(kinds(set), text).toEqual(['cap', 'mid', 'base']);
      const at = (k: SetKind) => set.lines.find((l) => l.kind === k)!;
      within(at('cap').height, 31.5);
      within(at('mid').height, 15.75);
      within(at('base').height, 0);
      within(at('base').y, set.baselineY);
      within(at('mid').y, set.baselineY - 15.75);
    }
  });

  it('a line with a J or a Q has a descender line at its deepest letter, and loses it when that letter goes', () => {
    const one = (text: string) => lineSets(lay({ text, capHeight: 31.5 }), h)[0];
    const just = one('JUST');
    expect(kinds(just)).toEqual(['cap', 'mid', 'base', 'desc']);
    within(just.lines.at(-1)!.height, -0.2857 * 31.5, 0.01);
    expect(just.deepest).toBe('J');
    // A Q goes deeper than a J, wherever it stands.
    const both = one('JQUEST');
    within(both.lines.at(-1)!.height, -0.3411 * 31.5, 0.01);
    expect(both.deepest).toBe('Q');
    within(one('JUEST').lines.at(-1)!.height, -0.2857 * 31.5, 0.01); // the Q taken out: the J's depth
    expect(kinds(one('UST'))).toEqual(['cap', 'mid', 'base']); // and the J: none
  });

  it('the carver’s layout: line 2 (JUST) alone has a descender line, 9.0 mm below its baseline', () => {
    const sets = lineSets(lay(BRIAN), h);
    expect(sets.map((s) => s.number)).toEqual([1, 2, 3]);
    expect(sets.map((s) => kinds(s).includes('desc'))).toEqual([false, true, false]);
    expect(sets[1].lines.map(setLabel)).toEqual(['cap 31.5', 'mid 15.8', 'base 114.8', 'desc −9.0']);
  });

  it('a blank line has none', () => {
    const sets = lineSets(lay({ text: 'OAK\n\nASH' }), h);
    expect(sets.map((s) => s.index)).toEqual([0, 2]);
  });

  it('lowercase letters bring an x-height line, at the small capitals in Cinzel; no ascender line, as none rises above them', () => {
    const [set] = lineSets(lay({ text: 'Amber', capHeight: 25 }), h);
    expect(kinds(set)).toEqual(['cap', 'x', 'mid', 'base']);
    within(set.lines[1].height, 21.43, 0.01);
    expect(setLabel(set.lines[1])).toBe('x 21.4');
    // A g rises a hair above the x-height, as an O does past the cap line: overshoot, not an ascender.
    expect(kinds(lineSets(lay({ text: 'gab' }), h)[0])).not.toContain('asc');
    // A lowercase p in Cinzel stays on the baseline; a j goes below it.
    expect(kinds(lineSets(lay({ text: 'pa' }), h)[0])).not.toContain('desc');
    expect(kinds(lineSets(lay({ text: 'ja' }), h)[0])).toContain('desc');
  });

  it('an alphabet whose ascenders rise above its x-height has an ascender line where a lowercase letter rises, at its ascender', () => {
    // A stand-in alphabet: lowercase x 0.5 tall, d and l 0.75, p 0.25 below, O 0.01 past the lines.
    const box = (top: number, bottom = 0): LetterShape => ({
      char: '',
      advance: 0.6,
      contours: [[{ x: 0, y: -top }, { x: 0.5, y: -top }, { x: 0.5, y: bottom }, { x: 0, y: bottom }]],
    });
    const shapes: Record<string, LetterShape> = { x: box(0.5), a: box(0.5), d: box(0.75), l: box(0.76), p: box(0.5, 0.25), O: box(1.01, 0.01), H: box(1) };
    const hh = measureHeights((c) => shapes[c] ?? null);
    expect(hh.xHeight).toBe(0.5);
    expect(hh.ascender).toBe(0.76);
    expect(hh.overshoot).toBeCloseTo(0.01, 6);
    const fake = (chars: string): Layout =>
      ({
        project: { ...defaultProject, capHeight: 20 },
        lines: [{ index: 0, number: 1, text: chars, baselineY: 50, x0: 0, width: 10, ink: { x0: 0, x1: 10 }, placed: false, locked: false }],
        letters: [...chars].map((c, pos) => ({ char: c, line: 0, pos, span: 1 })),
      }) as unknown as Layout;
    expect(kinds(lineSets(fake('ax'), hh)[0])).toEqual(['cap', 'x', 'mid', 'base']);
    const tall = lineSets(fake('ad'), hh)[0];
    expect(kinds(tall)).toEqual(['cap', 'asc', 'x', 'mid', 'base']);
    within(tall.lines[1].height, 0.76 * 20);
    expect(kinds(lineSets(fake('ap'), hh)[0])).toEqual(['cap', 'x', 'mid', 'base', 'desc']);
    expect(kinds(lineSets(fake('HO'), hh)[0])).toEqual(['cap', 'mid', 'base']); // capitals only; the O's dip is overshoot
  });

  it('the panel’s centre lines cross at its middle', () => {
    expect(panelCentre(lay({ panelWidth: 300, panelHeight: 200 }))).toEqual({ x: 150, y: 100 });
  });

  it('reads nothing of the machine (the School edition): its file uses no machine part, and the machine settings change nothing', () => {
    const src = readFileSync(new URL('../src/settingout.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from '\.\/(toolpath|gcode|relief|panel)'/);
    const a = lineSets(lay(BRIAN), h);
    const b = lineSets(lay({ ...BRIAN, machine: { ...defaultMachine, stockThickness: 5, toolAngle: 60, hairlineDepth: 0.5 } }), h);
    expect(b).toEqual(a);
  });
});

describe('the labels', () => {
  it('give each line’s height above the baseline in mm, and the baseline its distance from the panel’s top', () => {
    expect(setLabel({ kind: 'cap', y: 0, height: 31.5 })).toBe('cap 31.5');
    expect(setLabel({ kind: 'mid', y: 0, height: 15.75 })).toBe('mid 15.8');
    expect(setLabel({ kind: 'desc', y: 0, height: -9.009 })).toBe('desc −9.0');
    expect(setLabel({ kind: 'base', y: 114.8, height: 0 })).toBe('base 114.8');
  });

  // Labels as the workspace places them: px on screen at a zoom, beside the line numbers.
  const onScreen = (L: Layout, sets: LineSet[], scale: number, tx: number, ty: number, shown: (k: SetKind) => boolean = () => true) => {
    const sx = (x: number) => tx + x * scale;
    const sy = (y: number) => ty + y * scale;
    const numX = Math.max(22 + 30, sx(0) - 10);
    const letters = L.letters.map((t) => ({ x0: sx(t.box.x0), x1: sx(t.box.x1), y0: sy(t.box.y0), y1: sy(t.box.y1) }));
    const labels = placeLabels(sets, shown, {
      sy,
      column: (set) => {
        const line = L.lines[set.index];
        const w = line.locked || line.placed ? 36 : 24;
        return { end: numX - w - 5, start: numX + 5 };
      },
      minX: 25,
      avoid: letters,
      height: 12,
      charWidth: 6.3,
    });
    return { labels, letters, numX };
  };
  const overlaps = (a: { x0: number; x1: number; y0: number; y1: number }, b: typeof a) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

  it('never lie over the letters, nor come closer to each other than a label is tall, at any zoom', () => {
    for (const p of [BRIAN, { text: 'JUST\nQUOTA\nAmber', capHeight: 25, panelWidth: 200, panelHeight: 120 }, { text: 'O', capHeight: 300, panelWidth: 400, panelHeight: 400 }]) {
      const L = lay(p);
      const sets = lineSets(L, h);
      for (const scale of [0.2, 0.35, 0.5, 1, 2, 3.78, 8, 20, 60, 150, 400])
        for (const left of [140, 60, -50, -500, -scale * 150]) {
          const { labels, letters } = onScreen(L, sets, scale, left, 40);
          for (const t of labels) {
            for (const b of letters) expect(overlaps(t.box, b), `${t.text} at ${scale} px/mm`).toBe(false);
            for (const u of labels) if (u !== t) expect(Math.abs(u.y - t.y)).toBeGreaterThanOrEqual(12);
          }
        }
    }
  });

  it('the carver’s layout at about the size it is seen: cap, mid, base and descender all labelled, beside the line numbers', () => {
    const L = lay(BRIAN);
    const { labels, numX } = onScreen(L, lineSets(L, h), 2, 150, 60);
    const texts = labels.map((t) => t.text);
    for (const t of ['cap 31.5', 'mid 15.8', 'base 75.8', 'base 114.8', 'desc −9.0', 'base 154.9']) expect(texts).toContain(t);
    // On the numbers' left, off the panel: never over a letter.
    for (const t of labels) expect(t.box.x1).toBeLessThan(numX - 24);
  });

  it('are dropped where their lines come closer on screen than a label is tall: the descender’s kept before a repeated cap line’s', () => {
    const L = lay(BRIAN);
    const sets = lineSets(L, h);
    // Line 2's descender line (123.8 mm down) and line 3's cap line (123.4 mm) are 0.4 mm apart.
    const { labels } = onScreen(L, sets, 2, 150, 60);
    expect(labels.filter((t) => t.text === 'desc −9.0')).toHaveLength(1);
    expect(labels.filter((t) => t.text === 'cap 31.5' && t.line === 4)).toHaveLength(0);
    // Far out, only some are left, never two closer than a label.
    const far = onScreen(L, sets, 0.3, 150, 60).labels;
    expect(far.length).toBeLessThan(labels.length);
  });

  it('only for the kinds that are ticked', () => {
    const L = lay(BRIAN);
    const { labels } = onScreen(L, lineSets(L, h), 2, 150, 60, (k) => k === 'cap' || k === 'base');
    expect(new Set(labels.map((t) => t.kind))).toEqual(new Set(['cap', 'base']));
  });
});

describe('layers and views', () => {
  it('a tick for each kind, under Setting-out lines; the Setting-out view shows every kind', () => {
    expect(SETTING_OUT).toEqual(['capbase', 'mid', 'xheight', 'desc', 'centre']);
    for (const l of SETTING_OUT) expect(LAYERS).toContain(l);
    for (const l of SETTING_OUT) expect(PRESETS.setting).toContain(l);
    expect(STAGE_VIEWS.machine.layers).toEqual(PRESETS.setting);
  });

  it('Write and Panel open with cap line, baseline and mid line; Design, Spacing and Proof show none', () => {
    for (const s of ['write', 'panel'] as const) {
      expect(STAGE_VIEWS[s].layers.filter((l) => SETTING_OUT.includes(l))).toEqual(['capbase', 'mid']);
      expect(STAGE_VIEWS[s].layers).toContain('margins');
    }
    for (const v of ['design', 'spacing', 'proof'] as const) expect(PRESETS[v].filter((l) => SETTING_OUT.includes(l))).toEqual([]);
  });

  it('views remembered before keep what they showed: "guides" becomes margins, cap line, baseline and mid line', () => {
    const v = viewsFromBefore({
      write: { preset: null, layers: ['fill', 'guides'] },
      panel: { preset: null, layers: ['outline'] },
      machine: { preset: 'setting', layers: ['outline', 'datum', 'valley'] },
    });
    expect(v.write).toEqual({ preset: null, layers: ['fill', 'margins', 'capbase', 'mid'] });
    expect(v.panel).toEqual({ preset: null, layers: ['outline'] });
    expect(v.machine).toEqual({ preset: 'setting', layers: PRESETS.setting });
    expect(viewsFromBefore(null)).toEqual({});
  });

  it('the ticks are in the Layers menu, by name for Ctrl+K, and G is in the ? list', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    for (const l of LAYERS) expect(html, l).toContain(`id="show-${l}"`);
    for (const name of ['cap line and baseline', 'mid line', 'x-height and ascender lines', 'descender line', 'panel centre lines'])
      expect(html).toContain(`data-find="Setting-out lines: ${name}"`);
    const keys = SHORTCUTS.flatMap((g) => g.items);
    expect(keys.find(([k]) => k === 'G')?.[1]).toMatch(/Setting-out lines/);
  });

  it('each step is undone on its own, whether a change to the job or to a view', () => {
    type Step = { project: string } | { view: string };
    const hist = new History<Step>();
    let project = 'a';
    let view = 'cap+mid';
    hist.record({ project }); // a job change
    project = 'b';
    hist.record({ view }); // a tick
    view = 'cap';
    const now = (s: Step): Step => ('view' in s ? { view } : { project });
    const back = hist.undo(now)!;
    expect(back).toEqual({ view: 'cap+mid' });
    view = 'cap+mid';
    expect(hist.undo(now)).toEqual({ project: 'a' });
    project = 'a';
    expect(hist.redo(now)).toEqual({ project: 'b' });
    project = 'b';
    expect(hist.redo(now)).toEqual({ view: 'cap' });
  });
});

describe('snapping and measuring', () => {
  const L = lay(BRIAN);
  const sets = lineSets(L, h);

  it('every line’s heights and the panel centre are targets, named as the baseline and cap line are', () => {
    const t = snapTargets(L, 4, sets); // dragging line 3 (AMAZBALLS)
    const labels = t.y.map((q) => q.label);
    for (const l of ['line 2 cap line', 'line 2 mid line', 'line 2 baseline', 'line 2 descender line', 'line 1 mid line', 'panel centre']) expect(labels).toContain(l);
    expect(t.x.map((q) => q.label)).toContain('panel centre');
    const mid = t.y.find((q) => q.label === 'line 2 mid line')!;
    within(mid.at, 114.8 - 15.75);
  });

  it('a dragged line’s mid line snaps to another’s, and its cap line to the descenders above', () => {
    const t = snapTargets(L, 4, sets);
    expect(nearest([{ f: 'mid', at: 114.8 - 15.75 + 0.3 }], t.y, 1)?.target.label).toBe('line 2 mid line');
    expect(nearest([{ f: 'cap', at: 114.8 + 9.0 + 0.5 }], t.y, 1)?.target.label).toBe('line 2 descender line');
  });

  it('a ruler guide or an end of the measure snaps to any of them, but not to equal spacing', () => {
    const t = pointTargets(L, sets);
    expect(nearestTo(114.8 - 15.75 + 0.4, t.y, 1)?.label).toBe('line 2 mid line');
    expect(nearestTo(100.2, t.y, 0.5)?.label).toBe('panel centre');
    expect(nearestTo(150.3, t.x, 0.5)?.label).toBe('panel centre');
    expect(t.y.some((q) => q.label === 'equal spacing')).toBe(false);
    // A guide being moved does not snap to itself.
    const g = lay({ ...BRIAN, guides: { x: [], y: [40] } });
    expect(nearestTo(40.2, pointTargets(g, lineSets(g, h), { axis: 'y', at: 40 }).y, 0.5)).toBeNull();
    expect(nearestTo(40.2, pointTargets(g, lineSets(g, h)).y, 0.5)?.label).toBe('guide');
  });
});

describe('the inspection panel', () => {
  it('lists each line’s heights: cap, x-height where it has one, mid, and the descender with its letter', () => {
    const L = lay({ ...BRIAN, text: 'AMBER IS....\n\nJUST\n\nAmazballs' });
    const stats = lineStats(L, lineSets(L, h));
    expect(stats[0].heights).toEqual({ cap: 31.5, x: null, mid: 15.75, descender: null, deepest: null });
    expect(stats[1].heights.deepest).toBe('J');
    within(stats[1].heights.descender!, -9.0, 0.01);
    within(stats[2].heights.x!, 27.0, 0.01);
    const html = lineListHtml(L, null, (s) => s, lineSets(L, h));
    for (const s of ['<b>31.5</b> cap', '<b>15.8</b> mid', '<b>−9.0</b> descender (J)', '<b>27.0</b> x', 'no descender']) expect(html).toContain(s);
  });
});

describe('the bench sheet', () => {
  const machine = { ...defaultMachine, stockThickness: 20 };
  const p: Project = { ...defaultProject, ...BRIAN, machine };
  const l = layoutPanel(store, p);
  const passes = buildPasses(l, machine);
  const sheet = (lines: boolean) =>
    benchSheet({
      project: p,
      layout: l,
      strokes: passes.find((q) => q.name === 'slit')!,
      passes,
      checks: checkPasses(l, passes, machine, bedFit(p.panelWidth, p.panelHeight)),
      alphabet: 'Cinzel Regular',
      fileName: null,
      date: new Date('2026-10-09T12:00:00Z'),
      settingOut: lines ? { sets: lineSets(l, h), centre: panelCentre(l) } : null,
    });

  it('draws the same set, thin and grey, with its labels and the panel centre', () => {
    const html = sheet(true).html;
    for (const k of ['cap', 'mid', 'base', 'desc']) expect(html).toContain(`class="so-${k}"`);
    expect(html).toContain('class="so-centre"');
    for (const t of ['cap 31.5', 'mid 15.8', 'base 114.8', 'desc −9.0']) expect(html).toContain(`>${t}</text>`);
    expect(html).not.toMatch(/class="so-\w+"[^>]*stroke="#(?!8c8c8c|bdbdbd)/); // grey only
    expect(html).toContain('setting-out lines');
  });

  it('a tick on the sheet turns them off', () => {
    const html = sheet(false).html;
    expect(html).not.toContain('so-cap');
    expect(html).not.toContain('sheet-so-label');
  });

  it('its labels sit off the panel, on the left, never over the letters', () => {
    const html = sheet(true).html;
    const xs = [...html.matchAll(/class="sheet-so-label" x="([-\d.]+)"/g)].map((m) => Number(m[1]));
    expect(xs.length).toBeGreaterThan(5);
    for (const x of xs) expect(x).toBeLessThan(0);
  });
});
