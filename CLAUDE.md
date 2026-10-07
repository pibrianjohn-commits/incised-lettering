# Working on the incised lettering tool

Read BRIEF.md before every task. It is the reference for what this tool does and the craft rules it must follow.

## Who you are working for

Brian is a trained architectural woodcarver. He does not read or write code and does not use the terminal. He judges the work by opening the app and looking at it, and by cutting test letters in wood.

- Explain what you changed in plain workshop language, not code terms.
- End every task with something he can open and look at on the published page.
- Never ask him to run commands, edit files or debug.

## Rules

- Metric throughout: millimetres and degrees, no inches in the interface or the G-code (tool shank sizes may be quoted in inches as sold).
- Work in small steps. One clear improvement per task.
- Craft decisions belong to Brian. If a lettering rule is unclear, stop and ask him rather than guessing, then record his answer in BRIEF.md.
- Safety first in G-code: never cut below the stock thickness less a safe floor, never touch a finished wall or termination face, and always show a preview before G-code can be saved.
- Keep the app a static site that builds and deploys to GitHub Pages automatically on every push to main.
- Use TypeScript. Keep dependencies few and well established.

## Think like a product designer for professional letterers

A standing rule for every task, from 7 Oct 2026.

- Whenever you build a feature, also build its natural counterparts without being asked:
  - its inverse (fit panel to lettering, and fit lettering to panel);
  - the fix for any problem it reports: every problem in the Problems list offers one-click fixes;
  - its undo;
  - its keyboard shortcut (and its entry in Ctrl+K search and the ? key list);
  - its behaviour in every other tab, view and size.
- Before finishing, use the feature as a letterer would. Try the awkward cases: blank lines, huge or tiny panels, letters off the board, panels too big for the machine. Fix anything illogical you find.
- Test every heavy feature with the browser's CPU slowed 4×, as Brian's laptop is an ordinary one, not a fast development machine (added 7 Oct 2026). Heavy work goes off the page into a worker, with a progress bar and Esc to cancel, so the page never freezes. The 3D view's check is `npm run test:browser` (browser-tests/perf3d.mjs).
- Test with real inscriptions, including punctuation, numerals and blank lines, not just capital letters (added 7 Oct 2026): "No. 1312", "A.D. 1920", dates, quotation marks. Every character the alphabet has goes through the whole job in test/everychar.test.ts; a character that fails is a failing test.
- Errors never reach Brian as raw messages ("TypeError…"). Whatever cannot be worked out is left out, the Problems badge names the character or line in plain words with a fix, and the rest of the job carries on.
- Only ask Brian about craft decisions, never about obvious usability.

