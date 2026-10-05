import { alphabetFromFont } from './alphabet';
import { contourToSvg, polylineToSvg } from './geometry';
import { defaultProject, layoutPanel, type Align, type Gap, type Layout, type Project } from './layout';
import { LetterStore } from './letters';
import { negativeSpace } from './negativeSpace';
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

const $ = <T extends Element = HTMLElement>(id: string) => document.getElementById(id) as unknown as T;
const work = $('work');
const world = $<SVGGElement>('world');
const labels = $<SVGGElement>('labels');
const pop = $('kern-pop');

const view = new PanZoom(work, {
  changed: () => {
    applyView();
  },
  click: (target) => {
    const g = target.closest('[data-gap]');
    if (g) {
      const [line, n] = g.getAttribute('data-gap')!.split(':').map(Number);
      selected = { line, n };
    } else {
      selected = null;
    }
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
    range.addEventListener('input', () => update({ [s.key]: Number(range.value) }));
    num.addEventListener('input', () => {
      const v = Number(num.value);
      if (num.value !== '' && Number.isFinite(v)) update({ [s.key]: v }, num);
    });
  }

  const text = $<HTMLTextAreaElement>('text');
  text.addEventListener('input', () => {
    selected = null; // gaps are renumbered when the text changes
    update({ text: text.value }, text);
  });

  $('align').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (b) update({ align: b.dataset.align as Align });
  });

  for (const key of ['panelWidth', 'panelHeight', 'margin'] as const) {
    const input = $<HTMLInputElement>(key);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      if (input.value !== '' && Number.isFinite(v) && v >= (key === 'margin' ? 0 : 1)) update({ [key]: v }, input);
    });
  }

  for (const layer of ['outline', 'datum', 'valley', 'fill', 'space']) {
    const cb = $<HTMLInputElement>(`show-${layer}`);
    const sync = () => {
      work.classList.toggle(`hide-${layer}`, !cb.checked);
      if (layer === 'space') draw();
    };
    cb.addEventListener('change', sync);
    work.classList.toggle(`hide-${layer}`, !cb.checked);
  }

  // Kerning box.
  for (const el of [pop, $('viewbar')]) el.addEventListener('pointerdown', (e) => e.stopPropagation());
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
  document.addEventListener('keydown', (e) => {
    if (!selected || (e.target as HTMLElement).closest('input, textarea')) return;
    if (e.key === 'ArrowLeft') nudge(-1);
    else if (e.key === 'ArrowRight') nudge(1);
    else if (e.key === 'Escape') {
      selected = null;
      draw();
    } else return;
    e.preventDefault();
  });
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
    if (!confirm('Clear the inscription, settings and kerning, and start again with OAK?')) return;
    project = structuredClone(defaultProject);
    selected = null;
    update({});
    fitPanel();
  });

  new ResizeObserver(() => applyView()).observe(work);
}

/** Apply a change to the project. `source` is the box being typed in, left alone. */
function update(change: Partial<Project>, source?: Element) {
  project = { ...project, ...change };
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
  for (const key of ['panelWidth', 'panelHeight', 'margin'] as const) {
    const input = $<HTMLInputElement>(key);
    if (input !== source) input.value = String(project[key]);
  }
  $('align')
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('on', b.dataset.align === project.align));
}

/** Move the selected gap's letters 0.1 mm closer (-1) or apart (+1); 0 puts it back. */
function nudge(dir: number) {
  const gap = selectedGap();
  if (!gap) return;
  if (kernMode === 'pair') {
    const k = { ...project.kerning };
    const v = dir === 0 ? 0 : round(gap.pairKern + dir * 0.1, 1);
    if (v === 0) delete k[gap.pair];
    else k[gap.pair] = v;
    update({ kerning: k });
  } else {
    const k = { ...project.gapKerning };
    const v = dir === 0 ? 0 : round(gap.gapKern + dir * 0.1, 1);
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
  if (!layout || !selected) return null;
  const inLine = layout.gaps.filter((g) => g.line === selected!.line);
  return inLine[selected.n] ?? null;
}

const fmt = (n: number) => n.toFixed(3);

function draw() {
  if (!layout) return;
  const p = project;
  const L = layout;
  const out: string[] = [];

  out.push(`<rect class="panel" x="0" y="0" width="${p.panelWidth}" height="${p.panelHeight}"/>`);
  if (p.margin > 0) {
    out.push(
      `<rect class="margin" x="${p.margin}" y="${p.margin}" width="${Math.max(0, p.panelWidth - 2 * p.margin)}" height="${Math.max(0, p.panelHeight - 2 * p.margin)}"/>`,
    );
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
  for (const g of labelData.gaps) {
    if (!g.kern && !g.gapKern) continue;
    const base = layout!.lines[g.line].baselineY;
    const y = sy(base) + 14;
    out.push(`<text class="kern" x="${sx(g.x).toFixed(1)}" y="${y.toFixed(1)}">${signed(g.kern)}</text>`);
    if (g.gapKern) {
      out.push(
        `<text class="kern own" x="${sx(g.x).toFixed(1)}" y="${(y + 13).toFixed(1)}">this gap ${signed(g.gapKern)}</text>`,
      );
    }
  }
  out.push(
    `<text class="dims" x="${sx(p.panelWidth / 2).toFixed(1)}" y="${(sy(p.panelHeight) + 18).toFixed(1)}">${p.panelWidth} × ${p.panelHeight} mm</text>`,
  );
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

  $('zoom-read').textContent = `${(v.scale / pxPerMm()).toFixed(2)} × true size`;
  $('ruler').style.width = `${100 * pxPerMm()}px`;
  $<HTMLInputElement>('cal').value = String(calibration);
}

function showWarnings() {
  const p = project;
  const w: string[] = [];
  if (layout!.overflow.wide) w.push('The lettering runs past the side margins.');
  if (layout!.overflow.tall) w.push('The lines run past the top or bottom margin.');
  const fits = (a: number, b: number) => (p.panelWidth <= a && p.panelHeight <= b) || (p.panelWidth <= b && p.panelHeight <= a);
  if (!fits(300, 400)) w.push('The panel is bigger than the machine bed, even extended (300 × 400 mm).');
  else if (!fits(300, 205)) w.push('The panel needs the extended bed (300 × 400 mm).');
  $('warnings').innerHTML = w.map((t) => `<p class="warn">${t}</p>`).join('');
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
    if (raw) return { ...structuredClone(defaultProject), ...JSON.parse(raw) };
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
  $('loading').hidden = true;
  fitPanel();
  draw();
}

start().catch((err) => {
  $('loading').textContent = `Could not load the letters: ${err}`;
});
