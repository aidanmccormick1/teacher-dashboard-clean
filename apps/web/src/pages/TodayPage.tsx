import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type {
  ClassroomResumeResponse,
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

export function TodayPage() {
  const api = useApiClient();
  const navigate = useNavigate();
  const [data, setData] = useState<TodayData>({
    today: null,
    schedule: null,
    instances: null,
    resumes: {},
    planning: {}
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  if (loading) return <p className="muted">Loading Today…</p>;
  if (error) return <p className="notice warning">{error}</p>;

  return (
    <main className="today-workspace">
      <header className="today-header">
        <div>
          <p className="eyebrow">{dateLabel}</p>
          <h1>Today</h1>
        </div>
        <Link className="button-link secondary" to="/year-plan">
          Open Year Plan
        </Link>
      </header>
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
      <button className="button-link" type="button" onClick={() => navigate('/dashboard')}>
        Open legacy Dashboard
      </button>
    </main>
  );
}
