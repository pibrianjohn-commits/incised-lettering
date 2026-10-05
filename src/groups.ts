// Kerning groups and side shapes.
//
// Letters that share the shape of one side are kerned together: what suits
// "H next to V" suits "N next to W" too. Each letter has a left side and a
// right side, and each side can belong to one group. A pair's kerning comes
// from, in order: a kerning value for that exact pair (an exception), else
// the value for its two groups, else nothing.

export type Side = 'left' | 'right';

/** Group name → member letters, for each side. */
export interface KernGroups {
  left: Record<string, string>;
  right: Record<string, string>;
}

/**
 * Starting groups for Roman capitals, named after a typical member
 * (BRIEF.md, Roadmap step 4: O C G Q, H I N M). The carver can change them.
 */
export const defaultGroups: KernGroups = {
  left: { O: 'OCGQ', H: 'HIMNBDEFKLPRU', V: 'VW' },
  right: { O: 'ODQ', H: 'HIMNU', V: 'VW' },
};

export function groupOf(groups: KernGroups, side: Side, ch: string): string | null {
  for (const [name, members] of Object.entries(groups[side])) if ([...members].includes(ch)) return name;
  return null;
}

/** Key for the kerning between the right side of `a` and the left side of `b`, by group; null if either has none. */
export function groupPairKey(groups: KernGroups, a: string, b: string): string | null {
  const ga = groupOf(groups, 'right', a);
  const gb = groupOf(groups, 'left', b);
  return ga && gb ? `${ga}|${gb}` : null;
}

export type SideShape = 'round' | 'straight' | 'diagonal';

const ROUND_LEFT = 'CGOQS0368@';
const ROUND_RIGHT = 'BCDGOPQS023589';
const DIAG_LEFT = 'AVWXYZ4';
const DIAG_RIGHT = 'AKRVWXYZ7';

/** The shape of one side of a letter, for the even-up factors. Anything not round or diagonal counts as straight. */
export function sideShape(ch: string, side: Side): SideShape {
  const u = ch.toUpperCase();
  if ((side === 'left' ? ROUND_LEFT : ROUND_RIGHT).includes(u)) return 'round';
  if ((side === 'left' ? DIAG_LEFT : DIAG_RIGHT).includes(u)) return 'diagonal';
  return 'straight';
}
