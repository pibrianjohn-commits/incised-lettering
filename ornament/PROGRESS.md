# Ornament side: progress

Newest first. Older reports move to ornament/design/PROGRESS_ARCHIVE.md.

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

## Card 2: the whole lid laid out (17 Oct 2026)

Card: ornament/design/CARD_02_lid_layout.md.

![The five places of the lid laid out together](design/card02-lid-layout.png)

The lid opened out flat at true size: the field in the middle (front of the box at the bottom) with a gold border and a pearl centre, the back hip above, the front hip below, the left and right hips at the sides, each 10 clear of the field with its foot outward. The field is the place being worked on (outlined in blue); the hips show their outlines only.

### Results
- All four tests the card asks for pass: five templates open into the layout, each hip's top edge lies along its field edge 10 clear (within 0.01), and the front hip's left end sits under the field's front-left corner; a set with the back hip missing says "Missing: the back hip." and opens nothing (and a doubled file is named too); after a reload the same lid comes back with its layers; Save lid design writes one file per place with layers, and each opens again exactly as it was (the same file, word for word).
- The lettering's tests and card 1's all still pass (483 in all).

### What was built
- **Open lid…** (Ctrl+Shift+O in the tab) takes the five files picked together, templates or saved designs. If one is missing, doubled, unreadable or doesn't say which place it is, it says which, in plain words, and opens nothing.
- **The layout**: all five together at true size, as described in the card. Each hip is turned so its foot faces outward and it reads as seen from outside: seen from the back, its left is the field's right; from the left, its left is the back; from the right, its left is the front. Each place's name is written on it.
- **Click a place** to work on it, or use the row of buttons at the top of the side panel (Field, Front, Right, Back, Left), or [ and ] to step through them. Each place keeps its own zones and layers; the zones, layers, readout and fixes in the side panel are for the place being worked on. Tone view uses one scale for the whole lid, so the same depth is the same grey everywhere. Hips show "Shaped panels come with the outlines card".
- **The pointer readout** names the place under it and gives the position in that place's own millimetres, as its file has them. The rulers measure from the field's back-left corner.
- **Remembered**: the lid, every place's layers and which place was being worked on are kept in this browser. The Ornament tab opens with the lid laid out ready. A design kept by card 1 is still picked up.
- **Opening again** (a lid, a single template or the sample) asks first if any place has layers not yet saved, and names the places. Ctrl+Z still goes back.
- **Save lid design** (Ctrl+Shift+S) downloads field-design.svg, hip-front-design.svg and so on, one for each place that has layers, in the shared format. Save design (Ctrl+S) still saves just the place being worked on.
- Ctrl+K finds all of these, and "work on the front hip" and so on; the ? list has them.

### Faults found and fixed while using it
- The bar over the drawing read "Lid · Lid field". It now reads "Lid field" for the field and "Lid · Front hip" for a hip.

### Assumptions (please check)
- **Hip ends meet at the corners.** At 10 clear, the mitred ends of neighbouring hips come close but don't overlap. Clicking near a corner picks whichever hip the pointer is actually on.
- **A hip whose top edge isn't the same length as its field edge** is centred on that edge, with a plain note: "The front hip's top edge is 200 long, but the field edge it meets is 204: it is centred on it. The two files may be from different lids." There's nothing to fix in this tool; it would come from Blender.
- **The names on the hips** read along each hip. The back hip's name is turned the right way up for reading, not upside down as seen from outside.
- **Save lid design** downloads the files a moment apart. Chrome may ask once to allow several downloads.
- **Try a sample field** and **Open template…** still open one panel on its own, in place of the lid (asking first if there are unsaved layers). The place buttons and Save lid design show only when a whole lid is open.

### Questions for the design chat
- None.

### Not tested
- In Firefox: there is none on this machine, so it was used in Chromium only. The card asked for no slowed-CPU test.
- With real templates from the lid add-on: the hips used were trapezoids 30 deep (top 204 and 96, foot 264 and 156).
- The installed offline copy.

