# incised-lettering

Browser tool that turns a line of text into G-code for scribing registration
marks for hand-chiselled incised letters. See [BRIEF.md](BRIEF.md) for what it
does and [CLAUDE.md](CLAUDE.md) for how work on it is done.

Published at https://pibrianjohn-commits.github.io/incised-lettering/ on every
push to `main` (GitHub Actions, `.github/workflows/deploy.yml`).

## Development

```
npm install
npm run dev     # local preview
npm test        # geometry checks (the unit tests only; GitHub runs these before publishing)
npm run build   # static site in dist/
npm run test:browser   # every browser test, in Chromium and Firefox (needs a build)
npm run test:perf3d    #   the 3D view's speed, CPU slowed 4×
npm run test:updates   #   the offline copy across updates and offline (builds its own versions)
```

The browser tests (browser-tests/) are not part of `npm test` or `npm install`:
they need Playwright, found as `playwright` or at `$PLAYWRIGHT`, and Firefox:
Playwright's own build, or an ordinary Firefox at `$FIREFOX`. With no screen,
Firefox only draws 3D on a virtual one, which they start if Xvfb is installed.
`BROWSERS=chromium` or `BROWSERS=firefox` runs one browser. See
browser-tests/browsers.mjs.

The build stamps the version shown in the status bar ("Version 22, published
8 Oct 2026, 21:40") from git: the last pull request merged into main.

The build also writes `dist/sw.js`, the offline worker (from `pwa/sw.js`), with
the list of every file the installed app keeps for working without the internet.

Stand-in alphabet: Cinzel by Natanael Gama, SIL Open Font License 1.1
(`public/fonts/OFL.txt`).
