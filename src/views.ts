// What is drawn on the panel: the tick boxes under Layers, the view presets,
// and what each stage shows when it is opened (BRIEF.md, Decisions: "The
// interface" and "The setting-out lines").

import type { Stage } from './problems';

export const LAYERS = ['outline', 'datum', 'valley', 'fill', 'space', 'margins', 'capbase', 'mid', 'xheight', 'desc', 'centre', 'kerns', 'bed'] as const;
export type Layer = (typeof LAYERS)[number];

/** The setting-out lines, a tick for each kind: cap line and baseline; mid line; x-height and ascender; descender; panel centre. */
export const SETTING_OUT: Layer[] = ['capbase', 'mid', 'xheight', 'desc', 'centre'];

export type PresetName = 'design' | 'spacing' | 'setting' | 'proof';
export const PRESET_KEYS: PresetName[] = ['design', 'spacing', 'setting', 'proof'];

/** Which layers each view preset shows. */
export const PRESETS: Record<PresetName, Layer[]> = {
  design: ['fill'], // letters filled solid, nothing else
  spacing: ['fill', 'space'], // letters plus shaded spaces and their areas
  setting: ['outline', 'datum', 'valley', ...SETTING_OUT], // the marks the machine will make, on every setting-out line
  proof: ['fill'], // clean letters on the panel, as a client would see them
};

export interface StageView {
  preset: PresetName | null;
  layers: Layer[];
}

/**
 * What each stage shows when it is opened, until the carver changes it there
 * (BRIEF.md, Decisions: the interface). Each stage then remembers its own.
 */
export const STAGE_VIEWS: Record<Stage, StageView> = {
  write: { preset: null, layers: ['fill', 'margins', 'capbase', 'mid'] }, // the letters, with the lines they sit on
  space: { preset: 'spacing', layers: PRESETS.spacing },
  panel: { preset: null, layers: ['fill', 'margins', 'capbase', 'mid'] }, // the letters, with the margins
  machine: { preset: 'setting', layers: PRESETS.setting },
  '3d': { preset: null, layers: [] },
};

/**
 * Stage views remembered before the setting-out lines (9 Oct 2026), when one
 * tick, "guides", showed the margins, baselines and cap lines together: a
 * stage on a preset gets that preset as it is now, and "guides" becomes the
 * margins with the cap line, baseline and mid line, as the Write and Panel
 * stages now open.
 */
export function viewsFromBefore(old: Partial<Record<Stage, { preset: string | null; layers: string[] }>> | null): Partial<Record<Stage, StageView>> {
  const out: Partial<Record<Stage, StageView>> = {};
  for (const [stage, v] of Object.entries(old ?? {}) as [Stage, { preset: string | null; layers: string[] }][]) {
    if (!v || !Array.isArray(v.layers)) continue;
    const preset = PRESET_KEYS.includes(v.preset as PresetName) ? (v.preset as PresetName) : null;
    const layers = preset
      ? PRESETS[preset]
      : v.layers.flatMap((l): Layer[] => (l === 'guides' ? ['margins', 'capbase', 'mid'] : (LAYERS as readonly string[]).includes(l) ? [l as Layer] : []));
    out[stage] = { preset, layers };
  }
  return out;
}
