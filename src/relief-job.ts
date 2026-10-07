// One piece of work for the 3D view: the depth map of the board, or of an
// area of it, ready to hand to the graphics chip. It runs in a worker
// (relief.worker.ts) so the page never freezes, and is kept separate from it
// so the tests can run it directly.

import type { Border, Layout } from './layout';
import { chooseRes, finishedReliefFrom, machinedReliefPacked, packCuts, unpackShapes, type Area, type Progress } from './relief';
import { buildPasses, type MachineSettings } from './toolpath';

/**
 * The work, in plain lists of numbers where it is big (quick to hand over):
 * marked out, from the cuts (or, if they are not worked out yet, from the
 * layout); finished, from the letters' outlines and the border.
 */
export interface ReliefJob {
  /** Each job has its own number; only the newest one's answer is used. */
  id: number;
  state: 'marked' | 'finished';
  width: number;
  height: number;
  machine: MachineSettings;
  /** Just this area, at as much detail as the size allows ("Sharper"), or null for the whole board. */
  area: Area | null;
  /** Marked out: the cuts (packCuts), or the layout to work them out from. */
  cuts?: Float32Array;
  layout?: Layout;
  /** Finished: the outlines (packShapes), the border, and the widest stroke's half-width. */
  shapes?: Float32Array;
  border?: Border;
  datum?: { percent: number; minimum: number };
  widest?: number;
}

export interface ReliefResult {
  id: number;
  /** The area covered, and its cells. */
  x0: number;
  y0: number;
  cols: number;
  rows: number;
  res: number;
  maxDepth: number;
  /**
   * The depths as half-precision numbers, as the graphics chip takes them,
   * rows from the bottom edge (the front of the board) up.
   */
  half: Uint16Array;
}

export function runJob(job: ReliefJob, progress: Progress = () => {}): ReliefResult {
  const area = job.area ?? { x0: 0, y0: 0, x1: job.width, y1: job.height };
  const w = area.x1 - area.x0;
  const h = area.y1 - area.y0;
  const res = chooseRes(w, h);
  let r;
  if (job.state === 'marked') {
    const cuts = job.cuts ?? packCuts(buildPasses(job.layout!, job.machine));
    progress(0.1);
    r = machinedReliefPacked(cuts, job.machine.toolAngle, area, res, (f) => progress(0.1 + 0.8 * f));
  } else {
    const input = { shapes: unpackShapes(job.shapes!), width: job.width, height: job.height, border: job.border!, datum: job.datum!, widest: job.widest! };
    r = finishedReliefFrom(input, job.machine, res, area, (f) => progress(0.9 * f));
  }
  progress(0.9);

  // Depths for the graphics chip, front row first.
  const half = new Uint16Array(r.cols * r.rows);
  for (let j = 0; j < r.rows; j++) {
    const src = j * r.cols;
    const dst = (r.rows - 1 - j) * r.cols;
    for (let i = 0; i < r.cols; i++) half[dst + i] = toHalf(r.depth[src + i]);
  }

  progress(1);
  return { id: job.id, x0: r.x0, y0: r.y0, cols: r.cols, rows: r.rows, res: r.res, maxDepth: r.maxDepth, half };
}

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** A depth (0 or more, mm) as a half-precision number: about 0.1% accuracy, plenty for the eye. */
export function toHalf(v: number): number {
  if (!(v > 0)) return 0;
  f32[0] = v;
  const bits = u32[0];
  const e = (bits >>> 23) & 0xff;
  if (e < 103) return 0; // too small to matter
  if (e > 142) return 0x7bff; // the largest there is
  if (e < 113) return ((bits & 0x7fffff) | 0x800000) >>> (126 - e); // very small: no exponent
  return ((e - 112) << 10) | ((bits >>> 13) & 0x3ff);
}
