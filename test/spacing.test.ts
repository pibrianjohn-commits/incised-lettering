import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { alphabetFromFont } from '../src/alphabet';
import { distanceToBoundary, insideShape } from '../src/geometry';
import { groupOf, groupPairKey, sideShape } from '../src/groups';
import { defaultProject, layoutPanel, pairKerning, type Project } from '../src/layout';
import { LetterStore } from '../src/letters';
import { remapForEdit } from '../src/remap';
import { evenUp, fitBlock, fitLine, pairArea } from '../src/spacing';

const buf = readFileSync(new URL('../public/fonts/Cinzel-Regular.woff', import.meta.url));
const store = new LetterStore(alphabetFromFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'OFL'));
const proj = (c: Partial<Project> = {}): Project => ({ ...defaultProject, ...c });
const lay = (c: Partial<Project> = {}) => layoutPanel(store, proj(c));

describe('kerning groups', () => {
  it('O C G Q share a left side, H I N M a right side', () => {
    for (const ch of 'OCGQ') expect(groupOf(defaultProject.groups, 'left', ch)).toBe('O');
    for (const ch of 'HINM') expect(groupOf(defaultProject.groups, 'right', ch)).toBe('H');
    expect(groupPairKey(defaultProject.groups, 'N', 'O')).toBe('H|O');
  });

  it('a group value applies to every pair in the groups; an exact pair overrides it', () => {
    const p = proj({ groupKerning: { 'H|O': -0.6 }, kerning: { NO: -1 } });
    expect(pairKerning(p, 'H', 'C')).toEqual({ mm: -0.6, from: 'group', groupMm: -0.6 });
    expect(pairKerning(p, 'M', 'Q').mm).toBe(-0.6);
    expect(pairKerning(p, 'N', 'O')).toEqual({ mm: -1, from: 'pair', groupMm: -0.6 });
    expect(pairKerning(p, 'A', 'V')).toEqual({ mm: 0, from: 'none', groupMm: 0 });
  });

  it('group kerning moves the letters in the layout', () => {
    const rel = (l: ReturnType<typeof lay>) => l.letters[1].box.x0 - l.letters[0].box.x0;
    expect(rel(lay({ text: 'HO', groupKerning: { 'H|O': -2 } })) - rel(lay({ text: 'HO' }))).toBeCloseTo(-2, 9);
  });

  it('side shapes', () => {
    expect(sideShape('O', 'left')).toBe('round');
    expect(sideShape('H', 'right')).toBe('straight');
    expect(sideShape('A', 'right')).toBe('diagonal');
  });
});

describe('even up spacing', () => {
  it('suggests nothing when every pair is the reference pair', () => {
    expect(evenUp(store, lay({ text: 'HHHH' })).suggestions).toEqual([]);
  });

  it('accepting the suggestions brings each pair to its target space', () => {
    const p = proj({ text: 'MINIMUM HOLLOW' });
    const first = evenUp(store, layoutPanel(store, p));
    expect(first.suggestions.length).toBeGreaterThan(0);
    const kerning = { ...p.kerning };
    for (const s of first.suggestions) kerning[s.pair] = Math.round((s.current + s.change) * 10) / 10;
    const after = { ...p, kerning };
    for (const s of first.suggestions) {
      // Within half a 0.1 mm step of the target space.
      expect(Math.abs(pairArea(store, after, s.pair)! - s.target)).toBeLessThan(0.05 * 25 + 0.5);
    }
    // And nothing (or next to nothing) is left to suggest.
    const again = evenUp(store, layoutPanel(store, after));
    expect(again.suggestions.every((s) => Math.abs(s.change) <= 0.1)).toBe(true);
  });

  it('a round-side factor below 1 asks round pairs for less space', () => {
    const plain = evenUp(store, lay({ text: 'HOH' })).suggestions.find((s) => s.pair === 'HO')!;
    const tight = evenUp(store, lay({ text: 'HOH', evenUp: { reference: 'HH', round: 0.8, straight: 1, diagonal: 1 } })).suggestions.find((s) => s.pair === 'HO')!;
    expect(tight.target).toBeCloseTo(plain.target * 0.9, 6); // average of straight 1 and round 0.8
    expect(tight.change).toBeLessThan(plain.change);
  });
});

describe('fitting', () => {
  it('fits a line to an exact width by letter spacing', () => {
    const p = proj({ text: 'OAK' });
    const e = fitLine(store, p, 0, 100, 'letter')!;
    const l = layoutPanel(store, { ...p, lineExtras: { '0': e } }).lines[0];
    expect(l.ink!.x1 - l.ink!.x0).toBeCloseTo(100, 2);
  });

  it('fits a line by word spacing only, leaving letter spacing alone', () => {
    const p = proj({ text: 'OAK TREE', panelWidth: 300 });
    const e = fitLine(store, p, 0, 220, 'word')!;
    expect(e.letter).toBe(0);
    const l = layoutPanel(store, { ...p, lineExtras: { '0': e } });
    expect(l.lines[0].ink!.x1 - l.lines[0].ink!.x0).toBeCloseTo(220, 2);
    const oa = l.letters[1].box.x0 - l.letters[0].box.x0;
    const before = lay({ text: 'OAK TREE', panelWidth: 300 });
    expect(oa).toBeCloseTo(before.letters[1].box.x0 - before.letters[0].box.x0, 9);
  });

  it('cannot fit by word spacing a line with no spaces', () => {
    expect(fitLine(store, proj({ text: 'OAK' }), 0, 100, 'word')).toBeNull();
  });

  it('fits a block: every line to the width, and the height by line spacing', () => {
    const p = proj({ text: 'OAK\nTREE\nWOOD', panelWidth: 200, panelHeight: 160 });
    const r = fitBlock(store, p, 120, 110, 'letter');
    const l = layoutPanel(store, { ...p, lineExtras: r.lineExtras, lineSpacing: r.lineSpacing! });
    for (const line of l.lines) expect(line.ink!.x1 - line.ink!.x0).toBeCloseTo(120, 2);
    expect(l.lines[2].baselineY - (l.lines[0].baselineY - 25)).toBeCloseTo(110, 6);
  });

  it('fitted spacing follows its line when a line is added above', () => {
    const p = proj({ text: 'OAK\nTREE', lineExtras: { '1': { letter: 2, word: 0 } } });
    expect(remapForEdit(p, 'NEW\nOAK\nTREE').lineExtras).toEqual({ '2': { letter: 2, word: 0 } });
  });
});

describe('word stops', () => {
  it('a stop sits in each word space, between the letters, cut like a letter', () => {
    const l = lay({ text: 'OAK AND ASH', panelWidth: 300, wordStops: { on: true, size: 22, height: 45, point: 'down' } });
    expect(l.stops).toHaveLength(2);
    const s = l.stops[0];
    const tri = s.outline[0];
    const k = 25;
    // Sides 22% of cap height.
    const side = Math.hypot(tri[1].x - tri[2].x, tri[1].y - tri[2].y);
    expect(side).toBeCloseTo(0.22 * k, 6);
    // Between K and A.
    const K = l.letters.find((t) => t.char === 'K')!;
    const centre = s.valleys[0][0];
    expect(centre.x).toBeGreaterThan(K.box.x1);
    // Valley from the centre to each corner; datum inside, by the rule.
    expect(s.valleys).toHaveLength(3);
    expect(s.datum.length).toBeGreaterThan(0);
    for (const p of s.datum.flat()) {
      expect(insideShape(p, s.outline)).toBe(true);
      expect(distanceToBoundary(p, s.outline)).toBeGreaterThan(0.2 - 0.005);
    }
  });

  it('no stops when switched off, or at the ends of a line', () => {
    expect(lay({ text: 'OAK AND' }).stops).toHaveLength(0);
    expect(lay({ text: ' OAK ', wordStops: { on: true, size: 22, height: 45, point: 'up' } }).stops).toHaveLength(0);
  });
});
