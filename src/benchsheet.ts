// The bench sheet: one printable page (or two) to keep by the bench while
// cutting. The layout drawn to scale with every stroke numbered in cutting
// order (thin first), the cutting order written out letter by letter, and
// every setting the job used, so it can be made again.

import { borderMarks } from './border';
import { contourToSvg, polylineToSvg } from './geometry';
import { contentBox, type Layout, type Project } from './layout';
import { BED, BED_EXTENDED, bedFit } from './panel';
import { CORNER_NAMES, MAX_SCRIBE_DEPTH, type Check, type Cut, type Pass } from './toolpath';

export interface SheetInput {
  project: Project;
  /** The full layout (datum lines worked out). */
  layout: Layout;
  /** The valley slit pass, for the stroke numbers, whether or not it is set to run. */
  strokes: Pass | null;
  /** The passes as they are set to run. */
  passes: Pass[];
  checks: Check[];
  alphabet: string;
  fileName: string | null;
  date: Date;
}

export interface Sheet {
  html: string;
  orientation: 'portrait' | 'landscape';
  /** Drawing scale: 1 is full size. */
  scale: number;
}

/** A4 less 12 mm margins, mm. */
const PAGE = { long: 273, short: 186 };
/** Room round the panel in the drawing for the zero mark and size, mm on paper. */
const PAD = 9;
/** Scales a drawing is allowed to be printed at, largest first. */
const SCALES = [1, 0.75, 0.5, 0.4, 1 / 3, 0.25, 0.2, 1 / 6, 0.125, 0.1, 1 / 15, 0.05];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const mm = (v: number, places = 1) => `${Number(v.toFixed(places))} mm`;
const signed = (v: number) => (v > 0 ? `+${v.toFixed(1)}` : v < 0 ? `−${(-v).toFixed(1)}` : '0.0');

/** The largest allowed scale at which a w × h mm panel fits in the given space. */
export function sheetScale(w: number, h: number, room: { w: number; h: number }): number {
  const fit = Math.min((room.w - 2 * PAD) / w, (room.h - 2 * PAD) / h);
  return SCALES.find((s) => s <= fit + 1e-9) ?? SCALES[SCALES.length - 1];
}

/** "1 : 2" for half size. */
export function scaleName(s: number): string {
  if (Math.abs(s - 1) < 1e-9) return 'full size (1 : 1)';
  const r = 1 / s;
  return `1 : ${Number.isInteger(Math.round(r * 100) / 100) ? Math.round(r) : r.toFixed(2)}`;
}

/**
 * One label for each stroke of each letter, numbered in cutting order, thin
 * first (strokes.ts). Forks carry their stroke's number but no label. A
 * stroke cut in two parts (crossed by a thicker one) has one label, on its
 * longer part. Each label sits halfway along that part's first run down the
 * valley. `cuts` are all the stroke's cuts, forks included.
 */
export function strokeLabels(pass: Pass | null): { x: number; y: number; n: number; item: string; cuts: Cut[] }[] {
  if (!pass) return [];
  const byStroke = new Map<string, Cut[]>();
  for (const c of pass.cuts) {
    if (c.stroke === undefined) continue;
    const k = `${c.item}\u0000${c.stroke}`;
    byStroke.set(k, [...(byStroke.get(k) ?? []), c]);
  }
  const out: { x: number; y: number; n: number; item: string; cuts: Cut[] }[] = [];
  for (const cuts of byStroke.values()) {
    const parts = cuts.filter((c) => !c.fork);
    if (!parts.length) continue; // only forks (a word stop): nothing to number
    const firstRun = (c: Cut) => {
      const step = c.points.findIndex((p, i) => i > 0 && p.x === c.points[i - 1].x && p.y === c.points[i - 1].y);
      return step === -1 ? c.points : c.points.slice(0, step);
    };
    const runLength = (pts: { x: number; y: number }[]) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);
    const longest = parts.reduce((a, b) => (runLength(firstRun(b)) > runLength(firstRun(a)) ? b : a));
    const run = firstRun(longest);
    // Halfway along the run, by distance.
    let left = runLength(run) / 2;
    let mid = run[0];
    for (let i = 1; i < run.length; i++) {
      const step = Math.hypot(run[i].x - run[i - 1].x, run[i].y - run[i - 1].y);
      if (step >= left && step > 0) {
        const t = left / step;
        mid = { ...run[i], x: run[i - 1].x + t * (run[i].x - run[i - 1].x), y: run[i - 1].y + t * (run[i].y - run[i - 1].y) };
        break;
      }
      left -= step;
      mid = run[i];
    }
    out.push({ x: mid.x, y: mid.y, n: longest.stroke!, item: longest.item, cuts });
  }
  return out;
}

/** "O (line 1)#0" → "O (line 1)". */
const itemName = (id: string) => id.replace(/#\d+$/, '');

function drawing(input: SheetInput, s: number): string {
  const { project: p, layout: L } = input;
  const W = p.panelWidth;
  const H = p.panelHeight;
  const pad = PAD / s; // panel mm
  const line = (paperMm: number) => (paperMm / s).toFixed(4); // a line or text size given on paper
  const out: string[] = [];
  out.push(
    `<svg class="sheet-drawing" width="${((W + 2 * pad) * s).toFixed(2)}mm" height="${((H + 2 * pad) * s).toFixed(2)}mm" viewBox="${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}" xmlns="http://www.w3.org/2000/svg">`,
  );
  out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="#000" stroke-width="${line(0.35)}"/>`);
  const cb = contentBox(p);
  if (cb.x1 > cb.x0 && cb.y1 > cb.y0) {
    out.push(
      `<rect x="${cb.x0}" y="${cb.y0}" width="${cb.x1 - cb.x0}" height="${cb.y1 - cb.y0}" fill="none" stroke="#999" stroke-width="${line(0.15)}" stroke-dasharray="${line(1)} ${line(1.5)}"/>`,
    );
  }
  const bm = borderMarks(p.border, W, H, { percent: p.datumPercent, minimum: p.datumMinimum });
  const outlines = [
    ...L.letters.flatMap((l) => l.outline),
    ...L.stops.flatMap((t) => t.outline),
    ...bm.outline,
    ...bm.scribes,
  ];
  const datums = [...L.letters.flatMap((l) => l.datum), ...L.stops.flatMap((t) => t.datum), ...bm.datum];
  const valleys = [...L.letters.flatMap((l) => l.valleys), ...L.stops.flatMap((t) => t.valleys), ...bm.valleys];
  out.push(`<path d="${outlines.map(contourToSvg).join('')}" fill="none" stroke="#000" stroke-width="${line(0.2)}"/>`);
  if (datums.length) {
    out.push(
      `<path d="${datums.map(contourToSvg).join('')}" fill="none" stroke="#7048e8" stroke-width="${line(0.15)}" stroke-dasharray="${line(0.8)} ${line(0.5)}"/>`,
    );
  }
  out.push(`<path d="${valleys.map(polylineToSvg).join('')}" fill="none" stroke="#e03131" stroke-width="${line(0.15)}" stroke-linejoin="round"/>`);

  // Stroke numbers, cutting order within each letter.
  const font = line(2.6);
  for (const t of strokeLabels(input.strokes)) {
    out.push(
      `<text x="${t.x.toFixed(3)}" y="${t.y.toFixed(3)}" dy="0.35em" font-size="${font}" class="sheet-num" stroke-width="${line(0.7)}">${t.n}</text>`,
    );
  }

  // X0 Y0 and the directions X and Y run.
  const c = p.machine.zeroCorner;
  const zx = c.endsWith('left') ? 0 : W;
  const zy = c.startsWith('top') ? 0 : H;
  const arm = 6 / s;
  out.push(
    `<g class="sheet-zero" stroke-width="${line(0.35)}"><circle cx="${zx}" cy="${zy}" r="${line(1)}"/>` +
      `<line x1="${zx}" y1="${zy}" x2="${zx + arm}" y2="${zy}"/><line x1="${zx}" y1="${zy}" x2="${zx}" y2="${zy - arm}"/>` +
      `<text x="${zx + arm + 0.8 / s}" y="${zy}" dy="0.35em" font-size="${line(2.6)}">X</text>` +
      `<text x="${zx}" y="${zy - arm - 1 / s}" text-anchor="middle" font-size="${line(2.6)}">Y</text>` +
      `<text x="${zx}" y="${zy + 4 / s}" text-anchor="${c.endsWith('left') ? 'start' : 'end'}" font-size="${line(2.6)}">X0 Y0</text></g>`,
  );
  out.push(
    `<text x="${W / 2}" y="${H + 4.5 / s}" text-anchor="middle" font-size="${line(2.8)}" class="sheet-dim">${W} × ${H} mm</text>`,
  );
  out.push('</svg>');
  return out.join('');
}

/** A bar the stated length on paper, to check the print with a rule. */
function scaleBar(s: number): string {
  // A round length in panel mm that comes out between about 30 and 100 mm on paper.
  const lengths = [10, 20, 25, 50, 100, 200, 250, 500, 1000];
  const real = lengths.find((l) => l * s >= 30) ?? 1000;
  const paper = real * s;
  const ticks = [0, 0.5, 1].map((f) => `<line x1="${f * paper}" y1="0" x2="${f * paper}" y2="${f === 0.5 ? 1.5 : 2.5}"/>`).join('');
  return (
    `<svg class="sheet-bar" width="${paper + 1}mm" height="3mm" viewBox="-0.5 -0.25 ${paper + 1} 3"><g stroke="#000" stroke-width="0.25">` +
    `<line x1="0" y1="0" x2="${paper}" y2="0"/>${ticks}</g></svg>` +
    `<span>${real} mm on the panel${s === 1 ? '' : ` (${Number(paper.toFixed(1))} mm on the paper)`}</span>`
  );
}

function cuttingOrder(input: SheetInput): string {
  const strokes = strokeLabels(input.strokes);
  if (!strokes.length) return '<p>No strokes to cut.</p>';
  const m = input.project.machine;
  // One block per letter, in reading order.
  const blocks: { id: string; rows: string[] }[] = [];
  for (const { n, item, cuts } of strokes) {
    if (blocks.at(-1)?.id !== item) blocks.push({ id: item, rows: [] });
    // The stroke itself, not its forks: its width, and the deepest the valley and the slit go.
    const own = cuts.filter((c) => !c.fork);
    const slit = Math.max(0, ...own.flatMap((c) => c.points.map((q) => -q.z)));
    const parts = own.length > 1 ? ` <small>(${own.length} parts)</small>` : '';
    blocks
      .at(-1)!
      .rows.push(`<tr><td>${n}${parts}</td><td>${(own[0].width ?? 0).toFixed(1)}</td><td>${(slit + m.slitMargin).toFixed(1)}</td><td>${slit.toFixed(1)}</td></tr>`);
  }
  const head = '<thead><tr><th>Stroke</th><th>Width</th><th>Valley</th><th>Slit</th></tr></thead>';
  return (
    `<div class="sheet-order">${blocks
      .map(({ id, rows }, i) => {
        const [, ch, where] = /^(.*?) \((.*)\)$/.exec(itemName(id)) ?? [null, itemName(id), ''];
        return `<div class="sheet-letter"><h4>${i + 1}. <b>${esc(ch ?? '')}</b> <small>${esc(where ?? '')}</small></h4><table>${head}<tbody>${rows.join('')}</tbody></table></div>`;
      })
      .join('')}</div>` +
    `<p class="sheet-small">Letters in reading order; strokes within each letter thin first. At a junction the thicker stroke runs straight through and the thinner ends into it; a stroke crossed by a thicker one is cut in two parts. The forks into the corners are the stop cuts for the terminations, cut with their stroke, and are not numbered. Width is the stroke's average width; valley is the deepest the finished V reaches at ${m.chiselAngle}°; slit is the deepest the machine cuts. All in mm.</p>`
  );
}

function settings(input: SheetInput): [string, string] {
  const { project: p, layout: L } = input;
  const m = p.machine;
  const b = p.border;
  const fit = bedFit(p.panelWidth, p.panelHeight);
  const kerned = L.gaps.filter((g) => g.kern || g.gapKern);
  const groups: [string, [string, string][]][] = [
    [
      'Lettering',
      [
        ['Alphabet', esc(input.alphabet)],
        ['Cap height', mm(p.capHeight)],
        ['Letter spacing', `${signed(p.letterSpacing)} mm`],
        ['Line spacing', `${mm(p.lineSpacing)} baseline to baseline`],
        ['Alignment', p.align],
        ['Word stops', p.wordStops.on ? `${p.wordStops.size}% of cap height, ${p.wordStops.height}% up, point ${p.wordStops.point}` : 'none'],
        [
          'Kerning used',
          kerned.length
            ? kerned.map((g) => `${esc(g.left.char)} ${esc(g.right.char)} ${signed(g.kern)}${g.gapKern ? ` (this gap ${signed(g.gapKern)})` : ''}`).join(', ')
            : 'none',
        ],
      ],
    ],
    [
      'Panel',
      [
        ['Size', `${p.panelWidth} × ${p.panelHeight} mm`],
        ['Machine bed', fit === 'standard' ? `fits (${BED.width} × ${BED.height} mm)` : fit === 'extended' ? `needs the extended bed (${BED_EXTENDED.width} × ${BED_EXTENDED.height} mm)` : 'too big'],
        [
          'Border',
          b.style === 'none'
            ? 'none'
            : `${b.style}, ${mm(b.inset)} in${b.style === 'double' ? `, ${mm(b.gap)} apart` : ''}${b.style === 'incised' ? `, ${mm(b.width)} wide` : `, ${mm(Math.min(m.scribeDepth, MAX_SCRIBE_DEPTH), 2)} deep`}`,
        ],
        ['Margins', `top ${p.margins.top}, right ${p.margins.right}, bottom ${p.margins.bottom}, left ${p.margins.left} mm`],
      ],
    ],
    [
      'Marking out',
      [
        ['Chisel angle', `${m.chiselAngle}°`],
        ['Datum line', `set in ${p.datumPercent}% of the stroke width, never less than ${mm(p.datumMinimum, 2)}`],
        ['Slit margin', mm(m.slitMargin, 2)],
        ['Stock', m.stockThickness > 0 ? `${mm(m.stockThickness)} thick, safe floor ${mm(m.safeFloor)}` : 'thickness not entered'],
        ['X0 Y0', `${CORNER_NAMES[m.zeroCorner]} corner; Z0 on the top surface`],
      ],
    ],
    [
      'Machine',
      [
        ['Bit', `${m.toolAngle}° V-bit, ${mm(m.toolCutDepth)} cutting depth`],
        ['Spindle', `${m.spindle} rpm, set by hand`],
        ['Hairline', m.passes.hairline ? `${mm(m.hairlineDepth, 2)} deep at ${m.feedHairline} mm/min` : 'not run'],
        ['Datum line', m.passes.datum ? `${mm(m.datumDepth, 2)} deep at ${m.feedDatum} mm/min` : 'not run'],
        ['Valley slit', m.passes.slit ? `up to ${mm(m.slitStep, 2)} a pass at ${m.feedSlit} mm/min` : 'not run'],
        ['Plunge, lift', `${m.feedPlunge} mm/min, lift ${mm(m.safeZ)} between cuts`],
        [
          'Machine time',
          input.passes.length
            ? `about ${Math.max(1, Math.round(input.passes.reduce((t, q) => t + q.minutes, 0)))} min; deepest cut ${mm(Math.max(0, ...input.passes.map((q) => q.deepest)), 2)}`
            : 'no passes chosen',
        ],
      ],
    ],
  ];
  const html = (gs: typeof groups) =>
    gs.map(([title, rows]) => `<h3>${title}</h3><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`).join('');
  return [html(groups.slice(0, 2)), html(groups.slice(2))];
}

export function benchSheet(input: SheetInput): Sheet {
  const p = input.project;
  const orientation = p.panelWidth >= p.panelHeight ? 'landscape' : 'portrait';
  const room = orientation === 'landscape' ? { w: PAGE.long, h: PAGE.short - 40 } : { w: PAGE.short, h: PAGE.long * 0.6 };
  const s = sheetScale(p.panelWidth, p.panelHeight, room);
  const lines = p.text.split('\n').filter((t) => t.trim());
  const title = lines.join(' / ') || 'Lettering';
  const checks = input.checks
    .filter((c) => c.id !== 'pending')
    .map((c) => `<li class="${c.ok ? 'ok' : c.blocking ? 'bad' : 'warn'}">${c.ok ? '✓' : c.blocking ? '✗' : '!'} ${esc(c.text)}</li>`)
    .join('');
  const [set1, set2] = settings(input);
  const html = `
<article class="sheet ${orientation}">
  <header class="sheet-head">
    <h1>${esc(title)}</h1>
    <p>Bench sheet · ${input.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}${input.fileName ? ` · ${esc(input.fileName)}` : ''} · Drawn ${scaleName(s)}</p>
  </header>
  <figure class="sheet-figure">
    ${drawing(input, s)}
    <figcaption>
      <span class="sheet-key"><i class="k-out"></i> hairline</span>
      <span class="sheet-key"><i class="k-datum"></i> datum line</span>
      <span class="sheet-key"><i class="k-valley"></i> valley line</span>
      <span class="sheet-key"><b>3</b> stroke number: cut thin strokes first</span>
      <span class="sheet-scale">${scaleBar(s)}</span>
    </figcaption>
  </figure>
  <section class="sheet-cutting"><h2>Cutting order</h2>${cuttingOrder(input)}</section>
  <h2>Settings used</h2>
  <div class="sheet-cols">
    <section>${set1}</section>
    <section>${set2}</section>
    <section>${checks ? `<h3>Checks</h3><ul class="sheet-checks">${checks}</ul>` : ''}
      <h3>Notes</h3><div class="sheet-notes"></div></section>
  </div>
</article>`;
  return { html, orientation, scale: s };
}
