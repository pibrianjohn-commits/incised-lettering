// The ornament's lid in 3D (ornament/design/CARD_05_3d_view.md), with the
// computer slowed 4× to stand in for an ordinary laptop. Chromium only, as
// the card asks.
//
//   npm run build && npm run test:ornament3d
//
// Passes when, with the CPU slowed 4×:
//   - a layer dragged about in Flat for a few seconds (the 3D view following
//     it in the background) never holds the page up for more than MAX_TASK ms
//     of its own work at once, so the drag stays smooth;
//   - switching to 3D afterwards shows the lid as it now is within FOLLOW ms;
//   - in 3D, turning the lid with the mouse while the layer is nudged from
//     the keyboard never holds the page up for more than MAX_TASK ms, and the
//     lid shown catches up within FOLLOW ms of the last nudge.
// SHOTS=<folder> also saves the lid under a raking light from the left and
// from the front, for the report.
//
// Playwright: see browsers.mjs.

import { preview } from 'vite';
import { done, launch } from './browsers.mjs';

const SLOWDOWN = 4;
const MAX_TASK = 250; // ms of the page's own work at once
const FOLLOW = 1500; // ms: "within about a second", slowed 4×
/** Waiting for the graphics process (here, software drawing), not the page's own work. */
const GPU_WAITS = new Set(['CommandBufferProxyImpl::WaitForGetOffset', 'CommandBufferProxyImpl::WaitForToken', 'GLES2::ReadPixels', 'GLES2::Finish', 'CommandBufferHelper::Finish', 'ImplementationBase::WaitForCmd']);

const server = await preview({ preview: { port: 4300 + Math.floor(Math.random() * 600), open: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];

let failed = 0;
const check = (ok, text) => {
  console.log(`${ok ? '✓' : '✗'} ${text}`);
  if (!ok) failed++;
};

/** The longest main-thread task in a trace, without the waits for the graphics process (ms). */
function longestOwnTask(trace) {
  const ev = trace.traceEvents;
  const main = ev.find((e) => e.name === 'thread_name' && e.args.name === 'CrRendererMain');
  const onMain = ev.filter((e) => e.pid === main.pid && e.tid === main.tid && e.ph === 'X');
  const waits = onMain.filter((e) => GPU_WAITS.has(e.name));
  const outer = waits.filter((e) => !waits.some((o) => o !== e && o.ts <= e.ts && o.ts + o.dur >= e.ts + e.dur && o.dur > e.dur));
  const waiting = (from, to) => outer.reduce((s, e) => s + Math.max(0, Math.min(to, e.ts + e.dur) - Math.max(from, e.ts)), 0);
  let own = 0;
  let all = 0;
  for (const t of onMain.filter((e) => e.name === 'RunTask' && e.dur > 20000)) {
    all = Math.max(all, t.dur / 1000);
    own = Math.max(own, (t.dur - waiting(t.ts, t.ts + t.dur)) / 1000);
  }
  return { own: Math.round(own), all: Math.round(all) };
}

// A lid from the lid add-on: the 204 × 96 field, 6 thick, and four hips at 20.556°, 34 wide laid flat.
const SLOPE = 20.556;
const HIP = 34;
const PD = HIP * Math.cos((SLOPE * Math.PI) / 180);
const hip = (place, top) => {
  const foot = top + 2 * PD;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${foot}mm" height="${HIP}mm" viewBox="0 0 ${foot} ${HIP}" data-place="${place}" data-lid="walnut-box" data-slope="${SLOPE}" data-plan-depth="${PD}"><path id="outline" d="M ${PD} 0 L ${PD + top} 0 L ${foot} ${HIP} L 0 ${HIP} Z"/></svg>`;
};
const field = `<svg xmlns="http://www.w3.org/2000/svg" width="204mm" height="96mm" viewBox="0 0 204 96" data-place="field" data-lid="walnut-box" data-thickness="6"><path id="outline" d="M 0 0 L 204 0 L 204 96 L 0 96 Z"/></svg>`;
const files = [
  ['field.svg', field],
  ['hip-front.svg', hip('hip-front', 204)],
  ['hip-right.svg', hip('hip-right', 96)],
  ['hip-back.svg', hip('hip-back', 204)],
  ['hip-left.svg', hip('hip-left', 96)],
].map(([name, text]) => ({ name, mimeType: 'image/svg+xml', buffer: Buffer.from(text) }));

/** Until the lid on screen is the lid as it now is (ms), or null if it never is. */
async function caughtUp(page, since, limit = 20000) {
  const t0 = Date.now();
  try {
    await page.waitForFunction((was) => document.body.dataset.orn3d !== was && document.body.dataset.orn3dCurrent === 'true', since, { timeout: limit, polling: 20 });
    return Date.now() - t0;
  } catch {
    return null;
  }
}

const browser = await launch('chromium');
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => check(false, `no page errors (${e.message})`));
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('#loading', { state: 'hidden' });
  await page.click('#stages [data-stage="ornament"]');
  await page.setInputFiles('#orn-lid-file', files);
  for (const add of ['zone:border', 'zone:centre', 'rect', 'ellipse']) await page.click(`#orn-add [data-add="${add}"]`);
  const layer = (i) => page.locator('#orn-layers .orn-layer').nth(i);
  await layer(0).locator('[data-edge="v"]').click();
  await layer(0).locator('select[data-f="finish"]').selectOption('gold');
  await layer(1).locator('select[data-f="finish"]').selectOption('white-gold');
  await layer(2).locator('input[data-f="level"]').fill('1');
  await layer(2).locator('select[data-f="finish"]').selectOption('boxwood');
  await layer(3).locator('input[data-f="level"]').fill('3');
  await layer(3).locator('[data-edge="v"]').click();
  await page.click('#orn-lidview [data-lidview="3d"]');
  const first = await caughtUp(page, undefined, 30000);
  check(first !== null, `the lid is on screen in 3D (in ${first} ms, CPU at full speed)`);

  if (process.env.SHOTS) {
    await page.click('#orn-light-quick [data-from="-90"]');
    await page.waitForTimeout(400);
    await page.locator('#orn').screenshot({ path: `${process.env.SHOTS}/card05-3d-left.png` });
    await page.click('#orn-light-quick [data-from="180"]');
    await page.waitForTimeout(400);
    await page.locator('#orn').screenshot({ path: `${process.env.SHOTS}/card05-3d-front.png` });
    await page.click('#orn-light-quick [data-from="-90"]');
  }

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOWDOWN });

  // Flat: drag the ellipse about for a few seconds, the 3D view following in the background.
  await page.click('#orn-lidview [data-lidview="flat"]');
  await page.waitForTimeout(500);
  const shape = page.locator('#orn-canvas path.orn-shape:not(.twin)').last();
  const box = await shape.boundingBox();
  await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'gpu'] });
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 60; i++) {
    await page.mouse.move(cx + 40 * Math.sin(i / 6), cy + 25 * Math.sin(i / 9));
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
  const dragTask = longestOwnTask(JSON.parse((await browser.stopTracing()).toString()));
  check(dragTask.own <= MAX_TASK, `dragging a layer in Flat, CPU ${SLOWDOWN}× slower: the page's own work held it up for at most ${dragTask.own} ms at once (limit ${MAX_TASK}; ${dragTask.all} ms with the software drawing)`);
  const before = await page.evaluate(() => document.body.dataset.orn3d);
  await page.click('#orn-lidview [data-lidview="3d"]');
  const back = await caughtUp(page, before);
  check(back !== null && back <= FOLLOW, `back in 3D, the lid as dragged is on screen in ${back} ms (limit ${FOLLOW})`);

  // 3D: turn the lid with the mouse while the layer is nudged from the keyboard.
  const canvas = await page.locator('#orn-3d-canvas canvas').boundingBox();
  // Where the ellipse is, as the lid kept in the browser has it.
  const ellipseAt = () => page.evaluate(() => [...JSON.parse(localStorage.getItem('incised.ornament.lid')).files.field.matchAll(/data-shape="ellipse" data-box="([^"]+)"/g)].map((m) => m[1])[0]);
  const was = await ellipseAt();
  await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'gpu'] });
  const ox = canvas.x + canvas.width / 2;
  const oy = canvas.y + canvas.height / 2;
  await page.mouse.move(ox, oy);
  await page.mouse.down();
  for (let i = 1; i <= 40; i++) {
    await page.mouse.move(ox + 120 * Math.sin(i / 8), oy + 30 * Math.sin(i / 11));
    if (i % 4 === 0) await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
  const shown = await page.evaluate(() => document.body.dataset.orn3d);
  const now = await ellipseAt();
  check(now !== was, `the nudges moved the layer (from ${was} to ${now})`);
  const turnTask = longestOwnTask(JSON.parse((await browser.stopTracing()).toString()));
  check(turnTask.own <= MAX_TASK, `turning the lid in 3D while a layer is nudged, CPU ${SLOWDOWN}× slower: the page's own work held it up for at most ${turnTask.own} ms at once (limit ${MAX_TASK}; ${turnTask.all} ms with the software drawing)`);
  const after = (await page.evaluate(() => document.body.dataset.orn3dCurrent)) === 'true' ? 0 : await caughtUp(page, shown);
  check(after !== null && after <= FOLLOW, `the lid shown caught up with the last nudge within ${after} ms (limit ${FOLLOW})`);
  await page.close();
} finally {
  await browser.close();
  await server.close();
  done();
}
console.log(failed ? `${failed} check(s) failed` : 'All ornament 3D checks passed');
process.exit(failed ? 1 : 0);
