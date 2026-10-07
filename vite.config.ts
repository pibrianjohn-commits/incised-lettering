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

// Relative base so the built site works from the GitHub Pages sub-path
// (https://<user>.github.io/incised-lettering/) as well as locally.
export default defineConfig({
  base: './',
  // three.js (the 3D view) is one large piece, loaded only when the 3D view is opened.
  build: { chunkSizeWarningLimit: 700 },
  plugins: [offlineWorker()],
});
