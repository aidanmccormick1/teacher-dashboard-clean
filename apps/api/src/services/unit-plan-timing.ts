import type { GenerateUnitDraftResponse } from '@teacheros/contracts';

export function fitUnitDraftToPeriods(
  draft: GenerateUnitDraftResponse,
  minutes: number[]
): GenerateUnitDraftResponse {
  if (draft.unit.lessons.length !== minutes.length) {
    throw new Error(
      'The unit planner did not return one lesson per class period. Please try again.'
    );
  }
  return {
    unit: {
      ...draft.unit,
      meetingCount: minutes.length,
      lessons: draft.unit.lessons.map((lesson, index) => {
        const budget = minutes[index]!;
        if (!lesson.steps.length || lesson.steps.length > budget) {
          throw new Error(
            'The unit planner returned steps that cannot fit the class period. Please try again.'
          );
        }
        // Reserve one minute per step, then apportion the rest by the model's
        // relative weights. Largest remainders keep the total exact.
        const remaining = budget - lesson.steps.length;
        const total = lesson.steps.reduce((sum, step) => sum + step.durationMinutes, 0);
        const shares = lesson.steps.map((step) => (remaining * step.durationMinutes) / total);
        const allocations = shares.map((share) => 1 + Math.floor(share));
        const remainder = budget - allocations.reduce((sum, value) => sum + value, 0);
        const order = shares
          .map((share, i) => ({ i, fraction: share - Math.floor(share) }))
          .sort((a, b) => b.fraction - a.fraction);
        for (const { i } of order.slice(0, remainder)) allocations[i]! += 1;
        return {
          ...lesson,
          estimatedDurationMinutes: budget,
          steps: lesson.steps.map((step, i) => ({
            ...step,
            durationMinutes: total === budget ? step.durationMinutes : allocations[i]!
          }))
        };
      })
    }
  };
}
