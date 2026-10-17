// The ornament layout (ornament/design/CARD_01_loop.md): a panel from the lid
// add-on's template, its zones, and layers of plain shapes at levels. Layout
// only: nothing here reads the machine settings, the toolpaths or the bed.

export type Pt = [number, number];
/** A closed outline, in mm from the panel's top-left corner. */
export type Ring = Pt[];

export const PLACES = ['field', 'hip-front', 'hip-right', 'hip-back', 'hip-left'] as const;
export type Place = (typeof PLACES)[number];
export const PLACE_NAMES: Record<Place, string> = {
  field: 'Lid field',
  'hip-front': 'Front hip',
  'hip-right': 'Right hip',
  'hip-back': 'Back hip',
  'hip-left': 'Left hip',
};

export const EDGES = ['square', 'v'] as const;
export type Edge = (typeof EDGES)[number];
export const EDGE_NAMES: Record<Edge, string> = { square: 'Square', v: 'V' };

export const FINISHES = ['ebony', 'gold', 'white-gold', 'pearl', 'boxwood'] as const;
export type Finish = (typeof FINISHES)[number];
export const FINISH_NAMES: Record<Finish, string> = { ebony: 'Ebony', gold: 'Gold', 'white-gold': 'White gold', pearl: 'Pearl', boxwood: 'Boxwood' };

/** Zones a layer can take its shape from. "fields" is left and right together, when the left mirrors the right. */
export type ZoneName = 'border' | 'centre' | 'left' | 'right' | 'fields';
export const ZONE_NAMES: Record<ZoneName, string> = {
  border: 'Border',
  centre: 'Centre',
  left: 'Left field',
  right: 'Right field',
  fields: 'Left and right fields',
};

export interface Zones {
  /** Border band: how far in from the edge it starts, and how wide it is. */
  edgeDistance: number;
  bandWidth: number;
  centreShape: 'ellipse' | 'rect';
  centreWidth: number;
  centreHeight: number;
  /** Between each side field and the centre zone. */
  gapToCentre: number;
  /** Left mirrors right: placed shapes get a mirrored twin, and the side fields go together. */
  mirror: boolean;
}

/** Stand-ins until Brian sets the real ones (the card says so). */
export const DEFAULT_ZONES: Zones = {
  edgeDistance: 12,
  bandWidth: 2,
  centreShape: 'ellipse',
  centreWidth: 36,
  centreHeight: 36,
  gapToCentre: 6,
  mirror: true,
};

export type Shape =
  | { kind: 'zone'; zone: ZoneName }
  | { kind: 'rect' | 'ellipse'; x: number; y: number; w: number; h: number }
  /** Drawn elsewhere (not by this tool): kept exactly as it came, without handles. */
  | { kind: 'path'; d: string };

export interface Layer {
  id: string;
  name: string;
  shape: Shape;
  /** mm below the top; 0 = the top. */
  level: number;
  edge: Edge;
  finish: Finish;
}

export interface Panel {
  place: Place;
  /** The template's own size and viewBox, written back exactly as they came. */
  width: string;
  height: string;
  viewBox: string;
  w: number;
  h: number;
  /** mm, where the template gives it. */
  thickness: number | null;
  /** Hips only, where the template gives them (card 3): the slope in degrees, and how deep the hip is seen from above, in mm. */
  slope: number | null;
  planDepth: number | null;
  /** The template's outline, exactly as it came. */
  outline: string;
}

export interface Design {
  panel: Panel;
  zones: Zones;
  layers: Layer[];
}

let counter = 0;
export function newId(): string {
  counter += 1;
  return `l${Date.now().toString(36)}${counter}`;
}

// ---------------------------------------------------------------- zones

const rectRing = (x: number, y: number, w: number, h: number): Ring => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

/** Enough points that an ellipse is true to well under 0.01 mm at panel sizes. */
const ELLIPSE_POINTS = 192;
function ellipseRing(x: number, y: number, w: number, h: number): Ring {
  const out: Ring = [];
  for (let i = 0; i < ELLIPSE_POINTS; i++) {
    const a = (i / ELLIPSE_POINTS) * 2 * Math.PI;
    out.push([x + w / 2 + (w / 2) * Math.cos(a), y + h / 2 + (h / 2) * Math.sin(a)]);
  }
  return out;
}

export function boxRing(kind: 'rect' | 'ellipse', x: number, y: number, w: number, h: number): Ring {
  return kind === 'rect' ? rectRing(x, y, w, h) : ellipseRing(x, y, w, h);
}

/** Each zone's bounds, or null where there is no room for it. */
export function zoneBoxes(panel: { w: number; h: number }, z: Zones) {
  const { w, h } = panel;
  const d = z.edgeDistance;
  const inner = d + z.bandWidth;
  const box = (x: number, y: number, bw: number, bh: number) => (bw > 0 && bh > 0 ? { x, y, w: bw, h: bh } : null);
  const centre = box((w - z.centreWidth) / 2, (h - z.centreHeight) / 2, z.centreWidth, z.centreHeight);
  const fieldW = (w - z.centreWidth) / 2 - z.gapToCentre - inner;
  return {
    borderOuter: box(d, d, w - 2 * d, h - 2 * d),
    borderInner: box(inner, inner, w - 2 * inner, h - 2 * inner),
    centre,
    left: box(inner, inner, fieldW, h - 2 * inner),
    right: box(w - inner - fieldW, inner, fieldW, h - 2 * inner),
  };
}

/** A zone's outline: one or more rings, filled even-odd (the border band is a ring with a hole). */
export function zoneRings(panel: { w: number; h: number }, z: Zones, zone: ZoneName): Ring[] {
  const b = zoneBoxes(panel, z);
  // The left mirrors the right: either side field's layer is both.
  if (z.mirror && (zone === 'left' || zone === 'right')) zone = 'fields';
  if (zone === 'border') {
    if (!b.borderOuter) return [];
    const out = [rectRing(b.borderOuter.x, b.borderOuter.y, b.borderOuter.w, b.borderOuter.h)];
    if (b.borderInner) out.push(rectRing(b.borderInner.x, b.borderInner.y, b.borderInner.w, b.borderInner.h).reverse());
    return out;
  }
  if (zone === 'centre') return b.centre ? [boxRing(z.centreShape, b.centre.x, b.centre.y, b.centre.w, b.centre.h)] : [];
  const sides = zone === 'fields' ? [b.left, b.right] : [zone === 'left' ? b.left : b.right];
  return sides.filter((s) => s !== null).map((s) => rectRing(s.x, s.y, s.w, s.h));
}

/** Whether a placed shape gets a mirrored twin: the left mirrors the right, and it lies wholly to one side. */
export function hasTwin(s: Shape, panelW: number, z: Zones): boolean {
  if (!z.mirror || (s.kind !== 'rect' && s.kind !== 'ellipse')) return false;
  const mid = panelW / 2;
  return s.x + s.w <= mid + 1e-9 || s.x >= mid - 1e-9;
}

export function twinOf(s: { x: number; y: number; w: number; h: number }, panelW: number) {
  return { x: panelW - s.x - s.w, y: s.y, w: s.w, h: s.h };
}

// ---------------------------------------------------------------- levels

export interface LevelProblem {
  /** Names it among the others, before and after a fix. */
  key: string;
  text: string;
  /** Layers it is about, by id. */
  layers: string[];
  fixes: LevelFix[];
}

export interface LevelFix {
  label: string;
  /** The same change is tried on a copy and applied, so what was tried is what is given. */
  apply: (layers: Layer[]) => Layer[];
}

export interface LevelReadout {
  used: number;
  deepest: number;
  /** Thickness less 1, or null where the template gives no thickness. */
  allowed: number | null;
  problems: LevelProblem[];
}

const MIN_CUT = 1;
const MIN_STEP = 1;
const MIN_UNDER = 1;

export const mm = (v: number) => `${Math.round(v * 100) / 100}`;
const same = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const named = (ls: Layer[]) => ls.map((l) => `“${l.name || 'unnamed'}”`).join(' and ');

function setLevel(ids: string[], level: number): (layers: Layer[]) => Layer[] {
  return (layers) => layers.map((l) => (ids.includes(l.id) ? { ...l, level } : l));
}

/** The level rules, without fixes: what is wrong now. */
function findProblems(layers: Layer[], thickness: number | null): LevelProblem[] {
  const out: LevelProblem[] = [];
  const allowed = thickness === null ? null : thickness - MIN_UNDER;
  for (const l of layers) {
    if (l.level > 0 && l.level < MIN_CUT - 1e-6) {
      out.push({
        key: `shallow:${l.id}`,
        text: `${named([l])} is only ${mm(l.level)} deep. A cut must be at least ${MIN_CUT} deep, or 0 to stay at the top.`,
        layers: [l.id],
        fixes: [
          { label: `Make it ${MIN_CUT} deep`, apply: setLevel([l.id], MIN_CUT) },
          { label: 'Bring it to the top (0)', apply: setLevel([l.id], 0) },
        ],
      });
    }
    if (allowed !== null && l.level > allowed + 1e-6) {
      out.push({
        key: `deep:${l.id}`,
        text: `${named([l])} is ${mm(l.level)} deep, deeper than allowed: the board is ${mm(thickness!)} thick and ${MIN_UNDER} must be left under, so the deepest is ${mm(allowed)}.`,
        layers: [l.id],
        fixes: allowed >= MIN_CUT ? [{ label: `Raise it to ${mm(allowed)}`, apply: setLevel([l.id], allowed) }] : [],
      });
    }
  }
  const levels = [...new Set(layers.map((l) => l.level))].sort((a, b) => a - b);
  for (let i = 1; i < levels.length; i++) {
    const [a, b] = [levels[i - 1], levels[i]];
    // Under 1 off the top is the "only so deep" rule above; this is between two cut levels.
    if (a === 0 || b - a >= MIN_STEP - 1e-6) continue;
    const upper = layers.filter((l) => same(l.level, a));
    const lower = layers.filter((l) => same(l.level, b));
    const ids = lower.map((l) => l.id);
    out.push({
      key: `step:${upper.map((l) => l.id).join(',')}|${ids.join(',')}`,
      text: `${named(upper)} at ${mm(a)} and ${named(lower)} at ${mm(b)} are only ${mm(b - a)} apart. Neighbouring levels need at least ${MIN_STEP} between them.`,
      layers: [...upper.map((l) => l.id), ...ids],
      fixes: [
        { label: `Move ${named(lower)} down to ${mm(a + MIN_STEP)}`, apply: setLevel(ids, a + MIN_STEP) },
        { label: `Move ${named(lower)} up to ${mm(a)}, the same level`, apply: setLevel(ids, a) },
      ],
    });
  }
  return out;
}

/**
 * "Levels used X; deepest Y of Z allowed", with every level rule broken.
 * A fix is offered only if, tried on a copy, it cures its problem without
 * causing a new one.
 */
export function levelReadout(layers: Layer[], thickness: number | null): LevelReadout {
  const problems = findProblems(layers, thickness);
  const keys = new Set(problems.map((p) => p.key));
  for (const p of problems) {
    p.fixes = p.fixes.filter((f) => {
      const after = findProblems(f.apply(layers), thickness);
      return after.every((q) => keys.has(q.key) && q.key !== p.key);
    });
  }
  return {
    used: new Set(layers.map((l) => l.level)).size,
    deepest: layers.reduce((m, l) => Math.max(m, l.level), 0),
    allowed: thickness === null ? null : thickness - MIN_UNDER,
    problems,
  };
}

/** Hip templates carry no thickness yet (ornament/design/CARD_01a_answers.md): the steps are still checked, the depth limit is not. */
export const NO_THICKNESS = 'Thickness not given: depth limit not checked';

export function readoutText(r: LevelReadout): string {
  const of = r.allowed === null ? '' : ` of ${mm(r.allowed)} allowed`;
  return `Levels used ${r.used}; deepest ${mm(r.deepest)}${of}`;
}

/** The panel's thickness, or the plain line saying it isn't given. */
export function thicknessText(p: { thickness: number | null }): string {
  return p.thickness === null ? NO_THICKNESS : `${mm(p.thickness)} thick`;
}

// ---------------------------------------------------------------- layout problems

export interface DesignProblem {
  key: string;
  text: string;
  layers: string[];
  fixes: { label: string; apply: (d: Design) => Design }[];
}

/** Placed shapes off the panel, and zone layers with no room. Layout only. */
function layoutFaults(d: Design): DesignProblem[] {
  const out: DesignProblem[] = [];
  const { w, h } = d.panel;
  for (const l of d.layers) {
    const s = l.shape;
    if (s.kind === 'rect' || s.kind === 'ellipse') {
      if (s.x < -1e-6 || s.y < -1e-6 || s.x + s.w > w + 1e-6 || s.y + s.h > h + 1e-6) {
        const nw = Math.min(s.w, w);
        const nh = Math.min(s.h, h);
        const box = { x: Math.min(Math.max(s.x, 0), w - nw), y: Math.min(Math.max(s.y, 0), h - nh), w: nw, h: nh };
        out.push({
          key: `off:${l.id}`,
          text: `${named([l])} runs off the panel.`,
          layers: [l.id],
          fixes: [{ label: 'Bring it back onto the panel', apply: (x) => ({ ...x, layers: x.layers.map((m) => (m.id === l.id ? { ...m, shape: { ...s, ...box } } : m)) }) }],
        });
      }
    } else if (s.kind === 'zone' && zoneRings(d.panel, d.zones, s.zone).length === 0) {
      const z = d.zones;
      const fixes: DesignProblem['fixes'] = [];
      const shrunk = shrinkZones(d.panel, z);
      if (shrunk) fixes.push({ label: `Shrink the zones to fit the panel (to ${Math.round(shrunk.k * 100)}%)`, apply: (x) => ({ ...x, zones: shrunk.zones }) });
      if (s.zone !== 'border' && s.zone !== 'centre') {
        // Side fields a quarter of the room inside the border, up to 10 wide.
        const room = w - 2 * (z.edgeDistance + z.bandWidth);
        const cw = Math.floor(room - 2 * z.gapToCentre - 2 * Math.min(10, room / 4));
        if (cw >= 1) fixes.push({ label: `Narrow the centre to ${cw}`, apply: (x) => ({ ...x, zones: { ...x.zones, centreWidth: cw } }) });
      }
      out.push({
        key: `room:${l.id}`,
        text: `${named([l])} is on the ${ZONE_NAMES[s.zone].toLowerCase()}, which has no room: the other zones take up the whole panel.`,
        layers: [l.id],
        fixes,
      });
    }
  }
  const b = zoneBoxes(d.panel, d.zones);
  const z = d.zones;
  if (b.centre && b.borderInner && (b.centre.w > b.borderInner.w + 1e-6 || b.centre.h > b.borderInner.h + 1e-6)) {
    const fixes: DesignProblem['fixes'] = [];
    const cw = Math.floor(Math.min(z.centreWidth, b.borderInner.w));
    const ch = Math.floor(Math.min(z.centreHeight, b.borderInner.h));
    if (cw >= 1 && ch >= 1) fixes.push({ label: `Shrink the centre to ${cw} × ${ch}`, apply: (x) => ({ ...x, zones: { ...x.zones, centreWidth: cw, centreHeight: ch } }) });
    const shrunk = shrinkZones(d.panel, z);
    if (shrunk) fixes.push({ label: `Shrink the zones to fit the panel (to ${Math.round(shrunk.k * 100)}%)`, apply: (x) => ({ ...x, zones: shrunk.zones }) });
    out.push({
      key: 'centre-big',
      text: `The centre zone, ${mm(z.centreWidth)} × ${mm(z.centreHeight)}, runs past the border: there is ${mm(b.borderInner.w)} × ${mm(b.borderInner.h)} inside it.`,
      layers: d.layers.filter((l) => l.shape.kind === 'zone' && l.shape.zone === 'centre').map((l) => l.id),
      fixes,
    });
  }
  return out;
}

/** Whether every zone has room, with the centre inside the border. */
function zonesFit(panel: { w: number; h: number }, z: Zones): boolean {
  const b = zoneBoxes(panel, z);
  return !!(b.borderOuter && b.borderInner && b.centre && b.left && b.right && b.centre.w <= b.borderInner.w && b.centre.h <= b.borderInner.h);
}

/** Every zone's sizes scaled down together, as little as will make them all fit the panel. */
export function shrinkZones(panel: { w: number; h: number }, z: Zones): { k: number; zones: Zones } | null {
  const r = (v: number) => Math.round(v * 10) / 10;
  for (let k = 0.95; k > 0.01; k *= 0.95) {
    const zones = {
      ...z,
      edgeDistance: r(z.edgeDistance * k),
      bandWidth: r(z.bandWidth * k),
      centreWidth: r(z.centreWidth * k),
      centreHeight: r(z.centreHeight * k),
      gapToCentre: r(z.gapToCentre * k),
    };
    if (zonesFit(panel, zones)) return { k, zones };
  }
  return null;
}

function allProblems(d: Design): DesignProblem[] {
  const levels = findProblems(d.layers, d.panel.thickness).map((p) => ({
    ...p,
    fixes: p.fixes.map((f) => ({ label: f.label, apply: (x: Design) => ({ ...x, layers: f.apply(x.layers) }) })),
  }));
  return [...levels, ...layoutFaults(d)];
}

/**
 * Everything wrong with the design, each with the fixes that, tried on a
 * copy, cure it without causing anything new.
 */
export function designProblems(d: Design): DesignProblem[] {
  const problems = allProblems(d);
  const keys = new Set(problems.map((p) => p.key));
  for (const p of problems) p.fixes = p.fixes.filter((f) => allProblems(f.apply(d)).every((q) => keys.has(q.key) && q.key !== p.key));
  return problems;
}
