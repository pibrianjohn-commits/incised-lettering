// Pan and zoom for the workspace.
// The drawing is in millimetres; `scale` is screen pixels per millimetre and
// (tx, ty) is where the panel's top-left corner sits on screen.

export interface ViewState {
  scale: number;
  tx: number;
  ty: number;
}

export interface ViewCallbacks {
  /** Called whenever the view moves. */
  changed(v: ViewState): void;
  /** A press and release without dragging. */
  click(target: Element, e: PointerEvent): void;
}

const MIN_SCALE = 0.2;
const MAX_SCALE = 400;
const DRAG_THRESHOLD = 4; // px before a press counts as a drag

export class PanZoom {
  v: ViewState = { scale: 4, tx: 0, ty: 0 };

  constructor(
    private el: HTMLElement,
    private cb: ViewCallbacks,
  ) {
    el.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    el.addEventListener('pointerdown', (e) => this.onDown(e));
  }

  set(v: ViewState) {
    this.v = { ...v, scale: clamp(v.scale, MIN_SCALE, MAX_SCALE) };
    this.cb.changed(this.v);
  }

  /** Zoom by `factor`, keeping the screen point (sx, sy) fixed. */
  zoomAt(factor: number, sx: number, sy: number) {
    const s = clamp(this.v.scale * factor, MIN_SCALE, MAX_SCALE);
    const f = s / this.v.scale;
    this.set({ scale: s, tx: sx - (sx - this.v.tx) * f, ty: sy - (sy - this.v.ty) * f });
  }

  /**
   * Show a w × h mm area centred, at `scale` px per mm (or fitted if omitted),
   * with `left` px kept clear on its left for the rulers and line numbers (and
   * the setting-out lines' labels, when they show), 70 on its right.
   */
  frame(w: number, h: number, scale?: number, left = 70) {
    const r = this.el.getBoundingClientRect();
    const right = 70;
    const s = scale ?? Math.min((r.width - left - right) / w, (r.height - 120) / h);
    this.set({ scale: s, tx: left + (r.width - left - right - w * s) / 2, ty: (r.height - h * s) / 2 });
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const r = this.el.getBoundingClientRect();
    // Trackpad pinch arrives as ctrl+wheel with small deltas; mouse wheels give ~100 per notch.
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
    const factor = Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0015));
    this.zoomAt(factor, e.clientX - r.left, e.clientY - r.top);
  }

  private onDown(e: PointerEvent) {
    if (e.button !== 0 && e.button !== 1) return;
    const start = { x: e.clientX, y: e.clientY, tx: this.v.tx, ty: this.v.ty };
    const target = e.target as Element;
    let dragging = false;
    const move = (m: PointerEvent) => {
      const dx = m.clientX - start.x;
      const dy = m.clientY - start.y;
      if (!dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        dragging = true;
        this.el.setPointerCapture(e.pointerId);
        this.el.classList.add('panning');
      }
      if (dragging) this.set({ scale: this.v.scale, tx: start.tx + dx, ty: start.ty + dy });
    };
    const up = (u: PointerEvent) => {
      this.el.removeEventListener('pointermove', move);
      this.el.removeEventListener('pointerup', up);
      this.el.removeEventListener('pointercancel', up);
      this.el.classList.remove('panning');
      if (!dragging && u.type === 'pointerup') this.cb.click(target, u);
    };
    this.el.addEventListener('pointermove', move);
    this.el.addEventListener('pointerup', up);
    this.el.addEventListener('pointercancel', up);
  }
}

function clamp(x: number, a: number, b: number) {
  return Math.min(b, Math.max(a, x));
}
