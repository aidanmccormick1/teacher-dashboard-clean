import { useEffect, useSyncExternalStore } from 'react';

const activities = new Set<symbol>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export function useHobieDrafting(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const activity = Symbol('draft');
    activities.add(activity);
    notify();
    return () => {
      activities.delete(activity);
      notify();
    };
  }, [active]);
}

export function useHobieIsDrafting(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => activities.size > 0,
    () => false
  );
}
