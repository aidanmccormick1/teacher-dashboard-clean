import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type {
  ClassroomResumeResponse,
  CourseDetailResponse,
  DashboardTodayResponse,
  GetScheduleResponse
} from '@teacheros/contracts';
import { ApiError, useApiClient } from '../lib/api.js';
import { timeRange } from '../lib/today.js';

export function ClassroomPage() {
  const api = useApiClient();
  const [params, setParams] = useSearchParams();
  const [dashboard, setDashboard] = useState<DashboardTodayResponse | null>(null);
  const [schedule, setSchedule] = useState<GetScheduleResponse | null>(null);
  const [resume, setResume] = useState<ClassroomResumeResponse | null>(null);
  const [course, setCourse] = useState<CourseDetailResponse['course'] | null>(null);
  const [checks, setChecks] = useState<string[]>([]);
  const [historicalChecks, setHistoricalChecks] = useState<string[]>([]);
  const [ending, setEnding] = useState(false);
  const [endedSummary, setEndedSummary] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [state, setState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const latest = useRef<{ checks: string[]; note: string; version: number } | null>(null);
  const draftVersion = useRef(0);
  const meetingRevision = useRef<number | null>(null);
  const persistRef = useRef<(endClass?: boolean) => void>(() => undefined);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const requested = params.get('section');
  const requestedMeetingTime = params.get('meetingTime');
  const requestedLessonId = params.get('lesson');
  const manual = params.get('manual') === '1';
  const detected = dashboard?.currentClass ?? dashboard?.nextClass ?? null;
  const sectionId = requested ?? detected?.sectionId ?? '';
  const selected = schedule?.sections.find((item) => item.sectionId === sectionId);
  const sectionTodayMeetings =
    dashboard?.todaySchedule.filter((item) => item.sectionId === sectionId) ?? [];
  const requestedTodayMeeting = requestedMeetingTime
    ? (sectionTodayMeetings.find((item) => item.meetingTime === requestedMeetingTime) ?? null)
    : null;
  const selectedTodayMeeting =
    requestedTodayMeeting ??
    (detected?.sectionId === sectionId ? detected : null) ??
    (sectionTodayMeetings.length === 1 ? sectionTodayMeetings[0] : null) ??
    null;
  const requiresMeetingChoice = Boolean(
    !manual && selected && sectionTodayMeetings.length > 1 && !selectedTodayMeeting
  );
  const context =
    selected && !requiresMeetingChoice
      ? {
          sectionId: selected.sectionId,
          courseName: selected.courseName,
          sectionName: selected.sectionName,
          // Dashboard's schedule projection is authoritative. A manually
          // selected class gets its actual scheduled occurrence too, rather
          // than falling back to a date-only meeting identity.
          meetingTime: manual ? null : (selectedTodayMeeting?.meetingTime ?? null),
          endTime: manual ? null : (selectedTodayMeeting?.endTime ?? null)
        }
      : detected;
  const requestedLesson = course?.units
    .flatMap((unit) => unit.lessons)
    .find((item) => item.id === requestedLessonId);
  const lesson = requestedLesson ?? resume?.lesson;
  const selectedUnit = course?.units.find((unit) =>
    unit.lessons.some((item) => item.id === lesson?.id)
  );
  // Current occurrence edits must remain reversible. Only earlier meeting
  // history is locked; checks saved for this live occurrence can be unchecked.
  const prior = historicalChecks;
  const allChecked = [...new Set([...prior, ...checks])];
  const lastStop = lesson?.segments.find((step) => step.id === resume?.state?.stoppedAtSegmentId);
  const draftStorageKey =
    context && dashboard && lesson
      ? `teacheros_classroom_draft_${context.sectionId}_${dashboard.date}_${lesson.id}_${context.meetingTime ?? 'legacy'}`
      : null;
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
        setHistoricalChecks([]);
        meetingRevision.current = null;
        setNote(value.lastNote?.content ?? value.state?.carryOverNote ?? '');
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not load lesson progress.')
      );
  }, [api, sectionId]);
  useEffect(() => {
    if (!selected?.courseId) {
      setCourse(null);
      return;
    }
    void api
      .getCourseDetail(selected.courseId)
      .then((detail) => setCourse(detail.course))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not load curriculum.')
      );
  }, [api, selected?.courseId]);
  useEffect(() => {
    if (!lesson || !context || !dashboard) return;
    let cancelled = false;
    void api
      .getClassMeeting(context.sectionId, {
        lessonId: lesson.id,
        meetingDate: dashboard.date,
        scheduledStartTime: context.meetingTime,
        origin: manual ? 'manual' : 'scheduled'
      })
      .then((value) => {
        if (cancelled) return;
        const currentChecks = value.meeting?.completedStepIds ?? [];
        setHistoricalChecks(value.historicalCompletedStepIds);
        setChecks(currentChecks);
        meetingRevision.current = value.meeting?.revision ?? null;
        const nextNote =
          value.meeting?.rawNote !== null && value.meeting?.rawNote !== undefined
            ? value.meeting.rawNote
            : (resume?.lastNote?.content ?? resume?.state?.carryOverNote ?? '');
        setNote(nextNote);
        const localDraft = draftStorageKey ? window.localStorage.getItem(draftStorageKey) : null;
        const restored = localDraft
          ? (JSON.parse(localDraft) as { checks: string[]; note: string })
          : null;
        setChecks(restored?.checks ?? currentChecks);
        setNote(restored?.note ?? nextNote);
        latest.current = {
          checks: restored?.checks ?? currentChecks,
          note: restored?.note ?? nextNote,
          version: draftVersion.current
        };
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof ApiError ? err.message : 'Could not load this class meeting.');
      });
    return () => {
      cancelled = true;
    };
  }, [
    api,
    context?.meetingTime,
    context?.sectionId,
    dashboard?.date,
    lesson?.id,
    manual,
    resume?.lastNote?.content,
    resume?.state?.carryOverNote,
    draftStorageKey
  ]);
  const persist = (endClass = false) => {
    if (!lesson || !context || !dashboard) return;
    const current = latest.current ?? { checks, note, version: draftVersion.current };
    setState('saving');
    chain.current = chain.current.then(async () => {
      try {
        const response = await api.upsertClassMeeting({
          sectionId: context.sectionId,
          lessonId: lesson.id,
          meetingDate: dashboard.date,
          scheduledStartTime: context.meetingTime,
          scheduledEndTime: context.endTime,
          origin: manual ? 'manual' : 'scheduled',
          completedStepIds: current.checks,
          // Preserve exact teacher text, including intentional whitespace and
          // an empty string. Null is the only explicit clear operation.
          rawNote: current.note,
          endClass,
          expectedRevision: meetingRevision.current
        });
        const isLatestSnapshot = latest.current?.version === current.version;
        if (isLatestSnapshot) setChecks(response.completedStepIds);
        meetingRevision.current = response.revision;
        // A request can finish after a later keystroke was queued. Keep that
        // newer local draft until its own snapshot has reached the server.
        if (draftStorageKey && isLatestSnapshot) window.localStorage.removeItem(draftStorageKey);
        if (isLatestSnapshot) setState('saved');
        if (endClass) {
          setResume((previous) =>
            previous?.state
              ? {
                  ...previous,
                  state: {
                    ...previous.state,
                    completedSegmentIds: response.cumulativeCompletedStepIds,
                    status: response.lessonCompleted ? 'completed' : 'stopped_at_segment',
                    stoppedAtSegmentId: response.stoppingPointStepId,
                    carryOverNote: response.rawNote,
                    lastTaughtDate: response.meetingDate
                  }
                }
              : previous
          );
          setEndedSummary(
            response.lessonCompleted
              ? 'Class saved. This lesson is complete; the next meeting will continue with the next available lesson.'
              : `Class saved. Next time, continue at ${
                  lesson.segments.find((step) => step.id === response.stoppingPointStepId)?.title ??
                  'the next open step'
                }.`
          );
          setEnding(false);
        }
      } catch (err) {
        setState('error');
        if (err instanceof ApiError && err.status === 409) {
          // Keep a recoverable local copy, then re-read the canonical version
          // and its revision. We never overwrite a different session blindly.
          try {
            window.sessionStorage.setItem(
              `teacheros_class_meeting_conflict_${context.sectionId}_${dashboard.date}_${lesson.id}`,
              JSON.stringify(current)
            );
            const remote = await api.getClassMeeting(context.sectionId, {
              lessonId: lesson.id,
              meetingDate: dashboard.date,
              scheduledStartTime: context.meetingTime,
              origin: manual ? 'manual' : 'scheduled'
            });
            const remoteChecks = remote.meeting?.completedStepIds ?? [];
            const remoteNote = remote.meeting?.rawNote ?? '';
            meetingRevision.current = remote.meeting?.revision ?? null;
            setHistoricalChecks(remote.historicalCompletedStepIds);
            setChecks(remoteChecks);
            setNote(remoteNote);
            latest.current = {
              checks: remoteChecks,
              note: remoteNote,
              version: draftVersion.current
            };
            setError(
              'This class changed elsewhere. The saved version was refreshed; your local draft is retained for recovery.'
            );
          } catch {
            setError(
              'This class changed elsewhere. Your local edits are still in this browser; refresh before saving again.'
            );
          }
        } else {
          setError(err instanceof ApiError ? err.message : 'Could not save this class meeting.');
        }
      }
    });
  };
  persistRef.current = persist;
  const queue = (nextChecks: string[], nextNote: string) => {
    draftVersion.current += 1;
    latest.current = { checks: nextChecks, note: nextNote, version: draftVersion.current };
    if (draftStorageKey)
      window.localStorage.setItem(
        draftStorageKey,
        JSON.stringify({ checks: nextChecks, note: nextNote })
      );
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
        persistRef.current();
      }
    },
    []
  );
  const changeSection = (id: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set('section', id);
    else next.delete('section');
    next.delete('meetingTime');
    next.delete('lesson');
    next.delete('manual');
    setParams(next);
  };
  const changeMeetingTime = (meetingTime: string) => {
    const next = new URLSearchParams(params);
    if (meetingTime) next.set('meetingTime', meetingTime);
    else next.delete('meetingTime');
    setParams(next);
  };
  const changeLesson = (lessonId: string) => {
    const next = new URLSearchParams(params);
    if (lessonId) next.set('lesson', lessonId);
    else next.delete('lesson');
    setParams(next);
  };
  const changeUnit = (unitId: string) => {
    const unit = course?.units.find((item) => item.id === unitId);
    if (!unit) return;
    const progress = new Map(resume?.progress.map((item) => [item.lessonId, item.status]));
    const nextLesson =
      unit.lessons.find(
        (item) => !['completed', 'skipped'].includes(progress.get(item.id) ?? 'not_started')
      ) ?? unit.lessons[0];
    if (nextLesson) changeLesson(nextLesson.id);
  };
  const nextClass =
    dashboard?.nextClass && dashboard.nextClass.sectionId !== sectionId
      ? dashboard.nextClass
      : (dashboard?.todaySchedule.find(
          (item) => item.sectionId !== sectionId && item.status === 'upcoming'
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
        {!manual && selected && sectionTodayMeetings.length > 1 ? (
          <select
            aria-label="Choose meeting time"
            className="input classroom-switcher"
            value={selectedTodayMeeting?.meetingTime ?? ''}
            onChange={(e) => changeMeetingTime(e.target.value)}
          >
            <option value="">Choose meeting time</option>
            {sectionTodayMeetings.map((meeting) => (
              <option
                key={`${meeting.sectionId}-${meeting.meetingTime ?? 'unscheduled'}`}
                value={meeting.meetingTime ?? ''}
              >
                {timeRange(meeting.meetingTime, meeting.endTime)}
              </option>
            ))}
          </select>
        ) : null}
      </header>
      {error ? <p className="notice warning">{error}</p> : null}
      {context && course ? (
        <section className="classroom-curriculum-picker" aria-label="Curriculum position">
          <strong>
            {course.name} · {context.sectionName}
          </strong>
          <label>
            <span>Unit</span>
            <select
              className="input"
              value={selectedUnit?.id ?? ''}
              onChange={(event) => changeUnit(event.target.value)}
            >
              {course.units.map((unit, index) => (
                <option key={unit.id} value={unit.id}>
                  Unit {index + 1}: {unit.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Lesson</span>
            <select
              className="input"
              value={lesson?.id ?? ''}
              onChange={(event) => changeLesson(event.target.value)}
            >
              {selectedUnit?.lessons.map((item, index) => {
                const status = resume?.progress.find(
                  (progress) => progress.lessonId === item.id
                )?.status;
                const marker =
                  status === 'completed' ? '✓' : item.id === resume?.lesson?.id ? '●' : '○';
                return (
                  <option key={item.id} value={item.id}>
                    {marker} Lesson {index + 1}: {item.title}
                  </option>
                );
              })}
            </select>
          </label>
        </section>
      ) : null}
      {requiresMeetingChoice ? (
        <section className="live-empty">
          <h2>Choose the class period</h2>
          <p>
            This section has multiple meetings today. Choose its meeting time before changing lesson
            progress.
          </p>
        </section>
      ) : null}
      {!context ? (
        !requiresMeetingChoice ? (
          <section className="live-empty">
            <h2>No class selected</h2>
            <p>Choose a scheduled section to prepare its live lesson.</p>
          </section>
        ) : null
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
                <Link
                  className="button-link"
                  to={`/year-plan?course=${encodeURIComponent(selected?.courseId ?? '')}&section=${encodeURIComponent(context.sectionId)}`}
                >
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
                  <textarea
                    className="input"
                    rows={3}
                    value={note}
                    placeholder="What happened today?"
                    onChange={(e) => queue(checks, e.target.value)}
                  />
                </label>
                <span className="autosave" aria-live="polite">
                  {state === 'saving' ? 'Saving…' : state === 'error' ? 'Saved locally' : 'Saved'}
                </span>
              </section>
              <div className="profile-actions">
                <button
                  className="secondary"
                  type="button"
                  onClick={() =>
                    queue(
                      lesson.segments
                        .filter((step) => !prior.includes(step.id))
                        .map((step) => step.id),
                      note
                    )
                  }
                >
                  Mark lesson complete
                </button>
                <button className="secondary" type="button" onClick={() => setEnding(true)}>
                  Stop here
                </button>
              </div>
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
              {endedSummary ? <p className="notice success">{endedSummary}</p> : null}
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
          <span>{timeRange(nextClass.meetingTime, nextClass.endTime)}</span>
        </section>
      ) : null}
    </main>
  );
}
