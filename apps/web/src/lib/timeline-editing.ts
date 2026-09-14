export type ClipRange = { start: number; span: number };
export type TrimMode = 'move' | 'resize' | 'trim-start';

export const clampTimeline = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function editClipRange(
  range: ClipRange,
  mode: TrimMode,
  delta: number,
  min: number,
  max: number
): ClipRange {
  const end = range.start + range.span;
  if (mode === 'move')
    return {
      ...range,
      start: clampTimeline(range.start + delta, min, Math.max(min, max - range.span))
    };
  if (mode === 'trim-start') {
    const start = clampTimeline(range.start + delta, min, end - 1);
    return { start, span: end - start };
  }
  return { ...range, span: clampTimeline(range.span + delta, 1, Math.max(1, max - range.start)) };
}

export function snapClipDelta(
  range: ClipRange,
  mode: TrimMode,
  delta: number,
  anchors: number[],
  pixelsPerMeeting: number
) {
  const edges =
    mode === 'move'
      ? [range.start, range.start + range.span]
      : [mode === 'trim-start' ? range.start : range.start + range.span];
  let snapped = delta;
  let distance = Math.min(0.45, 8 / pixelsPerMeeting);
  for (const edge of edges) {
    for (const anchor of anchors) {
      const candidate = anchor - edge;
      if (Math.abs(candidate - delta) < distance) {
        distance = Math.abs(candidate - delta);
        snapped = candidate;
      }
    }
  }
  return snapped;
}

export function zoomScrollLeft(
  scrollLeft: number,
  anchorX: number,
  oldScale: number,
  newScale: number
) {
  return Math.max(0, ((scrollLeft + anchorX) / oldScale) * newScale - anchorX);
}

export function reflowLessonRanges(start: number, span: number, count: number): ClipRange[] {
  return Array.from({ length: count }, (_, index) => {
    const offset = Math.floor((index * span) / count);
    const end = Math.floor(((index + 1) * span) / count);
    return { start: start + offset, span: Math.max(1, end - offset) };
  });
}
