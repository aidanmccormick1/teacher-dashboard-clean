import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import type { ClassroomResumeResponse } from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';

export function LessonTrackerPage() {
  const api = useApiClient();
  const { sectionId = '', lessonId = '' } = useParams();
  const [resume, setResume] = useState<ClassroomResumeResponse | null>(null);
  const [note, setNote] = useState('');
  const [completedSegmentIds, setCompletedSegmentIds] = useState<string[]>([]);
  const [stoppedAtSegmentId, setStoppedAtSegmentId] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sectionId) return;

    void (async () => {
      try {
        const response = await api.getClassroomResume(sectionId);
        setResume(response);
        setNote(response.state?.carryOverNote ?? response.lastNote?.content ?? '');
        setCompletedSegmentIds(response.state?.completedSegmentIds ?? []);
        setStoppedAtSegmentId(response.state?.stoppedAtSegmentId ?? null);
        setError(null);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load lesson tracker');
      }
    })();
  }, [api, sectionId]);

  const lesson = resume?.lesson;
  const hasRouteMismatch = Boolean(lesson && lesson.id !== lessonId);
  const stoppedSegment = lesson?.segments.find((segment) => segment.id === stoppedAtSegmentId);
  const progressPercent = lesson?.segments.length
    ? Math.round((completedSegmentIds.length / lesson.segments.length) * 100)
    : 0;

  return (
    <div className="stack lesson-tracker-page">
      <div className="editor-topbar">
        <div>
          <p className="eyebrow">Classroom</p>
          <h1>Lesson Tracker</h1>
        </div>
        <div className="progress-stack compact">
          <span>{progressPercent}%</span>
          <progress max={100} value={progressPercent} />
        </div>
      </div>
      {error ? <p style={{ color: '#b02020' }}>{error}</p> : null}
      <div className="card stack">
        <p>
          Section:{' '}
          <strong>
            {resume ? `${resume.section.courseName} / ${resume.section.sectionName}` : sectionId}
          </strong>
        </p>
        <p>
          Lesson: <strong>{lesson?.title ?? lessonId}</strong>
        </p>
        {hasRouteMismatch ? (
          <p className="muted">
            Showing the current resume lesson for this section instead of the older URL lesson.
          </p>
        ) : null}
        {lesson?.description ? <p className="muted">{lesson.description}</p> : null}
        {lesson?.segments.length ? (
          <div className="stack">
            <h3>Segments</h3>
            <div className="tracker-segment-list">
            {lesson.segments.map((segment) => {
              const isCompleted = completedSegmentIds.includes(segment.id);
              return (
                <div key={segment.id} className={stoppedAtSegmentId === segment.id ? 'tracker-segment stopped' : 'tracker-segment'}>
                  <label>
                    <input
                      type="checkbox"
                      checked={isCompleted}
                      onChange={(event) => {
                        setCompletedSegmentIds((previous) =>
                          event.target.checked
                            ? [...new Set([...previous, segment.id])]
                            : previous.filter((id) => id !== segment.id)
                        );
                      }}
                    />
                    <span>
                      <strong>{segment.title}</strong>
                      {segment.durationMinutes ? ` / ${segment.durationMinutes} min` : ''}
                    </span>
                  </label>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => setStoppedAtSegmentId(segment.id)}
                  >
                    Stop here
                  </button>
                </div>
              );
            })}
            </div>
          </div>
        ) : (
          <p className="muted">No lesson segments yet. You can still save a carry-over note.</p>
        )}
        <textarea
          rows={5}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Carry-over note..."
        />
        <button
          type="button"
          disabled={!lesson}
          onClick={async () => {
            if (!lesson) return;
            try {
              const allDone =
                lesson.segments.length > 0 &&
                lesson.segments.every((segment) => completedSegmentIds.includes(segment.id));
              const stoppedAt = stoppedAtSegmentId;

              await api.upsertLessonProgress({
                sectionId,
                lessonId: lesson.id,
                status: allDone ? 'completed' : stoppedAt ? 'stopped_at_segment' : 'in_progress',
                currentSegmentId: stoppedAt,
                stoppedAtSegmentId: stoppedAt,
                completedSegmentIds,
                carryOverNote: note || null,
                lastTaughtDate: new Date().toISOString().slice(0, 10)
              });
              await api.upsertClassNote({
                sectionId,
                date: new Date().toISOString().slice(0, 10),
                noteType: 'raw',
                content: note || 'Tracked lesson progress'
              });
              setSavedAt(new Date().toLocaleTimeString());
              setError(null);
            } catch (err) {
              setError(err instanceof ApiError ? err.message : 'Failed to save lesson progress');
            }
          }}
        >
          Save progress
        </button>
        {savedAt ? <p className="muted">Saved at {savedAt}</p> : null}
        {stoppedAtSegmentId ? <p className="muted">Stopped at: {stoppedSegment?.title ?? stoppedAtSegmentId}</p> : null}
      </div>
    </div>
  );
}
