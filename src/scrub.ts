// Drag on a setting's name to change its value: drag right to increase, left
// to decrease, one step every few pixels; hold Shift for ten steps at a time.
// A plain click still goes to the box for typing. The whole drag is one step
// to undo (the hooks let the caller group it).

export interface ScrubHooks {
  /** A drag has started. */
  begin(): void;
  /** The drag has finished. */
  end(): void;
}

const THRESHOLD = 3; // px before a press counts as a drag

/** The number box or slider a label controls, if it is one that can be dragged. */
export function scrubTarget(el: Element): HTMLInputElement | null {
  if (el.closest('input, button, select, textarea, output, a')) return null;
  const label = el.closest('label');
  if (!label) return null;
  const linked = label.htmlFor ? document.getElementById(label.htmlFor) : null;
  const input = (linked instanceof HTMLInputElement ? linked : null) ?? label.querySelector<HTMLInputElement>('input');
  if (!input || input.disabled || (input.type !== 'number' && input.type !== 'range')) return null;
  return input;
}

/** Decimal places in a step such as 0.05. */
function places(step: number): number {
  const s = String(step);
  return s.includes('.') ? s.length - s.indexOf('.') - 1 : 0;
}

/** The new value after dragging `px` pixels, held within the box's limits. */
export function scrubValue(start: number, px: number, opts: { step: number; min: number; max: number; coarse: boolean }): number {
  const { step, min, max } = opts;
  // Spread a bounded range over about 400 px, but never slower than 8 px or faster than 3 px a step.
  const steps = Number.isFinite(min) && Number.isFinite(max) ? (max - min) / step : Infinity;
  const pxPerStep = Number.isFinite(steps) ? Math.min(8, Math.max(3, 400 / steps)) : 4;
  const n = Math.trunc(px / pxPerStep) * (opts.coarse ? 10 : 1);
  const v = start + n * step;
  const held = Math.min(max, Math.max(min, v));
  return Number(held.toFixed(Math.max(places(step), 0)));
}

export function enableScrub(root: HTMLElement, hooks: ScrubHooks) {
  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const input = scrubTarget(e.target as Element);
    if (!input) return;
    const label = (e.target as Element).closest('label')!;
    const startX = e.clientX;
    const read = (a: string, fallback: number) => {
      const v = parseFloat(input.getAttribute(a) ?? '');
      return Number.isFinite(v) ? v : fallback;
    };
    const step = read('step', 1) || 1;
    const min = read('min', -Infinity);
    const max = read('max', Infinity);
    const start = input.value === '' ? (Number.isFinite(min) ? min : 0) : Number(input.value);
    let dragging = false;
    let last = start;

    const move = (m: PointerEvent) => {
      const dx = m.clientX - startX;
      if (!dragging) {
        if (Math.abs(dx) < THRESHOLD) return;
        dragging = true;
        label.setPointerCapture(m.pointerId);
        document.body.classList.add('scrubbing');
        hooks.begin();
      }
      m.preventDefault();
      const v = scrubValue(start, dx, { step, min, max, coarse: m.shiftKey });
      if (v === last) return;
      last = v;
      input.value = String(v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const up = () => {
      label.removeEventListener('pointercancel', up);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      if (!dragging) return;
      document.body.classList.remove('scrubbing');
      hooks.end();
      // A drag is not a click: don't send the label's click on to the box.
      const swallow = (c: Event) => c.preventDefault();
      label.addEventListener('click', swallow, { once: true, capture: true });
      setTimeout(() => label.removeEventListener('click', swallow, true), 0);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    label.addEventListener('pointercancel', up);
  });
}
