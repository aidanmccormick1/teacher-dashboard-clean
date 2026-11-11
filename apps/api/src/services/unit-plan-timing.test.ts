import { describe, expect, it } from 'vitest';
import {
  GenerateUnitDraftRequestSchema,
  type GenerateUnitDraftResponse
} from '@teacheros/contracts';
import { fitUnitDraftToPeriods } from './unit-plan-timing.js';

const draft = (count: number): GenerateUnitDraftResponse => ({
  unit: {
    title: 'Fractions',
    description: 'Explore fractions',
    meetingCount: 6,
    lessons: Array.from({ length: count }, (_, i) => ({
      title: `Lesson ${i + 1}`,
      description: 'Practice',
      estimatedDurationMinutes: 50,
      steps: [10, 30, 10].map((durationMinutes, step) => ({
        title: `Step ${step + 1}`,
        description: 'Instruction',
        durationMinutes
      }))
    }))
  }
});

describe('fit unit draft to scheduled periods', () => {
  it('replaces a model’s 50-minute estimates with four 35-minute lessons and 140 total minutes', () => {
    const input = draft(4);
    const result = fitUnitDraftToPeriods(input, [35, 35, 35, 35]);
    expect(result.unit.meetingCount).toBe(4);
    expect(result.unit.lessons.map((lesson) => lesson.estimatedDurationMinutes)).toEqual([
      35, 35, 35, 35
    ]);
    expect(
      result.unit.lessons.reduce((sum, lesson) => sum + lesson.estimatedDurationMinutes, 0)
    ).toBe(140);
    expect(input.unit.lessons[0]!.estimatedDurationMinutes).toBe(50);
  });
  it('makes steps fit each variable-length period exactly while retaining positive whole minutes', () => {
    const minutes = [25, 35, 50, 37];
    const result = fitUnitDraftToPeriods(draft(4), minutes);
    for (const [i, lesson] of result.unit.lessons.entries()) {
      expect(lesson.estimatedDurationMinutes).toBe(minutes[i]);
      expect(lesson.steps.reduce((sum, step) => sum + step.durationMinutes, 0)).toBe(minutes[i]);
      expect(
        lesson.steps.every(
          (step) => Number.isInteger(step.durationMinutes) && step.durationMinutes > 0
        )
      ).toBe(true);
    }
    expect(result.unit.lessons[2]!.steps.map((step) => step.durationMinutes)).toEqual([10, 30, 10]);
  });
  it('rejects a model response with the wrong lesson count or impossible step timing', () => {
    expect(() => fitUnitDraftToPeriods(draft(3), [35, 35, 35, 35])).toThrow(
      'one lesson per class period'
    );
    expect(() => fitUnitDraftToPeriods(draft(2), [2, 2])).toThrow('cannot fit');
    const empty = draft(2);
    empty.unit.lessons[0]!.steps = [];
    expect(() => fitUnitDraftToPeriods(empty, [35, 35])).toThrow('cannot fit');
  });
});

describe('unit draft period duration contract', () => {
  const request = {
    courseName: 'Grade 5',
    gradeLevel: '5',
    prompt: 'Explore fractions',
    meetingCount: 4
  };
  it('accepts one explicit duration per period and keeps older callers compatible', () => {
    expect(
      GenerateUnitDraftRequestSchema.safeParse({
        ...request,
        meetingDurationsMinutes: [35, 35, 35, 35]
      }).success
    ).toBe(true);
    expect(GenerateUnitDraftRequestSchema.safeParse(request).success).toBe(true);
  });
  it('rejects mismatched counts and nonpositive or fractional durations', () => {
    for (const minutes of [
      [35, 35],
      [0, 35, 35, 35],
      [35.5, 35, 35, 35]
    ]) {
      expect(
        GenerateUnitDraftRequestSchema.safeParse({ ...request, meetingDurationsMinutes: minutes })
          .success
      ).toBe(false);
    }
  });
});
