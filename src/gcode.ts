// Writes the passes as G-code for GRBL (BRIEF.md, Machine and G-code):
// millimetres, absolute coordinates, Z0 on the top surface of the stock, X0 Y0
// at the panel corner the carver chose. One V-bit, no tool change.
//
// Comments are plain ASCII in round brackets, which GRBL ignores.

import type { MachineSettings, Pass, Pt3 } from './toolpath';

export interface GcodeInfo {
  title: string;
  panelWidth: number;
  panelHeight: number;
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

  c(`Incised lettering marking-out: ${info.title}`);
  c(`Made ${date.toISOString().slice(0, 16).replace('T', ' ')}. Units mm, absolute.`);
  c(`Panel ${n(info.panelWidth)} x ${n(info.panelHeight)} mm. X0 Y0 at the ${m.zeroCorner} corner of the panel. Z0 on the top surface.`);
  c(`Tool: ${m.toolAngle} deg V-bit, 6.35 mm. One tool for every pass.`);
  c(`Stock ${n(m.stockThickness)} mm, safe floor ${n(m.safeFloor)} mm. Deepest cut ${n(deepest)} mm.`);
  c(`Passes: ${passes.map((p) => p.title).join(', ')}.`);
  out.push('G21 G90 G17 G94');
  out.push(`G0 Z${n(m.safeZ)}`);
  out.push(`M3 S${Math.round(m.spindle)}`);
  out.push('G4 P4');
  c('Spindle up to speed');

  passes.forEach((pass, i) => {
    c(`Pass ${i + 1}: ${pass.title}. ${pass.cuts.length} cuts, deepest ${n(pass.deepest)} mm`);
    let lastItem = '';
    for (const cut of pass.cuts) {
      if (cut.item !== lastItem) {
        c(cut.item.split('#')[0]);
        lastItem = cut.item;
      }
      if (cut.stroke) c(`stroke ${cut.stroke}, ${n(cut.width ?? 0)} mm wide`);
      const [first, ...rest] = cut.points;
      out.push(`G0 ${xy(first)}`);
      out.push(`G1 Z${n(first.z)} F${Math.round(m.feedPlunge)}`);
      let feed = 0;
      let prev = first;
      for (const p of rest) {
        const sameSpot = Math.abs(p.x - prev.x) < 1e-9 && Math.abs(p.y - prev.y) < 1e-9;
        const zChanged = n(p.z) !== n(prev.z);
        if (sameSpot) {
          // Stepping down to the next slit level: at the plunge feed.
          if (zChanged) {
            out.push(`G1 Z${n(p.z)} F${Math.round(m.feedPlunge)}`);
            feed = 0;
          }
        } else {
          const f = feed !== cut.feed ? ` F${Math.round(cut.feed)}` : '';
          feed = cut.feed;
          // Z is written only when it changes.
          out.push(`G1 ${xy(p)}${zChanged ? ` Z${n(p.z)}` : ''}${f}`);
        }
        prev = p;
      }
      out.push(`G0 Z${n(m.safeZ)}`);
    }
  });

  c('Finished');
  out.push(`G0 Z${n(m.safeZ)}`);
  out.push('M5');
  out.push('G0 X0 Y0');
  out.push('M30');
  return out.join('\n') + '\n';
}
