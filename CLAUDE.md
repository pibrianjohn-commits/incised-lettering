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
