import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { alphabetFromFont } from '../src/alphabet';
import { balance, letterArea, lineStats } from '../src/inspect';
import { defaultProject, layoutPanel, type Project } from '../src/layout';
import { LetterStore } from '../src/letters';

const buf = readFileSync(new URL('../public/fonts/Cinzel-Regular.woff', import.meta.url));
const store = new LetterStore(alphabetFromFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'OFL'));
const lay = (c: Partial<Project> = {}) => layoutPanel(store, { ...defaultProject, ...c });

describe('inspection figures', () => {
  it('line length and % of panel width', () => {
    const l = lay();
    const [s] = lineStats(l);
    expect(s.length).toBeCloseTo(l.lines[0].ink!.x1 - l.lines[0].ink!.x0, 9);
    expect(s.percentOfPanel).toBeCloseTo((100 * s.length) / 150, 9);
    expect(s.capHeight).toBe(25);
  });

  it('the hole in O is taken out of its area', () => {
    const O = lay({ text: 'O' }).letters[0];
    const outer = Math.PI * ((O.box.x1 - O.box.x0) / 2) * ((O.box.y1 - O.box.y0) / 2);
    const a = letterArea(O);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(outer * 0.5); // a ring, not a disc
  });

  it('colour: a line of I is a fair share of letter; a wide-spaced one is less', () => {
    const tight = lineStats(lay({ text: 'III' }))[0].colour;
    const loose = lineStats(lay({ text: 'III', letterSpacing: 8 }))[0].colour;
    expect(tight).toBeGreaterThan(5);
    expect(tight).toBeLessThan(60);
    expect(loose).toBeLessThan(tight);
  });

  it('balance: space round the lettering adds up to the panel', () => {
    const l = lay({ text: 'OAK\nOAK' , panelHeight: 120 });
    const b = balance(l)!;
    const ink = l.lines[0].ink!;
    expect(b.left + (ink.x1 - ink.x0) + b.right).toBeCloseTo(150, 6);
    expect(b.top + 25 + 40 + b.bottom).toBeCloseTo(120, 6);
  });

  it('the visual centre of a centred symmetric word sits on the panel centre line', () => {
    const b = balance(lay({ text: 'HOH' }))!;
    expect(Math.abs(b.offset.x)).toBeLessThan(0.3);
  });

  it('moving a line up moves the visual centre up', () => {
    const a = balance(lay())!;
    const moved = balance(lay({ lines: { '0': { x: 75, align: 'centre', baseline: 35 } } }))!;
    expect(moved.centre.y).toBeLessThan(a.centre.y);
  });
});
