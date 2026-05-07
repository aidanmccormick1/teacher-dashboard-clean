import { useCallback, useEffect, useState } from 'react';

import type { AiJobStatusResponse, GetScheduleResponse } from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';

function isTerminalStatus(status: AiJobStatusResponse['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

export function SchedulePage() {
  const api = useApiClient();
  const [schedule, setSchedule] = useState<GetScheduleResponse | null>(null);
  const [importText, setImportText] = useState('');
  const [segmentLessonTitle, setSegmentLessonTitle] = useState('');
  const [segmentObjective, setSegmentObjective] = useState('');
  const [segmentDuration, setSegmentDuration] = useState('45');
  const [continuityLessonTitle, setContinuityLessonTitle] = useState('');
  const [continuityLastSegment, setContinuityLastSegment] = useState('');
  const [continuityLastNote, setContinuityLastNote] = useState('');
  const [continuitySummary, setContinuitySummary] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<AiJobStatusResponse | null>(null);
  const [jobOutput, setJobOutput] = useState<string | null>(null);

  const loadSchedule = useCallback(async () => {
    try {
      setSchedule(await api.getSchedule());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load schedule');
    }
  }, [api]);

  useEffect(() => {
    void loadSchedule();
  }, [loadSchedule]);

  useEffect(() => {
    if (!activeJobId) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const status = await api.getAiJobStatus(activeJobId);
        if (cancelled) return;
        setActiveJob(status);
        if (status.output) {
          setJobOutput(JSON.stringify(status.output, null, 2));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load AI job status');
        }
      }
    };

    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 1200);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api, activeJobId]);

  useEffect(() => {
    if (!activeJob || !isTerminalStatus(activeJob.status)) return;
    if (activeJob.status === 'failed' && activeJob.error) {
      setError(`AI job failed: ${activeJob.error}`);
    }
  }, [activeJob]);

  return (
    <div className="stack">
      <h1>Schedule</h1>
      {error ? <p style={{ color: '#b02020' }}>{error}</p> : null}

      <div className="card stack">
        <h3>AI: Parse Schedule</h3>
        <textarea
          rows={6}
          value={importText}
          onChange={(event) => setImportText(event.target.value)}
          placeholder="Paste schedule text to parse..."
        />
        <button
          type="button"
          disabled={busy || !importText.trim()}
          onClick={async () => {
            try {
              setBusy(true);
              const queued = await api.enqueueParseSchedule({ text: importText });
              setActiveJobId(queued.jobId);
              setActiveJob(null);
              setJobOutput(null);
              setError(null);
            } catch (err) {
              setError(err instanceof ApiError ? err.message : 'Failed to import schedule');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Starting...' : 'Queue parse job'}
        </button>
      </div>

      <div className="card stack">
        <h3>AI: Generate Lesson Segments</h3>
        <input
          className="input"
          value={segmentLessonTitle}
          onChange={(event) => setSegmentLessonTitle(event.target.value)}
          placeholder="Lesson title"
        />
        <input
          className="input"
          value={segmentObjective}
          onChange={(event) => setSegmentObjective(event.target.value)}
          placeholder="Objective (optional)"
        />
        <input
          className="input"
          value={segmentDuration}
          onChange={(event) => setSegmentDuration(event.target.value)}
          placeholder="Duration in minutes"
        />
        <button
          type="button"
          disabled={busy || !segmentLessonTitle.trim()}
          onClick={async () => {
            const parsedDuration = Number(segmentDuration);
            if (!Number.isInteger(parsedDuration) || parsedDuration <= 0) {
              setError('Duration must be a positive integer');
              return;
            }

            try {
              setBusy(true);
              const queued = await api.enqueueGenerateSegments({
                lessonTitle: segmentLessonTitle.trim(),
                objective: segmentObjective.trim() ? segmentObjective.trim() : null,
                durationMinutes: parsedDuration
              });
              setActiveJobId(queued.jobId);
              setActiveJob(null);
              setJobOutput(null);
              setError(null);
            } catch (err) {
              setError(err instanceof ApiError ? err.message : 'Failed to enqueue segment job');
            } finally {
              setBusy(false);
            }
          }}
        >
          Queue segment job
        </button>
      </div>

      <div className="card stack">
        <h3>AI: Continuity Suggestions</h3>
        <input
          className="input"
          value={continuityLessonTitle}
          onChange={(event) => setContinuityLessonTitle(event.target.value)}
          placeholder="Lesson title"
        />
        <input
          className="input"
          value={continuityLastSegment}
          onChange={(event) => setContinuityLastSegment(event.target.value)}
          placeholder="Last segment title (optional)"
        />
        <textarea
          rows={3}
          value={continuityLastNote}
          onChange={(event) => setContinuityLastNote(event.target.value)}
          placeholder="Last class note (optional)"
        />
        <textarea
          rows={3}
          value={continuitySummary}
          onChange={(event) => setContinuitySummary(event.target.value)}
          placeholder="Previous lesson summary (optional)"
        />
        <button
          type="button"
          disabled={busy || !continuityLessonTitle.trim()}
          onClick={async () => {
            try {
              setBusy(true);
              const queued = await api.enqueueGenerateContinuity({
                lessonTitle: continuityLessonTitle.trim(),
                lastSegmentTitle: continuityLastSegment.trim() || null,
                lastNote: continuityLastNote.trim() || null,
                previousLessonSummary: continuitySummary.trim() || null
              });
              setActiveJobId(queued.jobId);
              setActiveJob(null);
              setJobOutput(null);
              setError(null);
            } catch (err) {
              setError(err instanceof ApiError ? err.message : 'Failed to enqueue continuity job');
            } finally {
              setBusy(false);
            }
          }}
        >
          Queue continuity job
        </button>
      </div>

      {activeJobId ? (
        <div className="card stack">
          <h3>AI Job Status</h3>
          <p>
            <strong>Job:</strong> {activeJobId}
          </p>
          {activeJob ? (
            <>
              <p>
                <strong>Type:</strong> {activeJob.type}
              </p>
              <p>
                <strong>Status:</strong> {activeJob.status}
              </p>
              <p>
                <strong>Progress:</strong> {activeJob.progressPercent}%
              </p>
              <p>
                <strong>Attempts:</strong> {activeJob.attemptsMade}/{activeJob.maxAttempts}
              </p>
              {activeJob.cancelRequested ? (
                <p className="muted">Cancellation requested. Waiting for the worker to stop.</p>
              ) : null}
              {activeJob.error ? <p style={{ color: '#b02020' }}>{activeJob.error}</p> : null}
              <div className="row">
                <button
                  type="button"
                  disabled={!activeJob.canCancel || busy}
                  onClick={async () => {
                    try {
                      setBusy(true);
                      await api.cancelAiJob(activeJob.jobId);
                      setActiveJob(await api.getAiJobStatus(activeJob.jobId));
                    } catch (err) {
                      setError(err instanceof ApiError ? err.message : 'Failed to cancel AI job');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!activeJob.canRetry || busy}
                  onClick={async () => {
                    try {
                      setBusy(true);
                      await api.retryAiJob(activeJob.jobId);
                      setActiveJob(await api.getAiJobStatus(activeJob.jobId));
                      setError(null);
                    } catch (err) {
                      setError(err instanceof ApiError ? err.message : 'Failed to retry AI job');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Retry
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => {
                    setActiveJobId(null);
                    setActiveJob(null);
                    setJobOutput(null);
                  }}
                >
                  Clear panel
                </button>
              </div>
            </>
          ) : (
            <p className="muted">Loading job status...</p>
          )}
          {jobOutput ? <pre>{jobOutput}</pre> : null}
        </div>
      ) : null}

      <div className="card stack">
        <h3>Current sections</h3>
        {schedule?.sections.length ? (
          <ul>
            {schedule.sections.map((section) => (
              <li key={section.sectionId}>
                {section.courseName} - {section.sectionName}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No section schedule data yet.</p>
        )}
      </div>
    </div>
  );
}
