# Working on the incised lettering tool

Read BRIEF.md before every task. It is the reference for what this tool does and the craft rules it must follow.

## Who you are working for

Brian is a trained architectural woodcarver. He does not read or write code and does not use the terminal. He judges the work by opening the app and looking at it, and by cutting test letters in wood.

- Explain what you changed in plain workshop language, not code terms.
- End every task with something he can open and look at on the published page.
- Never ask him to run commands, edit files or debug.
- He uses Firefox on Ubuntu, on an ordinary laptop (Intel i5, 16 GB), with the app's offline copy (added 8 Oct 2026).
- His machine is a Genmitsu 3020-PRO Ultra running GRBL. The spindle is run by hand from its manual speed governor and is never controlled by the G-code.
- The status bar shows which version of the app is running ("Version 22, published 8 Oct 2026, 21:40"). When he reports a problem, check the version in his screenshot first.

## Rules

- Metric throughout: millimetres and degrees, no inches in the interface or the G-code (tool shank sizes may be quoted in inches as sold).
- Work in small steps. One clear improvement per task.
- Craft decisions belong to Brian. If a lettering rule is unclear, stop and ask him rather than guessing, then record his answer in BRIEF.md.
- Safety first in G-code: never cut below the stock thickness less a safe floor, never touch a finished wall or termination face, and always show a preview before G-code can be saved.
- One program; editions later (added 8 Oct 2026). Everything stays in one program. A School edition, a gift to the City & Guilds of London Art School where Brian trained, will be made later by switching off the machine functions: the Machine stage, the G-code and the machine's own passes such as the datum line and slit. So layout, spacing, printing and teaching tools never depend on the machine functions, and can be switched off from them cleanly. Don't make a layout, spacing, printing or teaching feature read the G-code, the toolpaths, the machine settings or the bed size to do its work.
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
- Test every heavy feature with the browser's CPU slowed 4×, as Brian's laptop is an ordinary one, not a fast development machine (added 7 Oct 2026). Heavy work goes off the page into a worker, with a progress bar and Esc to cancel, so the page never freezes. The 3D view's check is `npm run test:perf3d` (browser-tests/perf3d.mjs).
- Every browser test runs in Firefox as well as Chrome (added 8 Oct 2026). `npm run test:browser` runs them all in both (browser-tests/; `BROWSERS=firefox` for one; browsers.mjs says how Firefox is found and slowed). Browser tests are never part of `npm test`: GitHub runs that before publishing, on a machine with no browsers or screen.
- Test the installed app as Brian's browser lives with it, not only a clean browser (added 8 Oct 2026). A browser that has kept the offline copy through several updates can fail where a clean or private window works. browser-tests/updates.mjs publishes versions in quick succession, goes offline, and leaves a page open across updates; run it after any change to the offline copy (pwa/sw.js), to how the app loads its own files, or to the build.
- Test with real inscriptions, including punctuation, numerals and blank lines, not just capital letters (added 7 Oct 2026): "No. 1312", "A.D. 1920", dates, quotation marks. Every character the alphabet has goes through the whole job in test/everychar.test.ts; a character that fails is a failing test.
- Errors never reach Brian as raw messages ("TypeError…"). Whatever cannot be worked out is left out, the Problems badge names the character or line in plain words with a fix, and the rest of the job carries on.
- Every fix is tried before it is offered (added 8 Oct 2026). A one-click fix appears only if, tried on a copy of the layout, it cures the problem it is listed under without causing a new one. The fix is built once and the same code is both tried and applied, so what was tried is what Brian gets. Found 8 Oct 2026: "Return line 2 to auto" moved line 2 less than 1 mm and left its problem in place. Tests prove each fix cures its own problem.
- Only ask Brian about craft decisions, never about obvious usability.

