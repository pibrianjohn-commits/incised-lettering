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
npm test        # geometry checks
npm run build   # static site in dist/
```

Stand-in alphabet: Cinzel by Natanael Gama, SIL Open Font License 1.1
(`public/fonts/OFL.txt`).
