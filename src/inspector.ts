// The right-hand inspection panel: an overview of the whole panel (which
// doubles as a navigator), the list of lines, and the balance figures.

import { borderMarks } from './border';
import { contourToSvg } from './geometry';
import { balance, lineStats } from './inspect';
import type { Layout } from './layout';

export type OverviewMode = 'letters' | 'blocks';

/** Padding round the panel in the overview, mm. */
const PAD = 4;

/** SVG content for the overview, in panel millimetres (viewBox set by the caller). */
export function overviewSvg(layout: Layout, mode: OverviewMode, selectedLine: number | null): string {
  const p = layout.project;
  const k = p.capHeight;
  const out: string[] = [];
  out.push(`<rect class="ov-panel" x="0" y="0" width="${p.panelWidth}" height="${p.panelHeight}"/>`);
  const bm = borderMarks(p.border, p.panelWidth, p.panelHeight, { percent: p.datumPercent, minimum: p.datumMinimum });
  if (bm.scribes.length) out.push(`<path class="ov-scribe" d="${bm.scribes.map(contourToSvg).join('')}"/>`);
  if (bm.outline.length) out.push(`<path class="ov-ink" fill-rule="evenodd" d="${bm.outline.map(contourToSvg).join('')}"/>`);
  if (mode === 'letters') {
    out.push(`<path class="ov-ink" d="${layout.letters.map((l) => l.outline.map(contourToSvg).join('')).join('')}"/>`);
  } else {
    for (const l of layout.lines) {
      if (!l.ink) continue;
      out.push(`<rect class="ov-block" x="${l.ink.x0}" y="${l.baselineY - k}" width="${l.ink.x1 - l.ink.x0}" height="${k}"/>`);
    }
  }
  const sel = layout.lines.find((l) => l.index === selectedLine && l.ink);
  if (sel) {
    out.push(`<rect class="ov-sel" x="${sel.ink!.x0 - 1}" y="${sel.baselineY - k - 1}" width="${sel.ink!.x1 - sel.ink!.x0 + 2}" height="${k + 2}"/>`);
  }
  // Panel centre (cross) and the visual centre of the lettering (dot).
  const cx = p.panelWidth / 2;
  const cy = p.panelHeight / 2;
  const arm = Math.min(p.panelWidth, p.panelHeight) * 0.04;
  out.push(`<path class="ov-centre" d="M${cx - arm} ${cy}H${cx + arm}M${cx} ${cy - arm}V${cy + arm}"/>`);
  const b = balance(layout);
  if (b) out.push(`<circle class="ov-visual" cx="${b.centre.x}" cy="${b.centre.y}" r="${arm * 0.45}"/>`);
  out.push(`<rect id="ov-view" class="ov-view" x="0" y="0" width="0" height="0"/>`);
  return out.join('');
}

export function overviewViewBox(layout: Layout): string {
  const p = layout.project;
  return `${-PAD} ${-PAD} ${p.panelWidth + 2 * PAD} ${p.panelHeight + 2 * PAD}`;
}

const mm = (v: number) => `${v.toFixed(1)}`;

/** The list of lines, one card per line. */
export function lineListHtml(layout: Layout, selectedLine: number | null, esc: (s: string) => string): string {
  const stats = lineStats(layout);
  if (!stats.length) return '<p class="hint">No lines yet.</p>';
  return stats
    .map((s) => {
      const state = s.locked ? 'Locked' : s.placed ? 'Placed' : 'Auto';
      return `
      <div class="ln${s.index === selectedLine ? ' sel' : ''}" data-select-line="${s.index}">
        <div class="ln-top">
          <span class="ln-num">${s.index + 1}</span>
          <span class="ln-text">${esc(s.text.trim())}</span>
          <button class="ln-state ${state.toLowerCase()}" data-line-auto="${s.index}" ${s.placed && !s.locked ? '' : 'disabled'}
            title="${s.placed && !s.locked ? 'Placed by hand. Click to return it to auto.' : state === 'Auto' ? 'Follows the line spacing and alignment' : 'Locked'}">${state}</button>
          <button class="ln-lock${s.locked ? ' on' : ''}" data-line-lock="${s.index}" title="${s.locked ? 'Unlock' : 'Lock'} this line">${s.locked ? 'Unlock' : 'Lock'}</button>
        </div>
        <div class="ln-figs">
          <span title="Length of the letters end to end"><b>${mm(s.length)}</b> mm long</span>
          <span title="Length as a share of the panel width"><b>${s.percentOfPanel.toFixed(0)}%</b> of width</span>
          <span title="Cap height"><b>${mm(s.capHeight)}</b> cap</span>
          <span title="Left end of the letters, from the panel's left edge"><b>${mm(s.left)}</b> left</span>
          <span title="Baseline, from the panel's top edge"><b>${mm(s.baseline)}</b> baseline</span>
          <span title="How much of the line's band is letter: its colour"><b>${s.colour.toFixed(0)}%</b> colour</span>
        </div>
      </div>`;
    })
    .join('');
}

/** Space round the lettering and where its visual centre sits. */
export function balanceHtml(layout: Layout): string {
  const b = balance(layout);
  if (!b) return '<p class="hint">No lettering yet.</p>';
  const ratio = b.top > 0 ? b.bottom / b.top : Infinity;
  const way = (v: number, neg: string, pos: string) => (Math.abs(v) < 0.05 ? null : `${mm(Math.abs(v))} mm ${v < 0 ? neg : pos}`);
  const parts = [way(b.offset.y, 'above', 'below'), way(b.offset.x, 'left of', 'right of')].filter(Boolean);
  const where = parts.length ? `${parts.join(' and ')} the panel centre` : 'on the panel centre';
  return `
    <div class="bal-grid">
      <span class="bal-top"><b>${mm(b.top)}</b><small>top</small></span>
      <span class="bal-left"><b>${mm(b.left)}</b><small>left</small></span>
      <span class="bal-mid">mm clear<br/>to the edge</span>
      <span class="bal-right"><b>${mm(b.right)}</b><small>right</small></span>
      <span class="bal-bottom"><b>${mm(b.bottom)}</b><small>bottom</small></span>
    </div>
    <p class="bal-line">Top to bottom: <b>1 : ${Number.isFinite(ratio) ? ratio.toFixed(2) : '—'}</b></p>
    <p class="bal-line">Visual centre of the lettering: <b>${where}</b>.</p>
    <p class="hint small">Spaces are measured from the cap line of the top line, the baseline of the bottom line and the ends of the longest line to the panel edge. The visual centre is the balance point of all the letter shapes.</p>`;
}
