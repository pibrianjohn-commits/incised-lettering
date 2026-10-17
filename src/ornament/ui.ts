// The Ornament tab (ornament/design/CARD_01_loop.md): open a template from
// the lid add-on, set out its zones, put layers of plain shapes at levels,
// and save the design back in the same format. Separate from the lettering:
// it has its own undo and its own keys, and reads no machine settings.

import { download } from '../files';
import { History } from '../history';
import {
  DEFAULT_ZONES,
  EDGE_NAMES,
  EDGES,
  FINISH_NAMES,
  FINISHES,
  PLACE_NAMES,
  ZONE_NAMES,
  designProblems,
  levelReadout,
  mm,
  newId,
  readoutText,
  zoneBoxes,
  zoneRings,
  type Design,
  type Edge,
  type Finish,
  type Layer,
  type Panel,
  type Ring,
  type Shape,
  type ZoneName,
  type Zones,
} from './model';
import { FINISH_COLOURS, designFileName, designSvg, layerRings, openSvg, pathRings, sampleTemplate } from './svgfile';

export interface OrnamentHost {
  say(text: string): void;
  /** Screen pixels to a millimetre at true size (the app's own calibration). */
  pxPerMm(): number;
  /** The undo and redo buttons in the top bar. */
  undoChanged(canUndo: boolean, canRedo: boolean): void;
}

interface State {
  design: Design | null;
  /** A shaped panel: its outline is shown, and nothing else until the outlines card. */
  shaped: { panel: Panel; text: string } | null;
}

type ViewMode = 'layout' | 'tone';

const STORE_KEY = 'incised.ornament';
const VIEW_KEY = 'incised.ornament.view';
const RULER = 24; // px
const PAD = 16; // px round the board

let host: OrnamentHost;
let state: State = { design: null, shaped: null };
let selected: string | null = null;
let viewMode: ViewMode = 'layout';
let zoom: 'true' | 'fit' = 'true';
let message = '';
let open = false;
const history = new History<State>();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clone = (s: State): State => structuredClone(s);

// ---------------------------------------------------------------- changes, undo

/** Record the state before a change; changes in the same group in quick succession are one step. */
function change(mutate: (d: Design) => Design | void, group: string | null = null) {
  if (!state.design) return;
  history.record(clone(state), group);
  const next = mutate(state.design);
  if (next) state.design = next;
  saved();
}

function saved() {
  try {
    if (state.design) localStorage.setItem(STORE_KEY, designSvg(state.design));
    else if (state.shaped) localStorage.setItem(STORE_KEY, state.shaped.text);
    else localStorage.removeItem(STORE_KEY);
  } catch {
    /* not kept: lasts for this visit only */
  }
  host.undoChanged(history.canUndo, history.canRedo);
}

export function ornamentUndo() {
  const prev = history.undo(clone(state));
  if (!prev) return host.say('Nothing to undo in the ornament.');
  restore(prev, 'Undone');
}

export function ornamentRedo() {
  const next = history.redo(clone(state));
  if (!next) return host.say('Nothing to redo in the ornament.');
  restore(next, 'Redone');
}

function restore(s: State, done: string) {
  state = s;
  if (selected && !state.design?.layers.some((l) => l.id === selected)) selected = null;
  saved();
  render();
  host.say(`${done}.`);
}

export function ornamentCanUndo() {
  return { undo: history.canUndo, redo: history.canRedo };
}

// ---------------------------------------------------------------- opening and saving

function openText(text: string, from: string) {
  const o = openSvg(text);
  if (o.kind === 'error') {
    message = o.message;
    renderSide();
    host.say(o.message);
    return;
  }
  history.record(clone(state));
  selected = null;
  if (o.kind === 'shaped') {
    state = { design: null, shaped: { panel: o.panel, text } };
    message = o.message;
  } else {
    state = { design: o.design, shaped: null };
    message = '';
  }
  zoom = 'true';
  saved();
  render();
  const what = o.kind === 'shaped' ? 'shaped panel' : o.kind === 'design' && !o.isTemplate ? 'design' : 'template';
  host.say(`Opened the ${what} ${from}. Ctrl+Z goes back.`);
}

export function openOrnamentFile() {
  $<HTMLInputElement>('orn-file').click();
}

async function fileChosen() {
  const input = $<HTMLInputElement>('orn-file');
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    openText(await file.text(), `“${file.name}”`);
  } catch {
    host.say('That file could not be read.');
  }
}

function openSample() {
  openText(sampleTemplate(), 'sample (lid field, 204 × 96, 6 thick)');
}

export function saveDesign() {
  const d = state.design;
  if (!d) return host.say(state.shaped ? 'A shaped panel can’t be saved as a design yet: shaped panels come with the outlines card.' : 'Open a template first.');
  download(designSvg(d), designFileName(d), 'image/svg+xml');
  host.say(`Saved “${designFileName(d)}” to the Downloads folder, for the lid add-on.`);
}

// ---------------------------------------------------------------- layers

const ZONE_ORDER: ZoneName[] = ['border', 'centre', 'fields', 'left', 'right'];

function shapeValue(s: Shape, z: Zones): string {
  if (s.kind === 'zone') return `zone:${z.mirror && (s.zone === 'left' || s.zone === 'right') ? 'fields' : s.zone}`;
  return s.kind;
}

function shapeOptions(s: Shape, z: Zones): string {
  const zones = ZONE_ORDER.filter((n) => !(z.mirror && (n === 'left' || n === 'right')));
  const opts: [string, string][] = [
    ...zones.map((n): [string, string] => [`zone:${n}`, `${ZONE_NAMES[n]} zone`]),
    ['rect', 'Rectangle, placed'],
    ['ellipse', 'Ellipse, placed'],
  ];
  if (s.kind === 'path') opts.push(['path', 'Drawn elsewhere (kept as it came)']);
  const v = shapeValue(s, z);
  return opts.map(([val, label]) => `<option value="${val}"${val === v ? ' selected' : ''}>${esc(label)}</option>`).join('');
}

/** A new placed shape's box: where the shape it replaces was, or in the middle of the left field. */
function startBox(d: Design, from: Shape | null) {
  if (from && (from.kind === 'rect' || from.kind === 'ellipse')) return { x: from.x, y: from.y, w: from.w, h: from.h };
  const b = zoneBoxes(d.panel, d.zones);
  if (from?.kind === 'zone') {
    const z = from.zone === 'border' ? b.borderOuter : from.zone === 'centre' ? b.centre : from.zone === 'right' ? b.right : b.left;
    if (z) return { ...z };
  }
  const f = b.left ?? { x: 0, y: 0, w: d.panel.w / 2, h: d.panel.h };
  const s = Math.max(4, Math.round(Math.min(f.w, f.h) * 0.6));
  return { x: Math.round(f.x + (f.w - s) / 2), y: Math.round(f.y + (f.h - s) / 2), w: s, h: s };
}

function shapeFrom(value: string, d: Design, was: Shape | null): Shape {
  if (value.startsWith('zone:')) return { kind: 'zone', zone: value.slice(5) as ZoneName };
  if (value === 'rect' || value === 'ellipse') return { kind: value, ...startBox(d, was) };
  return was ?? { kind: 'zone', zone: 'border' };
}

const SHAPE_NAMES: Record<string, string> = { 'zone:border': 'Border', 'zone:centre': 'Centre', 'zone:fields': 'Side fields', 'zone:left': 'Left field', 'zone:right': 'Right field', rect: 'Rectangle', ellipse: 'Ellipse' };

function addLayer(value: string) {
  const d = state.design;
  if (!d) return host.say('Open a template first.');
  const shape = shapeFrom(value, d, null);
  const base = SHAPE_NAMES[value] ?? 'Layer';
  let name = base;
  for (let k = 2; d.layers.some((l) => l.name === name); k++) name = `${base} ${k}`;
  // One deeper than the deepest so far, within what the board allows.
  const deepest = d.layers.reduce((m, l) => Math.max(m, l.level), 0);
  const allowed = d.panel.thickness === null ? Infinity : d.panel.thickness - 1;
  const level = Math.max(1, Math.min(deepest + 1, allowed));
  const layer: Layer = { id: newId(), name, shape, level: Number.isFinite(level) ? level : 1, edge: 'square', finish: 'ebony' };
  change((x) => ({ ...x, layers: [...x.layers, layer] }));
  selected = layer.id;
  render();
  host.say(`Added “${name}” at ${mm(layer.level)} below the top. Ctrl+Z takes it away.`);
}

function updateLayer(id: string, patch: Partial<Layer>, group: string | null = null) {
  change((d) => ({ ...d, layers: d.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) }), group);
}

function moveLayer(id: string, by: -1 | 1) {
  const d = state.design;
  if (!d) return;
  const i = d.layers.findIndex((l) => l.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= d.layers.length) return host.say(by < 0 ? 'It is already first (under all the others).' : 'It is already last (over all the others).');
  change((x) => {
    const layers = [...x.layers];
    [layers[i], layers[j]] = [layers[j], layers[i]];
    return { ...x, layers };
  });
  render();
  host.say(by > 0 ? 'Moved later: it wins over the layer before it where they overlap.' : 'Moved earlier: the layer after it now wins where they overlap.');
}

function deleteLayer(id: string) {
  const l = state.design?.layers.find((x) => x.id === id);
  if (!l) return;
  change((d) => ({ ...d, layers: d.layers.filter((x) => x.id !== id) }));
  if (selected === id) selected = null;
  render();
  host.say(`Took out “${l.name}”. Ctrl+Z puts it back.`);
}

function select(id: string | null) {
  selected = id;
  document.querySelectorAll<HTMLElement>('#orn-layers .orn-layer').forEach((li) => li.classList.toggle('sel', li.dataset.id === id));
  draw();
}

// ---------------------------------------------------------------- side panel

function zoneBox(id: keyof Zones, label: string, step: number, title: string) {
  const z = state.design?.zones ?? DEFAULT_ZONES;
  return `<label title="${esc(title)}">${esc(label)} <span><input type="number" id="orn-${id}" data-zone="${id}" min="0" step="${step}" value="${z[id]}" /> mm</span></label>`;
}

function renderSide() {
  const d = state.design;
  const p = d?.panel ?? state.shaped?.panel ?? null;
  const info = p
    ? `<p class="orn-place"><b>${esc(PLACE_NAMES[p.place])}</b> · ${mm(p.w)} × ${mm(p.h)} mm · ${p.thickness !== null ? `${mm(p.thickness)} thick` : 'thickness not given'}</p>`
    : '<p class="hint">Open a template saved by the lid add-on in Blender, or a design saved here. Or try a plain lid field to see how it works.</p>';
  $('orn-template').innerHTML = `${info}${message ? `<p class="orn-msg">${esc(message)}</p>` : ''}`;
  $('orn-zones').hidden = !d;
  $('orn-layer-sec').hidden = !d;
  $<HTMLButtonElement>('orn-save').disabled = !d;
  if (!d) return;
  const z = d.zones;
  $('orn-zone-boxes').innerHTML = `
    <h3>Border</h3>
    <div class="boxes">
      ${zoneBox('edgeDistance', 'Distance from the edge', 0.5, 'How far in from the panel edge the border band starts')}
      ${zoneBox('bandWidth', 'Band width', 0.5, 'How wide the border band is')}
    </div>
    <h3>Centre</h3>
    <div class="row"><span class="name">Shape</span><span class="seg" id="orn-centre">
      <button data-centre="ellipse" class="${z.centreShape === 'ellipse' ? 'on' : ''}">Ellipse</button>
      <button data-centre="rect" class="${z.centreShape === 'rect' ? 'on' : ''}">Rectangle</button>
    </span></div>
    <div class="boxes">
      ${zoneBox('centreWidth', 'Width', 0.5, 'Width of the centre zone, centred on the panel')}
      ${zoneBox('centreHeight', 'Height', 0.5, 'Height of the centre zone, centred on the panel')}
    </div>
    <h3>Left and right fields</h3>
    <div class="boxes">${zoneBox('gapToCentre', 'Gap to the centre', 0.5, 'Space between each side field and the centre zone')}</div>
    <div class="toggles"><label><input type="checkbox" id="orn-mirror" ${z.mirror ? 'checked' : ''}/> Left mirrors right</label></div>
    <p class="hint small">The side fields are what is left inside the border either side of the centre. The starting sizes are stand-ins.</p>`;
  renderLayers();
  renderReadout();
}

function renderLayers() {
  const d = state.design;
  if (!d) return;
  const n = d.layers.length;
  $('orn-layers').innerHTML = n
    ? d.layers
        .map(
          (l, i) => `<li class="orn-layer${l.id === selected ? ' sel' : ''}" data-id="${l.id}">
      <div class="orn-lhead">
        <span class="orn-num" title="Order: later layers win where they overlap">${i + 1}</span>
        <input type="text" class="orn-name" data-f="name" value="${esc(l.name)}" aria-label="Layer name" />
        <span class="seg orn-order">
          <button data-act="up" title="Earlier (Alt+↑)" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button data-act="down" title="Later (Alt+↓)" ${i === n - 1 ? 'disabled' : ''}>↓</button>
          <button data-act="del" title="Take this layer out (Delete)">✕</button>
        </span>
      </div>
      <div class="boxes">
        <label>Shape <select data-f="shape">${shapeOptions(l.shape, d.zones)}</select></label>
        <label title="How far below the top of the board, in mm; 0 is the top">Level below the top <span><input type="number" data-f="level" min="0" step="0.5" value="${l.level}" /> mm</span></label>
        <div class="row"><span class="name">Edge</span><span class="seg">${EDGES.map((e) => `<button data-edge="${e}" class="${l.edge === e ? 'on' : ''}" title="${e === 'v' ? 'Sloped wall, from the V-bit' : 'Square wall, from the end mill'}">${EDGE_NAMES[e]}</button>`).join('')}</span></div>
        <label>Finish <span class="orn-fin"><i style="background:${FINISH_COLOURS[l.finish]}"></i><select data-f="finish">${FINISHES.map((f) => `<option value="${f}"${f === l.finish ? ' selected' : ''}>${FINISH_NAMES[f]}</option>`).join('')}</select></span></label>
      </div>
    </li>`,
        )
        .join('')
    : '<li class="hint">No layers yet. Add one: a zone’s outline, or a rectangle or ellipse to place.</li>';
}

function renderReadout() {
  const d = state.design;
  if (!d) return;
  const r = levelReadout(d.layers, d.panel.thickness);
  const problems = designProblems(d);
  $('orn-readout').innerHTML = `<p class="orn-levels ${problems.length ? 'bad' : 'ok'}">${esc(readoutText(r))}</p>${
    problems.length
      ? `<ul class="orn-problems">${problems
          .map(
            (q, i) =>
              `<li><span>${esc(q.text)}</span>${q.fixes.length ? `<span class="orn-fixes">${q.fixes.map((f, k) => `<button data-fix="${i}:${k}">${esc(f.label)}</button>`).join('')}</span>` : ''}</li>`,
          )
          .join('')}</ul>`
      : ''
  }`;
}

/** After a value changes in place: the drawing and the readout, leaving the boxes as they are. */
function refresh() {
  renderReadout();
  draw();
}

function render() {
  renderSide();
  draw();
}

function wireSide() {
  $('orn-open').addEventListener('click', openOrnamentFile);
  $('orn-file').addEventListener('change', () => void fileChosen());
  $('orn-sample').addEventListener('click', openSample);
  $('orn-save').addEventListener('click', saveDesign);
  $('orn-add').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-add]');
    if (b) addLayer(b.dataset.add!);
  });

  const zones = $('orn-zone-boxes');
  zones.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'orn-mirror') return;
    const key = t.dataset.zone as keyof Zones | undefined;
    const v = Number(t.value);
    if (!key || t.value === '' || !Number.isFinite(v) || v < 0) return;
    change((d) => ({ ...d, zones: { ...d.zones, [key]: v } }), `zone:${key}`);
    refresh();
  });
  zones.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id !== 'orn-mirror') return;
    change((d) => ({ ...d, zones: { ...d.zones, mirror: t.checked } }));
    render();
    host.say(t.checked ? 'Left mirrors right: placed shapes have a mirrored twin, and the side fields go together.' : 'Left and right are now set out on their own.');
  });
  zones.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-centre]');
    if (!b) return;
    change((d) => ({ ...d, zones: { ...d.zones, centreShape: b.dataset.centre as Zones['centreShape'] } }));
    render();
  });

  const list = $('orn-layers');
  const layerOf = (el: Element) => (el.closest<HTMLElement>('.orn-layer')?.dataset.id ?? null);
  list.addEventListener('focusin', (e) => {
    const id = layerOf(e.target as Element);
    if (id && id !== selected) select(id);
  });
  list.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const id = layerOf(t);
    if (!id) return;
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    const edge = t.closest<HTMLElement>('[data-edge]')?.dataset.edge as Edge | undefined;
    if (act === 'up' || act === 'down') moveLayer(id, act === 'up' ? -1 : 1);
    else if (act === 'del') deleteLayer(id);
    else if (edge) {
      updateLayer(id, { edge });
      render();
    } else if (id !== selected) select(id);
  });
  list.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    const id = layerOf(t);
    if (!id) return;
    if (t.dataset.f === 'name') {
      updateLayer(id, { name: t.value }, `name:${id}`);
      refresh();
    } else if (t.dataset.f === 'level') {
      const v = Number(t.value);
      if (t.value === '' || !Number.isFinite(v) || v < 0) return;
      updateLayer(id, { level: v }, `level:${id}`);
      refresh();
    }
  });
  list.addEventListener('change', (e) => {
    const t = e.target as HTMLSelectElement;
    const id = layerOf(t);
    const d = state.design;
    if (!id || !d) return;
    const l = d.layers.find((x) => x.id === id)!;
    if (t.dataset.f === 'shape') updateLayer(id, { shape: shapeFrom(t.value, d, l.shape) });
    else if (t.dataset.f === 'finish') updateLayer(id, { finish: t.value as Finish });
    else if (t.dataset.f === 'level') {
      // A box left empty or wrong goes back to the level the layer has (only that box: a click elsewhere still lands).
      (t as unknown as HTMLInputElement).value = String(l.level);
      return refresh();
    } else return;
    render();
  });

  $('orn-readout').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-fix]');
    const d = state.design;
    if (!b || !d) return;
    const [i, k] = b.dataset.fix!.split(':').map(Number);
    const fix = designProblems(d)[i]?.fixes[k];
    if (!fix) return;
    change((x) => fix.apply(x));
    render();
    host.say(`${fix.label}: done. Ctrl+Z goes back.`);
  });

  $('orn-viewmode').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-view]');
    if (b) setViewMode(b.dataset.view as ViewMode);
  });
  $('orn-zoom').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-zoom]');
    if (b) setZoom(b.dataset.zoom as 'true' | 'fit');
  });
}

function setViewMode(m: ViewMode) {
  viewMode = m;
  try {
    localStorage.setItem(VIEW_KEY, m);
  } catch {
    /* not remembered */
  }
  draw();
}

function setZoom(z: 'true' | 'fit') {
  zoom = z;
  draw();
  host.say(z === 'true' ? 'True size: a millimetre on the ruler is a millimetre on the screen (once the screen scale is checked under Panel › More).' : 'The whole panel, to fit the window.');
}

// ---------------------------------------------------------------- the drawing

const ringsPath = (rings: Ring[], s: number) => rings.map((r) => `M${r.map((p) => `${(p[0] * s).toFixed(2)},${(p[1] * s).toFixed(2)}`).join('L')}Z`).join('');

/** Deeper is darker: the top a pale board, the deepest allowed near black. */
function tone(level: number, deepest: number) {
  const t = deepest > 0 ? Math.min(1, level / deepest) : 0;
  const l = Math.round(93 - t * 75);
  return `hsl(36 6% ${l}%)`;
}

function scale(p: { w: number; h: number }): number {
  const box = $('orn-view').getBoundingClientRect();
  const fit = Math.max(0.5, Math.min((box.width - RULER - 2 * PAD) / p.w, (box.height - RULER - 2 * PAD) / p.h));
  return zoom === 'true' ? host.pxPerMm() : fit;
}

function rulers(p: { w: number; h: number }, s: number): string {
  const out: string[] = [];
  // Ticks at least 3 px apart, numbers at least 36 px apart, at whole millimetres.
  const tick = [1, 5, 10, 50, 100, 500].find((t) => t * s >= 3) ?? 1000;
  const label = [10, 20, 50, 100, 200, 500, 1000].find((t) => t * s >= 36 && t % tick === 0) ?? 2000;
  const along = (len: number, horiz: boolean) => {
    for (let k = 0; k * tick <= len + 1e-9; k++) {
      const v = k * tick;
      const t = v % label === 0 ? 10 : v % (tick * 5) === 0 || v % 10 === 0 ? 6 : 3;
      const at = RULER + PAD + v * s;
      if (horiz) out.push(`<line x1="${at}" y1="${RULER}" x2="${at}" y2="${RULER - t}"/>`);
      else out.push(`<line x1="${RULER}" y1="${at}" x2="${RULER - t}" y2="${at}"/>`);
      if (v % label === 0)
        out.push(horiz ? `<text x="${at + 2}" y="${RULER - 11}">${v}</text>` : `<text x="${RULER - 11}" y="${at - 2}" transform="rotate(-90 ${RULER - 11} ${at - 2})">${v}</text>`);
    }
  };
  along(p.w, true);
  along(p.h, false);
  return `<g class="orn-ruler"><rect x="0" y="0" width="100%" height="${RULER}"/><rect x="0" y="0" width="${RULER}" height="100%"/>${out.join('')}<text class="orn-unit" x="4" y="15">mm</text></g>`;
}

function draw() {
  if (!open) return;
  const d = state.design;
  const p = d?.panel ?? state.shaped?.panel ?? null;
  const svg = $<HTMLElement>('orn-canvas');
  $('orn-empty').hidden = !!p;
  document.querySelectorAll<HTMLElement>('#orn-viewmode [data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === viewMode));
  document.querySelectorAll<HTMLElement>('#orn-zoom [data-zoom]').forEach((b) => b.classList.toggle('on', b.dataset.zoom === zoom));
  $('orn-viewmode').hidden = !d;
  if (!p) {
    svg.innerHTML = '';
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    $('orn-legend').innerHTML = '';
    return;
  }
  const s = scale(p);
  const W = RULER + 2 * PAD + p.w * s;
  const H = RULER + 2 * PAD + p.h * s;
  svg.setAttribute('width', String(Math.ceil(W)));
  svg.setAttribute('height', String(Math.ceil(H)));
  svg.setAttribute('viewBox', `0 0 ${Math.ceil(W)} ${Math.ceil(H)}`);
  const parts: string[] = [];
  parts.push(`<g transform="translate(${RULER + PAD} ${RULER + PAD})">`);
  const outline = pathRings(p.outline).rings;
  parts.push(`<path class="orn-board" d="${ringsPath(outline, s)}" fill-rule="evenodd"/>`);
  if (d) {
    const r = levelReadout(d.layers, d.panel.thickness);
    const deepest = r.allowed ?? Math.max(1, r.deepest);
    const bad = new Set(designProblems(d).flatMap((q) => q.layers));
    for (const l of d.layers) {
      const { rings, twin } = layerRings(d, l);
      const fill = viewMode === 'tone' ? tone(l.level, deepest) : FINISH_COLOURS[l.finish];
      const cls = `orn-shape${viewMode === 'tone' ? ' tone' : ''}${bad.has(l.id) ? ' bad' : ''}`;
      const title = `<title>${esc(l.name)}: ${mm(l.level)} below the top, ${EDGE_NAMES[l.edge].toLowerCase()} edge, ${FINISH_NAMES[l.finish].toLowerCase()}</title>`;
      if (rings.length) parts.push(`<path class="${cls}" data-id="${l.id}" d="${ringsPath(rings, s)}" fill="${fill}" fill-rule="evenodd">${title}</path>`);
      if (twin.length) parts.push(`<path class="${cls} twin" data-id="${l.id}" d="${ringsPath(twin, s)}" fill="${fill}" fill-rule="evenodd">${title}</path>`);
    }
    // The zones, drawn but never cut.
    const zl = (['border', 'centre', 'left', 'right'] as const).flatMap((z) => (z === 'right' && d.zones.mirror ? [] : zoneRings(d.panel, d.zones, z)));
    parts.push(`<path class="orn-zone" d="${ringsPath(zl, s)}"/>`);
    const sel = d.layers.find((l) => l.id === selected);
    if (sel) {
      const { rings, twin } = layerRings(d, sel);
      parts.push(`<path class="orn-sel" d="${ringsPath([...rings, ...twin], s)}"/>`);
      if (sel.shape.kind === 'rect' || sel.shape.kind === 'ellipse') {
        const b = sel.shape;
        parts.push(`<rect class="orn-box" x="${b.x * s}" y="${b.y * s}" width="${b.w * s}" height="${b.h * s}"/>`);
        for (const [hx, hy] of HANDLES) {
          parts.push(`<rect class="orn-handle" data-handle="${hx},${hy}" x="${(b.x + (b.w * (hx + 1)) / 2) * s - 5}" y="${(b.y + (b.h * (hy + 1)) / 2) * s - 5}" width="10" height="10"/>`);
        }
      }
    }
    $('orn-legend').innerHTML =
      viewMode === 'tone'
        ? [...new Set([0, ...d.layers.map((l) => l.level)])]
            .sort((a, b) => a - b)
            .map((v) => `<span><i style="background:${tone(v, deepest)}"></i>${v === 0 ? 'top' : mm(v)}</span>`)
            .join('')
        : '';
  } else $('orn-legend').innerHTML = '';
  parts.push('</g>');
  const name = `${PLACE_NAMES[p.place]} · ${mm(p.w)} × ${mm(p.h)} mm · ${p.thickness !== null ? `${mm(p.thickness)} thick` : 'thickness not given'}`;
  parts.push(rulers(p, s));
  svg.innerHTML = parts.join('');
  $('orn-title').textContent = name;
  $('orn-shaped').hidden = !state.shaped;
  $('orn-shaped').textContent = state.shaped ? message : '';
}

// ---------------------------------------------------------------- pointer: select, move, size

/** Handles round a placed shape's box, by which side they pull: -1, 0 or 1 across and down. */
const HANDLES: [number, number][] = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

const round = (v: number) => Math.round(v * 10) / 10;

function toMm(e: PointerEvent, s: number) {
  const r = $('orn-canvas').getBoundingClientRect();
  return { x: (e.clientX - r.left - RULER - PAD) / s, y: (e.clientY - r.top - RULER - PAD) / s };
}

function wireCanvas() {
  const svg = $('orn-canvas');
  svg.addEventListener('pointerdown', (e) => {
    const d = state.design;
    if (!d || e.button !== 0) return;
    const t = e.target as Element;
    const handle = t.closest<SVGElement>('[data-handle]')?.dataset.handle;
    const hit = t.closest<SVGElement>('[data-id]');
    const id = handle ? selected : (hit?.dataset.id ?? null);
    if (!id) return select(null);
    if (id !== selected) {
      select(id);
      document.querySelector(`#orn-layers [data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
    }
    const l = d.layers.find((x) => x.id === id);
    if (!l || (l.shape.kind !== 'rect' && l.shape.kind !== 'ellipse')) return;
    const start = { ...l.shape };
    const s = scale(d.panel);
    const from = toMm(e, s);
    // Dragging the mirrored twin moves the shape the other way across.
    const flip = !handle && hit?.classList.contains('twin') ? -1 : 1;
    const [hx, hy] = handle ? handle.split(',').map(Number) : [0, 0];
    let moved = false;
    const before = clone(state);
    svg.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const at = toMm(ev, s);
      const dx = at.x - from.x;
      const dy = at.y - from.y;
      if (!moved && Math.hypot(dx * s, dy * s) < 3) return;
      moved = true;
      let [x0, y0, x1, y1] = [start.x, start.y, start.x + start.w, start.y + start.h];
      if (!handle) {
        x0 += dx * flip;
        x1 += dx * flip;
        y0 += dy;
        y1 += dy;
      } else {
        // At least 1 mm across and down, whichever way it is pulled.
        if (hx < 0) x0 = Math.min(x0 + dx, x1 - 1);
        if (hx > 0) x1 = Math.max(x1 + dx, x0 + 1);
        if (hy < 0) y0 = Math.min(y0 + dy, y1 - 1);
        if (hy > 0) y1 = Math.max(y1 + dy, y0 + 1);
      }
      const box = handle ? { x: round(x0), y: round(y0), w: round(x1 - x0), h: round(y1 - y0) } : { x: round(x0), y: round(y0), w: start.w, h: start.h };
      // Not recorded as it goes: the whole drag is one step to undo, recorded when it ends.
      state.design = { ...d, layers: state.design!.layers.map((x) => (x.id === id ? { ...x, shape: { kind: start.kind, ...box } } : x)) };
      draw();
    };
    const onUp = () => {
      svg.removeEventListener('pointermove', onMove);
      svg.removeEventListener('pointerup', onUp);
      svg.removeEventListener('pointercancel', onUp);
      if (!moved) return;
      history.record(before);
      saved();
      renderReadout();
      const b = state.design?.layers.find((x) => x.id === id)?.shape;
      if (b && (b.kind === 'rect' || b.kind === 'ellipse')) host.say(`${l.name}: ${mm(b.w)} × ${mm(b.h)} mm, at ${mm(b.x)}, ${mm(b.y)} from the top-left corner.`);
    };
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', onUp);
  });
  svg.addEventListener('pointermove', (e) => {
    const d = state.design ?? state.shaped;
    const p = state.design?.panel ?? state.shaped?.panel;
    if (!d || !p) return;
    const at = toMm(e, scale(p));
    if (at.x >= 0 && at.y >= 0 && at.x <= p.w && at.y <= p.h) $('orn-cursor').textContent = `${mm(round(at.x))}, ${mm(round(at.y))} mm`;
    else $('orn-cursor').textContent = '';
  });
  new ResizeObserver(() => {
    if (zoom === 'fit') draw();
  }).observe($('orn-view'));
}

// ---------------------------------------------------------------- keys and search

function nudge(dx: number, dy: number) {
  const l = state.design?.layers.find((x) => x.id === selected);
  if (!l || (l.shape.kind !== 'rect' && l.shape.kind !== 'ellipse')) return false;
  const s = l.shape;
  updateLayer(l.id, { shape: { ...s, x: round(s.x + dx), y: round(s.y + dy) } }, `nudge:${l.id}`);
  refresh();
  return true;
}

/** The Ornament tab's own keys. True if the key was used here. */
export function ornamentKey(e: KeyboardEvent, inField: boolean): boolean {
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    if (k === 'z') e.shiftKey ? ornamentRedo() : ornamentUndo();
    else if (k === 'y') ornamentRedo();
    else if (k === 's') saveDesign();
    else if (k === 'o') openOrnamentFile();
    else return false;
    return true;
  }
  if (inField) return false;
  if (e.key === 'Escape' && selected) {
    select(null);
    return true;
  }
  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    if (selected) moveLayer(selected, e.key === 'ArrowUp' ? -1 : 1);
    return true;
  }
  if (e.altKey) return false;
  const step = e.shiftKey ? 1 : 0.1;
  const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (arrows[e.key]) return nudge(...arrows[e.key]);
  if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
    deleteLayer(selected);
    return true;
  }
  if (k === 't' && !e.shiftKey) {
    setViewMode(viewMode === 'tone' ? 'layout' : 'tone');
    return true;
  }
  if (k === 'z') {
    setZoom(e.shiftKey ? 'true' : 'fit');
    return true;
  }
  return false;
}

/** For Ctrl+K: what can be done in the Ornament tab. */
export function ornamentCommands(): { label: string; run: () => void; hint?: string; words?: string }[] {
  return [
    { label: 'Ornament: open a template or design', run: openOrnamentFile, hint: 'Ctrl+O in Ornament', words: 'svg lid blender' },
    { label: 'Ornament: try a sample lid field', run: openSample, words: 'template 204 96' },
    { label: 'Ornament: save design', run: saveDesign, hint: 'Ctrl+S in Ornament', words: 'svg lid blender export' },
    { label: 'Ornament: view in tone (deeper is darker)', run: () => setViewMode('tone'), hint: 'T', words: 'levels depth' },
    { label: 'Ornament: view the layout in its finishes', run: () => setViewMode('layout'), hint: 'T', words: 'gold ebony' },
    { label: 'Ornament: true size', run: () => setZoom('true'), hint: 'Shift+Z' },
    { label: 'Ornament: the whole panel', run: () => setZoom('fit'), hint: 'Z' },
    ...(['zone:border', 'zone:centre', 'zone:fields', 'rect', 'ellipse'] as const).map((v) => ({ label: `Ornament: add a layer, ${SHAPE_NAMES[v].toLowerCase()}`, run: () => addLayer(v), words: 'layer shape' })),
  ];
}

// ---------------------------------------------------------------- the tab

export function showOrnament() {
  open = true;
  $('orn').hidden = false;
  render();
  host.undoChanged(history.canUndo, history.canRedo);
}

export function hideOrnament() {
  open = false;
  $('orn').hidden = true;
}

export function initOrnament(h: OrnamentHost) {
  host = h;
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === 'tone' || v === 'layout') viewMode = v;
    const kept = localStorage.getItem(STORE_KEY);
    if (kept) {
      const o = openSvg(kept);
      if (o.kind === 'design') state = { design: o.design, shaped: null };
      else if (o.kind === 'shaped') {
        state = { design: null, shaped: { panel: o.panel, text: kept } };
        message = o.message;
      }
    }
  } catch {
    /* start empty */
  }
  wireSide();
  wireCanvas();
}
