// Every problem with the job, gathered in one list for the warnings badge in
// the status bar. Each says which stage of the job it is put right in.

import { contentBox, type Layout } from './layout';
import { BED_EXTENDED, bedFit } from './panel';
import type { Check } from './toolpath';

export type Stage = 'write' | 'space' | 'panel' | 'machine' | '3d';

export interface Problem {
  /** 'bad' stops the G-code being saved or spoils the work; 'warn' wants a look. */
  level: 'bad' | 'warn';
  text: string;
  stage: Stage;
}

/** Problems that can be seen from the layout itself. */
export function layoutProblems(layout: Layout, hasLetter: (ch: string) => boolean): Problem[] {
  const p = layout.project;
  const out: Problem[] = [];

  const missing = [...new Set([...p.text].filter((ch) => !/\s/.test(ch) && !hasLetter(ch)))];
  if (missing.length) {
    out.push({ level: 'warn', stage: 'write', text: `Not in the alphabet, so left as a space: ${missing.join(' ')}` });
  }

  const box = contentBox(p);
  if (box.x1 <= box.x0 || box.y1 <= box.y0) {
    out.push({ level: 'bad', stage: 'panel', text: 'The border and margins leave no room for the lettering.' });
  } else {
    if (layout.overflow.wide) out.push({ level: 'warn', stage: 'panel', text: 'The lettering runs past the side margins.' });
    if (layout.overflow.tall) out.push({ level: 'warn', stage: 'panel', text: 'The lines run past the top or bottom margin.' });
  }

  const outside = (x: number, y: number) => x < 0 || y < 0 || x > p.panelWidth || y > p.panelHeight;
  const off =
    layout.letters.some((l) => outside(l.box.x0, l.box.y0) || outside(l.box.x1, l.box.y1)) ||
    layout.stops.some((s) => s.outline.some((c) => c.some((q) => outside(q.x, q.y))));
  if (off) out.push({ level: 'bad', stage: 'panel', text: 'Some lettering falls off the edge of the panel.' });

  // Lines whose letters run into each other.
  const bands = layout.lines
    .map((line) => {
      const ls = layout.letters.filter((l) => l.line === line.index);
      if (!ls.length) return null;
      return {
        n: line.index + 1,
        x0: Math.min(...ls.map((l) => l.box.x0)),
        x1: Math.max(...ls.map((l) => l.box.x1)),
        y0: Math.min(...ls.map((l) => l.box.y0)),
        y1: Math.max(...ls.map((l) => l.box.y1)),
      };
    })
    .filter((b): b is NonNullable<typeof b> => !!b);
  for (let i = 0; i < bands.length; i++)
    for (let j = i + 1; j < bands.length; j++) {
      const a = bands[i];
      const b = bands[j];
      if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) {
        out.push({ level: 'warn', stage: 'write', text: `Lines ${a.n} and ${b.n} run into each other.` });
      }
    }

  const fit = bedFit(p.panelWidth, p.panelHeight);
  if (fit === 'extended') {
    out.push({ level: 'warn', stage: 'panel', text: `The panel needs the extended bed (${BED_EXTENDED.width} × ${BED_EXTENDED.height} mm).` });
  } else if (fit === 'too-big') {
    out.push({
      level: 'bad',
      stage: 'panel',
      text: `The panel is too big for the machine, even with the extended bed (${BED_EXTENDED.width} × ${BED_EXTENDED.height} mm).`,
    });
  }
  return out;
}

/**
 * The G-code safety checks that fail, as problems. The bed, margin and
 * off-panel checks are left out: layoutProblems already reports those.
 */
export function machineProblems(checks: Check[]): Problem[] {
  return checks
    .filter((c) => !c.ok && !['bed', 'margins', 'panel', 'pending'].includes(c.id))
    .map((c): Problem =>
      c.id === 'stock'
        ? { level: 'warn', stage: 'machine', text: 'Stock thickness not entered yet: it is needed before the G-code can be saved.' }
        : { level: c.blocking ? 'bad' : 'warn', stage: 'machine', text: c.text },
    );
}

/** The badge: how many problems, and how serious the worst is. */
export function problemSummary(list: Problem[]): { level: 'ok' | 'warn' | 'bad'; text: string } {
  if (!list.length) return { level: 'ok', text: '✓ No problems' };
  const level = list.some((p) => p.level === 'bad') ? 'bad' : 'warn';
  return { level, text: `${level === 'bad' ? '✗' : '!'} ${list.length} problem${list.length > 1 ? 's' : ''}` };
}
