// The browsers the browser tests run in: Chromium and Firefox, through
// Playwright (CLAUDE.md: every browser test runs in both; Brian uses Firefox
// on Ubuntu).
//
// Playwright is not one of the app's dependencies: set PLAYWRIGHT to where it
// is installed if it is not found (e.g. /opt/node-tools/node_modules/playwright).
// Firefox is Playwright's own build if it is installed, or an ordinary Firefox
// (as Brian has) at FIREFOX, driven over WebDriver BiDi.
//
// With no screen (a server), Firefox only draws 3D on a virtual one, so if
// DISPLAY is not set and Xvfb is installed, one is started for it.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT ?? 'playwright');

export const BROWSERS = (process.env.BROWSERS ?? 'chromium,firefox').split(',').map((s) => s.trim()).filter(Boolean);

let xvfb = null;
/** A screen for Firefox to draw 3D on, started if there is none. */
function display() {
  if (process.platform !== 'linux' || process.env.DISPLAY) return {};
  if (!xvfb && spawnSync('which', ['Xvfb']).status === 0) {
    const n = 90 + Math.floor(Math.random() * 400);
    xvfb = { proc: spawn('Xvfb', [`:${n}`, '-screen', '0', '1400x900x24'], { stdio: 'ignore' }), env: { DISPLAY: `:${n}`, LIBGL_ALWAYS_SOFTWARE: '1' } };
    spawnSync('sleep', ['1']);
  }
  return xvfb?.env ?? {};
}

/** Launch Chromium or Firefox. */
export async function launch(name) {
  if (name === 'chromium') return pw.chromium.launch();
  if (name !== 'firefox') throw new Error(`unknown browser ${name}`);
  const env = display();
  const headless = !env.DISPLAY && !process.env.DISPLAY;
  // Machines with no graphics chip draw WebGL in software, which Firefox leaves off unless asked.
  const firefoxUserPrefs = { 'webgl.force-enabled': true };
  if (process.env.FIREFOX) return pw._bidiFirefox.launch({ executablePath: process.env.FIREFOX, headless, env: { ...process.env, ...env }, firefoxUserPrefs });
  return pw.firefox.launch({ headless, env: { ...process.env, ...env }, firefoxUserPrefs });
}

/**
 * Firefox has no way of its own to slow the computer down, so on Linux, where
 * the system allows it (a cgroup), the processes that run web pages, and
 * with them each page's workers, are held to 1/factor of one processor core
 * between them: a page and its worker busy at once share that. Firefox's
 * drawing runs in a process of its own, left at full speed, as Chrome's
 * slowing leaves its graphics alone. Call the returned function after
 * opening a page (a new page may get a new process); it returns false if
 * slowing is not possible here.
 */
export function slowFirefoxPages(factor) {
  const v2 = '/sys/fs/cgroup/cgroup.controllers';
  const root = existsSync(v2) ? '/sys/fs/cgroup' : existsSync('/sys/fs/cgroup/cpu/cgroup.procs') ? '/sys/fs/cgroup/cpu' : null;
  if (!root) return () => false;
  const group = join(root, `browser-tests-slow-${process.pid}`);
  try {
    mkdirSync(group, { recursive: true });
    if (root === '/sys/fs/cgroup') writeFileSync(join(group, 'cpu.max'), `${Math.round(100000 / factor)} 100000`);
    else {
      writeFileSync(join(group, 'cpu.cfs_period_us'), '100000');
      writeFileSync(join(group, 'cpu.cfs_quota_us'), String(Math.round(100000 / factor)));
    }
  } catch {
    return () => false;
  }
  slowGroups.push(group);
  return () => {
    const ps = spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' }).stdout ?? '';
    const pages = ps
      .split('\n')
      .filter((l) => /firefox.*-contentproc.*-isForBrowser/.test(l))
      .map((l) => l.trim().split(/\s+/)[0]);
    try {
      for (const pid of pages) writeFileSync(join(group, 'cgroup.procs'), pid);
      return pages.length > 0;
    } catch {
      return false;
    }
  };
}
const slowGroups = [];

/** Stop the virtual screen, if one was started, and let go of any slowing. */
export function done() {
  xvfb?.proc.kill();
  xvfb = null;
  for (const g of slowGroups.splice(0)) {
    try {
      // Processes still in it go back to the top before it can be removed.
      const top = join(g, '..', 'cgroup.procs');
      for (const pid of readFileSync(join(g, 'cgroup.procs'), 'utf8').split('\n').filter(Boolean)) writeFileSync(top, pid);
      rmdirSync(g);
    } catch {
      /* gone already */
    }
  }
}
