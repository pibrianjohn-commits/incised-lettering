// Panel sizing: the machine bed check, fitting the panel to the lettering,
// and its inverse, fitting the lettering to the panel.

import { borderDepth, contentBox, isBlank, type Layout, type Project } from './layout';

/** The Genmitsu 3020-PRO Ultra bed, mm (see BRIEF.md, Inputs and settings). */
export const BED = { width: 300, height: 205 };
export const BED_EXTENDED = { width: 300, height: 400 };

export type BedFit = 'standard' | 'extended' | 'too-big';

/** Whether a panel fits the bed, either way round. */
export function bedFit(w: number, h: number): BedFit {
  const fits = (a: number, b: number) => (w <= a && h <= b) || (w <= b && h <= a);
  if (fits(BED.width, BED.height)) return 'standard';
  if (fits(BED_EXTENDED.width, BED_EXTENDED.height)) return 'extended';
  return 'too-big';
}

/**
 * The panel size that just holds the lettering plus the margins (and the
 * border), and how far to shift everything so the lettering sits inside it.
 * The lettering is measured as letteringBox measures it.
 */
export function fitToLettering(layout: Layout): { width: number; height: number; dx: number; dy: number } | null {
  const p: Project = layout.project;
  const b = letteringBox(layout);
  if (!b) return null;
  const d = borderDepth(p.border);
  // Round up to the next 0.1 mm, so the lettering never ends up a hair outside the margins.
  const r1 = (v: number) => Math.ceil(v * 10 - 1e-6) / 10;
  return {
    width: r1(b.x1 - b.x0 + p.margins.left + p.margins.right + 2 * d),
    height: r1(b.y1 - b.y0 + p.margins.top + p.margins.bottom + 2 * d),
    dx: d + p.margins.left - b.x0,
    dy: d + p.margins.top - b.y0,
  };
}

export type FitAxis = 'both' | 'width' | 'height';

/**
 * The extent of the lettering, mm: from the left end of its longest line to
 * the right end of it, and from the first cap line to the last baseline. A
 * blank line at the very start or end of the text counts too: it is space the
 * carver asked for above or below the lettering.
 */
export function letteringBox(layout: Layout): { x0: number; x1: number; y0: number; y1: number } | null {
  const p = layout.project;
  const k = p.capHeight;
  const inked = layout.lines.filter((l) => l.ink);
  if (!inked.length) return null;
  let y0 = Math.min(...inked.map((l) => l.baselineY - k));
  let y1 = Math.max(...inked.map((l) => l.baselineY));
  const first = layout.lines[0];
  const last = layout.lines[layout.lines.length - 1];
  if (isBlank(first.text) && !first.placed) y0 = Math.min(y0, first.baselineY - k);
  if (isBlank(last.text) && !last.placed) {
    const sp = layout.spacers.find((s) => s.index === last.index);
    y1 = Math.max(y1, last.baselineY + (sp ? sp.height - p.lineSpacing : 0));
  }
  return { x0: Math.min(...inked.map((l) => l.ink!.x0)), x1: Math.max(...inked.map((l) => l.ink!.x1)), y0, y1 };
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * The changes that scale the lettering to a new cap height: letter spacing,
 * line spacing, blank-line heights and each line's own spacing all scale
 * with it, so the layout keeps its look (hand kerning scales with the letters
 * by itself), and each line set by hand goes where `x` and `y` take it.
 */
function scaleLettering(p: Project, capHeight: number, x: (v: number) => number, y: (v: number) => number): Partial<Project> {
  const s = capHeight / p.capHeight;
  const lines = Object.fromEntries(Object.entries(p.lines).map(([k, pl]) => [k, { ...pl, x: r3(x(pl.x)), baseline: r3(y(pl.baseline)) }]));
  const lineExtras = Object.fromEntries(Object.entries(p.lineExtras).map(([k, e]) => [k, { letter: r3(e.letter * s), word: r3(e.word * s) }]));
  const spacers = Object.fromEntries(Object.entries(p.spacers).map(([k, v]) => [k, r3(v * s)]));
  return { capHeight, letterSpacing: r3(p.letterSpacing * s), lineSpacing: r3(p.lineSpacing * s), lines, lineExtras, spacers };
}

/** Cap height scaled by s, to the 0.1 mm below, so the result never ends a hair too big. */
const capFor = (p: Project, s: number) => Math.floor(p.capHeight * s * 10 + 1e-6) / 10;

/**
 * The inverse of fitting the panel: scale the lettering to fill the space
 * inside the margins (and border) across its width, its height, or both
 * (as large as fits both ways), keeping its look (scaleLettering). The
 * lettering ends up centred in the space, or keeps its centre the other way.
 * Returns the changes to make, or null if there is no lettering or no room
 * for it.
 */
export function fitLetteringToPanel(layout: Layout, axis: FitAxis): Partial<Project> | null {
  const p = layout.project;
  const ink = letteringBox(layout);
  const box = contentBox(p);
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;
  if (!ink || bw <= 0 || bh <= 0) return null;
  const w = ink.x1 - ink.x0;
  const h = ink.y1 - ink.y0;
  if (w <= 0 || h <= 0) return null;
  const capHeight = capFor(p, axis === 'width' ? bw / w : axis === 'height' ? bh / h : Math.min(bw / w, bh / h));
  if (capHeight <= 0) return null;
  const s = capHeight / p.capHeight;
  // Fill the space in the fitted direction(s); keep the lettering's centre, or centre it, the other way.
  const nx0 = axis === 'height' ? (ink.x0 + ink.x1) / 2 - (w * s) / 2 : box.x0 + (bw - w * s) / 2;
  const ny0 = axis === 'width' ? (ink.y0 + ink.y1) / 2 - (h * s) / 2 : box.y0 + (bh - h * s) / 2;
  return scaleLettering(p, capHeight, (x) => nx0 + (x - ink.x0) * s, (y) => ny0 + (y - ink.y0) * s);
}

/** How much the lettering must shrink to fit inside the margins (1 if it fits already, 0 if there is no room). */
export function shrinkToFit(layout: Layout): number {
  const ink = letteringBox(layout);
  const box = contentBox(layout.project);
  if (!ink) return 1;
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;
  if (bw <= 0 || bh <= 0) return 0;
  return Math.min(1, bw / Math.max(1e-9, ink.x1 - ink.x0), bh / Math.max(1e-9, ink.y1 - ink.y0));
}

/** The lettering at a new cap height, keeping its centre (for the cutting-depth fixes). */
export function resizeLettering(layout: Layout, capHeight: number): Partial<Project> | null {
  const b = letteringBox(layout);
  if (!b || !(capHeight > 0)) return null;
  const s = capHeight / layout.project.capHeight;
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  return scaleLettering(layout.project, capHeight, (x) => cx + (x - cx) * s, (y) => cy + (y - cy) * s);
}

/** The scale (at most 1) that brings a panel within a bed, either way round. */
export function bedScale(w: number, h: number, bed: { width: number; height: number }): number {
  return Math.min(1, Math.max(Math.min(bed.width / w, bed.height / h), Math.min(bed.height / w, bed.width / h)));
}

/**
 * The whole design scaled down evenly to fit a bed: the panel, its border and
 * margins, the guides, the reference picture and the lettering, so it keeps
 * its look. Null if it fits already.
 */
export function shrinkDesignToBed(p: Project, bed: { width: number; height: number }): Partial<Project> | null {
  const s = bedScale(p.panelWidth, p.panelHeight, bed);
  if (s >= 1) return null;
  const down = (v: number) => Math.floor(v * s * 10 + 1e-6) / 10;
  const near = (v: number) => Math.round(v * s * 10) / 10;
  const capHeight = capFor(p, s);
  if (capHeight <= 0) return null;
  const m = p.margins;
  const b = p.border;
  return {
    ...scaleLettering(p, capHeight, (x) => x * s, (y) => y * s),
    panelWidth: down(p.panelWidth),
    panelHeight: down(p.panelHeight),
    margins: { top: near(m.top), right: near(m.right), bottom: near(m.bottom), left: near(m.left) },
    border: { ...b, inset: near(b.inset), gap: near(b.gap), width: near(b.width) },
    guides: { x: p.guides.x.map(near), y: p.guides.y.map(near) },
    refImage: p.refImage ? { ...p.refImage, x: r3(p.refImage.x * s), y: r3(p.refImage.y * s), width: r3(p.refImage.width * s) } : null,
  };
}
