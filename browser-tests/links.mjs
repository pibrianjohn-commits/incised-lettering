// Linked letters in real browsers (Chromium and Firefox, through Playwright),
// with the computer slowed 4× to stand in for an ordinary laptop (CLAUDE.md:
// test every heavy feature with the CPU slowed 4×, in Firefox and Chrome).
//
//   npm run build && npm run test:links      (or npm run test:browser, for every browser test)
//
// Passes when:
//   - a gap is linked with L and the gap tools, made deeper and shallower with
//     Alt+arrows (stopping at touching), and unlinked, each one step to undo,
//     with the link mark shown; a pair that can never meet says so;
//   - a line linked from end to end keeps up while the cap height slider is
//     dragged: the joined shapes' valley lines are worked out in a worker,
//     so linking adds no more than LINK_EXTRA ms to the longest the page goes
//     without answering, over the same line unlinked; and the shapes arrive;
//   - on the carver's layout, linked at AM and MA, the problems list names the
//     joints too thin to chisel, with "Overlap them N mm more", tried first in
//     slices of at most MAX_SLICE ms; and the fix cures them;
//   - the 3D view, marked out and finished, shows the board with links, with
//     no page errors.
//
// How each browser is slowed and timed: see perf3d.mjs and browsers.mjs.

import { preview } from 'vite';
import { BROWSERS, done, launch, slowFirefoxPages } from './browsers.mjs';

const SLOWDOWN = 4;
const MAX_SLICE = 250; // ms of trying fixes at once (as collisions.mjs)
const LINK_EXTRA = 150; // ms linking may add to the longest wait while dragging
const SHAPES_LIMIT = 15000; // ms for a line of new joined shapes to arrive from the worker, slowed
const SLICE = 'Trying the fixes for letters that collide';

const BRIAN = {
  text: 'AMBER IS....\n\nJUST\n\nAMAZBALLS',
  capHeight: 31.5,
  letterSpacing: -0.5,
  lineSpacing: 20,
  panelWidth: 300,
  panelHeight: 200,
  lines: { 2: { x: 130, align: 'centre', baseline: 114.8 }, 4: { x: 150, align: 'centre', baseline: 154.9 } },
};
const LINE = 'AMMAHHLLAMA';
const allLinked = Object.fromEntries([...LINE].slice(1).map((ch, i) => [`0:${i + 1}`, { pair: LINE[i] + ch, overlap: 0.6 }]));

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

async function openWith(project, slow = true) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
  page.on('pageerror', (e) => check(false, `no page errors (${e.message})`));
  await page.goto(url);
  await page.evaluate((p) => {
    localStorage.clear();
    localStorage.setItem('incised.project', JSON.stringify(p));
  }, project);
  await page.reload();
  await page.waitForSelector('#loading', { state: 'hidden' });
  await page.waitForTimeout(2500);
  let slowed = true;
  if (!slow) return { page, slowed: false };
  if (name === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOWDOWN });
  } else slowed = slowPages();
  return { page, slowed };
}
const linkMarks = (page) => page.evaluate(() => document.querySelectorAll('#labels .link-mark').length);
const status = (page) => page.evaluate(() => document.getElementById('st-msg').textContent);
try {
  for (name of BROWSERS) {
    console.log(`${name}:`);
    browser = await launch(name);
    if (name === 'firefox') slowPages = slowFirefoxPages(SLOWDOWN);

    // Linking by hand: L, the gap tools, Alt+arrows, Unlink, undo.
    {
      const { page, slowed } = await openWith({ text: 'WAVY', capHeight: 30, panelWidth: 200, panelHeight: 80 });
      const what = `${name}, linking by hand, ${slowed ? `CPU ${SLOWDOWN}× slower` : 'CPU NOT SLOWED'}`;
      await page.keyboard.press('2'); // Space
      await page.click('#world [data-gap="0:2"]', { force: true }); // between V and Y
      await page.keyboard.press('l');
      await page.waitForTimeout(400);
      check((await linkMarks(page)) === 1 && /V and Y in line 1 are linked/.test(await status(page)), `${what}: L links the V and Y, with a link mark (“${await status(page)}”)`);
      const overlap = () => page.evaluate(() => Number(document.querySelector('#kern-pop [data-overlap]').value));
      const o0 = await overlap();
      await page.keyboard.press('Alt+ArrowLeft');
      await page.waitForTimeout(300);
      const o1 = await overlap();
      check(Math.abs(o1 - o0 - 0.1) < 0.011, `${what}: Alt+← goes in 0.1 mm deeper (${o0} → ${o1} mm)`);
      for (let i = 0; i < 12; i++) await page.keyboard.press('Alt+ArrowRight');
      await page.waitForTimeout(300);
      check((await overlap()) === 0 && /only touch/.test(await status(page)), `${what}: Alt+→ makes it shallower and stops at touching`);
      await page.click('#kern-pop [data-link]');
      await page.waitForTimeout(300);
      check((await linkMarks(page)) === 0, `${what}: Unlink parts them`);
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(300);
      check((await linkMarks(page)) === 1, `${what}: Ctrl+Z links them again`);
      await page.close();
    }
    {
      const { page } = await openWith({ text: '’.', capHeight: 30, panelWidth: 200, panelHeight: 80 }, false);
      await page.keyboard.press('2');
      await page.click('#world [data-gap="0:0"]', { force: true });
      await page.keyboard.press('l');
      await page.waitForTimeout(300);
      check((await linkMarks(page)) === 0 && /can never meet/.test(await status(page)), `${name}: a pair that can never meet says so (“${await status(page)}”)`);
      await page.close();
    }

    // Dragging the cap height slider: a line linked end to end, against the same line unlinked.
    const drag = async (project) => {
      const { page, slowed } = await openWith(project);
      await page.waitForTimeout(project.links ? 1500 : 0);
      await startTiming(page);
      const t0 = Date.now();
      await page.evaluate(async () => {
        const range = document.getElementById('r-capHeight');
        for (let v = 20; v <= 40; v += 0.5) {
          range.value = String(v);
          range.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 30));
        }
      });
      await page.waitForTimeout(1500);
      const timed = await stopTiming(page);
      return { page, slowed, held: timed.held, took: Date.now() - t0 };
    };
    const plain = await drag({ text: LINE, capHeight: 25, panelWidth: 300, panelHeight: 100 });
    await plain.page.close();
    const joined = await drag({ text: LINE, capHeight: 25, panelWidth: 300, panelHeight: 100, links: allLinked });
    const what = `${name}, a line linked end to end, cap height dragged 20 → 40 mm, ${joined.slowed ? `CPU ${SLOWDOWN}× slower` : 'CPU NOT SLOWED'}`;
    check(joined.held <= plain.held + LINK_EXTRA, `${what}: the page went without answering for at most ${joined.held} ms at once (unlinked: ${plain.held} ms; linking may add ${LINK_EXTRA})`);
    const marks = await linkMarks(joined.page);
    const valleys = await joined.page.evaluate(() => document.querySelectorAll('#world .valley').length);
    check(marks === LINE.length - 1 && valleys === 1, `${what}: one joined letter, with its valley lines (${marks} link marks, ${valleys} letter)`);
    await joined.page.close();

    // A new joined shape, from the worker.
    {
      const { page, slowed } = await openWith({ text: 'KAXYW', capHeight: 25, panelWidth: 300, panelHeight: 100 });
      const t0 = Date.now();
      await page.keyboard.press('2');
      for (const gap of ['0:0', '0:1', '0:2', '0:3']) {
        await page.click(`#world [data-gap="${gap}"]`, { force: true });
        await page.keyboard.press('l');
      }
      const ok = await page
        .waitForFunction(() => document.querySelectorAll('#labels .link-mark').length === 4 && document.querySelectorAll('#world path.valley').length === 1 && document.querySelector('#world path.valley').getAttribute('d').length > 100, null, { timeout: SHAPES_LIMIT, polling: 50 })
        .then(() => true, () => false);
      check(ok, `${name}, KAXYW linked one gap after another (four new shapes), ${slowed ? `CPU ${SLOWDOWN}× slower` : 'CPU NOT SLOWED'}: the joined letter's valley lines came in ${Date.now() - t0} ms (limit ${SHAPES_LIMIT})`);
      await page.close();
    }

    // The carver's layout, linked at AM and MA: the problems list.
    {
      const links = { '4:1': { pair: 'AM', overlap: 0.3 }, '4:2': { pair: 'MA', overlap: 0.3 } };
      const { page, slowed } = await openWith({ ...BRIAN, links });
      const what = `${name}, the carver's layout linked at AM and MA, ${slowed ? `CPU ${SLOWDOWN}× slower` : 'CPU NOT SLOWED'}`;
      await page.click('#st-warn');
      await page.waitForFunction(() => [...document.querySelectorAll('#warn-pop li')].some((li) => /joined by only/.test(li.textContent)) && !document.querySelector('#warn-pop .trying'), null, { timeout: 60000, polling: 50 });
      const list = await page.evaluate(() => [...document.querySelectorAll('#warn-pop li')].map((li) => ({ text: li.querySelector('span').textContent, fixes: [...li.querySelectorAll('[data-fix]')].map((b) => b.textContent) })));
      const thin = list.filter((q) => /are joined by only/.test(q.text));
      check(thin.length === 2 && thin.every((q) => q.fixes.join() === 'Overlap them 0.4 mm more'), `${what}: ${thin.map((q) => `“${q.text}” → ${q.fixes.join(', ')}`).join('; ')}`);
      check(list.some((q) => q.text === 'The J in line 2 runs into the M of the linked AMA in line 3.'), `${what}: the J runs into “the M of the linked AMA”`);
      await startTiming(page);
      await page.click('#warn-pop button >> text=Overlap them 0.4 mm more');
      await page.waitForFunction(() => !document.querySelector('#warn-pop .trying'), null, { timeout: 60000, polling: 50 });
      await page.waitForTimeout(800);
      const timed = await stopTiming(page);
      const after = await page.evaluate(() => [...document.querySelectorAll('#warn-pop li span')].map((s) => s.textContent));
      check(after.filter((t) => /joined by only/.test(t)).length === 1, `${what}: “Overlap them 0.4 mm more” cures its joint (one left)`);
      check(timed.slices > 0 && timed.slice <= MAX_SLICE, `${what}: the fixes were tried in ${timed.slices} slices, the longest ${timed.slice} ms (limit ${MAX_SLICE})`);
      console.log(`  ${what}: the longest the page went without answering, its redraw and the G-code checks included: ${timed.held} ms`);

      // The 3D view, marked out and finished.
      for (const state of ['marked', 'finished']) {
        const before = await page.evaluate(() => document.body.dataset.board3d ?? '');
        await page.keyboard.press('Escape');
        await page.click('#stages [data-stage="3d"]');
        await page.click(`#v3d-state [data-state="${state}"]`);
        const t0 = Date.now();
        const shown = await page.waitForFunction((b) => (document.body.dataset.board3d ?? '') !== b, before, { timeout: 60000, polling: 50 }).then(() => true, () => false);
        check(shown, `${what}: the 3D view, ${state === 'marked' ? 'marked out' : 'finished'}, shows the board with links (${Date.now() - t0} ms)`);
        await page.click('#stages [data-stage="write"]');
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
console.log(failed ? `${failed} check(s) failed` : 'All linked-letter checks passed');
process.exit(failed ? 1 : 0);
