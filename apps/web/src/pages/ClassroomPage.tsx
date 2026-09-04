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

function safeHtml(value: string | null) {
  const doc = new DOMParser().parseFromString(value ?? '', 'text/html');
  for (const node of Array.from(doc.body.querySelectorAll('*'))) {
    if (
      !['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'A'].includes(
        node.tagName
      )
    ) {
      node.replaceWith(...Array.from(node.childNodes));
    } else {
      for (const attribute of Array.from(node.attributes)) {
        if (node.tagName !== 'A' || attribute.name !== 'href' || !/^https?:/i.test(attribute.value))
          node.removeAttribute(attribute.name);
      }
    }
  }
  return doc.body.innerHTML;
}

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
  const contextSectionId = context?.sectionId;
  const contextMeetingTime = context?.meetingTime ?? null;
  const dashboardDate = dashboard?.date;
  const lessonId = lesson?.id;
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
    if (!lessonId || !contextSectionId || !dashboardDate) return;
    let cancelled = false;
    void api
      .getClassMeeting(contextSectionId, {
        lessonId,
        meetingDate: dashboardDate,
        scheduledStartTime: contextMeetingTime,
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
    contextMeetingTime,
    contextSectionId,
    dashboardDate,
    lessonId,
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
  const completeLessonAndMoveOn = () => {
    if (!lesson) return;
    const nextChecks = lesson.segments
      .filter((step) => !prior.includes(step.id))
      .map((step) => step.id);
    if (timer.current) clearTimeout(timer.current);
    draftVersion.current += 1;
    latest.current = { checks: nextChecks, note, version: draftVersion.current };
    if (draftStorageKey)
      window.localStorage.setItem(draftStorageKey, JSON.stringify({ checks: nextChecks, note }));
    setChecks(nextChecks);
    persist(true);
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
            {lesson ? (
              <>
                <h2>{lesson.title}</h2>
                <div className="live-now-meta">
                  <span>{context.sectionName}</span>
                  <span>{timeRange(context.meetingTime, context.endTime)}</span>
                  {lesson.estimatedDurationMinutes ? (
                    <span>{lesson.estimatedDurationMinutes} min</span>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <h2>{context.sectionName}</h2>
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
              <div className="classroom-teaching-grid">
                <section className="live-steps" aria-labelledby="lesson-steps-heading">
                  <div className="live-section-heading">
                    <div>
                      <p className="eyebrow">Lesson flow</p>
                      <h3 id="lesson-steps-heading">Teach from the plan</h3>
                    </div>
                    <span
                      className="live-progress"
                      aria-label={`${allChecked.length} of ${lesson.segments.length} steps complete`}
                    >
                      {allChecked.length}/{lesson.segments.length}
                    </span>
                  </div>
                  {lesson.segments.length ? (
                    <div className="live-step-list">
                      {lesson.segments.map((step, index) => {
                        const complete = allChecked.includes(step.id);
                        return (
                          <article
                            className={`live-step-card${complete ? ' is-complete' : ''}`}
                            key={step.id}
                          >
                            <label className="live-step-check">
                              <input
                                type="checkbox"
                                checked={complete}
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
                              <span className="live-step-number">{index + 1}</span>
                            </label>
                            <div className="live-step-content">
                              <div className="live-step-title-row">
                                <h4>{step.title}</h4>
                                <span>
                                  {[
                                    step.stepType,
                                    step.durationMinutes ? `${step.durationMinutes} min` : ''
                                  ]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </span>
                              </div>
                              {step.description ? (
                                <div
                                  className="live-step-description"
                                  dangerouslySetInnerHTML={{ __html: safeHtml(step.description) }}
                                />
                              ) : null}
                              {prior.includes(step.id) ? <small>Previously completed</small> : null}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <p>
                      No lesson steps yet. <Link to={`/lessons/${lesson.id}`}>Edit lesson</Link>
                    </p>
                  )}
                </section>
                <aside className="classroom-lesson-rail" aria-label="Lesson details and tools">
                  <div className="lesson-rail-actions">
                    <Link className="button-link secondary" to={`/lessons/${lesson.id}`}>
                      Edit lesson
                    </Link>
                  </div>
                  {lesson.lessonPlan.objective ? (
                    <section className="lesson-rail-card">
                      <p className="eyebrow">Objective</p>
                      <div
                        dangerouslySetInnerHTML={{
                          __html: safeHtml(lesson.lessonPlan.objective)
                        }}
                      />
                    </section>
                  ) : null}
                  {lesson.lessonPlan.studentDirections ? (
                    <section className="lesson-rail-card">
                      <p className="eyebrow">Student directions</p>
                      <div
                        dangerouslySetInnerHTML={{
                          __html: safeHtml(lesson.lessonPlan.studentDirections)
                        }}
                      />
                    </section>
                  ) : null}
                  {lesson.lessonPlan.materials ? (
                    <section className="lesson-rail-card">
                      <p className="eyebrow">Materials</p>
                      <div
                        dangerouslySetInnerHTML={{
                          __html: safeHtml(lesson.lessonPlan.materials)
                        }}
                      />
                    </section>
                  ) : null}
                  {lesson.lessonPlan.links.length ? (
                    <section className="lesson-rail-card lesson-rail-resources">
                      <p className="eyebrow">Resources</p>
                      {lesson.lessonPlan.links.map((link) => (
                        <a href={link.url} key={link.url} rel="noreferrer" target="_blank">
                          {link.title} <span aria-hidden="true">↗</span>
                        </a>
                      ))}
                    </section>
                  ) : null}
                  <section className="lesson-rail-card live-last">
                    <p className="eyebrow">Last time</p>
                    <strong>
                      {resume?.state?.lastTaughtDate ?? 'First time teaching this lesson'}
                    </strong>
                    {lastStop ? <p>Stopped after {lastStop.title}</p> : null}
                    {resume?.lastNote?.content ? (
                      <blockquote>{resume.lastNote.content}</blockquote>
                    ) : null}
                  </section>
                  <section className="lesson-rail-card live-note">
                    <label>
                      Note for next time
                      <textarea
                        className="input"
                        rows={5}
                        value={note}
                        placeholder="Add a note"
                        onChange={(e) => queue(checks, e.target.value)}
                      />
                    </label>
                    <span
                      className={`autosave${state === 'error' ? ' error' : ''}`}
                      aria-live="polite"
                    >
                      {state === 'saving'
                        ? 'Saving…'
                        : state === 'error'
                          ? 'Saved locally'
                          : 'Saved'}
                    </span>
                  </section>
                </aside>
              </div>
              <div className="live-footer-actions">
                <button className="live-end" type="button" onClick={() => setEnding(true)}>
                  Review & end class
                </button>
                <button className="secondary" type="button" onClick={completeLessonAndMoveOn}>
                  Complete lesson & move on
                </button>
              </div>
              {ending ? (
                <div className="classroom-review-backdrop" role="presentation">
                  <section
                    aria-labelledby="classroom-review-title"
                    aria-modal="true"
                    className="classroom-review"
                    role="dialog"
                  >
                    <div className="classroom-review-heading">
                      <p className="eyebrow">Class recap</p>
                      <h2 id="classroom-review-title">{lesson.title}</h2>
                    </div>
                    <div className="classroom-review-grid">
                      <div>
                        <span>Completed</span>
                        <strong>
                          {allChecked.length}/{lesson.segments.length} steps
                        </strong>
                        <p>
                          {checks.length
                            ? checks
                                .map((id) => lesson.segments.find((step) => step.id === id)?.title)
                                .filter(Boolean)
                                .join(', ')
                            : 'No new steps'}
                        </p>
                      </div>
                      <div>
                        <span>Next</span>
                        <strong>
                          {lesson.segments.find((step) => !allChecked.includes(step.id))?.title ??
                            'Next lesson'}
                        </strong>
                        {note.trim() ? <p>{note}</p> : null}
                      </div>
                    </div>
                    <div className="classroom-review-actions">
                      <button className="live-end" type="button" onClick={() => persist(true)}>
                        End class
                      </button>
                      <button className="secondary" type="button" onClick={() => setEnding(false)}>
                        Back to lesson
                      </button>
                    </div>
                  </section>
                </div>
              ) : null}
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
