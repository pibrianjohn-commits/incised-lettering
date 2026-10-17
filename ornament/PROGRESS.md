# Ornament side: progress

Newest first. Older reports move to ornament/design/PROGRESS_ARCHIVE.md.

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

## Card 2a: hip edges a little long are matching (17 Oct 2026)

Card: ornament/design/CARD_02a_tolerance.md.

### Results
- The new test passes: a front hip 204.2 along its top, against the field's 204 front edge, opens with no note; one 206 along its top shows "The front hip’s top edge is 206 long, but the field edge it meets is 204: it is centred on it. The two files may be from different lids."
- All the other tests still pass (484 in all).

### What was changed
- A hip's top edge within 1 mm of the field edge it meets counts as matching: it is centred on the edge, with no note. The note shows only for a difference of 1 mm or more, longer or shorter. Hips were already centred on their edge, so a 204.2 hip overhangs 0.1 at each end, as in the model.

### Faults found
- None.

### Assumptions
- Exactly 1 mm out shows the note ("1 mm or more").

### Questions for the design chat
- None.

### Not tested
- In Firefox (none on this machine), and with real hip files from the lid add-on.
