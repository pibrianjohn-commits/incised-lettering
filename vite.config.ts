/// <reference types="vitest/config" />
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** Every file under a folder, as paths relative to it with forward slashes. */
function filesIn(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? filesIn(full, base) : [relative(base, full).split(sep).join('/')];
  });
}

/**
 * Writes sw.js, the offline worker (pwa/sw.js), with the list of every file in
 * the build, so the installed app keeps a copy of all of it and works with no
 * internet. Its version changes whenever any file does, which is how the
 * browser knows to fetch the new copies.
 */
function offlineWorker(): Plugin {
  return {
    name: 'offline-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const hash = createHash('sha256');
      const files = new Set<string>(['./']);
      for (const [name, item] of Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b))) {
        if (name.endsWith('.map')) continue;
        files.add(`./${name}`);
        hash.update(name);
        hash.update(item.type === 'chunk' ? item.code : item.source);
      }
      for (const name of filesIn('public').sort()) {
        files.add(`./${name}`);
        hash.update(name);
        hash.update(readFileSync(join('public', name)));
      }
      const source = readFileSync('pwa/sw.js', 'utf8')
        .replace('__VERSION__', hash.digest('hex').slice(0, 12))
        .replace('__FILES__', JSON.stringify([...files], null, 2));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

const git = (args: string) => execSync(`git ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/**
 * Which version of the app this is, shown in the status bar, the ? list and
 * the Details of a problem, so every screenshot says which version was
 * running: "Version 22, published 8 Oct 2026, 21:40". The number is the last
 * pull request merged into main (GitHub's merge says "Merge pull request
 * #22", or "… (#22)" when squashed), with .1, .2 for any change pushed
 * straight to main after it; the time is when it went onto main, in UK time.
 * APP_VERSION, if set, is used for the number instead: the browser tests use
 * it to make versions of their own.
 */
function appVersion(): { number: string; published: string } {
  let published = '';
  try {
    published = new Date(Number(git('log -1 --format=%ct')) * 1000).toLocaleString('en-GB', {
      timeZone: 'Europe/London',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    /* not from git */
  }
  if (process.env.APP_VERSION) return { number: process.env.APP_VERSION, published };
  try {
    const subjects = git('log --first-parent --format=%s -n 1000').split('\n');
    const i = subjects.findIndex((s) => /^Merge pull request #\d+|\(#\d+\)$/.test(s));
    if (i >= 0) return { number: `${subjects[i].match(/#(\d+)/)![1]}${i ? `.${i}` : ''}`, published };
  } catch {
    /* not from git */
  }
  return { number: 'in development', published };
}
const version = appVersion();

// Relative base so the built site works from the GitHub Pages sub-path
// (https://<user>.github.io/incised-lettering/) as well as locally.
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version.number), __APP_PUBLISHED__: JSON.stringify(version.published) },
  // The unit tests only: the browser tests (browser-tests/) need Playwright, Firefox and a
  // screen, which the publishing machine (deploy.yml) does not have; they run with npm run test:browser.
  test: { include: ['test/**/*.test.ts'] },
  // three.js (the 3D view) is one large piece, loaded only when the 3D view is opened.
  build: { chunkSizeWarningLimit: 700 },
  // The 3D view's sums run in a worker (src/relief.worker.ts), built as a module like the page.
  worker: { format: 'es' },
  plugins: [offlineWorker()],
});
