import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import type { AiJobStatusResponse, CourseListResponse, GetScheduleResponse } from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';

function isTerminalStatus(status: AiJobStatusResponse['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

const meetingDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'A-Day', 'B-Day'] as const;

export function SchedulePage() {
  const api = useApiClient();
  const [schedule, setSchedule] = useState<GetScheduleResponse | null>(null);
  const [courses, setCourses] = useState<CourseListResponse['courses']>([]);
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [sectionName, setSectionName] = useState('');
  const [meetingDay, setMeetingDay] = useState<(typeof meetingDays)[number]>('Monday');
  const [meetingTime, setMeetingTime] = useState('');
  const [meetingRoom, setMeetingRoom] = useState('');
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

  const loadCourses = useCallback(async () => {
    try {
      const response = await api.listCourses();
      setCourses(response.courses);
      setSelectedCourseId((current) => current || response.courses[0]?.id || '');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load courses');
    }
  }, [api]);

  useEffect(() => {
    void loadSchedule();
    void loadCourses();
  }, [loadCourses, loadSchedule]);

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
      <div className="editor-topbar">
        <div>
          <p className="eyebrow">Editor</p>
          <h1>Schedule</h1>
        </div>
        <Link className="button-link secondary" to="/management">
          Back to Management
        </Link>
      </div>
      {error ? <p style={{ color: '#b02020' }}>{error}</p> : null}

      <div className="card stack">
        <h3>Add class section</h3>
        {courses.length === 0 ? (
          <p className="muted">Create a course in Curriculum before adding scheduled sections.</p>
        ) : null}
        <select
          className="input"
          value={selectedCourseId}
          onChange={(event) => setSelectedCourseId(event.target.value)}
        >
          {courses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.name}
            </option>
          ))}
        </select>
        <input
          className="input"
          value={sectionName}
          onChange={(event) => setSectionName(event.target.value)}
          placeholder="Section name, like Period 1 or Algebra A"
        />
        <div className="row">
          <select
            className="input"
            value={meetingDay}
            onChange={(event) => setMeetingDay(event.target.value as (typeof meetingDays)[number])}
          >
            {meetingDays.map((day) => (
              <option key={day} value={day}>
                {day}
              </option>
            ))}
          </select>
          <input
            className="input"
            type="time"
            value={meetingTime}
            onChange={(event) => setMeetingTime(event.target.value)}
          />
          <input
            className="input"
            value={meetingRoom}
            onChange={(event) => setMeetingRoom(event.target.value)}
            placeholder="Room"
          />
        </div>
        <button
          type="button"
          disabled={busy || !selectedCourseId || !sectionName.trim()}
          onClick={async () => {
            try {
              setBusy(true);
              setSchedule(
                await api.createSection({
                  courseId: selectedCourseId,
                  sectionName: sectionName.trim(),
                  meetings: [
                    {
                      day: meetingDay,
                      time: meetingTime || null,
                      room: meetingRoom.trim() || null
                    }
                  ]
                })
              );
              setSectionName('');
              setMeetingTime('');
              setMeetingRoom('');
              setError(null);
            } catch (err) {
              setError(err instanceof ApiError ? err.message : 'Failed to create class section');
            } finally {
              setBusy(false);
            }
          }}
        >
          Add section
        </button>
      </div>

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
          <div className="stack">
            {schedule.sections.map((section) => (
              <div key={section.sectionId} className="card stack">
                <div className="row">
                  <strong>
                    {section.courseName} - {section.sectionName}
                  </strong>
                  <button
                    className="secondary"
                    type="button"
                    onClick={async () => {
                      const nextName = window.prompt('Section name', section.sectionName);
                      if (nextName === null || !nextName.trim()) return;
                      try {
                        setBusy(true);
                        setSchedule(
                          await api.updateSection(section.sectionId, {
                            sectionName: nextName.trim()
                          })
                        );
                        setError(null);
                      } catch (err) {
                        setError(err instanceof ApiError ? err.message : 'Failed to update section');
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm(`Delete section "${section.sectionName}"?`)) return;
                      try {
                        setBusy(true);
                        await api.deleteSection(section.sectionId);
                        await loadSchedule();
                      } catch (err) {
                        setError(err instanceof ApiError ? err.message : 'Failed to delete section');
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
                {section.meetings.length ? (
                  <ul>
                    {section.meetings.map((meeting) => (
                      <li key={`${meeting.day}-${meeting.time ?? 'none'}-${meeting.room ?? 'none'}`}>
                        {meeting.day} at {meeting.time ?? 'TBD'}
                        {meeting.room ? ` in ${meeting.room}` : ''}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No meeting times added yet.</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">No section schedule data yet.</p>
        )}
      </div>
    </div>
  );
}
