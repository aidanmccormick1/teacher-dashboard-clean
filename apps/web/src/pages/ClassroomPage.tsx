import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { ClassroomResumeResponse, DashboardTodayResponse } from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';
import { rememberManagementTab, type ManagementTabTarget } from '../lib/management-tabs.js';

export function ClassroomPage() {
  const api = useApiClient();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardTodayResponse | null>(null);
  const [resume, setResume] = useState<ClassroomResumeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setData(await api.dashboardToday());
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load classroom state');
      }
    })();
  }, [api]);

  useEffect(() => {
    const currentClass = data?.currentClass;
    if (!currentClass) {
      setResume(null);
      return;
    }

    void (async () => {
      try {
        setResume(await api.getClassroomResume(currentClass.sectionId));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load resume lesson');
      }
    })();
  }, [api, data?.currentClass]);

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
          `Time: ${currentClass.meetingTime ?? 'TBD'}`,
          `Room: ${currentClass.room ?? 'TBD'}`,
          `Lesson: ${resume?.lesson?.title ?? 'No lesson ready'}`,
          resume?.lesson?.segments.length
            ? `Progress: ${resume.state?.completedSegmentIds.length ?? 0}/${resume.lesson.segments.length} segments complete`
            : 'Progress: no segments yet',
          `Carry-over: ${resume?.state?.carryOverNote ?? resume?.lastNote?.content ?? 'None'}`
        ]
      : [
          'Classroom brief',
          'No class detected right now',
          `Classes today: ${data?.todaySchedule.length ?? 0}`,
          data?.nextClass ? `Next: ${data.nextClass.courseName} / ${data.nextClass.sectionName}` : 'Next: none scheduled'
        ];

    await navigator.clipboard?.writeText(lines.join('\n')).catch(() => undefined);
    setCopyStatus('Class brief copied.');
    window.setTimeout(() => setCopyStatus(null), 1600);
  };

  return (
    <div className="stack">
      <h1>Classroom</h1>
      {error ? <p className="notice warning">{error}</p> : null}
      {copyStatus ? <p className="notice success">{copyStatus}</p> : null}
      {!data ? <p className="muted">Loading active class...</p> : null}
      {data?.currentClass ? (
        <div className="classroom-grid">
          <section className="card stack classroom-focus-card">
            <p className="eyebrow">Now teaching</p>
            <h2>{data.currentClass.courseName}</h2>
            <p className="muted">
              {data.currentClass.sectionName} / {data.currentClass.meetingTime ?? 'Time TBD'}
              {data.currentClass.room ? ` / Room ${data.currentClass.room}` : ''}
            </p>
            {resume?.lesson ? (
              <div className="soft-panel">
                <strong>{resume.lesson.title}</strong>
                <p className="muted">
                  {resume.lesson.segments.length
                    ? `${resume.state?.completedSegmentIds.length ?? 0}/${resume.lesson.segments.length} segments complete`
                    : 'No segments yet'}
                </p>
              </div>
            ) : (
              <div className="soft-panel">
                <strong>No lesson ready yet</strong>
                <p className="muted">Build a Year Plan in Management, then Classroom can resume the right lesson.</p>
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
                    <strong>{item.meetingTime ?? 'TBD'}</strong>
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
          <div className="profile-actions">
            <button type="button" onClick={() => openManagementTab('weekly')}>
              Open Weekly Schedule
            </button>
            <button className="secondary" type="button" onClick={() => openManagementTab('periods')}>
              Add periods
            </button>
            <button className="secondary" type="button" onClick={() => navigate('/')}>
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
