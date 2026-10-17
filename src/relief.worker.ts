// The 3D view's heavy work, away from the page so it never freezes
// (relief-job.ts). It reports how far through it is now and then; the page
// stops it outright (terminates the worker) to cancel. Every answer carries
// its version, so the page can show that the two belong together.
//
// The same program, in an instance of its own, works out the valley lines of
// letters linked into one shape (letters.ts), which take a moment each: the
// page shows their outlines meanwhile.
//
// The ornament's lid in 3D (ornament/relief.ts) is worked out here too, in an
// instance of its own, so it never waits on the lettering's board.

import { datumLines, type DatumRule } from './datum';
import type { Contour } from './geometry';
import { runJob, toHalf, type ReliefJob } from './relief-job';
import { runLidJob, type LidJob } from './ornament/relief';
import { letterValleyOptions, valleyLines, type ValleyLine } from './valley';
import { APP_VERSION } from './version';

/** A linked run's joined outline (cap height 1), to work out its valley lines; or its valley lines at a size, for its datum lines. */
export type ShapeJob = { kind: 'valleys'; key: string; outline: Contour[] } | { kind: 'datum'; key: string; valleys: ValleyLine[]; rule: DatumRule };

self.onmessage = (e: MessageEvent<ReliefJob | ShapeJob | LidJob>) => {
  const data = e.data;
  if ('kind' in data && data.kind === 'ornament3d') {
    let last = 0;
    try {
      const result = runLidJob(data, (done) => {
        const now = performance.now();
        if (now - last < 40) return;
        last = now;
        self.postMessage({ kind: 'ornament3d', id: data.id, progress: done });
      }, toHalf);
      const transfer = result.maps.flatMap((m) => [m.half.buffer, m.finish.buffer]);
      self.postMessage({ kind: 'ornament3d', result, version: APP_VERSION }, { transfer });
    } catch (err) {
      self.postMessage({ kind: 'ornament3d', id: data.id, error: String(err), version: APP_VERSION });
    }
    return;
  }
  if ('kind' in data) {
    try {
      const answer = data.kind === 'valleys' ? { valleys: valleyLines(data.outline, letterValleyOptions) } : { datum: datumLines(data.valleys, data.rule) };
      self.postMessage({ kind: data.kind, key: data.key, ...answer, version: APP_VERSION });
    } catch (err) {
      self.postMessage({ kind: data.kind, key: data.key, error: String(err), version: APP_VERSION });
    }
    return;
  }
  const job = data as ReliefJob;
  let last = 0;
  try {
    const result = runJob(job, (done) => {
      const now = performance.now();
      if (now - last < 40) return;
      last = now;
      self.postMessage({ id: job.id, progress: done });
    });
    self.postMessage({ result, version: APP_VERSION }, { transfer: [result.half.buffer] });
  } catch (err) {
    const stack = err instanceof Error && err.stack ? err.stack : '';
    self.postMessage({ id: job.id, error: String(err), stack, version: APP_VERSION });
  }
};
