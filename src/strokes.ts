// Strokes and their cutting order (BRIEF.md, Decisions: "Strokes at a
// junction").
//
// The valley lines of a letter come as runs that break wherever lines meet.
// This joins them back into the letter's strokes as a carver counts them:
//
//  - At a junction, a stroke goes on through if a run carries on in nearly
//    the same direction on the other side. Where more than one could, the
//    thicker stroke goes through: the thicker stroke is continuous and counts
//    as one stroke; the thinner ends into it. So A is three strokes (thick
//    right leg, thin left leg, crossbar) and B the stem plus one per bowl.
//  - A thinner stroke that crosses a thicker one (the thin diagonal of X) is
//    still one stroke, cut in two parts, each stopping at the thick stroke's
//    valley line.
//  - Strokes are cut thin first. The thin stroke is cut first and stops at
//    the thick stroke's valley line; then the thick stroke is cut straight
//    through the junction in one cut. Strokes of equal width are taken from
//    left to right, then top to bottom, and where they meet the one cut
//    second is continuous (BRIEF.md, Decisions: "Equal-width strokes").
//  - A valley that runs on with no junction is one stroke however its width
//    changes along it: O, S, and U (BRIEF.md, Decisions: "U").
//  - The forks running out to the corners and serifs, and the scraps of valley
//    line inside a junction, belong to the stroke they lead from and are cut
//    straight after it. They are stop cuts, not strokes, and are not numbered.
//  - A dot (a full stop, each dot of a colon, the head of a quotation mark, a
//    word stop) has no stroke running through it: its valley is only forks
//    out to its edge. It is one stroke of its own, cut as a single plunge at
//    its centre, its deepest point, down to the valley depth less the slit
//    margin, with its forks as its stop cuts (BRIEF.md, Decisions: "Dots").

import type { Pt } from './geometry';
import type { ValleyLine, ValleyPt } from './valley';

export interface Stroke {
  /**
   * Each part is cut as one path. A stroke crossed by a thicker one has a part
   * each side of it. A dot has one part of a single point: a plunge at its centre.
   */
  parts: ValleyLine[];
  /** The forks into its corners and serifs, and scraps of junction, cut straight after it. */
  extras: ValleyLine[];
  /** Average width along the stroke, mm. */
  width: number;
}

/** A run may turn by at most this much through a junction and still be the same stroke, degrees. */
export const MAX_TURN = 25;
/** Strokes whose average widths differ by less than this fraction count as equal width. */
export const EQUAL_WIDTH = 0.03;

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const pathLength = (v: Pt[]) => v.reduce((s, p, i) => (i ? s + dist(v[i - 1], p) : 0), 0);

/** Average width (2r) along a run, by length. */
export function runWidth(v: ValleyLine): number {
  const len = pathLength(v);
  if (len <= 0) return 2 * (v[0]?.r ?? 0);
  return v.reduce((s, p, i) => (i ? s + (p.r + v[i - 1].r) * dist(v[i - 1], p) : 0), 0) / len;
}

/**
 * Whether a run of valley line is a fork: it runs out towards a corner or a
 * serif tip (one end has narrowed to under a third of its widest) and it is
 * short for its width (under three times as long as it is wide). A stroke's
 * own valley stays wide to both ends, where it meets its forks or other
 * strokes; one that tapers away to a point is long for its width.
 */
export function isFork(v: ValleyLine): boolean {
  if (v.length < 2) return true;
  const maxR = Math.max(...v.map((p) => p.r));
  const endR = Math.min(v[0].r, v[v.length - 1].r);
  return endR < 0.3 * maxR && pathLength(v) < 3 * (2 * maxR);
}

/** The point `d` mm along a run from one end. */
function pointAlong(v: ValleyLine, d: number): Pt {
  let left = d;
  for (let i = 1; i < v.length; i++) {
    const s = dist(v[i - 1], v[i]);
    if (s >= left && s > 0) {
      const t = left / s;
      return { x: v[i - 1].x + t * (v[i].x - v[i - 1].x), y: v[i - 1].y + t * (v[i].y - v[i - 1].y) };
    }
    left -= s;
  }
  return v[v.length - 1];
}

/**
 * Which way a run leaves its end `end` (0 = start, 1 = finish), as a unit
 * vector. Judged a little way out, from about three quarters of a stroke width
 * to two widths along, past the bend every valley makes as it swings into a
 * junction.
 */
export function heading(v: ValleyLine, end: 0 | 1): Pt {
  const run = end === 0 ? v : v.slice().reverse();
  const len = pathLength(run);
  const r = run[0].r;
  const far = Math.min(len / 2, Math.max(1, 4 * r));
  const near = Math.min(far / 2, 1.5 * r);
  const a = pointAlong(run, near);
  const b = pointAlong(run, far);
  const n = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / n, y: (b.y - a.y) / n };
}

/** How far (degrees) a run arriving along `a` turns to leave along `b`: 0 is straight on. */
export function turn(a: Pt, b: Pt): number {
  // a points into one run from the junction, b into the other: straight on is a = -b.
  const c = Math.max(-1, Math.min(1, -(a.x * b.x + a.y * b.y)));
  return (Math.acos(c) * 180) / Math.PI;
}

/** Union-find over 0..n-1. */
function groups(n: number) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  return { find, join: (a: number, b: number) => void (parent[find(a)] = find(b)) };
}

interface Port {
  run: number;
  end: 0 | 1;
  /** The junction (after joining up junctions linked by short scraps). */
  junction: number;
  /** The exact point where the run ends. */
  at: ValleyPt;
  dir: Pt;
}

/** The strokes of one letter (or word stop, or border), in cutting order. */
export function strokesOf(valleys: ValleyLine[]): Stroke[] {
  const lines = valleys.filter((v) => v.length >= 2);
  // Forks, and hairs of valley far thinner than the letter's strokes (left by a
  // serif), are cut with the stroke they belong to but are not strokes.
  if (!lines.length) return [];
  const widest = Math.max(0, ...lines.map(runWidth));
  const mains = lines.filter((v) => !isFork(v) && runWidth(v) >= 0.2 * widest);
  const forks = lines.filter((v) => !mains.includes(v));

  // Run ends that meet are the same point.
  const nodes: ValleyPt[] = [];
  const nodeOf = (p: ValleyPt) => {
    let i = nodes.findIndex((q) => dist(p, q) < 0.01);
    if (i < 0) i = nodes.push(p) - 1;
    return i;
  };
  const ends = mains.map((v) => [nodeOf(v[0]), nodeOf(v[v.length - 1])] as const);
  const degree = new Array(nodes.length).fill(0);
  for (const [a, b] of ends) {
    degree[a]++;
    degree[b]++;
  }

  // A scrap: a run shorter than about its own width, joining two junctions. The
  // two junctions are really one, and the scrap is part of it.
  const scrap = mains.map((v, i) => {
    const [a, b] = ends[i];
    const w = 2 * Math.max(v[0].r, v[v.length - 1].r);
    return a !== b && degree[a] >= 2 && degree[b] >= 2 && pathLength(v) < 1.25 * w;
  });
  const junctions = groups(nodes.length);
  mains.forEach((_, i) => {
    if (scrap[i]) junctions.join(ends[i][0], ends[i][1]);
  });
  // A crumb: any other run shorter than the stroke is wide. Not a stroke.
  const crumb = mains.map((v, i) => !scrap[i] && pathLength(v) < 2 * Math.max(...v.map((p) => p.r)));
  forks.push(...mains.filter((_, i) => crumb[i]));

  const ports: Port[] = [];
  mains.forEach((v, i) => {
    if (scrap[i] || crumb[i]) return;
    for (const end of [0, 1] as const) {
      ports.push({ run: i, end, junction: junctions.find(ends[i][end]), at: end === 0 ? v[0] : v[v.length - 1], dir: heading(v, end) });
    }
  });
  const widths = mains.map(runWidth);

  // At each junction, pair up runs that carry straight on: thicker first. A run
  // that comes back round to where it started (the ring of O or Q) closes on itself.
  const candidates: { p: number; q: number; width: number; turn: number }[] = [];
  for (let p = 0; p < ports.length; p++)
    for (let q = p + 1; q < ports.length; q++) {
      const a = ports[p];
      const b = ports[q];
      if (a.junction !== b.junction) continue;
      const ring = a.run === b.run;
      const t = turn(a.dir, b.dir);
      if (ring || t <= MAX_TURN) candidates.push({ p, q, width: ring ? Infinity : (widths[a.run] + widths[b.run]) / 2, turn: t });
    }
  candidates.sort((a, b) => b.width - a.width || a.turn - b.turn);
  const partner = new Array<number>(ports.length).fill(-1);
  for (const c of candidates) {
    if (partner[c.p] >= 0 || partner[c.q] >= 0) continue;
    partner[c.p] = c.q;
    partner[c.q] = c.p;
  }

  // Runs joined through junctions make one stroke.
  const strokeOf = groups(mains.length);
  ports.forEach((a, i) => {
    if (partner[i] >= 0) strokeOf.join(a.run, ports[partner[i]].run);
  });
  const members = new Map<number, number[]>();
  mains.forEach((_, i) => {
    if (scrap[i] || crumb[i]) return;
    const s = strokeOf.find(i);
    members.set(s, [...(members.get(s) ?? []), i]);
  });

  // Pieces of the mark that no stroke runs through are dots (see above). The
  // runs of valley line fall into pieces where they meet end to end.
  const piece = groups(lines.length);
  const at = new Map<number, number>(); // node → a run ending there
  lines.forEach((v, i) => {
    for (const p of [v[0], v[v.length - 1]]) {
      const n = nodeOf(p);
      if (at.has(n)) piece.join(i, at.get(n)!);
      else at.set(n, i);
    }
  });
  const strokeRuns = new Set([...members.values()].flat().map((i) => mains[i]));
  const withStroke = new Set(lines.map((v, i) => (strokeRuns.has(v) ? piece.find(i) : -1)));
  const dotPieces = new Map<number, ValleyLine[]>();
  lines.forEach((v, i) => {
    const k = piece.find(i);
    if (!withStroke.has(k)) dotPieces.set(k, [...(dotPieces.get(k) ?? []), v]);
  });
  // A piece is a dot only if it is a real part of the mark: about as wide as the
  // mark's strokes, and standing clear of them. A hair of valley line left
  // apart in a serif's bracket is not; it is cut with the nearest stroke.
  const deepest = Math.max(...lines.flatMap((v) => v.map((q) => q.r)));
  const strokePts = [...strokeRuns].flat();
  const dots = [...dotPieces.values()]
    .map((runs) => {
      // Its centre: the point furthest from its edge, where the valley is deepest.
      let centre = runs[0][0];
      for (const v of runs) for (const q of v) if (q.r > centre.r) centre = q;
      return { runs, centre };
    })
    .filter(({ centre }) => centre.r >= 0.3 * deepest && strokePts.every((q) => dist(q, centre) > centre.r + q.r));
  const inDot = new Set(dots.flatMap((d) => d.runs));

  // Cutting order: thin first; equal widths left to right, then top to bottom.
  // A dot's width is the width at its centre.
  const list: { runs: number[]; width: number; mid: Pt; dot?: (typeof dots)[number] }[] = [...members.values()].map((runs) => {
    const len = runs.reduce((s, i) => s + pathLength(mains[i]), 0);
    const width = len > 0 ? runs.reduce((s, i) => s + widths[i] * pathLength(mains[i]), 0) / len : widths[runs[0]];
    const pts = runs.flatMap((i) => mains[i]);
    const mid = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
    return { runs, width, mid };
  });
  for (const d of dots) list.push({ runs: [], width: 2 * d.centre.r, mid: d.centre, dot: d });
  list.sort((a, b) => a.width - b.width);
  const ordered: typeof list = [];
  for (let i = 0; i < list.length; ) {
    let j = i + 1;
    while (j < list.length && list[j].width - list[i].width <= EQUAL_WIDTH * list[j].width) j++;
    ordered.push(...list.slice(i, j).sort((a, b) => a.mid.x - b.mid.x || a.mid.y - b.mid.y));
    i = j;
  }
  const rank = new Map<number, number>();
  ordered.forEach((s, k) => s.runs.forEach((r) => rank.set(r, k)));

  // At each junction only the stroke cut last goes straight through in one cut;
  // any other stroke passing through stops there, in two parts.
  const through = new Map<number, number>(); // junction → rank of the stroke continuous there
  ports.forEach((a, i) => {
    if (partner[i] < 0) return;
    const k = rank.get(a.run)!;
    if ((through.get(a.junction) ?? -1) < k) through.set(a.junction, k);
  });
  const joined = (i: number) => partner[i] >= 0 && through.get(ports[i].junction) === rank.get(ports[i].run);

  // Scraps inside a junction that a continuous stroke crosses become part of its cut.
  const scrapsAt = (junction: number) => mains.map((_, i) => i).filter((i) => scrap[i] && junctions.find(ends[i][0]) === junction);
  const usedScraps = new Set<number>();
  const bridge = (from: ValleyPt, to: ValleyPt, junction: number): ValleyPt[] => {
    if (dist(from, to) < 0.01) return [];
    // The shortest way through the junction's scraps from one run end to the other.
    const scraps = scrapsAt(junction);
    const key = (p: ValleyPt) => nodeOf(p);
    const start = key(from);
    const goal = key(to);
    const best = new Map<number, { d: number; path: ValleyPt[]; via: number[] }>([[start, { d: 0, path: [], via: [] }]]);
    const queue = [start];
    while (queue.length) {
      queue.sort((a, b) => best.get(a)!.d - best.get(b)!.d);
      const n = queue.shift()!;
      const here = best.get(n)!;
      for (const s of scraps) {
        const [a, b] = ends[s];
        if (a !== n && b !== n) continue;
        const v = a === n ? mains[s] : mains[s].slice().reverse();
        const m = a === n ? b : a;
        const d = here.d + pathLength(v);
        if (d < (best.get(m)?.d ?? Infinity)) {
          best.set(m, { d, path: [...here.path, ...v.slice(1)], via: [...here.via, s] });
          queue.push(m);
        }
      }
    }
    const found = best.get(goal);
    if (!found) return [to];
    found.via.forEach((s) => usedScraps.add(s));
    return found.path;
  };

  const out: Stroke[] = ordered.map((s) => {
    if (s.dot) return { parts: [[s.dot.centre]], extras: s.dot.runs, width: s.width };
    const parts: ValleyLine[] = [];
    const todo = new Set(s.runs);
    const portIndex = (run: number, end: 0 | 1) => ports.findIndex((p) => p.run === run && p.end === end);
    // Follow the stroke from an end where it is not joined on (or anywhere, for a ring).
    const startRun = () => {
      for (const r of todo) for (const e of [0, 1] as const) if (!joined(portIndex(r, e))) return { run: r, end: e };
      const r = todo.values().next().value!;
      return { run: r, end: 0 as const };
    };
    while (todo.size) {
      let { run, end } = startRun();
      const path: ValleyPt[] = [];
      for (;;) {
        todo.delete(run);
        const v = end === 0 ? mains[run] : mains[run].slice().reverse();
        path.push(...(path.length ? v.slice(1) : v));
        const out = portIndex(run, end === 0 ? 1 : 0);
        if (!joined(out)) break;
        const next = ports[partner[out]];
        if (!todo.has(next.run)) {
          // Back round to the start: a ring, like O.
          path.push(...bridge(path[path.length - 1], next.at, next.junction));
          break;
        }
        path.push(...bridge(path[path.length - 1], next.at, next.junction));
        run = next.run;
        end = next.end;
      }
      parts.push(path);
    }
    return { parts, extras: [], width: s.width };
  });

  // Forks and leftover scraps go with the stroke they lead from: the nearest
  // stroke to the fork's wide end (the one cut later, where two are as near).
  // A dot's own forks are already with it.
  const extras = [...forks, ...mains.filter((_, i) => scrap[i] && !usedScraps.has(i))].filter((f) => !inDot.has(f));
  const strokes = out.filter((_, k) => !ordered[k].dot);
  if (!strokes.length) strokes.push(...out); // only dots: the leftovers go with the nearest dot
  for (const f of extras) {
    const wide = f[0].r >= f[f.length - 1].r ? f[0] : f[f.length - 1];
    let best: Stroke | null = null;
    let bestD = Infinity;
    for (const s of strokes) {
      const d = Math.min(...s.parts.flatMap((p) => p.map((q) => dist(q, wide))));
      if (d <= bestD + 1e-6) [best, bestD] = [s, d];
    }
    best?.extras.push(f);
  }
  return out;
}
