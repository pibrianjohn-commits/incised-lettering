// Performance check for the 3D view, in real browsers (Chromium and Firefox,
// through Playwright), with the computer slowed 4× to stand in for an
// ordinary laptop (CLAUDE.md: test every heavy feature with the CPU slowed 4×,
// in Firefox and Chrome).
//
//   npm run build && npm run test:perf3d      (or npm run test:browser, for every browser test)
//
// Passes when:
//   - the 3D view of a full-bed panel (300 × 205 mm) is on screen within 3 s;
//   - panels up to 1000 × 1000 mm open without freezing the page: none of the
//     page's own work holds it up for more than MAX_TASK ms at a time (so it
//     always answers the mouse and keys), and Esc cancels the work.
//
// The test machine has no graphics chip, so the browser draws the 3D picture
// in software and the page waits for it; a laptop's graphics chip does that
// work instead. In Chromium that waiting is measured and reported, but not
// counted as the page's own work.
//
// Chromium is slowed by its own setting, which slows the page. Firefox has
// none, so the processes that run its pages (each page with its worker) are
// held to a quarter of one processor core between them (browsers.mjs), which
// is harsher; its drawing is left at full speed, as Chromium's is. Firefox has
// no trace of the page's work either, so there the page itself times how long
// it goes without answering, drawing included.
//
// Playwright and Firefox: see browsers.mjs. BROWSERS=chromium or firefox runs one.

import { preview } from 'vite';
import { BROWSERS, done, launch, slowFirefoxPages } from './browsers.mjs';

const SLOWDOWN = 4;
const OPEN_LIMIT = 3000; // ms, full bed
const MAX_TASK = 250; // ms of the page's own work at once
const TEXT = 'IN LOVING MEMORY OF\nJOHN WILLIAM SMITH\n1920 – 2001\nREST IN PEACE';
/** Waiting for the graphics process (here, software drawing), not the page's own work. */
const GPU_WAITS = new Set(['CommandBufferProxyImpl::WaitForGetOffset', 'CommandBufferProxyImpl::WaitForToken', 'GLES2::ReadPixels', 'GLES2::Finish', 'CommandBufferHelper::Finish', 'ImplementationBase::WaitForCmd']);

// The built site, served by Vite's own preview server, on a free port.
const server = await preview({ preview: { port: 4300 + Math.floor(Math.random() * 600), open: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];

let browser;
let name;
let slowPages = () => false;
let failed = 0;
const check = (ok, text) => {
  console.log(`${ok ? '✓' : '✗'} ${text}`);
  if (!ok) failed++;
};

/** The page's main thread in a trace: its events, and how long it spent waiting for the graphics process between two times (µs). */
function mainThread(trace) {
  const ev = trace.traceEvents;
  const main = ev.find((e) => e.name === 'thread_name' && e.args.name === 'CrRendererMain');
  const onMain = ev.filter((e) => e.pid === main.pid && e.tid === main.tid && e.ph === 'X');
  const waits = onMain.filter((e) => GPU_WAITS.has(e.name));
  // Only the outermost waits, so none is counted twice.
  const outer = waits.filter((e) => !waits.some((o) => o !== e && o.ts <= e.ts && o.ts + o.dur >= e.ts + e.dur && o.dur > e.dur));
  const waiting = (from, to) => outer.reduce((s, e) => s + Math.max(0, Math.min(to, e.ts + e.dur) - Math.max(from, e.ts)), 0);
  return { onMain, waiting };
}

/** The longest main-thread task in a trace, in all and without the waits for the graphics process (ms). */
function longestTasks(trace) {
  const { onMain, waiting } = mainThread(trace);
  let all = 0;
  let own = 0;
  for (const t of onMain.filter((e) => e.name === 'RunTask' && e.dur > 50000)) {
    all = Math.max(all, t.dur / 1000);
    own = Math.max(own, (t.dur - waiting(t.ts, t.ts + t.dur)) / 1000);
  }
  return { all: Math.round(all), own: Math.round(own) };
}

/** In Firefox: the page times itself, keeping the longest it went without answering (ms). */
const startProbe = (page) =>
  page.evaluate(() => {
    let last = performance.now();
    window.__heldUp = 0;
    window.__probe = setInterval(() => {
      const now = performance.now();
      window.__heldUp = Math.max(window.__heldUp, now - last - 20);
      last = now;
    }, 20);
  });

async function openBoard(width, height, state) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
  page.on('pageerror', (e) => check(false, `no page errors (${e.message})`));
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('#loading', { state: 'hidden' });
  await page.fill('#text', TEXT);
  await page.click('#stages [data-stage="panel"]');
  await page.fill('#panelWidth', String(width));
  await page.press('#panelWidth', 'Enter');
  await page.fill('#panelHeight', String(height));
  await page.press('#panelHeight', 'Enter');
  await page.click('#fit-lettering [data-fit="both"]');
  if (state === 'finished') await page.click('#stages [data-stage="3d"]').then(() => page.click('#v3d-state [data-state="finished"]')).then(() => page.click('#stages [data-stage="panel"]'));
  await page.waitForTimeout(4500); // settled, as after a moment's thought
  const before = await page.evaluate(() => document.body.dataset.board3d ?? '');
  let slowed = true;
  if (name === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOWDOWN });
    await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'gpu'] });
  } else {
    slowed = slowPages();
    await startProbe(page);
  }
  const t0 = Date.now();
  await page.click('#stages [data-stage="3d"]');
  await page.waitForFunction((b) => (document.body.dataset.board3d ?? '') !== b, before, { timeout: 60000, polling: 20 });
  const opened = Date.now() - t0;
  await page.waitForTimeout(1000);
  const tasks =
    name === 'chromium'
      ? longestTasks(JSON.parse((await browser.stopTracing()).toString()))
      : await page.evaluate(() => {
          clearInterval(window.__probe);
          return { own: Math.round(window.__heldUp), all: Math.round(window.__heldUp) };
        });
  return { page, opened, tasks, slowed };
}

try {
  for (name of BROWSERS) {
    console.log(`${name}:`);
    browser = await launch(name);
    if (name === 'firefox') slowPages = slowFirefoxPages(SLOWDOWN);
    for (const [w, h, state] of [
      [300, 196, 'marked'], // the board that hung (7 Oct 2026)
      [300, 205, 'marked'],
      [300, 205, 'finished'],
      [1000, 1000, 'marked'],
      [1000, 1000, 'finished'],
    ]) {
      const { page, opened, tasks, slowed } = await openBoard(w, h, state);
      const what = `${name}, ${w} × ${h} mm, ${state === 'marked' ? 'marked out' : 'finished'}, ${slowed ? `CPU ${SLOWDOWN}× slower` : 'CPU NOT SLOWED (not possible on this machine)'}`;
      if (w <= 300) check(opened <= OPEN_LIMIT, `${what}: on screen in ${opened} ms (limit ${OPEN_LIMIT})`);
      else console.log(`  ${what}: on screen in ${opened} ms`);
      if (name === 'chromium') check(tasks.own <= MAX_TASK, `${what}: the page's own work held it up for at most ${tasks.own} ms at once (limit ${MAX_TASK}; ${tasks.all} ms with the software drawing)`);
      else check(tasks.all <= MAX_TASK, `${what}: the page went without answering for at most ${tasks.all} ms at once, drawing included (limit ${MAX_TASK})`);
      if (w === 1000) {
        // Esc while the board is being worked out: the work stops, and the board shown stays (no
        // new one arrives later). How quickly the page answers a key is bounded by the check above.
        const shown = await page.evaluate(() => document.body.dataset.board3d);
        await page.evaluate((other) => {
          document.querySelector(`#v3d-state [data-state="${other}"]`).click();
          document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        }, state === 'marked' ? 'finished' : 'marked');
        await page.waitForTimeout(3000);
        const after = await page.evaluate(() => ({
          working: !document.getElementById('v3d-working').hidden,
          open: !document.getElementById('v3d').hidden,
          board: document.body.dataset.board3d,
          message: document.getElementById('st-msg').textContent,
        }));
        check(!after.working && after.open && after.board === shown && /Cancelled/.test(after.message), `${what}: Esc stopped the work, and the board shown stayed`);
      }
      await page.close();
    }
    await browser.close();
    browser = null;
  }
} finally {
  await browser?.close();
  await server.close();
  done();
}
console.log(failed ? `${failed} check(s) failed` : 'All 3D performance checks passed');
process.exit(failed ? 1 : 0);
