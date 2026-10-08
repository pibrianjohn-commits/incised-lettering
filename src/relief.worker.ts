// The 3D view's heavy work, away from the page so it never freezes
// (relief-job.ts). It reports how far through it is now and then; the page
// stops it outright (terminates the worker) to cancel. Every answer carries
// its version, so the page can show that the two belong together.

import { runJob, type ReliefJob } from './relief-job';
import { APP_VERSION } from './version';

self.onmessage = (e: MessageEvent<ReliefJob>) => {
  const job = e.data;
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
