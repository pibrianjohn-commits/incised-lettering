// The setting-out lines in real browsers (Chromium and Firefox, through
// Playwright), with the computer slowed 4× to stand in for an ordinary laptop
// (CLAUDE.md: every browser test runs in both, slowed).
//
//   npm run build && npm run test:settingout      (or npm run test:browser, for every browser test)
//
// Passes when, on the carver's layout ("AMBER IS....", "JUST", "AMAZBALLS"):
//   - the Write stage opens with the cap line, baseline and mid line; the
//     Setting-out view shows every kind (the descender line under JUST, the
//     panel's centre cross); Design, Spacing and Proof none;
//   - the labels read "cap 31.5", "mid 15.8", "desc −9.0" and each baseline
//     from the panel's top ("base 114.8"), stay the same size on screen at
//     every zoom, and never lie over a letter, nor two closer than a label;
//   - each tick under Layers, and G, is one step to undo; Ctrl+K finds the
//     ticks by name and the ? list has G;
//   - a ruler guide, the measure tool and a dragged line snap to the new
//     lines, named as the baseline and cap line are ("line 2 mid line");
//   - the inspection panel lists each line's heights; the bench sheet draws
//     the lines with their labels, and its tick turns them off;
//   - zooming with every kind of line and label showing holds the page up no
//     more than LABELS_EXTRA ms longer than with none showing.
//
// How each browser is slowed and timed: see perf3d.mjs and browsers.mjs.

import { preview } from 'vite';
import { BROWSERS, done, launch, slowFirefoxPages } from './browsers.mjs';

const SLOWDOWN = 4;
const LABELS_EXTRA = 60; // ms the setting-out lines and labels may add to the longest the page goes without answering while zooming

const BRIAN = {
  text: 'AMBER IS....\n\nJUST\n\nAMAZBALLS',
  capHeight: 31.5,
  letterSpacing: -0.5,
  lineSpacing: 20,
  panelWidth: 300,
  panelHeight: 200,
  lines: { 2: { x: 130, align: 'centre', baseline: 114.8 }, 4: { x: 150, align: 'centre', baseline: 154.9 } },
};
const KINDS = ['capbase', 'mid', 'xheight', 'desc', 'centre'];

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
  if (name === 'chromium') return longestTask(JSON.parse((await browser.stopTracing()).toString()));
  return page.evaluate(() => {
    clearInterval(window.__probe);
    return Math.round(window.__heldUp);
  });
}

async function openWith(project) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  page.on('pageerror', (e) => check(false, `no page errors (${e.message})`));
  await page.goto(url);
  await page.evaluate((p) => {
    localStorage.clear();
    localStorage.setItem('incised.project', JSON.stringify(p));
  }, project);
  await page.reload();
  await page.waitForSelector('#loading', { state: 'hidden' });
  await page.waitForTimeout(2000);
  let slowed = true;
  if (name === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOWDOWN });
  } else slowed = slowPages();
  return { page, slowed };
}

const ticks = (page) => page.evaluate((ks) => ks.filter((k) => document.getElementById(`show-${k}`).checked).join(' '), KINDS);
/** The setting-out lines drawn and shown on the panel, by kind. */
const shownLines = (page) =>
  page.evaluate(() => [...new Set([...document.querySelectorAll('#world .setting-out > *')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.getAttribute('class')))].sort().join(' '));
const labelTexts = (page) => page.evaluate(() => [...document.querySelectorAll('#labels .so-label')].map((t) => t.textContent));
/** Every label's box on screen against every letter's, and against each other. */
const labelClashes = (page) =>
  page.evaluate(() => {
    const boxes = (sel) => [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
    const letters = boxes('#world path.fill');
    const labels = [...document.querySelectorAll('#labels .so-label')].map((t) => ({ text: t.textContent, r: t.getBoundingClientRect(), font: getComputedStyle(t).fontSize }));
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    // A letter's box is the box round its outline: a label beside a letter's slanting side may lie inside that box but not over the letter itself, so the outline is asked too.
    const overLetter = (r) =>
      [...document.querySelectorAll('#world path.fill')].some((p) => {
        const b = p.getBoundingClientRect();
        if (!hit(r, b)) return false;
        const svg = p.ownerSVGElement;
        const m = p.getScreenCTM().inverse();
        for (let x = r.left; x <= r.right; x += 2)
          for (let y = r.top; y <= r.bottom; y += 2) {
            const q = new DOMPoint(x, y).matrixTransform(m);
            const pt = svg.createSVGPoint();
            pt.x = q.x;
            pt.y = q.y;
            if (p.isPointInFill(pt)) return true;
          }
        return false;
      });
    return {
      count: labels.length,
      fonts: [...new Set(labels.map((l) => l.font))],
      over: labels.filter((l) => letters.some((b) => hit(l.r, b)) && overLetter(l.r)).map((l) => l.text),
      close: labels.filter((l, i) => labels.some((m, j) => j !== i && Math.abs((m.r.top + m.r.bottom) / 2 - (l.r.top + l.r.bottom) / 2) < 11.5)).map((l) => l.text),
      // The widths the labels are placed by (6.3 px a character) are never less than drawn.
      wide: labels.filter((l) => l.r.width > l.text.length * 6.3).map((l) => `${l.text} ${l.r.width.toFixed(1)}px`),
    };
  });
/** Panel mm to page px. */
const toPage = (page) =>
  page.evaluate(() => {
    const w = document.getElementById('work').getBoundingClientRect();
    const m = /translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(document.getElementById('world').getAttribute('transform'));
    return { left: w.left, top: w.top, tx: Number(m[1]), ty: Number(m[2]), s: Number(m[3]) };
  });

try {
  for (name of BROWSERS) {
    console.log(`${name}:`);
    browser = await launch(name);
    if (name === 'firefox') slowPages = slowFirefoxPages(SLOWDOWN);
    const { page, slowed } = await openWith(BRIAN);
    const what = `${name}, the carver's layout, ${slowed ? `CPU ${SLOWDOWN}× slower` : 'CPU NOT SLOWED'}`;

    // What each stage and view shows.
    check((await ticks(page)) === 'capbase mid', `${what}: the Write stage opens with the cap line, baseline and mid line (${await ticks(page)})`);
    check((await shownLines(page)) === 'so-base so-cap so-mid', `${what}: and draws just those (${await shownLines(page)})`);
    await page.keyboard.press('Shift+Digit3');
    await page.keyboard.press('z');
    await page.waitForTimeout(500);
    check((await ticks(page)) === KINDS.join(' '), `${what}: the Setting-out view ticks every kind`);
    check((await shownLines(page)) === 'so-base so-cap so-centre so-desc so-mid', `${what}: and draws the cap, mid, base and descender lines and the panel centre (${await shownLines(page)})`);
    const texts = await labelTexts(page);
    check(['cap 31.5', 'mid 15.8', 'desc −9.0', 'base 75.8', 'base 114.8', 'base 154.9'].every((t) => texts.includes(t)), `${what}: labelled ${texts.join(', ')}`);
    for (const [k, view] of [
      [1, 'Design'],
      [2, 'Spacing'],
      [4, 'Proof'],
    ]) {
      await page.keyboard.press(`Shift+Digit${k}`);
      await page.waitForTimeout(250);
      check((await ticks(page)) === '' && (await labelTexts(page)).length === 0, `${what}: the ${view} view shows none`);
    }
    await page.keyboard.press('Shift+Digit3');
    await page.waitForTimeout(250);

    // The labels at every zoom.
    let worst = null;
    const fonts = new Set();
    const p0 = await toPage(page);
    const at = { x: p0.left + p0.tx + 60 * p0.s, y: p0.top + p0.ty + 100 * p0.s };
    for (const [n, dir] of [
      [0, 1],
      [4, -1],
      [4, -1],
      [4, -1],
      [12, 1],
      [4, 1],
    ]) {
      await page.mouse.move(at.x, at.y);
      for (let i = 0; i < n; i++) await page.mouse.wheel(0, 120 * dir);
      await page.waitForTimeout(300);
      const c = await labelClashes(page);
      const zoom = await page.evaluate(() => document.getElementById('zoom-read').textContent);
      c.fonts.forEach((f) => fonts.add(f));
      if (c.over.length || c.close.length || c.wide.length) worst = { ...c, zoom };
      console.log(`  ${zoom}: ${c.count} labels`);
    }
    check(!worst, `${what}: at every zoom no label lies over a letter or comes closer to another than a label is tall${worst ? ` (at ${worst.zoom}: over ${worst.over.join(', ')}; close ${worst.close.join(', ')}; wide ${worst.wide.join(', ')})` : ''}`);
    check(fonts.size === 1, `${what}: the labels stay one size on screen at every zoom (${[...fonts].join(', ')})`);
    await page.keyboard.press('z');
    await page.waitForTimeout(300);

    // Each tick is one step to undo, and so is G.
    await page.click('#layers-btn');
    await page.click('#show-mid');
    await page.click('#show-centre');
    await page.keyboard.press('Escape');
    const t2 = await ticks(page);
    await page.keyboard.press('Control+z');
    const t1 = await ticks(page);
    await page.keyboard.press('Control+z');
    const t0 = await ticks(page);
    await page.keyboard.press('Control+Shift+z');
    const r1 = await ticks(page);
    check(
      t2 === 'capbase xheight desc' && t1 === 'capbase xheight desc centre' && t0 === KINDS.join(' ') && r1 === t1,
      `${what}: each tick is one step to undo and redo (${t2} ← ${t1} ← ${t0}; redone ${r1})`,
    );
    await page.keyboard.press('Control+Shift+z');
    await page.keyboard.press('g');
    const g1 = await ticks(page);
    const gLabels = (await labelTexts(page)).length;
    await page.keyboard.press('g');
    const g2 = await ticks(page);
    await page.keyboard.press('Control+z');
    const g3 = await ticks(page);
    check(g1 === '' && gLabels === 0 && g2 === KINDS.join(' ') && g3 === '', `${what}: G hides every kind, G again shows them all, and Ctrl+Z undoes it (${g1 || 'none'} / ${g2} / ${g3 || 'none'})`);
    await page.keyboard.press('g');

    // Ctrl+K and the ? list.
    await page.keyboard.press('Control+k');
    await page.keyboard.type('descender line');
    await page.waitForTimeout(300);
    const found = await page.evaluate(() => [...document.querySelectorAll('#palette li, [role=option]')].map((l) => l.textContent.trim()));
    check(found.some((t) => /^Hide: Setting-out lines: descender line/.test(t)), `${what}: Ctrl+K finds “${found[0]}”`);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    check(!(await ticks(page)).includes('desc'), `${what}: and running it hides the descender line`);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('?');
    await page.waitForTimeout(200);
    check(await page.evaluate(() => /G\s*Setting-out lines: show every kind/.test(document.getElementById('keys-list').textContent)), `${what}: the ? list has G`);
    await page.keyboard.press('Escape');

    // Snapping: a ruler guide, the measure tool, a dragged line.
    await page.keyboard.press('z');
    await page.waitForTimeout(300);
    const v = await toPage(page);
    const px = (x, y) => ({ x: v.left + v.tx + x * v.s, y: v.top + v.ty + y * v.s });
    const ruler = await page.evaluate(() => document.getElementById('ruler-top').getBoundingClientRect().toJSON());
    await page.mouse.move(px(40, 0).x, ruler.top + 10);
    await page.mouse.down();
    await page.mouse.move(px(40, 99.05).x, px(40, 99.05).y - 0.5 * v.s, { steps: 8 }); // half a mm above it (the panel centre is 0.95 mm below)
    const guideLabel = await page.evaluate(() => document.querySelector('#overlay .guide-label')?.textContent ?? '');
    await page.mouse.up();
    await page.waitForTimeout(300);
    const guides = await page.evaluate(() => [...document.querySelectorAll('#overlay [data-guide^="y:"] line:not(.hit)')].map((l) => l.getAttribute('y1')));
    check(/line 2 mid line/.test(guideLabel) && guides.length === 1 && Math.abs(Number(guides[0]) - (v.ty + 99.05 * v.s)) < 1, `${what}: a guide dragged from the ruler snaps to line 2's mid line (“${guideLabel}”)`);
    await page.keyboard.press('Control+z'); // the guide
    await page.keyboard.press('m');
    const a = px(70, 75.8 + 0.8);
    const b = px(70, 123.8 + 0.8);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    const measured = await page.evaluate(() => [...document.querySelectorAll('#overlay .measure text, #overlay .snap text')].map((t) => t.textContent));
    await page.mouse.up();
    check(measured.includes('48.0 mm') && measured.includes('line 1 baseline') && measured.includes('line 2 descender line'), `${what}: the measure snaps to line 1's baseline and line 2's descender line (${measured.join(' · ')})`);
    await page.keyboard.press('Escape');
    // Line 3's cap line, 0.4 mm below line 2's descender line, snaps up to it as line 3 is dragged.
    const n3 = await page.evaluate(() => document.querySelector('#labels .linenum[data-line="4"] rect').getBoundingClientRect().toJSON());
    await page.mouse.move(n3.x + n3.width / 2, n3.y + n3.height / 2);
    await page.mouse.down();
    await page.mouse.move(n3.x + n3.width / 2, n3.y + n3.height / 2 + 12, { steps: 4 });
    await page.mouse.move(n3.x + n3.width / 2, n3.y + n3.height / 2 + 1, { steps: 4 });
    const lineSnap = await page.evaluate(() => [...document.querySelectorAll('#overlay .snap text')].map((t) => t.textContent));
    await page.mouse.up();
    await page.keyboard.press('Control+z');
    check(lineSnap.includes('line 2 descender line'), `${what}: dragging line 3, its cap line snaps to line 2's descender line (${lineSnap.join(', ')})`);

    // The inspection panel and the bench sheet.
    const card = await page.evaluate(() => document.querySelectorAll('#line-list .ln')[1]?.textContent.replace(/\s+/g, ' ') ?? '');
    check(/31\.5 cap/.test(card) && /15\.8 mid/.test(card) && /−9\.0 descender \(J\)/.test(card), `${what}: the inspection panel lists line 2's heights (${card.trim()})`);
    await page.keyboard.press('Control+p');
    await page.waitForSelector('#sheet-view[open]');
    await page.waitForTimeout(500);
    const sheetLabels = await page.evaluate(() => [...document.querySelectorAll('#sheet-paper .sheet-so-label')].map((t) => t.textContent));
    check(['cap 31.5', 'mid 15.8', 'desc −9.0', 'base 114.8'].every((t) => sheetLabels.includes(t)), `${what}: the bench sheet draws the lines with their labels (${sheetLabels.join(', ')})`);
    await page.click('#sheet-lines');
    await page.waitForTimeout(500);
    const off = await page.evaluate(() => document.querySelectorAll('#sheet-paper .sheet-setting-out, #sheet-paper .sheet-so-label').length);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+p');
    await page.waitForSelector('#sheet-view[open]');
    await page.waitForTimeout(400);
    const stillOff = await page.evaluate(() => !document.getElementById('sheet-lines').checked && !document.querySelector('#sheet-paper .sheet-setting-out'));
    check(off === 0 && stillOff, `${what}: the sheet's tick turns them off, and stays off`);
    await page.click('#sheet-lines');
    await page.keyboard.press('Escape');

    // Zooming with every line and label showing, against none.
    const zoomHeld = async () => {
      await page.keyboard.press('z');
      await page.waitForTimeout(400);
      await startTiming(page);
      for (let i = 0; i < 8; i++) {
        await page.mouse.wheel(0, i < 4 ? -120 : 120);
        await page.waitForTimeout(60);
      }
      await page.waitForTimeout(300);
      return stopTiming(page);
    };
    const withLines = await zoomHeld();
    await page.keyboard.press('g');
    const without = await zoomHeld();
    await page.keyboard.press('g');
    check(withLines - without <= LABELS_EXTRA, `${what}: zooming holds the page up ${withLines} ms with every line and label, ${without} ms with none (at most ${LABELS_EXTRA} ms more)`);
    await page.close();
    await browser.close();
    browser = null;
  }
} finally {
  await browser?.close();
  await server.close();
  done();
}
console.log(failed ? `${failed} check(s) failed` : 'All setting-out line checks passed');
process.exit(failed ? 1 : 0);
