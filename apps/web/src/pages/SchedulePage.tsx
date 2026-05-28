import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import type { AiJobStatusResponse, CourseListResponse, GetScheduleResponse } from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';
import { rememberManagementTab } from '../lib/management-tabs.js';

function isTerminalStatus(status: AiJobStatusResponse['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

const meetingDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'A-Day', 'B-Day'] as const;
const ADD_SECTION_DRAFT_KEY = 'teacheros_schedule_add_section_draft_v1';
type MeetingDay = (typeof meetingDays)[number];
type ScheduleSection = GetScheduleResponse['sections'][number];

type AddSectionDraft = {
  courseId: string;
  sectionName: string;
  meetingDay: MeetingDay;
  meetingTime: string;
  meetingRoom: string;
};

type SectionEditDraft = {
  sectionName: string;
  days: string;
  time: string;
  room: string;
};

function loadAddSectionDraft(): AddSectionDraft {
  if (typeof window === 'undefined') {
    return { courseId: '', sectionName: '', meetingDay: 'Monday', meetingTime: '', meetingRoom: '' };
  }

  try {
    const raw = window.localStorage.getItem(ADD_SECTION_DRAFT_KEY);
    if (!raw) {
      return { courseId: '', sectionName: '', meetingDay: 'Monday', meetingTime: '', meetingRoom: '' };
    }

    const parsed = JSON.parse(raw) as Partial<AddSectionDraft>;
    const meetingDay = meetingDays.includes(parsed.meetingDay as MeetingDay) ? (parsed.meetingDay as MeetingDay) : 'Monday';
    return {
      courseId: parsed.courseId ?? '',
      sectionName: parsed.sectionName ?? '',
      meetingDay,
      meetingTime: parsed.meetingTime ?? '',
      meetingRoom: parsed.meetingRoom ?? ''
    };
  } catch {
    return { courseId: '', sectionName: '', meetingDay: 'Monday', meetingTime: '', meetingRoom: '' };
  }
}

function sectionToDraft(section: ScheduleSection): SectionEditDraft {
  return {
    sectionName: section.sectionName,
    days: section.meetings.map((meeting) => meeting.day).join(', ') || 'Monday',
    time: section.meetings[0]?.time ?? '',
    room: section.meetings[0]?.room ?? ''
  };
}

function parseMeetingDays(value: string): MeetingDay[] {
  const validDays = new Set<string>(meetingDays);
  const parsed = value
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is MeetingDay => validDays.has(item));
  return [...new Set(parsed)];
}

export function SchedulePage() {
  const api = useApiClient();
  const [savedAddSectionDraft] = useState(loadAddSectionDraft);
  const [schedule, setSchedule] = useState<GetScheduleResponse | null>(null);
  const [courses, setCourses] = useState<CourseListResponse['courses']>([]);
  const [selectedCourseId, setSelectedCourseId] = useState(savedAddSectionDraft.courseId);
  const [sectionName, setSectionName] = useState(savedAddSectionDraft.sectionName);
  const [meetingDay, setMeetingDay] = useState<MeetingDay>(savedAddSectionDraft.meetingDay);
  const [meetingTime, setMeetingTime] = useState(savedAddSectionDraft.meetingTime);
  const [meetingRoom, setMeetingRoom] = useState(savedAddSectionDraft.meetingRoom);
  const [importText, setImportText] = useState('');
  const [segmentLessonTitle, setSegmentLessonTitle] = useState('');
  const [segmentObjective, setSegmentObjective] = useState('');
  const [segmentDuration, setSegmentDuration] = useState('45');
  const [continuityLessonTitle, setContinuityLessonTitle] = useState('');
  const [continuityLastSegment, setContinuityLastSegment] = useState('');
  const [continuityLastNote, setContinuityLastNote] = useState('');
  const [continuitySummary, setContinuitySummary] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<AiJobStatusResponse | null>(null);
  const [jobOutput, setJobOutput] = useState<string | null>(null);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [sectionDrafts, setSectionDrafts] = useState<Record<string, SectionEditDraft>>({});

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
    window.localStorage.setItem(
      ADD_SECTION_DRAFT_KEY,
      JSON.stringify({
        courseId: selectedCourseId,
        sectionName,
        meetingDay,
        meetingTime,
        meetingRoom
      })
    );
  }, [meetingDay, meetingRoom, meetingTime, sectionName, selectedCourseId]);

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
      setError(`Schedule reader failed: ${activeJob.error}`);
    }
  }, [activeJob]);

  const beginSectionEdit = (section: ScheduleSection) => {
    setEditingSectionId(section.sectionId);
    setSectionDrafts((previous) => ({
      ...previous,
      [section.sectionId]: previous[section.sectionId] ?? sectionToDraft(section)
    }));
  };

  const updateSectionDraft = (sectionId: string, patch: Partial<SectionEditDraft>) => {
    setSectionDrafts((previous) => ({
      ...previous,
      [sectionId]: {
        ...(previous[sectionId] ?? { sectionName: '', days: 'Monday', time: '', room: '' }),
        ...patch
      }
    }));
  };

  const saveSectionEdit = async (section: ScheduleSection) => {
    const draft = sectionDrafts[section.sectionId] ?? sectionToDraft(section);
    const days = parseMeetingDays(draft.days);

    if (!draft.sectionName.trim()) {
      setError('Section name is required.');
      return;
    }

    if (!days.length) {
      setError('Use meeting days like Monday, Wednesday, Friday, A-Day, or B-Day.');
      return;
    }

    try {
      setBusy(true);
      setSchedule(
        await api.updateSection(section.sectionId, {
          sectionName: draft.sectionName.trim(),
          meetings: days.map((day) => ({
            day,
            time: draft.time || null,
            room: draft.room.trim() || null
          }))
        })
      );
      setEditingSectionId(null);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update section');
    } finally {
      setBusy(false);
    }
  };

  const copyAddSectionDraft = async () => {
    const selectedCourse = courses.find((course) => course.id === selectedCourseId);
    const summary = [
      'Class section draft',
      `Course: ${selectedCourse?.name ?? 'Not selected'}`,
      `Section: ${sectionName.trim() || 'Untitled'}`,
      `Meets: ${meetingDay}`,
      `Time: ${meetingTime || 'Not set'}`,
      `Room: ${meetingRoom.trim() || 'Not set'}`
    ].join('\n');
    await navigator.clipboard?.writeText(summary).catch(() => undefined);
    setCopyStatus('Section draft copied.');
    window.setTimeout(() => setCopyStatus(null), 1800);
  };

  const clearAddSectionDraft = () => {
    setSectionName('');
    setMeetingDay('Monday');
    setMeetingTime('');
    setMeetingRoom('');
    window.localStorage.removeItem(ADD_SECTION_DRAFT_KEY);
    setCopyStatus('Section draft cleared.');
    window.setTimeout(() => setCopyStatus(null), 1800);
  };

  return (
    <div className="stack">
      <div className="editor-topbar">
        <div>
          <p className="eyebrow">Editor</p>
          <h1>Schedule</h1>
        </div>
        <Link className="button-link secondary" to="/management" onClick={() => rememberManagementTab('weekly')}>
          Back to Management
        </Link>
      </div>
      {error ? <p className="notice warning">{error}</p> : null}
      {copyStatus ? <p className="notice success">{copyStatus}</p> : null}

      <div className="card stack">
        <div className="split">
          <div>
            <h3>Add class section</h3>
            <p className="muted">Drafts save on this device while you set up real class periods.</p>
          </div>
          <div className="row">
            <button className="button-link secondary" type="button" onClick={() => void copyAddSectionDraft()}>
              Copy draft
            </button>
            <button className="button-link secondary" type="button" onClick={clearAddSectionDraft}>
              Clear
            </button>
          </div>
        </div>
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
              window.localStorage.removeItem(ADD_SECTION_DRAFT_KEY);
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
        <h3>Schedule reader</h3>
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
          {busy ? 'Starting...' : 'Read schedule'}
        </button>
      </div>

      <div className="card stack">
        <h3>Lesson segment helper</h3>
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
        <h3>Continuity helper</h3>
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
          <h3>Job Status</h3>
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
              {activeJob.error ? <p className="notice warning">{activeJob.error}</p> : null}
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
                      setError(err instanceof ApiError ? err.message : 'Failed to cancel schedule reader job');
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
                {editingSectionId === section.sectionId ? (
                  <div className="section-inline-edit">
                    <label>
                      Period name
                      <input
                        className="input"
                        value={(sectionDrafts[section.sectionId] ?? sectionToDraft(section)).sectionName}
                        onChange={(event) => updateSectionDraft(section.sectionId, { sectionName: event.target.value })}
                      />
                    </label>
                    <label>
                      Days
                      <input
                        className="input"
                        value={(sectionDrafts[section.sectionId] ?? sectionToDraft(section)).days}
                        onChange={(event) => updateSectionDraft(section.sectionId, { days: event.target.value })}
                        placeholder="Monday, Wednesday, Friday"
                      />
                    </label>
                    <label>
                      Time
                      <input
                        className="input"
                        type="time"
                        value={(sectionDrafts[section.sectionId] ?? sectionToDraft(section)).time}
                        onChange={(event) => updateSectionDraft(section.sectionId, { time: event.target.value })}
                      />
                    </label>
                    <label>
                      Room
                      <input
                        className="input"
                        value={(sectionDrafts[section.sectionId] ?? sectionToDraft(section)).room}
                        onChange={(event) => updateSectionDraft(section.sectionId, { room: event.target.value })}
                      />
                    </label>
                    <div className="profile-actions">
                      <button type="button" disabled={busy} onClick={() => void saveSectionEdit(section)}>
                        Save section
                      </button>
                      <button className="secondary" type="button" onClick={() => setEditingSectionId(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="row">
                      <strong>
                        {section.courseName} - {section.sectionName}
                      </strong>
                      <button className="secondary" type="button" onClick={() => beginSectionEdit(section)}>
                        Edit
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
                  </>
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
