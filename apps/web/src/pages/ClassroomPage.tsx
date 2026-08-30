import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type {
  ClassroomResumeResponse,
  DashboardTodayResponse,
  GetScheduleResponse
} from '@teacheros/contracts';
import { ApiError, useApiClient } from '../lib/api.js';

const localDate = () => new Date().toISOString().slice(0, 10);
const timeRange = (start: string | null, end: string | null) =>
  start ? `${start} – ${end ?? 'end TBD'}` : 'Time TBD';

export function ClassroomPage() {
  const api = useApiClient();
  const [params, setParams] = useSearchParams();
  const [dashboard, setDashboard] = useState<DashboardTodayResponse | null>(null);
  const [schedule, setSchedule] = useState<GetScheduleResponse | null>(null);
  const [resume, setResume] = useState<ClassroomResumeResponse | null>(null);
  const [checks, setChecks] = useState<string[]>([]);
  const [ending, setEnding] = useState(false);
  const [note, setNote] = useState('');
  const [state, setState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const latest = useRef<{ checks: string[]; note: string } | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const requested = params.get('section');
  const detected = dashboard?.currentClass ?? dashboard?.nextClass ?? null;
  const sectionId = requested ?? detected?.sectionId ?? '';
  const selected = schedule?.sections.find((item) => item.sectionId === sectionId);
  const context = selected
    ? {
        sectionId: selected.sectionId,
        courseName: selected.courseName,
        sectionName: selected.sectionName,
        meetingTime: detected?.sectionId === selected.sectionId ? detected.meetingTime : null,
        endTime: detected?.sectionId === selected.sectionId ? detected.endTime : null
      }
    : detected;
  const lesson = resume?.lesson;
  const prior = resume?.state?.completedSegmentIds ?? [];
  const allChecked = [...new Set([...prior, ...checks])];
  const lastStop = lesson?.segments.find((step) => step.id === resume?.state?.stoppedAtSegmentId);
  useEffect(() => {
    void Promise.all([api.dashboardToday(), api.getSchedule()])
      .then(([today, sections]) => {
        setDashboard(today);
        setSchedule(sections);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not load Classroom.')
      );
  }, [api]);
  useEffect(() => {
    if (!sectionId) {
      setResume(null);
      return;
    }
    void api
      .getClassroomResume(sectionId)
      .then((value) => {
        setResume(value);
        setChecks([]);
        setNote(value.lastNote?.content ?? value.state?.carryOverNote ?? '');
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not load lesson progress.')
      );
  }, [api, sectionId]);
  const persist = (endClass = false) => {
    if (!lesson || !context) return;
    const current = latest.current ?? { checks, note };
    setState('saving');
    chain.current = chain.current.then(async () => {
      try {
        const response = await api.upsertClassMeeting({
          sectionId: context.sectionId,
          lessonId: lesson.id,
          meetingDate: localDate(),
          scheduledStartTime: context.meetingTime,
          scheduledEndTime: context.endTime,
          completedStepIds: current.checks,
          rawNote: current.note.trim() || null,
          endClass
        });
        setChecks(response.completedStepIds);
        setState('saved');
        if (endClass)
          setResume((previous) =>
            previous?.state
              ? {
                  ...previous,
                  state: {
                    ...previous.state,
                    completedSegmentIds: response.cumulativeCompletedStepIds,
                    status: response.lessonCompleted ? 'completed' : 'stopped_at_segment',
                    stoppedAtSegmentId: response.stoppedAfterStepId,
                    carryOverNote: response.rawNote,
                    lastTaughtDate: response.meetingDate
                  }
                }
              : previous
          );
      } catch {
        setState('error');
      }
    });
  };
  const queue = (nextChecks: string[], nextNote: string) => {
    latest.current = { checks: nextChecks, note: nextNote };
    setChecks(nextChecks);
    setNote(nextNote);
    setState('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => persist(), 500);
  };
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        persist();
      }
    },
    []
  );
  const changeSection = (id: string) => {
    const next = new URLSearchParams(params);
    id ? next.set('section', id) : next.delete('section');
    setParams(next);
  };
  const nextClass =
    dashboard?.nextClass && dashboard.nextClass.sectionId !== sectionId
      ? dashboard.nextClass
      : (dashboard?.todaySchedule.find(
          (item) => item.sectionId !== sectionId && !item.isInSession
        ) ?? null);
  return (
    <main className="classroom-today">
      <header className="classroom-live-header">
        <div>
          <p className="eyebrow">Classroom / Today</p>
          <h1>
            {context
              ? dashboard?.currentClass?.sectionId === context.sectionId
                ? 'Now'
                : 'Prepare class'
              : 'Next class'}
          </h1>
        </div>
        <select
          className="input classroom-switcher"
          value={sectionId}
          onChange={(e) => changeSection(e.target.value)}
        >
          <option value="">Choose class</option>
          {schedule?.sections.map((item) => (
            <option key={item.sectionId} value={item.sectionId}>
              {item.courseName} · {item.sectionName}
            </option>
          ))}
        </select>
      </header>
      {error ? <p className="notice warning">{error}</p> : null}
      {!context ? (
        <section className="live-empty">
          <h2>No class selected</h2>
          <p>Choose a scheduled section to prepare its live lesson.</p>
        </section>
      ) : (
        <>
          <section className="live-now">
            <p className="eyebrow">{context.courseName}</p>
            <h2>{context.sectionName}</h2>
            <p>{timeRange(context.meetingTime, context.endTime)}</p>
            {lesson ? (
              <>
                <strong>
                  Lesson {lesson.orderIndex + 1} · {lesson.title}
                </strong>
                <Link className="button-link" to={`/lessons/${lesson.id}`}>
                  Open full lesson
                </Link>
              </>
            ) : (
              <>
                <strong>No lesson planned</strong>
                <Link className="button-link" to={`/courses/${selected?.courseId ?? ''}`}>
                  Open Year Plan
                </Link>
              </>
            )}
          </section>
          {lesson ? (
            <>
              <section className="live-last">
                <p className="eyebrow">Last time</p>
                <strong>
                  {resume?.state?.lastTaughtDate ?? 'This is the first time teaching this lesson.'}
                </strong>
                {lastStop ? <p>Stopped after: {lastStop.title}</p> : null}
                {resume?.lastNote?.content ? (
                  <blockquote>{resume.lastNote.content}</blockquote>
                ) : null}
              </section>
              <section className="live-steps">
                <p className="eyebrow">Today</p>
                {lesson.segments.length ? (
                  lesson.segments.map((step) => (
                    <label key={step.id}>
                      <input
                        type="checkbox"
                        checked={allChecked.includes(step.id)}
                        onChange={(e) =>
                          queue(
                            e.target.checked
                              ? [...checks, step.id]
                              : checks.filter((id) => id !== step.id),
                            note
                          )
                        }
                        disabled={prior.includes(step.id)}
                      />
                      <span>
                        {prior.includes(step.id) ? '✓ Previously completed · ' : ''}
                        {step.title}
                      </span>
                    </label>
                  ))
                ) : (
                  <p>
                    No lesson steps yet. <Link to={`/lessons/${lesson.id}`}>Open lesson</Link>
                  </p>
                )}
              </section>
              <section className="live-note">
                <label>
                  Quick note
                  <input
                    className="input"
                    value={note}
                    placeholder="What happened today?"
                    onChange={(e) => queue(checks, e.target.value)}
                  />
                </label>
                <span className="autosave">
                  {state === 'saving' ? 'Saving…' : state === 'error' ? 'Saved locally' : 'Saved'}
                </span>
              </section>
              {ending ? (
                <section className="live-end-summary">
                  <p className="eyebrow">End class</p>
                  <p>
                    Completed today:{' '}
                    {checks.length
                      ? checks
                          .map((id) => lesson.segments.find((step) => step.id === id)?.title)
                          .filter(Boolean)
                          .join(', ')
                      : 'No new steps'}
                  </p>
                  <p>
                    Not completed:{' '}
                    {lesson.segments
                      .filter((step) => !allChecked.includes(step.id))
                      .map((step) => step.title)
                      .join(', ') || 'None'}
                  </p>
                  <div>
                    <button className="live-end" type="button" onClick={() => persist(true)}>
                      Save and end
                    </button>
                    <button className="button-link" type="button" onClick={() => setEnding(false)}>
                      Cancel
                    </button>
                  </div>
                </section>
              ) : (
                <button className="live-end" type="button" onClick={() => setEnding(true)}>
                  End class
                </button>
              )}
            </>
          ) : null}
        </>
      )}
      {nextClass ? (
        <section className="live-next">
          <p className="eyebrow">Next</p>
          <strong>
            {nextClass.courseName} · {nextClass.sectionName}
          </strong>
          <span>{nextClass.meetingTime ?? 'Time TBD'}</span>
        </section>
      ) : null}
    </main>
  );
}
