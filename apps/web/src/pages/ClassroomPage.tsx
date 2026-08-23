import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { ClassroomResumeResponse, DashboardTodayResponse, GetScheduleResponse, SchoolCalendarResponse } from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';
import { rememberManagementTab, type ManagementTabTarget } from '../lib/management-tabs.js';

function formatTimeRange(startTime: string | null, endTime: string | null): string {
  if (!startTime && !endTime) return 'Time TBD';
  if (!startTime) return `Ends ${endTime}`;
  if (!endTime) return `${startTime} – end TBD`;
  return `${startTime} – ${endTime}`;
}

export function ClassroomPage() {
  const api = useApiClient();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardTodayResponse | null>(null);
  const [schedule, setSchedule] = useState<GetScheduleResponse | null>(null);
  const [calendar, setCalendar] = useState<SchoolCalendarResponse | null>(null);
  const [manualSectionId, setManualSectionId] = useState('');
  const [resume, setResume] = useState<ClassroomResumeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const completedCount = resume?.state?.completedSegmentIds.length ?? 0;
  const totalSegments = resume?.lesson?.segments.length ?? 0;
  const stoppedSegment = resume?.lesson?.segments.find((segment) => segment.id === resume.state?.stoppedAtSegmentId);
  const nextSegment = resume?.lesson?.segments.find((segment) => !resume.state?.completedSegmentIds.includes(segment.id));
  const manualSection = schedule?.sections.find((section) => section.sectionId === manualSectionId);
  const targetClass = data?.currentClass ?? data?.nextClass ?? (manualSection ? { sectionId: manualSection.sectionId, courseName: manualSection.courseName, sectionName: manualSection.sectionName, meetingTime: null, endTime: null, room: null } : null);
  const today = new Date().toISOString().slice(0, 10);
  const specialDay = calendar?.events.find((event) => event.date === today && event.type !== 'no_school') ?? null;

  useEffect(() => {
    void (async () => {
      try {
        const [dashboard, scheduleResult, calendarResult] = await Promise.all([api.dashboardToday(), api.getSchedule(), api.getSchoolCalendar()]);
        setData(dashboard); setSchedule(scheduleResult); setCalendar(calendarResult);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load classroom state');
      }
    })();
  }, [api]);

  useEffect(() => {
    if (!targetClass) {
      setResume(null);
      return;
    }

    void (async () => {
      try {
        setResume(await api.getClassroomResume(targetClass.sectionId));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load resume lesson');
      }
    })();
  }, [api, targetClass]);

  const openManagementTab = (tab: ManagementTabTarget) => {
    rememberManagementTab(tab);
    navigate('/management');
  };

  const copyClassBrief = async () => {
    const currentClass = data?.currentClass;
    const lines = currentClass
      ? [
          'Classroom brief',
          `Class: ${currentClass.courseName}`,
          `Period: ${currentClass.sectionName}`,
          `Time: ${formatTimeRange(currentClass.meetingTime, currentClass.endTime)}`,
          `Room: ${currentClass.room ?? 'TBD'}`,
          `Lesson: ${resume?.lesson?.title ?? 'No lesson ready'}`,
          totalSegments
            ? `Progress: ${completedCount}/${totalSegments} segments complete`
            : 'Progress: no segments yet',
          `Next: ${nextSegment?.title ?? (resume?.lesson ? 'Lesson complete' : 'No lesson ready')}`,
          `Stopped at: ${stoppedSegment?.title ?? 'Not set'}`,
          `Last taught: ${resume?.state?.lastTaughtDate ?? 'Not saved yet'}`,
          `Carry-over: ${resume?.state?.carryOverNote ?? resume?.lastNote?.content ?? 'None'}`
        ]
      : [
          'Classroom brief',
          'No class detected right now',
          `Classes today: ${data?.todaySchedule.length ?? 0}`,
          data?.nextClass ? `Next: ${data.nextClass.courseName} / ${data.nextClass.sectionName}` : 'Next: none scheduled',
          data?.nextClass ? `Next lesson: ${resume?.lesson?.title ?? 'No lesson ready'}` : null,
          data?.nextClass ? `Next up: ${nextSegment?.title ?? (resume?.lesson ? 'Lesson complete' : 'No lesson ready')}` : null,
          data?.nextClass ? `Carry-over: ${resume?.state?.carryOverNote ?? resume?.lastNote?.content ?? 'None'}` : null
        ];

    await navigator.clipboard?.writeText(lines.filter(Boolean).join('\n')).catch(() => undefined);
    setCopyStatus('Class brief copied.');
    window.setTimeout(() => setCopyStatus(null), 1600);
  };

  return (
    <div className="stack">
      <h1>Classroom</h1>
      {error ? <p className="notice warning">{error}</p> : null}
      {copyStatus ? <p className="notice success">{copyStatus}</p> : null}
      {specialDay && !data?.currentClass ? <section className="smart-prompt"><div><p className="eyebrow">{specialDay.type.replace('_', ' ')}</p><h2>{specialDay.label}</h2><p>Today has an abnormal schedule. Choose the Class Group you are teaching instead of using normal times.</p></div><select className="input" value={manualSectionId} onChange={(event) => setManualSectionId(event.target.value)}><option value="">Choose Class Group</option>{schedule?.sections.map((section) => <option key={section.sectionId} value={section.sectionId}>{section.courseName} · {section.sectionName}</option>)}</select></section> : null}
      {!data ? <p className="muted">Loading active class...</p> : null}
      {data?.currentClass ? (
        <div className="classroom-grid">
          <section className="card stack classroom-focus-card">
            <p className="eyebrow">Now teaching</p>
            <h2>{data.currentClass.courseName}</h2>
            <p className="muted">
              {data.currentClass.sectionName} / {formatTimeRange(data.currentClass.meetingTime, data.currentClass.endTime)}
              {data.currentClass.room ? ` / Room ${data.currentClass.room}` : ''}
            </p>
            {resume?.lesson ? (
              <div className="soft-panel">
                <strong>{resume.lesson.title}</strong>
                <p className="muted">
                  {totalSegments
                    ? `${completedCount}/${totalSegments} segments complete`
                    : 'No segments yet'}
                </p>
                <div className="classroom-context-grid">
                  <div>
                    <span>Next up</span>
                    <strong>{nextSegment?.title ?? 'Lesson complete'}</strong>
                  </div>
                  <div>
                    <span>Stopped at</span>
                    <strong>{stoppedSegment?.title ?? 'Not set'}</strong>
                  </div>
                  <div>
                    <span>Last taught</span>
                    <strong>{resume.state?.lastTaughtDate ?? 'Not saved yet'}</strong>
                  </div>
                </div>
              </div>
            ) : (
              <div className="soft-panel">
                <strong>No lesson ready yet</strong>
                <p className="muted">Build a Year Plan in Management, then Classroom can resume the right lesson.</p>
                <button className="secondary" type="button" onClick={() => openManagementTab('curriculum')}>
                  Open Year Plan
                </button>
              </div>
            )}
            {resume?.state?.carryOverNote ? (
              <blockquote className="carry-note">{resume.state.carryOverNote}</blockquote>
            ) : null}
            <div className="profile-actions">
              <button
                type="button"
                disabled={!resume?.lesson}
                onClick={() => {
                  if (!data.currentClass || !resume?.lesson) return;
                  navigate(`/sections/${data.currentClass.sectionId}/lessons/${resume.lesson.id}`);
                }}
              >
                {resume?.lesson ? 'Start class tracker' : 'No lesson ready'}
              </button>
              <button className="secondary" type="button" onClick={() => openManagementTab('progress')}>
                Open Management
              </button>
              <button className="secondary" type="button" onClick={() => void copyClassBrief()}>
                Copy class brief
              </button>
            </div>
          </section>

          <section className="card stack">
            <p className="eyebrow">Today</p>
            <h2>Class timeline</h2>
            {data.todaySchedule.length ? (
              <div className="mini-timeline">
                {data.todaySchedule.map((item) => (
                  <div key={`${item.sectionId}-${item.meetingTime ?? 'tbd'}`} className={item.isInSession ? 'active' : ''}>
                    <strong>{formatTimeRange(item.meetingTime, item.endTime)}</strong>
                    <span>
                      {item.courseName} / {item.sectionName}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No classes scheduled today.</p>
            )}
            {data.nextClass ? (
              <p className="muted">
                Next: {data.nextClass.courseName} / {data.nextClass.sectionName}
              </p>
            ) : null}
          </section>
        </div>
      ) : (
        <div className="card stack">
          <h2>No class detected right now</h2>
          <p className="muted">Open Management to add meeting times, or use Dashboard to see what is next today.</p>
          {data?.nextClass ? (
            <div className="soft-panel">
              <p className="eyebrow">Up next</p>
              <strong>{data.nextClass.courseName}</strong>
              <p className="muted">
                {data.nextClass.sectionName} / {formatTimeRange(data.nextClass.meetingTime, data.nextClass.endTime)}
              </p>
              {resume?.lesson ? (
                <div className="classroom-context-grid">
                  <div>
                    <span>Lesson</span>
                    <strong>{resume.lesson.title}</strong>
                  </div>
                  <div>
                    <span>Next up</span>
                    <strong>{nextSegment?.title ?? 'Lesson complete'}</strong>
                  </div>
                  <div>
                    <span>Stopped at</span>
                    <strong>{stoppedSegment?.title ?? 'Not set'}</strong>
                  </div>
                </div>
              ) : (
                <p className="muted">No lesson is ready for this period yet.</p>
              )}
            </div>
          ) : null}
          <div className="profile-actions">
            {data?.nextClass ? (
              <button
                type="button"
                disabled={!resume?.lesson}
                onClick={() => {
                  if (!data.nextClass || !resume?.lesson) return;
                  navigate(`/sections/${data.nextClass.sectionId}/lessons/${resume.lesson.id}`);
                }}
              >
                {resume?.lesson ? 'Prep next class' : 'No lesson ready'}
              </button>
            ) : null}
            <button type="button" onClick={() => openManagementTab('weekly')}>
              Open Weekly Schedule
            </button>
            <button className="secondary" type="button" onClick={() => openManagementTab('periods')}>
              Add periods
            </button>
            <button className="secondary" type="button" onClick={() => navigate('/dashboard')}>
              Back to dashboard
            </button>
            <button className="secondary" type="button" onClick={() => void copyClassBrief()}>
              Copy brief
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
