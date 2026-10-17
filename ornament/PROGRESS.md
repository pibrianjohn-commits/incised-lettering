# Ornament side: progress

Newest first. Older reports move to ornament/design/PROGRESS_ARCHIVE.md.

## Card 4: numbered design sets (17 Oct 2026)

Card: ornament/design/CARD_04_numbered_sets.md.

### Results
- Both tests the card asks for pass: two saves of a lid named walnut-box give walnut-box_001_field.svg … walnut-box_001_hip-left.svg, then the same five with 002; templates without data-lid save as lid_001_field.svg, lid_001_hip-front.svg, lid_001_hip-right.svg, lid_001_hip-back.svg, lid_001_hip-left.svg.
- The card 2 save test now checks the new behaviour: all five places are saved, and the set opens back as the lid exactly as it was. All the other tests still pass (488 in all).
- Tried in the browser with a walnut-box lid: two clicks gave ten files, 001 then 002, and "Last saved: walnut-box 002" beside the button, still there after the page was reloaded.

### What was built
- **Save lid design** now saves the whole lid as one numbered set: `<lid>_<number>_<place>.svg`, every place each time, with layers or without. A place with a design is saved as its design; a hip that is still a shaped panel is saved as its template, as it came.
- **The lid's name** is the templates' data-lid (the field's, if they differ), or "lid" if there is none. Saved designs now carry data-lid on, so a set opened again saves under the same name.
- **The number** is three digits from 001, one up per save, the same for the whole set, counted for each lid separately in this browser.
- **"Last saved: walnut-box 002"** beside the button, for the lid that is open. Nothing shows before its first save.
- The button is ready whenever the whole lid is open, even with no layers yet. Its tip, the Ctrl+K entry and BRIEF.md say what it now does.
- **PLAN.md**, "The file format": the naming added.

### Faults found and fixed while using it
- None.

### Assumptions (please check)
- **Counted per lid.** walnut-box and oak-box each have their own 001, 002…
- **Not undone.** Ctrl+Z doesn't take a set number back: the files are already in the Downloads folder.
- **Odd characters.** A data-lid with spaces or characters a file name can't hold (/ \ : * ? " < > |) has them turned into "-": "walnut box" saves as walnut-box_001_….
- If this browser won't keep anything (a private window that refuses storage), the numbers still go up for that visit, from 001 again next time.

### Questions for the design chat
- None.

### Not tested
- In Firefox (none on this machine): tried in Chromium only. The card asked for no slowed-CPU test.
- With real templates from the lid add-on carrying data-lid.
- The installed offline copy.

## Card 3: the From above view (17 Oct 2026)

Card: ornament/design/CARD_03_from_above.md.

![The lid from above: the field in the middle, each hip squashed to 32 deep, meeting on the corner lines](design/card03-from-above.png)

### Results
- Both tests the card asks for pass: hips with data-plan-depth 32 draw 32 deep in From above, against the field edge with no gap, and the corner lines of neighbouring hips meet within 0.01; a lid with one hip without data-plan-depth gives "Export the templates again from Blender to see this view" and is drawn Flat.
- All the other tests still pass (486 in all).

### What was built
- **Flat | From above**, in the bar over the drawing beside Layout and Tone, shown when the whole lid is open. F switches between them; Ctrl+K finds both; the ? list has F.
- **From above** draws the lid as it sits on the box: the field in the middle, each hip squashed across its width to its depth seen from above, against the field edge, neighbouring hips meeting on the diagonal corner lines. Layers and the place names are squashed the same way. Tone works in it, with the same scale as Flat. The bar reads "Lid from above · …".
- **For looking only**: no handles show, and a click on a place goes back to Flat with that place picked.
- **Older hip templates** (no data-plan-depth): asking for From above leaves the drawing Flat, with the line "Export the templates again from Blender to see this view." over it until Flat is picked.
- The choice is remembered in this browser, like Layout and Tone.
- **The hip names** are now dark ink on a pale edge, a little larger and bolder, so they read on the faded hips in light and dark alike. The place being worked on is still named in blue.
- **PLAN.md**, "The file format": data-slope (degrees) and data-plan-depth (mm) added as optional on hip templates. Both are read, and written back in saved designs.

### Faults found and fixed while using it
- The line about older templates first showed only for a moment in the status bar, where the next message wiped it. It now stays over the drawing while From above is asked for.

### Assumptions (please check)
- **Squashed straight across.** Each hip is squashed only across its width (top edge to foot); its length is kept. With a real hip, whose ends run out by its plan depth at each end, that makes the corners meet exactly on the diagonals.
- **All four or none.** If any one hip has no data-plan-depth, the whole lid stays Flat, rather than mixing the two.
- **data-slope** is read and kept, but nothing uses it yet; the depth seen from above comes from data-plan-depth alone.

### Questions for the design chat
- None.

### Not tested
- In Firefox (none on this machine): seen in Chromium only, in light and dark. The card asked for no slowed-CPU test.
- With real templates from the lid add-on: the hips used slope at 40 deg, 32 deep from above (41.77 wide laid flat), tops 204 and 96, feet 268 and 160.
- The installed offline copy.

