// Project files: a whole job saved as one file on the laptop, and read back.
//
// The file is plain JSON, so it can be opened in any text editor if ever
// needed. It holds the project exactly as the app keeps it, the name of the
// alphabet it was set in, and the reference picture (if any) so the job is
// complete on its own.

import { defaultProject, KERN_CAP, type Project } from './layout';

/** A problem put in plain words for the carver, fit to show as it is. */
export class PlainError extends Error {}

export const FILE_FORMAT = 'incised-lettering-project';
/** Bumped only if the file layout changes in a way older apps could not read. */
export const FILE_VERSION = 1;
export const FILE_EXTENSION = '.lettering';
export const FILE_TYPE = 'application/x-incised-lettering';

export interface ProjectFile {
  format: typeof FILE_FORMAT;
  version: number;
  /** When it was saved, ISO date and time. */
  saved: string;
  /** The alphabet it was set in. */
  alphabet: string;
  project: Project;
  /** The reference picture as a data URL, or null. */
  picture: string | null;
}

export interface OpenedProject {
  project: Project;
  picture: string | null;
  alphabet: string;
  saved: Date | null;
}

type Loose = Record<string, unknown>;
const isObject = (v: unknown): v is Loose => !!v && typeof v === 'object' && !Array.isArray(v);
const numbers = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)) : []);

/**
 * A project from the browser's own store or a file, with anything missing
 * (an older save, or a setting added since) filled in from the starting values.
 */
export function normaliseProject(raw: unknown): Project {
  const d = structuredClone(defaultProject);
  if (!isObject(raw)) return d;
  const saved: Loose = { ...raw };
  // Older saves had one margin for all four sides.
  if (typeof saved.margin === 'number' && !isObject(saved.margins)) {
    const m = saved.margin;
    saved.margins = { top: m, right: m, bottom: m, left: m };
  }
  delete saved.margin;
  const part = (k: string): Loose => (isObject(saved[k]) ? (saved[k] as Loose) : {});
  const machine = part('machine');
  const guides = part('guides');
  // Hand kerning used to be kept in mm at whatever size the letters were; it is
  // now kept as at KERN_CAP and scales with the letters. Convert older saves once.
  const cap = typeof saved.capHeight === 'number' && saved.capHeight > 0 ? saved.capHeight : d.capHeight;
  const legacy = typeof saved.kernCap !== 'number';
  const toKept = (v: number) => (legacy ? Math.round(((v * KERN_CAP) / cap) * 1e4) / 1e4 : v);
  const kerns = (o: unknown): Record<string, number> =>
    isObject(o) ? Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k, toKept(v as number)])) : {};
  const gaps = isObject(saved.gapKerning)
    ? Object.fromEntries(
        Object.entries(saved.gapKerning)
          .filter(([, g]) => isObject(g) && typeof g.mm === 'number' && typeof g.pair === 'string')
          .map(([k, g]) => [k, { pair: (g as Loose).pair as string, mm: toKept((g as Loose).mm as number) }]),
      )
    : d.gapKerning;
  return {
    ...d,
    ...saved,
    text: typeof saved.text === 'string' ? saved.text : d.text,
    margins: { ...d.margins, ...part('margins') },
    border: { ...d.border, ...part('border') },
    evenUp: { ...d.evenUp, ...part('evenUp') },
    wordStops: { ...d.wordStops, ...part('wordStops') },
    machine: { ...d.machine, ...machine, passes: { ...d.machine.passes, ...(isObject(machine.passes) ? machine.passes : {}) } },
    guides: { x: numbers(guides.x), y: numbers(guides.y) },
    kerning: kerns(saved.kerning),
    groupKerning: kerns(saved.groupKerning),
    gapKerning: gaps,
    kernCap: KERN_CAP,
    spacers: isObject(saved.spacers) ? (Object.fromEntries(Object.entries(saved.spacers).filter(([, v]) => typeof v === 'number' && v >= 0)) as Project['spacers']) : {},
    lines: isObject(saved.lines) ? (saved.lines as Project['lines']) : d.lines,
    lineExtras: isObject(saved.lineExtras) ? (saved.lineExtras as Project['lineExtras']) : d.lineExtras,
    groups: isObject(saved.groups) && isObject(saved.groups.left) && isObject(saved.groups.right) ? (saved.groups as unknown as Project['groups']) : d.groups,
    refImage: isObject(saved.refImage) ? (saved.refImage as unknown as Project['refImage']) : null,
  } as Project;
}

/** The text of a project file. */
export function projectFileText(project: Project, alphabet: string, picture: string | null, date = new Date()): string {
  const file: ProjectFile = { format: FILE_FORMAT, version: FILE_VERSION, saved: date.toISOString(), alphabet, project, picture };
  return JSON.stringify(file, null, 1) + '\n';
}

/** Read a project file. Throws an Error with a plain message if it isn't one. */
export function readProjectFile(text: string): OpenedProject {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new PlainError('That file is not a lettering project: it could not be read.');
  }
  if (!isObject(data) || data.format !== FILE_FORMAT || !isObject(data.project)) {
    throw new PlainError('That file is not a lettering project.');
  }
  if (typeof data.version === 'number' && data.version > FILE_VERSION) {
    throw new PlainError('That project was saved by a newer version of the app. Reload the app to bring it up to date, then open the file again.');
  }
  const picture = typeof data.picture === 'string' && data.picture.startsWith('data:image/') ? data.picture : null;
  const saved = typeof data.saved === 'string' && !Number.isNaN(Date.parse(data.saved)) ? new Date(data.saved) : null;
  return { project: normaliseProject(data.project), picture, alphabet: typeof data.alphabet === 'string' ? data.alphabet : '', saved };
}

/**
 * How many of the spacing settings kept with the alphabet (pair and group
 * kerning, the groups, the even-up settings) differ between two projects.
 */
export function alphabetDifferences(a: Project, b: Project): number {
  let n = 0;
  for (const key of ['kerning', 'groupKerning'] as const) {
    for (const pair of new Set([...Object.keys(a[key]), ...Object.keys(b[key])])) if ((a[key][pair] ?? 0) !== (b[key][pair] ?? 0)) n++;
  }
  if (JSON.stringify(a.groups) !== JSON.stringify(b.groups)) n++;
  if (JSON.stringify(a.evenUp) !== JSON.stringify(b.evenUp)) n++;
  return n;
}

/** A file name for the job, from its inscription: "OAK.lettering". */
export function fileNameFor(p: Project): string {
  const title = p.text.replace(/\s+/g, ' ').trim();
  return `${title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'lettering'}${FILE_EXTENSION}`;
}
