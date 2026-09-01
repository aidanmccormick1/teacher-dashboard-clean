import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  ClassroomResumeResponse,
  CourseDetailResponse,
  DashboardTodayResponse,
  GetScheduleResponse,
  MeetingInstancesResponse,
  SectionPlanningContextResponse
} from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';
import {
  classroomPath,
  lessonDisplay,
  lessonProgress,
  priorityMeeting,
  timeRange
} from '../lib/today.js';

type TodayData = {
  today: DashboardTodayResponse | null;
  schedule: GetScheduleResponse | null;
  instances: MeetingInstancesResponse | null;
  resumes: Record<string, ClassroomResumeResponse>;
  planning: Record<string, SectionPlanningContextResponse>;
};

function occurrenceKey(sectionId: string, meetingTime: string | null) {
  return `${sectionId}:${meetingTime ?? 'legacy'}`;
}

function TodayLoading() {
  return (
    <main className="today-workspace today-loading" aria-busy="true" aria-label="Loading Today">
      <header className="today-header">
        <div className="workspace-skeleton workspace-skeleton-title" />
        <div className="workspace-skeleton workspace-skeleton-action" />
      </header>
      <section className="today-focus today-loading-focus">
        <div className="workspace-skeleton workspace-skeleton-eyebrow" />
        <div className="workspace-skeleton workspace-skeleton-heading" />
        <div className="workspace-skeleton workspace-skeleton-copy" />
      </section>
      <section className="today-schedule">
        <div className="workspace-skeleton workspace-skeleton-heading" />
        <div className="workspace-skeleton workspace-skeleton-row" />
        <div className="workspace-skeleton workspace-skeleton-row" />
      </section>
    </main>
  );
}

export function TodayPage() {
  const api = useApiClient();
  const [data, setData] = useState<TodayData>({
    today: null,
    schedule: null,
    instances: null,
    resumes: {},
    planning: {}
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCourses, setManualCourses] = useState<CourseDetailResponse['course'][]>([]);
  const [manualCourseId, setManualCourseId] = useState('');
  const [manualSectionId, setManualSectionId] = useState('');
  const [manualUnitId, setManualUnitId] = useState('');
  const [manualLessonId, setManualLessonId] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const [today, schedule, instances] = await Promise.all([
          api.dashboardToday(),
          api.getSchedule(),
          api.getMeetingInstances()
        ]);
        const sectionIds = [...new Set(today.todaySchedule.map((meeting) => meeting.sectionId))];
        const resumeResults = await Promise.all(
          sectionIds.map(
            async (sectionId) => [sectionId, await api.getClassroomResume(sectionId)] as const
          )
        );
        const resumes = Object.fromEntries(resumeResults);
        const planningEntries = await Promise.all(
          today.todaySchedule.map(async (meeting) => {
            const meetingsForSection = instances.meetings.filter(
              (item) => item.sectionId === meeting.sectionId
            );
            const index = meetingsForSection.findIndex(
              (item) => item.date === today.date && item.startTime === meeting.meetingTime
            );
            if (index < 0)
              return [occurrenceKey(meeting.sectionId, meeting.meetingTime), null] as const;
            try {
              return [
                occurrenceKey(meeting.sectionId, meeting.meetingTime),
                await api.getSectionPlanningContext(meeting.sectionId, index)
              ] as const;
            } catch {
              return [occurrenceKey(meeting.sectionId, meeting.meetingTime), null] as const;
            }
          })
        );
        if (!cancelled) {
          setData({
            today,
            schedule,
            instances,
            resumes,
            planning: Object.fromEntries(
              planningEntries.filter(
                (entry): entry is readonly [string, SectionPlanningContextResponse] =>
                  entry[1] !== null
              )
            )
          });
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load Today.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const focus = priorityMeeting(data.today);
  const focusResume = focus ? data.resumes[focus.sectionId] : undefined;
  const focusPlan = focus
    ? (data.planning[occurrenceKey(focus.sectionId, focus.meetingTime)]?.planned ?? null)
    : null;
  const focusLesson = lessonDisplay(focusResume, focusPlan);
  const focusProgress = lessonProgress(focusResume);
  const focusLabel = focus?.status === 'now' ? 'Teaching now' : 'Up next';
  const dateLabel = useMemo(
    () =>
      data.today?.date
        ? new Intl.DateTimeFormat(undefined, {
            weekday: 'long',
            month: 'long',
            day: 'numeric'
          }).format(new Date(`${data.today.date}T12:00:00`))
        : 'Today',
    [data.today?.date]
  );
  const manualCourse = manualCourses.find((course) => course.id === manualCourseId);
  const manualUnit = manualCourse?.units.find((unit) => unit.id === manualUnitId);
  const openManual = async () => {
    setManualOpen(true);
    if (manualCourses.length) return;
    try {
      const listed = await api.listCourses();
      const details = await Promise.all(
        listed.courses.map((course) => api.getCourseDetail(course.id))
      );
      setManualCourses(details.map((detail) => detail.course));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load classes.');
    }
  };
  useEffect(() => {
    if (!manualSectionId) return;
    void (async () => {
      try {
        const sectionResume =
          data.resumes[manualSectionId] ?? (await api.getClassroomResume(manualSectionId));
        const current = sectionResume.lesson;
        if (!current) return;
        const unit = manualCourse?.units.find((candidate) =>
          candidate.lessons.some((lesson) => lesson.id === current.id)
        );
        if (unit) {
          setManualUnitId(unit.id);
          setManualLessonId(current.id);
        }
      } catch {
        /* The teacher can still choose a lesson explicitly. */
      }
    })();
  }, [api, manualSectionId, manualCourse, data.resumes]);

  if (loading) return <TodayLoading />;
  if (error)
    return (
      <main className="today-workspace">
        <section className="today-empty" role="alert">
          <p className="eyebrow">Today is unavailable</p>
          <h2>We could not load your teaching day.</h2>
          <p>{error}</p>
        </section>
      </main>
    );

  return (
    <main className="today-workspace">
      <header className="today-header">
        <div>
          <p className="eyebrow">{dateLabel}</p>
          <h1>Today</h1>
        </div>
        <div className="profile-actions">
          <button className="secondary" type="button" onClick={() => void openManual()}>
            + Teach another class
          </button>
          <Link className="button-link secondary" to="/year-plan">
            Open Year Plan
          </Link>
        </div>
      </header>
      {manualOpen ? (
        <section className="today-manual-class" aria-label="Teach another class">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Manual class</p>
              <h2>Teach another class</h2>
            </div>
            <button className="secondary" type="button" onClick={() => setManualOpen(false)}>
              Close
            </button>
          </div>
          <div className="today-manual-fields">
            <select
              className="input"
              value={manualCourseId}
              onChange={(event) => {
                setManualCourseId(event.target.value);
                setManualSectionId('');
                setManualUnitId('');
                setManualLessonId('');
              }}
            >
              <option value="">Select course</option>
              {manualCourses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={manualSectionId}
              disabled={!manualCourseId}
              onChange={(event) => setManualSectionId(event.target.value)}
            >
              <option value="">Select class group</option>
              {data.schedule?.sections
                .filter((section) => section.courseId === manualCourseId)
                .map((section) => (
                  <option key={section.sectionId} value={section.sectionId}>
                    {section.sectionName}
                  </option>
                ))}
            </select>
            <select
              className="input"
              value={manualUnitId}
              disabled={!manualCourseId}
              onChange={(event) => {
                setManualUnitId(event.target.value);
                setManualLessonId('');
              }}
            >
              <option value="">Select unit</option>
              {manualCourse?.units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.title}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={manualLessonId}
              disabled={!manualUnitId}
              onChange={(event) => setManualLessonId(event.target.value)}
            >
              <option value="">Select lesson</option>
              {manualUnit?.lessons.map((lesson) => (
                <option key={lesson.id} value={lesson.id}>
                  {lesson.title}
                </option>
              ))}
            </select>
            {manualSectionId && manualLessonId ? (
              <Link
                className="button-link"
                to={`/classroom?section=${manualSectionId}&lesson=${manualLessonId}&manual=1`}
              >
                Start class
              </Link>
            ) : (
              <button type="button" disabled>
                Start class
              </button>
            )}
          </div>
          <p className="muted">
            This starts one real class meeting without changing the recurring schedule.
          </p>
        </section>
      ) : null}
      {data.today?.holiday ? (
        <section className="today-empty">
          <p className="eyebrow">No school</p>
          <h2>{data.today.holiday.name}</h2>
          <p>Today’s classes are suppressed by the school calendar.</p>
        </section>
      ) : focus ? (
        <section className="today-focus">
          <div className="today-focus-heading">
            <div>
              <p className="eyebrow">
                {focusLabel} · {timeRange(focus.meetingTime, focus.endTime)}
              </p>
              <h2>{focus.courseName}</h2>
              <p>
                {focus.sectionName}
                {focus.room ? ` · ${focus.room}` : ''}
              </p>
            </div>
            <Link className="button-link" to={classroomPath(focus.sectionId, focus.meetingTime)}>
              {focus.status === 'now' ? 'Open Classroom' : 'Prepare class'}
            </Link>
          </div>
          {focusLesson.actual ? (
            <div className="today-lesson-focus">
              <div>
                <p className="eyebrow">{focusLesson.isContinuation ? 'Continue' : 'Lesson'}</p>
                <h3>{focusLesson.actual.title}</h3>
                <progress max={100} value={focusProgress.percent} />
                <small>
                  {focusProgress.completed}/{focusProgress.total} steps complete
                </small>
              </div>
              {focusLesson.differsFromPlan ? (
                <p className="today-planned-note">
                  Planned: <strong>{focusPlan?.title}</strong>
                </p>
              ) : null}
              {focusResume?.state?.carryOverNote ? (
                <blockquote>{focusResume.state.carryOverNote}</blockquote>
              ) : null}
            </div>
          ) : (
            <p className="muted">No lesson is ready for this section yet.</p>
          )}
        </section>
      ) : (
        <section className="today-empty">
          <h2>No more scheduled classes today</h2>
          <p>Use the Year Plan to prepare what is next.</p>
        </section>
      )}
      <section className="today-schedule" aria-label="Today’s schedule">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Schedule</p>
            <h2>Today at a glance</h2>
          </div>
        </div>
        {data.today?.todaySchedule.length ? (
          data.today.todaySchedule.map((meeting) => {
            const resume = data.resumes[meeting.sectionId];
            const plan =
              data.planning[occurrenceKey(meeting.sectionId, meeting.meetingTime)]?.planned ?? null;
            const display = lessonDisplay(resume, plan);
            return (
              <Link
                key={occurrenceKey(meeting.sectionId, meeting.meetingTime)}
                className={`today-schedule-row ${meeting.status}`}
                to={classroomPath(meeting.sectionId, meeting.meetingTime)}
              >
                <time>{timeRange(meeting.meetingTime, meeting.endTime)}</time>
                <div>
                  <strong>{meeting.courseName}</strong>
                  <span>{meeting.sectionName}</span>
                </div>
                <div className="today-row-lesson">
                  {display.actual ? (
                    <>
                      <strong>
                        {display.isContinuation ? 'Continue ' : ''}
                        {display.actual.title}
                      </strong>
                      {display.differsFromPlan ? <small>Planned: {plan?.title}</small> : null}
                    </>
                  ) : (
                    <span>No lesson</span>
                  )}
                </div>
                <span
                  className={`status-pill ${meeting.status === 'completed' ? 'done' : meeting.status}`}
                >
                  {meeting.status === 'now'
                    ? 'Now'
                    : meeting.status === 'upcoming'
                      ? 'Later'
                      : meeting.status === 'completed'
                        ? 'Done'
                        : 'Time TBD'}
                </span>
              </Link>
            );
          })
        ) : (
          <p className="muted">No classes are scheduled today.</p>
        )}
      </section>
    </main>
  );
}
