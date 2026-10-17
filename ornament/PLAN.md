# Ornament layout tool: plan

Planning only. Cards are built from; this file is not.

## What it is
A layout tool for ornament on plaques and on the box lid's field and hip faces. It works like kerning: optical spacing and optical weight, judged by eye, with measured readouts to help. Big on purpose: Brian expects to use a tenth of it; the rest is how he finds that tenth. What goes where is always his decision.

## Where things live
- The tool: inside this app, on the same spacing, handles and 3D-view machinery as the lettering.
- References: Brian's private repo ornament-reference, sorted by family. Never copied here.
- Family rules: ornament/families/<family>.md, written from the references: how each family is built (stem, growth, how it diminishes, how it turns, where it branches, how it ends). A maker is built only from its family file.
- The lid: Brian's Blender add-on (box_lid, lid_ornament). It sends lid templates out and takes finished SVG back by level. Its half of the bridge is carded in that repo.

## The skeleton
- Panel: any closed outline at true size: a plaque, the lid field (204 x 96), a hip face laid flat (a trapezoid). Lid sizes come from Blender's template, never typed in.
- Zones: the panel divides into zones (border, centre, left and right fields, corners). Each holds an element or nothing.
- Layers and levels: every layer has a shape, a level (depth below the top), an edge (square wall from the end mill, or sloped wall from the V-bit) and a finish (plain ebony, gilded, other).
- Recipes: every element is saved as a recipe (which maker, plus its numbers), so its handles still work after saving and reopening.
- Frames: offsets of an outline (rims, inset lines), each with its own width, level and finish. Change the outline and they follow.
- Spaces: the gaps between zones and elements, set by eye like kerning.
- Mirror tools: left mirrors right; a quarter mirrored for plaques; repeat round a centre.

## Readouts (live, like the lid add-on's room lines)
- Weight of each zone (area of shadow and edge): left against right, zone against centre.
- Room left for the centre.
- Levels used, of the levels the board allows.
- Narrowest gap against the cutter.
The cutter readouts belong to the machine side and switch off with it (the School edition rule). Weight, room and spaces are layout and never read machine settings.

## Buttons
- Snap to: lays a proportion system over the panel and snaps zones to it: thirds, golden section, ad quadratum (the lid field is two 96 squares with 12 between), more later. These offer positions; none claims an optimum.
- Balance: moves or scales the side elements until measured weight is equal. The one true optimum, because weight is measured.
- Compare: save versions; flick between them or see them side by side.
- Variations: nine options from the generator; "More like this" narrows round the one picked.

## Makers
- Outlines and cartouches: one quarter drawn and mirrored.
- Running borders: a repeat along an edge plus a corner piece. A whole number of repeats per side; per pattern, either the repeat stretches or the panel is sized to the repeats. Frets follow straight edges only. First from Brian's four fret sheets.
- Scroll-maker (filigree): scrolls that grow from a stem to fill a set amount of their zone. Settings: tightness, turns, taper, branching. Hogarth's line as a family of curves.
- Banners: a band following a spine curve, turning over where it shows its back, ends cut; letters follow it (meets the app's planned Stage 3).
- Placed pieces: Brian's own drawings and emblems as SVG. These only scale.
- Fader: blends two outlines (matched quarters) or two settings of one maker. Unlike things (a fret and a rope) do not blend.

## Generation
By rules, never by dice: the same settings always give the same result. Rules from the grammar of ornament: growth from a parent stem, curves meeting on a tangent, scrolls diminishing as they go, branching on the outside of the curve. Limits are built in, not checked afterwards: stays in its zone, keeps the cutter gap, keeps to the levels. Rule-made ornament is correct, not alive, so everything generated keeps its handles.

## Cutting rules
- Every cut at least 1 deep with at least 1 of wood left under; no step under 1. A 6 mm field allows six levels at most, 1 apart; a thicker board allows more.
- End mill 3.175: gaps between raised parts at least 3.175; inside corners round at 1.6 unless squared by hand.
- V-bit 30 deg now, 90 deg coming. Fine detail comes from the V-bit's walls.
- Cut from one face: no undercuts, nothing proud and fragile.
- Ebony relief reads only under low light; the raking-light view is the judge.

## Out
Chased texture finer than the cutter; cast ornament with undercuts; applied ornament standing proud.

## Later
Modelled (sloping) bas-relief as its own kind of layer: a height map finished with a ball nose. Stepped levels come first.

## Build order
1. The loop: open a template from Blender, split it into zones, set layers at levels, send SVG back by level at true size. Plain shapes only.
2. Outlines: the panel stops being a rectangle; the hips become usable.
3. Running borders, from the fret sheets.
4. Recipes, handles, Compare.
5. Readouts, Balance, Snap to.
6. Scroll-maker, Variations, the fader.
7. Banners.
The lid add-on's half of step 1 (template out, SVG in by level) is a card in box_lid.
