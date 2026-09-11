import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type {
  GetScheduleResponse,
  ProfileResponse,
  SchoolCalendarResponse,
  TeacherPreferences
} from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';

type GuideData = {
  profile: ProfileResponse;
  schedule: GetScheduleResponse;
  calendar: SchoolCalendarResponse;
  preferences: TeacherPreferences;
};

function SetupGuideLoading() {
  return (
    <main className="setup-guide-page page-entry" aria-busy="true" aria-label="Loading setup guide">
      <section className="setup-guide-hero">
        <div className="setup-guide-loading-copy">
          <span className="workspace-skeleton workspace-skeleton-eyebrow" />
          <span className="workspace-skeleton workspace-skeleton-heading" />
          <span className="workspace-skeleton workspace-skeleton-copy" />
        </div>
        <div className="setup-guide-visual setup-guide-visual-loading" aria-hidden="true" />
      </section>
      <section className="card setup-guide-progress-card">
        <span className="workspace-skeleton workspace-skeleton-heading" />
        <span className="workspace-skeleton workspace-skeleton-row" />
        <span className="workspace-skeleton workspace-skeleton-row" />
      </section>
    </main>
  );
}

export function SetupGuidePage() {
  const api = useApiClient();
  const navigate = useNavigate();
  const completionSaved = useRef(false);
  const [data, setData] = useState<GuideData | null>(null);
  const [loading, setLoading] = useState(true);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      api.getProfile(),
      api.getSchedule(),
      api.getSchoolCalendar(),
      api.getPreferences()
    ])
      .then(([profile, schedule, calendar, preferences]) => {
        if (!cancelled) setData({ profile, schedule, calendar, preferences });
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load your setup guide.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const scheduleReady = Boolean(data?.schedule.sections.length);
  const calendarReady = Boolean(data?.calendar.schoolYear);
  const completedCount = Number(scheduleReady) + Number(calendarReady);
  const firstName = useMemo(
    () => data?.profile.user.fullName?.trim().split(/\s+/)[0] ?? 'teacher',
    [data?.profile.user.fullName]
  );

  useEffect(() => {
    if (!data || !scheduleReady || !calendarReady || completionSaved.current) return;
    completionSaved.current = true;
    void api
      .updatePreferences({ setupStep: 'complete', walkthroughDismissed: false })
      .catch(() => undefined);
  }, [api, calendarReady, data, scheduleReady]);

  if (loading) return <SetupGuideLoading />;

  if (error || !data) {
    return (
      <main className="setup-guide-page route-gate page-entry">
        <section className="card route-gate-card">
          <p className="eyebrow">Setup guide</p>
          <h1>We could not load your next step.</h1>
          <p className="muted">
            {error ?? 'Try again to check your profile and imported schedules.'}
          </p>
          <button type="button" onClick={() => window.location.reload()}>
            Try again
          </button>
        </section>
      </main>
    );
  }

  const finish = async () => {
    setFinishing(true);
    await api
      .updatePreferences({
        setupStep: 'complete',
        walkthroughDismissed: true,
        returnPath: '/today'
      })
      .catch(() => undefined);
    navigate('/today', { replace: true });
  };

  return (
    <main className="setup-guide-page page-entry">
      <section className={`setup-guide-hero${completedCount === 2 ? ' is-complete' : ''}`}>
        <div className="setup-guide-hero-copy">
          <p className="eyebrow">Your first setup</p>
          <h1>{completedCount === 2 ? `You’re ready, ${firstName}.` : `Welcome, ${firstName}.`}</h1>
          <p>
            {completedCount === 2
              ? 'Your recurring schedule and school calendar are in place. Head to Today whenever you are ready.'
              : 'We’ll use two imports to make Today and Year Plan match the way your school actually runs.'}
          </p>
        </div>
        <div className="setup-guide-visual" aria-hidden="true">
          <span className="setup-guide-visual-sun" />
          <span
            className={`setup-guide-visual-card setup-guide-visual-card-schedule${scheduleReady ? ' complete' : ''}`}
          >
            <small>01</small>
            <strong>Daily schedule</strong>
            <i />
          </span>
          <span className="setup-guide-visual-connector" />
          <span
            className={`setup-guide-visual-card setup-guide-visual-card-calendar${calendarReady ? ' complete' : ''}`}
          >
            <small>02</small>
            <strong>School calendar</strong>
            <i />
          </span>
        </div>
      </section>

      <section className="card setup-guide-progress-card" aria-labelledby="setup-guide-heading">
        <header className="setup-guide-progress-header">
          <div>
            <p className="eyebrow">Setup progress</p>
            <h2 id="setup-guide-heading">
              {completedCount === 2
                ? 'Your workspace is ready'
                : `${completedCount} of 2 imports complete`}
            </h2>
          </div>
          <span
            className="setup-guide-count"
            aria-label={`${completedCount} of 2 setup steps complete`}
          >
            {completedCount}/2
          </span>
        </header>

        <ol className="setup-guide-steps">
          <li className={`setup-guide-step${scheduleReady ? ' complete' : ' current'}`}>
            <div className="setup-guide-step-marker" aria-hidden="true">
              {scheduleReady ? '✓' : '1'}
            </div>
            <div className="setup-guide-step-copy">
              <p className="eyebrow">First</p>
              <h3>Import your day-to-day class schedule</h3>
              <p>
                Add recurring class groups, meeting days, and start and end times. TeacherDesk uses
                this to build Today.
              </p>
              {scheduleReady ? (
                <div className="setup-guide-step-result">
                  <strong>{data.schedule.sections.length} class groups ready</strong>
                  <Link className="button-link secondary" to="/courses?import=schedule&setup=1">
                    Review schedule
                  </Link>
                </div>
              ) : (
                <Link className="button-link" to="/courses?import=schedule&setup=1">
                  Import class schedule
                </Link>
              )}
            </div>
          </li>

          <li
            className={`setup-guide-step${calendarReady ? ' complete' : scheduleReady ? ' current' : ' locked'}`}
          >
            <div className="setup-guide-step-marker" aria-hidden="true">
              {calendarReady ? '✓' : '2'}
            </div>
            <div className="setup-guide-step-copy">
              <p className="eyebrow">Then</p>
              <h3>Import your school year calendar</h3>
              <p>
                Add the first and last instructional days, holidays, breaks, and special schedule
                dates. This keeps meetings from landing on days your school is closed.
              </p>
              {calendarReady ? (
                <div className="setup-guide-step-result">
                  <strong>School year dates ready</strong>
                  <Link className="button-link secondary" to="/school?setup=1">
                    Review calendar
                  </Link>
                </div>
              ) : scheduleReady ? (
                <Link className="button-link" to="/school?setup=1">
                  Import school calendar
                </Link>
              ) : (
                <span className="setup-guide-locked-note">Complete the class schedule first.</span>
              )}
            </div>
          </li>
        </ol>

        {completedCount === 2 ? (
          <div className="setup-guide-finish">
            <div>
              <strong>Next stop: Today</strong>
              <span>Your schedule and calendar are ready to guide each class.</span>
            </div>
            <button type="button" disabled={finishing} onClick={() => void finish()}>
              {finishing ? 'Opening Today…' : 'Open Today'}
            </button>
          </div>
        ) : null}
      </section>

      <p className="setup-guide-reassurance">
        You can update either import later from the Import menu.
      </p>
    </main>
  );
}
