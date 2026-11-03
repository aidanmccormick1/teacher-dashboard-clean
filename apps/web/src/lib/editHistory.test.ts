import { describe, expect, it } from 'vitest';
import { recordEdit, travelEdit } from './editHistory.js';

describe('edit history', () => {
  it('replays sequential undo and redo in order', () => {
    const history = recordEdit(recordEdit({ undo: [], redo: [] }, 'first'), 'second');
    const one = travelEdit(history, 'third', 'undo')!;
    const two = travelEdit(one.history, one.value, 'undo')!;
    expect([one.value, two.value]).toEqual(['second', 'first']);
    const three = travelEdit(two.history, two.value, 'redo')!;
    expect(three.value).toBe('second');
    expect(travelEdit(three.history, three.value, 'redo')?.value).toBe('third');
  });

  it('clears redo after a new edit and leaves the original branch intact', () => {
    const original = { undo: ['first'], redo: ['third'] };
    const next = recordEdit(original, 'second');
    expect(travelEdit(next, 'new edit', 'redo')).toBeNull();
    expect(original.redo).toEqual(['third']);
  });
});
