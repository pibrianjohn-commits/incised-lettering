This is for the incised-lettering repo.
Save this whole message as ornament/design/CARD_04a_save_fixes.md, commit it, then build it.

# Ornament card 4a: save fixes
1. Save lid design saves only the places that have layers. Untouched places aren't saved.
2. The set saves as one zip file, <lid>_<number>.zip, holding the place files with their usual names (<lid>_<number>_<place>.svg). One file, one save dialog. Open lid… also takes a set's zip.
3. The readout shows the lid add-on's two inlay stops, in its words: pearl or boxwood on a V edge ("Pearl and boxwood never go in a groove"), and pearl or boxwood at level 0 ("Pearl and boxwood need a seat: give the layer a level of 1 or more").
## Tests (only these)
- Unit: a lid with layers on the field only saves a zip holding only the field file.
- Unit: a saved zip opens back with Open lid… exactly as it was.
- Unit: a pearl V layer and a pearl level-0 layer each show their stop.
No slowed-CPU test. Report in ornament/PROGRESS.md as the notes say. Through a pull request, merged as before.
