# Ornament side: progress

Newest first. Older reports move to ornament/design/PROGRESS_ARCHIVE.md.

## Card 4a: save fixes (17 Oct 2026)

Card: ornament/design/CARD_04a_save_fixes.md.

![The readout with a pearl layer on a V edge at level 0: both stops, each with its fix](design/card04a-inlay-stops.png)

### Results
- The three tests the card asks for pass: a lid with layers on the field only saves walnut-box_001.zip holding only walnut-box_001_field.svg; that zip opens back with Open lid… exactly as it was; a pearl V layer and a pearl level-0 layer each show their stop, and each stop's fix cures it.
- The card 2 and card 4 save tests are changed to the new rule (only places with layers). All the other tests still pass (491 in all).
- Tried in the browser: one click gave one file, walnut-box_001.zip, with only the field inside, which opened back onto the lid. The same set unzipped and zipped again on the computer also opened.

### What was built
- **Only places with layers are saved.** If no place has layers, the button is greyed out and nothing is numbered.
- **One zip per set**, `<lid>_<number>.zip`, holding the place files with their usual names. That means one file and one save dialog. The files inside carry the time of the save.
- **Open lid… takes a set's zip.** The places in the zip open as they were saved. The other places come from the lid already open, with no layers, as they were when the set was saved. It also takes the zip picked together with the lid's five templates. A zip on its own with no lid open says so: "A set holds only the places that had layers: open its lid first, or pick the set together with the lid’s templates." A zip from a different lid (another data-lid) is not mixed with the open one. A zip the computer has squeezed (re-zipped) opens too.
- **The two inlay stops**, in the lid add-on's words, show in the readout in red with the layer's name: "Pearl and boxwood never go in a groove", and "Pearl and boxwood need a seat: give the layer a level of 1 or more". Each has a one-click fix, tried before it is offered: "Give it a square edge", and "Give it a level of 1" (or of another level already in use, if 1 would break the 1 mm step rule). The layer is also marked in the drawing, like the other problems.
- PLAN.md (file format and cutting rules) and BRIEF.md record both.

### Faults found and fixed while using it
- The files inside the zip showed no date (1980-00-00) in the computer's zip list. They now carry the time of the save.

### Assumptions (please check)
- **Opening a set onto the open lid** clears layers from the places the set doesn't hold, since they had none when it was saved. Ctrl+Z brings back what was there.
- **The fixes** change the edge or the level, never the finish: choosing ebony instead of pearl is a design decision.

### Questions for the design chat
- None.

### Not tested
- In Firefox (none on this machine): tried in Chromium only. Firefox has read zips this way since version 113. The card asked for no slowed-CPU test.
- With the lid add-on reading the zip: it may need to unzip first.
- The installed offline copy.

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

