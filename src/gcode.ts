// Writes the passes as G-code for GRBL (BRIEF.md, Machine and G-code):
// millimetres, absolute coordinates, Z0 on the top surface of the stock, X0 Y0
// at the panel corner the carver chose. One V-bit, no tool change.
//
// The spindle is run by hand from its own speed governor and is not wired to
// GRBL (BRIEF.md, Decisions), so the file never switches it on or off or sets
// its speed. Every file starts by raising the bit to the safe height, then
// pauses (M0) with a plain message to start the spindle by hand at the set
// speed; nothing moves on until the carver presses Resume.
//
// An air cut is the same file lifted so that every move, the deepest included,
// stays at least AIR_GAP above the board: a dry run that cannot touch the wood.
//
// Comments are plain ASCII in round brackets, which GRBL ignores.

import { CORNER_NAMES, type MachineSettings, type Pass, type Pt3 } from './toolpath';

export interface GcodeInfo {
  title: string;
  panelWidth: number;
  panelHeight: number;
  /** Lift the whole job clear of the board for a dry run. */
  airCut?: boolean;
}

/** The message shown when the file ends. */
const FINISHED = 'Finished. Stop the spindle by hand';

/** In an air cut, the lowest point of every move is this far above the board, mm. */
export const AIR_GAP = 5;

/** The message shown when the file pauses at the start (and at the top of the file). */
export function spindleMessage(m: MachineSettings, airCut = false): string {
  const start = `Start the spindle by hand at ${Math.round(m.spindle)} rpm, then press Resume`;
  return airCut ? `AIR CUT - the bit stays ${AIR_GAP} mm or more above the board. ${start}` : start;
}

/** Panel millimetres (x right, y down from the top-left corner) to machine X, Y for the chosen zero corner. */
export function toMachine(x: number, y: number, w: number, h: number, corner: MachineSettings['zeroCorner']): { X: number; Y: number } {
  const X = corner.endsWith('left') ? x : x - w;
  const Y = corner.startsWith('bottom') ? h - y : -y;
  return { X, Y };
}

const n = (v: number) => {
  const s = (Math.round(v * 1000) / 1000).toFixed(3);
  return s === '-0.000' ? '0.000' : s;
};

function ascii(s: string): string {
  return s
    .replace(/°/g, ' deg')
    .replace(/×/g, 'x')
    .replace(/[–—]/g, '-')
    .replace(/[()]/g, '')
    .replace(/[^\x20-\x7e]/g, '?');
}

export function toGcode(passes: Pass[], m: MachineSettings, info: GcodeInfo, date = new Date()): string {
  const out: string[] = [];
  const c = (s: string) => out.push(`(${ascii(s)})`);
  const xy = (p: Pt3) => {
    const { X, Y } = toMachine(p.x, p.y, info.panelWidth, info.panelHeight, m.zeroCorner);
    return `X${n(X)} Y${n(Y)}`;
  };
  const deepest = Math.max(0, ...passes.map((p) => p.deepest));
  // Air cut: lift everything so the deepest point clears the board by AIR_GAP.
  const lift = info.airCut ? deepest + AIR_GAP : 0;
  const z = (v: number) => n(v + lift);

  if (info.airCut) c(`AIR CUT - DRY RUN. Every height is raised ${n(lift)} mm, so the bit stays ${AIR_GAP} mm or more above the board. Nothing is cut.`);
  c(`Incised lettering marking-out: ${info.title}`);
  c(`Made ${date.toISOString().slice(0, 16).replace('T', ' ')}. Units mm, absolute.`);
  c(`Panel ${n(info.panelWidth)} x ${n(info.panelHeight)} mm. X0 Y0 at the ${CORNER_NAMES[m.zeroCorner]} corner of the panel, front being nearest the operator. Z0 on the top surface.`);
  c(`Tool: ${m.toolAngle} deg V-bit, 6.35 mm. One tool for every pass.`);
  c(`Stock ${n(m.stockThickness)} mm, safe floor ${n(m.safeFloor)} mm. Deepest cut ${n(deepest)} mm.`);
  c(`Passes: ${passes.map((p) => p.title).join(', ')}.`);
  c(`Spindle: run by hand at ${Math.round(m.spindle)} rpm on its own speed governor. This file does not switch it on or off.`);
  out.push('G21 G90 G17 G94');
  // First move: the bit up to the safe height. Then wait for the spindle to be started by hand.
  out.push(`G0 Z${z(m.safeZ)}`);
  out.push(`(MSG,${ascii(spindleMessage(m, info.airCut))})`);
  out.push(`M0 (${ascii(spindleMessage(m, info.airCut))})`);

  passes.forEach((pass, i) => {
    c(`Pass ${i + 1}: ${pass.title}. ${pass.cuts.length} cuts, deepest ${n(pass.deepest)} mm`);
    let lastItem = '';
    for (const cut of pass.cuts) {
      if (cut.item !== lastItem) {
        c(cut.item.split('#')[0]);
        lastItem = cut.item;
      }
      if (cut.stroke) c(cut.fork ? `stroke ${cut.stroke}, fork` : `stroke ${cut.stroke}, ${n(cut.width ?? 0)} mm wide`);
      const [first, ...rest] = cut.points;
      out.push(`G0 ${xy(first)}`);
      out.push(`G1 Z${z(first.z)} F${Math.round(m.feedPlunge)}`);
      let feed = 0;
      let prev = first;
      for (const p of rest) {
        const sameSpot = Math.abs(p.x - prev.x) < 1e-9 && Math.abs(p.y - prev.y) < 1e-9;
        const zChanged = n(p.z) !== n(prev.z);
        if (sameSpot) {
          // Stepping down to the next slit level: at the plunge feed.
          if (zChanged) {
            out.push(`G1 Z${z(p.z)} F${Math.round(m.feedPlunge)}`);
            feed = 0;
          }
        } else {
          const f = feed !== cut.feed ? ` F${Math.round(cut.feed)}` : '';
          feed = cut.feed;
          // Z is written only when it changes.
          out.push(`G1 ${xy(p)}${zChanged ? ` Z${z(p.z)}` : ''}${f}`);
        }
        prev = p;
      }
      out.push(`G0 Z${z(m.safeZ)}`);
    }
  });

  c('All passes done: bit up and back to X0 Y0');
  out.push(`G0 Z${z(m.safeZ)}`);
  out.push('G0 X0 Y0');
  out.push(`(MSG,${FINISHED})`);
  out.push(`M30 (${FINISHED})`);
  return out.join('\n') + '\n';
}
