import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { GenerateUnitDraftResponse } from '@teacheros/contracts';
import './UnitPlanningWorkspace.css';

type Draft = GenerateUnitDraftResponse;
type Lesson = Draft['unit']['lessons'][number];

export function UnitPlanningWorkspace({
  courseName,
  groupName,
  goal,
  meetings,
  minutes,
  setGoal,
  setMeetings,
  setMinutes,
  draft,
  setDraft,
  generating,
  adding,
  error,
  saveFailed,
  onGenerate,
  onAdd,
  onClose
}: {
  courseName: string;
  groupName?: string;
  goal: string;
  meetings: string;
  minutes: string;
  setGoal: (value: string) => void;
  setMeetings: (value: string) => void;
  setMinutes: (value: string) => void;
  draft: Draft | null;
  setDraft: Dispatch<SetStateAction<Draft | null>>;
  generating: boolean;
  adding: boolean;
  error: string | null;
  saveFailed: boolean;
  onGenerate: () => Promise<boolean>;
  onAdd: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [review, setReview] = useState(Boolean(draft));
  const busy = generating || adding;
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  useEffect(() => {
    heading.current?.focus();
  }, [review]);

  const updateUnit = (patch: Partial<Draft['unit']>) =>
    setDraft((current) => (current ? { unit: { ...current.unit, ...patch } } : current));
  const updateLesson = (index: number, patch: Partial<Lesson>) =>
    updateUnit({
      lessons: draft!.unit.lessons.map((lesson, i) =>
        i === index ? { ...lesson, ...patch } : lesson
      )
    });
  const moveLesson = (index: number, offset: number) => {
    const lessons = [...draft!.unit.lessons];
    const [lesson] = lessons.splice(index, 1);
    if (!lesson) return;
    lessons.splice(index + offset, 0, lesson);
    updateUnit({ lessons });
  };
  const unit = draft?.unit;
  const plannedMinutes = unit?.lessons.reduce(
    (sum, lesson) => sum + lesson.estimatedDurationMinutes,
    0
  );
  const valid = Boolean(
    unit?.title.trim() &&
    unit.lessons.length &&
    unit.lessons.every(
      (lesson) =>
        lesson.title.trim() &&
        lesson.steps.every(
          (step) =>
            step.title.trim() && Number.isInteger(step.durationMinutes) && step.durationMinutes > 0
        )
    )
  );

  return (
    <dialog
      ref={dialog}
      className="unit-planning-dialog"
      aria-labelledby="unit-planning-heading"
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
            {review ? 'Review your plan' : 'Plan a unit'}
          </h1>
        </div>
        <button type="button" className="secondary" disabled={busy} onClick={onClose}>
          Close
        </button>
      </header>
      <div className="unit-planning-body">
        {error ? (
          <p role="alert" className="notice warning">
            {error}
          </p>
        ) : null}
        {review && unit ? (
          <div className="unit-planning-review">
            <aside className="unit-planning-fields">
              <label>
                Unit title
                <input
                  className="input"
                  value={unit.title}
                  disabled={busy}
                  onChange={(event) => updateUnit({ title: event.target.value })}
                />
              </label>
              <label>
                Unit description
                <textarea
                  className="input"
                  rows={5}
                  value={unit.description}
                  disabled={busy}
                  onChange={(event) => updateUnit({ description: event.target.value })}
                />
              </label>
              <p>
                {unit.lessons.length} lessons · {unit.meetingCount} class meetings ·{' '}
                {plannedMinutes} planned minutes
              </p>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setReview(false)}
              >
                Back to learning goal
              </button>
            </aside>
            <section aria-label="Generated lessons" className="unit-planning-fields">
              <h2>Edit lessons</h2>
              {unit.lessons.map((lesson, index) => (
                <details key={index} className="unit-planning-lesson">
                  <summary>
                    <strong>
                      {index + 1}. {lesson.title || 'Untitled lesson'}
                    </strong>
                    <span>
                      {lesson.estimatedDurationMinutes} min · {lesson.steps.length} steps
                    </span>
                  </summary>
                  <div className="unit-planning-fields unit-planning-lesson-body">
                    <label>
                      Lesson title
                      <input
                        className="input"
                        disabled={busy}
                        value={lesson.title}
                        onChange={(event) => updateLesson(index, { title: event.target.value })}
                      />
                    </label>
                    <label>
                      Lesson description
                      <textarea
                        className="input"
                        rows={3}
                        disabled={busy}
                        value={lesson.description}
                        onChange={(event) =>
                          updateLesson(index, { description: event.target.value })
                        }
                      />
                    </label>
                    {lesson.objective ? (
                      <p>
                        <strong>Learning objective</strong>
                        <br />
                        {lesson.objective}
                      </p>
                    ) : null}
                    {lesson.materials ? (
                      <p>
                        <strong>Materials</strong>
                        <br />
                        {lesson.materials}
                      </p>
                    ) : null}
                    {lesson.steps.map((step, stepIndex) => {
                      const editStep = (patch: Partial<typeof step>) =>
                        updateLesson(index, {
                          steps: lesson.steps.map((item, i) =>
                            i === stepIndex ? { ...item, ...patch } : item
                          )
                        });
                      return (
                        <details key={stepIndex} className="unit-planning-step">
                          <summary>
                            {stepIndex + 1}. {step.title} · {step.durationMinutes} min
                            {step.stepType ? ` · ${step.stepType}` : ''}
                          </summary>
                          <div className="unit-planning-fields unit-planning-lesson-body">
                            <label>
                              Step title
                              <input
                                className="input"
                                value={step.title}
                                disabled={busy}
                                onChange={(event) => editStep({ title: event.target.value })}
                              />
                            </label>
                            <label>
                              Step description
                              <textarea
                                className="input"
                                rows={2}
                                value={step.description}
                                disabled={busy}
                                onChange={(event) => editStep({ description: event.target.value })}
                              />
                            </label>
                            <label>
                              Minutes
                              <input
                                className="input unit-planning-number"
                                type="number"
                                min={1}
                                value={step.durationMinutes || ''}
                                disabled={busy}
                                onChange={(event) =>
                                  editStep({ durationMinutes: Number(event.target.value) })
                                }
                              />
                            </label>
                            <button
                              type="button"
                              className="secondary"
                              disabled={busy}
                              onClick={() =>
                                updateLesson(index, {
                                  steps: lesson.steps.filter((_, i) => i !== stepIndex)
                                })
                              }
                            >
                              Remove step
                            </button>
                          </div>
                        </details>
                      );
                    })}
                    <div className="unit-planning-actions">
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy || index === 0}
                        onClick={() => moveLesson(index, -1)}
                      >
                        Move lesson up
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy || index === unit.lessons.length - 1}
                        onClick={() => moveLesson(index, 1)}
                      >
                        Move lesson down
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          updateUnit({ lessons: unit.lessons.filter((_, i) => i !== index) })
                        }
                      >
                        Remove lesson
                      </button>
                    </div>
                  </div>
                </details>
              ))}
              {!unit.lessons.length ? (
                <p>Add a new plan from the learning goal to include lessons.</p>
              ) : null}
            </section>
          </div>
        ) : (
          <form
            id="unit-planning-form"
            className="unit-planning-fields unit-planning-setup"
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy || (draft && !window.confirm('Replace the current draft with a new plan?')))
                return;
              if (await onGenerate()) setReview(true);
            }}
          >
            <p>
              {groupName
                ? 'Use the class duration as a planning estimate. Adjust it as needed.'
                : 'Plan the sequence of meetings without assigning calendar dates.'}
            </p>
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
                Class meetings
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
              <label>
                Minutes per meeting
                <input
                  className="input"
                  type="number"
                  required
                  min={10}
                  max={240}
                  value={minutes}
                  disabled={busy}
                  onChange={(event) => setMinutes(event.target.value)}
                />
              </label>
            </div>
            <small>The plan stays a draft until you add it to your course.</small>
          </form>
        )}
      </div>
      <footer className="unit-planning-footer">
        {review && unit ? (
          <>
            <p>
              Adding {unit.lessons.length} {unit.lessons.length === 1 ? 'lesson' : 'lessons'} to{' '}
              <strong>{courseName}</strong>. Course collaborators can see the unit. Class Groups
              keep their own dates.
            </p>
            <button type="button" disabled={busy || !valid || saveFailed} onClick={onAdd}>
              {adding ? 'Adding unit…' : 'Add unit to course'}
            </button>
          </>
        ) : (
          <>
            <span role="status">{generating ? 'Preparing your unit plan…' : ''}</span>
            <div className="unit-planning-actions">
              {draft ? (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setReview(true)}
                >
                  Return to review
                </button>
              ) : null}
              <button type="submit" form="unit-planning-form" disabled={busy}>
                {generating ? 'Creating plan…' : 'Create plan'}
              </button>
            </div>
          </>
        )}
      </footer>
    </dialog>
  );
}
