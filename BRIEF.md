# Incised Lettering Tool — Project Brief

Oct 5, 2026 · @BRIAN

## Purpose

The tool turns a line of text into G-code that scribes registration marks for hand-chiselled incised letters. The CNC marks out; the carver cuts.

It is not a V-carving program and does not carve the letters. With a single 30° V-bit it scribes each letter's outline and a datum line, and sinks a narrow slit down the valley with stop cuts running up into the terminations. Every wall and termination face is cut by hand.

It is private workshop software for Meanwhile Werkery: lettered panels, Masonic inscriptions and, later, lettering on carved banner scrolls.

## The incised letter

Every stroke is cut as a V-section trench with two walls meeting at a valley line. The software works out where that valley runs and how deep it sits.

- **Outline.** The visible edge of the letter on the surface of the wood.
- **Valley line.** The bottom of the trench, running down the middle of each stroke, halfway between its two edges. Geometrically this is the medial axis.
- **Terminations.** At a stroke end the valley forks out to the corners, giving the triangular incised end. The medial axis does this naturally.
- **Depth follows width.** The chisel angle is fixed, so a wider stroke is a deeper valley. At the traditional 60° included angle, depth ≈ 0.87 × stroke width.
- **Bowls.** In D, B, O and other curved letters, the stroke swells and thins, so the valley deepens and shallows along its length. The depth rule handles this without special cases.
- **Junctions.** Where a thin stroke or bowl meets a thick upright, the valleys must meet cleanly at the right depths. At any junction the thicker stroke is continuous; the thinner ends into it (see Decisions).
- **Order of cutting.** Thin strokes are always cut before thick ones. Cutting a thin stroke into a thick stroke that has already been cut risks tear-out at the junction. The software numbers the strokes in cutting order, thin first.

The working formula, with w the stroke width and θ the included chisel angle:

```latex
d = \frac{w}{2} \cdot \frac{1}{\tan(\theta / 2)}
```

## What the software does

The carver types the inscription, sees it laid out on the stock, checks it, then saves the G-code.

1. Load an alphabet, the carver's own letters or a stand-in typeface.
2. Type the inscription, one or more lines.
3. Set the panel and stock: size, thickness, margins, line spacing, alignment.
4. Adjust letter size and kerning, pair by pair where needed.
5. The software computes each letter's outline, valley line, forked terminations and depths.
6. It numbers the strokes in cutting order, thin first.
7. Preview on screen: outlines, valleys, depth shading and stroke numbers, at true scale on the stock.
8. Choose the tool and which passes to run.
9. Save the G-code, and print a bench sheet showing the layout, the strokes numbered in cutting order (thin strokes first) and the settings used.

Nothing goes to the machine until the carver has checked the preview by eye.

## Inputs and settings

All measurements are metric, in millimetres and degrees.

| Setting | What it controls | Starting value |
| --- | --- | --- |
| Alphabet | Letterforms used | Stand-in Roman typeface until the carver's own letters exist |
| Inscription | The text, one or more lines | — |
| Cap height | Letter size | 25 mm |
| Kerning | Space between specific letter pairs, adjustable by hand, for every place the pair occurs or for one gap only | From the alphabet, then adjusted |
| Space depth | How far into a letter the negative-space measure counts | 6 mm, set by eye |
| Letter and line spacing | Overall tracking and leading, each line's own letter and word spacing, and the height of each blank line | — |
| Alignment | Left, centred or right, per line | Centred |
| Panel size | Width and height of the board | Must fit the bed: 300 × 205 mm, or 300 × 400 mm extended |
| Stock thickness | Board thickness, so depths stay safe | — |
| Margins and border | Clear space and an optional border line | — |
| Chisel angle | Included angle of the finished V-section, sets valley depth | 60° |
| Datum set-in | How far the datum line sits inside the outline, as a percentage of the local stroke width | 20% |
| Datum minimum | The datum line never comes closer to the outline than this | 0.2 mm |
| Slit margin | How far the valley slit stops short of the true valley depth | 0.3 mm |
| Safe floor | No cut comes closer to the back of the board than this | 3 mm |
| Zero corner | The panel corner that is X0 Y0 on the machine | Front left |
| Scribed border depth | Depth of a single or double border line | 0.2 mm, up to 1 mm |
| Tool | The V-bit used for every pass | 30° V-groove, 6.35 mm diameter |

The carver's own letters will arrive later as drawn vector files (SVG) or a font file. The software must accept either without changing anything else.

## Machine and G-code

The G-code targets the Genmitsu 3020-PRO Ultra with its 500 W ER11 spindle, cutting oak. The controller dialect is GRBL, to be confirmed against the machine before the first cut. The spindle is run by hand from its own manual speed governor and is not controlled by GRBL (see Decisions), so the G-code never switches it on or off or sets its speed.

The G-code is written in millimetres and absolute coordinates, with zero at the top surface of the stock and a corner of the panel the carver chooses. One 30° V-bit does every pass, with no tool change:

1. **Hairline.** A very light line on the true outline, marking where the finished arris will be.
2. **Datum line.** A light line set in from the outline by a percentage of the local stroke width (never less than the datum minimum), so it follows the thick and thin. The first chisel cut starts here.
3. **Valley slit.** A narrow slit down every valley line, sunk to the true valley depth less the slit margin. At stroke ends it follows the forked lines up into each corner, rising to nothing at the corner point. These forks are the stop cuts for the termination triangles.

Within each pass the strokes are taken in cutting order, thin strokes first and thick strokes after, to match the hand cutting and avoid tear-out where a thin stroke meets a thick one. In the valley slit each stroke is cut whole: the thin stroke stops at the thick stroke's valley line, then the thick stroke is cut straight through the junction. Each stroke's forks are cut straight after it.

The bit's faces are steeper than any face of a 60° letter, so the slit always stays inside the waste and cannot touch a finished wall or termination face.

The carver then works each letter by hand, thin strokes first and thick strokes after:

1. **First cut.** From the datum line down into the slit on both walls, taking out the bulk of the waste.
2. **Tidy cut.** From the hairline down to the bottom of the slit, removing the thin skin left by the first cut and leaving the crisp arris and finished wall.
3. **Terminations.** Each triangle face pared down to its fork stop cuts.

The chosen bit is the [Amana Tool 45634-K](https://www.amanatool.com/products/inch/signmaking-engraving-cnc-router-bits-from-amana-tool/solid-carbide-spektratm-extreme-tool-life-coated-v-groove-signmaking-lettering-router-bits/45634-k-solid-carbide-v-groove-30-deg-x-1-4-dia-x-1-8-x-5-8-inch-shank-spektra-coated-router-bit.): solid carbide, 3 flutes, coated, 6.35 mm diameter, about 10.7 mm cutting depth and a 1/4" shank. That depth covers strokes up to about 12 mm wide. It needs a 1/4" (6.35 mm) ER11 collet, not 6 mm.

Starting settings for oak, to be fine-tuned by test cuts. The spindle's top speed is assumed at about 12,000 rpm and should be checked. The spindle speed is set by hand on the governor; the G-code only states it in its pause message.

| Pass | Spindle (set by hand) | Feed | Depth per pass |
| --- | --- | --- | --- |
| Hairline | 12,000 rpm | 900 mm/min | 0.2 mm, single pass |
| Datum line | 12,000 rpm | 900 mm/min | 0.3 mm, single pass |
| Valley slit and forks | 12,000 rpm | 600–700 mm/min | 1.5–2 mm |
| Plunging | — | 200–300 mm/min | — |

Machine time is roughly 1.5 minutes per letter at 40 mm cap height, about 30 minutes for a 20-letter inscription.

Safety and accuracy rules are built in. Every file begins by raising the bit to the safe height, then pauses (M0) with a plain message to start the spindle by hand at the set speed, and goes on only when Resume is pressed. It ends with the bit raised, back at X0 Y0, and a message to stop the spindle by hand. An Air cut saves the same file lifted clear of the board, the deepest point 5 mm above it, for a dry run. No pass may go below the stock thickness less a safe floor. The board's top surface must be flat and the Z zero exact, because the slit depth is measured from it; an unflat board can be faced on the machine first. The slit margin protects the valley line from small depth errors, so the chisel makes the final meeting at the bottom. Workholding stays as usual: Mitre Fix and decorator's tape.

## Stages

The tool is built in three stages, each usable in the workshop before the next begins.

1. **Flat panel.** Straight lines of lettering on a flat board, with an optional border. This proves the outline, valley, depth, stroke order and G-code on real letters. Typical work: Masonic inscription panels, presentation panels with a lodge name, number and date, and panels with key hooks.
2. **Curved baseline.** Lettering that follows a drawn curve on a flat surface, with letters turned to sit on the curve and spacing kept even along it.
3. **Carved banner scroll.** Lettering projected onto the surface of a CNC-roughed ribbon, such as a church-style triple banner scroll. The software loads the scroll's 3D model and keeps every mark at the right depth relative to the wood as it actually is. Lettering breaks at the turnovers and foreshortens where the ribbon curves away, placed under the carver's control.

## Order of work

What has been built so far. From here on, work follows the **Roadmap** below.

1. **Done: first look.** Stand-in alphabet loaded, one word shown at true scale with outlines, valley lines with forked terminations, and datum lines.
2. **Done: layout workspace.** The flat view became a layout workspace:
   - Pan by dragging and zoom with the scroll wheel towards the cursor. All marks stay hair-thin at every zoom level.
   - A text box for the inscription, with several lines allowed.
   - Sliders for cap height, overall letter spacing, line spacing and alignment, all updating live.
   - Kerning pair by pair: click the gap between two letters and nudge them closer or further apart in 0.1 mm steps, with the value shown.
   - Negative space: a toggle that shades the space between each pair of letters and shows its area in mm², so the spacing can be balanced by eye.
   - A slider for the datum offset. The datum line is kept wherever the stroke is wide enough and stops where it isn't.
   - Panel width and height boxes.
   - Follow-up (see Decisions): kerning for one gap only, a depth limit for negative space in open letters, and a datum line that follows the thick and thin.
3. **Done: workspace tools** (Roadmap, "Workspace tools", below).
4. **Done: Roadmap step 1, lines and layout** (5 Oct 2026).
5. **Done: Roadmap step 2, panel and border** (5 Oct 2026).
6. **Done: Roadmap step 3, right-hand inspection panel** (5 Oct 2026).
7. **Done: Roadmap step 4, spacing intelligence** (5 Oct 2026).
8. **Done: Roadmap step 8, G-code** (5 Oct 2026), brought forward so the method can be tested in wood.
9. **Done: Roadmap step 7, 3D view** (5 Oct 2026).
10. **Done: simpler, modern interface** (7 Oct 2026): stage tabs, context tools, "More" folds, status bar with a warnings badge, drag-to-change, Ctrl+K search and a ? key list, installable offline app, project files and the bench sheet. See Decisions, "The interface".
11. **Done: fit and finish** (7 Oct 2026): problems with one-click fixes, fitting the lettering to the panel, blank lines as spacers, each line's own spacing, and a pass over the whole app. See Decisions, "Fit and finish".

## Roadmap

Agreed 5 Oct 2026. Build in this order, one step at a time.

**Change of order** (5 Oct 2026): step 8 (G-code) is built next, before steps 5, 6 and 7, so the method can be tested in wood as soon as the 30° bit arrives. The order from here is 8, then 5, 6, 7.

**Workspace tools** (added and built 5 Oct 2026, ahead of step 1):
- View presets: **Design** letters filled solid dark, nothing else; **Spacing** letters plus the shaded spaces and their areas; **Setting-out** hairline, datum and valley lines only; **Proof** clean letters with the border, as a client would see them. The individual tick boxes stay for fine control, under Layers. (From 7 Oct 2026 the number keys 1–5 choose the stages of the job, and the presets are on Shift+1 to Shift+4; see Decisions, "The interface".)
- Keyboard kerning: with the cursor in a gap, Alt+arrow keys close or open it 0.1 mm, Alt+Shift+arrow 1 mm; Tab and Shift+Tab move to the next or previous gap. A toggle shows every kerning value as a small number under its gap.
- Undo and redo (Ctrl+Z, Ctrl+Shift+Z) for every change.
- Rulers in mm along the top and left of the workspace; guides dragged out of the rulers; a measure tool that reads the distance in mm between two points.

1. **Lines and layout.** *Done 5 Oct 2026.*
   - Each line is an object with a number, shown in the margin of the workspace beside the line.
   - Click to select a line, drag to move it, and nudge it with the plain arrow keys: 0.1 mm per press, or 1 mm with Shift.
   - Kerning inside a selected line stays fixed while it moves.
   - Exact position boxes: left, centre and baseline.
   - Snapping guides while dragging: panel centre, margins, border, the ruler guides, the ends, centres, baselines and cap lines of other lines, and equal gaps. Hold Alt to drag freely.
   - A dragged line stops following the line-spacing slider until "Return to auto". "Re-flow all" resets every line.
   - Lock a line.
   - Undo and redo, covering line moves (each drag is one step).
   - Text stays editable after a line has been moved, and kerning survives text edits.
2. **Panel and border.** *Done 5 Oct 2026.*
   - Panel size set by hand, or fitted to the inscription plus margins.
   - Border inset from the panel edge. Border styles: none, single scribed, double, or incised like the letters. Corner styles come later.
   - Margins set per side, measured from the border, or from the panel edge where there is no border.
   - Machine bed check.
   - Background reference image: load a photo of an inscription, a rubbing, a drawing or an alphabet sheet behind the layout, scaled to true size and locked, to trace or match.
3. **Right-hand inspection panel.** *Done 5 Oct 2026.*
   - Overview of the whole panel with the letters filled solid black, with a toggle to show plain line blocks instead. It doubles as a navigator.
   - Line list showing for each line: number, text, length in mm and as a % of panel width, cap height, position, colour (% of the line's area that is letter), auto or placed, and lock.
   - Balance figures: space at top, bottom, left and right; the top-to-bottom ratio; and the visual centre of the lettering against the panel centre.
4. **Spacing intelligence.** *Done 5 Oct 2026.* Kerning works at three levels: by group, by exact pair (overriding its groups), and for one gap. Group and pair kerning, the groups and the even-up settings are saved with the alphabet; one-gap kerning and fitting stay with the job. Even-up suggestions are only ever shown for the carver to accept, refuse or tweak (with an optional preview on the panel), never applied silently.
   - "Even up spacing" adjusts each pair until the measured spaces are optically equal. The changes are shown as suggestions to accept, refuse or tweak.
   - Even-up calibrated by eye: the carver sets one reference pair (such as H H) to look right, and every other pair is matched to its measured area, with separate factors for round, straight and diagonal letters.
   - Fit a line to a set width, or fit a line or block into a set box, filling spare width by word spacing or by letter spacing.
   - Kerning saved as part of the alphabet: pairs the carver sets are applied automatically every time those letters are typed, in every job.
   - Kerning groups: letters sharing a side shape (O C G Q, H I N M) are kerned together, with exceptions allowed.
   - Word stops: small incised triangles between words, cut like the letters.
5. **Alphabet setting and alternates.**
   - A mode for alphabet stones: A–Z, ampersand and numerals in classic layouts (tapering triangle, even rows, alphabet with motto), drawing on the layout types of Gill, Kindersley and others.
   - Letters can have alternates (long-legged R, flourished ampersand, long-tailed Q), chosen per instance.
   - Ligatures and alternates supported properly.
6. **Working comfort.**
   - Save and open projects as files. *Done 7 Oct 2026, with the interface (see Decisions).*
   - Save the carver's own presets.
   - Saved styles, for consistent lettering across a set of pieces.
   - A library of complete finished layouts, saved and reused (not empty templates).
   - Client proof: export the layout as a clean PDF or image for customer approval.
   - Full-size printed template: print the layout at 1:1 across several sheets, for transfer or for checking against the wood.
7. **3D view.** *Done 5 Oct 2026; made quick on an ordinary laptop 7 Oct 2026.* The board at its panel size and real stock thickness; "Marked out by the bit" is stamped from exactly the cuts in the G-code, and "Finished letters" carves every letter to the chisel angle; a plain matte surface or depth colours; a light swept from the left, over the top of the panel, to the right, and raised or lowered, with shadows traced across the cuts; "Sharper" for a close look. Opened with the 3D tab or key 5. See Decisions, "The 3D view".
   - Like Kiri:Moto: orbit, pan and zoom.
   - Set the stock size.
   - Show the board as the 30° bit marks it out (hairline, datum, valley slit and fork stop cuts at true depth) and as the finished incised letter.
   - A light that can be swept left to right to show the shadows.
8. **G-code.** *Done 5 Oct 2026.* Generate the marking-out passes for the Genmitsu 3020-PRO Ultra as set out under Machine and G-code, taking the strokes within each pass in cutting order: thin strokes first, then thick. Every pass is shown on screen (the slit at its true cut width, strokes numbered in cutting order, travel moves dashed, X0 Y0 marked), with safety checks; the G-code can be saved only after every pass has been looked at and every blocking check is passed, and any change to the layout closes the preview. Each file starts with the bit raised and a pause to start the spindle by hand; an Air cut option saves the same file lifted 5 mm clear of the board for a dry run (added 7 Oct 2026).

**Later, not yet scheduled:**
- Per-line cap height and scaling.
- Non-ranging letters.
- The carver's own alphabet, loaded from SVG files.
- Curved baselines and carved banner scrolls (Stages 2 and 3).
- Double-click a letter to select it on its own.
- Variants: save versions of a layout and compare them side by side.

## Technology and setup

The tool is a browser app written in TypeScript, kept in a GitHub repository and published automatically to a web address with GitHub Pages. The carver opens it from a bookmark, or installs it from the browser (Chrome or Edge) as an app with its own window and icon that works without the internet. No terminal, and it works the same on Ubuntu and Windows.

- **Projects** save as files on the laptop (`.lettering`), so designs stay with the carver.
- **G-code** downloads as a file, ready for the machine's sender program. An air-cut copy, lifted clear of the board, can be saved alongside it for a dry run.
- **Letter shapes** are read with an established font and SVG library.
- **Outline geometry** such as offsets and clean joins uses an established clipping library.
- **Valley lines** are written carefully in-house, built on a Voronoi or straight-skeleton method, because they are the heart of the tool.
- **3D work** uses three.js: first for the 3D view of the board as machined and as finished, then for the banner scroll stage, to load the scroll model and project lettering onto it.

TypeScript is chosen because it catches whole classes of mistakes before they reach the machine, which matters when the carver does not read the code. It is also the same family of language as Kiri:Moto and the kiri-bjm fork.

## How we work

Claude Code builds the tool from this brief; the carver judges the results in the preview and on the wood.

- This brief is exported as Markdown into the repository and stays there as the reference every coding session works from.
- A new repository is made under the carver's existing GitHub account, separate from the kiri-bjm fork.
- Work goes in small steps, each ending with something the carver can open and look at.
- Craft decisions stay with the carver. Where a rule is unclear, the code asks rather than guesses, and the answer is added to this brief.
- Every feature is built the way a product designer for professional letterers would build it (7 Oct 2026, in CLAUDE.md): with its inverse, a one-click fix for every problem it reports, its undo, its keyboard shortcut, and its behaviour in every stage, view and size; then used as a letterer would, awkward cases included, before it is finished. Only craft decisions are put to the carver.
- Testing uses a fixed set of check letters covering the hard cases: I, O, D, B, R, S, A and W.
- First cuts are made in scrap or PIR before oak.

* [ ] Carver reviews this brief and answers the open questions
* [x] Create the GitHub repository and switch on GitHub Pages
* [x] Stage 1, first step: load the stand-in alphabet and show one word with outlines and valley lines
* [x] Layout workspace (see Order of work)
* [ ] Roadmap steps 1–8 (see Roadmap)

## Decisions

Answers from the carver, recorded as they are given.

- **Datum line on narrow strokes** (5 Oct 2026). Keep a datum line wherever the stroke is wide enough and stop it where it isn't.
- **Kerning** (5 Oct 2026). A kerning adjustment applies to every place that pair of letters occurs. The kerning box also has a "this gap only" option, so a single gap can be adjusted on its own; that adjustment is added on top of the pair's.
- **Negative space in open letters** (5 Oct 2026). The space between letters only counts a limited depth into open letters such as E, C, F, L and the mouth of G. The depth is set by eye with a slider, measured in from each letter's furthest point on that side, and the cut-off is shown on screen. Starting value 6 mm.
- **Datum offset follows the stroke** (5 Oct 2026). The datum line is set in from the outline by a percentage of the local stroke width, so it follows the thick and thin, starting at 20%. A minimum distance (starting at 0.2 mm) stops it crowding the hairline. It is still dropped where the stroke is too narrow, which is wherever the stroke is narrower than twice the distance it would be set in.
- **Cutting order: thin before thick** (5 Oct 2026). Correction to the earlier "thick first" rule. Thin strokes are cut first, then thick strokes, because cutting a thin stroke into a thick stroke that has already been cut risks tear-out at the junction. This applies to the stroke numbering, the printed cutting sheet and the order of strokes within the machine passes (Roadmap step 8).
- **Incised border corners** (5 Oct 2026). On an incised border the valley forks only into the outer corners: these are hollows and need a stop cut. The inner corners are raised ridges, formed by paring both walls to meet, so they get no stop cut.
- **G-code cutting order** (5 Oct 2026). Letter by letter in reading order, and within each letter thin strokes before thick, as built.
- **Safe floor** (5 Oct 2026). 3 mm is right.
- **Zero corner** (5 Oct 2026). X0 Y0 is the front left corner of the panel: the corner nearest the carver and to the left, with the board on the bed reading the right way up. That is the bottom left corner on screen. It is the starting setting, and the other corners can still be chosen per job.
- **Scribed border depth** (5 Oct 2026). Single and double borders have their own depth setting, starting at 0.2 mm (a marking-out line) and allowed up to about 1 mm for a finished decorative line. They are cut in the hairline pass. An incised border's edges stay at the hairline depth.
- **Spindle run by hand; start pause and air cut** (7 Oct 2026). Safety, before the first cut. The spindle is run by hand from its manual speed governor and is not controlled by GRBL, so the G-code never switches it on or off or sets its speed (no M3, M5 or S words). Every G-code file begins with the bit raised to a safe height (the lift between cuts), then an M0 pause with a plain message telling the carver to start the spindle at the set speed; the machine only continues when Resume is pressed. The file ends with the bit raised, back at X0 Y0, and a message to stop the spindle by hand. An "Air cut" option saves the same file with every Z raised to 5 mm or more above the board, for a safe dry run: the whole job is lifted by the deepest cut plus 5 mm, so even the bottom of the deepest slit passes 5 mm clear of the surface, and every move is otherwise identical.
- **The interface** (7 Oct 2026). Simplified and modernised, keeping everything that worked:
  1. **Stage tabs** across the top in job order: **Write, Space, Panel, Machine, 3D**, on keys 1 to 5. Each shows only its own tools in the side panel. Write: the inscription, cap height, letter and line spacing, alignment, lines (word stops under More). Space: kerning, even-up spacing (measuring depth, fit to a width and kerning groups under More). Panel: size, border, margins (reference picture and the screen-scale check under More). Machine: stock thickness, the passes, the preview and the G-code (safe floor, chisel angle, slit margin, zero corner, datum line, and the bit, speeds and depths under More). 3D: the board, the light and the views, with the 3D view filling the workspace; Esc goes back. Each stage opens with its own view (Write and Panel: the letters solid with their lines and margins; Space: Spacing; Machine: Setting-out) and remembers any change made there. The view presets stay as buttons above the panel, now on Shift+1 to Shift+4, and the tick boxes under Layers. Leaving Machine closes the toolpath preview.
  2. **Context tools.** Clicking a line shows its tools floating beside it: left end, centre and baseline, its own letter and word spacing, return to auto, lock, and fit to width. Clicking a gap shows its kerning controls floating beside it. Each box sits above what it belongs to, or below if there is no room, with a small pointer to it.
  3. **More.** Rarely used settings are folded under "More" at the foot of each stage, keeping their starting values. A fold says how many of its settings differ from the starting values, so nothing hidden is a surprise. Search (Ctrl+K) opens the fold when it goes to a setting inside one.
  4. **Status bar** along the bottom: the pointer's position in mm (from the panel's top-left corner, like the rulers), the zoom (click for true size, − and + to zoom), snapping on or off (also key S), short messages, and one warnings badge. The badge lists every problem when clicked: letters not in the alphabet, lines running into each other, lettering past the margins or off the panel, a panel too big for the bed or needing the extended bed, the reference picture missing, and every G-code safety check that fails. Clicking a problem goes to the stage where it is put right, and each has buttons that put it right at once (see "Fit and finish"). A missing stock thickness counts as a warning, not a fault, until the G-code is wanted.
  5. **Drag to change.** Dragging sideways on a setting's name changes its value: right to increase, left to decrease, one step of the setting every few pixels, ten with Shift, held within its limits. A plain click still goes to the box for typing, and the whole drag is one step to undo.
  6. **Ctrl+K** finds any command or setting by name and does it or goes to it. **?** lists every key and mouse action.
  7. **Installable and offline.** In Chrome or Edge, "Install app" (top right, when offered) installs the tool with its own window and icon. Every file is kept on the laptop, so it opens and works with no internet; when online it always loads the newest published version. Double-clicking a project file opens it in the installed app.
  8. **Project files.** File › Save and Open (Ctrl+S, Ctrl+O) save the whole job as a `.lettering` file, with the reference picture inside it. In Chrome and Edge, Save asks where once and then saves back to the same file; elsewhere each save goes to the Downloads folder. The top bar shows the file's name and whether the job has changed since it was saved. Pair and group kerning, the groups and the even-up settings belong to the alphabet and are shared by every job, so if an opened file's differ from the alphabet's, the carver is asked which to keep: the file's (which then become the alphabet's) or the alphabet's current ones. Opening a file is one step to undo. File › New starts again with OAK, as "Start again" did.
  9. **Bench sheet** (File › Bench sheet, or Ctrl+P; it opens on screen with a Print button, and printing from the browser's own menu prints it too): the layout drawn to scale, full size when it fits on A4 (otherwise 1 : 1.33, 1 : 2 and so on, with a scale bar to check the print against a rule), with the hairline, datum and valley lines, every stroke numbered in cutting order and X0 Y0 marked; the cutting order letter by letter, each stroke's width, valley depth and slit depth; every setting used; the safety checks; and ruled lines for notes. Print at 100%, not "fit to page", for the scale to be true. Stroke numbers count each letter's strokes, thin first: the forks running out to the corners and serifs are the stop cuts for the terminations, pared to last, so they are cut by the machine but not numbered. The toolpath preview uses the same numbers. Strokes are counted as set out under "Strokes at a junction" below.
- **Strokes at a junction** (7 Oct 2026). At any junction the thicker stroke is continuous and counts as one stroke; the thinner stroke ends into it. A is three strokes (thick right leg, thin left leg, crossbar); B is the stem plus one stroke per bowl. The thin stroke is cut first and stops at the thick stroke's valley line, then the thick stroke is cut straight through. Where strokes are equal width, the one cut second is continuous. The stroke numbering (bench sheet and toolpath preview) and the machine's cutting order follow this. As built:
  - A stroke carries on through a junction where its valley goes on nearly straight on the other side (turning no more than 25°). Where more than one could, the thicker goes through.
  - A thin stroke crossed by a thicker one (the thin diagonal of X) is still one stroke, cut in two parts, each stopping at the thick stroke's valley line.
  - Where the thicker stroke ends at the junction rather than passing through it, as the stem of T meets its bar, it stops at the thinner stroke's valley line and the thinner one runs on: T is two strokes.
  - Strokes count as equal width when their average widths are within 3%. Equal strokes are cut left to right, then top to bottom (see "Equal-width strokes" below), so where they cross, the right-hand or lower one is continuous.
  - Each stroke's forks into its corners and serifs are cut straight after the stroke, carrying its number but not labelled.
  - With the stand-in alphabet this gives: A 3, B 3, D 2, E 4, H 3, I 1, K 3, M 4, N 3, O 1, Q 2, R 3, S 1, T 2, W 4, X 2, Y 3. U is one stroke: its thick left side curves round into the thin right side with no junction between them (see "U" below).
- **Equal-width strokes** (7 Oct 2026). They stay as built: cut left to right, then top to bottom. So where two strokes of equal width meet, the right-hand or lower one, cut second, is continuous.
- **U** (7 Oct 2026). U stays as one stroke, like O and S: a continuous valley with no junction.
- **The look** (7 Oct 2026). The whole app restyled to look modern, with nothing else changed:
  - It follows the computer's own light or dark setting: a clean light theme, or a neutral graphite dark theme.
  - Modern type: Inter for the interface, kept with the app so it works offline. The inscription itself is still shown in the alphabet (Cinzel).
  - One accent colour, deep blue, for selection and active controls: the chosen stage, view and setting, the selected line or gap, and the main button of each step. There is no beige or brown anywhere in the interface; the app's icon is graphite too.
  - The board is a plain light surface while designing, in both themes. Realistic oak appears only in the Proof view: plain-sawn oak with cathedral arches, uneven growth rings and open pores along the grain. (The 3D view had it too until 7 Oct 2026; see "The 3D view" below.)
  - The marking lines keep the same clear, distinct colours in both themes, because they always sit on the light board: hairline near-black, datum line violet and dashed, valley line red, space between letters green, margins, baselines and the machine bed grey and dashed, kerning values orange, ruler guides cyan, and measuring and snapping pink. The datum line moved from blue to violet so that blue means selection only. The bench sheet uses the same colours. In the dark theme, letters and hairlines running off the board have a faint light edge, so they still show against the graphite.
  - The problems badge is green when all is well, amber for warnings and red for faults.

- **Fit and finish** (7 Oct 2026). A pass over the whole app as a letterer would use it:
  - **Problems, every side, every fix.** Lettering is checked against all four margins (to the letters' ends, and from cap line to baseline) and all four edges of the board (to the letters themselves, overshoots and word stops included), line by line. Lines laid out automatically make one problem between them, since they share one cause; each line placed by hand makes its own. Each problem says which lines, which sides and by how much. Every problem has buttons that put it right at once, each one step to undo:
    - lettering past a margin or off the board: **Fit lettering to panel** (when it is too big for the space), **Fit panel to lettering**, and for a line placed by hand **Move line inside the margins** and **Return line to auto**;
    - lines running into each other: **Open the line spacing** just enough to part them, or **Return line to auto** (or unlock it, if it is locked);
    - letters not in the alphabet: **Change them to capitals** (when the alphabet has only capitals), or **Take them out of the text**, with the space each leaves;
    - no room inside the border and margins: **Fit panel to lettering**;
    - a panel too big for the machine or needing the extended bed: **Shrink everything to fit the bed**, the panel, border, margins, guides, picture and lettering all together so the design keeps its look (and to the extended bed, when that lets it stay bigger);
    - the reference picture not kept: **Load it again** or **Remove it**;
    - a cut deeper than the stock allows, or than the bit can reach: **Make the letters smaller**, to just the cap height that brings the deepest slit within the limit; or go to the stock thickness, the bit or the border;
    - the stock thickness not entered, or the bit not steeper than the letter walls: go straight to that setting;
    - no pass chosen: **Run every pass**.
    The same buttons appear under each failed check in the G-code preview, which then previews the passes afresh, and in Ctrl+K as "Put right: …". A fix made from the list leaves the list open to show what is left.
  - **Fit lettering to panel** (F, or Panel › Lettering to the panel: Both, Width, Height), the inverse of **Fit panel to lettering** (Shift+F). The lettering is scaled to fill the space inside the margins and border across, up, or as big as fits both ways. Cap height (to the 0.1 mm below, so it never ends a hair outside), letter spacing, line spacing, blank-line heights, each line's own spacing and the places of lines set by hand all scale together, so the layout keeps its look. Both fits count a blank line at the very start or end of the text as space asked for.
  - **Kerning scales with the letters.** Hand kerning (pair, group and one-gap) is kept as it would be at 25 mm cap height and shown in mm at the size the letters are now, so a pair kerned −0.6 mm at 25 mm is −1.2 mm at 50 mm. Fitting or resizing the lettering therefore keeps the spacing in proportion, as it would be when drawing the letters larger. Older saves are converted once, keeping every value as it was at its own size.
  - **Blank lines are spacers.** Only lettered lines are numbered (1, 2, 3…), in the margin, the line tools, the inspection panel, the problems and the bench sheet. A blank line shows as a band across the panel, labelled with its height, which starts at one line spacing. Drag its lower edge to change its height (0.5 mm steps, Alt for any), or click it and use ↑ and ↓ (Shift for 5 mm), type a height, put it back to the line spacing, or remove the blank line (Delete). A blank line keeps its height through edits to the lines around it.
  - **Each line's own spacing.** The line tools have the line's own letter spacing and word spacing (added to the job's), and Reset spacing. The selected line has handles at its ends: drag one to spread or close its letters, so spreading a line never needs typed spaces. The anchored end stays put: a left-aligned line has a handle only at its right end, a right-aligned line only at its left, and a centred line keeps its centre, both ends moving. A dragged end snaps to the margins, border, guides and the other lines' ends (Alt drags freely). [ and ] close and spread the selected line 0.1 mm a pair, 1 mm with Shift. Every drag or run of key presses is one step to undo. A locked line's spacing can't be changed until it is unlocked.
  - **Zoom to panel.** The view's "Fit panel" button is now **Zoom to panel** (Z), so it can't be confused with fitting the panel to the lettering. True size is Shift+Z. When a new panel size is entered and the panel no longer sits comfortably on screen, the view zooms to it.
  - **The 3D view opens at any panel size.** A panel too big for the machine can still be seen in 3D and in the preview; the bed only stops the G-code being saved.
  - Smaller things put right: warnings in the problems list are no longer shown in red; the areas over the gaps step up a row where they would run together when zoomed out, so two figures never read as one; the blank-line label sits inside its band; the fit buttons in the Panel stage no longer run off the side panel; and the panel size boxes accept any size.

- **The 3D view** (7 Oct 2026). It hung on a 300 × 196 mm panel. Put right, and these decided:
  - **A plain surface.** The top of the board is a plain, matte, light neutral grey, chosen to show the cuts and their shadows as clearly as possible: light enough for the flat top to read as the face of the board, with room above it for walls turned to the light to come up brighter, and shadows going dark against it. The sides are the same grey, a little darker. No oak in the 3D view; oak stays in the Proof view. The traced shadows and the movable light are exactly as before. "Colour" is now **Plain** or **Depth**.
  - **The depth map is sized by its cells in all, not by its sides.** About 2 million cells at most, whatever the board's shape, kept in single precision (Float32): a full-bed board (300 × 205 mm) has detail every 0.18 mm, a 1000 × 1000 mm board every 0.71 mm, and anything up to about 80 × 40 mm the full 0.04 mm. Before, it was 4,096 cells along the longer side, about 11 million on a full bed, which is what hung. A cell still holds the deepest cut anywhere in it, so a hairline narrower than a cell still shows.
  - **Sharper** (button under Look, or key D in the 3D view): works out just the part of the board in view at full detail (0.04 mm, or as fine as 2 million cells allow over a bigger area), for a close look; move in close first. It is drawn in place of that part of the board, with shadows still cast from outside it. Any change to the board drops it (press Sharper again). If the view already shows all the detail there is, it says to move in closer.
  - **The page never freezes.** All the sums are done away from the page, in a worker, with a progress bar at the top of the 3D view. The board shown stays until the new one is ready. **Esc** stops the work (the board shown stays as it was; with nothing shown yet, a button starts it again); with nothing under way, Esc goes back as before. The 3D view's parts are fetched quietly a few seconds after the app opens, so it opens quickly when wanted, and its drawing programs are made ready while the board is worked out.
  - **Checked as on an ordinary laptop**, with the browser's CPU slowed 4× (browser-tests/perf3d.mjs): a full-bed panel is on screen in about 1.5 seconds (limit 3), marked out or finished; panels up to 1000 × 1000 mm open in about 1.5 seconds without freezing the page (none of the page's own work holds it up for more than a quarter of a second at a time), and Esc stops the work. Before, a 300 × 196 mm board took 17 seconds at full speed and froze the page for 7 seconds at a time. The test machine has no graphics chip, so it draws the 3D picture in software, holding the page up for a further 0.6 to 1 second each time the picture changes; a laptop's graphics chip does that part itself, so that waiting is measured but not counted.

## Open questions

- Is 60° the right included chisel angle, or does it change with letter size or timber? To be settled with test letters in oak.
- What datum set-in, datum minimum and slit margin suit the carver's hand? Starting at 20%, 0.2 mm and 0.3 mm.
- What is the spindle's actual top speed?
- How should serifs and bracketing be handled at terminations, beyond the plain fork into the corners?
- Which stand-in Roman typeface is closest to the letters the carver intends to draw?
- Even-up factors for round, straight and diagonal sides: they start at 1.0 (pure equal space). Measured with the 6 mm depth limit, round pairs such as H O come out with less space than H H, so at 1.0 the suggestions open them up; a round factor below 1 (try 0.8) brings them closer. What factors look right by eye?
- Word stops start as triangles with sides 22% of the cap height, centred 45% up, pointing down. Is that the right size, height and direction?
- The G-code is written for GRBL and still needs confirming against the machine and its sender before the first cut: run the air cut first, then the real file in scrap.
- Does the sender show the pause message on screen? The file sends it two ways (a GRBL message and a comment on the pause line); the pause itself happens either way.
- The negative-space depth limit applies to every letter, so it also trims the space beside the slanting legs of A and V and under the arm of T, not only the bays of open letters. Is that wanted, or should those be left uncut?
