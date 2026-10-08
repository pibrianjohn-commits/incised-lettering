// Letters that collide, in real browsers (Chromium and Firefox, through
// Playwright), with the computer slowed 4× to stand in for an ordinary laptop
// (CLAUDE.md: test every heavy feature with the CPU slowed 4×, in Firefox and
// Chrome). Used as a letterer would: the carver's layout of 8 Oct 2026, the
// problems list opened, a collision clicked, a fix carried out.
//
//   npm run build && npm run test:collisions      (or npm run test:browser, for every browser test)
//
// Passes when:
//   - the problems list names the J in line 2 running into the M in line 3,
//     and the feet of A and M touching, and their fixes appear once tried,
//     within FIXES_LIMIT;
//   - clicking the collision goes to Write and marks it on the panel; Esc
//     takes the mark away; P marks the next problem;
//   - "Move line 3 down 1.5 mm" puts it right, and Ctrl+Z puts it back;
//   - the fixes are tried a little at a time, for that layout and for two
//     long lines laid over each other: no slice of the trying holds the page
//     up for more than MAX_SLICE ms, so it always answers the mouse and keys.
//     Each slice is timed by the page itself (performance.measure), in both
//     browsers. The longest the page went without answering at all, its
//     ordinary redraw and the G-code checks included, is reported too: those
//     were as long before the collision check was put right.
//
// How each browser is slowed and timed: see perf3d.mjs and browsers.mjs.

import { preview } from 'vite';
import { BROWSERS, done, launch, slowFirefoxPages } from './browsers.mjs';

const SLOWDOWN = 4;
const FIXES_LIMIT = 3000; // ms from a change to its tried fixes in the list
const MAX_SLICE = 250; // ms of trying fixes at once: a quarter of a second, as for the 3D view (perf3d.mjs)
const SLICE = 'Trying the fixes for letters that collide'; // the page's name for each slice (main.ts)

// Rebuilt from the carver's layout (test/collisions.test.ts).
const BRIAN = {
  text: 'AMBER IS....\n\nJUST\n\nAMAZBALLS',
  capHeight: 31.5,
  letterSpacing: -0.5,
  lineSpacing: 20,
  panelWidth: 300,
  panelHeight: 200,
  lines: { 2: { x: 130, align: 'centre', baseline: 114.8 }, 4: { x: 150, align: 'centre', baseline: 154.9 } },
};
// Two long lines laid over each other: a collision at nearly every letter.
const PILED = { text: 'IN MEMORIAM OF THE BRETHREN\nWHO FELL IN THE GREAT WAR', capHeight: 30, lineSpacing: 12, panelWidth: 600, panelHeight: 200 };

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

/** The longest task on the page's main thread in a Chromium trace, ms. */
function longestTask(trace) {
  const ev = trace.traceEvents;
  const main = ev.find((e) => e.name === 'thread_name' && e.args.name === 'CrRendererMain');
  const tasks = ev.filter((e) => e.pid === main.pid && e.tid === main.tid && e.ph === 'X' && e.name === 'RunTask');
  if (!tasks.length) throw new Error('the trace has no tasks on the main thread');
  return Math.round(Math.max(...tasks.map((t) => t.dur)) / 1000);
}

/** Start timing the page: Chromium traces it; in Firefox the page times how long it goes without answering. */
async function startTiming(page) {
  await page.evaluate(() => performance.clearMeasures());
  if (name === 'chromium') return browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline'] });
  await page.evaluate(() => {
    let last = performance.now();
    window.__heldUp = 0;
    clearInterval(window.__probe);
    window.__probe = setInterval(() => {
      const now = performance.now();
      window.__heldUp = Math.max(window.__heldUp, now - last - 20);
      last = now;
    }, 20);
  });
}
/** The longest the page went without answering, and the longest slice of trying fixes and how many there were, ms. */
async function stopTiming(page) {
  const held =
    name === 'chromium'
      ? longestTask(JSON.parse((await browser.stopTracing()).toString()))
      : await page.evaluate(() => {
          clearInterval(window.__probe);
          return Math.round(window.__heldUp);
        });
  const slices = await page.evaluate((n) => performance.getEntriesByName(n, 'measure').map((m) => m.duration), SLICE);
  return { held, slice: Math.round(Math.max(0, ...slices)), slices: slices.length };
}

/** The problems list as shown: each problem's text, whether its fixes are still being tried, and its fix buttons. */
const listed = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('#warn-pop li')].map((li) => ({
      text: li.querySelector('span')?.textContent ?? '',
      trying: !!li.querySelector('.trying') && /Trying/.test(li.querySelector('.trying').textContent),
      fixes: [...li.querySelectorAll('[data-fix]')].map((b) => b.textContent),
    })),
  );

/** Wait until every collision in the list has had its fixes tried; returns how long that took, ms. */
async function fixesTried(page, from) {
  await page.waitForFunction(
    () => {
      const items = [...document.querySelectorAll('#warn-pop li')];
      return items.length > 0 && !items.some((li) => li.querySelector('.trying') && /Trying/.test(li.textContent));
    },
    null,
    { timeout: 60000, polling: 20 },
  );
  return Date.now() - from;
}

async function openWith(project) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
  page.on('pageerror', (e) => check(false, `no page errors (${e.message})`));
  await page.goto(url);
  await page.evaluate((p) => {
    localStorage.clear();
    localStorage.setItem('incised.project', JSON.stringify(p));
  }, project);
  await page.reload();
  await page.waitForSelector('#loading', { state: 'hidden' });
  await page.waitForTimeout(2500); // settled, as after a moment's thought
  let slowed = true;
  if (name === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOWDOWN });
  } else slowed = slowPages();
  return { page, slowed };
}

try {
  for (name of BROWSERS) {
    console.log(`${name}:`);
    browser = await launch(name);
    if (name === 'firefox') slowPages = slowFirefoxPages(SLOWDOWN);

    {
      const { page, slowed } = await openWith(BRIAN);
      const what = `${name}, the carver's layout, ${slowed ? `CPU ${SLOWDOWN}× slower` : 'CPU NOT SLOWED (not possible on this machine)'}`;
      await page.click('#st-warn');
      await fixesTried(page, Date.now());
      let list = await listed(page);
      const jm = list.find((q) => q.text === 'The J in line 2 runs into the M in line 3.');
      check(!!jm, `${what}: the list says “The J in line 2 runs into the M in line 3.”`);
      check(list.filter((q) => /^The (A and M|M and A) in line [13] touch\.$/.test(q.text)).length === 3, `${what}: and the feet of A and M touch, three times`);
      check(jm?.fixes.join(' | ') === 'Move line 3 down 1.5 mm | Move line 2 up 1.5 mm | Return line 2 to auto | Return line 3 to auto', `${what}: its fixes, each tried first: ${jm?.fixes.join(' | ')}`);

      // Clicking it goes to Write and marks it on the panel; Esc takes the mark away; P marks the next.
      await page.click('#stages [data-stage="space"]');
      await page.click('#st-warn');
      await page.click('#warn-pop li[data-key] span >> text=The J in line 2 runs into the M in line 3.');
      const marked = await page.evaluate(() => ({ stage: document.body.dataset.stage, spot: !!document.querySelector('#overlay .spot') }));
      check(marked.stage === 'write' && marked.spot, `${what}: clicking it goes to Write and marks the spot on the panel`);
      await page.keyboard.press('Escape');
      check(!(await page.$('#overlay .spot')), `${what}: Esc takes the mark away`);
      await page.keyboard.press('p');
      const next = await page.evaluate(() => ({ spot: !!document.querySelector('#overlay .spot'), msg: document.getElementById('st-msg').textContent }));
      check(next.spot && /touch|runs into/.test(next.msg), `${what}: P marks a problem on the panel (“${next.msg}”)`);

      // Carried out: the J and M part, the rest stand, and the new layout's fixes are tried afresh.
      await page.click('#st-warn');
      await startTiming(page);
      const t0 = Date.now();
      await page.click('#warn-pop button >> text=Move line 3 down 1.5 mm');
      const took = await fixesTried(page, t0);
      await page.waitForTimeout(500);
      const timed = await stopTiming(page);
      list = await listed(page);
      check(!list.some((q) => /^The J/.test(q.text)) && list.filter((q) => /touch\.$/.test(q.text)).length === 3, `${what}: “Move line 3 down 1.5 mm” parts the J and the M; the touching feet still stand`);
      check(took <= FIXES_LIMIT, `${what}: the fixes for what is left were tried and shown within ${took} ms (limit ${FIXES_LIMIT})`);
      check(timed.slices > 0 && timed.slice <= MAX_SLICE, `${what}: the fixes were tried in ${timed.slices} slices, the longest ${timed.slice} ms (limit ${MAX_SLICE})`);
      console.log(`  ${what}: the longest the page went without answering, its redraw and the G-code checks included: ${timed.held} ms`);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(400);
      await page.click('#st-warn');
      await fixesTried(page, Date.now());
      check((await listed(page)).some((q) => q.text === 'The J in line 2 runs into the M in line 3.'), `${what}: Ctrl+Z puts line 3 back`);
      await page.close();
    }

    {
      const { page, slowed } = await openWith(PILED);
      const what = `${name}, two long lines laid over each other, ${slowed ? `CPU ${SLOWDOWN}× slower` : 'CPU NOT SLOWED (not possible on this machine)'}`;
      await page.click('#st-warn');
      await fixesTried(page, Date.now());
      // A change of letter spacing: every collision found again, and every fix tried again.
      await startTiming(page);
      const t0 = Date.now();
      await page.evaluate(() => {
        const box = document.getElementById('n-letterSpacing');
        box.value = '0.3';
        box.dispatchEvent(new Event('input', { bubbles: true }));
        box.dispatchEvent(new Event('change', { bubbles: true }));
      });
      const took = await fixesTried(page, t0);
      await page.waitForTimeout(500);
      const timed = await stopTiming(page);
      const list = await listed(page);
      const n = list.filter((q) => /runs into|touch|hairlines/.test(q.text)).length;
      console.log(`  ${what}: ${n} collisions, their fixes tried in ${took} ms`);
      check(n > 10 && list.some((q) => q.fixes.length), `${what}: every collision listed, with fixes`);
      check(timed.slices > 0 && timed.slice <= MAX_SLICE, `${what}: the fixes were tried in ${timed.slices} slices, the longest ${timed.slice} ms (limit ${MAX_SLICE})`);
      console.log(`  ${what}: the longest the page went without answering, its redraw and the G-code checks included: ${timed.held} ms`);
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
console.log(failed ? `${failed} check(s) failed` : 'All collision checks passed');
process.exit(failed ? 1 : 0);
