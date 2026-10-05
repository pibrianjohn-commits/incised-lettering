// Millimetre rulers along the top and left of the workspace.

import type { ViewState } from './view';

export const RULER = 22; // px, thickness of each ruler

/** Tick spacings to choose from, mm. */
const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];

function pick(scale: number, minPx: number) {
  return STEPS.find((s) => s * scale >= minPx) ?? STEPS[STEPS.length - 1];
}

/**
 * SVG content for one ruler. `along` is the ruler's length in px, `offset`
 * and the view say where 0 mm (the panel's top-left corner) falls on it.
 * `cursor` is the pointer position along the ruler in px, or null.
 */
export function rulerSvg(axis: 'x' | 'y', along: number, v: ViewState, cursor: number | null): string {
  const s = v.scale;
  const origin = axis === 'x' ? v.tx : v.ty;
  const minor = pick(s, 6);
  const major = pick(s, 56);
  const from = Math.floor((RULER - origin) / s / minor) * minor;
  const to = (along - origin) / s;
  const out: string[] = [];
  const decimals = major < 1 ? 1 : 0;
  for (let mm = from; mm <= to + minor; mm += minor) {
    const m = Math.round(mm / minor) * minor; // avoid creeping rounding error
    const p = origin + m * s;
    if (p < RULER - 0.5) continue;
    const isMajor = Math.abs(m / major - Math.round(m / major)) < 1e-6;
    const half = !isMajor && Math.abs(m / (major / 2) - Math.round(m / (major / 2))) < 1e-6;
    const len = isMajor ? RULER - 4 : half ? 9 : 5;
    const at = p.toFixed(1);
    if (axis === 'x') {
      out.push(`<line x1="${at}" x2="${at}" y1="${RULER}" y2="${RULER - len}"/>`);
      if (isMajor) out.push(`<text x="${(p + 3).toFixed(1)}" y="10">${m.toFixed(decimals)}</text>`);
    } else {
      out.push(`<line y1="${at}" y2="${at}" x1="${RULER}" x2="${RULER - len}"/>`);
      if (isMajor) {
        out.push(`<text transform="translate(10 ${(p + 3).toFixed(1)}) rotate(-90)" text-anchor="end">${m.toFixed(decimals)}</text>`);
      }
    }
  }
  if (cursor !== null && cursor >= RULER) {
    const c = cursor.toFixed(1);
    out.push(axis === 'x' ? `<line class="cursor" x1="${c}" x2="${c}" y1="0" y2="${RULER}"/>` : `<line class="cursor" y1="${c}" y2="${c}" x1="0" x2="${RULER}"/>`);
  }
  return out.join('');
}
