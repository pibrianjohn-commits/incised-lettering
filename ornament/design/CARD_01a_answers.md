# Ornament card 1a: answers to card 1's questions

From the design chat, answering the four questions in ornament/PROGRESS.md (card 1). No code changes needed beyond point 4.

1. Extra labels: keep them, but only as extra data- attributes or inside one <metadata> element, never changing anything the file format names. Add a short note listing them to ornament/PLAN.md under the file format.
2. Curves: keep ellipses as short straight lines. 0.003 mm is far finer than the machine cuts, and straight lines are the simplest thing for Blender to read.
3. Side fields: keep them as plain rectangles either side of the centre. That is the layout Brian described.
4. Thickness: field templates will always carry it; hip templates won't yet. When a template has no thickness, show "Thickness not given: depth limit not checked" and still check the 1 mm steps. Test: a template without data-thickness opens and shows that line. Report in PROGRESS.md as usual and merge through a pull request.
