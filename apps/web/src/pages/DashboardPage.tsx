import { useEffect, useState } from 'react';

import type { DashboardTodayResponse } from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';

export function DashboardPage() {
  const api = useApiClient();
  const [data, setData] = useState<DashboardTodayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setData(await api.dashboardToday());
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load dashboard');
      }
    })();
  }, [api]);

  return (
    <div className="stack">
      <h1>Dashboard</h1>
      {error ? <p style={{ color: '#b02020' }}>{error}</p> : null}
      {!data ? <p className="muted">Loading...</p> : null}
      {data ? (
        <>
          <div className="card stack">
            <h3>Current class</h3>
            {data.currentClass ? (
              <p>
                {data.currentClass.courseName} ({data.currentClass.sectionName}) at{' '}
                {data.currentClass.meetingTime ?? 'TBD'}
              </p>
            ) : (
              <p className="muted">No class currently in session.</p>
            )}
          </div>
          <div className="card stack">
            <h3>Next class</h3>
            {data.nextClass ? (
              <p>
                {data.nextClass.courseName} ({data.nextClass.sectionName}) at{' '}
                {data.nextClass.meetingTime ?? 'TBD'}
              </p>
            ) : (
              <p className="muted">No additional classes scheduled today.</p>
            )}
          </div>
          <div className="card stack">
            <h3>Today schedule</h3>
            {data.todaySchedule.length ? (
              <ul>
                {data.todaySchedule.map((item) => (
                  <li key={item.sectionId}>
                    {item.meetingTime ?? '--:--'} - {item.courseName} / {item.sectionName}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No schedule entries for today.</p>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
