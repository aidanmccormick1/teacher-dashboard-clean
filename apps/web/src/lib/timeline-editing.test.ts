import { describe, expect, it } from 'vitest';
import {
  editClipRange,
  reflowLessonRanges,
  snapClipDelta,
  zoomScrollLeft
} from './timeline-editing.js';

describe('timeline editing', () => {
  it('moves a whole clip within its parent without changing duration', () => {
    expect(editClipRange({ start: 8, span: 4 }, 'move', 20, 5, 15)).toEqual({ start: 11, span: 4 });
    expect(editClipRange({ start: 8, span: 4 }, 'move', -20, 5, 15)).toEqual({ start: 5, span: 4 });
  });
  it('trims the start while retaining the end and at least one meeting', () => {
    expect(editClipRange({ start: 8, span: 4 }, 'trim-start', -3, 5, 20)).toEqual({
      start: 5,
      span: 7
    });
    expect(editClipRange({ start: 8, span: 4 }, 'trim-start', 20, 5, 20)).toEqual({
      start: 11,
      span: 1
    });
  });
  it('trims the end within the unit', () => {
    expect(editClipRange({ start: 8, span: 4 }, 'resize', 30, 5, 15)).toEqual({
      start: 8,
      span: 7
    });
    expect(editClipRange({ start: 8, span: 4 }, 'resize', -30, 5, 15)).toEqual({
      start: 8,
      span: 1
    });
  });
  it('keeps the meeting under the pointer stationary during zoom', () => {
    expect(zoomScrollLeft(300, 150, 50, 100)).toBe(750);
    expect((750 + 150) / 100).toBe((300 + 150) / 50);
  });
  it('snaps either moving edge to an adjacent boundary without snapping distant clips', () => {
    expect(snapClipDelta({ start: 5, span: 4 }, 'move', 2.9, [12], 60)).toBe(3);
    expect(snapClipDelta({ start: 5, span: 4 }, 'move', 2.6, [12], 60)).toBe(2.6);
  });
  it('reflows all lessons inside a shortened unit even when lessons outnumber meetings', () => {
    const ranges = reflowLessonRanges(10, 2, 5);
    expect(ranges).toHaveLength(5);
    expect(ranges.every((range) => range.start >= 10 && range.start + range.span <= 12)).toBe(true);
    expect(reflowLessonRanges(10, 7, 3)).toEqual([
      { start: 10, span: 2 },
      { start: 12, span: 2 },
      { start: 14, span: 3 }
    ]);
  });
});
