This is for the incised-lettering repo.
Save this whole message as ornament/design/CARD_04_numbered_sets.md, commit it, then build it.

# Ornament card 4: numbered design sets
- "Save lid design" names every file <lid>_<number>_<place>.svg. Lid: the templates' data-lid (if there is none, "lid"). Number: three digits from 001, a counter kept with the lid in this browser, one up per save, the same number for the whole set. Place: field, hip-front, hip-right, hip-back, hip-left.
- Every place is saved each time, with layers or without, so a set is always complete.
- Beside the button: "Last saved: <lid> <number>".
- Open lid… already takes design files, so a set opens back the same way.
- PLAN.md, "The file format": add the naming.

## Tests (only these)
- Unit: two saves give 001 then 002, all five places named correctly.
- Unit: templates without data-lid save as lid_001_<place>.svg.
No slowed-CPU test: nothing heavy is added.

Report in ornament/PROGRESS.md as the notes say. Through a pull request, merged as before.
