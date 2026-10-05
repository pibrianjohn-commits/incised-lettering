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
- **Junctions.** Where a thin stroke or bowl meets a thick upright, the valleys must meet cleanly at the right depths.
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
9. Save the G-code and an optional printed sheet showing the layout and cutting order (thin strokes first).

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
| Letter and line spacing | Overall tracking and leading | — |
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

The G-code targets the Genmitsu 3020-PRO Ultra with its 500 W ER11 spindle, cutting oak. The controller dialect is GRBL, to be confirmed against the machine before the first cut.

The G-code is written in millimetres and absolute coordinates, with zero at the top surface of the stock and a corner of the panel the carver chooses. One 30° V-bit does every pass, with no tool change:

1. **Hairline.** A very light line on the true outline, marking where the finished arris will be.
2. **Datum line.** A light line set in from the outline by a percentage of the local stroke width (never less than the datum minimum), so it follows the thick and thin. The first chisel cut starts here.
3. **Valley slit.** A narrow slit down every valley line, sunk to the true valley depth less the slit margin. At stroke ends it follows the forked lines up into each corner, rising to nothing at the corner point. These forks are the stop cuts for the termination triangles.

Within each pass the strokes are taken in cutting order, thin strokes first and thick strokes after, to match the hand cutting and avoid tear-out where a thin stroke meets a thick one.

The bit's faces are steeper than any face of a 60° letter, so the slit always stays inside the waste and cannot touch a finished wall or termination face.

The carver then works each letter by hand, thin strokes first and thick strokes after:

1. **First cut.** From the datum line down into the slit on both walls, taking out the bulk of the waste.
2. **Tidy cut.** From the hairline down to the bottom of the slit, removing the thin skin left by the first cut and leaving the crisp arris and finished wall.
3. **Terminations.** Each triangle face pared down to its fork stop cuts.

The chosen bit is the [Amana Tool 45634-K](https://www.amanatool.com/products/inch/signmaking-engraving-cnc-router-bits-from-amana-tool/solid-carbide-spektratm-extreme-tool-life-coated-v-groove-signmaking-lettering-router-bits/45634-k-solid-carbide-v-groove-30-deg-x-1-4-dia-x-1-8-x-5-8-inch-shank-spektra-coated-router-bit.): solid carbide, 3 flutes, coated, 6.35 mm diameter, about 10.7 mm cutting depth and a 1/4" shank. That depth covers strokes up to about 12 mm wide. It needs a 1/4" (6.35 mm) ER11 collet, not 6 mm.

Starting settings for oak, to be fine-tuned by test cuts. The spindle's top speed is assumed at about 12,000 rpm and should be checked.

| Pass | Spindle | Feed | Depth per pass |
| --- | --- | --- | --- |
| Hairline | 12,000 rpm | 900 mm/min | 0.2 mm, single pass |
| Datum line | 12,000 rpm | 900 mm/min | 0.3 mm, single pass |
| Valley slit and forks | 12,000 rpm | 600–700 mm/min | 1.5–2 mm |
| Plunging | — | 200–300 mm/min | — |

Machine time is roughly 1.5 minutes per letter at 40 mm cap height, about 30 minutes for a 20-letter inscription.

Safety and accuracy rules are built in. No pass may go below the stock thickness less a safe floor. The board's top surface must be flat and the Z zero exact, because the slit depth is measured from it; an unflat board can be faced on the machine first. The slit margin protects the valley line from small depth errors, so the chisel makes the final meeting at the bottom. Workholding stays as usual: Mitre Fix and decorator's tape.

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

## Roadmap

Agreed 5 Oct 2026. Build in this order, one step at a time.

**Change of order** (5 Oct 2026): step 8 (G-code) is built next, before steps 5, 6 and 7, so the method can be tested in wood as soon as the 30° bit arrives. The order from here is 8, then 5, 6, 7.

**Workspace tools** (added and built 5 Oct 2026, ahead of step 1):
- View presets, each on a number key: **Design (1)** letters filled solid dark, nothing else; **Spacing (2)** letters plus the shaded spaces and their areas; **Setting-out (3)** hairline, datum and valley lines only; **Proof (4)** clean letters with the border, as a client would see them. The individual tick boxes stay for fine control.
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
   - Save and open projects as files.
   - Save the carver's own presets.
   - Saved styles, for consistent lettering across a set of pieces.
   - A library of complete finished layouts, saved and reused (not empty templates).
   - Client proof: export the layout as a clean PDF or image for customer approval.
   - Full-size printed template: print the layout at 1:1 across several sheets, for transfer or for checking against the wood.
7. **3D view.** *Done 5 Oct 2026.* The board at its panel size and real stock thickness; "Marked out by the bit" is stamped from exactly the cuts in the G-code, and "Finished letters" carves every letter to the chisel angle; wood or depth colours; a light swept from the left, over the top of the panel, to the right, and raised or lowered, with shadows traced across the cuts. Opened with the 3D view button or key 5.
   - Like Kiri:Moto: orbit, pan and zoom.
   - Set the stock size.
   - Show the board as the 30° bit marks it out (hairline, datum, valley slit and fork stop cuts at true depth) and as the finished incised letter.
   - A light that can be swept left to right to show the shadows.
8. **G-code.** *Done 5 Oct 2026.* Generate the marking-out passes for the Genmitsu 3020-PRO Ultra as set out under Machine and G-code, taking the strokes within each pass in cutting order: thin strokes first, then thick. Every pass is shown on screen (the slit at its true cut width, strokes numbered in cutting order, travel moves dashed, X0 Y0 marked), with safety checks; the G-code can be saved only after every pass has been looked at and every blocking check is passed, and any change to the layout closes the preview.

**Later, not yet scheduled:**
- Per-line cap height and scaling.
- Non-ranging letters.
- The carver's own alphabet, loaded from SVG files.
- Curved baselines and carved banner scrolls (Stages 2 and 3).
- Double-click a letter to select it on its own.
- Variants: save versions of a layout and compare them side by side.

## Technology and setup

The tool is a browser app written in TypeScript, kept in a GitHub repository and published automatically to a web address with GitHub Pages. The carver opens it from a bookmark: no installing, no terminal, and it works the same on Ubuntu and Windows.

- **Projects** save as files on the laptop, so designs stay with the carver.
- **G-code** downloads as a file, ready for the machine's sender program.
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

## Open questions

- Is 60° the right included chisel angle, or does it change with letter size or timber? To be settled with test letters in oak.
- What datum set-in, datum minimum and slit margin suit the carver's hand? Starting at 20%, 0.2 mm and 0.3 mm.
- What is the spindle's actual top speed?
- How should serifs and bracketing be handled at terminations, beyond the plain fork into the corners?
- Where thick and thin strokes cross, as in A or W, which valley wins at the crossing?
- Is the printed sheet showing the layout and cutting order wanted?
- Which stand-in Roman typeface is closest to the letters the carver intends to draw?
- Even-up factors for round, straight and diagonal sides: they start at 1.0 (pure equal space). Measured with the 6 mm depth limit, round pairs such as H O come out with less space than H H, so at 1.0 the suggestions open them up; a round factor below 1 (try 0.8) brings them closer. What factors look right by eye?
- Word stops start as triangles with sides 22% of the cap height, centred 45% up, pointing down. Is that the right size, height and direction?
- The G-code is written for GRBL and still needs confirming against the machine and its sender before the first cut: run it in the air (Z raised) or in scrap first.
- The negative-space depth limit applies to every letter, so it also trims the space beside the slanting legs of A and V and under the arm of T, not only the bays of open letters. Is that wanted, or should those be left uncut?
