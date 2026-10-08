import { alphabetFromFont } from './alphabet';
import { benchSheet, scaleName, strokeLabels } from './benchsheet';
import { borderMarks } from './border';
import { contourToSvg, polylineToSvg, type Contour } from './geometry';
import { datumLines, type DatumRule } from './datum';
import { LINK_OVERLAP } from './links';
import type { ValleyLine } from './valley';
import {
  contentBox,
  defaultProject,
  kernKept,
  kernMm,
  isBlank,
  layoutPanel,
  lineAnchor,
  lineNumber,
  pairKerning,
  type Align,
  type Gap,
  type Layout,
  type BorderStyle,
  type LineExtra,
  type LinePlacement,
  type Margins,
  type PlacedLine,
  type Project,
} from './layout';
import { blobToDataUrl, chooseFile, dataUrlToBlob, download, saveFile, type FileHandle, type FileKind } from './files';
import { loadImage, saveImage } from './imagestore';
import { balanceHtml, lineListHtml, overviewSvg, overviewViewBox, type OverviewMode } from './inspector';
import { BED, BED_EXTENDED, bedFit, fitLetteringToPanel, fitToLettering, resizeLettering, shrinkDesignToBed, type FitAxis } from './panel';
import { defaultGroups, type Side } from './groups';
import { defaultBox, evenUp, fitBlock, fitLine, type EvenUp, type FitBy } from './spacing';
import { AIR_GAP, toGcode } from './gcode';
import { openPalette, type Command } from './palette';
import { attachFixes, checkFixes, layoutProblems, machineProblems, passDepths, problemSummary, tryFixes, type Fix, type Problem, type Stage } from './problems';
import { alphabetDifferences, FILE_EXTENSION, FILE_TYPE, fileNameFor, normaliseProject, PlainError, projectFileText, readProjectFile } from './projectfile';
import { AppFileError, fetchAppFile, onFileLaunch, refreshApp, savedCopies, startApp } from './pwa';
import { enableScrub } from './scrub';
import { SHORTCUTS } from './shortcuts';
import { chooseRes, finishedInput, packCuts, packShapes, type Area } from './relief';
import type { ReliefJob, ReliefResult } from './relief-job';
import reliefWorkerUrl from './relief.worker.ts?worker&url';
import { APP_PUBLISHED, APP_VERSION, VERSION_TEXT } from './version';
import type { Board3D, Colouring } from './view3d';
import { buildPasses, checkPasses, CORNER_NAMES, MAX_SCRIBE_DEPTH, type Check, type MachineSettings, type Pass, type PassName } from './toolpath';
import { LetterStore } from './letters';
import { negativeSpace } from './negativeSpace';
import { oakUrl } from './oak';
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
let kernMode: 'group' | 'pair' | 'gap' = 'pair';
/** Even-up suggestions on offer, the carver's tweaks to them, and whether to preview them on the panel. */
let suggest: EvenUp | null = null;
let tweaks: Record<string, number> = {};
let previewSuggest = false;
/** Fitting settings (not part of the job). */
let fitBy: FitBy = 'letter';
/**
 * The toolpath preview: the passes worked out for one exact state of the
 * project, which ones the carver has looked at, and which is showing. Any
 * change to the project closes it, so what is saved is what was checked.
 */
let cam: {
  project: Project;
  layout: Layout;
  passes: Pass[];
  checks: Check[];
  viewed: Set<PassName>;
  show: PassName | 'all';
} | null = null;
/** The 3D view: open or not, what it shows, and the light. */
const v3d = {
  open: false,
  board: null as Board3D | null,
  state: 'marked' as 'marked' | 'finished',
  colour: 'plain' as Colouring,
  across: -45,
  height: 25,
  sweep: 0,
  rebuild: 0,
  /** The worker doing the sums (relief.worker.ts), made when first needed and again after a cancel. */
  worker: null as Worker | null,
  /** The piece of work under way, if any: the whole board, or a sharper area of it. */
  job: null as { id: number; area: Area | null; project: Project; state: 'marked' | 'finished' } | null,
  lastId: 0,
  /** What the board on show was worked out for, and its cell size. */
  shown: null as { project: Project; state: 'marked' | 'finished'; res: number; maxDepth: number } | null,
  /** What "Try again" on the card does after a failure: the drawing, the board, or a sharper area of it. */
  retry: null as { board: true } | { area: Area | null } | null,
};
/** The alphabet's own settings are saved under its name. */
let alphabetName = '';
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
/** The selected blank line (its place in the text), or null. */
let selectedSpacer: number | null = null;
/** The inspection panel: shown or hidden, and how the overview draws the letters. */
const INSPECT_KEY = 'incised.inspect';
// Open to start with, except on a small screen, where it would cover the panel.
let inspectOpen = readNumber(INSPECT_KEY, window.innerWidth >= 1100 ? 1 : 0, 0, 1) === 1;
let ovMode: OverviewMode = 'letters';
/** The reference picture, ready to show (an object URL), once loaded. */
let refUrl: string | null = null;
/** Scaling the reference picture: the first point clicked, while waiting for the second. */
let scaling: { a: { x: number; y: number } | null } | null = null;
/** What a line being dragged has snapped to, to draw the snapping guides. */
let lineSnaps: { x: Snap | null; y: Snap | null } | null = null;
/** Stages of the job, in order, on keys 1 to 5 (BRIEF.md, Decisions: the interface). */
const STAGES: Stage[] = ['write', 'space', 'panel', 'machine', '3d'];
const STAGE_NAMES: Record<Stage, string> = { write: 'Write', space: 'Space', panel: 'Panel', machine: 'Machine', '3d': '3D' };
const STAGE_KEY = 'incised.stage';
let stage: Stage = 'write';
/** The stage to go back to from the 3D view. */
let lastFlatStage: Stage = 'write';
/** Snapping while a line is dragged; S turns it on and off. */
const SNAP_KEY = 'incised.snap';
let snapping = readNumber(SNAP_KEY, 1, 0, 1) === 1;
/** While a setting is dragged by its name, its changes gather into one step to undo. */
let batch: { before: Project } | null = null;
/** The project file: its name, its handle where the browser gives one, and the project as last saved or opened. */
const FILE_KEY = 'incised.file';
const PROJECT_FILE: FileKind = { description: 'Lettering project', type: FILE_TYPE, extension: FILE_EXTENSION };
let file: { name: string; handle: FileHandle | null; saved: Project | null } | null = null;
/** The G-code safety checks for the warnings badge, worked out a moment after things stop changing. */
/** The G-code checks for a project, and its passes (the 3D view uses them too). */
let machineChecks: { project: Project; problems: Problem[]; passes: Pass[]; pending?: boolean } | null = null;
let checkTimer = 0;
/**
 * The fixes for letters that collide, tried on copies of the layout for the
 * job as it was (problems.ts, tryFixes). They follow a moment behind.
 */
let fixTrials: { project: Project; fixes: Map<string, Fix[]>; done: boolean } | null = null;
/** The job whose collision fixes are being tried now, and which round of trying it is. */
let trialFor: Project | null = null;
let trialRound = 0;
let trialTimer = 0;
const TRIAL_SLICE = 'Trying the fixes for letters that collide';
/** The problem marked on the panel (its key), from clicking it in the problems list or pressing P. */
let marked: string | null = null;

const $ = <T extends Element = HTMLElement>(id: string) => document.getElementById(id) as unknown as T;
const work = $('work');
const world = $<SVGGElement>('world');
const labels = $<SVGGElement>('labels');
const overlay = $<SVGGElement>('overlay');
const pop = $('kern-pop');
const linePop = $('line-pop');
const spacerPop = $('spacer-pop');

const view = new PanZoom(work, {
  changed: () => {
    applyView();
  },
  // Clicks on letters, gaps and line numbers are handled by onLinePress;
  // a click anywhere else clears the selection.
  click: (target) => {
    selected = null;
    selectedLine = null;
    // A click on a blank line's band selects it, to show its height.
    const band = target.closest('[data-spacer]');
    selectedSpacer = band ? Number(band.getAttribute('data-spacer')) : null;
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
    // Once a new size is entered, the view follows if the panel no longer sits comfortably on screen.
    input.addEventListener('change', () => requestAnimationFrame(() => panelOffScreen() && fitPanel()));
  }
  wirePanel();
  wireSpacing();
  wireMachine();
  wire3d();

  for (const layer of LAYERS) {
    const cb = $<HTMLInputElement>(`show-${layer}`);
    cb.addEventListener('change', () => {
      setPreset(null); // fine control: no preset is exactly what's showing now
      syncLayers();
      rememberView();
      draw();
    });
  }
  syncLayers();
  $('presets').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-preset]');
    if (b) applyPreset(b.dataset.preset as PresetName);
  });

  // Kerning box.
  for (const el of [pop, linePop, $('viewbar')]) el.addEventListener('pointerdown', (e) => e.stopPropagation());
  wireTools();
  pop.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    if (b.hasAttribute('data-close')) {
      selected = null;
      draw();
    } else if (b.hasAttribute('data-link')) {
      toggleLink(selectedGap());
    } else if (b.dataset.mode) {
      kernMode = b.dataset.mode as 'group' | 'pair' | 'gap';
      applyView();
    } else nudge(Number(b.dataset.nudge));
  });
  pop.querySelector<HTMLInputElement>('[data-overlap]')!.addEventListener('input', (e) => {
    const gap = selectedGap();
    const input = e.target as HTMLInputElement;
    if (gap?.link && input.value !== '') setOverlap(gap, Math.max(0, Number(input.value)), input);
  });
  document.addEventListener('keydown', onKey);
  $('kerning-summary').addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('#clear-kerning')) {
      if (confirm('Clear all group, pair and one-gap kerning? Group and pair kerning are shared by every job with this alphabet. (Undo brings it back.)'))
        update({ kerning: {}, groupKerning: {}, gapKerning: {} });
    }
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

  wireChrome();
  new ResizeObserver(() => applyView()).observe(work);
}

/**
 * Apply a change to the project. `source` is the box being typed in, left
 * alone. Changes with the same `group` in quick succession undo as one step.
 */
function update(change: Partial<Project>, source?: Element, group: string | null = null) {
  if (!batch) history.record(project, group);
  project = { ...project, ...change };
  refreshUndoButtons();
  showFileName();
  syncControls(source);
  saveProject();
  relayout();
}

/** A linked gap's overlap, mm at the size the letters are now (it is kept as at KERN_CAP and scales with them). */
function setOverlap(gap: Gap, mm: number, source?: Element) {
  const link = project.links[gap.key];
  if (!link || !(mm >= 0)) return;
  update({ links: { ...project.links, [gap.key]: { ...link, overlap: kernKept(mm, project.capHeight) } } }, source, `overlap:${gap.key}`);
}

/**
 * Link the gap's two letters into one shape, or unlink them (L). A pair
 * that can never meet (no height they share) can't be linked, and says so.
 */
function toggleLink(gap: Gap | null) {
  if (!gap || !store || !layout) return say('Select a gap first: click between two letters, or press Tab.');
  const [a, b] = [...gap.pair];
  const line = lineNumber(layout, gap.line);
  if (gap.link) {
    const links = { ...project.links };
    delete links[gap.key];
    update({ links });
    return say(`The ${a} and ${b} in line ${line} are no longer linked: they are spaced as before. Ctrl+Z undoes it.`);
  }
  if (store.touch(a, b) === null) return say(`The ${a} and ${b} can never meet, so they can't be linked.`);
  // How far the right-hand letter moves, to say so plainly.
  const next: Project = { ...project, links: { ...project.links, [gap.key]: { pair: gap.pair, overlap: LINK_OVERLAP } } };
  const before = gap.right.parts?.find((q) => q.pos === Number(gap.key.split(':')[1]))?.box.x0 ?? gap.right.box.x0;
  const after = layoutPanel(store, next, true, 'outline').letters.find((l) => l.line === gap.line && l.pos <= Number(gap.key.split(':')[1]) && l.pos + l.span > Number(gap.key.split(':')[1]));
  const moved = after?.parts?.find((q) => q.pos === Number(gap.key.split(':')[1]))?.box.x0;
  update({ links: next.links });
  const by = moved === undefined ? 0 : before - moved;
  const how = Math.abs(by) < 0.05 ? '' : by > 0 ? ` The ${b} slid ${by.toFixed(1)} mm closer to meet the ${a}.` : ` The ${b} moved ${(-by).toFixed(1)} mm away, to overlap by just the link overlap.`;
  say(`The ${a} and ${b} in line ${line} are linked into one letter, overlapping ${kernMm(LINK_OVERLAP, project.capHeight).toFixed(2)} mm.${how} Alt+arrows set how deep; L unlinks. Ctrl+Z undoes it.`);
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
  syncSpacingControls(source);
  syncMachineControls(source);
  $('align')
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('on', b.dataset.align === project.align));
  syncMore();
}

/** Move the selected gap's letters closer (dir -1) or apart (+1) by `step` mm; dir 0 puts it back. */
function nudge(dir: number, step = 0.1) {
  const gap = selectedGap();
  if (!gap) return;
  // On a linked gap the letters go in deeper (closer) or not so deep (apart), stopping at touching;
  // nothing else moves them (BRIEF.md, Decisions: "Linked letters").
  if (gap.link) {
    const link = project.links[gap.key];
    if (!link) return;
    const now = kernMm(link.overlap, project.capHeight);
    const v = dir === 0 ? kernMm(LINK_OVERLAP, project.capHeight) : Math.max(0, round(now - dir * step, 2));
    if (dir > 0 && now <= 0) return say('They only touch now: Unlink (L) to part them.');
    return setOverlap(gap, v);
  }
  // Read the current settings, not the last drawing, so quick presses all count.
  const [a, b] = [...gap.pair];
  // Kerning is shown and nudged in mm at the size the letters are now, and kept
  // as at 25 mm cap height, so it scales with the letters (layout.ts, KERN_CAP).
  const cap = project.capHeight;
  if (kernMode === 'group' && gap.groupKey) {
    const k = { ...project.groupKerning };
    const v = dir === 0 ? 0 : round(kernMm(k[gap.groupKey] ?? 0, cap) + dir * step, 1);
    if (v === 0) delete k[gap.groupKey];
    else k[gap.groupKey] = kernKept(v, cap);
    update({ groupKerning: k });
  } else if (kernMode === 'pair' || kernMode === 'group') {
    // An exact pair value starts from what the pair has now (its groups' value, if any)
    // and from then on overrides the groups. "Back to 0" removes it, handing back to the groups.
    const k = { ...project.kerning };
    if (dir === 0) delete k[gap.pair];
    else k[gap.pair] = kernKept(round(pairKerning(project, a, b).mm + dir * step, 1), cap);
    update({ kerning: k });
  } else {
    const k = { ...project.gapKerning };
    const own = project.gapKerning[gap.key];
    const v = dir === 0 ? 0 : round((own && own.pair === gap.pair ? kernMm(own.mm, cap) : 0) + dir * step, 1);
    if (v === 0) delete k[gap.key];
    else k[gap.key] = { pair: gap.pair, mm: kernKept(v, cap) };
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
    layout = layoutPanel(store!, shownProject(), true);
    draw();
    clearTimeout(settle);
    if (layout.datumPending) {
      settle = window.setTimeout(() => {
        layout = layoutPanel(store!, shownProject());
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

  // The machine bed, drawn from the panel corner that is the G-code zero, the same way round as the panel.
  const fit = bedFit(p.panelWidth, p.panelHeight);
  const bed = fit === 'standard' ? BED : BED_EXTENDED;
  const [bw, bh] = p.panelWidth >= p.panelHeight ? [bed.width, bed.height] : [bed.height, bed.width];
  const corner = p.machine.zeroCorner;
  const bx = corner.endsWith('left') ? 0 : p.panelWidth - bw;
  const by = corner.startsWith('top') ? 0 : p.panelHeight - bh;
  out.push(`<g class="bed"><rect x="${bx}" y="${by}" width="${bw}" height="${bh}"/></g>`);

  // The board: a plain light surface while designing, realistic oak in Proof (BRIEF.md, Decisions: "The look").
  out.push(`<rect class="panel" x="0" y="0" width="${p.panelWidth}" height="${p.panelHeight}"/>`);
  const oak = preset === 'proof' ? oakUrl(p.panelWidth, p.panelHeight, draw) : null;
  if (oak) out.push(`<image class="oak" href="${oak}" x="0" y="0" width="${p.panelWidth}" height="${p.panelHeight}" preserveAspectRatio="none"/>`);
  out.push(`<rect class="panel-edge" x="0" y="0" width="${p.panelWidth}" height="${p.panelHeight}"/>`);
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
    if (!line.ink) continue; // a blank line is drawn as its spacer instead
    for (const y of [line.baselineY, line.baselineY - p.capHeight]) {
      out.push(`<line x1="0" x2="${p.panelWidth}" y1="${fmt(y)}" y2="${fmt(y)}"/>`);
    }
  }
  out.push('</g>');

  // Blank lines: spacers, each with a handle along its bottom edge to drag its height.
  if (!cam) {
    const x0 = cb.x1 > cb.x0 ? cb.x0 : 0;
    const x1 = cb.x1 > cb.x0 ? cb.x1 : p.panelWidth;
    for (const sp of L.spacers) {
      const bottom = sp.top + sp.height;
      out.push(
        `<g class="spacer${sp.index === selectedSpacer ? ' sel' : ''}${sp.custom ? ' custom' : ''}">` +
          `<rect class="spacer-band" data-spacer="${sp.index}" x="${fmt(x0)}" y="${fmt(sp.top)}" width="${fmt(x1 - x0)}" height="${fmt(sp.height)}"/>` +
          `<line class="spacer-edge" x1="${fmt(x0)}" x2="${fmt(x1)}" y1="${fmt(bottom)}" y2="${fmt(bottom)}"/>` +
          `<line class="spacer-hit" data-spacer-handle="${sp.index}" x1="${fmt(x0)}" x2="${fmt(x1)}" y1="${fmt(bottom)}" y2="${fmt(bottom)}"/></g>`,
      );
    }
  }

  const showSpace = $<HTMLInputElement>('show-space').checked;
  const spaces = showSpace
    ? L.gaps.filter((g) => !g.link).map((g) => negativeSpace(g, L.lines[g.line].baselineY, p.capHeight, p.spaceDepth))
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
  for (const stop of L.stops) {
    const outline = stop.outline.map(contourToSvg).join('');
    out.push(`<path class="fill" d="${outline}"/><path class="outline" d="${outline}"/>`);
    if (stop.datum.length) out.push(`<path class="datum" d="${stop.datum.map(contourToSvg).join('')}"/>`);
    out.push(`<path class="valley" d="${stop.valleys.map(polylineToSvg).join('')}"/>`);
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
  // The selected line's ends: drag one to spread or close its letters. The
  // anchored end (left for a left-aligned line, right for a right-aligned one) has none.
  const endLine = !cam && selectedLine !== null ? L.lines[selectedLine] : undefined;
  if (endLine?.ink && !endLine.locked && letterPairs(endLine) > 0) {
    const align = lineAlign(endLine);
    const top = endLine.baselineY - p.capHeight * 1.15;
    const bottom = endLine.baselineY + p.capHeight * 0.15;
    for (const side of ['left', 'right'] as const) {
      if (side === align) continue;
      const x = fmt(side === 'left' ? endLine.ink.x0 : endLine.ink.x1);
      out.push(
        `<g class="line-end"><title>Drag to spread or close this line's letters (Alt: freely)</title>` +
          `<line class="line-end-bar" x1="${x}" x2="${x}" y1="${fmt(top)}" y2="${fmt(bottom)}"/>` +
          `<line class="line-end-hit" data-line-end="${side}" x1="${x}" x2="${x}" y1="${fmt(top)}" y2="${fmt(bottom)}"/></g>`,
      );
    }
  }

  // Clickable gaps between letters.
  const sel = selectedGap();
  const counts = new Map<number, number>();
  for (const g of L.gaps) {
    const n = counts.get(g.line) ?? 0;
    counts.set(g.line, n + 1);
    const base = L.lines[g.line].baselineY;
    const w = g.link ? p.capHeight * 0.12 : Math.max(Math.abs(g.right.box.x0 - g.left.box.x1), p.capHeight * 0.12);
    const cls = `gap${g === sel ? ' sel' : g.kern ? ' kerned' : ''}${g.link ? ' linked' : ''}`;
    out.push(
      `<rect class="${cls}" data-gap="${g.line}:${n}" x="${fmt(g.x - w / 2)}" y="${fmt(base - p.capHeight)}" width="${fmt(w)}" height="${fmt(p.capHeight)}"/>`,
    );
  }

  // The toolpath preview, on top of everything.
  if (cam && cam.project !== project) closeCam('The layout changed, so the preview was closed. Preview the passes again before saving.');
  if (cam) out.push(toolpathSvg());
  if (v3d.open) schedule3d();

  world.innerHTML = out.join('');
  labelData = { spaces, gaps: L.gaps };
  showBedStatus();
  refreshProblems();
  showKerningSummary();
  showLinePop();
  drawInspector();
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
  // Areas over the gaps. Where neighbours would run together (zoomed out), every
  // other one steps up a row, so two figures never read as one.
  const rowEnds = new Map<number, number[]>();
  for (const s of [...labelData.spaces].sort((a, b) => a.gap.line - b.gap.line || a.gap.x - b.gap.x)) {
    const base = layout!.lines[s.gap.line].baselineY;
    const text = String(Math.round(s.area));
    const x = sx(s.gap.x);
    const half = text.length * 3.6 + 2;
    const ends = rowEnds.get(s.gap.line) ?? [-Infinity, -Infinity];
    const row = x - half > ends[0] ? 0 : x - half > ends[1] ? 1 : 0;
    ends[row] = x + half;
    rowEnds.set(s.gap.line, ends);
    out.push(`<text class="area" x="${x.toFixed(1)}" y="${(sy(base - p.capHeight) - 6 - row * 13).toFixed(1)}">${text}</text>`);
  }
  // Pending even-up suggestions, in their own colour.
  const pending = new Map((suggest?.suggestions ?? []).map((s) => [s.pair, tweaks[s.pair] ?? s.change]));
  for (const g of labelData.gaps) {
    if (g.link) continue;
    const ch = pending.get(g.pair);
    if (ch === undefined) continue;
    const base = layout!.lines[g.line].baselineY;
    out.push(`<text class="suggest" x="${sx(g.x).toFixed(1)}" y="${(sy(base) + 40).toFixed(1)}">${previewSuggest ? '' : '→ '}${signed(ch)}?</text>`);
  }
  const everyKern = $<HTMLInputElement>('show-kerns').checked;
  const chosen = selectedGap();
  for (const g of labelData.gaps) {
    // Linked letters: a small link mark under each joint, in place of a kerning figure.
    if (g.link) {
      const x = sx(g.x);
      const y = sy(layout!.lines[g.line].baselineY) + 14;
      out.push(
        `<g class="link-mark${g === chosen ? ' sel' : ''}"><title>Linked: cut as one letter, overlapping ${g.link.overlap.toFixed(2)} mm</title>` +
          `<ellipse cx="${(x - 3.2).toFixed(1)}" cy="${y.toFixed(1)}" rx="4.6" ry="2.9"/><ellipse cx="${(x + 3.2).toFixed(1)}" cy="${y.toFixed(1)}" rx="4.6" ry="2.9"/></g>`,
      );
      continue;
    }
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
    const title = `Line ${line.number}: ${state === 'auto' ? 'auto (follows line spacing and alignment)' : state === 'placed' ? 'placed by hand' : 'locked'}`;
    out.push(
      `<g class="${cls}" data-line="${line.index}"><title>${esc(title)}</title>` +
        `<rect x="${(numX - w).toFixed(1)}" y="${(y - 10).toFixed(1)}" width="${w}" height="20" rx="4"/>` +
        `<text x="${(numX - w / 2).toFixed(1)}" y="${(y + 4).toFixed(1)}">${line.number}${mark}</text></g>`,
    );
  }
  if (cam) out.push(camLabels(sx, sy));
  labels.innerHTML = out.join('');

  // The kerning box floats beside the selected gap.
  const g = selectedGap();
  if (g) {
    const base = layout!.lines[g.line].baselineY;
    pop.hidden = false;
    const pairName = [...g.pair].join(' ');
    pop.classList.toggle('linked', !!g.link);
    pop.querySelector('.pair')!.textContent = g.link ? `${pairName} · linked` : pairName;
    const [la, lb] = [...g.pair];
    const linkBtn = pop.querySelector<HTMLButtonElement>('[data-link]')!;
    const canLink = !!g.link || store?.touch(la, lb) !== null;
    linkBtn.textContent = g.link ? 'Unlink' : 'Link';
    linkBtn.disabled = !canLink;
    linkBtn.title = g.link
      ? 'Part them: each its own letter again (L)'
      : canLink
        ? 'Join them into one shape, cut as one letter (L)'
        : 'These two can never meet, so they can’t be linked';
    pop.querySelector('.back')!.textContent = g.link ? `Back to ${kernMm(LINK_OVERLAP, p.capHeight).toFixed(2)}` : 'Back to 0';
    const groupName = g.groupKey ? `like ${g.groupKey.split('|')[0]} · like ${g.groupKey.split('|')[1]}` : null;
    const mode = kernMode === 'group' && !g.groupKey ? 'pair' : kernMode;
    pop.querySelector('[data-mode="pair"]')!.textContent = `Every ${pairName}`;
    const gb = pop.querySelector<HTMLButtonElement>('[data-mode="group"]')!;
    gb.textContent = groupName ? `Group: ${groupName}` : 'No group';
    gb.disabled = !groupName;
    pop.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    const shown = mode === 'group' ? g.groupKern : mode === 'pair' ? g.pairKern : g.gapKern;
    pop.querySelector('output')!.textContent = `${signed(shown)} mm`;
    const ov = pop.querySelector<HTMLInputElement>('[data-overlap]')!;
    if (g.link && document.activeElement !== ov) ov.value = String(round(g.link.overlap, 2));
    const joint = g.link ? g.left.joints?.[Number(g.key.split(':')[1]) - g.left.pos - 1] : undefined;
    const parts = g.link
      ? [`cut as one letter${joint ? `, joined ${joint.width.toFixed(2)} mm` : ''}`, 'no kerning or spacing acts here']
      : [
          groupName ? `group ${signed(g.groupKern)}${g.pairFrom === 'pair' ? ' (overridden)' : ''}` : null,
          g.pairFrom === 'pair' ? `${pairName} ${signed(g.pairKern)}` : null,
          `this gap ${signed(g.gapKern)}`,
          `total ${signed(g.kern)} mm`,
        ];
    pop.querySelector('.breakdown')!.textContent = parts.filter(Boolean).join(' · ');
    placeBeside(pop, sx(g.x), sy(base - p.capHeight), sy(base));
  } else {
    pop.hidden = true;
  }
  // The selected line's tools float beside it (a selected gap's box takes the place).
  const sl = !g && !cam ? lineAtIndex(selectedLine) : null;
  if (sl?.ink) {
    linePop.hidden = false;
    placeBeside(linePop, sx((sl.ink.x0 + sl.ink.x1) / 2), sy(sl.baselineY - p.capHeight), sy(sl.baselineY));
  } else {
    linePop.hidden = true;
  }
  // Blank lines: their height on the band, and the selected one's box.
  const out2: string[] = [];
  if (layout && !cam) {
    const cbx = contentBox(p);
    for (const spc of layout.spacers) {
      const hpx = spc.height * v.scale;
      if (hpx < 16) continue;
      out2.push(
        `<text class="spacer-label" x="${(sx(cbx.x1 > cbx.x0 ? cbx.x0 : 0) + 6).toFixed(1)}" y="${(sy(spc.top) + Math.min(hpx / 2, 14) + 4).toFixed(1)}" text-anchor="start">blank line · ${spc.height.toFixed(1)} mm${spc.custom ? '' : ' (line spacing)'}</text>`,
      );
    }
  }
  if (out2.length) labels.insertAdjacentHTML('beforeend', out2.join(''));
  const ss = layout && !cam && !g && selectedLine === null ? layout.spacers.find((x) => x.index === selectedSpacer) : undefined;
  if (ss) {
    spacerPop.hidden = false;
    const hInput = spacerPop.querySelector<HTMLInputElement>('[data-spacer-height]')!;
    if (document.activeElement !== hInput) hInput.value = ss.height.toFixed(1);
    spacerPop.querySelector<HTMLButtonElement>('[data-act="reset"]')!.disabled = !ss.custom;
    const cbx = contentBox(p);
    placeBeside(spacerPop, sx((cbx.x0 + cbx.x1) / 2), sy(ss.top), sy(ss.top + ss.height));
  } else {
    spacerPop.hidden = true;
  }

  drawOverlay();
  updateOverviewView();
  $('zoom-read').textContent = `${(v.scale / pxPerMm()).toFixed(2)} × true size`;
  showCursor();
  $('ruler').style.width = `${100 * pxPerMm()}px`;
  $<HTMLInputElement>('cal').value = String(calibration);
}

/**
 * Float a box over the workspace beside something on screen: above it (top
 * and bottom are its upper and lower edges, px), or below if there is no room
 * above, and always inside the workspace. A small pointer shows what it is for.
 */
function placeBeside(el: HTMLElement, cx: number, top: number, bottom: number) {
  const r = work.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const gap = 12;
  const clearTop = RULER + $('viewbar').offsetHeight + 12;
  let y = top - gap - h;
  const below = y < clearTop;
  if (below) y = Math.min(bottom + gap, r.height - h - 8);
  const left = Math.min(r.width - 8 - w, Math.max(RULER + 8, cx - w / 2));
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(y)}px`;
  el.classList.toggle('below', below);
  el.style.setProperty('--point', `${Math.round(Math.min(w - 16, Math.max(16, cx - left)))}px`);
}

function showBedStatus() {
  const p = project;
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
  const groupsK = Object.entries(project.groupKerning);
  // Single gaps that still match the letters in that place.
  const own = layout ? layout.gaps.filter((g) => g.gapKern) : [];
  const items = [
    ...groupsK.map(([k, v]) => `<li>Group: like <b>${esc(k.split('|')[0])}</b> · like <b>${esc(k.split('|')[1])}</b> ${signed(kernMm(v, project.capHeight))} mm</li>`),
    ...pairs.map(([k, v]) => `<li>${pairName(k)} everywhere ${signed(kernMm(v, project.capHeight))} mm</li>`),
    ...own.map((g) => `<li>${pairName(g.pair)} line ${layout ? lineNumber(layout, g.line) : g.line + 1}, this gap only ${signed(g.gapKern)} mm</li>`),
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
  rememberView();
  draw();
}

let preset: PresetName | null = null;

function setPreset(name: PresetName | null) {
  preset = name;
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

/**
 * What each stage shows when it is opened, until the carver changes it there
 * (BRIEF.md, Decisions: the interface). Each stage then remembers its own.
 */
const STAGE_VIEWS: Record<Stage, { preset: PresetName | null; layers: Layer[] }> = {
  write: { preset: null, layers: ['fill', 'guides'] }, // the letters, with the lines they sit on
  space: { preset: 'spacing', layers: PRESETS.spacing },
  panel: { preset: null, layers: ['fill', 'guides'] }, // the letters, with the margins
  machine: { preset: 'setting', layers: PRESETS.setting },
  '3d': { preset: null, layers: [] },
};
const VIEWS_KEY = 'incised.stageViews';
let stageViews: Partial<Record<Stage, { preset: PresetName | null; layers: Layer[] }>> = readJson(VIEWS_KEY) ?? {};

function rememberView() {
  if (stage === '3d') return;
  stageViews[stage] = { preset, layers: LAYERS.filter((l) => $<HTMLInputElement>(`show-${l}`).checked) };
  writeJson(VIEWS_KEY, stageViews);
}

function showStageView(s: Stage) {
  const v = stageViews[s] ?? STAGE_VIEWS[s];
  for (const layer of LAYERS) $<HTMLInputElement>(`show-${layer}`).checked = v.layers.includes(layer);
  setPreset(v.preset);
  syncLayers();
}

// ---------------------------------------------------------------- keys, undo

function onKey(e: KeyboardEvent) {
  const target = e.target as HTMLElement;
  // Boxes over everything (search, shortcuts, bench sheet) look after their own keys.
  if (document.querySelector('dialog[open]')) return;
  // Typing boxes keep their keys; tick boxes, sliders and buttons don't need them.
  const inField = target.closest('textarea, select, input:not([type=checkbox]):not([type=range]):not([type=radio])');
  // Undo, redo, files and search work everywhere, typing included.
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    const k = e.key.toLowerCase();
    if (k === 'z') {
      if (e.shiftKey) redo();
      else undo();
    } else if (k === 'y') redo();
    else if (k === 'k') showPalette();
    else if (k === 's') saveProjectFile(e.shiftKey);
    else if (k === 'o') openProjectFile();
    else if (k === 'p') showSheet();
    else return;
    e.preventDefault();
    return;
  }
  if (inField) return;

  // 1 to 5: the stages. Shift with 1 to 4: the views.
  const digit = /^Digit([1-5])$/.exec(e.code)?.[1] ?? (/^[1-5]$/.test(e.key) ? e.key : null);
  if (digit && !e.altKey) {
    const n = Number(digit);
    if (!e.shiftKey) setStage(STAGES[n - 1]);
    else if (n <= 4 && stage !== '3d') applyPreset(PRESET_KEYS[n - 1]);
    e.preventDefault();
    return;
  }
  if (e.key === '?') {
    showKeys();
    e.preventDefault();
    return;
  }
  // In the 3D view the mouse turns the board; Esc goes back.
  if (stage === '3d') {
    if (e.key === 'Escape') {
      // Esc stops the board being worked out; with nothing under way, it goes back.
      if (!cancel3d()) setStage(lastFlatStage);
      e.preventDefault();
    } else if (!e.altKey && e.key.toLowerCase() === 'd') {
      sharpen3d();
      e.preventDefault();
    }
    return;
  }

  if (!e.altKey && (e.key === 'i' || e.key === 'I')) {
    setInspect(!inspectOpen);
  } else if (!e.altKey && (e.key === 'm' || e.key === 'M')) {
    setMeasuring(!measuring);
  } else if (!e.altKey && (e.key === 's' || e.key === 'S')) {
    setSnapping(!snapping);
  } else if (!e.altKey && e.key.toLowerCase() === 'f') {
    // F fits the lettering to the panel; Shift+F the panel to the lettering.
    if (e.shiftKey) fitPanelToLettering();
    else fitLettering('both');
  } else if (!e.altKey && (e.code === 'BracketLeft' || e.code === 'BracketRight') && selectedLine !== null) {
    // [ and ] close and spread the selected line's letters: 0.1 mm a pair, or 1 mm with Shift.
    spreadLine(e.code === 'BracketLeft' ? -1 : 1, e.shiftKey ? 1 : 0.1);
  } else if (!e.altKey && e.key.toLowerCase() === 'z') {
    // Z shows the whole panel; Shift+Z true size.
    if (e.shiftKey) view.frame(project.panelWidth, project.panelHeight, pxPerMm());
    else fitPanel();
  } else if (e.key === 'Tab' && (target === document.body || target.closest('#work'))) {
    // Step through the gaps in reading order.
    const cur = gapIndex(selected ?? hovered);
    selected = gapRef(cur < 0 ? (e.shiftKey ? -1 : 0) : cur + (e.shiftKey ? -1 : 1));
    draw();
  } else if (!e.altKey && selectedSpacer !== null && selectedLine === null && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    // A selected blank line: down makes it taller, up shorter, 0.5 mm (5 mm with Shift).
    const sp = layout?.spacers.find((x) => x.index === selectedSpacer);
    if (!sp) return;
    setSpacer(sp.index, sp.height + (e.key === 'ArrowDown' ? 1 : -1) * (e.shiftKey ? 5 : 0.5));
  } else if (selectedSpacer !== null && selectedLine === null && (e.key === 'Delete' || e.key === 'Backspace')) {
    removeBlankLine(selectedSpacer);
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
    closeMenus();
    if (cam) closeCam();
    if (measuring) setMeasuring(false);
    if (scaling) {
      scaling = null;
      measure = null;
      syncPanelControls();
      drawOverlay();
    }
    selected = null;
    selectedLine = null;
    selectedSpacer = null;
    marked = null;
    draw();
  } else if (!e.altKey && e.key.toLowerCase() === 'l') {
    // L links the selected gap's letters into one shape, or unlinks them (or the gap under the pointer).
    toggleLink(selectedGap() ?? gapAt(hovered));
  } else if (!e.altKey && e.key.toLowerCase() === 'p') {
    // P marks the next problem on the panel; Shift+P the one before.
    stepProblem(e.shiftKey ? -1 : 1);
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
  showFileName();
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
      if ((e.target as Element).closest('#viewbar, .ctx, .ruler, #ruler-corner, #cam-bar')) return;
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

  // A press on the workspace takes the cursor out of any settings box, so the keys work on the panel again.
  work.addEventListener(
    'pointerdown',
    (e) => {
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body && !active.closest('#work') && !(e.target as Element).closest('.ctx')) active.blur();
    },
    true,
  );

  // The reference picture: drag it while unlocked, or click two points to scale it.
  work.addEventListener('pointerdown', onPicturePress, true);

  // Press on a line (its letters, a gap, or its number in the margin):
  // a click selects, a drag moves the line.
  work.addEventListener('pointerdown', onLinePress, true);
  // Drag a blank line's bottom edge to change its height.
  work.addEventListener('pointerdown', onSpacerPress, true);
  wireSpacerPop();
  wireLinePop();
  wireInspector();

  // Track the pointer for the ruler markers and the gap under it.
  work.addEventListener('pointermove', (e) => {
    const r = work.getBoundingClientRect();
    pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    const g = (e.target as Element).closest('[data-gap]');
    hovered = g ? (([line, n]) => ({ line, n }))(g.getAttribute('data-gap')!.split(':').map(Number)) : null;
    drawRulers();
    showCursor();
  });
  work.addEventListener('pointerleave', () => {
    pointer = null;
    hovered = null;
    drawRulers();
    showCursor();
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
  // The problem picked from the problems list, marked where it is.
  const spotted = marked ? problems.find((q) => q.key === marked && q.spot) : undefined;
  if (spotted?.spot) {
    const x = Number(sx(spotted.spot.x));
    const y = Number(sy(spotted.spot.y));
    out.push(
      `<g class="spot ${spotted.level}"><circle class="pulse" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="16"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="16"/>` +
        `<line x1="${(x - 24).toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x - 19).toFixed(1)}" y2="${y.toFixed(1)}"/><line x1="${(x + 19).toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + 24).toFixed(1)}" y2="${y.toFixed(1)}"/>` +
        `<line x1="${x.toFixed(1)}" y1="${(y - 24).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y - 19).toFixed(1)}"/><line x1="${x.toFixed(1)}" y1="${(y + 19).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y + 24).toFixed(1)}"/></g>`,
    );
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

/** Change a line's own letter or word spacing (nothing extra on either drops the entry). */
function setLineExtra(index: number, change: Partial<LineExtra>, group: string | null = null, source?: Element) {
  const ex: LineExtra = { ...(project.lineExtras[String(index)] ?? { letter: 0, word: 0 }), ...change };
  const lineExtras = { ...project.lineExtras };
  if (ex.letter || ex.word) lineExtras[String(index)] = { letter: round(ex.letter, 3), word: round(ex.word, 3) };
  else delete lineExtras[String(index)];
  update({ lineExtras }, source, group);
}

/** How a line is anchored: by its left end, centre or right end. */
function lineAlign(line: PlacedLine): Align {
  return project.lines[String(line.index)]?.align ?? project.align;
}

/** The letter gaps between a line's first letter and its last: its ends move this many times any change of letter spacing. */
function letterPairs(line: PlacedLine): number {
  const chars = [...line.text];
  const inked = chars.map((ch, i) => (!/\s/.test(ch) && hasLetter(ch) ? i : -1)).filter((i) => i >= 0);
  // Linked letters stay joined, whatever the spacing (BRIEF.md, Decisions: "Linked letters").
  const linked = layout ? layout.gaps.filter((g) => g.link && g.line === line.index).length : 0;
  return inked.length ? inked[inked.length - 1] - inked[0] - linked : 0;
}

/** Close (dir -1) or spread (+1) the selected line's letters by `step` mm between each pair. */
function spreadLine(dir: number, step: number) {
  const line = lineAtIndex(selectedLine);
  if (!line?.ink) return say('Select a line first: click it, or its number in the margin.');
  if (line.locked) return say(`Line ${line.number} is locked: unlock it to change its spacing.`);
  if (letterPairs(line) < 1) return say(`Line ${line.number} has only one letter: there is nothing to spread.`);
  const ex = project.lineExtras[String(line.index)]?.letter ?? 0;
  const v = round(ex + dir * step, 3);
  setLineExtra(line.index, { letter: v }, `line-extra-${line.index}`);
  say(`Line ${line.number}: letter spacing ${signed(v)} mm on top of the job's. [ and ] change it, Ctrl+Z undoes it.`);
}

/**
 * Drag an end of the selected line to spread or close its letters. The other
 * end, or the centre for a centred line, stays put; the dragged end snaps to
 * the margins, guides and the other lines' ends (hold Alt to drag freely).
 * The whole drag is one step to undo.
 */
function onLineEndPress(e: PointerEvent, side: 'left' | 'right') {
  const line = lineAtIndex(selectedLine);
  if (!line?.ink || !layout || line.locked) return;
  e.stopPropagation();
  e.preventDefault();
  const pairs = letterPairs(line);
  if (pairs < 1) return;
  const before = project;
  const from = toMm(e.clientX, e.clientY).x;
  const end0 = side === 'left' ? line.ink.x0 : line.ink.x1;
  const l0 = project.lineExtras[String(line.index)]?.letter ?? 0;
  // How much wider the line gets for each mm the end moves.
  const per = (lineAlign(line) === 'centre' ? 2 : 1) * (side === 'right' ? 1 : -1);
  const targets = snapTargets(layout, line.index);
  work.setPointerCapture(e.pointerId);
  work.classList.add('dragging-end');
  const move = (m: PointerEvent) => {
    let end = end0 + toMm(m.clientX, m.clientY).x - from;
    let snap: Snap | null = null;
    if (snapping && !m.altKey) {
      snap = nearest([{ f: side, at: end }], targets.x, 8 / view.v.scale);
      if (snap) end += snap.offset;
    }
    const raw = l0 + (per * (end - end0)) / pairs;
    const letter = snap || m.altKey ? round(raw, 3) : Math.round(raw / 0.05) * 0.05;
    lineSnaps = { x: snap, y: null };
    const ex: LineExtra = { ...(project.lineExtras[String(line.index)] ?? { letter: 0, word: 0 }), letter: round(letter, 3) };
    project = { ...project, lineExtras: { ...project.lineExtras, [String(line.index)]: ex } };
    say(`Line ${line.number}: letter spacing ${signed(ex.letter)} mm on top of the job's${snap ? `, its end on the ${snap.target.label}` : ''}. Alt drags freely.`);
    relayout();
  };
  const up = () => {
    work.removeEventListener('pointermove', move);
    work.removeEventListener('pointerup', up);
    work.removeEventListener('pointercancel', up);
    work.classList.remove('dragging-end');
    lineSnaps = null;
    if (project !== before) {
      const ex = project.lineExtras[String(line.index)];
      if (ex && !ex.letter && !ex.word) {
        const lineExtras = { ...project.lineExtras };
        delete lineExtras[String(line.index)];
        project = { ...project, lineExtras };
      }
      history.record(before);
      refreshUndoButtons();
      syncControls();
      saveProject();
    }
    relayout();
  };
  work.addEventListener('pointermove', move);
  work.addEventListener('pointerup', up);
  work.addEventListener('pointercancel', up);
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
  const end = t.closest<SVGElement>('[data-line-end]');
  if (end) return onLineEndPress(e, end.dataset.lineEnd as 'left' | 'right');
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
    if (snapping && !m.altKey) {
      // Hold Alt to move freely, without snapping (or turn snapping off with S).
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
    selectedSpacer = null;
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

/** The selected line's tools, floating beside it (placed by applyView). */
function showLinePop() {
  const line = lineAtIndex(selectedLine);
  if (!line || !line.ink) return;
  const values = {
    left: line.ink.x0,
    centre: (line.ink.x0 + line.ink.x1) / 2,
    baseline: line.baselineY,
  };
  linePop.querySelector('.line-title')!.textContent = `Line ${line.number}`;
  linePop.querySelector('.line-text')!.textContent = line.text.trim();
  const ex = project.lineExtras[String(line.index)] ?? { letter: 0, word: 0 };
  linePop.querySelector('.line-state')!.textContent = line.locked
    ? 'Locked: it will not move or change until unlocked.'
    : line.placed
      ? 'Placed by hand: it stays put when the line spacing or alignment changes.'
      : 'Auto: it follows the line spacing and alignment.';
  for (const input of linePop.querySelectorAll<HTMLInputElement>('[data-extra]')) {
    if (document.activeElement !== input) input.value = String(round(ex[input.dataset.extra as 'letter' | 'word'], 2));
    input.disabled = line.locked;
  }
  linePop.querySelector<HTMLButtonElement>('[data-act="spacing"]')!.disabled = line.locked || (!ex.letter && !ex.word);
  for (const input of linePop.querySelectorAll<HTMLInputElement>('[data-pos]')) {
    // Typing in a box isn't interrupted.
    if (document.activeElement !== input) input.value = values[input.dataset.pos as keyof typeof values].toFixed(1);
    input.disabled = line.locked;
    input.title = 'mm from the panel\'s left and top edges, to the letters themselves';
  }
  linePop.querySelector<HTMLButtonElement>('[data-act="auto"]')!.disabled = !line.placed || line.locked;
  linePop.querySelector('[data-act="lock"]')!.textContent = line.locked ? 'Unlock' : 'Lock';
  linePop.querySelector<HTMLButtonElement>('[data-act="fit"]')!.disabled = line.locked;
}

function wireLinePop() {
  linePop.addEventListener('input', (e) => {
    const input = (e.target as HTMLElement).closest<HTMLInputElement>('[data-extra]');
    const line = lineAtIndex(selectedLine);
    if (!input || !line || line.locked) return;
    const v = Number(input.value);
    if (input.value === '' || !Number.isFinite(v)) return;
    setLineExtra(line.index, { [input.dataset.extra as 'letter' | 'word']: v }, `line-extra-${line.index}`, input);
  });
  linePop.addEventListener('change', (e) => {
    const input = (e.target as HTMLElement).closest<HTMLInputElement>('[data-pos]');
    const line = lineAtIndex(selectedLine);
    if (!input || !line?.ink || line.locked) return;
    const v = Number(input.value);
    if (input.value === '' || !Number.isFinite(v)) return;
    const p0 = placementOf(line);
    const pos = input.dataset.pos;
    if (pos === 'baseline') setPlacement(line.index, { ...p0, baseline: v }, `line-pos-${line.index}`);
    else {
      const now = pos === 'left' ? line.ink.x0 : (line.ink.x0 + line.ink.x1) / 2;
      setPlacement(line.index, { ...p0, x: round(p0.x + v - now, 3) }, `line-pos-${line.index}`);
    }
  });
  linePop.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    const line = lineAtIndex(selectedLine);
    if (!b || !line) return;
    if (b.dataset.act === 'close') {
      selectedLine = null;
      draw();
    }
    if (b.dataset.act === 'auto') setPlacement(line.index, null);
    if (b.dataset.act === 'spacing') {
      setLineExtra(line.index, { letter: 0, word: 0 });
      say(`Line ${line.number}'s own spacing reset. Ctrl+Z undoes it.`);
    }
    if (b.dataset.act === 'lock') setPlacement(line.index, { ...placementOf(line), locked: !line.locked });
    if (b.dataset.act === 'fit') $('fit-line').click();
  });
  $('reflow').addEventListener('click', () => {
    // Every line back to auto, except locked ones, which stay where they are.
    const kept = Object.fromEntries(Object.entries(project.lines).filter(([, pl]) => pl.locked));
    update({ lines: kept });
  });
}

// ---------------------------------------------------------------- blank lines (spacers)

/** Drag a blank line's bottom edge to change its height: 0.5 mm steps, or freely with Alt. One step to undo. */
function onSpacerPress(e: PointerEvent) {
  if (measuring || e.button !== 0 || cam || !layout) return;
  const handle = (e.target as Element).closest('[data-spacer-handle]');
  if (!handle) return;
  e.stopPropagation(); // not a pan
  const index = Number(handle.getAttribute('data-spacer-handle'));
  const sp = layout.spacers.find((x) => x.index === index);
  if (!sp) return;
  const from = toMm(e.clientX, e.clientY).y;
  const before = project;
  selectedSpacer = index;
  selected = null;
  selectedLine = null;
  work.setPointerCapture(e.pointerId);
  work.classList.add('dragging-spacer');
  const move = (m: PointerEvent) => {
    const raw = sp.height + toMm(m.clientX, m.clientY).y - from;
    const h = Math.max(0, m.altKey ? round(raw, 1) : Math.round(raw * 2) / 2);
    project = { ...project, spacers: { ...project.spacers, [String(index)]: h } };
    relayout();
  };
  const up = () => {
    work.removeEventListener('pointermove', move);
    work.removeEventListener('pointerup', up);
    work.removeEventListener('pointercancel', up);
    work.classList.remove('dragging-spacer');
    if (project !== before) {
      history.record(before);
      refreshUndoButtons();
      saveProject();
      showFileName();
    }
    draw();
  };
  work.addEventListener('pointermove', move);
  work.addEventListener('pointerup', up);
  work.addEventListener('pointercancel', up);
}

/** Set a blank line's height, mm, or (null) put it back to one line spacing. */
function setSpacer(index: number, height: number | null) {
  const spacers = { ...project.spacers };
  if (height === null) delete spacers[String(index)];
  else spacers[String(index)] = Math.max(0, round(height, 1));
  update({ spacers }, undefined, `spacer-${index}`);
}

/** Take a blank line out of the inscription. */
function removeBlankLine(index: number) {
  const texts = project.text.replace(/\r/g, '').split('\n');
  if (index >= texts.length || !isBlank(texts[index])) return;
  texts.splice(index, 1);
  const text = texts.join('\n');
  selectedSpacer = null;
  update({ text, ...remapForEdit(project, text) });
  say('Blank line removed. Ctrl+Z puts it back.');
}

function wireSpacerPop() {
  spacerPop.addEventListener('pointerdown', (e) => e.stopPropagation());
  spacerPop.addEventListener('change', (e) => {
    const input = (e.target as HTMLElement).closest<HTMLInputElement>('[data-spacer-height]');
    if (!input || selectedSpacer === null) return;
    const v = Number(input.value);
    if (input.value !== '' && Number.isFinite(v)) setSpacer(selectedSpacer, v);
  });
  spacerPop.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!b || selectedSpacer === null) return;
    if (b.dataset.act === 'close') {
      selectedSpacer = null;
      draw();
    } else if (b.dataset.act === 'reset') setSpacer(selectedSpacer, null);
    else if (b.dataset.act === 'remove') removeBlankLine(selectedSpacer);
  });
}

// ---------------------------------------------------------------- panel, border, margins, picture

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

function wirePanel() {
  $('fit-panel').addEventListener('click', fitPanelToLettering);
  $('fit-lettering').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-fit]');
    if (b) fitLettering(b.dataset.fit as FitAxis);
  });

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

  // Depth of a scribed border: 0.2 mm marks it out; up to 1 mm leaves a finished line.
  const scribe = $<HTMLInputElement>('b-scribe');
  scribe.addEventListener('input', () => {
    const v = Number(scribe.value);
    if (scribe.value === '' || !Number.isFinite(v) || v <= 0) return;
    update({ machine: { ...project.machine, scribeDepth: Math.min(v, MAX_SCRIBE_DEPTH) } }, scribe, 'b-scribe');
  });
  scribe.addEventListener('change', () => syncPanelControls()); // show the value as kept (at most 1 mm)

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
  const scribe = $<HTMLInputElement>('b-scribe');
  if (scribe !== source) scribe.value = String(p.machine.scribeDepth);
  $('border-hint').textContent =
    b.style === 'none'
      ? ''
      : b.style === 'incised'
        ? 'Cut like the letters: hairline on both edges, datum lines by the same rule, and a valley forking into each corner. Corner styles come later.'
        : 'Scribed line, measured to the line. Its depth: 0.2 mm marks it out; up to 1 mm leaves a finished decorative line. Corner styles come later.';
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

/** The panel runs off the screen, or has become too small on it to work on. */
function panelOffScreen(): boolean {
  const r = work.getBoundingClientRect();
  const v = view.v;
  const w = project.panelWidth * v.scale;
  const h = project.panelHeight * v.scale;
  return v.tx < 0 || v.ty < 0 || v.tx + w > r.width || v.ty + h > r.height || Math.max(w / r.width, h / r.height) < 0.3;
}

/** One undoable step: size the panel round the lettering and shift everything placed by hand to match. */
function fitPanelToLettering() {
  if (!layout) return;
  const f = fitToLettering(layoutPanel(store!, project));
  if (!f) return say('There is no lettering to fit the panel to.');
  const lines = Object.fromEntries(
    Object.entries(project.lines).map(([k, pl]) => [k, { ...pl, x: pl.x + f.dx, baseline: pl.baseline + f.dy }]),
  );
  const guides = { x: project.guides.x.map((g) => round(g + f.dx, 1)), y: project.guides.y.map((g) => round(g + f.dy, 1)) };
  const refImage = project.refImage ? { ...project.refImage, x: project.refImage.x + f.dx, y: project.refImage.y + f.dy } : null;
  update({ panelWidth: f.width, panelHeight: f.height, lines, guides, refImage });
  requestAnimationFrame(fitPanel);
  say(`Panel fitted to the lettering: ${f.width} × ${f.height} mm. Ctrl+Z undoes it.`);
}

/**
 * One undoable step, the inverse of fitting the panel: scale the lettering to
 * fill the space inside the margins, across, up, or both (panel.ts).
 */
function fitLettering(axis: FitAxis) {
  if (!store) return;
  const change = fitLetteringToPanel(layoutPanel(store, project), axis);
  if (!change) return say(project.text.trim() ? 'The border and margins leave no room to fit the lettering into.' : 'There is no lettering to fit.');
  update(change);
  const how = axis === 'width' ? ' across its width' : axis === 'height' ? ' up its height' : '';
  say(`Lettering fitted to the panel${how}: cap height ${change.capHeight} mm. Ctrl+Z undoes it.`);
}

function onPicturePress(e: PointerEvent) {
  const ri = project.refImage;
  if (!ri || measuring || e.button !== 0) return;
  const t = e.target as Element;
  if (t.closest('#viewbar, .ctx, .ruler, #ruler-corner, #cam-bar')) return;

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

// ---------------------------------------------------------------- inspection panel

function wireInspector() {
  setInspect(inspectOpen);
  $('ins-toggle').addEventListener('click', () => setInspect(!inspectOpen));
  $('ins-close').addEventListener('click', () => setInspect(false));
  $('ov-mode').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-ov]');
    if (!b) return;
    ovMode = b.dataset.ov as OverviewMode;
    drawInspector();
  });

  // The overview is a navigator: click or drag to centre the view there.
  const ov = $<SVGSVGElement>('overview');
  const goTo = (e: PointerEvent) => {
    const m = ov.getScreenCTM();
    if (!m) return;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    const r = work.getBoundingClientRect();
    const s = view.v.scale;
    view.set({ scale: s, tx: r.width / 2 - pt.x * s, ty: r.height / 2 - pt.y * s });
  };
  ov.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    ov.setPointerCapture(e.pointerId);
    goTo(e);
    const move = (m: PointerEvent) => goTo(m);
    const up = () => {
      ov.removeEventListener('pointermove', move);
      ov.removeEventListener('pointerup', up);
    };
    ov.addEventListener('pointermove', move);
    ov.addEventListener('pointerup', up);
  });

  // The line list: click a line to select it; its buttons return it to auto or lock it.
  $('line-list').addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const auto = t.closest<HTMLElement>('[data-line-auto]');
    const lock = t.closest<HTMLElement>('[data-line-lock]');
    const card = t.closest<HTMLElement>('[data-select-line]');
    if (auto) setPlacement(Number(auto.dataset.lineAuto), null);
    else if (lock) {
      const line = lineAtIndex(Number(lock.dataset.lineLock));
      if (line) setPlacement(line.index, { ...placementOf(line), locked: !line.locked });
    } else if (card) {
      selectedLine = Number(card.dataset.selectLine);
      selected = null;
      draw();
    }
  });
}

function setInspect(open: boolean) {
  inspectOpen = open;
  document.body.classList.toggle('no-inspect', !open);
  $('ins-toggle').classList.toggle('on', open);
  try {
    localStorage.setItem(INSPECT_KEY, open ? '1' : '0');
  } catch {
    /* not remembered */
  }
  drawInspector();
}

function drawInspector() {
  if (!inspectOpen || !layout) return;
  $('ov-mode')
    .querySelectorAll<HTMLElement>('[data-ov]')
    .forEach((b) => b.classList.toggle('on', b.dataset.ov === ovMode));
  const ov = $<SVGSVGElement>('overview');
  ov.setAttribute('viewBox', overviewViewBox(layout));
  ov.innerHTML = overviewSvg(layout, ovMode, selectedLine);
  $('line-list').innerHTML = lineListHtml(layout, selectedLine, esc);
  $('balance').innerHTML = balanceHtml(layout);
  updateOverviewView();
}

/** The box in the overview showing what the workspace has on screen. */
function updateOverviewView() {
  const rect = document.getElementById('ov-view');
  if (!rect || !inspectOpen) return;
  const r = work.getBoundingClientRect();
  const v = view.v;
  // What's on screen, trimmed to the overview so its edges always show.
  const pad = 4;
  const x0 = Math.max(-pad, (RULER - v.tx) / v.scale);
  const y0 = Math.max(-pad, (RULER - v.ty) / v.scale);
  const x1 = Math.min(project.panelWidth + pad, (r.width - v.tx) / v.scale);
  const y1 = Math.min(project.panelHeight + pad, (r.height - v.ty) / v.scale);
  rect.setAttribute('x', String(x0));
  rect.setAttribute('y', String(y0));
  rect.setAttribute('width', String(Math.max(0, x1 - x0)));
  rect.setAttribute('height', String(Math.max(0, y1 - y0)));
}

// ---------------------------------------------------------------- spacing intelligence

function alphaKey() {
  return `incised.alphabet.${alphabetName}`;
}

/** Bring in the alphabet's saved kerning, groups and even-up settings. */
function loadAlphabetSettings() {
  try {
    const raw = localStorage.getItem(alphaKey());
    if (!raw) return; // first time with this alphabet: whatever the job has becomes the alphabet's
    const a = JSON.parse(raw);
    // Older alphabet kerning was kept in mm at the size it was set; convert it once to scale with the letters.
    const kept = (o: Record<string, number> | undefined) =>
      typeof a.kernCap === 'number' ? (o ?? {}) : Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, kernKept(v, project.capHeight)]));
    project = {
      ...project,
      kerning: { ...project.kerning, ...kept(a.kerning) },
      groupKerning: { ...project.groupKerning, ...kept(a.groupKerning) },
      groups: a.groups ?? project.groups,
      evenUp: { ...project.evenUp, ...(a.evenUp ?? {}) },
    };
  } catch {
    /* nothing saved */
  }
}

/** The project as drawn: with even-up suggestions tried out, when previewing. */
function shownProject(): Project {
  if (!previewSuggest || !suggest?.suggestions.length) return project;
  const kerning = { ...project.kerning };
  for (const s of suggest.suggestions) {
    const [a, b] = [...s.pair];
    kerning[s.pair] = kernKept(round(pairKerning(project, a, b).mm + (tweaks[s.pair] ?? s.change), 1), project.capHeight);
  }
  return { ...project, kerning };
}

const STOP_SLIDERS = [
  { key: 'size', name: 'Size', hint: 'side of the triangle, % of cap height', min: 8, max: 50, step: 1 },
  { key: 'height', name: 'Height', hint: 'centre above the baseline, % of cap height', min: 5, max: 95, step: 1 },
] as const;
const FACTORS = [
  { key: 'round', name: 'Round sides', hint: 'as in O, C, D' },
  { key: 'straight', name: 'Straight sides', hint: 'as in H, I, N' },
  { key: 'diagonal', name: 'Diagonal sides', hint: 'as in A, V, W' },
] as const;

function wireSpacing() {
  // Even up.
  const ref = $<HTMLInputElement>('eu-ref');
  ref.addEventListener('input', () => {
    const v = [...ref.value.toUpperCase()].slice(0, 2).join('');
    if (v.length === 2) update({ evenUp: { ...project.evenUp, reference: v } }, ref, 'eu-ref');
  });
  const nudgeRef = (d: number) => {
    const [a, b] = [...project.evenUp.reference];
    if (!a || !b) return;
    update({ kerning: { ...project.kerning, [a + b]: kernKept(round(pairKerning(project, a, b).mm + d, 1), project.capHeight) } });
  };
  $('eu-closer').addEventListener('click', () => nudgeRef(-0.1));
  $('eu-apart').addEventListener('click', () => nudgeRef(0.1));
  const box = $('eu-factors');
  for (const f of FACTORS) {
    const row = document.createElement('div');
    row.className = 'slider';
    row.innerHTML = `<div class="row"><label class="name" for="eu-${f.key}">${f.name} <small>${f.hint}</small></label><span><output id="eu-${f.key}-read"></output></span></div>
      <input type="range" id="eu-${f.key}" min="0.5" max="1.5" step="0.05" />`;
    box.append(row);
    row.querySelector('input')!.addEventListener('input', (e) =>
      update({ evenUp: { ...project.evenUp, [f.key]: Number((e.target as HTMLInputElement).value) } }, undefined, `eu-${f.key}`),
    );
  }
  $('eu-suggest').addEventListener('click', () => {
    if (!store || !layout) return;
    suggest = evenUp(store, layoutPanel(store, project, true));
    tweaks = {};
    showSuggestions();
    relayout();
  });
  $('eu-results').addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!t || !suggest) return;
    const pair = t.dataset.pair;
    const act = t.dataset.act;
    if (act === 'preview') {
      previewSuggest = !previewSuggest;
    } else if (act === 'accept' && pair) acceptSuggestions([pair]);
    else if (act === 'refuse' && pair) dropSuggestions([pair]);
    else if (act === 'accept-all') acceptSuggestions(suggest.suggestions.map((s) => s.pair));
    else if (act === 'refuse-all') dropSuggestions(suggest.suggestions.map((s) => s.pair));
    showSuggestions();
    relayout();
  });
  $('eu-results').addEventListener('input', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLInputElement>('[data-tweak]');
    if (!t) return;
    const v = Number(t.value);
    if (t.value !== '' && Number.isFinite(v)) tweaks[t.dataset.tweak!] = round(v, 1);
    relayout();
  });

  // Fitting.
  $('fit-by').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-by]');
    if (b) fitBy = b.dataset.by as FitBy;
    syncSpacingControls();
  });
  const fitSize = () => {
    const d = defaultBox(project);
    const w = Number($<HTMLInputElement>('fit-width').value) || d.width;
    const h = Number($<HTMLInputElement>('fit-height').value) || d.height;
    return { w, h };
  };
  $('fit-line').addEventListener('click', () => {
    if (!store || selectedLine === null) return fitMessage('Select a line first: click it, or its number in the margin.');
    const e = fitLine(store, project, selectedLine, fitSize().w, fitBy);
    if (!e) return fitMessage(fitBy === 'word' ? 'That line has no word spaces to open or close.' : 'That line has too few letters to fit.');
    update({ lineExtras: { ...project.lineExtras, [String(selectedLine)]: e } });
    fitMessage(`Line ${layout ? lineNumber(layout, selectedLine) : selectedLine + 1} fitted to ${fitSize().w} mm.`);
  });
  $('fit-block').addEventListener('click', () => {
    if (!store) return;
    const { w, h } = fitSize();
    const r = fitBlock(store, project, w, h, fitBy);
    update({ lineExtras: r.lineExtras, ...(r.lineSpacing !== undefined ? { lineSpacing: r.lineSpacing } : {}) });
    fitMessage(
      `Every line fitted to ${w} mm${r.lineSpacing !== undefined ? `, block to ${h} mm high (line spacing ${r.lineSpacing.toFixed(1)} mm; lines placed by hand keep their places)` : ''}.` +
        (r.skipped.length ? ` Line${r.skipped.length > 1 ? 's' : ''} ${r.skipped.join(', ')} could not be fitted ${fitBy === 'word' ? '(no word spaces)' : ''}.` : ''),
    );
  });
  $('fit-clear').addEventListener('click', () => {
    update({ lineExtras: {} });
    fitMessage('Fitting cleared.');
  });

  // Word stops.
  $<HTMLInputElement>('ws-on').addEventListener('change', (e) =>
    update({ wordStops: { ...project.wordStops, on: (e.target as HTMLInputElement).checked } }),
  );
  const wsBox = $('ws-sliders');
  for (const f of STOP_SLIDERS) {
    const row = document.createElement('div');
    row.className = 'slider';
    row.innerHTML = `<div class="row"><label class="name" for="ws-${f.key}">${f.name} <small>${f.hint}</small></label><span><output id="ws-${f.key}-read"></output></span></div>
      <input type="range" id="ws-${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" />`;
    wsBox.append(row);
    row.querySelector('input')!.addEventListener('input', (e) =>
      update({ wordStops: { ...project.wordStops, [f.key]: Number((e.target as HTMLInputElement).value) } }, undefined, `ws-${f.key}`),
    );
  }
  $('ws-point').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-point]');
    if (b) update({ wordStops: { ...project.wordStops, point: b.dataset.point as 'up' | 'down' } });
  });

  // Kerning groups.
  $('groups-edit').addEventListener('change', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLInputElement>('[data-group]');
    if (!t) return;
    const [side, name] = t.dataset.group!.split(':') as [Side, string];
    const groups = { left: { ...project.groups.left }, right: { ...project.groups.right } };
    const members = [...new Set([...t.value.toUpperCase().replace(/\s/g, '')])].join('');
    if (name === '+') {
      if (members) groups[side][members[0]] = members; // a new group is named after its first letter
    } else if (members) groups[side][name] = members;
    else delete groups[side][name];
    update({ groups });
  });
  $('groups-reset').addEventListener('click', () => update({ groups: structuredClone(defaultGroups) }));
}

function fitMessage(text: string) {
  $('fit-msg').textContent = text;
  say(text);
}

function acceptSuggestions(pairs: string[]) {
  if (!suggest) return;
  const kerning = { ...project.kerning };
  for (const pair of pairs) {
    const s = suggest.suggestions.find((x) => x.pair === pair);
    if (!s) continue;
    const [a, b] = [...pair];
    kerning[pair] = kernKept(round(pairKerning(project, a, b).mm + (tweaks[pair] ?? s.change), 1), project.capHeight);
  }
  update({ kerning });
  dropSuggestions(pairs);
}

function dropSuggestions(pairs: string[]) {
  if (!suggest) return;
  suggest = { ...suggest, suggestions: suggest.suggestions.filter((s) => !pairs.includes(s.pair)) };
  for (const p of pairs) delete tweaks[p];
  if (!suggest.suggestions.length) previewSuggest = false;
}

function showSuggestions() {
  const box = $('eu-results');
  if (!suggest) {
    box.innerHTML = '';
    return;
  }
  if (!suggest.reference) {
    box.innerHTML = `<p class="warn">The reference pair needs two letters the alphabet has.</p>`;
    return;
  }
  const shape = (s: string) => ({ round: 'round', straight: 'straight', diagonal: 'diagonal' })[s];
  const rows = suggest.suggestions
    .map((s) => {
      const [a, b] = [...s.pair];
      return `<div class="sg">
        <span class="sg-pair">${esc(a)} ${esc(b)}</span>
        <span class="sg-figs">${Math.round(s.area)} → ${Math.round(s.target)} mm²<small>${shape(s.shapes[0])} · ${shape(s.shapes[1])}</small></span>
        <input type="number" step="0.1" data-tweak="${esc(s.pair)}" value="${(tweaks[s.pair] ?? s.change).toFixed(1)}" title="Change to accept, mm (negative = closer)"/>
        <button data-act="accept" data-pair="${esc(s.pair)}" title="Accept">✓</button>
        <button data-act="refuse" data-pair="${esc(s.pair)}" title="Refuse" class="quiet">✗</button>
      </div>`;
    })
    .join('');
  box.innerHTML = suggest.suggestions.length
    ? `<p class="hint small">Reference ${esc(suggest.reference.pair)}: ${Math.round(suggest.reference.area)} mm². Changes in mm, negative closer; edit one before accepting to tweak it.</p>
       ${rows}
       <div class="line-buttons wrap">
         <button data-act="preview" class="${previewSuggest ? 'on' : ''}">${previewSuggest ? 'Previewing on the panel' : 'Preview on the panel'}</button>
         <button data-act="accept-all">Accept all</button>
         <button data-act="refuse-all" class="quiet">Refuse all</button>
       </div>`
    : `<p class="hint">Every pair matches the reference ${esc(suggest.reference.pair)} (${Math.round(suggest.reference.area)} mm²)${suggest.even.length ? '' : ''}. Nothing to suggest.</p>`;
}

function syncSpacingControls(source?: Element) {
  const p = project;
  const ref = $<HTMLInputElement>('eu-ref');
  if (ref !== source) ref.value = p.evenUp.reference;
  for (const f of FACTORS) {
    $<HTMLInputElement>(`eu-${f.key}`).value = String(p.evenUp[f.key]);
    $(`eu-${f.key}-read`).textContent = `× ${p.evenUp[f.key].toFixed(2)}`;
  }
  drawReferenceSample();

  $('fit-by')
    .querySelectorAll<HTMLElement>('[data-by]')
    .forEach((b) => b.classList.toggle('on', b.dataset.by === fitBy));
  const d = defaultBox(p);
  $<HTMLInputElement>('fit-width').placeholder = String(d.width);
  $<HTMLInputElement>('fit-height').placeholder = String(d.height);

  $<HTMLInputElement>('ws-on').checked = p.wordStops.on;
  for (const f of STOP_SLIDERS) {
    $<HTMLInputElement>(`ws-${f.key}`).value = String(p.wordStops[f.key]);
    $(`ws-${f.key}-read`).textContent = `${p.wordStops[f.key]}%`;
  }
  $('ws-point')
    .querySelectorAll<HTMLElement>('[data-point]')
    .forEach((b) => b.classList.toggle('on', b.dataset.point === p.wordStops.point));

  const groupRows = (side: Side) =>
    Object.entries(p.groups[side])
      .map(
        ([name, members]) =>
          `<label>Like ${esc(name)} <input type="text" data-group="${side}:${esc(name)}" value="${esc(members)}" spellcheck="false" /></label>`,
      )
      .join('') + `<label class="new">New group <input type="text" data-group="${side}:+" placeholder="letters" spellcheck="false" /></label>`;
  const ge = $('groups-edit');
  if (!ge.contains(document.activeElement)) {
    ge.innerHTML = `<h4>Left sides</h4><div class="groups">${groupRows('left')}</div><h4>Right sides</h4><div class="groups">${groupRows('right')}</div>`;
  }
}

/** The reference pair on its own, with the space between its letters shaded and measured. */
function drawReferenceSample() {
  const svg = $<SVGSVGElement>('eu-sample');
  const pair = project.evenUp.reference;
  if (!store || [...pair].length !== 2) {
    svg.innerHTML = '';
    return;
  }
  const solo: Project = { ...project, text: pair, lines: {}, lineExtras: {}, gapKerning: {}, links: {}, wordStops: { ...project.wordStops, on: false } };
  const l = layoutPanel(store, solo, true);
  const g = l.gaps[0];
  const line = l.lines[0];
  if (!g || !line.ink) {
    svg.innerHTML = '';
    return;
  }
  const k = project.capHeight;
  const sp = negativeSpace(g, line.baselineY, k, project.spaceDepth);
  const pad = k * 0.15;
  svg.setAttribute('viewBox', `${line.ink.x0 - pad} ${line.baselineY - k - pad} ${line.ink.x1 - line.ink.x0 + 2 * pad} ${k + 2 * pad}`);
  svg.innerHTML =
    `<path class="eu-space" d="${contourToSvg(sp.shape)}"/>` +
    `<path class="eu-ink" d="${l.letters.map((t) => t.outline.map(contourToSvg).join('')).join('')}"/>`;
  $('eu-ref-read').textContent = `${signed(g.pairKern)} mm · ${Math.round(sp.area)} mm²`;
}

// ---------------------------------------------------------------- machine and G-code

const PASS_COLOURS: Record<PassName, string> = { hairline: 'tp-hair', datum: 'tp-datum', slit: 'tp-slit' };

function wireMachine() {
  const sec = $('machine');
  sec.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    const key = t.dataset.mc as keyof MachineSettings | undefined;
    if (!key) return;
    const v = Number(t.value);
    if (t.value === '' && key === 'stockThickness') return update({ machine: { ...project.machine, stockThickness: 0 } }, t, 'mc-stock');
    if (t.value === '' || !Number.isFinite(v) || v < 0) return;
    update({ machine: { ...project.machine, [key]: v } }, t, `mc-${key}`);
  });
  sec.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    const pass = t.dataset.mcPass as PassName | undefined;
    if (pass) update({ machine: { ...project.machine, passes: { ...project.machine.passes, [pass]: t.checked } } });
  });
  $('mc-corner').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-corner]');
    if (b) update({ machine: { ...project.machine, zeroCorner: b.dataset.corner as MachineSettings['zeroCorner'] } });
  });
  $('mc-preview').addEventListener('click', openCam);
  $('cam-close').addEventListener('click', () => closeCam());
  $('cam-bar').addEventListener('pointerdown', (e) => e.stopPropagation());
  $('cam-tabs').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-pass]');
    if (!b || !cam) return;
    cam.show = b.dataset.pass as PassName | 'all';
    if (cam.show !== 'all') cam.viewed.add(cam.show);
    showCam();
    draw();
  });
  $('cam-checks').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-fix]');
    if (!b) return;
    const before = project;
    runFix(b.dataset.fix!);
    // A fix that changed the work is previewed afresh, so the checks show where it now stands.
    if (project !== before && stage === 'machine') openCam();
  });
  $('cam-save').addEventListener('click', () => saveGcode(false));
  $('cam-air').addEventListener('click', () => saveGcode(true));
}

function syncMachineControls(source?: Element) {
  const m = project.machine;
  for (const input of $('machine').querySelectorAll<HTMLInputElement>('[data-mc]')) {
    if (input === source) continue;
    const v = m[input.dataset.mc as keyof MachineSettings] as number;
    input.value = input.dataset.mc === 'stockThickness' && !v ? '' : String(v);
  }
  for (const cb of $('machine').querySelectorAll<HTMLInputElement>('[data-mc-pass]')) cb.checked = m.passes[cb.dataset.mcPass as PassName];
  $('mc-corner')
    .querySelectorAll<HTMLElement>('[data-corner]')
    .forEach((b) => b.classList.toggle('on', b.dataset.corner === m.zeroCorner));
}

function openCam() {
  if (!store) return;
  // Work everything out in full (datum lines included) for exactly the project as it is now.
  const l = layoutPanel(store, project);
  const passes = buildPasses(l, project.machine);
  const checks = checkPasses(l, passes, project.machine, bedFit(project.panelWidth, project.panelHeight));
  cam = { project, layout: l, passes, checks, viewed: new Set(), show: passes[0]?.name ?? 'all' };
  if (cam.show !== 'all') cam.viewed.add(cam.show);
  selected = null;
  selectedLine = null;
  $('mc-note').textContent = 'The G-code can only be saved from the preview, once every pass has been looked at and every check is passed.';
  work.classList.add('cam');
  $('cam-bar').hidden = false;
  showCam();
  draw();
}

function closeCam(note?: string) {
  if (!cam) return;
  cam = null;
  work.classList.remove('cam');
  $('cam-bar').hidden = true;
  if (note) $('mc-note').textContent = note;
}

const minutes = (m: number) => (m < 1 ? `${Math.round(m * 60)} s` : `${Math.floor(m)} min ${Math.round((m % 1) * 60)} s`);

function showCam() {
  if (!cam) return;
  const c = cam;
  $('cam-tabs').innerHTML =
    c.passes
      .map(
        (p, i) =>
          `<button data-pass="${p.name}" class="${c.show === p.name ? 'on' : ''}">${c.viewed.has(p.name) ? '✓ ' : ''}${i + 1} ${esc(p.title)}</button>`,
      )
      .join('') + `<button data-pass="all" class="${c.show === 'all' ? 'on' : ''}">All</button>`;
  const m = c.project.machine;
  const shown = c.show === 'all' ? c.passes : c.passes.filter((p) => p.name === c.show);
  const total = c.passes.reduce((s, p) => s + p.minutes, 0);
  const feed = (p: Pass) => (p.name === 'hairline' ? m.feedHairline : p.name === 'datum' ? m.feedDatum : m.feedSlit);
  const what: Record<PassName, string> = {
    hairline: `a ${m.hairlineDepth} mm deep line on the true outline of every letter${
      c.project.border.style === 'incised'
        ? ' and both edges of the border'
        : c.project.border.style !== 'none'
          ? `, and the scribed border at ${Math.min(m.scribeDepth, MAX_SCRIBE_DEPTH)} mm deep`
          : ''
    }`,
    datum: `a ${m.datumDepth} mm deep line on every datum line`,
    slit: `down every valley line to the true depth less ${m.slitMargin} mm, at most ${m.slitStep} mm per pass, rising to nothing at the corners. Numbers show the order within each letter: thin strokes first`,
  };
  $('cam-info').innerHTML = shown
    .map(
      (p) => `<p><b>${esc(p.title)}:</b> ${what[p.name]}. ${p.cuts.length} cuts, ${(p.cutLength / 1000).toFixed(2)} m cut,
      deepest ${p.deepest.toFixed(2)} mm, feed ${feed(p)} mm/min, about ${minutes(p.minutes)}.</p>`,
    )
    .join('') + `<p class="hint small">All passes: about ${minutes(total)} on the machine. Start the spindle by hand at ${m.spindle} rpm when the file pauses. X0 Y0 at the ${CORNER_NAMES[m.zeroCorner]} corner, Z0 on the top surface.</p>`;
  // Each failed check offers the same fixes as the problems list.
  const depths = passDepths(c.passes);
  const fromLayout = (kinds: Problem['kind'][]) => {
    const seen = new Map<string, Fix>();
    for (const q of layoutProblems(c.layout, hasLetter)) if (kinds.includes(q.kind)) for (const f of q.fixes) seen.set(f.id, f);
    return [...seen.values()];
  };
  const fixesFor = (k: Check): Fix[] =>
    k.ok ? [] : k.id === 'bed' ? fromLayout(['bed']) : k.id === 'margins' || k.id === 'panel' ? fromLayout(['edges', 'room']) : checkFixes(k, depths, m, c.project.capHeight);
  $('cam-checks').innerHTML = c.checks
    .map((k) => `<li class="${k.ok ? 'ok' : k.blocking ? 'bad' : 'warn'}">${k.ok ? '✓' : k.blocking ? '✗' : '!'} ${esc(k.text)}${fixButtons(fixesFor(k))}</li>`)
    .join('');
  const unseen = c.passes.filter((p) => !c.viewed.has(p.name));
  const blocked = c.checks.some((k) => k.blocking && !k.ok);
  const locked = !!unseen.length || blocked || !c.passes.length;
  $<HTMLButtonElement>('cam-save').disabled = locked;
  $<HTMLButtonElement>('cam-air').disabled = locked;
  $('cam-viewed').textContent = blocked
    ? 'Put right the ✗ items before the G-code can be saved.'
    : unseen.length
      ? `Look at ${unseen.map((p) => p.title.toLowerCase()).join(' and ')} before saving.`
      : 'Every pass checked.';
}

/** The passes being previewed, drawn at true size in panel millimetres. */
function toolpathSvg(): string {
  if (!cam) return '';
  const c = cam;
  const m = c.project.machine;
  const half = Math.tan(((m.toolAngle / 2) * Math.PI) / 180);
  const out: string[] = ['<g class="tp">'];
  const shown = c.show === 'all' ? c.passes : c.passes.filter((p) => p.name === c.show);
  for (const pass of shown) {
    // Travel between cuts, lifted clear of the wood.
    const rapids: string[] = [];
    pass.cuts.forEach((cut, i) => {
      if (i) {
        const a = pass.cuts[i - 1].points.at(-1)!;
        const b = cut.points[0];
        rapids.push(`M${fmt(a.x)} ${fmt(a.y)}L${fmt(b.x)} ${fmt(b.y)}`);
      }
    });
    if (rapids.length && c.show !== 'all') out.push(`<path class="tp-rapid" d="${rapids.join('')}"/>`);
    if (pass.name === 'slit') {
      // The slit as the bit leaves it: its true width at the surface, from its depth.
      const bands: string[] = [];
      for (const cut of pass.cuts) {
        for (let i = 1; i < cut.points.length; i++) {
          const a = cut.points[i - 1];
          const b = cut.points[i];
          if (a.x === b.x && a.y === b.y) continue;
          const w = Math.max(-a.z, -b.z) * 2 * half;
          if (w <= 0) continue;
          bands.push(`<line x1="${fmt(a.x)}" y1="${fmt(a.y)}" x2="${fmt(b.x)}" y2="${fmt(b.y)}" stroke-width="${fmt(w)}"/>`);
        }
      }
      out.push(`<g class="tp-slit-band">${bands.join('')}</g>`);
    }
    const d = pass.cuts.map((cut) => cut.points.map((p, i) => `${i ? 'L' : 'M'}${fmt(p.x)} ${fmt(p.y)}`).join('')).join('');
    out.push(`<path class="${PASS_COLOURS[pass.name]}" d="${d}"/>`);
  }
  out.push('</g>');
  return out.join('');
}

/** Stroke numbers (cutting order within each letter) and the zero corner, in screen pixels. */
function camLabels(sx: (x: number) => number, sy: (y: number) => number): string {
  if (!cam) return '';
  const c = cam;
  const out: string[] = [];
  const slit = c.passes.find((p) => p.name === 'slit');
  if (slit && (c.show === 'slit' || c.show === 'all') && view.v.scale > 2) {
    // The same numbers as the bench sheet: strokes in cutting order, forks not numbered.
    for (const t of strokeLabels(slit)) {
      out.push(`<text class="stroke-num" x="${sx(t.x).toFixed(1)}" y="${(sy(t.y) + 4).toFixed(1)}">${t.n}</text>`);
    }
  }
  // X0 Y0, with the directions X and Y run from it.
  const p = c.project;
  const corner = p.machine.zeroCorner;
  const cx = corner.endsWith('left') ? 0 : p.panelWidth;
  const cy = corner.startsWith('top') ? 0 : p.panelHeight;
  const X = sx(cx);
  const Y = sy(cy);
  const ax = corner.endsWith('left') ? 40 : -40; // X runs to the right, so it points into the panel only from a left corner
  out.push(
    `<g class="zero"><circle cx="${X}" cy="${Y}" r="4"/>` +
      `<line x1="${X}" y1="${Y}" x2="${X + 40}" y2="${Y}"/><text x="${X + 44}" y="${Y + 4}" text-anchor="start">X</text>` +
      `<line x1="${X}" y1="${Y}" x2="${X}" y2="${Y - 40}"/><text x="${X}" y="${Y - 46}">Y</text>` +
      `<text class="zero-label" x="${X + (ax > 0 ? -8 : 8)}" y="${Y + 18}" text-anchor="${ax > 0 ? 'end' : 'start'}">X0 Y0</text></g>`,
  );
  return out.join('');
}

/** Save the G-code, or with airCut the same file lifted clear of the board for a dry run. */
function saveGcode(airCut: boolean) {
  if (!cam) return;
  const c = cam;
  if (!c.passes.length || c.passes.some((p) => !c.viewed.has(p.name)) || c.checks.some((k) => k.blocking && !k.ok)) return;
  const title = c.project.text.replace(/\s+/g, ' ').trim() || 'lettering';
  const g = toGcode(c.passes, c.project.machine, { title, panelWidth: c.project.panelWidth, panelHeight: c.project.panelHeight, airCut });
  const name = `${title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'lettering'}${airCut ? '-AIR-CUT' : ''}.nc`;
  download(g, name);
  $('cam-viewed').textContent = airCut
    ? `Saved as ${name}: a dry run that stays ${AIR_GAP} mm or more above the board. Check it in your sender's preview too.`
    : `Saved as ${name}. Check it in your sender's preview too before running it.`;
}

// ---------------------------------------------------------------- 3D view

function wire3d() {
  // Keep the workspace's own pan and zoom out of the 3D view.
  for (const ev of ['pointerdown', 'wheel'] as const) $('v3d').addEventListener(ev, (e) => e.stopPropagation());
  $('v3d').addEventListener('contextmenu', (e) => e.preventDefault());
  $('v3d-state').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-state]');
    if (!b) return;
    v3d.state = b.dataset.state as 'marked' | 'finished';
    sync3d();
    build3d();
  });
  $('v3d-colour').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-colour]');
    if (!b) return;
    v3d.colour = b.dataset.colour as Colouring;
    v3d.board?.setColouring(v3d.colour);
    sync3d();
  });
  $('v3d-views').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-view]');
    if (b) v3d.board?.view(b.dataset.view as 'fit' | 'top' | 'front');
  });
  const across = $<HTMLInputElement>('v3d-across');
  const height = $<HTMLInputElement>('v3d-height');
  across.addEventListener('input', () => {
    stopSweep();
    v3d.across = Number(across.value);
    v3d.board?.setLight(v3d.across, v3d.height);
  });
  height.addEventListener('input', () => {
    v3d.height = Number(height.value);
    v3d.board?.setLight(v3d.across, v3d.height);
  });
  $('v3d-sweep').addEventListener('click', () => (v3d.sweep ? stopSweep() : startSweep()));
  $('v3d-sharper').addEventListener('click', sharpen3d);
  $('v3d-working').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-v3d]');
    if (b?.dataset.v3d === 'cancel') cancel3d();
    if (b?.dataset.v3d === 'again') retry3d();
    if (b?.dataset.v3d === 'refresh') void refreshApp();
  });
  new ResizeObserver(() => v3d.board?.resize()).observe($('v3d'));
}

async function open3d() {
  if (v3d.open || !store) return;
  if (cam) closeCam();
  v3d.open = true;
  $('v3d').hidden = false;
  sync3d();
  // Start the sums at once, while three.js is fetched (the first time only).
  build3d();
  await ensureBoard();
}

/** The 3D drawing, made the first time it is wanted. Anything stopping it is said on the card, with the details. */
async function ensureBoard() {
  if (v3d.board) return;
  let view3d: typeof import('./view3d');
  try {
    view3d = await import('./view3d');
  } catch (err) {
    // Once more, in case it was a passing fault; if not, this copy of the app is out of date.
    try {
      view3d = await import('./view3d');
    } catch {
      const problem = setOutOfDate('the 3D drawing (three.js)', err);
      if (v3d.open) {
        cancel3d(true);
        showOutOfDate(problem);
      }
      return;
    }
  }
  clearOutOfDate('the 3D drawing (three.js)');
  if (v3d.board) return;
  try {
    v3d.board = new view3d.Board3D($('v3d-canvas'));
  } catch (err) {
    console.error(err);
    if (!v3d.open) return;
    cancel3d(true);
    v3d.retry = { board: true };
    showFailure(
      'The 3D view could not start drawing.',
      'This browser’s 3D graphics (WebGL) are off or not available. Check that hardware acceleration is on in the browser’s settings, then try again.',
      false,
      [`Reason: ${err instanceof Error ? err.message : String(err)}`],
    );
    return;
  }
  v3d.board.setLight(v3d.across, v3d.height);
  v3d.board.setColouring(v3d.colour);
  await new Promise((r) => setTimeout(r)); // let the page breathe between the two
  await v3d.board.prepare();
  if (pendingBoard) {
    const r = pendingBoard;
    pendingBoard = null;
    showBoard(r);
  }
}

/** "Try again" on the card: whatever failed last. */
function retry3d() {
  const r = v3d.retry;
  v3d.retry = null;
  if (r && 'board' in r) {
    showWorking(null);
    build3d();
    void ensureBoard();
  } else startJob(r?.area ?? null);
}

function close3d() {
  stopSweep();
  cancel3d(true);
  showWorking(null);
  v3d.open = false;
  $('v3d').hidden = true;
}

function schedule3d() {
  clearTimeout(v3d.rebuild);
  v3d.rebuild = window.setTimeout(build3d, 400);
}

/** A board worked out before three.js had arrived, to show once it has. */
let pendingBoard: { result: ReliefResult; job: NonNullable<typeof v3d.job> } | null = null;

/**
 * The 3D worker's program, fetched once and kept for as long as the page is
 * open, so every worker the page makes is of the page's own version, even
 * after a newer version has been published and this one's files are gone
 * (BRIEF.md, Decisions: "The offline copy"). If it can't be had the usual
 * way it is fetched fresh from the server; failing that, this copy of the app
 * is out of date, and the problems say so, with a button to refresh it.
 */
let workerSource: Promise<string> | null = null;
function reliefWorkerSource(): Promise<string> {
  // The development server's worker fetches its parts by their addresses, so it is used as it is.
  if (import.meta.env.DEV) return Promise.resolve(reliefWorkerUrl);
  if (!workerSource) {
    const source = fetchAppFile(reliefWorkerUrl).then(async (res) => URL.createObjectURL(new Blob([await res.text()], { type: 'text/javascript' })));
    workerSource = source;
    source.then(
      () => clearOutOfDate('the 3D worker'),
      (err) => {
        if (workerSource === source) workerSource = null; // tried again next time
        setOutOfDate('the 3D worker', err);
      },
    );
  }
  return workerSource;
}

/**
 * Linked letters' valley lines, and their datum lines at each size
 * (letters.ts), are worked out by an instance of the 3D view's worker program
 * of their own, one at a time; the page shows what it has meanwhile, and lays
 * them out afresh as each arrives. If the worker can't be had, they are worked
 * out on the page instead.
 */
type ShapeJob = { kind: 'valleys'; key: string; outline: Contour[] } | { kind: 'datum'; key: string; valleys: ValleyLine[]; rule: DatumRule };
let shapeWorker: Worker | null = null;
let shapeWorkerAsked = false;
const shapeQueue: ShapeJob[] = [];
function askShape(key: string, outline: Contour[]) {
  sendShape({ kind: 'valleys', key, outline });
}
function askDatum(key: string, valleys: ValleyLine[], rule: DatumRule) {
  sendShape({ kind: 'datum', key, valleys, rule });
}
function sendShape(job: ShapeJob) {
  shapeQueue.push(job);
  if (shapeWorker) return void shapeWorker.postMessage(job);
  if (shapeWorkerAsked) return;
  shapeWorkerAsked = true;
  reliefWorkerSource().then(
    (source) => {
      shapeWorker = new Worker(source, { type: 'module' });
      shapeWorker.onmessage = (e: MessageEvent<{ kind?: string; key: string; valleys?: ValleyLine[]; datum?: Contour[]; error?: string }>) => {
        const d = e.data;
        if ((d.kind !== 'valleys' && d.kind !== 'datum') || !store) return;
        const i = shapeQueue.findIndex((q) => q.key === d.key && q.kind === d.kind);
        const job = i >= 0 ? shapeQueue.splice(i, 1)[0] : null;
        if (d.valleys) store.putValleys(d.key, d.valleys);
        else if (d.datum) store.putDatum(d.key, d.datum);
        else {
          console.error('The worker could not work out linked letters:', d.error);
          if (job) shapeOnPage(job);
        }
        shapesArrived();
      };
      shapeWorker.onerror = (e) => {
        console.error('The linked letters worker stopped:', e.message);
        shapeWorker = null;
        shapesOnPage();
      };
      for (const q of shapeQueue) shapeWorker.postMessage(q);
    },
    () => shapesOnPage(),
  );
}

function shapeOnPage(job: ShapeJob) {
  if (!store) return;
  if (job.kind === 'valleys') store.valleysNow(job.key);
  else store.putDatum(job.key, datumLines(job.valleys, job.rule));
}

/** Without the worker: whatever is waiting is worked out here, one at a time. */
function shapesOnPage() {
  const next = shapeQueue.shift();
  if (!next || !store) return;
  shapeOnPage(next);
  shapesArrived();
  if (shapeQueue.length) window.setTimeout(shapesOnPage, 0);
}

/** A linked run's valley lines have come: lay the job out again, and anything worked out without them afresh. */
let shapesTimer = 0;
function shapesArrived() {
  clearTimeout(shapesTimer);
  shapesTimer = window.setTimeout(() => {
    relayout();
    if ((cam?.layout.shapesPending || cam?.layout.datumPending) && cam?.project === project) openCam();
  }, 30);
}

type WorkerMessage = { id?: number; progress?: number; error?: string; stack?: string; version?: string; result?: ReliefResult };

/** A worker running the program fetched above. */
function makeWorker(source: string): Worker {
  const w = new Worker(source, { type: 'module' });
  w.onmessage = (e: MessageEvent<WorkerMessage>) => {
    const msg = e.data;
    const job = v3d.job;
    const id = msg.result?.id ?? msg.id;
    if (!job || id !== job.id) return; // an answer to work since replaced
    if (msg.progress !== undefined) return showWorking(msg.progress);
    v3d.job = null;
    if (msg.version) document.body.dataset.worker3d = msg.version; // for the browser tests
    if (msg.error) {
      console.error('3D board:', msg.error, msg.stack);
      v3d.retry = { area: job.area };
      return showFailure(
        job.area ? 'The sharper detail could not be worked out.' : 'The 3D board could not be worked out.',
        `${v3d.shown ? 'The board shown is from before. ' : ''}Change a setting, or try again.`,
        false,
        [`Reason: ${msg.error}`, ...stackLines(msg.stack), jobLine(job), `3D worker: version ${msg.version ?? 'not known'}`],
      );
    }
    showBoard({ result: msg.result!, job });
  };
  w.onerror = (e: ErrorEvent | Event) => {
    e.preventDefault();
    w.terminate();
    if (v3d.worker !== w) return;
    v3d.worker = null;
    const job = v3d.job;
    v3d.job = null;
    if (!v3d.open) return;
    v3d.retry = { area: job?.area ?? null };
    const err = e instanceof ErrorEvent ? e : null;
    showFailure(
      'The 3D worker stopped unexpectedly.',
      `${v3d.shown ? 'The board shown is from before. ' : ''}Change a setting, or try again.`,
      false,
      [
        `Reason: ${err?.message || 'none given by the browser'}`,
        ...(err?.filename ? [`Where: ${shortUrl(err.filename)}, line ${err.lineno}, column ${err.colno}`] : []),
        ...(job ? [jobLine(job)] : []),
      ],
    );
  };
  return w;
}

/** A program's address, shorter: the 3D worker's program in memory has a long one. */
const shortUrl = (u: string) => u.replace(/^blob:\S+/, 'the 3D worker').replace(/^.*\/assets\//, '');

/** The first few lines of where an error happened. */
const stackLines = (stack?: string) =>
  (stack ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 5)
    .map((l) => `  at ${l.replace(/^at /, '').replace(/blob:[^\s)]+/g, 'the 3D worker').replace(/\S*\/assets\//g, '')}`);

const jobLine = (job: NonNullable<typeof v3d.job>) =>
  `Board: ${job.state === 'marked' ? 'marked out by the bit' : 'finished letters'}, ${job.area ? 'sharper detail of part of it' : 'the whole board'}, ${job.project.panelWidth} × ${job.project.panelHeight} mm`;

/** The facts under a problem's Details, so it can be put right from a screenshot. */
async function diagnosis(lines: string[]): Promise<string> {
  return [
    ...lines,
    `App: ${VERSION_TEXT}`,
    `Offline copy: ${await savedCopies()}`,
    `Internet: ${navigator.onLine ? 'connected' : 'not connected'}`,
    `Browser: ${navigator.userAgent}`,
  ].join('\n');
}

/** Part of the app that could not be loaded, either way: this copy is out of date. */
let outOfDate: { part: string; problem: Problem } | null = null;

function setOutOfDate(part: string, err: unknown): Problem {
  const lines =
    err instanceof AppFileError ? [`Could not load: ${part} (${shortUrl(err.url)})`, ...err.tries] : [`Could not load: ${part}`, `Reason: ${err instanceof Error ? err.message : String(err)}`];
  const problem: Problem = {
    level: 'bad',
    stage: '3d',
    kind: 'app',
    text: 'The saved copy of the app is out of date: part of the 3D view could not be loaded. Refresh the app to get the newest version (this needs the internet).',
    fixes: [{ id: 'refresh-app', label: 'Refresh the app' }],
    details: 'Gathering the details…',
  };
  outOfDate = { part, problem };
  refreshProblems();
  void diagnosis(lines).then((d) => {
    problem.details = d;
    if (outOfDate?.problem === problem) refreshProblems();
    if (cardProblem === problem) $('v3d-working').querySelector('pre')!.textContent = d;
  });
  return problem;
}

function clearOutOfDate(part: string) {
  if (outOfDate?.part !== part) return;
  outOfDate = null;
  refreshProblems();
}

/**
 * Work out the board (area null) or a sharper area of it, away from the page.
 * Anything already under way is stopped first: only the newest is wanted.
 */
function startJob(area: Area | null) {
  if (!store) return;
  cancel3d(true);
  const p = project;
  // The layout as drawn, if it is complete and current; it is worked out afresh otherwise.
  const l = layout && layout.project === p && !layout.datumPending ? layout : layoutPanel(store, p);
  const job: ReliefJob = { id: ++v3d.lastId, state: v3d.state, width: p.panelWidth, height: p.panelHeight, machine: p.machine, area };
  if (v3d.state === 'marked') {
    // The passes the G-code checks worked out, if they are for this very job; else the worker works them out.
    if (machineChecks?.project === p && machineChecks.passes.length) job.cuts = packCuts(machineChecks.passes);
    else job.layout = { ...l, gaps: [] };
  } else {
    const f = finishedInput(l);
    Object.assign(job, { shapes: packShapes(f.shapes), border: f.border, datum: f.datum, widest: f.widest });
  }
  v3d.job = { id: job.id, area, project: p, state: v3d.state };
  showWorking(0);
  reliefWorkerSource().then(
    (source) => {
      if (v3d.job?.id !== job.id) return; // stopped or replaced meanwhile
      v3d.worker ??= makeWorker(source);
      v3d.worker.postMessage(job, [job.cuts?.buffer, job.shapes?.buffer].filter((b): b is ArrayBuffer => !!b));
    },
    () => {
      if (v3d.job?.id !== job.id) return;
      v3d.job = null;
      if (outOfDate) showOutOfDate(outOfDate.problem);
    },
  );
}

/** Stop the work under way; the board shown stays as it was. */
function cancel3d(quiet = false): boolean {
  if (!v3d.job) return false;
  v3d.worker?.terminate();
  v3d.worker = null;
  const wasDetail = !!v3d.job.area;
  v3d.job = null;
  showWorking(null);
  if (!quiet) {
    if (v3d.shown) say(wasDetail ? 'Cancelled: the board is shown as it was.' : 'Cancelled: the board shown is from before the last change.');
    else showWorking('cancelled');
  }
  return true;
}

/** The problem the card is showing, if it is showing one from the problems list. */
let cardProblem: Problem | null = null;

/** The progress card: how far through (0 to 1), cancelled (with a button to start again), or hidden (null). */
function showWorking(done: number | 'cancelled' | null) {
  const card = $('v3d-working');
  card.hidden = done === null;
  cardProblem = null;
  card.classList.remove('failed');
  card.querySelector<HTMLElement>('details')!.hidden = true;
  card.querySelector<HTMLElement>('[data-v3d="refresh"]')!.hidden = true;
  if (done === null) return;
  const cancelled = done === 'cancelled';
  card.classList.toggle('idle', cancelled);
  card.querySelector('.v3d-what')!.textContent = cancelled
    ? 'Cancelled.'
    : v3d.job?.area
      ? 'Working out the detail…'
      : 'Working out the board…';
  card.querySelector('.v3d-pct')!.textContent = cancelled ? '' : `${Math.round(done * 100)}%`;
  card.querySelector<HTMLElement>('.v3d-bar i')!.style.width = cancelled ? '0' : `${(done * 100).toFixed(1)}%`;
  card.querySelector('.v3d-foot span')!.textContent = cancelled
    ? 'Nothing to show yet.'
    : v3d.shown
      ? 'The board shown stays until the new one is ready.'
      : 'This takes a moment the first time.';
  card.querySelector<HTMLElement>('[data-v3d="cancel"]')!.hidden = cancelled;
  const again = card.querySelector<HTMLElement>('[data-v3d="again"]')!;
  again.hidden = !cancelled;
  again.textContent = 'Work it out';
  if (cancelled) v3d.retry = null;
}

/**
 * The card, saying in plain words what went wrong and what to do, with the
 * actual reason folded under Details so it can be put right from a
 * screenshot. `details` are the lines particular to this failure; the
 * versions, the offline copy and the browser are added.
 */
function showFailure(what: string, next: string, refresh: boolean, details: string[] | string) {
  const retry = v3d.retry;
  showWorking('cancelled');
  v3d.retry = retry;
  const card = $('v3d-working');
  card.classList.add('failed');
  card.querySelector('.v3d-what')!.textContent = what;
  card.querySelector('.v3d-foot span')!.textContent = next;
  const again = card.querySelector<HTMLElement>('[data-v3d="again"]')!;
  again.hidden = refresh;
  again.textContent = 'Try again';
  card.querySelector<HTMLElement>('[data-v3d="refresh"]')!.hidden = !refresh;
  const fold = card.querySelector<HTMLDetailsElement>('details')!;
  fold.hidden = false;
  const pre = fold.querySelector('pre')!;
  if (typeof details === 'string') pre.textContent = details;
  else {
    pre.textContent = 'Gathering the details…';
    void diagnosis(details).then((d) => {
      if (card.classList.contains('failed') && card.querySelector('.v3d-what')!.textContent === what) pre.textContent = d;
    });
  }
  say(what);
}

/** The card for a part of the app that could not be loaded: the same words and fix as the problems list. */
function showOutOfDate(problem: Problem) {
  if (!v3d.open) return;
  showFailure('The saved copy of the app is out of date.', 'Part of the 3D view could not be loaded. Refresh the app to get the newest version (this needs the internet).', true, problem.details ?? '');
  cardProblem = problem;
}

/** Put a finished piece of work on show. */
function showBoard({ result, job }: { result: ReliefResult; job: NonNullable<typeof v3d.job> }) {
  if (!v3d.board) {
    pendingBoard = { result, job };
    return; // three.js is still on its way
  }
  showWorking(null);
  const p = job.project;
  const m = p.machine;
  if (job.area) {
    v3d.board.setDetail(result, job.area);
    $('v3d-detail').textContent = `Sharper: detail every ${result.res.toFixed(2)} mm over ${(job.area.x1 - job.area.x0).toFixed(0)} × ${(job.area.y1 - job.area.y0).toFixed(0)} mm. Any change to the board drops it; press Sharper again.`;
    return;
  }
  const thickness = m.stockThickness > 0 ? m.stockThickness : 20;
  // For the browser tests: the number of the board on show, once it has been drawn.
  v3d.board.setBoard(result, p.panelWidth, p.panelHeight, thickness, () => (document.body.dataset.board3d = String(job.id)));
  v3d.board.setColouring(v3d.colour);
  v3d.board.setLight(v3d.across, v3d.height);
  v3d.shown = { project: p, state: job.state, res: result.res, maxDepth: result.maxDepth };
  $('v3d-detail').textContent = '';
  const passes = (['hairline', 'datum', 'slit'] as const).filter((k) => m.passes[k]);
  const names = { hairline: 'hairline', datum: 'datum line', slit: 'valley slit and forks' };
  $('v3d-note').textContent =
    (job.state === 'marked'
      ? `As the ${m.toolAngle}° bit leaves it: exactly the cuts in the G-code (${passes.map((k) => names[k]).join(', ') || 'no passes chosen'}).`
      : `Finished: every letter carved to ${m.chiselAngle}°, as the chisel leaves it.`) +
    ` Board ${p.panelWidth} × ${p.panelHeight} mm, ${thickness} mm thick${m.stockThickness > 0 ? '' : ' (stock thickness not entered yet: shown as 20 mm)'}. Deepest ${result.maxDepth.toFixed(2)} mm. Surface detail every ${result.res.toFixed(2)} mm.`;
  syncLegend();
}

/** Work out the board's surface for what's chosen, and show it once ready. */
function build3d() {
  if (!v3d.open || !store) return;
  // Linked letters still being worked out (their valleys, or their datum lines at this size): the
  // board is worked out once they come (shapesArrived lays out afresh, which brings this back).
  if (layout?.project === project && layout.shapesPending) return;
  if (layoutPanel(store, project).datumPending) return;
  // Already on show (perhaps being made sharper), or under way: nothing to do.
  if (v3d.shown?.project === project && v3d.shown.state === v3d.state && (!v3d.job || v3d.job.area)) return;
  if (v3d.job && !v3d.job.area && v3d.job.project === project && v3d.job.state === v3d.state) return;
  startJob(null);
}

/** Work out the part of the board in view at full detail, for a close look. */
function sharpen3d() {
  const area = v3d.board?.areaInView();
  if (!v3d.board?.ready || !v3d.shown) return say('Wait for the board to be worked out first.');
  if (!area) return say('Turn the view towards the board first.');
  if (v3d.shown.project !== project || v3d.shown.state !== v3d.state) return say('Wait for the board to be worked out first.');
  const res = chooseRes(area.x1 - area.x0, area.y1 - area.y0);
  if (res > v3d.shown.res * 0.8) {
    return say(
      res >= v3d.shown.res
        ? 'Move in closer first: the whole board is in view, and it is already shown at the most detail it can be.'
        : 'Move in closer first: there is little more detail to show for this much of the board.',
    );
  }
  startJob(area);
}

function syncLegend() {
  $('v3d-legend').innerHTML =
    v3d.colour === 'depth' && v3d.shown ? `<span class="v3d-ramp"></span><small>0 → ${v3d.shown.maxDepth.toFixed(1)} mm deep</small>` : '';
}

function sync3d() {
  $('v3d-state')
    .querySelectorAll<HTMLElement>('[data-state]')
    .forEach((b) => b.classList.toggle('on', b.dataset.state === v3d.state));
  $('v3d-colour')
    .querySelectorAll<HTMLElement>('[data-colour]')
    .forEach((b) => b.classList.toggle('on', b.dataset.colour === v3d.colour));
  $<HTMLInputElement>('v3d-across').value = String(v3d.across);
  $<HTMLInputElement>('v3d-height').value = String(v3d.height);
  $('v3d-sweep').textContent = v3d.sweep ? 'Stop ■' : 'Sweep ▶';
  $('v3d-sweep').classList.toggle('on', !!v3d.sweep);
  syncLegend();
}

/** Sweep the light slowly from left to right and back. */
function startSweep() {
  const start = performance.now();
  const from = v3d.across;
  const step = (now: number) => {
    // From where it is, across and back, about 8 seconds each way.
    const phase = ((now - start) / 8000 + (from + 90) / 180) % 2;
    v3d.across = phase < 1 ? -90 + 180 * phase : 90 - 180 * (phase - 1);
    v3d.board?.setLight(v3d.across, v3d.height);
    $<HTMLInputElement>('v3d-across').value = String(Math.round(v3d.across));
    v3d.sweep = requestAnimationFrame(step);
  };
  v3d.sweep = requestAnimationFrame(step);
  sync3d();
}

function stopSweep() {
  if (v3d.sweep) cancelAnimationFrame(v3d.sweep);
  v3d.sweep = 0;
  sync3d();
}

// ---------------------------------------------------------------- stages, status bar, files, search

const PRESET_TITLES: Record<PresetName, string> = { design: 'Design', spacing: 'Spacing', setting: 'Setting-out', proof: 'Proof' };
const HINT = 'Drag to move · Scroll to zoom · Ctrl+K finds anything · ? lists the keys';
let installApp: (() => Promise<void>) | null = null;

function wireChrome() {
  $('stages').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-stage]');
    if (b) setStage(b.dataset.stage as Stage);
  });

  // Drop-down menus: File, and Layers. A press anywhere else closes them.
  for (const [btn, list] of [
    ['file-btn', 'file-menu'],
    ['layers-btn', 'layers'],
  ] as const) {
    $(btn).addEventListener('click', () => {
      const open = $(list).hidden;
      closeMenus();
      $(list).hidden = !open;
      $(btn).setAttribute('aria-expanded', String(open));
    });
  }
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (!(e.target as Element).closest('.menu, #warn-pop, #st-warn')) closeMenus();
    },
    true,
  );
  $('file-menu').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-file]');
    if (!b) return;
    closeMenus();
    const act = b.dataset.file;
    if (act === 'new') newProject();
    else if (act === 'open') openProjectFile();
    else if (act === 'save' || act === 'saveas') saveProjectFile(act === 'saveas');
    else if (act === 'sheet') showSheet();
  });

  $('search-btn').addEventListener('click', showPalette);
  $('keys-btn').addEventListener('click', showKeys);
  for (const d of document.querySelectorAll('dialog')) {
    d.addEventListener('click', (e) => {
      if ((e.target as Element).closest('[data-close]')) d.close();
    });
  }
  $('sheet-print').addEventListener('click', printSheet);
  window.addEventListener('beforeprint', fillPrint);

  // Status bar.
  $('zoom-in').addEventListener('click', () => zoomBy(1.25));
  $('zoom-out').addEventListener('click', () => zoomBy(0.8));
  $('zoom-read').addEventListener('click', () => view.frame(project.panelWidth, project.panelHeight, pxPerMm()));
  $('st-snap').addEventListener('click', () => setSnapping(!snapping));
  setSnapping(snapping);
  $('st-warn').addEventListener('click', () => {
    const open = $('warn-pop').hidden;
    closeMenus();
    if (!open) return;
    showProblemList();
    $('warn-pop').hidden = false;
    $('st-warn').setAttribute('aria-expanded', 'true');
  });
  $('warn-pop').addEventListener('click', (e) => {
    // A fix is carried out where you are, and the list stays open to show what is left.
    const fix = (e.target as HTMLElement).closest<HTMLElement>('[data-fix]');
    if (fix) return runFix(fix.dataset.fix!);
    if ((e.target as HTMLElement).closest('details')) return; // opening the Details stays put
    const li = (e.target as HTMLElement).closest<HTMLElement>('[data-stage]');
    if (!li) return;
    closeMenus();
    // To its stage, and a problem with a place on the panel is marked there.
    const q = li.dataset.key ? problems.find((x) => x.key === li.dataset.key) : undefined;
    if (q) showProblem(q);
    else setStage(li.dataset.stage as Stage);
  });
  $('st-msg').textContent = HINT;
  // Which version this is, where every screenshot shows it.
  $('st-version').innerHTML = `Version ${esc(APP_VERSION)}${APP_PUBLISHED ? `<span class="st-pub">, published ${esc(APP_PUBLISHED)}</span>` : ''}`;
  $('st-version').title = `${VERSION_TEXT}. ${$('st-version').title}`;
  $('keys-version').textContent = VERSION_TEXT;

  // Drag a setting's name to change it; the whole drag is one step to undo.
  const hooks = {
    begin: () => {
      batch = { before: project };
    },
    end: () => {
      if (batch && project !== batch.before) history.record(batch.before);
      batch = null;
      refreshUndoButtons();
    },
  };
  enableScrub($('side'), hooks);
  enableScrub(linePop, hooks);
  enableScrub(spacerPop, hooks);

  // The "More" folds remember whether they were left open.
  for (const d of document.querySelectorAll<HTMLDetailsElement>('details.more')) {
    const key = `incised.more.${d.dataset.more}`;
    d.open = readNumber(key, 0, 0, 1) === 1;
    d.addEventListener('toggle', () => writeJson(key, d.open ? 1 : 0));
  }

  // The installed app: its button, and project files opened by double-clicking them.
  startApp({
    installable: (install) => {
      installApp = install;
      const b = $<HTMLButtonElement>('install');
      b.hidden = !install;
      b.onclick = install ? () => void install() : null;
    },
  });
  onFileLaunch((f, handle) => void openFromFile(f, handle as FileHandle));
}

/** Show one stage of the job: its own tools in the side panel, and its own view of the panel. */
function setStage(s: Stage, force = false) {
  if (s === stage && !force) return;
  stage = s;
  if (s !== '3d') lastFlatStage = s;
  document.body.dataset.stage = s;
  try {
    localStorage.setItem(STAGE_KEY, s);
  } catch {
    /* not remembered */
  }
  $('stages')
    .querySelectorAll<HTMLElement>('[data-stage]')
    .forEach((b) => {
      b.classList.toggle('on', b.dataset.stage === s);
      if (b.dataset.stage === s) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
    });
  document.querySelectorAll<HTMLElement>('.stage-panel').forEach((el) => (el.hidden = el.dataset.panel !== s));
  $('side').scrollTop = 0;
  closeMenus();
  if (s !== 'machine' && cam) closeCam();
  if (s === '3d') {
    if (measuring) setMeasuring(false);
    selected = null;
    selectedLine = null;
    void open3d();
  } else {
    if (v3d.open) close3d();
    showStageView(s);
  }
  // The flat drawing is hidden under the 3D view: no need to draw it again just to show the board.
  if (s !== '3d') draw();
  showCursor();
}

function closeMenus() {
  for (const [btn, list] of [
    ['file-btn', 'file-menu'],
    ['layers-btn', 'layers'],
    ['st-warn', 'warn-pop'],
  ]) {
    $(list).hidden = true;
    $(btn).setAttribute('aria-expanded', 'false');
  }
}

function zoomBy(f: number) {
  const r = work.getBoundingClientRect();
  view.zoomAt(f, r.width / 2, r.height / 2);
}

/** Where the pointer is on the panel, in the status bar. */
function showCursor() {
  const el = $('st-cursor');
  if (!pointer || stage === '3d') {
    el.textContent = 'across — · down — mm';
    return;
  }
  const v = view.v;
  el.textContent = `across ${((pointer.x - v.tx) / v.scale).toFixed(1)} · down ${((pointer.y - v.ty) / v.scale).toFixed(1)} mm`;
}

function setSnapping(on: boolean) {
  snapping = on;
  writeJson(SNAP_KEY, on ? 1 : 0);
  const b = $('st-snap');
  b.textContent = on ? 'Snapping on' : 'Snapping off';
  b.classList.toggle('on', on);
}

/** A short message in the status bar, for a few seconds. */
let sayTimer = 0;
function say(text: string) {
  const el = $('st-msg');
  el.textContent = text;
  el.classList.add('fresh');
  clearTimeout(sayTimer);
  sayTimer = window.setTimeout(() => {
    el.textContent = HINT;
    el.classList.remove('fresh');
  }, 7000);
}

// ---------------------------------------------------------------- the warnings badge

let problems: Problem[] = [];

function refreshProblems() {
  if (!layout || !store) return;
  const list = layoutProblems(layout, hasLetter);
  // Letters that collide: their fixes are offered once tried, a moment behind.
  if (fixTrials?.project === project && layout.project === project) {
    attachFixes(list, fixTrials.fixes);
    // Any the trials could not get to are left with none rather than untried ones.
    if (fixTrials.done) for (const q of list) if (q.trying) (q.trying = false), (q.fixes = []);
  } else if (list.some((q) => q.trying)) scheduleFixTrials();
  if (marked && !list.some((q) => q.key === marked)) marked = null; // put right: nothing left to mark
  if (project.refImage && !refUrl) {
    list.push({
      level: 'warn',
      stage: 'panel',
      kind: 'picture',
      text: 'The reference picture was not kept by this browser.',
      fixes: [
        { id: 'reload-picture', label: 'Load the picture again' },
        { id: 'remove-picture', label: 'Remove the picture' },
      ],
    });
  }
  if (outOfDate) list.push(outOfDate.problem);
  // The G-code checks take longer, so they follow a moment behind; the last ones stand till then.
  if (machineChecks) list.push(...machineChecks.problems);
  // (Worked out while linked letters were still to come: again, now they may have.)
  if (machineChecks?.project !== project || (machineChecks.pending && !layout.shapesPending)) scheduleChecks();
  problems = list;
  const sum = problemSummary(list);
  const b = $('st-warn');
  b.textContent = sum.text;
  b.className = `badge ${sum.level}`;
  b.title = list.length ? 'Click to see every problem, with ways to put each right' : 'Nothing needs putting right';
  if (!$('warn-pop').hidden) showProblemList();
}

/** Whether the alphabet has a drawn letter for this character. */
function hasLetter(ch: string): boolean {
  return !!store?.alphabet.letter(ch)?.contours.length;
}

function scheduleChecks() {
  clearTimeout(checkTimer);
  checkTimer = window.setTimeout(() => {
    const p = project;
    const run = () => {
      if (p !== project || !store) return; // changed again: the next round will do it
      try {
        const l = layoutPanel(store, p);
        const passes = buildPasses(l, p.machine);
        const checks = checkPasses(l, passes, p.machine, bedFit(p.panelWidth, p.panelHeight));
        machineChecks = { project: p, problems: machineProblems(checks, passDepths(passes), p.machine, p.capHeight), passes, pending: l.shapesPending || l.datumPending };
      } catch (err) {
        // Not to be tried again and again: the problem stands until the job changes.
        console.error(err);
        const problem: Problem = { level: 'bad', stage: 'machine', kind: 'machine', text: 'The G-code safety checks could not be worked out for this job, so the G-code cannot be saved yet.', fixes: [{ id: 'go-machine', label: 'Go to Machine' }] };
        machineChecks = { project: p, problems: [problem], passes: [] };
      }
      refreshProblems();
    };
    if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 2000 });
    else run();
  }, 500);
}

/**
 * Tries the fixes for letters that collide on copies of the layout, a little
 * at a time once the job has been still for a moment, so the page never
 * stalls; each is offered once it is known to cure its problem without
 * causing a new one (CLAUDE.md, "Every fix is tried before it is offered").
 */
function scheduleFixTrials() {
  if (trialFor === project) return; // already under way for the job as it is
  trialFor = project;
  const round = ++trialRound;
  clearTimeout(trialTimer);
  trialTimer = window.setTimeout(() => {
    const p = project;
    const l = layout;
    const s = store;
    // A preview of spacing suggestions is showing: tried once it is put away.
    if (round !== trialRound || !s || !l || l.project !== p) {
      if (round === trialRound) trialFor = null;
      return;
    }
    // Each problem's fixes are shown as soon as they are known.
    const trials = { project: p, fixes: new Map<string, Fix[]>(), done: false };
    fixTrials = trials;
    // Trials lay out copies with the linked letters' outlines only: never waiting on new ones.
    const steps = tryFixes(l, hasLetter, (q) => layoutPanel(s, q, true, 'outline'), trials.fixes);
    const slice = () => {
      if (round !== trialRound || p !== project) return; // changed again: the next round tries afresh
      const start = performance.now();
      const known = trials.fixes.size;
      try {
        for (;;) {
          if (steps.next().done) {
            trials.done = true;
            break;
          }
          if (performance.now() > start + 6) break;
        }
      } catch (err) {
        // Nothing offered rather than anything untried; the problems still stand.
        console.error('The fixes for letters that collide could not be tried:', err);
        trials.done = true;
      } finally {
        // Each slice shows in the browser's own timeline, and the browser tests time it.
        performance.measure(TRIAL_SLICE, { start });
      }
      if (trials.done || trials.fixes.size !== known) refreshProblems();
      if (!trials.done) window.setTimeout(slice, 0);
    };
    slice();
  }, 200);
}

/** Go to a problem's stage and mark it on the panel, bringing it into view if it is off the screen. */
function showProblem(q: Problem) {
  setStage(q.stage);
  if (!q.key || !q.spot) return;
  marked = q.key;
  const v = view.v;
  const r = work.getBoundingClientRect();
  const x = v.tx + q.spot.x * v.scale;
  const y = v.ty + q.spot.y * v.scale;
  if (x < 60 || y < 60 || x > r.width - 60 || y > r.height - 60) view.set({ ...v, tx: r.width / 2 - q.spot.x * v.scale, ty: r.height / 2 - q.spot.y * v.scale });
  drawOverlay();
}

/** P and Shift+P: the next or previous problem that has a place on the panel, marked there. */
function stepProblem(dir: 1 | -1) {
  const placed = problems.filter((q) => q.key && q.spot);
  if (!placed.length) return say(problems.length ? 'None of the problems has a place on the panel to show.' : 'Nothing needs putting right.');
  const at = placed.findIndex((q) => q.key === marked);
  const q = placed[at < 0 ? (dir > 0 ? 0 : placed.length - 1) : (at + dir + placed.length) % placed.length];
  showProblem(q);
  say(q.text);
}

const fixButtons = (fixes: Fix[]) =>
  fixes.length ? `<span class="fixes">${fixes.map((f) => `<button type="button" data-fix="${esc(f.id)}">${esc(f.label)}</button>`).join('')}</span>` : '';

/** A problem's fixes, or why there are none yet. */
function problemFixes(q: Problem): string {
  if (q.trying) return '<span class="fixes"><small class="trying">Trying the fixes on a copy first…</small></span>';
  if (q.kind === 'collision' && !q.fixes.length)
    return '<span class="fixes"><small class="trying">No one-click fix parts these without causing a new problem or making one worse: move a line or open the gap by hand.</small></span>';
  if (q.kind === 'link' && !q.fixes.length)
    return '<span class="fixes"><small class="trying">No one-click fix puts this right without causing a new problem or making one worse: set the overlap by hand (Alt+← goes deeper), or unlink them (L).</small></span>';
  return fixButtons(q.fixes);
}

function showProblemList() {
  $('warn-pop').querySelector('ul')!.innerHTML = problems.length
    ? problems
        .map(
          (q) =>
            `<li class="${q.level}" data-stage="${q.stage}"${q.key ? ` data-key="${esc(q.key)}"` : ''} title="Go to ${STAGE_NAMES[q.stage]}${q.spot ? ' and mark it on the panel' : ''}"><b>${q.level === 'bad' ? '✗' : '!'}</b><span>${esc(q.text)}</span><small>${STAGE_NAMES[q.stage]}</small>${problemFixes(q)}${
              q.details ? `<details class="why"><summary>Details</summary><pre>${esc(q.details)}</pre></details>` : ''
            }</li>`,
        )
        .join('')
    : '<li class="ok"><b>✓</b><span>Nothing needs putting right.</span></li>';
}

// ---------------------------------------------------------------- one-click fixes

/** Move a line placed by hand the least distance that brings it inside the margins. */
function moveLineInside(index: number) {
  const line = lineAtIndex(index);
  if (!line?.ink) return;
  const box = contentBox(project);
  const k = project.capHeight;
  const shift = (a0: number, a1: number, b0: number, b1: number) => (a0 < b0 ? b0 - a0 : a1 > b1 ? b1 - a1 : 0);
  const dx = shift(line.ink.x0, line.ink.x1, box.x0, box.x1);
  const dy = shift(line.baselineY - k, line.baselineY, box.y0, box.y1);
  const p0 = placementOf(line);
  setPlacement(index, { ...p0, x: round(p0.x + dx, 3), baseline: round(p0.baseline + dy, 3) });
  say(`Line ${line.number} moved inside the margins. Ctrl+Z undoes it.`);
}

/** Change the text, carrying placed lines, blank-line heights and one-gap kerning with it. */
function setText(text: string) {
  selected = null;
  update({ text, ...remapForEdit(project, text) });
}

/** Carry out a one-click fix from the problems list (problems.ts); each is one step to undo. */
function runFix(id: string) {
  if (!store || !layout) return;
  // A fix tried on a copy before it was offered does exactly what was tried.
  const tried = problems.flatMap((q) => q.fixes).find((f) => f.id === id && f.change);
  if (tried?.change) {
    update(tried.change);
    return say(tried.done ?? `${tried.label}: done. Ctrl+Z undoes it.`);
  }
  const [what, arg] = id.split(':');
  const n = Number(arg);
  const machine = project.machine;
  const mc = (key: keyof MachineSettings) => $('machine').querySelector<HTMLInputElement>(`[data-mc="${key}"]`)!;
  switch (what) {
    case 'fit-lettering':
      return fitLettering('both');
    case 'fit-panel':
      return fitPanelToLettering();
    case 'auto-line': {
      const number = lineNumber(layout, n);
      setPlacement(n, null);
      return say(`Line ${number} returned to auto: it follows the line spacing and alignment again. Ctrl+Z undoes it.`);
    }
    case 'inside-line':
      return moveLineInside(n);
    case 'line-spacing':
      update({ lineSpacing: n });
      return say(`Line spacing opened to ${n} mm. Ctrl+Z undoes it.`);
    case 'caps':
      setText([...project.text].map((ch) => (/\s/.test(ch) || hasLetter(ch) || !hasLetter(ch.toUpperCase()) ? ch : ch.toUpperCase())).join(''));
      return say('Changed to capitals. Ctrl+Z undoes it.');
    case 'remove-missing':
    case 'remove-char': {
      // Each one goes with the space it leaves, so no double spaces or spaces at a line's end are left behind.
      const gone = (ch: string) => (what === 'remove-char' ? ch === id.slice('remove-char:'.length) : !/\s/.test(ch) && !hasLetter(ch));
      const out: string[] = [];
      const chars = [...project.text];
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        if (!gone(ch)) {
          out.push(ch);
          continue;
        }
        const next = chars[i + 1];
        const atStart = !out.length || out[out.length - 1] === '\n';
        if (out[out.length - 1] === ' ' && (next === undefined || next === ' ' || next === '\n')) out.pop();
        else if (atStart && next === ' ') i++;
      }
      setText(out.join(''));
      return say('Taken out of the text. Ctrl+Z undoes it.');
    }
    case 'panel-default':
      update({
        panelWidth: defaultProject.panelWidth,
        panelHeight: defaultProject.panelHeight,
        margins: defaultProject.margins,
        border: defaultProject.border,
      });
      requestAnimationFrame(fitPanel);
      return say('Panel, border and margins returned to the starting sizes. Ctrl+Z undoes it.');
    case 'bed-standard':
    case 'bed-extended': {
      const bed = what === 'bed-standard' ? BED : BED_EXTENDED;
      const change = shrinkDesignToBed(project, bed);
      if (!change) return;
      update(change);
      requestAnimationFrame(fitPanel);
      return say(`Everything shrunk to fit the ${what === 'bed-standard' ? '' : 'extended '}bed: panel ${change.panelWidth} × ${change.panelHeight} mm, cap height ${change.capHeight} mm. Ctrl+Z undoes it.`);
    }
    case 'reload-picture':
      return $('ref-file').click();
    case 'remove-picture':
      scaling = null;
      update({ refImage: null });
      return say('Reference picture removed. Ctrl+Z puts it back.');
    case 'enter-stock':
      return goToSetting(mc('stockThickness'));
    case 'go-bit-depth':
      return goToSetting(mc('toolCutDepth'));
    case 'go-bit-angle':
      return goToSetting(mc('toolAngle'));
    case 'go-border':
      return goToSetting(project.border.style === 'incised' ? $('b-width') : $('border-style').querySelector<HTMLElement>('button.on') ?? $('border-style'));
    case 'cap-height': {
      const change = resizeLettering(layoutPanel(store, project), n);
      if (!change) return;
      update(change);
      return say(`Letters made smaller, everything in step: cap height ${n} mm. Ctrl+Z undoes it.`);
    }
    case 'go-machine':
      return setStage('machine');
    case 'refresh-app':
      return void refreshApp();
    case 'word-stops-off':
      update({ wordStops: { ...project.wordStops, on: false } });
      return say('Word stops turned off. Ctrl+Z undoes it.');
    case 'all-passes':
      update({ machine: { ...machine, passes: { hairline: true, datum: true, slit: true } } });
      return say('Every pass will be run. Ctrl+Z undoes it.');
  }
}

/** Every fix the problems list offers now, once each (for Ctrl+K). */
function currentFixes(): Fix[] {
  const seen = new Map<string, Fix>();
  for (const q of problems) for (const f of q.fixes) if (!seen.has(f.id)) seen.set(f.id, f);
  return [...seen.values()];
}

// ---------------------------------------------------------------- "More" folds

function pathGet(o: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), o);
}

/** Each "More" fold says how many of its settings differ from the starting values, so nothing hidden is a surprise. */
function syncMore() {
  for (const d of document.querySelectorAll<HTMLDetailsElement>('details.more')) {
    const keys = (d.dataset.keys ?? '').split(/\s+/).filter(Boolean);
    const n = keys.filter((k) => stableJson(pathGet(project, k) ?? null) !== stableJson(pathGet(defaultProject, k) ?? null)).length;
    const el = d.querySelector('summary .changed')!;
    el.textContent = n ? `${n} changed from the starting values` : '';
  }
}

function stableJson(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b))) : val,
  );
}

// ---------------------------------------------------------------- project files

function showFileName() {
  const el = $('file-name');
  if (!file) {
    el.textContent = 'not saved to a file yet';
    el.classList.remove('changed');
    return;
  }
  const changed = file.saved !== project;
  el.textContent = `${file.name}${changed ? ' · changed since saved' : ''}`;
  el.classList.toggle('changed', changed);
}

function setFile(f: { name: string; handle: FileHandle | null; saved: Project } | null) {
  file = f;
  writeJson(FILE_KEY, f ? { name: f.name, saved: stableJson(f.saved) } : null);
  showFileName();
}

/** After a reload: the file's name, and whether the job is still as it was saved. */
function restoreFile() {
  const f = readJson<{ name: string; saved: string }>(FILE_KEY);
  file = f ? { name: f.name, handle: null, saved: f.saved === stableJson(project) ? project : null } : null;
  showFileName();
}

function newProject() {
  if (!confirm('Clear the inscription and settings and start again with OAK? The alphabet’s kerning is kept. (Undo brings it back.)')) return;
  selected = null;
  selectedLine = null;
  const { kerning, groupKerning, groups, evenUp } = project; // the alphabet's, kept
  update({ ...structuredClone(defaultProject), kerning, groupKerning, groups, evenUp });
  setFile(null);
  fitPanel();
}

async function saveProjectFile(asNew: boolean) {
  if (!store) return;
  const p = project;
  const text = async () => {
    const blob = p.refImage ? await loadImage() : null;
    return projectFileText(p, alphabetName, blob ? await blobToDataUrl(blob) : null);
  };
  const res = await saveFile(text, {
    ...PROJECT_FILE,
    suggestedName: file?.name ?? fileNameFor(p),
    handle: asNew ? null : (file?.handle ?? null),
  });
  if (!res) return;
  setFile({ name: res.name, handle: res.handle, saved: p });
  say(res.handle ? `Saved to ${res.name}.` : `Saved as ${res.name}, in the Downloads folder.`);
}

async function openProjectFile() {
  const chosen = await chooseFile($<HTMLInputElement>('open-file'), PROJECT_FILE);
  if (chosen) await openFromFile(chosen.file, chosen.handle);
}

async function openFromFile(f: File, handle: FileHandle | null) {
  let opened;
  try {
    opened = readProjectFile(await f.text());
  } catch (e) {
    console.error(e);
    alert(e instanceof PlainError ? e.message : 'That file could not be opened: it may be damaged, or not a lettering project.');
    return;
  }
  let next = opened.project;
  // Pair and group kerning, the groups and even-up belong to the alphabet and are
  // shared by every job, so the carver chooses which to keep (BRIEF.md, Decisions).
  const diff = alphabetDifferences(next, project);
  if (diff) {
    const choice = await ask(
      'Which spacing?',
      `${f.name} was saved with spacing that differs from what the alphabet has now (${diff} difference${diff > 1 ? 's' : ''} in pair or group kerning, kerning groups or even-up settings). These are shared by every job set in this alphabet.`,
      [
        { value: 'file', label: 'Use the project’s spacing, as it was saved', hint: 'It becomes the alphabet’s spacing for every job from now on.' },
        { value: 'alphabet', label: 'Keep the alphabet’s spacing as it is now', hint: 'The job may space a little differently from when it was saved.' },
      ],
    );
    if (!choice) return;
    if (choice === 'alphabet') {
      const { kerning, groupKerning, groups, evenUp } = project;
      next = { ...next, kerning, groupKerning, groups, evenUp };
    }
  }
  // The reference picture travels inside the file.
  if (opened.picture) {
    const blob = await dataUrlToBlob(opened.picture);
    await saveImage(blob);
    if (refUrl) URL.revokeObjectURL(refUrl);
    refUrl = URL.createObjectURL(blob);
  } else if (next.refImage) next = { ...next, refImage: null };
  if (cam) closeCam();
  selected = null;
  selectedLine = null;
  suggest = null;
  tweaks = {};
  previewSuggest = false;
  showSuggestions();
  update(next); // one step to undo
  setFile({ name: f.name, handle, saved: project });
  requestAnimationFrame(fitPanel);
  const other = opened.alphabet && opened.alphabet !== alphabetName ? ` It was set in ${opened.alphabet}; it is shown in ${alphabetName}.` : '';
  say(`Opened ${f.name}.${other}`);
}

/** A question with a few clear answers. Resolves to the chosen value, or null if closed. */
function ask(title: string, text: string, options: { value: string; label: string; hint?: string }[]): Promise<string | null> {
  const d = $<HTMLDialogElement>('ask');
  $('ask-title').textContent = title;
  $('ask-text').textContent = text;
  const box = d.querySelector<HTMLElement>('.ask-buttons')!;
  box.innerHTML =
    options
      .map((o, i) => `<button value="${esc(o.value)}" class="${i === 0 ? 'primary' : ''}">${esc(o.label)}${o.hint ? `<small>${esc(o.hint)}</small>` : ''}</button>`)
      .join('') + '<button value="" class="quiet">Cancel</button>';
  return new Promise((resolve) => {
    box.onclick = (e) => {
      const b = (e.target as Element).closest('button');
      if (!b) return;
      resolve(b.value || null);
      d.close();
    };
    d.onclose = () => resolve(null);
    d.showModal();
  });
}

// ---------------------------------------------------------------- bench sheet

function makeSheet(wait = false) {
  if (!store) return null;
  const p = project;
  // Printing can't wait for the worker: any linked letters still to come are worked out on the spot.
  const l = layoutPanel(store, p, false, wait ? 'now' : undefined);
  if (l.shapesPending || l.datumPending) {
    say('Still working out the linked letters: the bench sheet opens in a moment, when they are ready.');
    window.setTimeout(() => {
      if (!layout?.shapesPending) showSheet();
    }, 1500);
    return null;
  }
  const passes = buildPasses(l, p.machine);
  // Stroke numbers come from the valley slit, even when it is not set to run.
  const strokes =
    passes.find((q) => q.name === 'slit') ?? buildPasses(l, { ...p.machine, passes: { hairline: false, datum: false, slit: true } })[0] ?? null;
  const checks = checkPasses(l, passes, p.machine, bedFit(p.panelWidth, p.panelHeight));
  return benchSheet({ project: p, layout: l, strokes, passes, checks, alphabet: alphabetName, fileName: file?.name ?? null, date: new Date() });
}

function showSheet() {
  const sh = makeSheet();
  if (!sh) return;
  closeMenus();
  $('sheet-paper').innerHTML = sh.html;
  $('sheet-note').textContent = `A4 ${sh.orientation}, drawn ${scaleName(sh.scale)}. Print at 100% (not “fit to page”) so the scale is true.`;
  $<HTMLDialogElement>('sheet-view').showModal();
}

/** Put the bench sheet where printing picks it up (it is the only thing printed). */
function fillPrint() {
  const sh = makeSheet(true);
  if (!sh) return;
  $('print-root').innerHTML = sh.html;
  let style = document.getElementById('page-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'page-style';
    document.head.append(style);
  }
  style.textContent = `@page { size: A4 ${sh.orientation}; margin: 12mm; }`;
}

function printSheet() {
  fillPrint();
  window.print();
}

// ---------------------------------------------------------------- search (Ctrl+K) and the key list

function showPalette() {
  closeMenus();
  openPalette($<HTMLDialogElement>('palette'), commands);
}

/** The heading a setting sits under, for telling apart settings with the same name. */
function headingFor(el: Element): string {
  let node: Element | null = el;
  while (node && node.parentElement && !node.parentElement.matches('section, details, .stage-panel')) node = node.parentElement;
  for (let sib = node?.previousElementSibling; sib; sib = sib.previousElementSibling) {
    if (sib.matches('h2, h3')) return sib.textContent!.trim();
  }
  return node?.parentElement?.querySelector('h2')?.textContent?.trim() ?? '';
}

function commands(): Command[] {
  const list: Command[] = [];
  const add = (label: string, run: () => void, hint?: string, words?: string) => list.push({ label, run, hint, words });
  STAGES.forEach((s, i) => add(`Go to ${STAGE_NAMES[s]}`, () => setStage(s), `key ${i + 1}`, 'stage tab'));
  PRESET_KEYS.forEach((k, i) =>
    add(
      `View: ${PRESET_TITLES[k]}`,
      () => {
        if (stage === '3d') setStage(lastFlatStage);
        applyPreset(k);
      },
      `Shift+${i + 1}`,
      'preset',
    ),
  );
  for (const layer of LAYERS) {
    const cb = $<HTMLInputElement>(`show-${layer}`);
    add(
      `${cb.checked ? 'Hide' : 'Show'}: ${cb.closest('label')!.textContent!.trim()}`,
      () => {
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change'));
      },
      'Layers',
      'layer draw',
    );
  }
  add('Undo', undo, 'Ctrl+Z');
  add('Redo', redo, 'Ctrl+Shift+Z');
  add('New: start again with OAK', newProject, 'File', 'clear reset');
  add('Open project…', () => void openProjectFile(), 'Ctrl+O', 'file load');
  add('Save project', () => void saveProjectFile(false), 'Ctrl+S', 'file');
  add('Save project as…', () => void saveProjectFile(true), 'Ctrl+Shift+S', 'file copy');
  add('Bench sheet, to print', showSheet, 'Ctrl+P', 'print cutting order stroke numbers');
  add('Refresh the app (the newest version)', () => void refreshApp(), 'F5', 'reload update out of date offline copy');
  add(measuring ? 'Stop measuring' : 'Measure between two points', () => setMeasuring(!measuring), 'M', 'ruler distance');
  add(`${inspectOpen ? 'Hide' : 'Show'} the inspection panel`, () => setInspect(!inspectOpen), 'I', 'overview balance');
  add(`Turn snapping ${snapping ? 'off' : 'on'}`, () => setSnapping(!snapping), 'S');
  add('True size', () => view.frame(project.panelWidth, project.panelHeight, pxPerMm()), 'Shift+Z', 'full size zoom view');
  add('Zoom to panel', fitPanel, 'Z', 'whole panel screen view');
  add('Fit the panel to the lettering', fitPanelToLettering, 'Shift+F', 'size board');
  add('Fit the lettering to the panel', () => fitLettering('both'), 'F', 'scale size fill');
  add(
    '3D: sharper detail for the part in view',
    () => {
      if (stage !== '3d') setStage('3d');
      else sharpen3d();
    },
    'D, in 3D',
    'detail close look zoom fine',
  );
  add("Spread the selected line's letters", () => spreadLine(1, 0.1), ']', 'letter spacing wider line open');
  add("Close up the selected line's letters", () => spreadLine(-1, 0.1), '[', 'letter spacing tighter line narrower');
  add(
    "Reset the selected line's own spacing",
    () => {
      const line = lineAtIndex(selectedLine);
      if (!line) return say('Select a line first: click it, or its number in the margin.');
      setLineExtra(line.index, { letter: 0, word: 0 });
    },
    'Line',
    'letter word spacing clear',
  );
  // Whatever the problems list offers now, by name.
  for (const f of currentFixes()) add(`Put right: ${f.label}`, () => runFix(f.id), 'Problems', 'fix problem warning');
  for (const q of problems) if (q.key && q.spot) add(`Show on the panel: ${q.text}`, () => showProblem(q), 'P', 'problem where mark find collision touch letters');
  add('Show the next problem on the panel', () => stepProblem(1), 'P', 'problem where mark find collision touch letters');
  add('Link the selected gap’s letters into one shape, or unlink them', () => toggleLink(selectedGap()), 'L', 'link join joined linked unlink ligature serif feet');
  add(
    'Unlink every linked pair',
    () => {
      const n = Object.keys(project.links).length;
      if (!n) return say('Nothing is linked.');
      update({ links: {} });
      say(`${n} link${n > 1 ? 's' : ''} undone: every letter is its own again. Ctrl+Z undoes it.`);
    },
    'Space',
    'link unlink join joined linked',
  );
  add('Fit the lettering to the panel across its width', () => fitLettering('width'), 'Panel', 'scale size fill');
  add('Fit the lettering to the panel up its height', () => fitLettering('height'), 'Panel', 'scale size fill');
  add('Re-flow all lines', () => $('reflow').click(), 'Write', 'lines auto');
  add(
    'Suggest spacing (even up)',
    () => {
      setStage('space');
      $('eu-suggest').click();
    },
    'Space',
    'kerning',
  );
  add(
    'Preview the passes',
    () => {
      setStage('machine');
      openCam();
    },
    'Machine',
    'G-code toolpath save',
  );
  add('Keyboard shortcuts', showKeys, '?', 'help keys');
  if (installApp) add('Install the app on this computer', () => void installApp?.(), 'App', 'offline window');

  // Every setting, by name: going to it opens its stage (and its "More" fold).
  const found: { name: string; el: HTMLElement; where: string; heading: string }[] = [];
  for (const label of $('side').querySelectorAll<HTMLLabelElement>('label')) {
    if (label.closest('[hidden]:not(.stage-panel)')) continue; // doesn't apply now (a border setting for another style)
    const input = label.htmlFor ? document.getElementById(label.htmlFor) : label.querySelector('input, textarea');
    if (!input) continue;
    const c = label.cloneNode(true) as HTMLElement;
    c.querySelectorAll('small, span, i, input').forEach((n) => n.remove());
    const name = (label.dataset.find ?? c.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    const panel = label.closest<HTMLElement>('.stage-panel');
    const s = (panel?.dataset.panel ?? 'write') as Stage;
    found.push({ name, el: input as HTMLElement, where: `${STAGE_NAMES[s]}${label.closest('details.more') ? ' › More' : ''}`, heading: headingFor(label) });
  }
  for (const f of found) {
    const twin = found.filter((g) => g.name === f.name).length > 1;
    add(twin && f.heading ? `${f.name} (${f.heading})` : f.name, () => goToSetting(f.el), f.where, `setting ${f.heading}`);
  }
  return list;
}

/** Open the stage a setting is in, unfold it if need be, and put the cursor in it. */
function goToSetting(el: HTMLElement) {
  const panel = el.closest<HTMLElement>('.stage-panel');
  if (panel) setStage(panel.dataset.panel as Stage);
  const more = el.closest('details');
  if (more) more.open = true;
  el.scrollIntoView({ block: 'center' });
  el.focus();
  const row = el.closest('.slider, label') ?? el;
  row.classList.remove('flash');
  void (row as HTMLElement).offsetWidth; // restart the highlight
  row.classList.add('flash');
}

function showKeys() {
  closeMenus();
  const keyName = /^(Ctrl|Shift|Alt|Tab|Esc|Enter)$/;
  const keys = (k: string) =>
    k
      .split(' ')
      .map((t) => {
        const bare = t.replace(/,$/, '');
        return /^[+/–]$|^or$/.test(t) || (/[a-z]/.test(bare) && !keyName.test(bare)) ? esc(t) : `<kbd>${esc(bare)}</kbd>${t.endsWith(',') ? ',' : ''}`;
      })
      .join(' ');
  $('keys-list').innerHTML = SHORTCUTS.map(
    (g) => `<section><h3>${esc(g.group)}</h3><dl>${g.items.map(([k, v]) => `<dt>${keys(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></section>`,
  ).join('');
  $<HTMLDialogElement>('keys').showModal();
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
    if (raw) return normaliseProject(JSON.parse(raw));
  } catch {
    /* fall through to the default */
  }
  return structuredClone(defaultProject);
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* not remembered */
  }
}

let saveTimer = 0;
function saveProject() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(PROJECT_KEY, JSON.stringify(project));
      // Kerning, groups and even-up settings belong to the alphabet, for every job.
      if (alphabetName) {
        const { kerning, groupKerning, groups, evenUp, kernCap } = project;
        localStorage.setItem(alphaKey(), JSON.stringify({ kerning, groupKerning, groups, evenUp, kernCap }));
      }
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
  // Linked letters' valley lines are worked out by a worker, so the page never waits on them.
  store.ask = askShape;
  store.askDatum = askDatum;
  alphabetName = alphabet.name;
  loadAlphabetSettings();
  syncControls();
  restoreFile();
  $('credit').innerHTML =
    `Stand-in alphabet: <b>${esc(alphabet.name)}</b> by Natanael Gama, ${alphabet.licence} ` +
    `(<a href="./fonts/OFL.txt">licence</a>). Interface type: <b>Inter</b> by Rasmus Andersson, SIL Open Font License 1.1 ` +
    `(<a href="./fonts/Inter-OFL.txt">licence</a>). ${esc(VERSION_TEXT)}.`;
  document.body.dataset.version = APP_VERSION; // for the browser tests
  layout = layoutPanel(store, project);
  if (project.refImage) {
    const blob = await loadImage();
    if (blob) refUrl = URL.createObjectURL(blob);
    syncPanelControls();
  }
  $('loading').hidden = true;
  // Back to the stage last worked in (but not straight into 3D, which takes a moment to build).
  const last = localStorage.getItem(STAGE_KEY) as Stage | null;
  setStage(last && STAGES.includes(last) && last !== '3d' ? last : 'write', true);
  fitPanel();
  draw();
  // Fetch the 3D view's parts while nothing else is happening, so it opens quickly when wanted.
  const idle = (f: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(f, { timeout: 8000 }) : setTimeout(f, 3000));
  // Once fetched they are kept for as long as the page is open, so they stay of its own version.
  setTimeout(() => idle(() => {
    reliefWorkerSource().then((source) => (v3d.worker ??= makeWorker(source)), () => {});
    void import('./view3d').catch((err) => setOutOfDate('the 3D drawing (three.js)', err));
  }), 3000);
}

// Nothing reaches the carver as a raw error message: a plain word in the status
// bar, the details kept for the browser's console. Anything left out of the
// job is named in the problems list, where it is worked out.
const PLAIN = 'Something could not be worked out. The rest of the job carries on: the Problems badge names anything left out.';
window.addEventListener('error', (e) => {
  e.preventDefault();
  say(PLAIN);
});
window.addEventListener('unhandledrejection', (e) => {
  e.preventDefault();
  console.error(e.reason);
  say(PLAIN);
});

start().catch((err) => {
  console.error(err);
  $('loading').textContent = 'Could not load the letters. Check the internet connection and reload the page.';
});
