// Realistic oak for the board, used only in the Proof view (BRIEF.md,
// Decisions: "The look" and "The 3D view"). While designing, the board is a
// plain light surface, and the 3D view shows a plain matte one.
//
// The figure is that of plain-sawn white oak, with the grain running along
// the length of the board: growth rings swinging gently across it, each a
// paler, open-pored early part and a denser, darker late part; the open
// pores as fine dark flecks drawn out along the grain; and a faint sheen of
// medullary ray here and there. It is the same for the same board every time.

/** A small, fast, repeatable hash noise. */
function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise, 0 to 1. */
function noise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Layered noise, about -0.5 to 0.5. */
function fbm(x: number, y: number, seed: number, octaves = 3): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * (noise(x, y, seed + o * 17) - 0.5);
    norm += amp;
    x *= 2.03;
    y *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}

const EARLY: [number, number, number] = [212, 183, 140]; // pale early wood
const LATE: [number, number, number] = [184, 148, 102]; // denser late wood
const PORE: [number, number, number] = [120, 88, 56]; // open pores

/**
 * Oak colour at a point (mm along the board, mm across it), as [r, g, b].
 *
 * The board is sawn from a log, the face some way out from the heart, so the
 * growth rings show where the face cuts through them: wide and far apart
 * where it runs nearly along a ring (the arches of "cathedral" figure), close
 * together towards the edges. The log tapers and the saw runs a little out of
 * line with it, so the rings close into arches along the board.
 */
export function oakAt(x: number, y: number, seed = 7): [number, number, number] {
  const heart = 25 + 45 * fbm(x * 0.0022, 0.5, seed); // where across the board the heart lies
  const out = 24 + 0.05 * x + 16 * fbm(x * 0.003, 1.5, seed + 2); // how far the face is from the heart
  const dy = y - heart;
  let r = Math.sqrt(dy * dy + out * out);
  // The rings wander, broadly and in small ripples.
  r += 3 * fbm(x * 0.006, y * 0.012, seed + 3) + 0.6 * fbm(x * 0.04, y * 0.08, seed + 4);
  // Rings about 3 mm thick, some years wider than others.
  const ring = r / 3 + 1.2 * fbm(r * 0.06, 0.5, seed + 9);
  const f = ring - Math.floor(ring); // through each year: early wood, then late wood
  const late = f < 0.55 ? 0 : f < 0.88 ? (f - 0.55) / 0.33 : 1 - ((f - 0.88) / 0.12) * 0.6;
  // Open pores in the early wood: short dark flecks drawn out along the grain.
  const pore = f < 0.45 ? Math.max(0, noise(x * 1.1, y * 6 + ring * 2, seed + 21) - 0.66) * 2.4 * (1 - f / 0.45) : 0;
  // The fibre of the wood, and slow changes of colour along and across the board.
  const fibre = 0.035 * (noise(x * 0.12, y * 9, seed + 31) - 0.5);
  const tone = 1 + fibre + 0.05 * fbm(x * 0.004, y * 0.01, seed + 41) + 0.025 * fbm(x * 0.03, y * 0.004, seed + 43);
  const result: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    let c = EARLY[i] + (LATE[i] - EARLY[i]) * Math.min(1, Math.max(0, late));
    c += (PORE[i] - c) * Math.min(1, pore);
    result[i] = Math.max(0, Math.min(255, c * tone));
  }
  return result;
}

/** About this many pixels per mm, fewer for a big board, so a picture stays at most about 1.5 million pixels. */
export function oakResolution(width: number, height: number): number {
  return Math.max(0.8, Math.min(3, Math.sqrt(1.5e6 / Math.max(1, width * height))));
}

/**
 * The board's oak as a picture, `width` × `height` mm from its top-left
 * corner, the grain running along its width. `board` is the board's height,
 * so the arches of the figure sit across its middle.
 */
function oakCanvas(width: number, height: number, board = height): HTMLCanvasElement {
  const k = oakResolution(width, height);
  const w = Math.max(1, Math.round(width * k));
  const h = Math.max(1, Math.round(height * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const [r, g, b] = oakAt((i + 0.5) / k, (j + 0.5) / k - board / 2 + 25);
      const o = 4 * (j * w + i);
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

const cache = new Map<string, string>();
const pending = new Set<string>();

/**
 * The oak picture for a board this size, as an image URL for the Proof view,
 * or null while it is still being made (it takes a moment the first time);
 * `ready` is called once it is.
 */
export function oakUrl(width: number, height: number, ready: () => void): string | null {
  const key = `${width}x${height}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (!pending.has(key)) {
    pending.add(key);
    setTimeout(() => {
      if (cache.size > 6) cache.clear(); // keep only a few sizes
      cache.set(key, oakCanvas(width, height).toDataURL('image/jpeg', 0.9));
      pending.delete(key);
      ready();
    }, 0);
  }
  return null;
}
