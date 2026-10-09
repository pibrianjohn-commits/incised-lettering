// Undo and redo. Keeps whole snapshots of the project: it is small, and a
// snapshot can never get out of step with the thing it restores.

export class History<T> {
  private undoStack: T[] = [];
  private redoStack: T[] = [];
  private lastGroup: string | null = null;
  private lastTime = 0;

  constructor(private limit = 300) {}

  /**
   * Record the state as it was before a change. Changes with the same
   * `group` made in quick succession (dragging a slider, typing a word)
   * become a single step.
   */
  record(before: T, group: string | null = null) {
    const now = Date.now();
    const sameRun = group !== null && group === this.lastGroup && now - this.lastTime < 1000;
    this.lastGroup = group;
    this.lastTime = now;
    if (sameRun) return;
    this.undoStack.push(before);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  /**
   * Step back. `current` is the state now, kept for redo; or, where steps
   * keep different things (the job, or what a view shows), a function giving
   * the state now of whatever the step being undone keeps.
   */
  undo(current: T | ((step: T) => T)): T | null {
    const prev = this.undoStack.pop();
    if (prev === undefined) return null;
    this.redoStack.push(typeof current === 'function' ? (current as (step: T) => T)(prev) : current);
    this.lastGroup = null;
    return prev;
  }

  redo(current: T | ((step: T) => T)): T | null {
    const next = this.redoStack.pop();
    if (next === undefined) return null;
    this.undoStack.push(typeof current === 'function' ? (current as (step: T) => T)(next) : current);
    this.lastGroup = null;
    return next;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }
}
