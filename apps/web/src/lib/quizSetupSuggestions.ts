import type { QuizPreferences } from '@teacheros/contracts';

export type QuizStepContext = {
  title: string;
  description: string | null;
  durationMinutes: number | null;
};

export function quizFocusExamples(subject: string | null | undefined) {
  if (/\b(math(?:s|ematics)?|algebra|geometry|calculus)\b/i.test(subject ?? ''))
    return ['Recall facts, formulas, and methods.', 'Solve a problem in a new situation.'];
  if (/\b(science|biology|chemistry|physics)\b/i.test(subject ?? ''))
    return ['Recall key terms and scientific ideas.', 'Explain or predict what happens.'];
  if (/\b(history|geography|social studies|humanities)\b/i.test(subject ?? ''))
    return ['Recall key people, places, and events.', 'Use evidence to explain or compare.'];
  if (/\b(language|english|spanish|french|german|literacy|esl|efl)\b/i.test(subject ?? ''))
    return ['Recall vocabulary and language patterns.', 'Use the language in a new situation.'];
  return ['Recall facts and key ideas from this step.', 'Use what they learned in a new example.'];
}

export function suggestedQuizFormat(
  step: QuizStepContext,
  focus: QuizPreferences['focus'] | null
): QuizPreferences['format'] {
  const text = `${step.title} ${step.description ?? ''}`.replace(/<[^>]*>/g, ' ');
  if (/\b(?:no|without|avoid)\s+multiple[- ]choice\b/i.test(text)) return 'written';
  if (/\b(?:multiple[- ]choice|mcqs?)\b/i.test(text)) return 'multiple_choice';
  if (/\b(?:short[- ]answers?|written answers?|in writing)\b/i.test(text)) return 'written';
  return focus === 'recall' ? 'multiple_choice' : 'mixed';
}

export function suggestedQuizCount(
  durationMinutes: number | null,
  format: QuizPreferences['format'],
  difficulty: QuizPreferences['difficulty']
) {
  if (!durationMinutes || durationMinutes < 0) return 5;
  const minutesPerQuestion = format === 'multiple_choice' ? 1 : format === 'written' ? 2 : 1.5;
  const difficultyFactor = difficulty === 'challenge' ? 1.5 : difficulty === 'support' ? 1.25 : 1;
  return Math.max(
    2,
    Math.min(10, Math.floor(durationMinutes / minutesPerQuestion / difficultyFactor))
  );
}
