import { useId, useRef, useState, type CSSProperties } from 'react';
import type { GenerateUnitDraftResponse } from '@teacheros/contracts';
import { distributeUnitPeriods } from '../lib/unit-plan-layout.js';

type Unit = GenerateUnitDraftResponse['unit'];
type Lesson = Unit['lessons'][number];

export function UnitPlanReview({
  unit,
  busy,
  startMeeting,
  previousUnitTitle,
  meetingDates,
  periodMinutes,
  onUpdate
}: {
  unit: Unit;
  busy: boolean;
  startMeeting: number;
  previousUnitTitle?: string;
  meetingDates: string[];
  periodMinutes: number[];
  onUpdate: (unit: Unit) => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const editorId = useId();
  const editor = useRef<HTMLElement>(null);
  const selectLesson = (nextIndex: number) => {
    setSelectedIndex(nextIndex);
    editor.current?.focus({ preventScroll: true });
    editor.current?.scrollIntoView({
      block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    });
  };
  const index = Math.min(selectedIndex, Math.max(0, unit.lessons.length - 1));
  const lesson = unit.lessons[index];
  const ranges = distributeUnitPeriods(startMeeting, unit.meetingCount, unit.lessons.length);
  const updateLesson = (patch: Partial<Lesson>) =>
    onUpdate({
      ...unit,
      lessons: unit.lessons.map((item, i) =>
        i === index
          ? {
              ...item,
              ...patch,
              ...(patch.steps
                ? {
                    estimatedDurationMinutes: patch.steps.reduce(
                      (sum, step) => sum + step.durationMinutes,
                      0
                    )
                  }
                : {})
            }
          : item
      )
    });
  const moveLesson = (offset: number) => {
    const lessons = [...unit.lessons];
    const [moving] = lessons.splice(index, 1);
    if (!moving) return;
    lessons.splice(index + offset, 0, moving);
    onUpdate({ ...unit, lessons });
    setSelectedIndex(index + offset);
  };
  const selectedRange = ranges[index];
  const budget =
    selectedRange &&
    periodMinutes
      .slice(
        selectedRange.start - startMeeting,
        selectedRange.start - startMeeting + selectedRange.span
      )
      .reduce((sum, minutes) => sum + minutes, 0);
  const totalMinutes = unit.lessons.reduce((sum, item) => sum + item.estimatedDurationMinutes, 0);
  const timelineStyle = { '--plan-period-count': unit.meetingCount } as CSSProperties;

  return (
    <div className="unit-plan-review-content">
      <section className="unit-plan-overview" aria-label="Unit overview">
        <label className="unit-plan-title-label">
          <span>Unit title</span>
          <input
            className="unit-plan-title-input"
            value={unit.title}
            disabled={busy}
            onChange={(event) => onUpdate({ ...unit, title: event.target.value })}
          />
        </label>
        <label className="unit-plan-description-label">
          <span>Unit overview</span>
          <textarea
            className="input"
            rows={2}
            value={unit.description}
            disabled={busy}
            onChange={(event) => onUpdate({ ...unit, description: event.target.value })}
          />
        </label>
        <p className="unit-plan-summary">
          {unit.lessons.length} lessons · {unit.meetingCount} class periods · {totalMinutes} planned
          minutes
        </p>
      </section>

      <section className="unit-plan-timeline" aria-labelledby="unit-plan-timeline-heading">
        <div className="unit-plan-section-heading">
          <h2 id="unit-plan-timeline-heading">On your timeline</h2>
          <p>
            {previousUnitTitle ? `After ${previousUnitTitle}` : 'At the start of your course'} ·
            Starts at period {startMeeting + 1}
          </p>
        </div>
        <div
          className="unit-plan-timeline-scroll"
          tabIndex={0}
          aria-label="Timeline preview; scroll to see all periods"
        >
          <div className="unit-plan-timeline-grid" style={timelineStyle}>
            {Array.from({ length: unit.meetingCount }, (_, i) => (
              <div
                className="unit-plan-period-label"
                key={i}
                style={{ gridColumn: i + 1, gridRow: 1 }}
              >
                <strong>Period {startMeeting + i + 1}</strong>
                {meetingDates[i] ? (
                  <span>
                    {new Date(`${meetingDates[i]}T12:00:00`).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric'
                    })}
                  </span>
                ) : null}
                {periodMinutes[i] ? <span>{periodMinutes[i]} min</span> : null}
              </div>
            ))}
            <div className="unit-plan-unit-bar" style={{ gridColumn: '1 / -1', gridRow: 2 }}>
              <span>Unit</span>
              <strong>{unit.title || 'Untitled unit'}</strong>
            </div>
            {unit.lessons.map((item, i) => {
              const range = ranges[i]!;
              return (
                <button
                  type="button"
                  key={i}
                  className="unit-plan-lesson-bar"
                  style={{
                    gridColumn: `${range.start - startMeeting + 1} / span ${range.span}`,
                    gridRow: 3
                  }}
                  aria-pressed={index === i}
                  aria-controls={editorId}
                  disabled={busy}
                  onClick={() => selectLesson(i)}
                >
                  <span>Lesson {i + 1}</span>
                  <strong>{item.title || 'Untitled lesson'}</strong>
                  <span>{item.estimatedDurationMinutes} min</span>
                </button>
              );
            })}
          </div>
        </div>
        <p className="unit-plan-timeline-help">
          Choose a lesson to edit. Changes appear in this preview as you make them.
        </p>
      </section>

      <div className="unit-plan-detail-layout">
        <nav className="unit-plan-outline" aria-label="Lessons in this unit">
          <h2>Unit & lessons</h2>
          <p className="unit-plan-outline-unit">{unit.title || 'Untitled unit'}</p>
          <ol>
            {unit.lessons.map((item, i) => (
              <li key={i}>
                <button
                  type="button"
                  disabled={busy}
                  aria-current={index === i ? 'true' : undefined}
                  aria-controls={editorId}
                  onClick={() => selectLesson(i)}
                >
                  <span className="unit-plan-outline-number">{i + 1}</span>
                  <span>
                    <strong>{item.title || 'Untitled lesson'}</strong>
                    <small>
                      {item.estimatedDurationMinutes} min · {item.steps.length}{' '}
                      {item.steps.length === 1 ? 'step' : 'steps'}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {!unit.lessons.length ? <p>No lessons in this idea. Generate a new idea below.</p> : null}
        </nav>

        <section
          ref={editor}
          tabIndex={-1}
          id={editorId}
          className="unit-plan-lesson-editor"
          aria-label="Edit selected lesson"
        >
          {lesson ? (
            <>
              <div className="unit-plan-section-heading">
                <h2>Lesson {index + 1}</h2>
                <span>
                  {selectedRange?.span === 1
                    ? `Period ${selectedRange.start + 1}`
                    : `Periods ${selectedRange!.start + 1}–${selectedRange!.start + selectedRange!.span}`}{' '}
                  · {lesson.estimatedDurationMinutes} min
                </span>
              </div>
              <div className="unit-planning-fields">
                <label>
                  Lesson title
                  <input
                    className="input"
                    value={lesson.title}
                    disabled={busy}
                    onChange={(event) => updateLesson({ title: event.target.value })}
                  />
                </label>
                <label>
                  Lesson overview
                  <textarea
                    className="input"
                    rows={3}
                    value={lesson.description}
                    disabled={busy}
                    onChange={(event) => updateLesson({ description: event.target.value })}
                  />
                </label>
                <div className="unit-plan-lesson-pair">
                  <label>
                    Learning objective
                    <textarea
                      className="input"
                      rows={3}
                      value={lesson.objective ?? ''}
                      disabled={busy}
                      onChange={(event) => updateLesson({ objective: event.target.value })}
                    />
                  </label>
                  <label>
                    Materials
                    <textarea
                      className="input"
                      rows={3}
                      value={lesson.materials ?? ''}
                      disabled={busy}
                      onChange={(event) => updateLesson({ materials: event.target.value })}
                    />
                  </label>
                </div>
                <h3>Lesson steps</h3>
                {lesson.steps.map((step, stepIndex) => {
                  const editStep = (patch: Partial<typeof step>) =>
                    updateLesson({
                      steps: lesson.steps.map((item, i) =>
                        i === stepIndex ? { ...item, ...patch } : item
                      )
                    });
                  return (
                    <details className="unit-planning-step" key={`${index}-${stepIndex}`}>
                      <summary>
                        <span>
                          {stepIndex + 1}. {step.title || 'Untitled step'}
                        </span>
                        <span>{step.durationMinutes} min</span>
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
                            rows={3}
                            value={step.description}
                            disabled={busy}
                            onChange={(event) => editStep({ description: event.target.value })}
                          />
                        </label>
                        <div className="unit-plan-step-actions">
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
                            className="secondary"
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              updateLesson({
                                steps: lesson.steps.filter((_, i) => i !== stepIndex)
                              })
                            }
                          >
                            Remove step
                          </button>
                        </div>
                      </div>
                    </details>
                  );
                })}
                {!lesson.steps.length ? <p>Add a step to finish this lesson.</p> : null}
                <button
                  className="secondary unit-plan-add-step"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    updateLesson({
                      steps: [
                        ...lesson.steps,
                        { title: 'New step', description: '', durationMinutes: 1 }
                      ]
                    })
                  }
                >
                  Add step
                </button>
                {budget && lesson.estimatedDurationMinutes > budget ? (
                  <p role="alert" className="notice warning">
                    This lesson has {lesson.estimatedDurationMinutes} minutes of steps for {budget}{' '}
                    scheduled minutes. Shorten its steps to fit the timeline.
                  </p>
                ) : null}
                <div className="unit-plan-lesson-actions">
                  <div className="unit-planning-actions">
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy || index === 0}
                      onClick={() => moveLesson(-1)}
                    >
                      Move up
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy || index === unit.lessons.length - 1}
                      onClick={() => moveLesson(1)}
                    >
                      Move down
                    </button>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      onUpdate({ ...unit, lessons: unit.lessons.filter((_, i) => i !== index) })
                    }
                  >
                    Remove lesson
                  </button>
                </div>
              </div>
            </>
          ) : (
            <p>Select a lesson from the unit outline to edit it.</p>
          )}
        </section>
      </div>
    </div>
  );
}
