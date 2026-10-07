import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { oakAt, oakResolution } from '../src/oak';

/** Hue (degrees), saturation and lightness (0 to 1) of a #rrggbb colour. */
function hsl(hex: string): [number, number, number] {
  const n = hex.length === 4 ? hex.slice(1).split('').map((c) => parseInt(c + c, 16) / 255) : [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = n;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

/** Beige or brown: an orange-to-yellow hue that is greyed (beige, tan) or dark (brown). */
const beigeOrBrown = (hex: string) => {
  const [h, s, l] = hsl(hex);
  return h >= 15 && h <= 55 && s > 0.08 && (s < 0.6 || l < 0.4);
};

describe('the look (BRIEF.md, Decisions)', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  // The interface: everything but the printed bench sheet and the 3D depth-colour scale.
  const ui = css.replace(/\/\* -+ the bench sheet[\s\S]*?\/\* Printing/, '').replace(/\.v3d-ramp[^\n]*/, '');

  it('has no beige or brown in the interface', () => {
    const colours = ui.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) ?? [];
    expect(colours.length).toBeGreaterThan(20);
    expect(colours.filter(beigeOrBrown)).toEqual([]);
  });

  it('follows the computer’s light or dark setting, with one deep blue accent', () => {
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    const accents = [...css.matchAll(/--accent: (#[0-9a-f]{6})/g)].map((m) => hsl(m[1]));
    expect(accents).toHaveLength(2); // light and dark
    for (const [h, s] of accents) {
      expect(h).toBeGreaterThan(215);
      expect(h).toBeLessThan(235);
      expect(s).toBeGreaterThan(0.6);
    }
  });

  it('the oak is oak-coloured, the same every time, with growth rings across the board', () => {
    expect(oakAt(10, 20)).toEqual(oakAt(10, 20));
    const across = Array.from({ length: 200 }, (_, j) => oakAt(50, j * 0.1));
    for (const [r, g, b] of across) expect(r > g && g > b).toBe(true); // warm wood tones
    const light = across.map(([r, g, b]) => r + g + b);
    expect(Math.max(...light) - Math.min(...light)).toBeGreaterThan(40); // rings show
    expect(oakResolution(150, 60)).toBe(3);
    expect(oakResolution(1000, 1000)).toBeLessThan(1.5); // big boards stay a sensible size
  });
});
