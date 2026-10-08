// Letters that run into each other (BRIEF.md, Decisions: "Collisions" and
// "Every fix is tried before it is offered").

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { alphabetFromFont } from '../src/alphabet';
import { findCollisions, HAIRLINE, parting } from '../src/collisions';
import { defaultProject, layoutPanel, type Project } from '../src/layout';
import { LetterStore } from '../src/letters';
import { attachFixes, layoutProblems, triedFixes, type Problem } from '../src/problems';

const buf = readFileSync(new URL('../public/fonts/Cinzel-Regular.woff', import.meta.url));
const store = new LetterStore(alphabetFromFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'OFL'));
const has = (ch: string) => !!store.alphabet.letter(ch)?.contours.length;
const proj = (c: Partial<Project> = {}): Project => ({ ...structuredClone(defaultProject), ...c });
const lay = (p: Project) => layoutPanel(store, p);

/** The problems with their collision fixes tried, as the app shows them once the trials are done. */
function problemsOf(p: Project): Problem[] {
  const l = lay(p);
  return attachFixes(layoutProblems(l, has), triedFixes(l, has, (q) => layoutPanel(store, q, true)));
}
const collisions = (list: Problem[]) => list.filter((q) => q.kind === 'collision');
const labels = (q: Problem | undefined) => q?.fixes.map((f) => f.label) ?? [];

/**
 * Every fix offered for a collision, carried out on the job afresh: it cures
 * the problem it is listed under, causes no new one, and makes none worse.
 */
function everyFixCures(p: Project) {
  const list = problemsOf(p);
  const before = new Set(list.flatMap((q) => q.facts ?? []));
  const sizes: Record<string, number> = Object.assign({}, ...list.map((q) => q.sizes ?? {}));
  for (const q of collisions(list))
    for (const f of q.fixes) {
      expect(f.change, f.label).toBeTruthy();
      const after = layoutProblems(lay({ ...p, ...f.change }), has);
      expect(after.some((x) => x.key === q.key), `“${f.label}” cures “${q.text}”`).toBe(false);
      expect(after.flatMap((x) => x.facts ?? []).filter((x) => !before.has(x)), `“${f.label}” causes nothing new`).toEqual([]);
      for (const x of after) for (const [fact, v] of Object.entries(x.sizes ?? {})) expect(v, `“${f.label}” makes “${x.text}” no worse`).toBeLessThanOrEqual((sizes[fact] ?? 0) + 0.05);
    }
  return list;
}

// Rebuilt from the carver's layout of 8 Oct 2026: Cinzel at 31.5 mm cap
// height and −0.5 mm letter spacing, lines 2 and 3 placed by hand. Where the
// lines sat across the panel was not recorded; line 2 sits here where its J
// comes over the M below, as it did there.
const BRIAN = proj({
  text: 'AMBER IS....\n\nJUST\n\nAMAZBALLS',
  capHeight: 31.5,
  letterSpacing: -0.5,
  lineSpacing: 20,
  panelWidth: 300,
  panelHeight: 200,
  lines: { '2': { x: 130, align: 'centre', baseline: 114.8 }, '4': { x: 150, align: 'centre', baseline: 154.9 } },
});

describe('letters that collide', () => {
  it("the carver's layout: the J's tail runs into the M below, and the feet of A and M touch", () => {
    const list = collisions(problemsOf(BRIAN));
    expect(list.map((q) => q.text)).toEqual([
      'The A and M in line 1 touch.',
      'The J in line 2 runs into the M in line 3.',
      'The A and M in line 3 touch.',
      'The M and A in line 3 touch.',
    ]);
    // Between lines: put right in Write; on one line: in Space.
    expect(list.map((q) => q.stage)).toEqual(['space', 'write', 'space', 'space']);
    expect(list.every((q) => q.level === 'warn' && !q.trying)).toBe(true);
    // The J's tail reaches about 1 mm below the top of the M.
    const l = lay(BRIAN);
    const J = l.letters.find((x) => x.char === 'J')!;
    const M = l.letters.find((x) => x.char === 'M' && x.line === 4)!;
    expect(J.box.y1 - M.box.y0).toBeGreaterThan(0.9);
    expect(J.box.y1 - M.box.y0).toBeLessThan(1.2);
    // The spot marked on the panel is where they meet.
    const spot = list[1].spot!;
    expect(spot.y).toBeGreaterThanOrEqual(M.box.y0 - 0.01);
    expect(spot.y).toBeLessThanOrEqual(J.box.y1 + 0.01);
    expect(spot.x).toBeGreaterThanOrEqual(Math.max(J.box.x0, M.box.x0));
    expect(spot.x).toBeLessThanOrEqual(Math.min(J.box.x1, M.box.x1));
  });

  it("the carver's layout: every fix offered cures its own problem, and causes no new one", () => {
    const list = collisions(everyFixCures(BRIAN));
    expect(labels(list[1])).toEqual(['Move line 3 down 1.5 mm', 'Move line 2 up 1.5 mm', 'Return line 2 to auto', 'Return line 3 to auto']);
    for (const q of [list[0], list[2], list[3]]) expect(labels(q)).toEqual(['Open this gap 0.5 mm', 'Open the letter spacing to 0 mm']);
  });

  it('lines are moved just far enough to part the letters with 0.5 mm to spare, to the next 0.5 mm', () => {
    const at = (dy: number) => {
      const l = lay({ ...BRIAN, lines: { ...BRIAN.lines, '4': { ...BRIAN.lines['4'], baseline: 154.9 + dy } } });
      return findCollisions(l, 0.5).some((c) => c.a.char === 'J');
    };
    expect(at(1.5)).toBe(false); // parted, 0.5 mm to spare
    expect(at(1.0)).toBe(true); // half a millimetre less would not do
  });

  it('a gap is opened just enough to part its letters, in kerning steps of 0.1 mm', () => {
    const q = collisions(problemsOf(BRIAN))[0];
    const f = q.fixes[0];
    const after = (p: Project) => findCollisions(lay(p)).some((c) => c.key === q.key!.slice('collide:'.length));
    expect(after({ ...BRIAN, ...f.change })).toBe(false);
    const less = { ...BRIAN.gapKerning, '0:1': { pair: 'AM', mm: (0.4 * 25) / BRIAN.capHeight } };
    expect(after({ ...BRIAN, gapKerning: less })).toBe(true);
  });

  it('"Return line 2 to auto" is offered only where it cures: here it moves the line 0.95 mm down, and the J further into the M', () => {
    // Found 8 Oct 2026 (BRIEF.md, Decisions: "Every fix is tried before it is offered").
    // Line 2 sits where auto would put it across; line 3 is placed 20 mm right of centre.
    const p = { ...BRIAN, lines: { '2': { x: 150, align: 'centre' as const, baseline: 114.8 }, '4': { x: 170, align: 'centre' as const, baseline: 154.9 } } };
    const list = everyFixCures(p);
    const jm = list.find((q) => q.text === 'The J in line 2 runs into the M in line 3.')!;
    expect(lay({ ...p, lines: { '4': p.lines['4'] } }).lines[2].baselineY - 114.8).toBeCloseTo(0.95, 6);
    expect(labels(jm)).not.toContain('Return line 2 to auto');
    // Carried out anyway, it leaves the problem in place.
    expect(layoutProblems(lay({ ...p, lines: { '4': p.lines['4'] } }), has).some((q) => q.key === jm.key)).toBe(true);
    expect(labels(jm)).toEqual(['Move line 3 down 1.5 mm', 'Move line 2 up 1.5 mm', 'Return line 3 to auto']);
  });

  it("a tail falling into a gap in the line below is not a collision, though the lines' boxes overlap", () => {
    const p = { ...BRIAN, lines: { '2': { x: 150, align: 'centre' as const, baseline: 114.8 }, '4': BRIAN.lines['4'] } };
    const l = lay(p);
    const J = l.letters.find((x) => x.char === 'J')!;
    const below = l.letters.filter((x) => x.line === 4);
    expect(J.box.y1).toBeGreaterThan(Math.min(...below.map((x) => x.box.y0))); // the old check's line boxes overlapped
    expect(collisions(problemsOf(p)).filter((q) => q.stage === 'write')).toEqual([]);
  });

  it('letters closer than the hairline is wide, but not touching, are named with how close they come', () => {
    const l = lay(BRIAN);
    const J = l.letters.find((x) => x.char === 'J')!;
    const M = l.letters.find((x) => x.char === 'M' && x.line === 4)!;
    const dy = parting(J, M, { x: 0, y: 1 }, 0.05, 0.001, 10)!;
    const p = { ...BRIAN, lines: { ...BRIAN.lines, '4': { ...BRIAN.lines['4'], baseline: 154.9 + dy } } };
    const q = collisions(everyFixCures(p)).find((x) => x.stage === 'write')!;
    expect(q.text).toMatch(/^The J in line 2 comes within 0\.0\d mm of the M in line 3, so their hairlines would run together\.$/);
    expect(q.fixes.length).toBeGreaterThan(0);
  });

  it('how close is too close follows the hairline: deeper, and so wider, it parts more', () => {
    const p = proj({ text: 'AM', capHeight: 31.5, panelWidth: 200, panelHeight: 80 });
    expect(collisions(problemsOf(p))).toEqual([]); // 0.18 mm apart, wider than the 0.11 mm hairline
    expect(HAIRLINE).toBeCloseTo(0.107, 3);
    const deep = { ...p, machine: { ...p.machine, hairlineDepth: 0.5 } }; // 0.27 mm wide
    const list = collisions(everyFixCures(deep));
    expect(list.map((q) => q.text)).toEqual(['The A and M in line 1 come within 0.18 mm of each other, so their hairlines would run together.']);
    expect(labels(list[0])).toEqual(['Open this gap 0.2 mm']); // 0.18 + 0.1 would fall just short of 0.27
  });

  it('lines laid out automatically: the line spacing opened just enough, or a line moved', () => {
    const p = proj({ text: 'JUST\nAMAZE', capHeight: 25, lineSpacing: 26, panelWidth: 300, panelHeight: 150 });
    const list = collisions(everyFixCures(p));
    expect(list.length).toBeGreaterThan(0);
    const all = list.flatMap(labels);
    expect(all.some((t) => /^Open the line spacing to \d+(\.5)? mm$/.test(t))).toBe(true);
    expect(all.some((t) => /^Move line 2 down \d+(\.5)? mm$/.test(t))).toBe(true);
  });

  it('a line is moved apart from the other as a whole: one move parts every pair of their letters', () => {
    // The round letters overshoot the cap line and baseline, so every letter meets the one below.
    const p = proj({ text: 'MOON\nMOON', capHeight: 20, lineSpacing: 19.5, panelWidth: 200, panelHeight: 100 });
    const between = collisions(everyFixCures(p)).filter((q) => q.stage === 'write');
    expect(between.length).toBeGreaterThan(1);
    const moves = new Set(between.map((q) => q.fixes.find((f) => f.id.startsWith('move-line:1:'))?.id));
    expect(moves.size).toBe(1);
    const move = between[0].fixes.find((f) => f.id.startsWith('move-line:1:'))!;
    expect(findCollisions(lay({ ...p, ...move.change }), 0.5).filter((c) => c.a.line !== c.b.line)).toEqual([]);
  });

  it('no fix pushes a line further off the board or past a margin than it was', () => {
    // Too big for the panel: the lines already run off it, top and bottom.
    const list = collisions(everyFixCures(proj({ text: 'JUST\nAMAZE', capHeight: 40, lineSpacing: 20, panelWidth: 100, panelHeight: 50 })));
    expect(list.length).toBeGreaterThan(0);
    expect(list.flatMap(labels).filter((t) => /^Move line 2 down|^Move line 1 up|^Open the line spacing/.test(t))).toEqual([]);
  });

  it('locked lines are not moved: one is unlocked only where nothing else puts it right, and that cures it', () => {
    const lock = (x: Project['lines'][string]) => ({ ...x, locked: true });
    const both = { ...BRIAN, lines: { '2': lock(BRIAN.lines['2']), '4': lock(BRIAN.lines['4']) } };
    const jm = (p: Project) => collisions(everyFixCures(p)).find((q) => q.stage === 'write');
    // Freeing line 2 brings it back to the centre; freeing line 3 drops it 0.85 mm, just clear of the J's tail.
    expect(labels(jm(both))).toEqual(['Unlock line 2 and return it to auto', 'Unlock line 3 and return it to auto']);
    const one = { ...BRIAN, lines: { '2': lock(BRIAN.lines['2']), '4': BRIAN.lines['4'] } };
    expect(labels(jm(one))).toEqual(['Move line 3 down 1.5 mm', 'Return line 3 to auto']); // line 2 is not moved
  });

  it('the same pair twice on a line is told apart', () => {
    const list = collisions(everyFixCures(proj({ text: 'AMAM', capHeight: 31.5, letterSpacing: -0.5, panelWidth: 250, panelHeight: 80 })));
    expect(list.map((q) => q.text)).toEqual(['The A and M in line 1 touch (1st of 2).', 'The M and A in line 1 touch.', 'The A and M in line 1 touch (2nd of 2).']);
  });

  it('several gaps colliding for one reason: the letter spacing opened just enough to part every one', () => {
    const p = proj({ text: 'AMAZE\nMAMBA', capHeight: 25, letterSpacing: -1, lineSpacing: 40, panelWidth: 250, panelHeight: 120 });
    const list = collisions(everyFixCures(p));
    expect(list.length).toBeGreaterThan(2);
    const wide = list[0].fixes.find((f) => f.id.startsWith('letter-spacing:'))!;
    expect(list.every((q) => q.fixes.some((f) => f.id === wide.id))).toBe(true);
    expect(findCollisions(lay({ ...p, ...wide.change }))).toEqual([]);
    // No wider fix for a single collision.
    expect(collisions(problemsOf(proj({ text: 'AM', letterSpacing: -1 })))[0].fixes.map((f) => f.id)).toEqual(['open-gap:0:1:1']);
  });

  it('a clean layout shows no collisions: real inscriptions with punctuation, numerals and blank lines', () => {
    for (const text of ['IN MEMORY OF\nJOHN SMITH\nA.D. 1890 – 1916', 'No. 1312\n\n“LEST WE FORGET”', 'THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG', 'OAK']) {
      const p = proj({ text, panelWidth: 600, panelHeight: 300 });
      expect(collisions(problemsOf(p)), text).toEqual([]);
    }
  }, 60_000); // the first sight of each letter works out its valley lines

  it('without the trials, collisions are listed straight away, their fixes still to come', () => {
    const q = collisions(layoutProblems(lay(BRIAN), has))[1];
    expect(q.text).toBe('The J in line 2 runs into the M in line 3.');
    expect(q.trying).toBe(true);
    expect(q.fixes).toEqual([]);
  });
});
