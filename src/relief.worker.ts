// The 3D view's heavy work, away from the page so it never freezes
// (relief-job.ts). It reports how far through it is now and then; the page
// stops it outright (terminates the worker) to cancel.

import { runJob, type ReliefJob } from './relief-job';

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
    self.postMessage({ result }, { transfer: [result.half.buffer] });
  } catch (err) {
    self.postMessage({ id: job.id, error: String(err) });
  }
};
