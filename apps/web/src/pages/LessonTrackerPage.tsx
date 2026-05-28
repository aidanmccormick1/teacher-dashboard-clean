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
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
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
  const nextOpenSegment = lesson?.segments.find((segment) => !completedSegmentIds.includes(segment.id));
  const progressPercent = lesson?.segments.length
    ? Math.round((completedSegmentIds.length / lesson.segments.length) * 100)
    : 0;
  const classSummary = [
    resume ? `${resume.section.courseName} / ${resume.section.sectionName}` : `Section ${sectionId}`,
    `Lesson: ${lesson?.title ?? lessonId}`,
    `Progress: ${completedSegmentIds.length}/${lesson?.segments.length ?? 0} segments complete`,
    stoppedSegment ? `Stopped at: ${stoppedSegment.title}` : nextOpenSegment ? `Next: ${nextOpenSegment.title}` : 'Next: lesson complete',
    '',
    note.trim() || 'No carry-over note.'
  ].join('\n');

  const saveProgress = async (options?: { completeLesson?: boolean; stoppedAtSegmentId?: string | null; carryOverNote?: string }) => {
    if (!lesson) return;
    const nextCompletedSegmentIds = options?.completeLesson ? lesson.segments.map((segment) => segment.id) : completedSegmentIds;
    const nextStoppedAtSegmentId = options?.completeLesson ? null : (options?.stoppedAtSegmentId ?? stoppedAtSegmentId);
    const nextNote = options?.carryOverNote ?? note;

    try {
      setSaving(true);
      const allDone =
        lesson.segments.length > 0 &&
        lesson.segments.every((segment) => nextCompletedSegmentIds.includes(segment.id));

      await api.upsertLessonProgress({
        sectionId,
        lessonId: lesson.id,
        status: allDone ? 'completed' : nextStoppedAtSegmentId ? 'stopped_at_segment' : 'in_progress',
        currentSegmentId: nextStoppedAtSegmentId,
        stoppedAtSegmentId: nextStoppedAtSegmentId,
        completedSegmentIds: nextCompletedSegmentIds,
        carryOverNote: nextNote || null,
        lastTaughtDate: new Date().toISOString().slice(0, 10)
      });
      await api.upsertClassNote({
        sectionId,
        date: new Date().toISOString().slice(0, 10),
        noteType: 'raw',
        content: nextNote || 'Tracked lesson progress'
      });
      setCompletedSegmentIds(nextCompletedSegmentIds);
      setStoppedAtSegmentId(nextStoppedAtSegmentId);
      setSavedAt(new Date().toLocaleTimeString());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save lesson progress');
    } finally {
      setSaving(false);
    }
  };

  const copySummary = async () => {
    await navigator.clipboard?.writeText(classSummary).catch(() => undefined);
    setCopyStatus('Class summary copied.');
    window.setTimeout(() => setCopyStatus(null), 1600);
  };

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
        <div className="tracker-summary-grid">
          <div>
            <span>Completed</span>
            <strong>{completedSegmentIds.length}/{lesson?.segments.length ?? 0}</strong>
          </div>
          <div>
            <span>Stopped at</span>
            <strong>{stoppedSegment?.title ?? 'Not set'}</strong>
          </div>
          <div>
            <span>Next up</span>
            <strong>{nextOpenSegment?.title ?? (lesson ? 'Lesson complete' : 'No lesson')}</strong>
          </div>
        </div>
        {copyStatus ? <p className="notice success">{copyStatus}</p> : null}
        {lesson?.segments.length ? (
          <div className="stack">
            <div className="section-heading">
              <div>
                <p className="eyebrow">During class</p>
                <h3>Segments</h3>
              </div>
              <div className="profile-actions">
                <button className="secondary" type="button" onClick={() => setCompletedSegmentIds(lesson.segments.map((segment) => segment.id))}>
                  Check all
                </button>
                <button className="secondary" type="button" onClick={() => setCompletedSegmentIds([])}>
                  Clear checks
                </button>
              </div>
            </div>
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
                    onClick={() => {
                      setStoppedAtSegmentId(segment.id);
                      setNote((current) => current || `Resume at: ${segment.title}`);
                    }}
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
          placeholder="Carry-over note for the next time this period meets..."
        />
        <div className="tracker-action-bar">
          <button type="button" disabled={!lesson || saving} onClick={() => void saveProgress()}>
            {saving ? 'Saving...' : 'Save progress'}
          </button>
          <button className="secondary" type="button" disabled={!lesson || saving || !nextOpenSegment} onClick={() => {
            if (!nextOpenSegment) return;
            const nextNote = note || `Resume at: ${nextOpenSegment.title}`;
            setStoppedAtSegmentId(nextOpenSegment.id);
            setNote(nextNote);
            void saveProgress({ stoppedAtSegmentId: nextOpenSegment.id, carryOverNote: nextNote });
          }}>
            Stop at next unfinished
          </button>
          <button className="secondary" type="button" disabled={!lesson || saving} onClick={() => void saveProgress({ completeLesson: true })}>
            Mark lesson complete
          </button>
          <button className="secondary" type="button" onClick={() => void copySummary()}>
            Copy class summary
          </button>
        </div>
        {savedAt ? <p className="muted">Saved at {savedAt}</p> : null}
        {stoppedAtSegmentId ? (
          <p className="muted">
            Stopped at: {stoppedSegment?.title ?? stoppedAtSegmentId}{' '}
            <button className="link-button" type="button" onClick={() => setStoppedAtSegmentId(null)}>
              Clear stop
            </button>
          </p>
        ) : null}
      </div>
    </div>
  );
}
