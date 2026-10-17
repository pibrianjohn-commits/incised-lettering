This is for the incised-lettering repo.
Save this whole message as ornament/design/CARD_02_lid_layout.md, commit it, then build it.

# Ornament card 2: the whole lid laid out

Brian works on the lid as a whole, not one template at a time. The five templates are opened once per lid, laid out together, and remembered.

## 1. Open lid
- "Open lid…" takes all five files from the lid add-on in one go (pick them together in the file picker): field, hip-front, hip-right, hip-back, hip-left. Template files or saved design files both work.
- If one is missing or doubled, say which in plain words and open nothing.

## 2. The layout
- All five at true size, together, as the lid opened out flat, seen from above: the field in the middle with the front of the box at the bottom; hip-back above it, hip-front below, hip-left to the left, hip-right to the right.
- Each hip turned so its foot faces outward and it reads as seen from outside, with its top edge running along the matching edge of the field, 10 mm clear of it.
- Click a place to work on it. Zones, layers, levels, readouts and tone view work as in card 1, each place keeping its own. Hips stay outline-only with the existing "Shaped panels come with the outlines card" line.

## 3. Remembered
- The app remembers the last lid opened, with every place's layers, in this browser. Whenever the Ornament tab opens, that lid is laid out ready.
- "Open lid…" again replaces it; if there are layers not yet saved, ask first.
- "Try a sample field" stays as it is.

## 4. Save
- "Save lid design" downloads one design SVG per place that has layers, named field-design.svg, hip-front-design.svg and so on, in the shared file format.

## Tests (only these)
- Unit: five templates open into the layout; each hip's top edge lies along the matching field edge, 10 clear, within 0.01, and the front hip's left end sits under the field's front-left corner.
- Unit: a set with one file missing names it and opens nothing.
- Unit: after a reload the same lid comes back with its layers.
- Unit: Save lid design writes one file per place with layers, and they open again exactly as they were.
- One screenshot of the five laid out, in the report.
No slowed-CPU test: nothing heavy is added.

Report in ornament/PROGRESS.md as the notes say. Through a pull request, merged as before.
