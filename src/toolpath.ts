// Toolpaths for the three marking-out passes (BRIEF.md, Machine and G-code):
//
//   1. Hairline: a light line on the true outline.
//   2. Datum line: a light line on the datum line.
//   3. Valley slit: down every valley line, sunk to the true valley depth less
//      the slit margin, rising to nothing where the forks reach the corners.
//
// Everything here is in panel millimetres (x right, y down from the panel's
// top-left corner) with z negative into the wood from its top surface. The
// G-code writer turns that into machine coordinates.
//
// Cutting order (BRIEF.md, Decisions): letter by letter in reading order, and
// within each letter thin strokes first, then thick. A stroke for the slit is
// as the carver counts it: its valley runs straight on through any junction
// where it is the thicker stroke (see strokes.ts); its thickness is its
// average width. Each stroke's forks are cut straight after it.

import { borderMarks } from './border';
import { strokesOf } from './strokes';
import { simplify, type Contour, type Pt } from './geometry';
import type { Layout } from './layout';
import type { ValleyLine } from './valley';

export { isFork } from './strokes';

export interface MachineSettings {
  /** Board thickness, mm. 0 = not entered yet (no G-code until it is). */
  stockThickness: number;
  /** No cut may come closer to the back of the board than this, mm. */
  safeFloor: number;
  /**
   * The panel corner that is X0 Y0 on the machine. "Bottom" is the bottom
   * edge on screen, which is the front of the bed (nearest the carver) with
   * the board reading the right way up.
   */
  zeroCorner: 'bottom-left' | 'top-left' | 'top-right' | 'bottom-right';
  /** Included angle of the finished V-section, degrees: sets the valley depth. */
  chiselAngle: number;
  /** The slit stops this far short of the true valley depth, mm. */
  slitMargin: number;
  /** The V-bit: included angle (degrees) and how deep its cutting edge reaches, mm. */
  toolAngle: number;
  toolCutDepth: number;
  spindle: number; // rpm
  hairlineDepth: number; // mm
  datumDepth: number; // mm
  /**
   * Depth of a scribed (single or double) border line, mm: 0.2 marks it out
   * like the hairline; up to about 1 mm leaves a finished decorative line.
   */
  scribeDepth: number;
  /** Most the slit goes down in one pass, mm. */
  slitStep: number;
  feedHairline: number; // mm/min
  feedDatum: number;
  feedSlit: number;
  feedPlunge: number;
  /** Height the bit lifts to between cuts, mm above the top surface. */
  safeZ: number;
  passes: { hairline: boolean; datum: boolean; slit: boolean };
}

export const defaultMachine: MachineSettings = {
  stockThickness: 0,
  safeFloor: 3,
  zeroCorner: 'bottom-left', // front left (BRIEF.md, Decisions)
  chiselAngle: 60,
  slitMargin: 0.3,
  toolAngle: 30,
  toolCutDepth: 10.7,
  spindle: 12000,
  hairlineDepth: 0.2,
  datumDepth: 0.3,
  scribeDepth: 0.2,
  slitStep: 1.75,
  feedHairline: 900,
  feedDatum: 900,
  feedSlit: 650,
  feedPlunge: 250,
  safeZ: 3,
  passes: { hairline: true, datum: true, slit: true },
};

/** The workshop name for each zero corner: front is the edge nearest the carver. */
export const CORNER_NAMES: Record<MachineSettings['zeroCorner'], string> = {
  'bottom-left': 'front left',
  'bottom-right': 'front right',
  'top-left': 'back left',
  'top-right': 'back right',
};

export type PassName = 'hairline' | 'datum' | 'slit';

export interface Pt3 extends Pt {
  z: number;
}

/** One cut: lower the bit at the first point, follow the points, lift at the end. */
export interface Cut {
  points: Pt3[];
  feed: number;
  /** Which letter (or 'border') it belongs to, and, for the slit, its stroke number within that letter (thin first; see strokes.ts). */
  item: string;
  stroke?: number;
  /** The stroke's average width, mm (slit only). */
  width?: number;
  /**
   * A fork from the stroke out to a corner of its termination (or a serif),
   * or a scrap of valley inside a junction: a stop cut, pared to by hand, cut
   * straight after its stroke and carrying its number, but not a stroke of
   * its own, so not labelled (slit only).
   */
  fork?: boolean;
}


export interface Pass {
  name: PassName;
  title: string;
  cuts: Cut[];
  /** Deepest point, mm (positive). */
  deepest: number;
  /** Length cut, travel between cuts, and an estimate of the time, mm and minutes. */
  cutLength: number;
  travel: number;
  minutes: number;
  /** Letters (item ids) whose cuts in this pass could not be worked out, and are left out. */
  failed: string[];
}

export interface Check {
  /** Which check this is, so the warnings list can tell them apart. */
  id: 'stock' | 'floor' | 'bit-depth' | 'angle' | 'bed' | 'margins' | 'panel' | 'passes' | 'pending' | 'failed';
  ok: boolean;
  text: string;
  /** A failed check that must stop the G-code being saved. */
  blocking: boolean;
}

/** Valley depth for a stroke of half-width r: d = (w / 2) / tan(θ / 2). */
export function valleyDepth(r: number, chiselAngle: number): number {
  return r / Math.tan(((chiselAngle / 2) * Math.PI) / 180);
}

/** Depth of the slit at a point of half-width r: the valley depth less the slit margin, never above the surface. */
export function slitDepth(r: number, m: MachineSettings): number {
  return Math.max(0, valleyDepth(r, m.chiselAngle) - m.slitMargin);
}

/** Rapid moves are taken at roughly this speed for the time estimate, mm/min. */
const RAPID = 1500;

/** Deepest a scribed border line may be set, mm (BRIEF.md, Decisions). */
export const MAX_SCRIBE_DEPTH = 1;

interface Item {
  id: string;
  outline: Contour[];
  /** Scribed border lines, cut in the hairline pass at their own depth. */
  scribes?: Contour[];
  datum: Contour[];
  valleys: ValleyLine[];
}

/** Letters (and word stops) in reading order, then the border. */
function items(layout: Layout): Item[] {
  const p = layout.project;
  const list: (Item & { line: number; x: number })[] = [];
  layout.letters.forEach((l, i) =>
    list.push({ id: `${l.char} (line ${layout.lines[l.line]?.number ?? l.line + 1})#${i}`, line: l.line, x: l.box.x0, outline: l.outline, datum: l.datum, valleys: l.valleys }),
  );
  layout.stops.forEach((s, i) =>
    list.push({ id: `word stop (line ${layout.lines[s.line]?.number ?? s.line + 1})#${i}`, line: s.line, x: s.valleys[0][0].x, outline: s.outline, datum: s.datum, valleys: s.valleys }),
  );
  list.sort((a, b) => a.line - b.line || a.x - b.x);
  const out: Item[] = list;
  const bm = borderMarks(p.border, p.panelWidth, p.panelHeight, { percent: p.datumPercent, minimum: p.datumMinimum });
  if (bm.scribes.length || bm.outline.length) {
    out.push({ id: 'border', outline: bm.outline, scribes: bm.scribes, datum: bm.datum, valleys: bm.valleys });
  }
  return out;
}

/**
 * Outlines arrive as many tiny steps (curves drawn as short chords). The
 * machine's controller can only take so many moves a second, so each path
 * is thinned to the points that matter, staying within this distance of the
 * true line, mm.
 */
const PATH_TOL = 0.005;
const close = (c: Contour): Pt[] => simplify([...c, c[0]], PATH_TOL);
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const pathLength = (pts: Pt[]) => pts.reduce((s, p, i) => (i ? s + dist(pts[i - 1], p) : 0), 0);

/** Closed contours in an order that keeps travel short: always the nearest next. */
function nearestOrder(contours: Contour[], from: Pt): Contour[] {
  const left = contours.filter((c) => c.length >= 2);
  const out: Contour[] = [];
  let at = from;
  while (left.length) {
    let best = 0;
    let bestStart = 0;
    let bestD = Infinity;
    left.forEach((c, i) =>
      c.forEach((p, j) => {
        const d = dist(at, p);
        if (d < bestD) [bestD, best, bestStart] = [d, i, j];
      }),
    );
    const c = left.splice(best, 1)[0];
    const rotated = [...c.slice(bestStart), ...c.slice(0, bestStart)];
    out.push(rotated);
    at = rotated[0];
  }
  return out;
}

function stats(cuts: Cut[], m: MachineSettings) {
  let cutLength = 0;
  let travel = 0;
  let minutes = 0;
  let deepest = 0;
  let at: Pt | null = null;
  for (const c of cuts) {
    const len = pathLength(c.points);
    cutLength += len;
    minutes += len / c.feed;
    const z0 = -c.points[0].z;
    minutes += (z0 + m.safeZ) / m.feedPlunge + m.safeZ / RAPID;
    if (at) {
      const t = dist(at, c.points[0]);
      travel += t;
      minutes += t / RAPID;
    }
    at = c.points[c.points.length - 1];
    for (const p of c.points) deepest = Math.max(deepest, -p.z);
    // Steps down between slit levels, at the plunge feed.
    for (let i = 1; i < c.points.length; i++) {
      const dz = c.points[i - 1].z - c.points[i].z;
      if (dz > 0 && dist(c.points[i - 1], c.points[i]) < 1e-9) minutes += dz / m.feedPlunge;
    }
  }
  return { cutLength, travel, minutes, deepest };
}

/**
 * A letter, word stop or the border, in words: "“A” on line 2", "the word
 * stop on line 1", "the border".
 */
export function itemWords(id: string): string {
  if (id === 'border') return 'the border';
  const [, what, line] = /^(.*) \(line (\d+)\)#\d+$/.exec(id) ?? [];
  if (!what) return id.split('#')[0];
  if (what === 'word stop') return `the word stop on line ${line}`;
  // Letters linked into one shape are cut as one letter (BRIEF.md, Decisions: "Linked letters").
  return [...what].length > 1 ? `the linked “${what}” on line ${line}` : `“${what}” on line ${line}`;
}

/**
 * Each letter's cuts are worked out on their own: should one fail, it is left
 * out and named in the pass's `failed`, and the rest of the job carries on.
 */
function each(list: Item[], failed: string[], work: (it: Item) => void, undo: () => void) {
  for (const it of list) {
    try {
      work(it);
    } catch (err) {
      undo();
      if (!failed.includes(it.id)) failed.push(it.id);
      console.error(`Could not work out the cuts for ${itemWords(it.id)}:`, err);
    }
  }
}

export function buildPasses(layout: Layout, m: MachineSettings): Pass[] {
  const list = items(layout);
  const passes: Pass[] = [];

  if (m.passes.hairline) {
    const cuts: Cut[] = [];
    const failed: string[] = [];
    let at: Pt = { x: 0, y: 0 };
    let mark = 0;
    each(list, failed, (it) => {
      mark = cuts.length;
      for (const c of nearestOrder(it.outline, at)) {
        cuts.push({ item: it.id, feed: m.feedHairline, points: close(c).map((p) => ({ ...p, z: -m.hairlineDepth })) });
        at = c[0];
      }
      // A scribed border is cut here too, at its own depth (never past the limit).
      const scribeZ = -Math.min(m.scribeDepth, MAX_SCRIBE_DEPTH);
      for (const c of nearestOrder(it.scribes ?? [], at)) {
        cuts.push({ item: it.id, feed: m.feedHairline, points: close(c).map((p) => ({ ...p, z: scribeZ })) });
        at = c[0];
      }
    }, () => cuts.splice(mark));
    passes.push({ name: 'hairline', title: 'Hairline', cuts, ...stats(cuts, m), failed });
  }

  if (m.passes.datum) {
    const cuts: Cut[] = [];
    const failed: string[] = [];
    let at: Pt = { x: 0, y: 0 };
    let mark = 0;
    each(list, failed, (it) => {
      mark = cuts.length;
      for (const c of nearestOrder(it.datum, at)) {
        cuts.push({ item: it.id, feed: m.feedDatum, points: close(c).map((p) => ({ ...p, z: -m.datumDepth })) });
        at = c[0];
      }
    }, () => cuts.splice(mark));
    passes.push({ name: 'datum', title: 'Datum line', cuts, ...stats(cuts, m), failed });
  }

  if (m.passes.slit) {
    const cuts: Cut[] = [];
    const failed: string[] = [];
    let at: Pt = { x: 0, y: 0 };
    let mark = 0;
    /** Cut one run of valley line down to its depth, in steps. False if it is too shallow to cut at all. */
    const slit = (v: ValleyLine, item: string, stroke: number, width: number, fork: boolean) => {
      // Start from whichever end is nearer.
      let pts = dist(at, v[0]) <= dist(at, v[v.length - 1]) ? v : v.slice().reverse();
      const target = pts.map((p) => slitDepth(p.r, m));
      const deepest = Math.max(...target);
      if (deepest <= 0) return;
      const levels = Math.max(1, Math.ceil(deepest / m.slitStep - 1e-9));
      const path: Pt3[] = [];
      let depths = target;
      for (let L = 1; L <= levels; L++) {
        const cap = Math.min(deepest, L * m.slitStep);
        // Back and forth: each level runs the other way, starting where the last one ended.
        if (L > 1) {
          pts = pts.slice().reverse();
          depths = depths.slice().reverse();
        }
        pts.forEach((p, i) => path.push({ x: p.x, y: p.y, z: -Math.min(depths[i], cap) }));
      }
      cuts.push({ item, feed: m.feedSlit, points: path, stroke, width, fork });
      at = path[path.length - 1];
    };
    /** Runs taken nearest first, to keep travel short. */
    const nearestFirst = (runs: ValleyLine[], each: (v: ValleyLine) => void) => {
      const left = runs.slice();
      while (left.length) {
        let best = 0;
        let bestD = Infinity;
        left.forEach((v, i) => {
          const d = Math.min(dist(at, v[0]), dist(at, v[v.length - 1]));
          if (d < bestD) [best, bestD] = [i, d];
        });
        each(left.splice(best, 1)[0]);
      }
    };
    each(list, failed, (it) => {
      mark = cuts.length;
      // The letter's strokes, thin first, each straight through its junctions where
      // it is the thicker, then its forks (BRIEF.md, Decisions: strokes at a junction).
      strokesOf(it.valleys).forEach((s, si) => {
        nearestFirst(s.parts, (v) => slit(v, it.id, si + 1, s.width, false));
        nearestFirst(s.extras, (v) => slit(v, it.id, si + 1, s.width, true));
      });
    }, () => cuts.splice(mark));
    passes.push({ name: 'slit', title: 'Valley slit', cuts, ...stats(cuts, m), failed });
  }
  return passes;
}

/** The safety and sense checks. Any failed blocking check stops the G-code being saved. */
export function checkPasses(layout: Layout, passes: Pass[], m: MachineSettings, bed: 'standard' | 'extended' | 'too-big'): Check[] {
  const p = layout.project;
  const checks: Check[] = [];
  const deepest = Math.max(0, ...passes.map((q) => q.deepest));
  if (!(m.stockThickness > 0)) {
    checks.push({ id: 'stock', ok: false, blocking: true, text: 'Enter the stock thickness.' });
  } else {
    const limit = m.stockThickness - m.safeFloor;
    checks.push({
      id: 'floor',
      ok: deepest <= limit + 1e-9,
      blocking: true,
      text:
        deepest <= limit + 1e-9
          ? `Deepest cut ${deepest.toFixed(2)} mm, inside the limit of ${limit.toFixed(2)} mm (stock ${m.stockThickness} mm less ${m.safeFloor} mm floor).`
          : `Deepest cut ${deepest.toFixed(2)} mm goes below the limit of ${limit.toFixed(2)} mm (stock ${m.stockThickness} mm less ${m.safeFloor} mm floor). Use thicker stock or smaller letters.`,
    });
  }
  checks.push({
    id: 'bit-depth',
    ok: deepest <= m.toolCutDepth + 1e-9,
    blocking: true,
    text:
      deepest <= m.toolCutDepth + 1e-9
        ? `Deepest cut is within the bit's ${m.toolCutDepth} mm cutting depth.`
        : `Deepest cut ${deepest.toFixed(2)} mm is more than the bit's ${m.toolCutDepth} mm cutting depth. Use smaller letters.`,
  });
  // The bit is steeper than the chisel, so the slit stays inside the waste.
  checks.push({
    id: 'angle',
    ok: m.toolAngle < m.chiselAngle,
    blocking: true,
    text:
      m.toolAngle < m.chiselAngle
        ? `The ${m.toolAngle}° bit is steeper than the ${m.chiselAngle}° letter walls, so the slit stays in the waste.`
        : `The ${m.toolAngle}° bit is not steeper than the ${m.chiselAngle}° letter walls: the slit could cut into a finished wall.`,
  });
  checks.push({
    id: 'bed',
    ok: bed !== 'too-big',
    blocking: true,
    text:
      bed === 'standard'
        ? 'The panel fits the machine bed.'
        : bed === 'extended'
          ? 'The panel needs the extended bed (300 × 400 mm).'
          : 'The panel is too big for the machine, even with the extended bed.',
  });
  if (layout.overflow.wide || layout.overflow.tall) {
    checks.push({ id: 'margins', ok: false, blocking: false, text: 'Some lettering runs past the margins. Check that is what you want.' });
  }
  const offPanel = passes.some((q) => q.cuts.some((c) => c.points.some((pt) => pt.x < 0 || pt.y < 0 || pt.x > p.panelWidth || pt.y > p.panelHeight)));
  checks.push({
    id: 'panel',
    ok: !offPanel,
    blocking: true,
    text: offPanel ? 'Some cuts fall outside the panel.' : 'Every cut is on the panel.',
  });
  // Any letter whose cuts could not be worked out is left out: the G-code would be short of it.
  const failed = [...new Set(passes.flatMap((q) => q.failed ?? []))];
  if (failed.length) {
    const names = failed.map(itemWords);
    const listed = names.length < 2 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    checks.push({ id: 'failed', ok: false, blocking: true, text: `The cuts for ${listed} could not be worked out, so ${failed.length > 1 ? 'they are' : 'it is'} left out of the marking-out.` });
  }
  if (!passes.length) checks.push({ id: 'passes', ok: false, blocking: true, text: 'Choose at least one pass to run.' });
  if (layout.shapesPending) checks.push({ id: 'pending', ok: false, blocking: true, text: 'Still working out the linked letters; a moment…' });
  else if (layout.datumPending) checks.push({ id: 'pending', ok: false, blocking: true, text: 'Still working out the datum lines; a moment…' });
  return checks;
}
