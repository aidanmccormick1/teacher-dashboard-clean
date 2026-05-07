import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { ClassroomResumeResponse, DashboardTodayResponse } from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';

export function ClassroomPage() {
  const api = useApiClient();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardTodayResponse | null>(null);
  const [resume, setResume] = useState<ClassroomResumeResponse | null>(null);
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
            disabled={!resume?.lesson}
            onClick={() => {
              if (!data.currentClass || !resume?.lesson) return;
              navigate(`/sections/${data.currentClass.sectionId}/lessons/${resume.lesson.id}`);
            }}
          >
            {resume?.lesson ? `Resume "${resume.lesson.title}"` : 'No lesson ready'}
          </button>
          {!resume?.lesson ? (
            <p className="muted">Add at least one unit and lesson in Curriculum to enable tracking.</p>
          ) : null}
          {resume?.state?.carryOverNote ? (
            <p className="muted">Carry-over: {resume.state.carryOverNote}</p>
          ) : null}
        </div>
      ) : (
        <div className="card">
          <p className="muted">No class currently detected. Open schedule to verify class times.</p>
        </div>
      )}
    </div>
  );
}
