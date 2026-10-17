This is for the incised-lettering repo.
Save this whole message as ornament/design/CARD_03_from_above.md, commit it, then build it.

# Ornament card 3: the From above view

## 1. Flat / From above switch
- A switch "Flat | From above" in the bar above the drawing, beside Layout and Tone. Flat is what there is now.
- From above draws the lid as it sits on the box, seen from above: the field in the middle; each hip squashed across its width to its data-plan-depth, against the field edge with no gap; neighbouring hips meeting on the diagonal corner lines.
- Layers drawn as in Flat; anything on a hip is squashed the same way. Tone works in it.
- For looking only: clicking a place switches back to Flat with that place picked.
- A hip template without data-plan-depth (an older export): From above shows "Export the templates again from Blender to see this view" and stays on Flat.

## 2. Small fixes
- The hip names drawn inside the hips are too faint to read. Make them readable in light and dark.
- PLAN.md, "The file format": add data-slope (degrees) and data-plan-depth (mm) as optional attributes on hip templates.

## Tests (only these)
- Unit: hips with data-plan-depth 32 draw 32 deep in From above, and the corner lines meet within 0.01.
- Unit: a hip without data-plan-depth gives the plain line and stays on Flat.
- One screenshot of From above, in the report.
No slowed-CPU test: nothing heavy is added.

Report in ornament/PROGRESS.md as the notes say. Through a pull request, merged as before.
