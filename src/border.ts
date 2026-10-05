// The border's marks. A scribed border (single or double) is one or two
// hairlines. An incised border is cut like a letter stroke: a band with a
// valley down its middle that forks out into each outer corner (the mitre
// stop cut), and a datum line set in from each edge by the same rule as the
// letters.

import { datumDistance, type DatumRule } from './datum';
import type { Contour } from './geometry';
import type { Border } from './layout';
import type { ValleyLine } from './valley';

export interface BorderMarks {
  /** Scribed hairlines (single and double borders). */
  scribes: Contour[];
  /** Incised border: its two edges, valley, datum lines, and the band to fill. */
  outline: Contour[];
  valleys: ValleyLine[];
  datum: Contour[];
}

/** Rectangle `d` mm in from the edges of a w × h panel, or null if there's no room. */
function rect(w: number, h: number, d: number): Contour | null {
  if (2 * d >= w || 2 * d >= h) return null;
  return [
    { x: d, y: d },
    { x: w - d, y: d },
    { x: w - d, y: h - d },
    { x: d, y: h - d },
  ];
}

export function borderMarks(b: Border, w: number, h: number, rule: DatumRule): BorderMarks {
  const out: BorderMarks = { scribes: [], outline: [], valleys: [], datum: [] };
  const add = (list: Contour[], c: Contour | null) => c && list.push(c);
  if (b.style === 'single') add(out.scribes, rect(w, h, b.inset));
  if (b.style === 'double') {
    add(out.scribes, rect(w, h, b.inset));
    add(out.scribes, rect(w, h, b.inset + b.gap));
  }
  if (b.style === 'incised' && b.width > 0) {
    const outer = rect(w, h, b.inset);
    const inner = rect(w, h, b.inset + b.width);
    if (!outer || !inner) return out;
    out.outline.push(outer, inner.slice().reverse()); // reversed: the inner edge bounds a hole
    const r = b.width / 2;
    const mid = rect(w, h, b.inset + r)!;
    // Valley all round the middle of the band, at half the band's width from each edge…
    out.valleys.push([...mid, mid[0]].map((p) => ({ ...p, r })));
    // …and from each of its corners out to the border's outer corner, rising to nothing there.
    mid.forEach((p, i) => out.valleys.push([{ ...p, r }, { ...outer[i], r: 0 }]));
    const d = datumDistance(b.width, rule);
    if (2 * d < b.width) {
      add(out.datum, rect(w, h, b.inset + d));
      add(out.datum, rect(w, h, b.inset + b.width - d));
    }
  }
  return out;
}
