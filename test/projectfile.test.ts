import { describe, expect, it } from 'vitest';
import { defaultProject, type Project } from '../src/layout';
import { alphabetDifferences, fileNameFor, normaliseProject, projectFileText, readProjectFile } from '../src/projectfile';
import { matchScore, rankCommands } from '../src/palette';
import { scrubValue } from '../src/scrub';
import { layoutProblems, machineProblems, problemSummary } from '../src/problems';
import type { Check } from '../src/toolpath';

describe('project files', () => {
  const job: Project = {
    ...structuredClone(defaultProject),
    text: 'IN MEMORIAM\nJOHN SMITH',
    capHeight: 30,
    kerning: { AV: -0.6 },
    machine: { ...defaultProject.machine, stockThickness: 22 },
    guides: { x: [12.5], y: [] },
  };

  it('save and open give back exactly the same job', () => {
    const text = projectFileText(job, 'Cinzel Regular', 'data:image/png;base64,AAAA', new Date('2026-10-07T12:00:00Z'));
    const back = readProjectFile(text);
    expect(back.project).toEqual(job);
    expect(back.alphabet).toBe('Cinzel Regular');
    expect(back.picture).toBe('data:image/png;base64,AAAA');
    expect(back.saved?.toISOString()).toBe('2026-10-07T12:00:00.000Z');
  });

  it('anything a file lacks comes from the starting values', () => {
    const older = { text: 'OAK', margin: 8, machine: { stockThickness: 18 } };
    const p = normaliseProject(older);
    expect(p.margins).toEqual({ top: 8, right: 8, bottom: 8, left: 8 });
    expect(p.machine.stockThickness).toBe(18);
    expect(p.machine.safeFloor).toBe(3);
    expect(p.machine.passes).toEqual({ hairline: true, datum: true, slit: true });
    expect(p.wordStops).toEqual(defaultProject.wordStops);
  });

  it('refuses files that are not projects, in plain words', () => {
    expect(() => readProjectFile('G21 G90')).toThrow('not a lettering project');
    expect(() => readProjectFile('{"format":"something-else"}')).toThrow('not a lettering project');
    expect(() => readProjectFile(JSON.stringify({ format: 'incised-lettering-project', version: 99, project: {} }))).toThrow('newer version');
  });

  it('counts the spacing differences kept with the alphabet', () => {
    expect(alphabetDifferences(job, job)).toBe(0);
    expect(alphabetDifferences(job, { ...job, kerning: { AV: -0.5, LT: -1 } })).toBe(2);
    expect(alphabetDifferences(job, { ...job, evenUp: { ...job.evenUp, round: 0.8 } })).toBe(1);
  });

  it('names the file after the inscription', () => {
    expect(fileNameFor(job)).toBe('IN-MEMORIAM-JOHN-SMITH.lettering');
    expect(fileNameFor({ ...job, text: '  ' })).toBe('lettering.lettering');
  });
});

describe('search', () => {
  it('finds commands by their first letters, a word, or letters in order', () => {
    expect(matchScore('cap', 'Cap height')).toBeGreaterThan(matchScore('cap', 'Escape the cap'));
    expect(matchScore('floor', 'Safe floor')).toBeGreaterThan(0);
    expect(matchScore('sfl', 'Safe floor')).toBeGreaterThan(0);
    expect(matchScore('xyz', 'Safe floor')).toBe(-1);
    const run = () => {};
    const list = [
      { label: 'Go to Panel', run },
      { label: 'Safe floor', hint: 'Machine › More', run },
      { label: 'Bench sheet, to print', run, words: 'cutting order' },
    ];
    expect(rankCommands('safe', list)[0].label).toBe('Safe floor');
    expect(rankCommands('cutting', list)[0].label).toBe('Bench sheet, to print');
  });
});

describe('drag to change a value', () => {
  it('steps by the box’s own step, faster with Shift, and stays within its limits', () => {
    const o = { step: 0.5, min: 5, max: 120, coarse: false };
    expect(scrubValue(25, 0, o)).toBe(25);
    expect(scrubValue(25, 30, o)).toBe(30); // 0.5 mm every 3 px
    expect(scrubValue(25, -30, o)).toBe(20);
    expect(scrubValue(25, 30, { ...o, coarse: true })).toBe(75);
    expect(scrubValue(25, 9999, o)).toBe(120);
    expect(scrubValue(0.2, 8, { step: 0.05, min: 0.05, max: Infinity, coarse: false })).toBe(0.3); // 4 px a step without a top limit
  });
});

describe('the warnings badge', () => {
  it('says plainly when nothing is wrong, and counts problems when something is', () => {
    expect(problemSummary([])).toEqual({ level: 'ok', text: '✓ No problems' });
    const q = { kind: 'edges' as const, fixes: [] };
    expect(problemSummary([{ ...q, level: 'warn', stage: 'panel', text: 'x' }]).level).toBe('warn');
    expect(problemSummary([{ ...q, level: 'warn', stage: 'panel', text: 'x' }, { ...q, level: 'bad', stage: 'machine', text: 'y' }])).toEqual({
      level: 'bad',
      text: '✗ 2 problems',
    });
  });

  it('a missing stock thickness is a warning, a cut below the safe floor is a problem, and the bed and margins are not counted twice', () => {
    const checks: Check[] = [
      { id: 'stock', ok: false, blocking: true, text: 'Enter the stock thickness.' },
      { id: 'floor', ok: false, blocking: true, text: 'Too deep.' },
      { id: 'bed', ok: false, blocking: true, text: 'Too big.' },
      { id: 'margins', ok: false, blocking: false, text: 'Past the margins.' },
      { id: 'angle', ok: true, blocking: true, text: 'Fine.' },
    ];
    const list = machineProblems(checks, { letters: 3, border: 0, fixed: 0.3, failed: [] }, defaultProject.machine, 25);
    expect(list.map((q) => q.level)).toEqual(['warn', 'bad']);
    expect(list.every((q) => q.stage === 'machine')).toBe(true);
  });

  it('letters missing from the alphabet, letters off the panel, and letters that run into each other', () => {
    const letter = (char: string, line: number, x0: number, y0: number, x1: number, y1: number) =>
      ({
        char,
        line,
        pos: 0,
        outline: [[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]],
        valleys: [],
        datum: [],
        box: { x0, y0, x1, y1 },
      }) as never;
    const layout = {
      project: { ...defaultProject, text: 'Aé\nB' },
      letters: [letter('A', 0, 10, 20, 30, 45), letter('B', 1, 15, 40, 35, 65)],
      gaps: [],
      lines: [
        { index: 0, number: 1, text: 'Aé', baselineY: 45, x0: 10, width: 20, ink: { x0: 10, x1: 30 }, placed: false, locked: false },
        { index: 1, number: 2, text: 'B', baselineY: 65, x0: 15, width: 20, ink: { x0: 15, x1: 35 }, placed: false, locked: false },
      ],
      spacers: [],
      overflow: { wide: false, tall: false },
      datumPending: false,
      stops: [],
      failed: [],
      shapesPending: false,
      unjoined: [],
    };
    const texts = layoutProblems(layout, (ch) => ch !== 'é').map((q) => q.text);
    expect(texts).toContain('Not in the alphabet, so left as a space: é');
    expect(texts).toContain('Line 2 runs off the board at the bottom by 5.0 mm.'); // B runs below the 60 mm panel
    expect(texts).toContain('The A in line 1 runs into the B in line 2.');
  });
});
