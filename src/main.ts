import { alphabetFromFont } from './alphabet';
import { contourToSvg, polylineToSvg } from './geometry';
import { layoutPanel, type Layout, type PanelSettings } from './layout';

const settings: PanelSettings = {
  text: 'OAK',
  capHeight: 25,
  panelWidth: 150,
  panelHeight: 60,
  datumOffset: 0.75,
};

// CSS says 96 px per inch, but real screens differ, so the carver can
// calibrate against a rule. `calibration` multiplies the nominal size.
const NOMINAL_PX_PER_MM = 96 / 25.4;
const CAL_KEY = 'incised.calibration';
let calibration = readCalibration();
let zoom = 1;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $('stage');

async function start() {
  stage.textContent = 'Loading letters…';
  const res = await fetch(`${import.meta.env.BASE_URL}fonts/Cinzel-Regular.woff`);
  if (!res.ok) throw new Error(`font file missing (${res.status})`);
  const buf = await res.arrayBuffer();
  const alphabet = alphabetFromFont(buf, 'SIL Open Font License 1.1');
  const layout = layoutPanel(alphabet, settings);

  stage.replaceChildren(drawPanel(layout));
  showSettings(layout, alphabet.name);
  $('credit').innerHTML =
    `Stand-in alphabet: <b>${alphabet.name}</b> by Natanael Gama, ${alphabet.licence}. ` +
    `<a href="./fonts/OFL.txt">Licence</a>.`;
  applyScale();
}

function drawPanel(layout: Layout): SVGSVGElement {
  const s = layout.settings;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.id = 'panel';
  svg.setAttribute('viewBox', `0 0 ${s.panelWidth} ${s.panelHeight}`);
  svg.setAttribute('overflow', 'visible');

  const parts: string[] = [];
  parts.push(`<rect class="panel" x="0" y="0" width="${s.panelWidth}" height="${s.panelHeight}"/>`);
  // Faint guides: baseline and cap line.
  const capY = layout.baselineY - s.capHeight;
  parts.push(`<g class="guides"><line x1="0" x2="${s.panelWidth}" y1="${layout.baselineY}" y2="${layout.baselineY}"/>`);
  parts.push(`<line x1="0" x2="${s.panelWidth}" y1="${capY}" y2="${capY}"/></g>`);

  for (const L of layout.letters) {
    const outline = L.outline.map(contourToSvg).join('');
    parts.push(`<g class="letter" data-char="${L.char}">`);
    parts.push(`<path class="fill" d="${outline}"/>`);
    parts.push(`<path class="outline" d="${outline}"/>`);
    parts.push(`<path class="datum" d="${L.datum.map(contourToSvg).join('')}"/>`);
    parts.push(`<path class="valley" d="${L.valleys.map(polylineToSvg).join('')}"/>`);
    parts.push(`</g>`);
  }
  svg.innerHTML = parts.join('');
  return svg;
}

function showSettings(layout: Layout, alphabetName: string) {
  const s = layout.settings;
  const rows: [string, string][] = [
    ['Inscription', s.text],
    ['Alphabet', `${alphabetName} (stand-in)`],
    ['Cap height', `${s.capHeight} mm`],
    ['Panel', `${s.panelWidth} × ${s.panelHeight} mm`],
    ['Word length', `${layout.textWidth.toFixed(1)} mm, centred`],
    ['Datum offset', `${s.datumOffset} mm inside the outline`],
  ];
  $('settings').innerHTML =
    `<h2>This panel</h2><table>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>` +
    `<p class="note">These are fixed for this first step; settings you can change come next.</p>`;
}

function applyScale() {
  const pxPerMm = NOMINAL_PX_PER_MM * calibration;
  const svg = document.getElementById('panel');
  if (svg) {
    svg.style.width = `${settings.panelWidth * pxPerMm * zoom}px`;
    svg.style.height = `${settings.panelHeight * pxPerMm * zoom}px`;
    // Keep line weights readable when magnified.
    svg.style.setProperty('--zoom', String(zoom));
  }
  $('ruler').style.width = `${100 * pxPerMm}px`;
  ($('cal') as HTMLInputElement).value = String(calibration);
}

function readCalibration(): number {
  try {
    const v = parseFloat(localStorage.getItem(CAL_KEY) ?? '');
    return v > 0.5 && v < 2 ? v : 1;
  } catch {
    return 1;
  }
}

function setCalibration(v: number) {
  calibration = Math.min(1.6, Math.max(0.6, v));
  try {
    localStorage.setItem(CAL_KEY, String(calibration));
  } catch {
    /* storage unavailable: calibration lasts for this visit only */
  }
  applyScale();
}

function wireControls() {
  for (const layer of ['outline', 'datum', 'valley', 'fill']) {
    const box = $<HTMLInputElement>(`show-${layer}`);
    const sync = () => stage.classList.toggle(`hide-${layer}`, !box.checked);
    box.addEventListener('change', sync);
    sync();
  }
  $('zoom').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    zoom = Number(b.dataset.zoom);
    $('zoom').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    applyScale();
  });
  $<HTMLInputElement>('cal').addEventListener('input', (e) => setCalibration(Number((e.target as HTMLInputElement).value)));
  $('cal-minus').addEventListener('click', () => setCalibration(calibration - 0.002));
  $('cal-plus').addEventListener('click', () => setCalibration(calibration + 0.002));
  $('cal-reset').addEventListener('click', () => setCalibration(1));
}

wireControls();
start().catch((err) => {
  stage.textContent = `Could not load the letters: ${err}`;
});
