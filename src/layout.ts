// Places letters on the panel and works out each letter's marks.

import type { Alphabet } from './alphabet';
import { datumLines } from './datum';
import type { Contour } from './geometry';
import { valleyLines, type ValleyLine } from './valley';

export interface PanelSettings {
  text: string;
  capHeight: number; // mm
  panelWidth: number; // mm
  panelHeight: number; // mm
  datumOffset: number; // mm
}

export interface PlacedLetter {
  char: string;
  outline: Contour[];
  valleys: ValleyLine[];
  datum: Contour[];
}

export interface Layout {
  settings: PanelSettings;
  letters: PlacedLetter[];
  baselineY: number;
  textWidth: number;
}

/** One line of text, centred on the panel, cap height centred vertically. */
export function layoutPanel(alphabet: Alphabet, s: PanelSettings): Layout {
  const k = s.capHeight;
  const shapes = [...s.text].map((ch) => ({ ch, shape: alphabet.letter(ch) }));

  // Pen positions along the line, in mm, from the left of the first letter.
  const pens: number[] = [];
  let pen = 0;
  shapes.forEach(({ ch, shape }, i) => {
    pens.push(pen);
    pen += (shape?.advance ?? 0.3) * k;
    if (i + 1 < shapes.length) pen += alphabet.kerning(ch, shapes[i + 1].ch) * k;
  });
  const textWidth = pen;

  const left = (s.panelWidth - textWidth) / 2;
  const baselineY = (s.panelHeight + k) / 2;

  const letters: PlacedLetter[] = [];
  shapes.forEach(({ ch, shape }, i) => {
    if (!shape || shape.contours.length === 0) return;
    const outline = shape.contours.map((c) => c.map((p) => ({ x: left + pens[i] + p.x * k, y: baselineY + p.y * k })));
    letters.push({
      char: ch,
      outline,
      valleys: valleyLines(outline),
      datum: datumLines(outline, s.datumOffset),
    });
  });

  return { settings: s, letters, baselineY, textWidth };
}
