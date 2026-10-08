// The offline copy across updates, in Chromium and Firefox (CLAUDE.md).
//
//   npm run test:updates
//
// A clean browser never shows what goes wrong here: these checks keep one
// browser profile through each story, as Brian's browser lives through
// updates. Versions are published one after another to a stand-in for GitHub
// Pages (pages.mjs), which deletes the last version's files on each publish
// and lets the browser keep files for 10 minutes. Throughout, the page, its
// scripts and the 3D worker must come from one version (BRIEF.md, Decisions:
// "The offline copy"), and the 3D view must work, marked out and finished:
//
//   1. a version installed, two more published with the page left open, reloaded;
//   2. the same, then offline;
//   3. a page left open across two updates, its own files gone everywhere,
//      then the 3D view opened for the first time;
//   4. the 3D worker's file missing: the problems say the saved copy is out of
//      date, with "Refresh the app", which brings the newest version;
//   5. a copy made by the offline worker as it was before the fix (versions of
//      7 Oct 2026, from git), put right by itself the next time it is opened online.
//
// It builds its own versions of the app (and the old ones from git), so it
// needs no build first. BROWSERS=chromium or BROWSERS=firefox runs just one.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { BROWSERS, done, launch } from './browsers.mjs';
import { pagesServer } from './pages.mjs';

const TEXT = 'AMBER IS....\n\nJ U S T\n\nAMAZBALLS'; // Brian's layout that failed in Firefox
/** The versions Brian's browser lived through on 7 Oct 2026, before the fix: their offline worker is the old one. */
const OLD = [
  ['old 19', 'b753d8a'],
  ['old 20', '31215b3'],
  ['old 21', '43614a1'],
];

const work = mkdtempSync(join(tmpdir(), 'updates-'));
let failed = 0;
const check = (ok, text) => {
  console.log(`${ok ? '✓' : '✗'} ${text}`);
  if (!ok) failed++;
};

// ---------------------------------------------------------------- versions

async function buildVersion(name) {
  const outDir = join(work, name);
  process.env.APP_VERSION = `test-${name}`;
  await build({ logLevel: 'silent', build: { outDir, emptyOutDir: true } });
  return outDir;
}

/** An old version built from git, or null if git or the commit is not to hand. */
function buildOld(label, sha) {
  const dir = join(work, label.replace(' ', '-'));
  if (spawnSync('git', ['worktree', 'add', '--detach', '-f', dir, sha], { stdio: 'ignore' }).status !== 0) return null;
  symlinkSync(resolve('node_modules'), join(dir, 'node_modules'));
  const r = spawnSync(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'build', '--logLevel', 'silent'], { cwd: dir, stdio: 'ignore' });
  return r.status === 0 ? join(dir, 'dist') : null;
}

/** What a page is: its version (the old ones have none of their own, so their main script names them). */
const names = {};
const nameOf = (dist, label) => (names[readFileSync(join(dist, 'index.html'), 'utf8').match(/assets\/(index-[^"]+\.js)/)[1]] = label);

// ---------------------------------------------------------------- driving the app

async function opened(page) {
  await page.waitForSelector('#loading', { state: 'hidden', timeout: 30000 }).catch(() => {});
}

/** Which version the page in front of us is, and whether the offline copy is looking after it. */
async function versionOf(page) {
  for (let i = 0; i < 40; i++) {
    try {
      const v = await page.evaluate(() => ({
        version: document.body.dataset.version ?? '',
        script: [...document.scripts].map((s) => s.getAttribute('src') ?? '').find((s) => s.includes('assets/index-'))?.replace(/.*assets\//, '') ?? '',
        copy: !!navigator.serviceWorker?.controller,
      }));
      return { name: v.version || names[v.script] || 'none', copy: v.copy };
    } catch {
      await page.waitForTimeout(250); // opening again
    }
  }
  return { name: 'none', copy: false };
}

async function setUp(page) {
  await page.click('#stages [data-stage="write"]');
  await page.fill('#text', TEXT);
  await page.click('#stages [data-stage="panel"]');
  await page.fill('#panelWidth', '299.5');
  await page.press('#panelWidth', 'Enter');
  await page.fill('#panelHeight', '196.5');
  await page.press('#panelHeight', 'Enter');
}

/** Open the app and let its offline copy be made and take charge; then the layout, and a pause for the 3D parts to be fetched. */
async function install(page, url) {
  await page.goto(url);
  await opened(page);
  for (let i = 0; i < 40 && !(await page.evaluate(() => !!navigator.serviceWorker?.controller)); i++) await page.waitForTimeout(250);
  await setUp(page);
  await page.waitForTimeout(6000);
}

/** The 3D view, marked out and finished: 'ok', or what it said. */
async function board(page, state) {
  await page.click(`#v3d-state [data-state="${state}"]`);
  const t0 = Date.now();
  for (;;) {
    await page.waitForTimeout(250);
    const r = await page.evaluate((state) => {
      const card = document.getElementById('v3d-working');
      const msg = document.getElementById('st-msg').textContent;
      const shown = card.hidden && document.getElementById('v3d-note').textContent.startsWith(state === 'marked' ? 'As the' : 'Finished');
      const failure = !card.hidden && card.classList.contains('failed') ? card.querySelector('.v3d-what').textContent : /could not/.test(msg) ? msg : '';
      return { shown, failure };
    }, state);
    if (r.shown) return 'ok';
    if (r.failure) return r.failure;
    if (Date.now() - t0 > 90000) return 'nothing shown after 90 s';
  }
}

/** Open the 3D view and see both boards; then back to Write. */
async function see3d(page) {
  await page.click('#stages [data-stage="3d"]');
  const marked = await board(page, 'marked');
  const finished = await board(page, 'finished');
  const worker = await page.evaluate(() => document.body.dataset.worker3d ?? 'none');
  await page.click('#stages [data-stage="write"]');
  return { marked, finished, worker };
}

/** The 3D view worked, with the page and its worker both of `want`. */
async function expect3d(page, want, what) {
  const v = await versionOf(page);
  const r = await see3d(page);
  check(v.name === want, `${what}: the page is version ${want} (${v.name}${v.copy ? ', offline copy in charge' : ''})`);
  check(r.marked === 'ok' && r.finished === 'ok', `${what}: 3D marked out ${r.marked}, finished ${r.finished}`);
  check(r.worker === v.name, `${what}: the 3D worker is the page's own version (${r.worker})`);
}

const copies = (page) => page.evaluate(async () => (await caches.keys()).filter((n) => n.startsWith('incised-lettering-')));

/** Wait until `test` gives a truthy answer (it may throw while a page is opening again), or `ms` have gone. */
async function until(test, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve()
      .then(test)
      .catch(() => null);
    if (v || Date.now() - t0 > ms) return v;
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function story(browser, server, title, run) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 760 } });
  const errors = [];
  ctx.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)));
  console.log(`  ${title}`);
  server.offline = false;
  try {
    await run(ctx, errors);
  } catch (err) {
    check(false, `${title}: ran to the end (${err.message.split('\n')[0]})`);
  }
  check(!errors.length, `${title}: no errors on the page${errors.length ? ` (${[...new Set(errors)].join(' | ')})` : ''}`);
  await ctx.close();
}

// ---------------------------------------------------------------- the stories

const [A, B, C] = [await buildVersion('A'), await buildVersion('B'), await buildVersion('C')];
const old = OLD.map(([label, sha]) => {
  const dist = buildOld(label, sha);
  if (dist) nameOf(dist, label);
  return dist;
});
const workerOf = (dist) => `assets/${readdirSync(join(dist, 'assets')).find((f) => f.startsWith('relief.worker-'))}`;

const server = await pagesServer();
const url = server.url;
try {
  for (const name of BROWSERS) {
    console.log(`${name}:`);
    const browser = await launch(name);

    await story(browser, server, '1 and 2. Two versions published with the page left open; reloaded; then offline', async (ctx) => {
      server.publish(A);
      const page = await ctx.newPage();
      await install(page, url);
      server.publish(B);
      await page.waitForTimeout(1000);
      server.publish(C);
      await page.reload();
      await opened(page);
      await page.waitForTimeout(4000);
      await expect3d(page, 'test-C', 'reloaded');
      server.offline = true;
      await page.reload();
      await opened(page);
      await expect3d(page, 'test-C', 'offline');
      server.offline = false;
      await page.goto(url);
      await opened(page);
      await expect3d(page, 'test-C', 'online again');
    });

    await story(browser, server, '3. A page left open across two updates, then 3D opened for the first time', async (ctx) => {
      server.publish(A);
      const page = await ctx.newPage();
      await install(page, url);
      // Opened in another tab after each publish: the offline copy moves on to C, and A's copy is cleared out.
      const other = await ctx.newPage();
      server.publish(B);
      await other.goto(url);
      await opened(other);
      await other.waitForTimeout(3000);
      server.publish(C);
      await other.reload();
      await opened(other);
      const kept = (await until(async () => ((await copies(other)).length === 2 ? copies(other) : null))) ?? (await copies(other));
      check(kept.length === 2, `version A's files are gone from the server and from the offline copies (${kept.length} copies kept)`);
      await other.close();
      await expect3d(page, 'test-A', 'the page left open on A');
      // Work stopped part-way (a new worker is made), still of the page's own version.
      await page.click('#stages [data-stage="3d"]');
      await page.click('#v3d-state [data-state="marked"]');
      await page.click('#v3d-state [data-state="finished"]');
      await page.click('#v3d-state [data-state="marked"]');
      const again = await board(page, 'marked');
      check(again === 'ok', `the page left open on A, work stopped part-way and begun again: ${again}`);
    });

    await story(browser, server, '4. The 3D worker’s file cannot be loaded', async (ctx) => {
      server.publish(A, [workerOf(A)]);
      const page = await ctx.newPage();
      await page.goto(url);
      await opened(page);
      // The 3D parts are fetched quietly a few seconds after opening; then the problem is listed.
      await page.click('#st-warn');
      const listed = await until(() =>
        page.evaluate(() => {
          const li = [...document.querySelectorAll('#warn-pop li')].find((l) => /out of date/.test(l.textContent));
          const details = li?.querySelector('details pre')?.textContent ?? '';
          return li && !/Gathering/.test(details) ? { fix: li.querySelector('[data-fix="refresh-app"]')?.textContent ?? '', details } : null;
        }),
      );
      check(!!listed, 'the problems say the saved copy of the app is out of date');
      check(listed?.fix === 'Refresh the app', `with a one-click fix: ${listed?.fix || 'none'}`);
      check(/404/.test(listed?.details ?? '') && /Fresh from the server/.test(listed?.details ?? ''), 'its Details give the actual reason, after fetching fresh');
      await page.keyboard.press('Escape');
      await page.click('#stages [data-stage="3d"]');
      const card = await until(() =>
        page.evaluate(() => {
          const c = document.getElementById('v3d-working');
          const r = { failed: !c.hidden && c.classList.contains('failed'), what: c.querySelector('.v3d-what').textContent, refresh: !c.querySelector('[data-v3d="refresh"]').hidden, details: !c.querySelector('details').hidden };
          return r.failed ? r : null;
        }),
      );
      check(!!card && /out of date/.test(card.what) && card.refresh && card.details, `the 3D view says so too, with Refresh the app and Details ("${card?.what ?? 'nothing'}")`);
      server.publish(B);
      await page.click('#v3d-working [data-v3d="refresh"]');
      await page.waitForTimeout(1500);
      await opened(page);
      await page.waitForTimeout(3000);
      await setUp(page);
      await expect3d(page, 'test-B', 'after Refresh the app');
    });

    if (old.every(Boolean)) {
      await story(browser, server, '5. A copy made before the fix puts itself right the next time it is opened online', async (ctx, errors) => {
        server.publish(old[0]);
        const page = await ctx.newPage();
        await install(page, url);
        for (const dist of old.slice(1)) {
          server.publish(dist);
          await page.goto(url);
          await opened(page);
          await page.waitForTimeout(3000);
        }
        const before = await versionOf(page);
        console.log(`    before: the newest is old 21, but the copy opens ${before.name}`);
        errors.length = 0; // the old versions' own faults (the dots, before 7 Oct 2026) are not the point here
        server.publish(C);
        await page.goto(url);
        // The new offline copy is made, takes over and opens the page again, by itself.
        const t0 = Date.now();
        await until(async () => (await versionOf(page)).name === 'test-C', 30000);
        console.log(`    on the new version ${((Date.now() - t0) / 1000).toFixed(1)} s after opening`);
        errors.length = 0; // until then the old page may show, with its own faults
        await opened(page);
        await page.waitForTimeout(3000);
        await page.evaluate(() => (window.__stayed = true));
        await page.waitForTimeout(4000);
        check(await page.evaluate(() => window.__stayed === true).catch(() => false), 'it opened again once, and then stayed');
        const kept = await copies(page);
        check(kept.every((n) => n.startsWith('incised-lettering-copy-')), `no copy made before the fix is left (${kept.join(', ')})`);
        await setUp(page);
        await expect3d(page, 'test-C', 'opened online once');
        server.offline = true;
        await page.reload();
        await opened(page);
        await expect3d(page, 'test-C', 'then offline');
      });
    } else console.log('  5. skipped: the old versions could not be built from git');

    await browser.close();
  }
} finally {
  server.close();
  done();
  for (const [label] of OLD) spawnSync('git', ['worktree', 'remove', '--force', join(work, label.replace(' ', '-'))], { stdio: 'ignore' });
  if (existsSync(work)) rmSync(work, { recursive: true, force: true });
}
console.log(failed ? `${failed} check(s) failed` : 'All offline-copy checks passed');
process.exit(failed ? 1 : 0);
