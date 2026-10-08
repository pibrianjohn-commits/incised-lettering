// Every problem with the job, gathered in one list for the warnings badge in
// the status bar. Each says which stage of the job it is put right in, and
// offers one-click fixes (carried out by main.ts, each one step to undo).

import { cutWidth, findCollisions, HAIRLINE, parting, type Collision } from './collisions';
import type { Pt } from './geometry';
import { contentBox, gapKey, isBlank, KERN_CAP, kernKept, kernMm, lineAnchor, lineNumber, type Layout, type LinePlacement, type PlacedLetter, type PlacedLine, type Project } from './layout';
import { LINK_OVERLAP, THIN_JOINT } from './links';
import { BED, BED_EXTENDED, bedFit, bedScale, letteringBox, shrinkToFit } from './panel';
import type { Check, MachineSettings, Pass } from './toolpath';

export type Stage = 'write' | 'space' | 'panel' | 'machine' | '3d';

/**
 * A one-click fix. The id says what to do, with any figure it needs after a
 * colon (a line's place in the text, a measurement in mm); the label says it
 * in words on the button.
 */
export interface Fix {
  id: string;
  label: string;
  /**
   * The change to the job that was tried on a copy of the layout before the
   * fix was offered (CLAUDE.md, "Every fix is tried before it is offered"):
   * it is exactly what the button does.
   */
  change?: Partial<Project>;
  /** What the status bar says once it is done. */
  done?: string;
}

export interface Problem {
  /** 'bad' stops the G-code being saved or spoils the work; 'warn' wants a look. */
  level: 'bad' | 'warn';
  text: string;
  stage: Stage;
  /** What kind of problem, so the G-code checks can borrow its fixes ('app': the app itself, not the job). */
  kind: 'letters' | 'room' | 'edges' | 'collision' | 'link' | 'bed' | 'picture' | 'machine' | 'app';
  fixes: Fix[];
  /** The actual reason, folded under "Details", for a problem with the app itself. */
  details?: string;
  /** Names the problem from one moment to the next (a collision: its pair of letters). */
  key?: string;
  /**
   * The plain facts it is made of (a line past a side, a pair of letters
   * touching), to tell whether a fix tried on a copy causes a new problem.
   */
  facts?: string[];
  /** How far some facts go, mm (a line past a side by so much), to tell whether a fix makes the problem worse. */
  sizes?: Record<string, number>;
  /** Where it is on the panel, mm: marked there when the problem is clicked. */
  spot?: Pt;
  /** Its fixes are still being tried; they follow a moment behind. */
  trying?: boolean;
}

type Side = 'left' | 'right' | 'top' | 'bottom';
const SIDES: Side[] = ['left', 'right', 'top', 'bottom'];

/** A measurement for a problem's text: to 0.1 mm, but never "0.0 mm". */
const mm = (v: number) => (v < 0.05 ? 'less than 0.1 mm' : `${v.toFixed(1)} mm`);

/** "1", "1 and 3", "1, 3 and 4". */
const listed = (n: (number | string)[]) => (n.length < 2 ? `${n[0]}` : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`);

/** The fix that takes every one of a character out of the text. */
const removeChar = (ch: string): Fix => ({ id: `remove-char:${ch}`, label: `Take “${ch}” out of the text` });

/** "the right by 2.0 mm", or "the left, right and top, by up to 4.5 mm", with `noun` after the sides. */
function sidesPhrase(amounts: Partial<Record<Side, number>>, upTo: boolean, noun: [string, string]): string {
  const sides = SIDES.filter((s) => amounts[s] !== undefined);
  const most = Math.max(...sides.map((s) => amounts[s]!));
  const names = sides.length < 2 ? sides[0] : `${sides.slice(0, -1).join(', ')} and ${sides[sides.length - 1]}`;
  const one = sides.length < 2;
  return `the ${names}${one ? noun[0] : noun[1]}${one ? '' : ','} by ${upTo || !one ? 'up to ' : ''}${mm(most)}`;
}

/** The fixes that fit the lettering to the panel, or the panel to the lettering. */
export const FIT_LETTERING: Fix = { id: 'fit-lettering', label: 'Fit lettering to panel' };
export const FIT_PANEL: Fix = { id: 'fit-panel', label: 'Fit panel to lettering' };

/**
 * Problems that can be seen from the layout itself. With `quick` set, only
 * which problems there are is wanted (their facts, for trying a fix on a
 * copy): letters that collide are found but not measured.
 */
export function layoutProblems(layout: Layout, hasLetter: (ch: string) => boolean, quick = false): Problem[] {
  const p = layout.project;
  const out: Problem[] = [];
  const hasLettering = layout.lines.some((l) => l.ink);

  const missing = [...new Set([...p.text].filter((ch) => !/\s/.test(ch) && !hasLetter(ch)))];
  if (missing.length) {
    const fixes: Fix[] = [];
    // An alphabet of capitals only, and small letters typed: offer the capitals.
    if (missing.every((ch) => ch.toUpperCase() !== ch && hasLetter(ch.toUpperCase()))) {
      fixes.push({ id: 'caps', label: missing.length > 1 ? 'Change them to capitals' : 'Change it to a capital' });
    }
    fixes.push({ id: 'remove-missing', label: missing.length > 1 ? 'Take them out of the text' : 'Take it out of the text' });
    out.push({
      level: 'warn',
      stage: 'write',
      kind: 'letters',
      text: `Not in the alphabet, so left as a space: ${missing.join(' ')}`,
      fixes,
      facts: missing.map((ch) => `missing:${ch}`),
    });
  }

  // Letters that could not be worked out at all: left as spaces, the rest carries on.
  if (layout.failed?.length) {
    const named = layout.failed.map((f) => `“${f.char}” on line ${lineNumber(layout, f.line)}`);
    const chars = [...new Set(layout.failed.map((f) => f.char))];
    out.push({
      level: 'bad',
      stage: 'write',
      kind: 'letters',
      text: `${listed(named)} could not be worked out, so ${named.length > 1 ? 'they are' : 'it is'} left as a space.`,
      fixes: chars.map((ch) => removeChar(ch)),
      facts: layout.failed.map((f) => `failed:${f.char}:${f.line}`),
    });
  }

  const box = contentBox(p);
  const room = box.x1 > box.x0 && box.y1 > box.y0;
  if (!room) {
    out.push({
      level: 'bad',
      stage: 'panel',
      kind: 'room',
      text: 'The border and margins leave no room for the lettering.',
      fixes: hasLettering ? [FIT_PANEL] : [{ id: 'panel-default', label: 'Return the panel, border and margins to the starting sizes' }],
      facts: ['room'],
    });
  }

  // Each line that runs past a margin or off the board, side by side. Margins
  // are measured to the letters' ends and from cap line to baseline; the board's
  // edges to the letters themselves, overshoots and word stops included.
  const k = p.capHeight;
  const shrink = shrinkToFit(layout);
  const ink = letteringBox(layout);
  interface Spill {
    lines: number[];
    indexes: number[];
    off: Partial<Record<Side, number>>;
    past: Partial<Record<Side, number>>;
    /** The line is placed by hand (one line to a problem then, so it can be fixed on its own). */
    placed: boolean;
    locked: boolean;
    fits: boolean;
    /** Each line and side it runs past ("edge:…"), and off the board ("off:…" as well). */
    facts: string[];
    /** How far past each side, mm. */
    sizes: Record<string, number>;
  }
  const spills: Spill[] = [];
  for (const line of layout.lines) {
    if (!line.ink) continue;
    const letters = layout.letters.filter((l) => l.line === line.index);
    const xs: number[] = [];
    const ys: number[] = [];
    for (const l of letters) xs.push(l.box.x0, l.box.x1), ys.push(l.box.y0, l.box.y1);
    for (const s of layout.stops) if (s.line === line.index) for (const c of s.outline) for (const q of c) xs.push(q.x), ys.push(q.y);
    const off: Partial<Record<Side, number>> = {};
    const past: Partial<Record<Side, number>> = {};
    const edge: Record<Side, number> = {
      left: -Math.min(...xs),
      right: Math.max(...xs) - p.panelWidth,
      top: -Math.min(...ys),
      bottom: Math.max(...ys) - p.panelHeight,
    };
    const margin: Record<Side, number> = room
      ? { left: box.x0 - line.ink.x0, right: line.ink.x1 - box.x1, top: box.y0 - (line.baselineY - k), bottom: line.baselineY - box.y1 }
      : { left: 0, right: 0, top: 0, bottom: 0 };
    for (const s of SIDES) {
      if (edge[s] > 0.01) off[s] = edge[s];
      else if (margin[s] > 0.01) past[s] = margin[s];
    }
    if (!Object.keys(off).length && !Object.keys(past).length) continue;
    const facts = [
      ...SIDES.filter((s) => off[s] !== undefined || past[s] !== undefined).map((s) => `edge:${line.index}:${s}`),
      ...SIDES.filter((s) => off[s] !== undefined).map((s) => `off:${line.index}:${s}`),
    ];
    const sizes = Object.fromEntries(SIDES.filter((s) => off[s] !== undefined || past[s] !== undefined).map((s) => [`edge:${line.index}:${s}`, Math.max(edge[s], margin[s])]));
    const fits = room && line.ink.x1 - line.ink.x0 <= box.x1 - box.x0 + 1e-6 && k <= box.y1 - box.y0 + 1e-6;
    const n = line.number ?? line.index + 1;
    // Lines laid out automatically share one cause (the lettering is too big
    // for the space), so they make one problem; each line placed by hand its own.
    const same = !line.placed && spills.find((g) => !g.placed);
    if (same) {
      same.lines.push(n);
      same.indexes.push(line.index);
      same.facts.push(...facts);
      Object.assign(same.sizes, sizes);
      for (const s of SIDES) {
        if (off[s] !== undefined) same.off[s] = Math.max(same.off[s] ?? 0, off[s]!);
        if (past[s] !== undefined) same.past[s] = Math.max(same.past[s] ?? 0, past[s]!);
      }
    } else spills.push({ lines: [n], indexes: [line.index], off, past, placed: line.placed, locked: line.locked, fits, facts, sizes });
  }
  // A side off the board for one line needs no mention as past the margin for another.
  for (const g of spills) for (const s of SIDES) if (g.off[s] !== undefined) delete g.past[s];
  for (const g of spills) {
    const one = g.lines.length === 1;
    const who = one ? `Line ${g.lines[0]} runs` : `Lines ${listed(g.lines)} run`;
    const offText = Object.keys(g.off).length ? `off the board at ${sidesPhrase(g.off, !one, ['', ''])}` : '';
    const pastText = Object.keys(g.past).length ? `past ${sidesPhrase(g.past, !one, [' margin', ' margins'])}` : '';
    const fixes: Fix[] = [];
    if (g.placed) {
      const n = g.lines[0];
      const i = g.indexes[0];
      if (g.fits) fixes.push({ id: `inside-line:${i}`, label: `Move line ${n} inside the margins` });
      if (!g.locked) fixes.push({ id: `auto-line:${i}`, label: `Return line ${n} to auto` });
    }
    // Shrink the lettering when it is too big for the space; else, with no
    // line of its own to move, it must be out of place: fitting puts it right.
    if (room && ink && (shrink < 1 || !fixes.length)) fixes.push(FIT_LETTERING);
    fixes.push(FIT_PANEL);
    out.push({
      level: offText ? 'bad' : 'warn',
      stage: 'panel',
      kind: 'edges',
      text: `${who} ${[offText, pastText].filter(Boolean).join(', and ')}.`,
      fixes,
      facts: g.facts,
      sizes: g.sizes,
    });
  }

  // Letters that run into each other, on the same line or different lines.
  // Their fixes are tried on a copy of the layout before they are offered
  // (tryFixes), so they follow a moment behind.
  out.push(...collisionProblems(layout, clearanceOf(p), quick));
  // Linked letters: a joint too thin to chisel, and letters that could not be joined.
  out.push(...linkProblems(layout));

  const fit = bedFit(p.panelWidth, p.panelHeight);
  const toStandard: Fix = { id: 'bed-standard', label: `Shrink everything to fit the bed (${BED.width} × ${BED.height} mm)` };
  if (fit === 'extended') {
    out.push({
      level: 'warn',
      stage: 'panel',
      kind: 'bed',
      text: `The panel needs the extended bed (${BED_EXTENDED.width} × ${BED_EXTENDED.height} mm).`,
      fixes: [toStandard],
      facts: ['bed'],
    });
  } else if (fit === 'too-big') {
    out.push({
      level: 'bad',
      stage: 'panel',
      kind: 'bed',
      text: `The panel is too big for the machine, even with the extended bed (${BED_EXTENDED.width} × ${BED_EXTENDED.height} mm).`,
      // Offer the extended bed only when it lets the work stay bigger.
      fixes:
        bedScale(p.panelWidth, p.panelHeight, BED_EXTENDED) > bedScale(p.panelWidth, p.panelHeight, BED) + 1e-9
          ? [{ id: 'bed-extended', label: `Shrink everything to fit the extended bed (${BED_EXTENDED.width} × ${BED_EXTENDED.height} mm)` }, toStandard]
          : [toStandard],
      facts: ['bed', 'bed:too-big'],
    });
  }
  return out;
}

// ---------------------------------------------------------------- letters that collide

/**
 * How close two letters may come: the width the hairline cuts, from the job's
 * own hairline depth and bit, or the starting hairline where there are none
 * (so the check stands without the machine settings: CLAUDE.md, "One program;
 * editions later").
 */
export function clearanceOf(p: Project): number {
  const m = p.machine;
  const w = m ? cutWidth(m.hairlineDepth, m.toolAngle) : NaN;
  return Number.isFinite(w) && w > 0 ? w : HAIRLINE;
}

/**
 * Letters moved apart are parted this far, mm, so the wood left between them
 * can be chiselled (BRIEF.md, Decisions: "Room between letters"); a line's
 * move is rounded up to the next LINE_STEP, a gap's to the next KERN_STEP.
 */
const SPARE = 0.5;
const LINE_STEP = 0.5;
const KERN_STEP = 0.1;
/** How far apart two letters are parted: SPARE, or a little more than the hairline is wide where that is wider. */
const partTarget = (clearance: number) => Math.max(SPARE, clearance + 0.05);

/** A character named in a sentence: a letter or figure as it is, anything else in quotes. */
const named = (ch: string) => (/[\p{L}\p{N}]/u.test(ch) ? ch : `“${ch}”`);
/** A placed letter named in a sentence: letters linked into one shape as "linked AM". */
const letterName = (l: PlacedLetter) => (l.span > 1 ? `linked ${[...l.char].map(named).join('')}` : named(l.char));
/** The character that meets another, named in a sentence: in linked letters, "M of the linked AMA". */
const partName = (l: PlacedLetter, c: { char: string }) => (l.span > 1 ? `${named(c.char)} of the ${letterName(l)}` : named(c.char));
/** The last and first characters of two placed letters side by side (linked letters are several). */
const lastChar = (l: PlacedLetter) => [...l.char].at(-1)!;
const firstChar = (l: PlacedLetter) => [...l.char][0];
/** Two letters side by side on a line, with nothing between them: a pair that could be linked. */
const neighbours = (c: Collision) => c.a.line === c.b.line && c.b.pos === c.a.pos + c.a.span;
/** A figure for a fix's label, to the step it was worked out in: "1.5", "0", "-0.2". */
const figure = (v: number) => String(Math.round(v * 100) / 100 || 0);
const ordinal = (k: number) => `${k}${k % 100 >= 11 && k % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][k % 10] ?? 'th'}`;

function collisionText(layout: Layout, c: Collision): string {
  const la = lineNumber(layout, c.a.line);
  const lb = lineNumber(layout, c.b.line);
  const within = `within ${c.gap < 0.01 ? 'less than 0.01' : c.gap.toFixed(2)} mm`;
  const [a, b] = [partName(c.a, c.ca), partName(c.b, c.cb)];
  if (c.a.line === c.b.line) {
    return c.touch
      ? `The ${a} and ${b} in line ${la} touch`
      : `The ${a} and ${b} in line ${la} come ${within} of each other, so their hairlines would run together`;
  }
  return c.touch
    ? `The ${a} in line ${la} runs into the ${b} in line ${lb}`
    : `The ${a} in line ${la} comes ${within} of the ${b} in line ${lb}, so their hairlines would run together`;
}

/**
 * One problem for each pair of letters that collide (BRIEF.md, Decisions:
 * "Collisions"), with no fixes yet: those are tried first (tryFixes).
 */
function collisionProblems(layout: Layout, clearance: number, quick = false): Problem[] {
  const cs = findCollisions(layout, clearance, quick);
  const texts = cs.map((c) => collisionText(layout, c));
  const count = new Map<string, number>();
  for (const t of texts) count.set(t, (count.get(t) ?? 0) + 1);
  const seen = new Map<string, number>();
  return cs.map((c, i): Problem => {
    const t = texts[i];
    const n = count.get(t)!;
    const k = (seen.get(t) ?? 0) + 1;
    seen.set(t, k);
    return {
      level: 'warn',
      // Lines are moved apart in Write; letters on one line are spaced in Space.
      stage: c.a.line === c.b.line ? 'space' : 'write',
      kind: 'collision',
      // The same pair twice over is told apart by its place in reading order.
      text: `${t}${n > 1 ? ` (${ordinal(k)} of ${n})` : ''}.`,
      fixes: [],
      key: `collide:${c.key}`,
      facts: [`collide:${c.key}`],
      spot: c.spot,
      trying: true,
    };
  });
}

/** Where a line is now, as a placement (an auto line's is worked out from its layout). */
function placementOf(p: Project, line: PlacedLine): LinePlacement {
  return p.lines[String(line.index)] ?? { x: lineAnchor(line.x0, p.align, line.width), align: p.align, baseline: line.baselineY };
}

const lineName = (line: PlacedLine) => line.number ?? line.index + 1;

function moveLineFix(p: Project, line: PlacedLine, dy: number): Fix {
  const place = placementOf(p, line);
  const n = lineName(line);
  const way = dy > 0 ? 'down' : 'up';
  const by = figure(Math.abs(dy));
  return {
    id: `move-line:${line.index}:${figure(dy)}`,
    label: `Move line ${n} ${way} ${by} mm`,
    change: { lines: { ...p.lines, [String(line.index)]: { ...place, baseline: Math.round((place.baseline + dy) * 1000) / 1000 } } },
    done: `Line ${n} moved ${way} ${by} mm. Ctrl+Z undoes it.`,
  };
}

function autoLineFix(p: Project, line: PlacedLine): Fix {
  const lines = { ...p.lines };
  delete lines[String(line.index)];
  const n = lineName(line);
  return {
    id: `auto-line:${line.index}`,
    label: line.locked ? `Unlock line ${n} and return it to auto` : `Return line ${n} to auto`,
    change: { lines },
    done: `Line ${n} returned to auto: it follows the line spacing and alignment again. Ctrl+Z undoes it.`,
  };
}

/** The two lines of a pair of letters on different lines, the upper first. */
function linesOf(layout: Layout, c: Collision): [PlacedLine, PlacedLine] {
  const a = layout.lines[c.a.line];
  const b = layout.lines[c.b.line];
  return a.baselineY <= b.baselineY ? [a, b] : [b, a];
}

/**
 * How far two lines must be moved apart to part every pair of their letters
 * that collide, with SPARE to spare: to the next LINE_STEP (`n`), and as
 * worked out (`raw`, for the line spacing). It pauses after each pair.
 */
function* partLines(layout: Layout, pairs: Collision[], clearance: number): Generator<void, { n: number | null; raw: number | null }, void> {
  const limit = Math.max(50, 3 * layout.project.capHeight);
  const target = partTarget(clearance);
  let n: number | null = 0;
  let raw: number | null = 0;
  for (const c of pairs) {
    const [up] = linesOf(layout, c);
    const [upper, lower] = c.a.line === up.index ? [c.a, c.b] : [c.b, c.a];
    const exact = parting(upper, lower, { x: 0, y: 1 }, target, 0.01, limit);
    yield;
    raw = exact === null || raw === null ? null : Math.max(raw, exact);
  }
  // Rounded up to the step; the fix is tried before it is offered all the same.
  if (raw !== null) n = Math.ceil(raw / LINE_STEP - 1e-9) * LINE_STEP;
  else n = null;
  return { n, raw };
}

/**
 * The fixes worth trying for one pair of letters; `unlock` marks those that
 * free a locked line, offered only if nothing else works. Lines are moved
 * apart by `apart` (partLines, for every pair between the same two lines).
 * It pauses (yields) after each search for how far to part the letters.
 */
function* collisionCandidates(layout: Layout, c: Collision, clearance: number, apart: { n: number | null; raw: number | null } | null): Generator<void, { fix: Fix; unlock?: boolean }[], void> {
  const p = layout.project;
  const limit = Math.max(50, 3 * p.capHeight);
  const out: { fix: Fix; unlock?: boolean }[] = [];
  if (c.a.line !== c.b.line) {
    // Between lines: part them up and down, with SPARE to spare.
    const [up, down] = linesOf(layout, c);
    const n = apart?.n;
    if (n) {
      if (!down.locked) out.push({ fix: moveLineFix(p, down, n) });
      if (!up.locked) out.push({ fix: moveLineFix(p, up, -n) });
    }
    if (!up.placed && !down.placed) {
      // Opening the line spacing acts on every step between them but blank lines given their own height.
      const texts = p.text.replace(/\r/g, '').split('\n');
      const i0 = Math.min(up.index, down.index);
      const steps = texts.slice(i0, Math.max(up.index, down.index)).filter((t, j) => !(isBlank(t) && String(i0 + j) in p.spacers)).length;
      const raw = steps ? apart?.raw : null;
      const ls = raw ? Math.ceil((p.lineSpacing + raw / steps) / LINE_STEP - 1e-9) * LINE_STEP : 0;
      if (raw && ls <= 250) {
        // (Within the line-spacing setting's limit.)
        out.push({
          fix: { id: `line-spacing:${figure(ls)}`, label: `Open the line spacing to ${figure(ls)} mm`, change: { lineSpacing: ls }, done: `Line spacing opened to ${figure(ls)} mm. Ctrl+Z undoes it.` },
        });
      }
    }
    for (const q of [up, down]) if (q.placed && !q.locked) out.push({ fix: autoLineFix(p, q) });
    for (const q of [up, down]) if (q.locked) out.push({ fix: autoLineFix(p, q), unlock: true });
  } else {
    // On one line: open the gap after the first letter, enough to part them with SPARE to spare.
    const g = layout.gaps.find((x) => x.left === c.a && !x.link);
    const n = g ? parting(c.a, c.b, { x: 1, y: 0 }, partTarget(clearance), KERN_STEP, limit) : null;
    yield;
    if (g && n) {
      const gapKerning = { ...p.gapKerning, [g.key]: { pair: g.pair, mm: kernKept(g.gapKern + n, p.capHeight) } };
      const line = lineName(layout.lines[c.a.line]);
      out.push({
        fix: {
          id: `open-gap:${g.key}:${figure(n)}`,
          label: g.right === c.b ? `Open this gap ${figure(n)} mm` : `Open the gap after the ${letterName(c.a)} ${figure(n)} mm`,
          change: { gapKerning },
          done: `The gap after the ${letterName(c.a)} in line ${line} opened ${figure(n)} mm. Ctrl+Z undoes it.`,
        },
      });
    }
    // Neighbours may be linked on purpose instead (BRIEF.md, Decisions: "Linked letters", rule 7).
    if (neighbours(c)) out.push({ fix: linkFix(layout, [c]) });
  }
  return out;
}

/**
 * Link neighbours that touch into one shape. They go in deep enough for a
 * joint that can be chiselled (the starting overlap, or more if the joint
 * would be too thin), so the link causes no new problem of its own.
 */
function linkFix(layout: Layout, pairs: Collision[]): Fix {
  const p = layout.project;
  const overlap = Math.max(LINK_OVERLAP, THIN_JOINT);
  const links = { ...p.links };
  for (const c of pairs) links[gapKey(c.a.line, c.b.pos)] = { pair: lastChar(c.a) + firstChar(c.b), overlap };
  const by = figure(kernMm(overlap, p.capHeight));
  if (pairs.length === 1) {
    const c = pairs[0];
    return {
      id: `link:${gapKey(c.a.line, c.b.pos)}`,
      label: 'Link them',
      change: { links },
      done: `The ${lastChar(c.a)} and ${firstChar(c.b)} in line ${lineName(layout.lines[c.a.line])} are linked, overlapping ${by} mm: Unlink in the gap's tools parts them. Ctrl+Z undoes it.`,
    };
  }
  return {
    id: `link-every:${pairs.map((c) => gapKey(c.a.line, c.b.pos)).join(',')}`,
    label: 'Link every pair that touches',
    change: { links },
    done: `${pairs.length} pairs of letters linked, each overlapping ${by} mm. Ctrl+Z undoes it.`,
  };
}

/**
 * Linked letters (BRIEF.md, Decisions: "Linked letters"): a joint too thin
 * to chisel (rule 6), and links whose letters could not be joined, which are
 * cut as separate letters.
 */
function linkProblems(layout: Layout): Problem[] {
  const p = layout.project;
  const thin = (THIN_JOINT * p.capHeight) / KERN_CAP;
  const out: Problem[] = [];
  for (const l of layout.letters) {
    if (!l.joints) continue;
    const chars = [...l.char];
    l.joints.forEach((j, n) => {
      if (j.width >= thin - 1e-6) return;
      const key = gapKey(l.line, l.pos + n + 1);
      out.push({
        level: 'warn',
        stage: 'space',
        kind: 'link',
        text: `The ${named(chars[n])} and ${named(chars[n + 1])} in line ${lineNumber(layout, l.line)} are joined by only ${mm(j.width)}.`,
        fixes: [],
        key: `thin:${key}`,
        facts: [`thin:${key}`],
        spot: j.at,
        trying: true,
      });
    });
  }
  for (const u of layout.unjoined) {
    const [a, b] = [...u.pair];
    out.push({
      level: 'warn',
      stage: 'space',
      kind: 'link',
      text: `The linked ${named(a)} and ${named(b)} in line ${lineNumber(layout, u.line)} could not be joined into one shape, so they are cut as separate letters.`,
      fixes: [],
      key: `unjoined:${u.key}`,
      facts: [`unjoined:${u.key}`],
      trying: true,
    });
  }
  return out;
}

/** The fixes worth trying for a problem with linked letters. */
function linkCandidates(layout: Layout, key: string): { fix: Fix }[] {
  const p = layout.project;
  const [what, gap] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  const link = p.links[gap];
  if (!link) return [];
  const [a, b] = [...link.pair];
  const line = lineName(layout.lines[Number(gap.split(':')[0])]);
  const links = { ...p.links };
  delete links[gap];
  const unlink: Fix = { id: `unlink:${gap}`, label: 'Unlink them', change: { links }, done: `The ${named(a)} and ${named(b)} in line ${line} are no longer linked. Ctrl+Z undoes it.` };
  if (what === 'unjoined') return [{ fix: unlink }];
  // Too thin: in deeper, to the next 0.1 mm at this size, until the joint is wide enough.
  const k = p.capHeight;
  const l = layout.letters.find((x) => x.joints && x.line === Number(gap.split(':')[0]) && x.pos < Number(gap.split(':')[1]) && x.pos + x.span > Number(gap.split(':')[1]));
  const j = l?.joints?.[Number(gap.split(':')[1]) - l.pos - 1];
  if (!j) return [];
  const more = Math.ceil(((THIN_JOINT * k) / KERN_CAP - j.width) / KERN_STEP - 1e-9) * KERN_STEP;
  return [
    {
      fix: {
        id: `overlap:${gap}:${figure(more)}`,
        label: `Overlap them ${figure(more)} mm more`,
        change: { links: { ...p.links, [gap]: { ...link, overlap: Math.round((link.overlap + kernKept(more, k)) * 1e4) / 1e4 } } },
        done: `The ${named(a)} and ${named(b)} in line ${line} overlap ${figure(more)} mm more. Ctrl+Z undoes it.`,
      },
    },
  ];
}

/**
 * Where several gaps collide for one reason, such as letter spacing set
 * tight: the letter spacing opened enough to part every pair, with SPARE to spare.
 */
function* letterSpacingFix(layout: Layout, sameLine: Collision[], clearance: number): Generator<void, Fix | null, void> {
  const p = layout.project;
  const limit = Math.max(50, 3 * p.capHeight);
  let need = 0;
  for (const c of sameLine) {
    const s = parting(c.a, c.b, { x: 1, y: 0 }, partTarget(clearance), 0.01, limit);
    yield;
    if (s === null) return null;
    // Letter spacing is added after every character between them, spaces too (but not inside linked letters).
    need = Math.max(need, s / Math.max(1, c.b.pos - (c.a.pos + c.a.span - 1)));
  }
  const ls = Math.ceil((p.letterSpacing + need) / KERN_STEP - 1e-9) * KERN_STEP;
  if (ls > 15) return null; // past the letter-spacing setting's limit
  return { id: `letter-spacing:${figure(ls)}`, label: `Open the letter spacing to ${figure(ls)} mm`, change: { letterSpacing: Number(figure(ls)) }, done: `Letter spacing opened to ${figure(ls)} mm. Ctrl+Z undoes it.` };
}

/**
 * Tries each fix for the letters that collide, and for linked letters, on a
 * copy of the layout, and keeps only those that cure the problem they are
 * listed under without causing a new one or making one worse (CLAUDE.md,
 * "Every fix is tried before it is offered"). It yields after each step, so
 * the page can do it a little at a time, and puts the fixes for each problem
 * in `fixes` by its key as soon as they are known, so they can be shown as
 * they come. `relayout` lays out a changed copy of the job; it must not wait
 * on working out new linked letters (layoutPanel's 'outline' shapes): their
 * outlines are all a trial needs.
 */
export function* tryFixes(layout: Layout, hasLetter: (ch: string) => boolean, relayout: (p: Project) => Layout, fixes = new Map<string, Fix[]>()): Generator<void, Map<string, Fix[]>, void> {
  const p = layout.project;
  const clearance = clearanceOf(p);
  // Which letters collide is all that is needed here, not how far.
  const collisions = findCollisions(layout, clearance, true);
  const linkKeys = linkProblems(layout).map((q) => q.key!);
  if (!collisions.length && !linkKeys.length) return fixes;
  yield;
  const now = layoutProblems(layout, hasLetter, true);
  const before = new Set(now.flatMap((q) => q.facts ?? []));
  const sizes: Record<string, number> = Object.assign({}, ...now.map((q) => q.sizes ?? {}));
  yield;
  // What each fix leaves, by its id: the facts of every problem after it, or null if it could not be worked out
  // or it makes a problem there was already worse (a line further past a side).
  const tried = new Map<string, Set<string> | null>();
  /** Try each candidate once, and keep for the problem `key` those that cure it and cause nothing new. */
  function* judge(key: string, candidates: { fix: Fix; unlock?: boolean }[]): Generator<void, void, void> {
    const offered: Fix[] = [];
    const unlocks: Fix[] = [];
    for (const { fix, unlock } of candidates) {
      if (!tried.has(fix.id)) {
        yield;
        let after: Set<string> | null = null;
        try {
          const copy = relayout({ ...p, ...fix.change });
          yield;
          const then = layoutProblems(copy, hasLetter, true);
          const worse = then.some((q) => Object.entries(q.sizes ?? {}).some(([f, v]) => v > (sizes[f] ?? 0) + 0.05));
          after = worse ? null : new Set(then.flatMap((q) => q.facts ?? []));
        } catch (err) {
          console.error(`Could not try “${fix.label}”:`, err);
        }
        tried.set(fix.id, after);
      }
      const after = tried.get(fix.id);
      if (!after || after.has(key) || [...after].some((f) => !before.has(f))) continue;
      (unlock ? unlocks : offered).push(fix);
    }
    // A locked line is freed only when nothing else puts it right.
    fixes.set(key, offered.length ? offered : unlocks);
  }

  const sameLine = collisions.filter((c) => c.a.line === c.b.line);
  const wide = sameLine.length > 1 ? yield* letterSpacingFix(layout, sameLine, clearance) : null;
  // Neighbours that touch, linked all at once where there are several.
  const touching = collisions.filter(neighbours);
  const linkEvery = touching.length > 1 ? linkFix(layout, touching) : null;
  // Lines are parted from each other as a whole: how far, for each two lines that meet.
  const apart = new Map<string, { n: number | null; raw: number | null }>();
  const between = (c: Collision) => linesOf(layout, c).map((l) => l.index).join('|');
  for (const c of collisions) {
    let part: { n: number | null; raw: number | null } | null = null;
    if (c.a.line !== c.b.line) {
      const key = between(c);
      if (!apart.has(key)) apart.set(key, yield* partLines(layout, collisions.filter((x) => x.a.line !== x.b.line && between(x) === key), clearance));
      part = apart.get(key)!;
    }
    const candidates = yield* collisionCandidates(layout, c, clearance, part);
    if (wide && c.a.line === c.b.line) candidates.push({ fix: wide });
    if (linkEvery && neighbours(c)) candidates.push({ fix: linkEvery });
    yield* judge(`collide:${c.key}`, candidates);
  }
  for (const key of linkKeys) yield* judge(key, linkCandidates(layout, key));
  return fixes;
}

/** Every fix tried at once, for when there is no page to keep moving (the tests). */
export function triedFixes(layout: Layout, hasLetter: (ch: string) => boolean, relayout: (p: Project) => Layout): Map<string, Fix[]> {
  const run = tryFixes(layout, hasLetter, relayout);
  for (;;) {
    const r = run.next();
    if (r.done) return r.value;
  }
}

/** Puts the tried fixes on the problems they belong to. */
export function attachFixes(list: Problem[], fixes: Map<string, Fix[]>): Problem[] {
  for (const q of list) {
    const f = q.key ? fixes.get(q.key) : undefined;
    if (!f) continue;
    q.fixes = f;
    q.trying = false;
  }
  return list;
}

/** How deep the passes go, by what is cut: the letters' slits, the border, and the fixed-depth lines. */
export interface Depths {
  letters: number;
  border: number;
  fixed: number;
  /** Letters (item ids) whose cuts could not be worked out and are left out. */
  failed: string[];
}

export function passDepths(passes: Pass[]): Depths {
  const d: Depths = { letters: 0, border: 0, fixed: 0, failed: [...new Set(passes.flatMap((q) => q.failed ?? []))] };
  for (const pass of passes)
    for (const cut of pass.cuts) {
      const deepest = Math.max(0, ...cut.points.map((q) => -q.z));
      if (pass.name !== 'slit') d.fixed = Math.max(d.fixed, deepest);
      else if (cut.item === 'border') d.border = Math.max(d.border, deepest);
      else d.letters = Math.max(d.letters, deepest);
    }
  return d;
}

/**
 * The one-click fixes for a failed G-code check. A cut too deep is put right
 * by smaller letters, when the letters are what goes too deep: valley depth
 * grows in step with the letters, so the cap height that brings the deepest
 * slit within `limit` is found directly.
 */
export function checkFixes(c: Check, depths: Depths, m: MachineSettings, capHeight: number): Fix[] {
  const smaller = (limit: number): Fix[] => {
    if (depths.letters <= limit + 1e-9 || Math.max(depths.border, depths.fixed) > limit + 1e-9) return [];
    const cap = Math.floor(capHeight * ((limit + m.slitMargin) / (depths.letters + m.slitMargin)) * 10) / 10;
    return cap > 0 ? [{ id: `cap-height:${cap}`, label: `Make the letters smaller (cap height ${cap} mm)` }] : [];
  };
  switch (c.id) {
    case 'stock':
      return [{ id: 'enter-stock', label: 'Enter the stock thickness' }];
    case 'floor': {
      const fixes = smaller(m.stockThickness - m.safeFloor);
      if (depths.border > m.stockThickness - m.safeFloor + 1e-9) fixes.push({ id: 'go-border', label: 'Change the border' });
      return [...fixes, { id: 'enter-stock', label: 'Change the stock thickness' }];
    }
    case 'bit-depth': {
      const fixes = smaller(m.toolCutDepth);
      if (depths.border > m.toolCutDepth + 1e-9) fixes.push({ id: 'go-border', label: 'Change the border' });
      return [...fixes, { id: 'go-bit-depth', label: 'Change the bit' }];
    }
    case 'angle':
      return [{ id: 'go-bit-angle', label: 'Change the bit' }];
    case 'passes':
      return [{ id: 'all-passes', label: 'Run every pass' }];
    case 'failed': {
      // Take the character out, turn word stops off, or change the border: whichever is to blame.
      const fixes = new Map<string, Fix>();
      for (const id of depths.failed) {
        if (id === 'border') fixes.set('go-border', { id: 'go-border', label: 'Change the border' });
        else if (id.startsWith('word stop')) fixes.set('word-stops-off', { id: 'word-stops-off', label: 'Turn word stops off' });
        else {
          const ch = /^(.*) \(line \d+\)#\d+$/.exec(id)?.[1];
          // (Linked letters are one item of several characters: nothing to take out by name.)
          if (ch && [...ch].length === 1) fixes.set(`remove-char:${ch}`, removeChar(ch));
        }
      }
      return [...fixes.values()];
    }
    default:
      return [];
  }
}

/**
 * The G-code safety checks that fail, as problems. The bed, margin and
 * off-panel checks are left out: layoutProblems already reports those.
 */
export function machineProblems(checks: Check[], depths: Depths, m: MachineSettings, capHeight: number): Problem[] {
  return checks
    .filter((c) => !c.ok && !['bed', 'margins', 'panel', 'pending'].includes(c.id))
    .map(
      (c): Problem => ({
        level: c.id === 'stock' ? 'warn' : c.blocking ? 'bad' : 'warn',
        stage: 'machine',
        kind: 'machine',
        text: c.id === 'stock' ? 'Stock thickness not entered yet: it is needed before the G-code can be saved.' : c.text,
        fixes: checkFixes(c, depths, m, capHeight),
      }),
    );
}

/** The badge: how many problems, and how serious the worst is. */
export function problemSummary(list: Problem[]): { level: 'ok' | 'warn' | 'bad'; text: string } {
  if (!list.length) return { level: 'ok', text: '✓ No problems' };
  const level = list.some((p) => p.level === 'bad') ? 'bad' : 'warn';
  return { level, text: `${level === 'bad' ? '✗' : '!'} ${list.length} problem${list.length > 1 ? 's' : ''}` };
}
