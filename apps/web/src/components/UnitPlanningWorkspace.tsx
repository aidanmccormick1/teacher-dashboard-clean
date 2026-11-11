import { HobieDraftingIllustration } from './HobieHelper.js';
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { GenerateUnitDraftResponse } from '@teacheros/contracts';
import { distributeUnitPeriods } from '../lib/unit-plan-layout.js';
import { UnitPlanReview } from './UnitPlanReview.js';
import './UnitPlanningWorkspace.css';

type Draft = GenerateUnitDraftResponse;

export function UnitPlanningWorkspace({
  courseName,
  groupName,
  goal,
  meetings,
  periodMinutes,
  draftPeriodMinutes = periodMinutes,
  scheduleSource,
  timingIssue,
  manualPeriodMinutes,
  setManualPeriodMinutes,
  setGoal,
  setMeetings,
  draft,
  setDraft,
  generating,
  adding,
  error,
  saveFailed,
  onGenerate,
  onAdd,
  onClose,
  startMeeting = 0,
  previousUnitTitle,
  meetingDates = []
}: {
  courseName: string;
  groupName?: string;
  goal: string;
  meetings: string;
  periodMinutes: number[];
  draftPeriodMinutes?: number[];
  scheduleSource: string | null;
  timingIssue: string | null;
  manualPeriodMinutes: string;
  setManualPeriodMinutes: (value: string) => void;
  setGoal: (value: string) => void;
  setMeetings: (value: string) => void;
  draft: Draft | null;
  setDraft: Dispatch<SetStateAction<Draft | null>>;
  generating: boolean;
  adding: boolean;
  error: string | null;
  saveFailed: boolean;
  onGenerate: () => Promise<boolean>;
  onAdd: () => void;
  onClose: () => void;
  startMeeting?: number;
  previousUnitTitle?: string;
  meetingDates?: string[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [review, setReview] = useState(Boolean(draft));
  const busy = generating || adding;
  const unit = draft?.unit;
  const ranges = unit ? distributeUnitPeriods(0, unit.meetingCount, unit.lessons.length) : [];
  const overBudget = unit?.lessons.some((lesson, index) => {
    const range = ranges[index]!;
    const budget = draftPeriodMinutes
      .slice(range.start, range.start + range.span)
      .reduce((sum, value) => sum + value, 0);
    return budget > 0 && lesson.estimatedDurationMinutes > budget;
  });
  const valid = Boolean(
    unit?.title.trim() &&
    unit.lessons.length &&
    !overBudget &&
    unit.lessons.every(
      (lesson) =>
        lesson.title.trim() &&
        lesson.steps.length &&
        lesson.steps.every(
          (step) =>
            step.title.trim() && Number.isInteger(step.durationMinutes) && step.durationMinutes > 0
        )
    )
  );

  useEffect(() => {
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element?.showModal();
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  useEffect(() => {
    heading.current?.focus();
    dialog.current?.querySelector('.unit-planning-body')?.scrollTo({ top: 0 });
  }, [review]);

  return (
    <dialog
      ref={dialog}
      className={`unit-planning-dialog${unit ? ' unit-planning-dialog-fullscreen' : ''}`}
      aria-labelledby="unit-planning-heading"
      aria-busy={busy}
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="unit-planning-header">
        <div>
          <p>
            {courseName}
            {groupName ? ` · ${groupName}` : ''}
          </p>
          <h1 id="unit-planning-heading" ref={heading} tabIndex={-1}>
            {review ? 'Review your unit plan' : unit ? 'Try a new idea' : 'Plan a unit'}
          </h1>
        </div>
        <button type="button" className="secondary" disabled={busy} onClick={onClose}>
          {unit ? 'Back to timeline' : 'Close'}
        </button>
      </header>
      <div className="unit-planning-body">
        {generating ? (
          <div className="unit-planning-hobie">
            <HobieDraftingIllustration />
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="notice warning">
            {error}
          </p>
        ) : null}
        {review && unit ? (
          <UnitPlanReview
            unit={unit}
            busy={busy}
            startMeeting={startMeeting}
            previousUnitTitle={previousUnitTitle}
            meetingDates={meetingDates}
            periodMinutes={draftPeriodMinutes}
            onUpdate={(nextUnit) => setDraft({ unit: nextUnit })}
          />
        ) : (
          <form
            id="unit-planning-form"
            className="unit-planning-fields unit-planning-setup"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!busy && (await onGenerate())) setReview(true);
            }}
          >
            {unit ? (
              <p>
                Change the learning goal or try a different approach. Your current idea stays
                available until the new one is ready.
              </p>
            ) : null}
            <p>
              {scheduleSource && periodMinutes.length
                ? new Set(periodMinutes).size === 1
                  ? `Using ${periodMinutes[0]}-minute class periods from ${scheduleSource}’s schedule.`
                  : `Using the scheduled period lengths from ${scheduleSource}: ${periodMinutes.join(', ')} minutes, in teaching order.`
                : timingIssue}
            </p>
            {Number(meetings) >= 2 && periodMinutes.length ? (
              <p role="status">
                {periodMinutes.length} class periods ·{' '}
                {periodMinutes.reduce((sum, value) => sum + value, 0)} total minutes
              </p>
            ) : null}
            <label>
              Learning goal
              <textarea
                className="input"
                rows={6}
                required
                minLength={8}
                value={goal}
                disabled={busy}
                placeholder="What should students know or be able to do by the end of this unit?"
                onChange={(event) => setGoal(event.target.value)}
              />
            </label>
            <div className="unit-planning-numbers">
              <label>
                Class periods
                <input
                  className="input"
                  type="number"
                  required
                  min={2}
                  max={30}
                  value={meetings}
                  disabled={busy}
                  onChange={(event) => setMeetings(event.target.value)}
                />
              </label>
              {timingIssue ? (
                <label>
                  Minutes per period
                  <input
                    className="input"
                    type="number"
                    required
                    min={1}
                    max={1440}
                    value={manualPeriodMinutes}
                    disabled={busy}
                    onChange={(event) => setManualPeriodMinutes(event.target.value)}
                  />
                </label>
              ) : null}
            </div>
            <small>The plan stays a draft until you add it to your course.</small>
          </form>
        )}
      </div>
      <footer className="unit-planning-footer">
        {review && unit ? (
          <>
            <div className="unit-planning-footer-note" role="status">
              <strong>{adding ? 'Adding your unit…' : 'Your idea is a draft.'}</strong>
              <span>
                {overBudget
                  ? 'Shorten the lesson steps to fit the scheduled periods.'
                  : 'Edit anything above, then add it when you’re ready.'}
              </span>
            </div>
            <div className="unit-planning-actions unit-planning-decision-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => {
                  setDraft(null);
                  onClose();
                }}
              >
                Cancel idea
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy || saveFailed}
                onClick={() => setReview(false)}
              >
                Generate new idea
              </button>
              <button
                type="button"
                className="unit-planning-add"
                disabled={busy || !valid || saveFailed}
                onClick={onAdd}
              >
                {adding ? 'Adding unit…' : 'Add unit to timeline'}
              </button>
            </div>
          </>
        ) : (
          <>
            <span role="status">{generating ? 'Hobie is drafting your unit plan…' : ''}</span>
            <div className="unit-planning-actions">
              {draft ? (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setReview(true)}
                >
                  Return to current idea
                </button>
              ) : null}
              <button type="submit" form="unit-planning-form" disabled={busy}>
                {generating ? 'Creating plan…' : unit ? 'Generate new idea' : 'Create plan'}
              </button>
            </div>
          </>
        )}
      </footer>
    </dialog>
  );
}
