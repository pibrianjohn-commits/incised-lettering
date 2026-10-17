# Ornament side: progress

Newest first. Older reports move to ornament/design/PROGRESS_ARCHIVE.md.

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

## Card 1a: answers to card 1's questions (17 Oct 2026)

Card: ornament/design/CARD_01a_answers.md.

![A hip template with no thickness](design/card01a-no-thickness.png)

A hip template with no thickness: the line "Thickness not given: depth limit not checked" shows under the template, in the top bar and under the readout, and the 0.5 step between the two layers is still caught.

### Results
- New test passes: a template without data-thickness opens, shows "Thickness not given: depth limit not checked", and still reports a 0.5 step. A layer 40 deep on it is not reported, since there is no limit to check against.
- All the card 1 tests and the lettering's tests still pass (479 in all).

### What was built or changed
- **No thickness** (point 4): the template's details, the top bar and the levels readout show "Thickness not given: depth limit not checked". The readout then reads "Levels used X; deepest Y", with no "of Z allowed". The 1 mm rules (under 1 deep, and steps under 1) are still checked. This works for shaped hips too, which show the line under their outline.
- **The extra labels** (point 1): already only extra data- attributes; nothing the format names was changed. They are now listed in ornament/PLAN.md under a new heading, "The file format".
- **Curves and side fields** (points 2 and 3): kept as they were, as the answers say, and noted in PLAN.md.

### Faults found
- None new. Using a 204 × 30 hip shows that the stand-in zone sizes (12 from the edge, 36 × 36 centre) don't fit a hip. The readout says so and offers "Shrink the centre…" and "Shrink the zones to fit the panel". The real sizes for hips are Brian's to set, with the outlines card.

### Assumptions
- The line is shown as information, in plain black, not red: it isn't a fault in the design.

### Questions for the design chat
- None.

### Not tested
- In Firefox: there is none on this machine, so this was used in Chromium only.
- With a real hip template from the lid add-on.

