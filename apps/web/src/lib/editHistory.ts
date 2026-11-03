export type EditHistory<T> = { undo: T[]; redo: T[] };

export function recordEdit<T>(history: EditHistory<T>, previous: T): EditHistory<T> {
  return { undo: [...history.undo.slice(-49), previous], redo: [] };
}

export function travelEdit<T>(
  history: EditHistory<T>,
  current: T,
  direction: 'undo' | 'redo'
): { history: EditHistory<T>; value: T } | null {
  const entries = history[direction];
  if (!entries.length) return null;
  const opposite = direction === 'undo' ? 'redo' : 'undo';
  return {
    value: entries[entries.length - 1]!,
    history: {
      ...history,
      [direction]: entries.slice(0, -1),
      [opposite]: [...history[opposite], current]
    }
  };
}
