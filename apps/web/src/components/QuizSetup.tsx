import { useEffect, useId, useRef, useState } from 'react';
import type { QuizPreferences } from '@teacheros/contracts';
import {
  quizFocusExamples,
  suggestedQuizCount,
  suggestedQuizFormat,
  type QuizStepContext
} from '../lib/quizSetupSuggestions.js';
import './QuizSetup.css';

const difficultyDescriptions = {
  support: 'Direct questions, familiar examples, and helpful cues.',
  standard: 'Matches what students learned in this lesson.',
  challenge: 'New examples and deeper thinking at the same grade level.'
};

export function QuizSetup({
  step,
  subject,
  onCreate,
  onDismiss
}: {
  step: QuizStepContext;
  subject?: string | null;
  onCreate: (preferences: QuizPreferences) => void;
  onDismiss: (restoreFocus?: boolean) => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const id = useId();
  const [stage, setStage] = useState<1 | 2>(1);
  const [focus, setFocus] = useState<QuizPreferences['focus'] | null>(null);
  const [chosenFormat, setChosenFormat] = useState<QuizPreferences['format'] | null>(null);
  const [difficulty, setDifficulty] = useState<QuizPreferences['difficulty']>('standard');
  const [chosenCount, setChosenCount] = useState<string | null>(null);
  const format = chosenFormat ?? suggestedQuizFormat(step, focus);
  const countValue =
    chosenCount ?? String(suggestedQuizCount(step.durationMinutes, format, difficulty));
  const count = Number(countValue);
  const validCount = countValue !== '' && Number.isInteger(count) && count >= 2 && count <= 20;
  const [recallExample, applicationExample] = quizFocusExamples(subject);
  useEffect(() => {
    const element = panel.current!;
    element.setAttribute('popover', 'auto');
    const onToggle = (event: Event) => {
      if ((event as ToggleEvent).newState === 'closed') dismiss.current(false);
    };
    element.addEventListener('toggle', onToggle);
    element.showPopover();
    heading.current?.focus();
    return () => {
      element.removeEventListener('toggle', onToggle);
      if (element.isConnected && element.matches(':popover-open')) element.hidePopover();
    };
  }, []);
  useEffect(() => {
    heading.current?.focus();
  }, [stage]);
  return (
    <section
      {...{ popover: 'auto' }}
      ref={panel}
      className="lesson-quiz-setup"
      role="dialog"
      aria-labelledby={`${id}-title`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onDismiss(true);
        }
      }}
    >
      <header>
        <strong id={`${id}-title`}>Quiz</strong>
        <span>{stage} of 2</span>
        <button type="button" className="secondary" onClick={() => onDismiss(true)}>
          Close
        </button>
      </header>
      <p className="quiz-setup-context" title={step.title}>
        {step.title}
      </p>
      <div className="quiz-setup-question" key={stage}>
        <h3 ref={heading} tabIndex={-1}>
          {stage === 1 ? 'What should the quiz test?' : 'How should students answer?'}
        </h3>
        {stage === 1 ? (
          <div className="quiz-setup-choices" role="group" aria-label="Quiz focus">
            {(
              [
                ['recall', 'Remember the basics', recallExample],
                ['application', 'Use what they learned', applicationExample],
                ['mixed', 'Both', 'Start with the basics, then apply them.']
              ] as const
            ).map(([value, title, description]) => (
              <button
                type="button"
                key={value}
                className="quiz-setup-choice"
                aria-pressed={focus === value}
                onClick={() => {
                  setFocus(value);
                  setStage(2);
                }}
              >
                <strong>{title}</strong>
                <span>{description}</span>
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="quiz-setup-choices" role="group" aria-label="Answer format">
              {(
                [
                  ['multiple_choice', 'Multiple choice', 'Pick an answer from a list.'],
                  ['written', 'Short written answers', 'Write a few words or sentences.'],
                  ['mixed', 'A mix of both', 'Some choices, some written answers.']
                ] as const
              ).map(([value, title, description]) => (
                <button
                  type="button"
                  key={value}
                  className="quiz-setup-choice"
                  aria-pressed={format === value}
                  onClick={() => setChosenFormat(value)}
                >
                  <strong>{title}</strong>
                  <span>{description}</span>
                </button>
              ))}
            </div>
            <div className="quiz-setup-count">
              <label htmlFor={`${id}-count`}>Number of questions</label>
              <div className="quiz-setup-number">
                <button
                  type="button"
                  className="secondary"
                  aria-label="Fewer questions"
                  disabled={!validCount || count <= 2}
                  onClick={() => setChosenCount(String(count - 1))}
                >
                  −
                </button>
                <input
                  id={`${id}-count`}
                  type="number"
                  inputMode="numeric"
                  min={2}
                  max={20}
                  step={1}
                  value={countValue}
                  aria-invalid={!validCount}
                  aria-describedby={`${id}-count-help`}
                  onChange={(event) => setChosenCount(event.target.value)}
                />
                <button
                  type="button"
                  className="secondary"
                  aria-label="More questions"
                  disabled={!validCount || count >= 20}
                  onClick={() => setChosenCount(String(count + 1))}
                >
                  +
                </button>
              </div>
            </div>
            <p
              id={`${id}-count-help`}
              className="quiz-setup-help"
              role={!validCount ? 'alert' : undefined}
            >
              {!validCount
                ? 'Enter a whole number from 2 to 20.'
                : chosenCount === null && step.durationMinutes && step.durationMinutes > 0
                  ? `Suggested for this ${step.durationMinutes}-minute step.`
                  : 'Choose 2 to 20 questions.'}
            </p>
            <div className="quiz-setup-difficulty">
              <label htmlFor={`${id}-difficulty`}>Difficulty for students</label>
              <select
                id={`${id}-difficulty`}
                value={difficulty}
                aria-describedby={`${id}-difficulty-help`}
                onChange={(event) =>
                  setDifficulty(event.target.value as QuizPreferences['difficulty'])
                }
              >
                <option value="support">Extra support</option>
                <option value="standard">At lesson level</option>
                <option value="challenge">More challenge</option>
              </select>
            </div>
            <p id={`${id}-difficulty-help`} className="quiz-setup-help">
              {difficultyDescriptions[difficulty]}
            </p>
          </>
        )}
      </div>
      {stage === 2 ? (
        <footer>
          <button type="button" className="secondary" onClick={() => setStage(1)}>
            Back
          </button>
          <button
            type="button"
            className="lesson-resource-primary"
            disabled={!focus || !validCount}
            onClick={() => {
              if (focus && validCount)
                onCreate({ focus, format, questionCount: count, difficulty });
            }}
          >
            Create quiz
          </button>
        </footer>
      ) : null}
    </section>
  );
}
