// The whole lid (ornament/design/CARD_02_lid_layout.md): the five templates
// opened together, laid out as the lid opened out flat, and remembered.
// Read without the browser, so the unit tests use exactly what the page does.

import { PLACES, PLACE_NAMES, mm, type Design, type Panel, type Place, type Pt, type Ring } from './model';
import { designFileName, designSvg, openSvg, parseXml, pathRings } from './svgfile';

/** One place on the lid: a design to work on, or a shaped panel shown by its outline only. */
export interface Slot {
  design: Design | null;
  shaped: { panel: Panel; text: string } | null;
}

export interface Lid {
  places: Partial<Record<Place, Slot>>;
  /** The place being worked on. */
  current: Place;
  /** All five, laid out together; otherwise one template on its own. */
  whole: boolean;
}

export const EMPTY_LID: Lid = { places: {}, current: 'field', whole: false };

export const slotPanel = (s: Slot | undefined): Panel | null => s?.design?.panel ?? s?.shaped?.panel ?? null;

/** Each place's name in plain words, small: "the front hip". */
export const placeWord = (p: Place) => `the ${PLACE_NAMES[p].toLowerCase()}`;

// ---------------------------------------------------------------- opening the five

/** Clear of the field edge, all round. */
export const HIP_GAP = 10;

export type LidOpened = { kind: 'lid'; lid: Lid } | { kind: 'error'; message: string };

const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** A file's place as the file itself says, or null if it doesn't. */
function givenPlace(text: string): Place | null {
  const p = parseXml(text)?.attrs['data-place'];
  return (PLACES as readonly string[]).includes(p ?? '') ? (p as Place) : null;
}

/**
 * The five files from the lid add-on, picked together: field, hip-front,
 * hip-right, hip-back and hip-left, as templates or saved designs. If any is
 * missing, doubled or can't be read, it says which and opens nothing.
 */
export function openLid(files: { name: string; text: string }[]): LidOpened {
  const places: Partial<Record<Place, Slot>> = {};
  const from: Partial<Record<Place, string[]>> = {};
  const bad: string[] = [];
  for (const f of files) {
    const o = openSvg(f.text);
    if (o.kind === 'error') {
      bad.push(`“${f.name}”: ${o.message}`);
      continue;
    }
    const place = givenPlace(f.text);
    if (!place) {
      bad.push(`“${f.name}” doesn’t say which part of the lid it is (it has no data-place), so it isn’t one of the lid add-on’s five.`);
      continue;
    }
    (from[place] ??= []).push(f.name);
    places[place] = o.kind === 'design' ? { design: o.design, shaped: null } : { design: null, shaped: { panel: o.panel, text: f.text } };
  }
  const msgs: string[] = [];
  const doubled = PLACES.filter((p) => (from[p]?.length ?? 0) > 1);
  for (const p of doubled) msgs.push(`${from[p]!.length === 2 ? 'Two' : 'Several'} files are ${placeWord(p)}: ${list(from[p]!.map((n) => `“${n}”`))}.`);
  const missing = PLACES.filter((p) => !from[p]);
  if (missing.length && !bad.length) msgs.push(`${missing.length === 5 ? 'None of the five lid files was picked.' : `Missing: ${list(missing.map(placeWord))}.`}`);
  msgs.push(...bad);
  if (msgs.length) return { kind: 'error', message: `${msgs.join(' ')} Pick all five lid files together (field, hip-front, hip-right, hip-back, hip-left); nothing was opened.` };
  return { kind: 'lid', lid: { places, current: 'field', whole: true } };
}

// ---------------------------------------------------------------- laying it out

/** Place mm to lid mm: X = a·x + c·y + e, Y = b·x + d·y + f (as an SVG matrix). */
export type Affine = [number, number, number, number, number, number];
export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

export const apply = (m: Affine, p: Pt): Pt => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];

/** Lid mm back to place mm. */
export function invert(m: Affine): Affine {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** A hip's top edge (y = 0, the edge against the field): from where to where across. */
export function topEdge(p: Panel): { from: number; to: number } {
  const pts = pathRings(p.outline).rings.flat();
  if (!pts.length) return { from: 0, to: p.w };
  const top = Math.min(...pts.map((q) => q[1]));
  const xs = pts.filter((q) => Math.abs(q[1] - top) < 0.01).map((q) => q[0]);
  return xs.length > 1 ? { from: Math.min(...xs), to: Math.max(...xs) } : { from: 0, to: p.w };
}

/** Flat: the lid opened out flat. From above: the lid as it sits on the box, seen from above (card 3). */
export type LidView = 'flat' | 'above';

const HIPS = ['hip-front', 'hip-back', 'hip-left', 'hip-right'] as const;

/** Shown when a hip's template is older than data-plan-depth, so From above can't be drawn. */
export const NO_PLAN_DEPTH = 'Export the templates again from Blender to see this view';

/** Whether From above can be drawn: the whole lid open, and every hip saying how deep it is seen from above. */
export function fromAboveReady(lid: Lid): { ok: true } | { ok: false; message: string } {
  if (!lid.whole || !slotPanel(lid.places.field)) return { ok: false, message: 'From above shows the whole lid: open the lid (all five files) to see it.' };
  const older = HIPS.filter((h) => slotPanel(lid.places[h])?.planDepth == null);
  return older.length ? { ok: false, message: NO_PLAN_DEPTH } : { ok: true };
}

/**
 * Where each place goes. Flat: the lid opened out flat, seen from above: the
 * field as it is (front of the box at the bottom), and each hip turned so its
 * foot faces outward and it reads as seen from outside, its top edge along the
 * matching field edge, HIP_GAP clear, centred on it. From above: the same, but
 * each hip against its field edge with no gap and squashed across its width to
 * its plan depth, as it is seen sitting on the box. Without a plan depth for
 * every hip, From above is drawn Flat.
 */
export function lidLayout(lid: Lid, view: LidView = 'flat'): Partial<Record<Place, Affine>> {
  const field = slotPanel(lid.places.field);
  const out: Partial<Record<Place, Affine>> = {};
  if (!lid.whole || !field) {
    const p = slotPanel(lid.places[lid.current]);
    if (p) out[lid.current] = IDENTITY;
    return out;
  }
  const above = view === 'above' && fromAboveReady(lid).ok;
  const { w: W, h: H } = field;
  out.field = IDENTITY;
  const g = above ? 0 : HIP_GAP;
  for (const place of HIPS) {
    const p = slotPanel(lid.places[place]);
    if (!p) continue;
    const { from, to } = topEdge(p);
    // Across the hip: true width laid flat, or squashed to its plan depth.
    const k = above ? p.planDepth! / p.h : 1;
    const along = place === 'hip-front' || place === 'hip-back' ? W : H;
    // Where the top edge's left end (as seen from outside) lands along the field edge.
    const start = (along - (to - from)) / 2;
    if (place === 'hip-front') out[place] = [1, 0, 0, k, start - from, H + g];
    // Seen from the back, its left is the field's right.
    else if (place === 'hip-back') out[place] = [-1, 0, 0, -k, W - start + from, -g];
    // Seen from the left, its left is the back.
    else if (place === 'hip-left') out[place] = [0, 1, -k, 0, -g, start - from];
    // Seen from the right, its left is the front.
    else out[place] = [0, -1, k, 0, W + g, H - start + from];
  }
  return out;
}

/**
 * Real hips are a little longer at the top than the field edge they meet (0.2
 * from the lid add-on: 0.1 clear each side), so under this counts as matching
 * (ornament/design/CARD_02a_tolerance.md).
 */
export const EDGE_TOLERANCE = 1;

/** The lid's top edges that don't match the field edge they run along, in plain words. */
export function edgeMismatches(lid: Lid): string[] {
  const field = slotPanel(lid.places.field);
  if (!lid.whole || !field) return [];
  const out: string[] = [];
  for (const place of HIPS) {
    const p = slotPanel(lid.places[place]);
    if (!p) continue;
    const { from, to } = topEdge(p);
    const along = place === 'hip-front' || place === 'hip-back' ? field.w : field.h;
    if (Math.abs(to - from - along) >= EDGE_TOLERANCE)
      out.push(`The ${PLACE_NAMES[place].toLowerCase()}’s top edge is ${mm(to - from)} long, but the field edge it meets is ${mm(along)}: it is centred on it. The two files may be from different lids.`);
  }
  return out;
}

/** A place's outline, where it lies on the lid. */
export function placedOutline(p: Panel, m: Affine): Ring[] {
  return pathRings(p.outline).rings.map((r) => r.map((q) => apply(m, q)));
}

/** The box round everything laid out, in lid mm. */
export function lidBounds(lid: Lid, view: LidView = 'flat'): { x: number; y: number; w: number; h: number } | null {
  const layout = lidLayout(lid, view);
  const pts: Pt[] = [];
  for (const place of PLACES) {
    const m = layout[place];
    const p = slotPanel(lid.places[place]);
    if (!m || !p) continue;
    const ring: Ring = [[0, 0], [p.w, 0], [p.w, p.h], [0, p.h]];
    pts.push(...ring.map((q) => apply(m, q)));
  }
  if (!pts.length) return null;
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

// ---------------------------------------------------------------- saving

/** "Save lid design": one design file per place that has layers, in the shared format. */
export function lidDesignFiles(lid: Lid): { place: Place; name: string; text: string }[] {
  return PLACES.flatMap((place) => {
    const d = lid.places[place]?.design;
    return d && d.layers.length ? [{ place, name: designFileName(d), text: designSvg(d) }] : [];
  });
}

/** Places with layers that have changed since they were opened or saved. */
export function unsavedPlaces(lid: Lid, savedAs: Partial<Record<Place, string>>): Place[] {
  return PLACES.filter((p) => {
    const d = lid.places[p]?.design;
    return !!d && d.layers.length > 0 && designSvg(d) !== savedAs[p];
  });
}

// ---------------------------------------------------------------- remembered in this browser

export const LID_KEY = 'incised.ornament.lid';
/** Where card 1 kept its one template. */
const OLD_KEY = 'incised.ornament';

interface Kept {
  current: Place;
  whole: boolean;
  /** Each place as its file: a design, or a shaped panel's template as it came. */
  files: Partial<Record<Place, string>>;
  saved: Partial<Record<Place, string>>;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Keeps the lid, every place with its layers, and what was last saved. */
export function keepLid(store: Store, lid: Lid, savedAs: Partial<Record<Place, string>>) {
  const files: Partial<Record<Place, string>> = {};
  for (const p of PLACES) {
    const s = lid.places[p];
    if (s?.design) files[p] = designSvg(s.design);
    else if (s?.shaped) files[p] = s.shaped.text;
  }
  if (!Object.keys(files).length) {
    store.removeItem(LID_KEY);
    store.removeItem(OLD_KEY);
    return;
  }
  const kept: Kept = { current: lid.current, whole: lid.whole, files, saved: savedAs };
  store.setItem(LID_KEY, JSON.stringify(kept));
  store.removeItem(OLD_KEY);
}

/** The lid kept in this browser (or card 1's one template), as it was left. */
export function keptLid(store: Store): { lid: Lid; savedAs: Partial<Record<Place, string>> } | null {
  const text = store.getItem(LID_KEY);
  if (!text) {
    const old = store.getItem(OLD_KEY);
    if (!old) return null;
    const o = openSvg(old);
    if (o.kind === 'error') return null;
    const place = o.kind === 'design' ? o.design.panel.place : o.panel.place;
    const slot: Slot = o.kind === 'design' ? { design: o.design, shaped: null } : { design: null, shaped: { panel: o.panel, text: old } };
    return { lid: { places: { [place]: slot }, current: place, whole: false }, savedAs: {} };
  }
  let kept: Kept;
  try {
    kept = JSON.parse(text) as Kept;
  } catch {
    return null;
  }
  const places: Partial<Record<Place, Slot>> = {};
  for (const p of PLACES) {
    const t = kept.files?.[p];
    if (!t) continue;
    const o = openSvg(t);
    if (o.kind === 'design') places[p] = { design: o.design, shaped: null };
    else if (o.kind === 'shaped') places[p] = { design: null, shaped: { panel: o.panel, text: t } };
  }
  const have = PLACES.filter((p) => places[p]);
  if (!have.length) return null;
  const current = have.includes(kept.current) ? kept.current : have[0];
  return { lid: { places, current, whole: !!kept.whole && have.length === 5 }, savedAs: kept.saved ?? {} };
}
