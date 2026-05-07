import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { DashboardTodayResponse } from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';

export function ClassroomPage() {
  const api = useApiClient();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardTodayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setData(await api.dashboardToday());
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load classroom state');
      }
    })();
  }, [api]);

  return (
    <div className="stack">
      <h1>Classroom</h1>
      {error ? <p style={{ color: '#b02020' }}>{error}</p> : null}
      {!data ? <p className="muted">Loading active class...</p> : null}
      {data?.currentClass ? (
        <div className="card stack">
          <p>
            Active class: <strong>{data.currentClass.courseName}</strong> (
            {data.currentClass.sectionName})
          </p>
          <button
            type="button"
            onClick={() => navigate(`/sections/${data.currentClass?.sectionId}/lessons/demo-lesson`)}
          >
            Resume lesson tracker
          </button>
        </div>
      ) : (
        <div className="card">
          <p className="muted">No class currently detected. Open schedule to verify class times.</p>
        </div>
      )}
    </div>
  );
}
