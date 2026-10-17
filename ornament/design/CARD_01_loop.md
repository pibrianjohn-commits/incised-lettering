# Ornament card 1: the loop, plain shapes

Step 1 of ornament/PLAN.md. A new Ornament tab, separate from the lettering; nothing in the lettering changes. It opens a template made by Brian's Blender lid add-on, sets out zones and layers of plain shapes at levels, and saves a design back in the same file format. No ornament makers yet: plain shapes only.

## 1. Open a template
- Open an SVG template from a file (format below). Show the panel at true size with a millimetre ruler, its place name and its thickness.
- This card handles rectangular outlines only. Any other outline opens with one plain line, "Shaped panels come with the outlines card", and nothing breaks.

## 2. Zones
- Border zone: a band set in from the edge by "Distance from the edge" (default 12) and "Band width" (default 2).
- Centre zone: an ellipse or a rectangle (switch), "Width" and "Height" (default 36 x 36), centred.
- Left and right fields: what is left inside the border either side of the centre zone, with "Gap to the centre" (default 6). "Left mirrors right" switch, on by default.
- All defaults are stand-ins; Brian sets the real ones. Each zone can hold one plain shape (its own outline, or nothing) as a layer.

## 3. Layers and levels
- Each layer: a name, a shape (a zone's outline, or a plain rectangle or ellipse placed and sized with handles), a level (mm below the top), an edge (square or v) and a finish (ebony, gold, white-gold, pearl, boxwood).
- Later layers win where they overlap (that is how the lid add-on builds them). Up and down to reorder.
- Live readout: "Levels used X; deepest Y of Z allowed", where Z = template thickness minus 1. In red, in plain words: a level under 1 other than 0; a step under 1 between neighbouring levels; deeper than allowed. These are layout rules and read no machine settings.
- A plain view in tone (deeper = darker), so the levels read at a glance.

## 4. Save the design
- "Save design" downloads one SVG in the format below, with the size, viewBox and data-place of the template it came from.
- A saved design opens again exactly as it was.

## The file format (shared with the lid add-on; follow it exactly)
- One SVG per place. width="<W>mm" height="<H>mm" viewBox="0 0 W H", so 1 unit = 1 mm.
- Field: seen from above, front of the box at the bottom of the drawing. x = X minus the field's lowest X; y = the field's highest Y minus Y. Origin (top-left) = the field's back-left corner.
- Hip faces: laid flat, seen from outside, foot at the bottom (y = H at the foot, y = 0 at the top edge), x left to right as seen from outside, origin the top-left of the face's bounding box.
- The <svg> element has data-place ("field", "hip-front", "hip-right", "hip-back" or "hip-left"), and data-thickness in mm where known.
- A template has one closed path id="outline": the place's outline.
- A design has the same size, viewBox and data-place as its template, the path id="outline", and one <g class="layer"> per layer, in order. Each layer has data-name, data-level (mm below the top; 0 = the top), data-edge ("square" or "v") and data-finish ("ebony", "gold", "white-gold", "pearl" or "boxwood"). Inside each layer: closed filled paths in absolute mm, fill-rule evenodd (inner shapes are holes). An optional <g id="setting-out"> holds lines that are drawn but never cut.

## Tests (only these for this card)
- Unit: a 204 x 96 field template opens at 204 x 96 with its thickness; a trapezoid template gives the plain "shaped panels" line.
- Unit: saving and reopening a design with three layers gives the same layers, levels, edges, finishes and shapes within 0.01.
- Unit: a step of 0.5, and a level deeper than thickness minus 1, are each reported.
- One screenshot of the tab with a sample field, in the report.
No browser-suite run and no slowed-CPU test for this card: nothing heavy is added.

Report in ornament/PROGRESS.md as the notes say. Through a pull request, merged as before.
