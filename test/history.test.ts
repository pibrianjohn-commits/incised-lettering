import { describe, expect, it } from 'vitest';
import { History } from '../src/history';

describe('undo and redo', () => {
  it('steps back and forward through changes', () => {
    const h = new History<number>();
    let v = 1;
    h.record(v); v = 2;
    h.record(v); v = 3;
    v = h.undo(v)!; expect(v).toBe(2);
    v = h.undo(v)!; expect(v).toBe(1);
    expect(h.undo(v)).toBeNull();
    v = h.redo(v)!; expect(v).toBe(2);
    v = h.redo(v)!; expect(v).toBe(3);
    expect(h.redo(v)).toBeNull();
  });

  it('a run of quick changes in one group undoes as one step', () => {
    const h = new History<number>();
    let v = 10;
    for (let i = 0; i < 5; i++) { h.record(v, 'slider'); v += 1; }
    expect(h.undo(v)).toBe(10);
    expect(h.canUndo).toBe(false);
  });

  it('a new change after undo clears redo', () => {
    const h = new History<number>();
    let v = 1;
    h.record(v); v = 2;
    v = h.undo(v)!;
    h.record(v); v = 5;
    expect(h.canRedo).toBe(false);
  });
});
