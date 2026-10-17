// The SVG files shared with Brian's Blender lid add-on (the format is set out
// in ornament/design/CARD_01_loop.md): templates in, designs out and back in.
// Read without the browser, so the unit tests read them exactly as the page does.

import {
  DEFAULT_ZONES,
  EDGES,
  FINISHES,
  PLACES,
  boxRing,
  hasTwin,
  newId,
  twinOf,
  zoneRings,
  type Design,
  type Edge,
  type Finish,
  type Layer,
  type Panel,
  type Place,
  type Pt,
  type Ring,
  type Shape,
  type ZoneName,
  type Zones,
} from './model';

// ---------------------------------------------------------------- a small XML reader

export interface El {
  name: string;
  attrs: Record<string, string>;
  children: El[];
}

const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|quot|amp|lt|gt|apos);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k[0] === '#') return String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
    return { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'" }[k]!;
  });

/** The elements of an XML document (text, comments and the like are left out), or null if it isn't one. */
export function parseXml(text: string): El | null {
  const root: El = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  const src = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  const tag = /<([/?!]?)([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(src))) {
    const [, kind, name, attrText, selfClose] = m;
    if (kind === '?' || kind === '!') continue;
    if (kind === '/') {
      if (stack.length > 1 && stack[stack.length - 1].name === name) stack.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of attrText.matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] ?? a[3] ?? '');
    const el: El = { name, attrs, children: [] };
    stack[stack.length - 1].children.push(el);
    if (!selfClose) stack.push(el);
  }
  return root.children[0] ?? null;
}

function* walk(el: El): Generator<El> {
  yield el;
  for (const c of el.children) yield* walk(c);
}

const localName = (n: string) => n.slice(n.indexOf(':') + 1);

// ---------------------------------------------------------------- path data

/** The rings a path's d draws, with curves followed closely, and whether it has any curves. */
export function pathRings(d: string): { rings: Ring[]; curved: boolean } {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const rings: Ring[] = [];
  let ring: Ring = [];
  let curved = false;
  let i = 0;
  let cmd = '';
  let [x, y] = [0, 0];
  let [sx, sy] = [0, 0];
  let [cx, cy] = [0, 0]; // last control point, for S and T
  const num = () => Number(tokens[i++]);
  const close = () => {
    if (ring.length > 1) rings.push(ring);
    ring = [];
  };
  const curve = (pts: Pt[]) => {
    curved = true;
    const n = 16;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      // de Casteljau
      let ps = pts.map((p) => [...p] as Pt);
      while (ps.length > 1) ps = ps.slice(1).map((p, j) => [ps[j][0] + (p[0] - ps[j][0]) * t, ps[j][1] + (p[1] - ps[j][1]) * t]);
      ring.push(ps[0]);
    }
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    else if (!cmd) return { rings: [], curved };
    const rel = cmd === cmd.toLowerCase();
    if (!ring.length && cmd.toUpperCase() !== 'M') ring.push([x, y]);
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M':
        close();
        x = ox + num();
        y = oy + num();
        [sx, sy] = [x, y];
        ring.push([x, y]);
        cmd = rel ? 'l' : 'L';
        break;
      case 'L':
        x = ox + num();
        y = oy + num();
        ring.push([x, y]);
        break;
      case 'H':
        x = ox + num();
        ring.push([x, y]);
        break;
      case 'V':
        y = oy + num();
        ring.push([x, y]);
        break;
      case 'C': {
        const p1: Pt = [ox + num(), oy + num()];
        const p2: Pt = [ox + num(), oy + num()];
        const p: Pt = [ox + num(), oy + num()];
        curve([[x, y], p1, p2, p]);
        [cx, cy] = p2;
        [x, y] = p;
        break;
      }
      case 'S': {
        const p1: Pt = [2 * x - cx, 2 * y - cy];
        const p2: Pt = [ox + num(), oy + num()];
        const p: Pt = [ox + num(), oy + num()];
        curve([[x, y], p1, p2, p]);
        [cx, cy] = p2;
        [x, y] = p;
        break;
      }
      case 'Q': {
        const p1: Pt = [ox + num(), oy + num()];
        const p: Pt = [ox + num(), oy + num()];
        curve([[x, y], p1, p]);
        [cx, cy] = p1;
        [x, y] = p;
        break;
      }
      case 'T': {
        const p1: Pt = [2 * x - cx, 2 * y - cy];
        const p: Pt = [ox + num(), oy + num()];
        curve([[x, y], p1, p]);
        [cx, cy] = p1;
        [x, y] = p;
        break;
      }
      case 'A': {
        // Arcs: only their end point matters here; any arc makes the outline shaped.
        i += 5;
        x = ox + num();
        y = oy + num();
        curved = true;
        ring.push([x, y]);
        break;
      }
      case 'Z':
        close();
        [x, y] = [sx, sy];
        break;
      default:
        return { rings: [], curved };
    }
    if (!'CSQT'.includes(cmd.toUpperCase())) [cx, cy] = [x, y];
  }
  close();
  return { rings, curved };
}

/** The corners of a ring, with repeated and in-line points taken out. */
function corners(ring: Ring): Ring {
  let pts = ring.filter((p, k) => {
    const q = ring[(k + ring.length - 1) % ring.length];
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6;
  });
  let changed = true;
  while (changed && pts.length > 2) {
    changed = false;
    for (let k = 0; k < pts.length; k++) {
      const a = pts[(k + pts.length - 1) % pts.length];
      const b = pts[k];
      const c = pts[(k + 1) % pts.length];
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(cross) < 1e-6) {
        pts = pts.filter((_, j) => j !== k);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

/** The rectangle an outline draws, or null if it is any other shape. */
export function outlineRect(d: string): { x: number; y: number; w: number; h: number } | null {
  const { rings } = pathRings(d);
  if (rings.length !== 1) return null;
  const c = corners(rings[0]);
  if (c.length !== 4) return null;
  const tol = 1e-3;
  for (let k = 0; k < 4; k++) {
    const [a, b] = [c[k], c[(k + 1) % 4]];
    if (Math.abs(a[0] - b[0]) > tol && Math.abs(a[1] - b[1]) > tol) return null;
  }
  const xs = c.map((p) => p[0]);
  const ys = c.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

const f = (v: number) => `${Math.round(v * 1000) / 1000}`;
export function ringsToD(rings: Ring[]): string {
  return rings.map((r) => `M ${r.map((p) => `${f(p[0])} ${f(p[1])}`).join(' L ')} Z`).join(' ');
}

// ---------------------------------------------------------------- reading

export const SHAPED_LINE = 'Shaped panels come with the outlines card';

export type Opened =
  | { kind: 'design'; design: Design; isTemplate: boolean }
  /** Not a rectangle: shown with its outline, and nothing else yet. */
  | { kind: 'shaped'; panel: Panel; message: string }
  | { kind: 'error'; message: string };

const mmLength = (v: string | undefined): number | null => {
  const m = /^\s*([0-9]*\.?[0-9]+)\s*(mm)?\s*$/.exec(v ?? '');
  return m ? Number(m[1]) : null;
};

const n = (v: string | undefined, fallback: number) => {
  const x = Number(v);
  return v !== undefined && v.trim() !== '' && Number.isFinite(x) ? x : fallback;
};

function readZones(g: El | undefined): Zones {
  const a = g?.attrs ?? {};
  const z = DEFAULT_ZONES;
  return {
    edgeDistance: n(a['data-edge-distance'], z.edgeDistance),
    bandWidth: n(a['data-band-width'], z.bandWidth),
    centreShape: a['data-centre'] === 'rect' ? 'rect' : a['data-centre'] === 'ellipse' ? 'ellipse' : z.centreShape,
    centreWidth: n(a['data-centre-width'], z.centreWidth),
    centreHeight: n(a['data-centre-height'], z.centreHeight),
    gapToCentre: n(a['data-gap-to-centre'], z.gapToCentre),
    mirror: a['data-mirror'] === 'off' ? false : a['data-mirror'] === 'on' ? true : z.mirror,
  };
}

const ZONES = ['border', 'centre', 'left', 'right', 'fields'];

function readShape(g: El): Shape | null {
  const tag = g.attrs['data-shape'] ?? '';
  if (tag.startsWith('zone:') && ZONES.includes(tag.slice(5))) return { kind: 'zone', zone: tag.slice(5) as ZoneName };
  const paths = [...walk(g)].filter((e) => localName(e.name) === 'path' && e.attrs.d);
  const own = paths.find((p) => p.attrs['data-shape'] === 'rect' || p.attrs['data-shape'] === 'ellipse');
  const box = own?.attrs['data-box']?.trim().split(/[\s,]+/).map(Number);
  if (own && box?.length === 4 && box.every(Number.isFinite)) {
    const [x, y, w, h] = box;
    return { kind: own.attrs['data-shape'] as 'rect' | 'ellipse', x, y, w, h };
  }
  // Drawn by something else: kept as it came (mirrored twins this tool made are made again, not kept).
  const d = paths
    .filter((p) => p.attrs['data-twin'] !== '1')
    .map((p) => p.attrs.d.trim())
    .join(' ');
  return d ? { kind: 'path', d } : null;
}

export function openSvg(text: string): Opened {
  const svg = parseXml(text);
  if (!svg || localName(svg.name) !== 'svg') return { kind: 'error', message: 'This file isn’t an SVG drawing. Open a template saved by the lid add-on, or a design saved here.' };
  const a = svg.attrs;
  const w = mmLength(a.width);
  const h = mmLength(a.height);
  const vb = (a.viewBox ?? '').trim().split(/[\s,]+/).map(Number);
  if (w === null || h === null || vb.length !== 4 || !vb.every(Number.isFinite))
    return { kind: 'error', message: 'This SVG has no size in millimetres, so it can’t be shown at true size. A template from the lid add-on has width and height in mm and a viewBox to match.' };
  if (Math.abs(vb[2] - w) > 0.01 || Math.abs(vb[3] - h) > 0.01)
    return { kind: 'error', message: `This SVG’s drawing units aren’t millimetres (it is ${w} × ${h} mm but its viewBox is ${vb[2]} × ${vb[3]}). A template from the lid add-on has 1 unit = 1 mm.` };
  const all = [...walk(svg)];
  const outline = all.find((e) => localName(e.name) === 'path' && e.attrs.id === 'outline');
  if (!outline?.attrs.d) return { kind: 'error', message: 'This SVG has no panel outline (a path called “outline”), so it isn’t a template from the lid add-on.' };
  const place = (PLACES as readonly string[]).includes(a['data-place']) ? (a['data-place'] as Place) : 'field';
  const t = Number(a['data-thickness']);
  const panel: Panel = {
    place,
    width: a.width,
    height: a.height,
    viewBox: a.viewBox,
    w,
    h,
    thickness: a['data-thickness'] !== undefined && Number.isFinite(t) && t > 0 ? t : null,
    outline: outline.attrs.d,
  };
  const rect = outlineRect(outline.attrs.d);
  if (!rect || Math.abs(rect.x - vb[0]) > 0.01 || Math.abs(rect.y - vb[1]) > 0.01 || Math.abs(rect.w - w) > 0.01 || Math.abs(rect.h - h) > 0.01)
    return { kind: 'shaped', panel, message: SHAPED_LINE };
  const layerEls = all.filter((e) => localName(e.name) === 'g' && (e.attrs.class ?? '').split(/\s+/).includes('layer'));
  const layers: Layer[] = [];
  for (const g of layerEls) {
    const shape = readShape(g);
    if (!shape) continue;
    const edge = (EDGES as readonly string[]).includes(g.attrs['data-edge']) ? (g.attrs['data-edge'] as Edge) : 'square';
    const finish = (FINISHES as readonly string[]).includes(g.attrs['data-finish']) ? (g.attrs['data-finish'] as Finish) : 'ebony';
    layers.push({ id: newId(), name: g.attrs['data-name'] ?? `Layer ${layers.length + 1}`, shape, level: Math.max(0, n(g.attrs['data-level'], 0)), edge, finish });
  }
  const settingOut = all.find((e) => localName(e.name) === 'g' && e.attrs.id === 'setting-out');
  return { kind: 'design', design: { panel, zones: readZones(settingOut), layers }, isTemplate: layerEls.length === 0 };
}

// ---------------------------------------------------------------- writing

/** What each finish looks like, on screen and in the saved drawing. */
export const FINISH_COLOURS: Record<Finish, string> = {
  ebony: '#1e1b18',
  gold: '#c9a227',
  'white-gold': '#d8d2bd',
  pearl: '#ece8f0',
  boxwood: '#e3c98f',
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The rings a layer cuts, in absolute mm: its shape, and its mirrored twin where it has one. */
export function layerRings(d: Design, l: Layer): { rings: Ring[]; twin: Ring[] } {
  const s = l.shape;
  if (s.kind === 'zone') return { rings: zoneRings(d.panel, d.zones, s.zone), twin: [] };
  if (s.kind === 'path') return { rings: pathRings(s.d).rings, twin: [] };
  const own = [boxRing(s.kind, s.x, s.y, s.w, s.h)];
  if (!hasTwin(s, d.panel.w, d.zones)) return { rings: own, twin: [] };
  const t = twinOf(s, d.panel.w);
  return { rings: own, twin: [boxRing(s.kind, t.x, t.y, t.w, t.h)] };
}

/** One SVG for the lid add-on: the template's size, viewBox, place and outline, then a group per layer, in order. */
export function designSvg(d: Design): string {
  const p = d.panel;
  const z = d.zones;
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${esc(p.width)}" height="${esc(p.height)}" viewBox="${esc(p.viewBox)}" data-place="${p.place}"${p.thickness !== null ? ` data-thickness="${p.thickness}"` : ''}>`,
  );
  out.push(`  <path id="outline" d="${esc(p.outline)}" fill="none" stroke="#000000" stroke-width="0.2"/>`);
  // The zones, drawn but never cut, carrying their settings so the design opens again as it was.
  out.push(
    `  <g id="setting-out" fill="none" stroke="#6f8231" stroke-width="0.1" data-edge-distance="${z.edgeDistance}" data-band-width="${z.bandWidth}" data-centre="${z.centreShape}" data-centre-width="${z.centreWidth}" data-centre-height="${z.centreHeight}" data-gap-to-centre="${z.gapToCentre}" data-mirror="${z.mirror ? 'on' : 'off'}">`,
  );
  for (const zone of ['border', 'centre', 'left', 'right'] as const) {
    const rings = zoneRings(p, z, zone);
    if (rings.length) out.push(`    <path data-zone="${zone}" d="${ringsToD(rings)}"/>`);
  }
  out.push('  </g>');
  for (const l of d.layers) {
    const s = l.shape;
    const fill = `fill="${FINISH_COLOURS[l.finish]}" fill-rule="evenodd"`;
    const tag = s.kind === 'zone' ? ` data-shape="zone:${s.zone}"` : '';
    out.push(`  <g class="layer" data-name="${esc(l.name)}" data-level="${l.level}" data-edge="${l.edge}" data-finish="${l.finish}"${tag}>`);
    const { rings, twin } = layerRings(d, l);
    if (s.kind === 'rect' || s.kind === 'ellipse') {
      out.push(`    <path d="${ringsToD(rings)}" ${fill} data-shape="${s.kind}" data-box="${f(s.x)} ${f(s.y)} ${f(s.w)} ${f(s.h)}"/>`);
      if (twin.length) out.push(`    <path d="${ringsToD(twin)}" ${fill} data-twin="1"/>`);
    } else if (s.kind === 'path') out.push(`    <path d="${esc(s.d)}" ${fill}/>`);
    else if (rings.length) out.push(`    <path d="${ringsToD(rings)}" ${fill}/>`);
    out.push('  </g>');
  }
  out.push('</svg>');
  return out.join('\n') + '\n';
}

/** A file name for the saved design: the place, and "design". */
export function designFileName(d: Design): string {
  return `${d.panel.place}-design.svg`;
}

/** A plain lid-field template, as the add-on makes them, to try the tab without one. */
export function sampleTemplate(w = 204, h = 96, thickness = 6): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" data-place="field" data-thickness="${thickness}">\n  <path id="outline" d="M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z"/>\n</svg>\n`;
}
