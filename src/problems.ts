// Every problem with the job, gathered in one list for the warnings badge in
// the status bar. Each says which stage of the job it is put right in, and
// offers one-click fixes (carried out by main.ts, each one step to undo).

import { contentBox, isBlank, type Layout } from './layout';
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
}

export interface Problem {
  /** 'bad' stops the G-code being saved or spoils the work; 'warn' wants a look. */
  level: 'bad' | 'warn';
  text: string;
  stage: Stage;
  /** What kind of problem, so the G-code checks can borrow its fixes. */
  kind: 'letters' | 'room' | 'edges' | 'lines' | 'bed' | 'picture' | 'machine';
  fixes: Fix[];
}

type Side = 'left' | 'right' | 'top' | 'bottom';
const SIDES: Side[] = ['left', 'right', 'top', 'bottom'];

/** A measurement for a problem's text: to 0.1 mm, but never "0.0 mm". */
const mm = (v: number) => (v < 0.05 ? 'less than 0.1 mm' : `${v.toFixed(1)} mm`);

/** "1", "1 and 3", "1, 3 and 4". */
const listed = (n: number[]) => (n.length < 2 ? `${n[0]}` : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`);

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

/** Problems that can be seen from the layout itself. */
export function layoutProblems(layout: Layout, hasLetter: (ch: string) => boolean): Problem[] {
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
    const fits = room && line.ink.x1 - line.ink.x0 <= box.x1 - box.x0 + 1e-6 && k <= box.y1 - box.y0 + 1e-6;
    const n = line.number ?? line.index + 1;
    // Lines laid out automatically share one cause (the lettering is too big
    // for the space), so they make one problem; each line placed by hand its own.
    const same = !line.placed && spills.find((g) => !g.placed);
    if (same) {
      same.lines.push(n);
      same.indexes.push(line.index);
      for (const s of SIDES) {
        if (off[s] !== undefined) same.off[s] = Math.max(same.off[s] ?? 0, off[s]!);
        if (past[s] !== undefined) same.past[s] = Math.max(same.past[s] ?? 0, past[s]!);
      }
    } else spills.push({ lines: [n], indexes: [line.index], off, past, placed: line.placed, locked: line.locked, fits });
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
    });
  }

  // Lines whose letters run into each other.
  const bands = layout.lines
    .map((line) => {
      const ls = layout.letters.filter((l) => l.line === line.index);
      if (!ls.length) return null;
      return {
        line,
        n: line.number ?? line.index + 1,
        x0: Math.min(...ls.map((l) => l.box.x0)),
        x1: Math.max(...ls.map((l) => l.box.x1)),
        y0: Math.min(...ls.map((l) => l.box.y0)),
        y1: Math.max(...ls.map((l) => l.box.y1)),
      };
    })
    .filter((b): b is NonNullable<typeof b> => !!b);
  const texts = p.text.replace(/\r/g, '').split('\n');
  for (let i = 0; i < bands.length; i++)
    for (let j = i + 1; j < bands.length; j++) {
      const a = bands[i];
      const b = bands[j];
      if (!(a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1)) continue;
      const fixes: Fix[] = [];
      for (const q of [a, b]) {
        if (q.line.placed && !q.line.locked) fixes.push({ id: `auto-line:${q.line.index}`, label: `Return line ${q.n} to auto` });
      }
      // Only locked lines placed by hand to blame: offer to free one.
      if (!fixes.length) {
        for (const q of [a, b]) {
          if (q.line.locked) fixes.push({ id: `auto-line:${q.line.index}`, label: `Unlock line ${q.n} and return it to auto` });
        }
      }
      if (!a.line.placed && !b.line.placed) {
        // Open the line spacing just enough to part them: it acts on every
        // step between them but blank lines given their own height.
        const steps = texts.slice(a.line.index, b.line.index).filter((t, n) => !(isBlank(t) && String(a.line.index + n) in p.spacers)).length;
        const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        if (steps) {
          const ls = Math.ceil((p.lineSpacing + (overlap + 0.5) / steps) * 2) / 2;
          fixes.push({ id: `line-spacing:${ls}`, label: `Open the line spacing to ${ls} mm` });
        }
      }
      out.push({ level: 'warn', stage: 'write', kind: 'lines', text: `Lines ${a.n} and ${b.n} run into each other.`, fixes });
    }

  const fit = bedFit(p.panelWidth, p.panelHeight);
  const toStandard: Fix = { id: 'bed-standard', label: `Shrink everything to fit the bed (${BED.width} × ${BED.height} mm)` };
  if (fit === 'extended') {
    out.push({
      level: 'warn',
      stage: 'panel',
      kind: 'bed',
      text: `The panel needs the extended bed (${BED_EXTENDED.width} × ${BED_EXTENDED.height} mm).`,
      fixes: [toStandard],
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
    });
  }
  return out;
}

/** How deep the passes go, by what is cut: the letters' slits, the border, and the fixed-depth lines. */
export interface Depths {
  letters: number;
  border: number;
  fixed: number;
}

export function passDepths(passes: Pass[]): Depths {
  const d: Depths = { letters: 0, border: 0, fixed: 0 };
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
