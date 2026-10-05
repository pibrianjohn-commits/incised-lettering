// Keeps hand work attached to the right letters when the inscription is edited.
//
// One-gap kerning and placed lines are stored against positions in the text
// (line number, letter number). When the carver types or deletes, those
// positions shift; this follows them. An edit in the text box changes one
// stretch of it, so everything before that stretch stays put and everything
// after it moves by the change in length.

import { gapKey, type LinePlacement, type Project } from './layout';

/** The changes to apply to the project alongside `newText`. */
export function remapForEdit(p: Project, newText: string): Pick<Project, 'gapKerning' | 'lines' | 'lineExtras'> {
  const before = [...p.text.replace(/\r/g, '')];
  const after = [...newText.replace(/\r/g, '')];

  // The unchanged start and end of the text.
  let pre = 0;
  while (pre < before.length && pre < after.length && before[pre] === after[pre]) pre++;
  let suf = 0;
  while (suf < before.length - pre && suf < after.length - pre && before[before.length - 1 - suf] === after[after.length - 1 - suf]) suf++;
  const shift = after.length - before.length;

  /** New position of the character at old position `o`, or null if it was edited away. */
  const map = (o: number): number | null => (o < pre ? o : o >= before.length - suf ? o + shift : null);

  const startsOld = lineStarts(before);
  const startsNew = lineStarts(after);
  const lineOf = (starts: number[], o: number) => {
    let li = 0;
    while (li + 1 < starts.length && starts[li + 1] <= o) li++;
    return li;
  };
  const lineEnd = (chars: string[], starts: number[], li: number) => (li + 1 < starts.length ? starts[li + 1] - 1 : chars.length);

  // One-gap kerning follows its pair of letters, if both survive and still sit side by side.
  const gapKerning: Project['gapKerning'] = {};
  for (const [key, g] of Object.entries(p.gapKerning)) {
    const [li, i] = key.split(':').map(Number);
    if (li >= startsOld.length) continue;
    const right = startsOld[li] + i;
    const a = map(right - 1);
    const b = map(right);
    if (a === null || b === null || b !== a + 1) continue;
    const nl = lineOf(startsNew, b);
    if (lineOf(startsNew, a) !== nl) continue;
    gapKerning[gapKey(nl, b - startsNew[nl])] = g;
  }

  // Anything kept per line (placement, fitted spacing) follows the line's
  // letters: the first of them that survives the edit.
  const followLine = <T>(rec: Record<string, T>): Record<string, T> => {
    const out: Record<string, T> = {};
    for (const [key, value] of Object.entries(rec)) {
      const li = Number(key);
      if (li >= startsOld.length) continue;
      const from = startsOld[li];
      const to = lineEnd(before, startsOld, li);
      let target: number | null = null;
      for (let o = from; o < to && target === null; o++) {
        const n = map(o);
        if (n !== null) target = lineOf(startsNew, n);
      }
      // An empty line, or one typed over entirely: keep it where its start went.
      if (target === null) {
        const n = map(from) ?? (from <= pre ? from : null);
        if (n !== null && n <= after.length) target = lineOf(startsNew, n);
      }
      if (target !== null && !(String(target) in out)) out[String(target)] = value;
    }
    return out;
  };

  return { gapKerning, lines: followLine<LinePlacement>(p.lines), lineExtras: followLine(p.lineExtras) };
}

/** Position of the first character of each line. */
function lineStarts(chars: string[]): number[] {
  const starts = [0];
  chars.forEach((c, i) => {
    if (c === '\n') starts.push(i + 1);
  });
  return starts;
}
