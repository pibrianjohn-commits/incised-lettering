import { describe, expect, it } from 'vitest';
import { defaultProject, type Project } from '../src/layout';
import { remapForEdit } from '../src/remap';

const proj = (text: string, change: Partial<Project> = {}): Project => ({ ...defaultProject, text, ...change });
const place = { x: 50, align: 'centre' as const, baseline: 30 };

describe('hand work follows the letters when the text is edited', () => {
  it('one-gap kerning moves along when letters are typed in front of it', () => {
    const p = proj('AVAV', { gapKerning: { '0:3': { pair: 'AV', mm: -1 } } });
    expect(remapForEdit(p, 'XXAVAV').gapKerning).toEqual({ '0:5': { pair: 'AV', mm: -1 } });
  });

  it('one-gap kerning moves to the next line when a line is added above', () => {
    const p = proj('AVAV', { gapKerning: { '0:3': { pair: 'AV', mm: -1 } } });
    expect(remapForEdit(p, 'NEW\nAVAV').gapKerning).toEqual({ '1:3': { pair: 'AV', mm: -1 } });
  });

  it('one-gap kerning is dropped when one of its letters is deleted', () => {
    const p = proj('AVAV', { gapKerning: { '0:3': { pair: 'AV', mm: -1 } } });
    expect(remapForEdit(p, 'AVA').gapKerning).toEqual({});
  });

  it('editing after the gap leaves it alone', () => {
    const p = proj('AVAV', { gapKerning: { '0:1': { pair: 'AV', mm: -0.5 } } });
    expect(remapForEdit(p, 'AVAVXX').gapKerning).toEqual({ '0:1': { pair: 'AV', mm: -0.5 } });
  });

  it('a placed line follows its text when a line is inserted above it', () => {
    const p = proj('ONE\nTWO', { lines: { '1': place } });
    expect(remapForEdit(p, 'ONE\nNEW\nTWO').lines).toEqual({ '2': place });
  });

  it('a placed line stays put when a line below it is deleted', () => {
    const p = proj('ONE\nTWO\nTHREE', { lines: { '0': place } });
    expect(remapForEdit(p, 'ONE\nTWO').lines).toEqual({ '0': place });
  });

  it('a placed line keeps its place while its own text is edited', () => {
    const p = proj('ONE\nTWO', { lines: { '1': place } });
    expect(remapForEdit(p, 'ONE\nTWOS').lines).toEqual({ '1': place });
    expect(remapForEdit(p, 'ONE\nTW').lines).toEqual({ '1': place });
  });

  it('a placed line moves up when the line above it is deleted', () => {
    const p = proj('ONE\nTWO\nTHREE', { lines: { '2': place } });
    expect(remapForEdit(p, 'ONE\nTHREE').lines).toEqual({ '1': place });
  });
});
