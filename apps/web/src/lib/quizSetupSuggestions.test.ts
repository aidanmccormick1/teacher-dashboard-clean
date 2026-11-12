import { describe, expect, it } from 'vitest';
import {
  quizFocusExamples,
  suggestedQuizCount,
  suggestedQuizFormat
} from './quizSetupSuggestions.js';

const step = { title: 'Food chains quiz', description: null, durationMinutes: 10 };

describe('quiz setup suggestions', () => {
  it('connects the focus examples to the course subject and supports missing subjects', () => {
    expect(quizFocusExamples('Biology')[1]).toBe('Explain or predict what happens.');
    expect(quizFocusExamples('Mathematics')[1]).toBe('Solve a problem in a new situation.');
    expect(quizFocusExamples('Spanish')[0]).toBe('Recall vocabulary and language patterns.');
    expect(quizFocusExamples(null)[0]).toBe('Recall facts and key ideas from this step.');
  });

  it('honors a format requested in the step before suggesting one from the quiz focus', () => {
    expect(
      suggestedQuizFormat({ ...step, description: 'Take a multiple-choice quiz.' }, 'application')
    ).toBe('multiple_choice');
    expect(
      suggestedQuizFormat({ ...step, description: '<p>Use short answers.</p>' }, 'recall')
    ).toBe('written');
    expect(suggestedQuizFormat({ ...step, description: 'No multiple choice.' }, 'recall')).toBe(
      'written'
    );
    expect(suggestedQuizFormat(step, 'recall')).toBe('multiple_choice');
    expect(suggestedQuizFormat(step, 'application')).toBe('mixed');
  });

  it('suggests fewer questions for short steps, written work, and deeper thinking', () => {
    expect(suggestedQuizCount(5, 'multiple_choice', 'standard')).toBeLessThan(
      suggestedQuizCount(10, 'multiple_choice', 'standard')
    );
    expect(suggestedQuizCount(10, 'written', 'standard')).toBeLessThan(
      suggestedQuizCount(10, 'multiple_choice', 'standard')
    );
    expect(suggestedQuizCount(10, 'mixed', 'challenge')).toBeLessThan(
      suggestedQuizCount(10, 'mixed', 'standard')
    );
  });

  it('keeps time-based suggestions small and uses five when no duration is available', () => {
    expect(suggestedQuizCount(null, 'written', 'challenge')).toBe(5);
    expect(suggestedQuizCount(1, 'written', 'challenge')).toBe(2);
    expect(suggestedQuizCount(120, 'multiple_choice', 'standard')).toBe(10);
  });
});
