import { alphabetFromFont } from './alphabet';
import { borderMarks } from './border';
import { contourToSvg, polylineToSvg } from './geometry';
import {
  contentBox,
  defaultProject,
  layoutPanel,
  lineAnchor,
  type Align,
  type Gap,
  type Layout,
  type BorderStyle,
  type LinePlacement,
  type Margins,
  type PlacedLine,
  type Project,
} from './layout';
import { loadImage, saveImage } from './imagestore';
import { BED, BED_EXTENDED, bedFit, fitToLettering } from './panel';
import { LetterStore } from './letters';
import { negativeSpace } from './negativeSpace';
import { History } from './history';
import { remapForEdit } from './remap';
import { RULER, rulerSvg } from './rulers';
import { nearest, snapTargets, type Snap } from './snap';
import { PanZoom, type ViewState } from './view';

// ---------------------------------------------------------------- state

const PROJECT_KEY = 'incised.project';
const CAL_KEY = 'incised.calibration';
// CSS assumes 96 px per inch; the carver's calibration corrects for the real screen.
const NOMINAL_PX_PER_MM = 96 / 25.4;

let project: Project = loadProject();
let calibration = readNumber(CAL_KEY, 1, 0.5, 2);
let store: LetterStore | null = null;
let layout: Layout | null = null;
/** Selected gap, by line and position in the line, so it survives re-layout. */
let selected: { line: number; n: number } | null = null;
/** Whether the kerning box adjusts every place the pair occurs, or this gap only. */
let kernMode: 'pair' | 'gap' = 'pair';
/** The gap under the pointer, for keyboard kerning without clicking first. */
let hovered: { line: number; n: number } | null = null;
const history = new History<Project>();
/** Pointer position over the workspace (px), for the ruler markers. */
let pointer: { x: number; y: number } | null = null;
/** Measure tool: on or off, and the two ends of the measurement in mm. */
let measuring = false;
let measure: { a: { x: number; y: number }; b: { x: number; y: number } } | null = null;
/** A guide being dragged: which way it runs and where it is now (mm), or null when over a ruler. */
let guideDrag: { axis: 'x' | 'y'; index: number; at: number | null } | null = null;
/** The selected line (0 = first), or null. */
let selectedLine: number | null = null;
/** The reference picture, ready to show (an object URL), once loaded. */
let refUrl: string | null = null;
/** Scaling the reference picture: the first point clicked, while waiting for the second. */
let scaling: { a: { x: number; y: number } | null } | null = null;
/** What a line being dragged has snapped to, to draw the snapping guides. */
let lineSnaps: { x: Snap | null; y: Snap | null } | null = null;

const $ = <T extends Element = HTMLElement>(id: string) => document.getElementById(id) as unknown as T;
const work = $('work');
const world = $<SVGGElement>('world');
const labels = $<SVGGElement>('labels');
const overlay = $<SVGGElement>('overlay');
const pop = $('kern-pop');

const view = new PanZoom(work, {
  changed: () => {
    applyView();
  },
  // Clicks on letters, gaps and line numbers are handled by onLinePress;
  // a click anywhere else clears the selection.
  click: () => {
    selected = null;
    selectedLine = null;
    draw();
  },
});

// ---------------------------------------------------------------- controls

interface SliderSpec {
  key: 'capHeight' | 'letterSpacing' | 'lineSpacing' | 'datumPercent' | 'datumMinimum' | 'spaceDepth';
  /** Which side-panel section it sits in. */
  box: string;
  name: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  hint?: string;
}

const sliders: SliderSpec[] = [
  { key: 'capHeight', box: 'sliders', name: 'Cap height', min: 5, max: 120, step: 0.5, unit: 'mm' },
  { key: 'letterSpacing', box: 'sliders', name: 'Letter spacing', min: -5, max: 15, step: 0.1, unit: 'mm', hint: 'added between every pair' },
  { key: 'lineSpacing', box: 'sliders', name: 'Line spacing', min: 5, max: 250, step: 0.5, unit: 'mm', hint: 'baseline to baseline' },
  { key: 'datumPercent', box: 'datum-sliders', name: 'Set in by', min: 5, max: 45, step: 1, unit: '%', hint: 'of the stroke width at that point' },
  { key: 'datumMinimum', box: 'datum-sliders', name: 'But never less than', min: 0, max: 1.5, step: 0.05, unit: 'mm', hint: 'keeps it off the hairline' },
  { key: 'spaceDepth', box: 'space-sliders', name: 'Count space into letters', min: 0.5, max: 40, step: 0.5, unit: 'mm', hint: 'measured in from each letter’s furthest point' },
];

function buildControls() {
  for (const s of sliders) {
    const box = $(s.box);
    const row = document.createElement('div');
    row.className = 'slider';
    row.innerHTML = `
      <div class="row">
        <label class="name" for="r-${s.key}">${s.name}${s.hint ? ` <small>${s.hint}</small>` : ''}</label>
        <span><input type="number" id="n-${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" /> ${s.unit}</span>
      </div>
      <input type="range" id="r-${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" />`;
    box.append(row);
    const range = row.querySelector<HTMLInputElement>('input[type=range]')!;
    const num = row.querySelector<HTMLInputElement>('input[type=number]')!;
    range.addEventListener('input', () => update({ [s.key]: Number(range.value) }, undefined, s.key));
    num.addEventListener('input', () => {
      const v = Number(num.value);
      if (num.value !== '' && Number.isFinite(v)) update({ [s.key]: v }, num, s.key);
    });
  }

  const text = $<HTMLTextAreaElement>('text');
  text.addEventListener('input', () => {
    selected = null; // gaps are renumbered when the text changes
    // Placed lines and one-gap kerning follow their letters through the edit.
    update({ text: text.value, ...remapForEdit(project, text.value) }, text, 'text');
  });

  $('align').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (b) update({ align: b.dataset.align as Align });
  });

  for (const key of ['panelWidth', 'panelHeight'] as const) {
    const input = $<HTMLInputElement>(key);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      if (input.value !== '' && Number.isFinite(v) && v >= 1) update({ [key]: v }, input, key);
    });
  }
  wirePanel();

  for (const layer of LAYERS) {
    const cb = $<HTMLInputElement>(`show-${layer}`);
    cb.addEventListener('change', () => {
      setPreset(null); // fine control: no preset is exactly what's showing now
      syncLayers();
      draw();
    });
  }
  syncLayers();
  $('presets').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-preset]');
    if (b) applyPreset(b.dataset.preset as PresetName);
  });

  // Kerning box.
  for (const el of [pop, $('viewbar')]) el.addEventListener('pointerdown', (e) => e.stopPropagation());
  wireTools();
  pop.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    if (b.hasAttribute('data-close')) {
      selected = null;
      draw();
    } else if (b.dataset.mode) {
      kernMode = b.dataset.mode as 'pair' | 'gap';
      applyView();
    } else nudge(Number(b.dataset.nudge));
  });
  document.addEventListener('keydown', onKey);
  $('kerning-summary').addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('#clear-kerning')) update({ kerning: {}, gapKerning: {} });
  });

  // View.
  $('fit').addEventListener('click', fitPanel);
  $('true-size').addEventListener('click', () => view.frame(project.panelWidth, project.panelHeight, pxPerMm()));

  // Calibration.
  const cal = $<HTMLInputElement>('cal');
  cal.addEventListener('input', () => setCalibration(Number(cal.value)));
  $('cal-minus').addEventListener('click', () => setCalibration(calibration - 0.002));
  $('cal-plus').addEventListener('click', () => setCalibration(calibration + 0.002));
  $('cal-reset').addEventListener('click', () => setCalibration(1));

  $('reset-all').addEventListener('click', () => {
    if (!confirm('Clear the inscription, settings and kerning, and start again with OAK? (Undo brings it back.)')) return;
    selected = null;
    update(structuredClone(defaultProject));
    fitPanel();
  });

  new ResizeObserver(() => applyView()).observe(work);
}

/**
 * Apply a change to the project. `source` is the box being typed in, left
 * alone. Changes with the same `group` in quick succession undo as one step.
 */
function update(change: Partial<Project>, source?: Element, group: string | null = null) {
  history.record(project, group);
  project = { ...project, ...change };
  refreshUndoButtons();
  syncControls(source);
  saveProject();
  relayout();
}

function syncControls(source?: Element) {
  for (const s of sliders) {
    const v = project[s.key];
    const range = $<HTMLInputElement>(`r-${s.key}`);
    const num = $<HTMLInputElement>(`n-${s.key}`);
    range.value = String(v);
    if (num !== source) num.value = String(round(v, 2));
  }
  const text = $<HTMLTextAreaElement>('text');
  if (text !== source) text.value = project.text;
  for (const key of ['panelWidth', 'panelHeight'] as const) {
    const input = $<HTMLInputElement>(key);
    if (input !== source) input.value = String(project[key]);
  }
  syncPanelControls(source);
  $('align')
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('on', b.dataset.align === project.align));
}

/** Move the selected gap's letters closer (dir -1) or apart (+1) by `step` mm; dir 0 puts it back. */
function nudge(dir: number, step = 0.1) {
  const gap = selectedGap();
  if (!gap) return;
  if (kernMode === 'pair') {
    const k = { ...project.kerning };
    // Read the current setting, not the last drawing, so quick presses all count.
    const v = dir === 0 ? 0 : round((project.kerning[gap.pair] ?? 0) + dir * step, 1);
    if (v === 0) delete k[gap.pair];
    else k[gap.pair] = v;
    update({ kerning: k });
  } else {
    const k = { ...project.gapKerning };
    const own = project.gapKerning[gap.key];
    const v = dir === 0 ? 0 : round((own && own.pair === gap.pair ? own.mm : 0) + dir * step, 1);
    if (v === 0) delete k[gap.key];
    else k[gap.key] = { pair: gap.pair, mm: v };
    update({ gapKerning: k });
  }
}

// ---------------------------------------------------------------- drawing

// Lay out quickly on every change, then fill in any datum lines left off
// once things have been still for a moment.
let pending = 0;
let settle = 0;
function relayout() {
  if (!store || pending) return;
  pending = requestAnimationFrame(() => {
    pending = 0;
    layout = layoutPanel(store!, project, true);
    draw();
    clearTimeout(settle);
    if (layout.datumPending) {
      settle = window.setTimeout(() => {
        layout = layoutPanel(store!, project);
        draw();
      }, 150);
    }
  });
}

function selectedGap(): Gap | null {
  return gapAt(selected);
}

function gapAt(at: { line: number; n: number } | null): Gap | null {
  if (!layout || !at) return null;
  const inLine = layout.gaps.filter((g) => g.line === at.line);
  return inLine[at.n] ?? null;
}

/** Position of a gap in the whole inscription, reading order. */
function gapIndex(at: { line: number; n: number } | null): number {
  const g = gapAt(at);
  return g && layout ? layout.gaps.indexOf(g) : -1;
}

function gapRef(i: number): { line: number; n: number } | null {
  if (!layout || !layout.gaps.length) return null;
  const all = layout.gaps;
  const g = all[((i % all.length) + all.length) % all.length];
  return { line: g.line, n: all.filter((h) => h.line === g.line).indexOf(g) };
}

const fmt = (n: number) => n.toFixed(3);

function draw() {
  if (!layout) return;
  const p = project;
  const L = layout;
  const out: string[] = [];

  // The machine bed, drawn from the panel's top-left corner (the G-code zero), the same way round as the panel.
  const fit = bedFit(p.panelWidth, p.panelHeight);
  const bed = fit === 'standard' ? BED : BED_EXTENDED;
  const [bw, bh] = p.panelWidth >= p.panelHeight ? [bed.width, bed.height] : [bed.height, bed.width];
  out.push(`<g class="bed"><rect x="0" y="0" width="${bw}" height="${bh}"/></g>`);

  out.push(`<rect class="panel" x="0" y="0" width="${p.panelWidth}" height="${p.panelHeight}"/>`);
  const ri = p.refImage;
  if (ri && refUrl && ri.visible) {
    out.push(
      `<image class="refimg${ri.locked ? ' locked' : ''}" ${ri.locked ? '' : 'data-refimage="1"'} href="${refUrl}" x="${fmt(ri.x)}" y="${fmt(ri.y)}" width="${fmt(ri.width)}" height="${fmt(ri.width * ri.aspect)}" opacity="${ri.opacity}" preserveAspectRatio="none"/>`,
    );
  }
  const cb = contentBox(p);
  if (cb.x1 > cb.x0 && cb.y1 > cb.y0) {
    out.push(`<rect class="margin" x="${fmt(cb.x0)}" y="${fmt(cb.y0)}" width="${fmt(cb.x1 - cb.x0)}" height="${fmt(cb.y1 - cb.y0)}"/>`);
  }
  // The border, cut and drawn like the letters.
  const bm = borderMarks(p.border, p.panelWidth, p.panelHeight, { percent: p.datumPercent, minimum: p.datumMinimum });
  if (bm.scribes.length) out.push(`<path class="outline scribe" d="${bm.scribes.map(contourToSvg).join('')}"/>`);
  if (bm.outline.length) {
    const d = bm.outline.map(contourToSvg).join('');
    out.push(`<path class="fill" fill-rule="evenodd" d="${d}"/><path class="outline" d="${d}"/>`);
    if (bm.datum.length) out.push(`<path class="datum" d="${bm.datum.map(contourToSvg).join('')}"/>`);
    out.push(`<path class="valley" d="${bm.valleys.map(polylineToSvg).join('')}"/>`);
  }
  out.push('<g class="guides">');
  for (const line of L.lines) {
    for (const y of [line.baselineY, line.baselineY - p.capHeight]) {
      out.push(`<line x1="0" x2="${p.panelWidth}" y1="${fmt(y)}" y2="${fmt(y)}"/>`);
    }
  }
  out.push('</g>');

  const showSpace = $<HTMLInputElement>('show-space').checked;
  const spaces = showSpace
    ? L.gaps.map((g) => negativeSpace(g, L.lines[g.line].baselineY, p.capHeight, p.spaceDepth))
    : [];
  if (showSpace) {
    out.push('<g class="space">');
    for (const s of spaces) {
      out.push(`<path d="${contourToSvg(s.shape)}"/>`);
      const cuts = s.cutoffs.filter((c) => c.length > 1);
      if (cuts.length) out.push(`<path class="cutoff" d="${cuts.map(polylineToSvg).join('')}"/>`);
    }
    out.push('</g>');
  }

  for (const letter of L.letters) {
    const outline = letter.outline.map(contourToSvg).join('');
    out.push(`<path class="fill" d="${outline}"/>`);
    out.push(`<path class="outline" d="${outline}"/>`);
    if (letter.datum.length) out.push(`<path class="datum" d="${letter.datum.map(contourToSvg).join('')}"/>`);
    out.push(`<path class="valley" d="${letter.valleys.map(polylineToSvg).join('')}"/>`);
  }

  // Each line can be clicked to select it and dragged to move it.
  for (const line of L.lines) {
    if (!line.ink) continue;
    const cls = `linehit${line.index === selectedLine ? ' sel' : ''}${line.locked ? ' locked' : ''}`;
    const y = line.baselineY - p.capHeight;
    out.push(
      `<rect class="${cls}" data-line="${line.index}" x="${fmt(line.ink.x0 - 0.5)}" y="${fmt(y - 0.5)}" width="${fmt(line.ink.x1 - line.ink.x0 + 1)}" height="${fmt(p.capHeight + 1)}"/>`,
    );
  }

  // Clickable gaps between letters.
  const sel = selectedGap();
  const counts = new Map<number, number>();
  for (const g of L.gaps) {
    const n = counts.get(g.line) ?? 0;
    counts.set(g.line, n + 1);
    const base = L.lines[g.line].baselineY;
    const w = Math.max(Math.abs(g.right.box.x0 - g.left.box.x1), p.capHeight * 0.12);
    const cls = g === sel ? 'gap sel' : g.kern ? 'gap kerned' : 'gap';
    out.push(
      `<rect class="${cls}" data-gap="${g.line}:${n}" x="${fmt(g.x - w / 2)}" y="${fmt(base - p.capHeight)}" width="${fmt(w)}" height="${fmt(p.capHeight)}"/>`,
    );
  }

  world.innerHTML = out.join('');
  labelData = { spaces, gaps: L.gaps };
  showWarnings();
  showKerningSummary();
  showLineEditor();
  applyView();
}

let labelData: { spaces: ReturnType<typeof negativeSpace>[]; gaps: Gap[] } = { spaces: [], gaps: [] };

/** Things drawn at a fixed size on screen: labels and the kerning box. */
function applyView() {
  const v: ViewState = view.v;
  world.setAttribute('transform', `translate(${v.tx} ${v.ty}) scale(${v.scale})`);
  const sx = (x: number) => v.tx + x * v.scale;
  const sy = (y: number) => v.ty + y * v.scale;
  const p = project;
  const out: string[] = [];
  for (const s of labelData.spaces) {
    const base = layout!.lines[s.gap.line].baselineY;
    out.push(
      `<text class="area" x="${sx(s.gap.x).toFixed(1)}" y="${(sy(base - p.capHeight) - 6).toFixed(1)}">${Math.round(s.area)}</text>`,
    );
  }
  const everyKern = $<HTMLInputElement>('show-kerns').checked;
  for (const g of labelData.gaps) {
    if (!everyKern && !g.kern && !g.gapKern) continue;
    const base = layout!.lines[g.line].baselineY;
    const y = sy(base) + 14;
    out.push(`<text class="kern${g.kern ? '' : ' zero'}" x="${sx(g.x).toFixed(1)}" y="${y.toFixed(1)}">${signed(g.kern)}</text>`);
    if (g.gapKern) {
      out.push(
        `<text class="kern own" x="${sx(g.x).toFixed(1)}" y="${(y + 13).toFixed(1)}">this gap ${signed(g.gapKern)}</text>`,
      );
    }
  }
  out.push(
    `<text class="dims" x="${sx(p.panelWidth / 2).toFixed(1)}" y="${(sy(p.panelHeight) + 18).toFixed(1)}">${p.panelWidth} × ${p.panelHeight} mm</text>`,
  );
  // Line numbers in the margin, left of the panel, level with each line.
  const numX = Math.max(RULER + 30, sx(0) - 10);
  for (const line of layout?.lines ?? []) {
    if (!line.ink) continue;
    const y = sy(line.baselineY - p.capHeight / 2);
    const state = line.locked ? 'locked' : line.placed ? 'placed' : 'auto';
    const cls = `linenum ${state}${line.index === selectedLine ? ' sel' : ''}`;
    const mark = line.locked ? ' ⚿' : line.placed ? ' ✥' : '';
    const w = mark ? 36 : 24;
    const title = `Line ${line.index + 1}: ${state === 'auto' ? 'auto (follows line spacing and alignment)' : state === 'placed' ? 'placed by hand' : 'locked'}`;
    out.push(
      `<g class="${cls}" data-line="${line.index}"><title>${esc(title)}</title>` +
        `<rect x="${(numX - w).toFixed(1)}" y="${(y - 10).toFixed(1)}" width="${w}" height="20" rx="4"/>` +
        `<text x="${(numX - w / 2).toFixed(1)}" y="${(y + 4).toFixed(1)}">${line.index + 1}${mark}</text></g>`,
    );
  }
  labels.innerHTML = out.join('');

  // Kerning box sits above the selected gap.
  const g = selectedGap();
  if (g) {
    const base = layout!.lines[g.line].baselineY;
    pop.hidden = false;
    const pairName = `${g.left.char} ${g.right.char}`;
    pop.querySelector('.pair')!.textContent = pairName;
    pop.querySelector('[data-mode="pair"]')!.textContent = `Every ${pairName}`;
    pop.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === kernMode));
    pop.querySelector('output')!.textContent = `${signed(kernMode === 'pair' ? g.pairKern : g.gapKern)} mm`;
    pop.querySelector('.breakdown')!.textContent =
      `Every ${pairName} ${signed(g.pairKern)} · this gap ${signed(g.gapKern)} · total ${signed(g.kern)} mm`;
    const x = sx(g.x);
    const y = sy(base - p.capHeight) - 28;
    pop.style.left = `${Math.round(x)}px`;
    pop.style.top = `${Math.round(y)}px`;
  } else {
    pop.hidden = true;
  }

  drawOverlay();
  $('zoom-read').textContent = `${(v.scale / pxPerMm()).toFixed(2)} × true size`;
  $('ruler').style.width = `${100 * pxPerMm()}px`;
  $<HTMLInputElement>('cal').value = String(calibration);
}

function showWarnings() {
  const p = project;
  const w: string[] = [];
  if (layout!.overflow.wide) w.push('The lettering runs past the side margins.');
  if (layout!.overflow.tall) w.push('The lines run past the top or bottom margin.');
  const box = contentBox(p);
  if (box.x1 <= box.x0 || box.y1 <= box.y0) w.push('The border and margins leave no room for the lettering.');
  $('warnings').innerHTML = w.map((t) => `<p class="warn">${t}</p>`).join('');

  // Machine bed check.
  const fit = bedFit(p.panelWidth, p.panelHeight);
  const status = $('bed-status');
  status.className = `bed-status ${fit}`;
  status.textContent =
    fit === 'standard'
      ? `Fits the machine bed (${BED.width} × ${BED.height} mm).`
      : fit === 'extended'
        ? `Needs the extended bed (${BED_EXTENDED.width} × ${BED_EXTENDED.height} mm).`
        : `Too big for the machine, even with the extended bed (${BED_EXTENDED.width} × ${BED_EXTENDED.height} mm).`;
}

function showKerningSummary() {
  const pairName = (pair: string) => {
    const [a, ...b] = [...pair];
    return `<b>${esc(a)} ${esc(b.join(''))}</b>`;
  };
  const pairs = Object.entries(project.kerning);
  // Single gaps that still match the letters in that place.
  const own = layout ? layout.gaps.filter((g) => g.gapKern) : [];
  const items = [
    ...pairs.map(([k, v]) => `<li>${pairName(k)} everywhere ${signed(v)} mm</li>`),
    ...own.map((g) => `<li>${pairName(g.pair)} line ${g.line + 1}, this gap only ${signed(g.gapKern)} mm</li>`),
  ];
  $('kerning-summary').innerHTML = items.length
    ? `<ul class="pairs">${items.join('')}</ul><button id="clear-kerning" class="quiet">Clear all spacing adjustments</button>`
    : '';
}

function fitPanel() {
  view.frame(project.panelWidth, project.panelHeight);
}

// ---------------------------------------------------------------- view presets

const LAYERS = ['outline', 'datum', 'valley', 'fill', 'space', 'guides', 'kerns', 'bed'] as const;
type Layer = (typeof LAYERS)[number];
type PresetName = 'design' | 'spacing' | 'setting' | 'proof';
const PRESET_KEYS: PresetName[] = ['design', 'spacing', 'setting', 'proof'];

/** Which layers each view preset shows. */
const PRESETS: Record<PresetName, Layer[]> = {
  design: ['fill'], // letters filled solid, nothing else
  spacing: ['fill', 'space'], // letters plus shaded spaces and their areas
  setting: ['outline', 'datum', 'valley'], // the marks the machine will make
  proof: ['fill'], // clean letters on the panel, as a client would see them
};

function applyPreset(name: PresetName) {
  for (const layer of LAYERS) $<HTMLInputElement>(`show-${layer}`).checked = PRESETS[name].includes(layer);
  setPreset(name);
  syncLayers();
  draw();
}

function setPreset(name: PresetName | null) {
  $('presets')
    .querySelectorAll<HTMLElement>('[data-preset]')
    .forEach((b) => b.classList.toggle('on', b.dataset.preset === name));
  // Design and Proof hide the working labels; Proof also hides guides and dimensions.
  work.classList.toggle('clean', name === 'design' || name === 'proof');
  work.classList.toggle('proof', name === 'proof');
}

function syncLayers() {
  for (const layer of LAYERS) work.classList.toggle(`hide-${layer}`, !$<HTMLInputElement>(`show-${layer}`).checked);
}

// ---------------------------------------------------------------- keys, undo

function onKey(e: KeyboardEvent) {
  const target = e.target as HTMLElement;
  // Typing boxes keep their keys; tick boxes, sliders and buttons don't need them.
  const inField = target.closest('textarea, select, input:not([type=checkbox]):not([type=range]):not([type=radio])');
  // Undo and redo work everywhere, typing included, so every change is covered.
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    const k = e.key.toLowerCase();
    if (k === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (k === 'y') {
      e.preventDefault();
      redo();
    }
    return;
  }
  if (inField) return;

  if (!e.altKey && /^[1-4]$/.test(e.key)) {
    applyPreset(PRESET_KEYS[Number(e.key) - 1]);
  } else if (!e.altKey && (e.key === 'm' || e.key === 'M')) {
    setMeasuring(!measuring);
  } else if (e.key === 'Tab' && (target === document.body || target.closest('#work'))) {
    // Step through the gaps in reading order.
    const cur = gapIndex(selected ?? hovered);
    selected = gapRef(cur < 0 ? (e.shiftKey ? -1 : 0) : cur + (e.shiftKey ? -1 : 1));
    draw();
  } else if (!e.altKey && e.key.startsWith('Arrow')) {
    // Plain arrows move the selected line: 0.1 mm, or 1 mm with Shift.
    if (selectedLine === null) return;
    const step = e.shiftKey ? 1 : 0.1;
    const [dx, dy] = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key] ?? [0, 0];
    moveLine(selectedLine, dx, dy);
  } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    // Kern the gap that's selected, or else the one under the pointer.
    if (!gapAt(selected) && gapAt(hovered)) selected = hovered;
    if (!gapAt(selected)) return;
    nudge(e.key === 'ArrowLeft' ? -1 : 1, e.shiftKey ? 1 : 0.1);
  } else if (e.key === 'Escape') {
    if (measuring) setMeasuring(false);
    if (scaling) {
      scaling = null;
      measure = null;
      syncPanelControls();
      drawOverlay();
    }
    selected = null;
    selectedLine = null;
    draw();
  } else return;
  e.preventDefault();
}

function undo() {
  const prev = history.undo(project);
  if (prev) restore(prev);
}

function redo() {
  const next = history.redo(project);
  if (next) restore(next);
}

function restore(p: Project) {
  project = p;
  syncControls();
  saveProject();
  refreshUndoButtons();
  relayout();
}

function refreshUndoButtons() {
  $<HTMLButtonElement>('undo').disabled = !history.canUndo;
  $<HTMLButtonElement>('redo').disabled = !history.canRedo;
}

// ---------------------------------------------------------------- rulers, guides, measure

/** Screen point (client px) to panel millimetres. */
function toMm(clientX: number, clientY: number) {
  const r = work.getBoundingClientRect();
  const v = view.v;
  return { x: (clientX - r.left - v.tx) / v.scale, y: (clientY - r.top - v.ty) / v.scale };
}

function overRuler(clientX: number, clientY: number) {
  const r = work.getBoundingClientRect();
  return clientX - r.left < RULER || clientY - r.top < RULER;
}

function wireTools() {
  $('undo').addEventListener('click', undo);
  $('redo').addEventListener('click', redo);
  $('measure').addEventListener('click', () => setMeasuring(!measuring));
  refreshUndoButtons();

  // Drag a guide out of a ruler: the top ruler gives a level guide, the left an upright one.
  $('ruler-top').addEventListener('pointerdown', (e) => startGuideDrag('y', -1, e));
  $('ruler-left').addEventListener('pointerdown', (e) => startGuideDrag('x', -1, e));
  $('ruler-corner').addEventListener('pointerdown', (e) => e.stopPropagation());
  overlay.addEventListener('pointerdown', (e) => {
    const g = (e.target as Element).closest('[data-guide]');
    if (!g || measuring) return;
    const [axis, i] = g.getAttribute('data-guide')!.split(':');
    startGuideDrag(axis as 'x' | 'y', Number(i), e);
  });

  // Measure: press, drag, release. Holds until the next measurement or Esc.
  work.addEventListener(
    'pointerdown',
    (e) => {
      if (!measuring || e.button !== 0) return;
      if ((e.target as Element).closest('#viewbar, #kern-pop, .ruler, #ruler-corner')) return;
      e.stopPropagation(); // don't pan
      const a = toMm(e.clientX, e.clientY);
      measure = { a, b: a };
      work.setPointerCapture(e.pointerId);
      const move = (m: PointerEvent) => {
        let b = toMm(m.clientX, m.clientY);
        // Shift keeps the measurement level or upright.
        if (m.shiftKey) b = Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
        measure = { a, b };
        drawOverlay();
      };
      const up = () => {
        work.removeEventListener('pointermove', move);
        work.removeEventListener('pointerup', up);
      };
      work.addEventListener('pointermove', move);
      work.addEventListener('pointerup', up);
    },
    true,
  );

  // The reference picture: drag it while unlocked, or click two points to scale it.
  work.addEventListener('pointerdown', onPicturePress, true);

  // Press on a line (its letters, a gap, or its number in the margin):
  // a click selects, a drag moves the line.
  work.addEventListener('pointerdown', onLinePress, true);
  wireLineEditor();

  // Track the pointer for the ruler markers and the gap under it.
  work.addEventListener('pointermove', (e) => {
    const r = work.getBoundingClientRect();
    pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    const g = (e.target as Element).closest('[data-gap]');
    hovered = g ? (([line, n]) => ({ line, n }))(g.getAttribute('data-gap')!.split(':').map(Number)) : null;
    drawRulers();
  });
  work.addEventListener('pointerleave', () => {
    pointer = null;
    hovered = null;
    drawRulers();
  });
}

function setMeasuring(on: boolean) {
  measuring = on;
  if (!on) measure = null;
  $('measure').classList.toggle('on', on);
  work.classList.toggle('measuring', on);
  drawOverlay();
}

function startGuideDrag(axis: 'x' | 'y', index: number, e: PointerEvent) {
  if (e.button !== 0) return;
  e.stopPropagation();
  e.preventDefault();
  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture(e.pointerId);
  const at = (m: PointerEvent) => (overRuler(m.clientX, m.clientY) ? null : round(toMm(m.clientX, m.clientY)[axis], 1));
  guideDrag = { axis, index, at: index >= 0 ? project.guides[axis][index] : null };
  const move = (m: PointerEvent) => {
    guideDrag = { axis, index, at: at(m) };
    drawOverlay();
  };
  const up = (u: PointerEvent) => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    const where = u.type === 'pointerup' ? at(u) : index >= 0 ? project.guides[axis][index] : null;
    guideDrag = null;
    const list = project.guides[axis].slice();
    if (index >= 0) list.splice(index, 1); // dragged back onto the ruler: removed
    if (where !== null) list.push(where);
    const changed = index >= 0 ? where !== project.guides[axis][index] : where !== null;
    if (changed) update({ guides: { ...project.guides, [axis]: list } });
    drawOverlay(); // show the dropped guide straight away
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

/** Ruler guides and the measurement, drawn in screen pixels so they stay hair-thin. */
function drawOverlay() {
  const v = view.v;
  const r = work.getBoundingClientRect();
  const sx = (x: number) => (v.tx + x * v.scale).toFixed(1);
  const sy = (y: number) => (v.ty + y * v.scale).toFixed(1);
  const out: string[] = [];
  const guide = (axis: 'x' | 'y', at: number, attr: string, live: boolean) => {
    const c = axis === 'x' ? sx(at) : sy(at);
    const pos = axis === 'x' ? `x1="${c}" x2="${c}" y1="0" y2="${r.height}"` : `y1="${c}" y2="${c}" x1="0" x2="${r.width}"`;
    out.push(`<g class="guide${live ? ' live' : ''}" ${attr}><line class="hit" ${pos}/><line ${pos}/></g>`);
    if (live) {
      const label = `${axis === 'x' ? 'across' : 'down'} ${at.toFixed(1)} mm`;
      const lx = axis === 'x' ? Number(c) + 6 : RULER + 6;
      const ly = axis === 'x' ? RULER + 16 : Number(c) - 6;
      out.push(`<text class="guide-label" x="${lx}" y="${ly}">${label}</text>`);
    }
  };
  for (const axis of ['x', 'y'] as const) {
    project.guides[axis].forEach((at, i) => {
      if (guideDrag && guideDrag.axis === axis && guideDrag.index === i) return;
      guide(axis, at, `data-guide="${axis}:${i}"`, false);
    });
  }
  if (guideDrag && guideDrag.at !== null) guide(guideDrag.axis, guideDrag.at, '', true);

  if (measure) {
    const { a, b } = measure;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    out.push(`<g class="measure"><line x1="${sx(a.x)}" y1="${sy(a.y)}" x2="${sx(b.x)}" y2="${sy(b.y)}"/>`);
    for (const p of [a, b]) out.push(`<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="3"/>`);
    const mx = (Number(sx(a.x)) + Number(sx(b.x))) / 2;
    const my = (Number(sy(a.y)) + Number(sy(b.y))) / 2;
    out.push(
      `<text x="${mx.toFixed(1)}" y="${(my - 10).toFixed(1)}">${d.toFixed(1)} mm</text>` +
        `<text class="small" x="${mx.toFixed(1)}" y="${(my + 18).toFixed(1)}">across ${Math.abs(b.x - a.x).toFixed(1)} · down ${Math.abs(b.y - a.y).toFixed(1)}</text></g>`,
    );
  }
  // Snapping guides while a line is dragged.
  if (lineSnaps) {
    const p = project;
    if (lineSnaps.x) {
      const c = sx(lineSnaps.x.target.at);
      out.push(
        `<g class="snap"><line x1="${c}" x2="${c}" y1="${sy(-4)}" y2="${sy(p.panelHeight + 4)}"/>` +
          `<text x="${Number(c) + 5}" y="${Number(sy(0)) - 6}">${esc(lineSnaps.x.target.label)}</text></g>`,
      );
    }
    if (lineSnaps.y) {
      const c = sy(lineSnaps.y.target.at);
      out.push(
        `<g class="snap"><line y1="${c}" y2="${c}" x1="${sx(-4)}" x2="${sx(p.panelWidth + 4)}"/>` +
          `<text x="${Number(sx(p.panelWidth)) - 6}" y="${Number(c) - 5}" text-anchor="end">${esc(lineSnaps.y.target.label)}</text></g>`,
      );
    }
  }
  overlay.innerHTML = out.join('');
  drawRulers();
}

function drawRulers() {
  const r = work.getBoundingClientRect();
  $('ruler-top').innerHTML = rulerSvg('x', r.width, view.v, pointer?.x ?? null);
  $('ruler-left').innerHTML = rulerSvg('y', r.height, view.v, pointer?.y ?? null);
}

// ---------------------------------------------------------------- lines

/** Where a line is now, as a placement (an auto line is worked out from its layout). */
function placementOf(line: PlacedLine): LinePlacement {
  const own = project.lines[String(line.index)];
  if (own) return own;
  return { x: lineAnchor(line.x0, project.align, line.width), align: project.align, baseline: line.baselineY };
}

function lineAtIndex(i: number | null): PlacedLine | null {
  if (!layout || i === null) return null;
  return layout.lines[i] ?? null;
}

function setPlacement(index: number, place: LinePlacement | null, group: string | null = null) {
  const lines = { ...project.lines };
  if (place) lines[String(index)] = place;
  else delete lines[String(index)];
  update({ lines }, undefined, group);
}

/** Nudge a line by (dx, dy) mm. An auto line becomes placed. */
function moveLine(index: number, dx: number, dy: number) {
  const line = lineAtIndex(index);
  if (!line || line.locked) return;
  const p0 = placementOf(line);
  setPlacement(index, { ...p0, x: round(p0.x + dx, 3), baseline: round(p0.baseline + dy, 3) }, `nudge-line-${index}`);
}

function onLinePress(e: PointerEvent) {
  if (measuring || e.button !== 0) return;
  const t = e.target as Element;
  const hit = t.closest('[data-gap], [data-line]');
  if (!hit || !layout) return;
  e.stopPropagation(); // not a pan
  const gapAttr = hit.getAttribute('data-gap');
  const index = gapAttr ? Number(gapAttr.split(':')[0]) : Number(hit.getAttribute('data-line'));
  const line = lineAtIndex(index);
  if (!line) return;

  const start = { x: e.clientX, y: e.clientY };
  const from = toMm(e.clientX, e.clientY);
  const before = project;
  const p0 = placementOf(line);
  const ink = line.ink!;
  const k = project.capHeight;
  const targets = snapTargets(layout, index);
  let dragging = false;

  const move = (m: PointerEvent) => {
    if (!dragging) {
      if (Math.hypot(m.clientX - start.x, m.clientY - start.y) < 4 || line.locked) return;
      dragging = true;
      selectedLine = index;
      work.setPointerCapture(m.pointerId);
      work.classList.add('dragging-line');
    }
    const at = toMm(m.clientX, m.clientY);
    let dx = at.x - from.x;
    let dy = at.y - from.y;
    let sx: Snap | null = null;
    let sy: Snap | null = null;
    if (!m.altKey) {
      // Hold Alt to move freely, without snapping.
      const tol = 8 / view.v.scale;
      sx = nearest(
        [
          { f: 'left', at: ink.x0 + dx },
          { f: 'centre', at: (ink.x0 + ink.x1) / 2 + dx },
          { f: 'right', at: ink.x1 + dx },
        ],
        targets.x,
        tol,
      );
      sy = nearest(
        [
          { f: 'base', at: line.baselineY + dy },
          { f: 'cap', at: line.baselineY - k + dy },
          { f: 'mid', at: line.baselineY - k / 2 + dy },
        ],
        targets.y,
        tol,
      );
    }
    dx = sx ? dx + sx.offset : round(dx, 1);
    dy = sy ? dy + sy.offset : round(dy, 1);
    lineSnaps = { x: sx, y: sy };
    project = { ...project, lines: { ...project.lines, [String(index)]: { ...p0, x: round(p0.x + dx, 3), baseline: round(p0.baseline + dy, 3) } } };
    relayout();
  };
  const up = (u: PointerEvent) => {
    work.removeEventListener('pointermove', move);
    work.removeEventListener('pointerup', up);
    work.removeEventListener('pointercancel', up);
    work.classList.remove('dragging-line');
    lineSnaps = null;
    if (dragging) {
      // The whole drag is one step to undo.
      if (project !== before) history.record(before);
      refreshUndoButtons();
      saveProject();
      relayout();
      return;
    }
    if (u.type !== 'pointerup') return;
    // A click: a gap selects that gap for kerning (and its line); anything else selects the line.
    selectedLine = index;
    if (gapAttr) {
      const [l, n] = gapAttr.split(':').map(Number);
      selected = { line: l, n };
    } else {
      selected = null;
    }
    draw();
  };
  work.addEventListener('pointermove', move);
  work.addEventListener('pointerup', up);
  work.addEventListener('pointercancel', up);
}

/** The side-panel box for the selected line. */
function showLineEditor() {
  const box = $('line-editor');
  const line = lineAtIndex(selectedLine);
  if (!line || !line.ink) {
    box.innerHTML = '';
    box.dataset.line = '';
    return;
  }
  const values = {
    left: line.ink.x0,
    centre: (line.ink.x0 + line.ink.x1) / 2,
    baseline: line.baselineY,
  };
  // Rebuild only when a different line is selected, so typing in a box isn't interrupted.
  if (box.dataset.line !== String(line.index)) {
    box.dataset.line = String(line.index);
    box.innerHTML = `
      <p class="line-title"><b>Line ${line.index + 1}</b> <span class="line-text"></span></p>
      <p class="line-state"></p>
      <div class="boxes">
        <label>Left end <span><input type="number" step="0.1" data-pos="left" /> mm</span></label>
        <label>Centre <span><input type="number" step="0.1" data-pos="centre" /> mm</span></label>
        <label>Baseline <span><input type="number" step="0.1" data-pos="baseline" /> mm</span></label>
      </div>
      <p class="hint small">Measured from the panel's left edge and top edge, to the letters themselves.</p>
      <div class="line-buttons">
        <button data-act="auto">Return to auto</button>
        <button data-act="lock"></button>
      </div>`;
  }
  box.querySelector('.line-text')!.textContent = line.text.trim();
  box.querySelector('.line-state')!.textContent = line.locked
    ? 'Locked: it will not move until unlocked.'
    : line.placed
      ? 'Placed by hand: it stays put when the line spacing or alignment changes.'
      : 'Auto: it follows the line spacing and alignment.';
  for (const input of box.querySelectorAll<HTMLInputElement>('[data-pos]')) {
    if (document.activeElement !== input) input.value = values[input.dataset.pos as keyof typeof values].toFixed(1);
    input.disabled = line.locked;
  }
  const auto = box.querySelector<HTMLButtonElement>('[data-act="auto"]')!;
  auto.disabled = !line.placed || line.locked;
  box.querySelector('[data-act="lock"]')!.textContent = line.locked ? 'Unlock' : 'Lock';
}

function wireLineEditor() {
  const box = $('line-editor');
  box.addEventListener('change', (e) => {
    const input = (e.target as HTMLElement).closest<HTMLInputElement>('[data-pos]');
    const line = lineAtIndex(selectedLine);
    if (!input || !line?.ink || line.locked) return;
    const v = Number(input.value);
    if (input.value === '' || !Number.isFinite(v)) return;
    const p0 = placementOf(line);
    const pos = input.dataset.pos;
    if (pos === 'baseline') setPlacement(line.index, { ...p0, baseline: v });
    else {
      const now = pos === 'left' ? line.ink.x0 : (line.ink.x0 + line.ink.x1) / 2;
      setPlacement(line.index, { ...p0, x: round(p0.x + v - now, 3) });
    }
  });
  box.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    const line = lineAtIndex(selectedLine);
    if (!b || !line) return;
    if (b.dataset.act === 'auto') setPlacement(line.index, null);
    if (b.dataset.act === 'lock') setPlacement(line.index, { ...placementOf(line), locked: !line.locked });
  });
  $('reflow').addEventListener('click', () => {
    // Every line back to auto, except locked ones, which stay where they are.
    const kept = Object.fromEntries(Object.entries(project.lines).filter(([, pl]) => pl.locked));
    update({ lines: kept });
  });
}

// ---------------------------------------------------------------- panel, border, margins, picture

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

function wirePanel() {
  $('fit-panel').addEventListener('click', fitPanelToLettering);

  $('border-style').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-border]');
    if (b) update({ border: { ...project.border, style: b.dataset.border as BorderStyle } });
  });
  for (const [id, key, min] of [
    ['b-inset', 'inset', 0],
    ['b-gap', 'gap', 0.2],
    ['b-width', 'width', 0.5],
  ] as const) {
    const input = $<HTMLInputElement>(id);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      if (input.value !== '' && Number.isFinite(v) && v >= min) update({ border: { ...project.border, [key]: v } }, input, id);
    });
  }

  for (const side of SIDES) {
    const input = $<HTMLInputElement>(`m-${side}`);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      if (input.value !== '' && Number.isFinite(v) && v >= 0) update({ margins: { ...project.margins, [side]: v } }, input, `m-${side}`);
    });
  }
  const all = $<HTMLInputElement>('m-all');
  all.addEventListener('input', () => {
    const v = Number(all.value);
    if (all.value !== '' && Number.isFinite(v) && v >= 0) update({ margins: { top: v, right: v, bottom: v, left: v } }, all, 'm-all');
  });

  // Reference picture.
  const file = $<HTMLInputElement>('ref-file');
  $('ref-load').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (f) await loadPicture(f);
  });
  $<HTMLInputElement>('ref-visible').addEventListener('change', (e) =>
    setPicture({ visible: (e.target as HTMLInputElement).checked }),
  );
  $<HTMLInputElement>('ref-locked').addEventListener('change', (e) =>
    setPicture({ locked: (e.target as HTMLInputElement).checked }),
  );
  const opacity = $<HTMLInputElement>('ref-opacity');
  opacity.addEventListener('input', () => setPicture({ opacity: Number(opacity.value) }, 'ref-opacity'));
  const width = $<HTMLInputElement>('ref-width');
  width.addEventListener('change', () => {
    const v = Number(width.value);
    if (width.value !== '' && Number.isFinite(v) && v > 0) setPicture({ width: v });
  });
  $('ref-scale').addEventListener('click', () => {
    if (measuring) setMeasuring(false);
    scaling = scaling ? null : { a: null };
    syncPanelControls();
    drawOverlay();
  });
  $('ref-remove').addEventListener('click', () => {
    scaling = null;
    update({ refImage: null });
  });
}

function setPicture(change: Partial<NonNullable<Project['refImage']>>, group: string | null = null) {
  if (!project.refImage) return;
  update({ refImage: { ...project.refImage, ...change } }, undefined, group);
}

async function loadPicture(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    alert('That file could not be opened as a picture.');
    return;
  }
  if (refUrl) URL.revokeObjectURL(refUrl);
  refUrl = url;
  await saveImage(blob);
  // Start it the width of the panel, at the top-left corner, half strength and unlocked.
  update({
    refImage: { x: 0, y: 0, width: project.panelWidth, aspect: img.naturalHeight / img.naturalWidth, opacity: 0.5, locked: false, visible: true },
  });
}

function syncPanelControls(source?: Element) {
  const p = project;
  const b = p.border;
  $('border-style')
    .querySelectorAll<HTMLElement>('[data-border]')
    .forEach((el) => el.classList.toggle('on', el.dataset.border === b.style));
  $('border-boxes')
    .querySelectorAll<HTMLElement>('[data-for]')
    .forEach((el) => (el.hidden = !el.dataset.for!.split(' ').includes(b.style)));
  for (const [id, key] of [
    ['b-inset', 'inset'],
    ['b-gap', 'gap'],
    ['b-width', 'width'],
  ] as const) {
    const input = $<HTMLInputElement>(id);
    if (input !== source) input.value = String(b[key]);
  }
  $('border-hint').textContent =
    b.style === 'none'
      ? ''
      : b.style === 'incised'
        ? 'Cut like the letters: hairline on both edges, datum lines by the same rule, and a valley forking into each corner. Corner styles come later.'
        : 'Scribed hairline, measured to the line. Corner styles come later.';
  $('margin-hint').textContent =
    b.style === 'none'
      ? 'Clear space round the lettering, measured from the panel edge.'
      : "Clear space round the lettering, measured from the border's inner edge.";
  for (const side of SIDES) {
    const input = $<HTMLInputElement>(`m-${side}`);
    if (input !== source) input.value = String(p.margins[side]);
  }
  const all = $<HTMLInputElement>('m-all');
  const m: Margins = p.margins;
  if (all !== source) all.value = m.top === m.right && m.top === m.bottom && m.top === m.left ? String(m.top) : '';

  const ri = p.refImage;
  $('ref-controls').hidden = !ri;
  $('ref-load').textContent = ri ? 'Load a different picture…' : 'Load a picture…';
  if (ri) {
    $<HTMLInputElement>('ref-visible').checked = ri.visible;
    $<HTMLInputElement>('ref-locked').checked = ri.locked;
    $<HTMLInputElement>('ref-opacity').value = String(ri.opacity);
    $('ref-opacity-read').textContent = `${Math.round(ri.opacity * 100)}%`;
    const w = $<HTMLInputElement>('ref-width');
    if (w !== source && document.activeElement !== w) w.value = ri.width.toFixed(1);
    $('ref-scale').classList.toggle('on', !!scaling);
    $<HTMLButtonElement>('ref-scale').disabled = ri.locked;
    $('ref-hint').textContent = scaling
      ? scaling.a
        ? 'Now click the second point.'
        : 'Click the first of two points on the picture whose real distance apart you know.'
      : ri.locked
        ? 'Locked: unlock it to move or scale it.'
        : 'While it is unlocked, drag the picture to move it.';
    if (!refUrl) $('ref-hint').textContent = 'The picture itself was not kept by this browser; load it again.';
  }
}

/** One undoable step: size the panel round the lettering and shift everything placed by hand to match. */
function fitPanelToLettering() {
  if (!layout) return;
  const f = fitToLettering(layoutPanel(store!, project));
  if (!f) return;
  const lines = Object.fromEntries(
    Object.entries(project.lines).map(([k, pl]) => [k, { ...pl, x: pl.x + f.dx, baseline: pl.baseline + f.dy }]),
  );
  const guides = { x: project.guides.x.map((g) => round(g + f.dx, 1)), y: project.guides.y.map((g) => round(g + f.dy, 1)) };
  const refImage = project.refImage ? { ...project.refImage, x: project.refImage.x + f.dx, y: project.refImage.y + f.dy } : null;
  update({ panelWidth: f.width, panelHeight: f.height, lines, guides, refImage });
  requestAnimationFrame(fitPanel);
}

function onPicturePress(e: PointerEvent) {
  const ri = project.refImage;
  if (!ri || measuring || e.button !== 0) return;
  const t = e.target as Element;
  if (t.closest('#viewbar, #kern-pop, .ruler, #ruler-corner')) return;

  // Scaling: two clicks on the picture, then the real distance between them.
  if (scaling) {
    e.stopPropagation();
    const at = toMm(e.clientX, e.clientY);
    if (!scaling.a) {
      scaling = { a: at };
      measure = { a: at, b: at };
      const follow = (m: PointerEvent) => {
        if (!scaling?.a) return work.removeEventListener('pointermove', follow);
        measure = { a: scaling.a, b: toMm(m.clientX, m.clientY) };
        drawOverlay();
      };
      work.addEventListener('pointermove', follow);
      syncPanelControls();
      drawOverlay();
      return;
    }
    const a = scaling.a;
    scaling = null;
    measure = null;
    const onScreen = Math.hypot(at.x - a.x, at.y - a.y);
    syncPanelControls();
    drawOverlay();
    if (onScreen < 0.5) return;
    const answer = prompt(`These two points are ${onScreen.toFixed(1)} mm apart on the panel now.\nHow far apart are they really, in mm?`);
    const real = Number(answer?.replace(',', '.'));
    if (!answer || !Number.isFinite(real) || real <= 0) return;
    // Scale about the first point, so it stays where it is.
    const k = real / onScreen;
    setPicture({ width: ri.width * k, x: a.x - (a.x - ri.x) * k, y: a.y - (a.y - ri.y) * k });
    return;
  }

  // Dragging the unlocked picture (lines and gaps on top of it take the press first).
  if (!t.closest('[data-refimage]')) return;
  e.stopPropagation();
  const from = toMm(e.clientX, e.clientY);
  const before = project;
  const start = { x: ri.x, y: ri.y };
  work.setPointerCapture(e.pointerId);
  const move = (m: PointerEvent) => {
    const at = toMm(m.clientX, m.clientY);
    project = { ...project, refImage: { ...ri, x: round(start.x + at.x - from.x, 1), y: round(start.y + at.y - from.y, 1) } };
    draw();
  };
  const up = () => {
    work.removeEventListener('pointermove', move);
    work.removeEventListener('pointerup', up);
    work.removeEventListener('pointercancel', up);
    if (project !== before) {
      history.record(before);
      refreshUndoButtons();
      saveProject();
    }
  };
  work.addEventListener('pointermove', move);
  work.addEventListener('pointerup', up);
  work.addEventListener('pointercancel', up);
}

// ---------------------------------------------------------------- helpers

function pxPerMm() {
  return NOMINAL_PX_PER_MM * calibration;
}

function setCalibration(v: number) {
  calibration = Math.min(1.6, Math.max(0.6, v));
  try {
    localStorage.setItem(CAL_KEY, String(calibration));
  } catch {
    /* storage unavailable: lasts for this visit only */
  }
  applyView();
}

function loadProject(): Project {
  try {
    const raw = localStorage.getItem(PROJECT_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      // Older saves had one margin for all four sides.
      if (typeof saved.margin === 'number' && !saved.margins) {
        const m = saved.margin;
        saved.margins = { top: m, right: m, bottom: m, left: m };
      }
      delete saved.margin;
      return { ...structuredClone(defaultProject), ...saved };
    }
  } catch {
    /* fall through to the default */
  }
  return structuredClone(defaultProject);
}

let saveTimer = 0;
function saveProject() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(PROJECT_KEY, JSON.stringify(project));
    } catch {
      /* storage unavailable */
    }
  }, 300);
}

function readNumber(key: string, fallback: number, min: number, max: number) {
  try {
    const v = parseFloat(localStorage.getItem(key) ?? '');
    return v >= min && v <= max ? v : fallback;
  } catch {
    return fallback;
  }
}

function round(v: number, places: number) {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}

function signed(v: number) {
  return v > 0 ? `+${v.toFixed(1)}` : v < 0 ? `−${(-v).toFixed(1)}` : '0.0';
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

// ---------------------------------------------------------------- start

async function start() {
  buildControls();
  syncControls();
  const res = await fetch(`${import.meta.env.BASE_URL}fonts/Cinzel-Regular.woff`);
  if (!res.ok) throw new Error(`font file missing (${res.status})`);
  const alphabet = alphabetFromFont(await res.arrayBuffer(), 'SIL Open Font License 1.1');
  store = new LetterStore(alphabet);
  $('credit').innerHTML =
    `Stand-in alphabet: <b>${esc(alphabet.name)}</b> by Natanael Gama, ${alphabet.licence} ` +
    `(<a href="./fonts/OFL.txt">licence</a>).`;
  layout = layoutPanel(store, project);
  if (project.refImage) {
    const blob = await loadImage();
    if (blob) refUrl = URL.createObjectURL(blob);
    syncPanelControls();
  }
  $('loading').hidden = true;
  fitPanel();
  draw();
}

start().catch((err) => {
  $('loading').textContent = `Could not load the letters: ${err}`;
});
