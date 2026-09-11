import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type {
  CalendarImportResponse,
  CourseListResponse,
  SchoolCalendarResponse,
  SchoolOverviewResponse
} from '@teacheros/contracts';
import { CalendarImportResponseSchema } from '@teacheros/contracts';
import { ApiError, useApiClient } from '../lib/api.js';

type ManualDayOff = { title: string; startDate: string; endDate: string };
type SavedEventGroup = {
  title: string;
  type: SchoolCalendarResponse['events'][number]['type'];
  startDate: string;
  endDate: string;
};

const schoolTimezones = [
  ['America/Los_Angeles', 'Pacific Time'],
  ['America/Denver', 'Mountain Time'],
  ['America/Phoenix', 'Arizona Time'],
  ['America/Chicago', 'Central Time'],
  ['America/New_York', 'Eastern Time'],
  ['America/Anchorage', 'Alaska Time'],
  ['Pacific/Honolulu', 'Hawaii Time'],
  ['UTC', 'UTC']
] as const;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Could not read file'));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}
function shortDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(`${value}T12:00:00`));
}
function dateRange(startDate: string, endDate: string) {
  return startDate === endDate
    ? shortDate(startDate)
    : `${shortDate(startDate)} – ${shortDate(endDate)}`;
}
function exceptionKey(event: { startDate: string; endDate: string; type: string; title: string }) {
  return `${event.startDate}|${event.endDate}|${event.type}|${event.title.trim().toLowerCase()}`;
}
function savedEventGroups(events: SchoolCalendarResponse['events']) {
  const sorted = [...events].sort((a, b) =>
    `${a.type}:${a.label}:${a.date}`.localeCompare(`${b.type}:${b.label}:${b.date}`)
  );
  return sorted.reduce<SavedEventGroup[]>((groups, event) => {
    const previous = groups.at(-1);
    const distance = previous
      ? (new Date(`${event.date}T12:00:00Z`).getTime() -
          new Date(`${previous.endDate}T12:00:00Z`).getTime()) /
        86400000
      : Infinity;
    if (previous && previous.title === event.label && previous.type === event.type && distance <= 3)
      previous.endDate = event.date;
    else
      groups.push({
        title: event.label,
        type: event.type,
        startDate: event.date,
        endDate: event.date
      });
    return groups;
  }, []);
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export function SchoolPage() {
  const api = useApiClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const setupFlow = params.get('setup') === '1';
  const schoolInvitationId = params.get('schoolInvitation');
  const [calendar, setCalendar] = useState<SchoolCalendarResponse | null>(null);
  const [overview, setOverview] = useState<SchoolOverviewResponse | null>(null);
  const [courses, setCourses] = useState<CourseListResponse['courses']>([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CalendarImportResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [importProgress, setImportProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [showIgnored, setShowIgnored] = useState(false);
  const [editingSchoolYear, setEditingSchoolYear] = useState(false);
  const [showManualCalendar, setShowManualCalendar] = useState(false);
  const [manualStartDate, setManualStartDate] = useState('');
  const [manualEndDate, setManualEndDate] = useState('');
  const [manualDaysOff, setManualDaysOff] = useState<ManualDayOff[]>([
    { title: '', startDate: '', endDate: '' }
  ]);
  const [editingCalendarEventKey, setEditingCalendarEventKey] = useState<string | null>(null);
  const [savedEventDraft, setSavedEventDraft] = useState<SavedEventGroup | null>(null);
  const [timezone, setTimezone] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [shareMemberId, setShareMemberId] = useState('');
  const [shareCourseId, setShareCourseId] = useState('');

  const load = useCallback(async () => {
    try {
      const [next, school, courseList] = await Promise.all([
        api.getSchoolCalendar(),
        api.getSchoolOverview(),
        api.listCourses()
      ]);
      setCalendar(next);
      setOverview(school);
      setCourses(courseList.courses);
      setTimezone(next.timezone);
      setStartDate(next.schoolYear?.startDate ?? '');
      setEndDate(next.schoolYear?.endDate ?? '');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the school calendar');
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!schoolInvitationId) return;
    setBusy(true);
    setError(null);
    void api
      .acceptSchoolInvitation(schoolInvitationId)
      .then(async (result) => {
        setSaved(`You joined ${result.schoolName}.`);
        await load();
        navigate('/school', { replace: true });
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not accept school invitation.')
      )
      .finally(() => setBusy(false));
  }, [api, load, navigate, schoolInvitationId]);
  const readCalendar = async () => {
    if (!sourceText.trim() && !file) return setError('Paste calendar text or choose a document.');
    try {
      setBusy(true);
      setImportProgress(5);
      setError(null);
      setSaved(null);
      const dataUrl = file ? await readFileAsDataUrl(file) : undefined;
      const input = {
        text: sourceText.trim() || undefined,
        fileBase64: dataUrl,
        fileName: file?.name,
        fileMimeType: file?.type || undefined
      };
      let result: CalendarImportResponse | null = null;
      let queuedJobId: string | null = null;
      try {
        queuedJobId = (await api.enqueueParseSchoolCalendar(input)).jobId;
      } catch (err) {
        if (err instanceof ApiError && [404, 405, 503].includes(err.status)) {
          setImportProgress(null);
          result = await api.importSchoolCalendar(input);
        } else {
          throw err;
        }
      }

      if (queuedJobId) {
        const deadline = Date.now() + 8 * 60_000;
        let complete = false;
        let consecutivePollFailures = 0;

        while (!complete && Date.now() < deadline) {
          let status: Awaited<ReturnType<typeof api.getAiJobStatus>>;
          try {
            status = await api.getAiJobStatus(queuedJobId);
            consecutivePollFailures = 0;
          } catch (err) {
            const retryable =
              err instanceof ApiError &&
              (err.status === 0 || err.status === 408 || err.status >= 500);
            consecutivePollFailures += 1;
            if (retryable && consecutivePollFailures <= 3) {
              await new Promise<void>((resolve) => window.setTimeout(resolve, 2_000));
              continue;
            }
            throw err;
          }
          setImportProgress(status.progressPercent);
          if (status.status === 'succeeded') {
            if (!status.output) throw new Error('The calendar reader finished without a result.');
            result = CalendarImportResponseSchema.parse(status.output);
            complete = true;
          } else if (status.status === 'failed' || status.status === 'cancelled') {
            throw new Error(status.error ?? 'The calendar reader could not finish this import.');
          } else {
            await new Promise<void>((resolve) => window.setTimeout(resolve, 1_500));
          }
        }

        if (!complete) {
          await api.cancelAiJob(queuedJobId).catch(() => undefined);
          throw new Error('The calendar reader took too long. Try a clearer file or pasted text.');
        }
      }
      if (!result) throw new Error('The calendar reader finished without a result.');
      setPreview(result);
      setStartDate(result.schoolYear.startDate);
      setEndDate(result.schoolYear.endDate);
      setSelected(new Set(result.events.filter((event) => !event.needsReview).map(exceptionKey)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not read the school calendar');
    } finally {
      setBusy(false);
      setImportProgress(null);
    }
  };
  const updateManualDayOff = (index: number, patch: Partial<ManualDayOff>) => {
    setManualDaysOff((current) =>
      current.map((event, eventIndex) => (eventIndex === index ? { ...event, ...patch } : event))
    );
  };
  const reviewManualCalendar = () => {
    if (!manualStartDate || !manualEndDate) {
      setError('Add the first and last instructional day.');
      return;
    }
    if (manualEndDate < manualStartDate) {
      setError('The last instructional day must be after the first day.');
      return;
    }

    const completedDaysOff = manualDaysOff.filter(
      (event) => event.title.trim() || event.startDate || event.endDate
    );
    if (
      completedDaysOff.some((event) => !event.title.trim() || !event.startDate || !event.endDate)
    ) {
      setError('Complete the name, start date, and end date for every day off.');
      return;
    }
    if (completedDaysOff.some((event) => event.endDate < event.startDate)) {
      setError('Each day-off end date must be on or after its start date.');
      return;
    }

    const events: CalendarImportResponse['events'] = completedDaysOff.map((event) => ({
      title: event.title.trim(),
      startDate: event.startDate,
      endDate: event.endDate,
      type: 'no_school',
      affectsInstruction: true,
      scheduleKnown: true,
      confidence: 100,
      sourceText: 'Added manually',
      needsReview: false
    }));
    setPreview({
      schoolYear: { startDate: manualStartDate, endDate: manualEndDate, confidence: 100 },
      events,
      overrides: [],
      ignoredEvents: [],
      notices: []
    });
    setStartDate(manualStartDate);
    setEndDate(manualEndDate);
    setSelected(new Set(events.map(exceptionKey)));
    setError(null);
  };
  const toggle = (event: CalendarImportResponse['events'][number]) =>
    setSelected((current) => {
      const next = new Set(current);
      const key = exceptionKey(event);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const saveDates = async () => {
    if (!startDate || !endDate) return;
    try {
      setBusy(true);
      setCalendar(await api.saveSchoolYear({ startDate, endDate }));
      setSaved('School year saved.');
      setEditingSchoolYear(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save school year');
    } finally {
      setBusy(false);
    }
  };
  const commit = async (mode: 'merge' | 'replace') => {
    if (!preview || !startDate || !endDate) return;
    try {
      setBusy(true);
      const events = preview.events.filter((event) => selected.has(exceptionKey(event)));
      const next = await api.commitSchoolCalendar({
        mode,
        schoolYear: { startDate, endDate },
        events,
        overrides: preview.overrides,
        approvedEventKeys: [...selected]
      });
      setCalendar(next);
      setPreview(null);
      setSourceText('');
      setFile(null);
      setSaved(mode === 'replace' ? 'Calendar replaced.' : 'Calendar saved.');
      setError(null);
      await api
        .updatePreferences({ setupStep: 'complete', walkthroughDismissed: false })
        .catch(() => undefined);
      if (setupFlow) navigate('/guide', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the calendar');
    } finally {
      setBusy(false);
    }
  };

  const daysOff =
    preview?.events.filter((event) => event.type === 'no_school' && !event.needsReview) ?? [];
  const specialDays =
    preview?.events.filter((event) => event.type !== 'no_school' && !event.needsReview) ?? [];
  const savedGroups = useMemo(() => savedEventGroups(calendar?.events ?? []), [calendar]);
  const savedDaysOff = savedGroups.filter((event) => event.type === 'no_school');
  const savedSpecialDays = savedGroups.filter((event) => event.type !== 'no_school');
  const hasExistingCalendar = Boolean(calendar?.schoolYear || calendar?.events.length);
  const beginEditingSavedEvent = (event: SavedEventGroup) => {
    setEditingCalendarEventKey(`${event.type}:${event.title}:${event.startDate}:${event.endDate}`);
    setSavedEventDraft({ ...event });
    setError(null);
    setSaved(null);
  };
  const saveEditedEvent = async () => {
    if (!calendar?.schoolYear || !editingCalendarEventKey || !savedEventDraft) return;
    if (!savedEventDraft.title.trim() || !savedEventDraft.startDate || !savedEventDraft.endDate) {
      setError('Add a name, start date, and end date for this calendar event.');
      return;
    }
    if (savedEventDraft.endDate < savedEventDraft.startDate) {
      setError('The event end date must be on or after its start date.');
      return;
    }
    const events: CalendarImportResponse['events'] = savedGroups.map((event) => {
      const key = `${event.type}:${event.title}:${event.startDate}:${event.endDate}`;
      const next = key === editingCalendarEventKey ? savedEventDraft : event;
      return {
        title: next.title.trim(),
        startDate: next.startDate,
        endDate: next.endDate,
        type: next.type,
        affectsInstruction: true,
        scheduleKnown: next.type !== 'no_school',
        confidence: 100,
        sourceText: 'Edited in School Calendar',
        needsReview: false
      };
    });
    try {
      setBusy(true);
      setError(null);
      setCalendar(
        await api.commitSchoolCalendar({
          mode: 'replace',
          schoolYear: {
            startDate: calendar.schoolYear.startDate,
            endDate: calendar.schoolYear.endDate
          },
          events,
          overrides: []
        })
      );
      setEditingCalendarEventKey(null);
      setSavedEventDraft(null);
      setSaved('Calendar event updated.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the calendar event');
    } finally {
      setBusy(false);
    }
  };
  const saveTimezone = async () => {
    try {
      setBusy(true);
      const next = await api.updateSchoolTimezone(timezone);
      setCalendar(next);
      setTimezone(next.timezone);
      setSaved('School timezone saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save school timezone');
    } finally {
      setBusy(false);
    }
  };

  const copyInviteCode = async () => {
    if (!overview) return;
    try {
      await navigator.clipboard.writeText(overview.school.inviteCode);
      setSaved('School invite code copied.');
    } catch {
      setError('Could not copy the code. Select it and copy it manually.');
    }
  };

  const joinSchool = async () => {
    if (!joinCode.trim()) return;
    if (
      !window.confirm(
        'Join the school connected to this code? Your school calendar and directory will switch to that school.'
      )
    )
      return;
    try {
      setBusy(true);
      setError(null);
      const nextOverview = await api.joinSchool({ inviteCode: joinCode.trim() });
      setOverview(nextOverview);
      setJoinCode('');
      setSaved(`Joined ${nextOverview.school.name}.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not join that school.');
    } finally {
      setBusy(false);
    }
  };

  const shareWithSchoolTeacher = async () => {
    const member = overview?.members.find((item) => item.userId === shareMemberId);
    const course = courses.find((item) => item.id === shareCourseId);
    if (!member || !course) return;
    try {
      setBusy(true);
      setError(null);
      await api.inviteCourseCollaborator(course.id, { email: member.email });
      setSaved(`Invitation sent to ${member.fullName ?? member.email} for ${course.name}.`);
      setShareMemberId('');
      setShareCourseId('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not share that course.');
    } finally {
      setBusy(false);
    }
  };

  const ownedCourses = courses.filter((course) => course.accessRole === 'owner');
  const otherMembers = overview?.members.filter((member) => !member.isCurrentUser) ?? [];

  return (
    <div className="school-page stack page-entry">
      <section className="paper-hero">
        <div>
          <p className="eyebrow">Your school</p>
          <h1>{overview?.school.name ?? 'School workspace'}</h1>
          <p>
            {overview
              ? [overview.school.district, overview.school.state].filter(Boolean).join(' · ') ||
                'Plan and share with the teachers at your school.'
              : 'Plan and share with the teachers at your school.'}
          </p>
        </div>
        <div className="school-hero-actions">
          <Link className="button-link secondary" to="/sharing">
            Open sharing
          </Link>
          <Link className="button-link secondary" to="/courses?import=schedule">
            Import schedule
          </Link>
        </div>
      </section>
      {error ? <p className="notice warning">{error}</p> : null}
      {saved ? <p className="notice success">{saved}</p> : null}
      {overview ? (
        <section className="school-community-grid" aria-label="School community">
          <article className="card school-people-card">
            <div className="school-section-heading">
              <div>
                <p className="eyebrow">People</p>
                <h2>{overview.school.memberCount} teachers at your school</h2>
                <p>Share a live curriculum with a colleague without typing their email.</p>
              </div>
            </div>
            <div className="school-member-list">
              {overview.members.map((member) => (
                <div key={member.userId} className="school-member-row">
                  <span className="school-member-avatar" aria-hidden="true">
                    {initials(member.fullName ?? member.email)}
                  </span>
                  <div>
                    <strong>
                      {member.fullName ?? member.email}
                      {member.isCurrentUser ? ' (you)' : ''}
                    </strong>
                    <span>
                      {member.subjects.length ? member.subjects.join(', ') : member.email}
                    </span>
                  </div>
                  <em>{member.role.replaceAll('_', ' ')}</em>
                </div>
              ))}
            </div>
            {otherMembers.length && ownedCourses.length ? (
              <div className="school-quick-share">
                <label>
                  Teacher
                  <select
                    className="input"
                    value={shareMemberId}
                    onChange={(event) => setShareMemberId(event.target.value)}
                  >
                    <option value="">Choose a teacher…</option>
                    {otherMembers.map((member) => (
                      <option key={member.userId} value={member.userId}>
                        {member.fullName ?? member.email}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Curriculum
                  <select
                    className="input"
                    value={shareCourseId}
                    onChange={(event) => setShareCourseId(event.target.value)}
                  >
                    <option value="">Choose your course…</option>
                    {ownedCourses.map((course) => (
                      <option key={course.id} value={course.id}>
                        {course.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={busy || !shareMemberId || !shareCourseId}
                  onClick={() => void shareWithSchoolTeacher()}
                >
                  Send invitation
                </button>
              </div>
            ) : null}
          </article>

          <article className="card school-library-card">
            <div className="school-section-heading">
              <div>
                <p className="eyebrow">Curriculum library</p>
                <h2>Shared at {overview.school.name}</h2>
                <p>Preview a colleague’s curriculum, then add a copy or fill an empty course.</p>
              </div>
              <Link to="/sharing">Share yours →</Link>
            </div>
            <div className="school-library-list">
              {overview.curriculumLibrary.length ? (
                overview.curriculumLibrary.map((course) => (
                  <div key={course.courseId} className="school-library-row">
                    <div>
                      <strong>{course.name}</strong>
                      <span>
                        {[course.subject, course.gradeLevel].filter(Boolean).join(' · ') ||
                          'Curriculum'}{' '}
                        · {course.unitCount} units · {course.lessonCount} lessons
                      </span>
                      <small>Shared by {course.owner.fullName ?? course.owner.email}</small>
                    </div>
                    {course.alreadyAdded ? (
                      <span className="status-pill done">Added</span>
                    ) : (
                      <Link
                        className="button-link secondary"
                        to={`/shared/curriculum/${course.token}`}
                      >
                        Preview & add
                      </Link>
                    )}
                  </div>
                ))
              ) : (
                <div className="school-library-empty">
                  <strong>No curricula have been shared with the school yet.</strong>
                  <span>Course owners can add one from the Sharing page.</span>
                </div>
              )}
            </div>
          </article>

          <article className="card school-access-card">
            <div>
              <p className="eyebrow">Invite code</p>
              <h2>Bring teachers into this school</h2>
              <p>
                Share this code with a TeacherDesk user so they can join this directory and
                calendar.
              </p>
            </div>
            <div className="school-invite-code">
              <code>{overview.school.inviteCode}</code>
              <button className="secondary" type="button" onClick={() => void copyInviteCode()}>
                Copy code
              </button>
            </div>
            <details>
              <summary>Join a different school</summary>
              <div className="school-join-form">
                <input
                  className="input"
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                  placeholder="Enter invite code"
                  aria-label="School invite code"
                />
                <button
                  type="button"
                  disabled={busy || !joinCode.trim()}
                  onClick={() => void joinSchool()}
                >
                  Join school
                </button>
              </div>
            </details>
          </article>
        </section>
      ) : null}
      <div className="school-calendar-heading">
        <div>
          <p className="eyebrow">Shared calendar</p>
          <h2>Instructional calendar</h2>
        </div>
        <p>Changes here apply to every teacher at this school.</p>
      </div>
      {!preview ? (
        <>
          <section className="card stack calendar-import-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">{hasExistingCalendar ? 'Update' : 'Start here'}</p>
                <h2>
                  {hasExistingCalendar ? 'Import Updated Calendar' : 'Import School Calendar'}
                </h2>
                <p>
                  Upload a file or image, or paste calendar text. We’ll identify the instructional
                  year first.
                </p>
              </div>
            </div>
            <textarea
              rows={5}
              value={sourceText}
              onChange={(event) => setSourceText(event.target.value)}
              placeholder="Paste a school calendar…"
            />
            <div className="profile-actions">
              <input
                type="file"
                accept="application/pdf,image/*,.doc,.docx"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              {file ? <span className="status-pill upcoming">{file.name}</span> : null}
              <button
                type="button"
                disabled={busy || (!sourceText.trim() && !file)}
                onClick={() => void readCalendar()}
              >
                {busy ? (
                  <>
                    <span className="calendar-reader-dot" />
                    Reading your calendar
                    {importProgress === null ? '…' : `, ${importProgress}%`}
                  </>
                ) : (
                  'Read Calendar'
                )}
              </button>
            </div>
          </section>
          <section className="card stack manual-calendar-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Manual option</p>
                <h2>Set up the school calendar yourself</h2>
                <p>
                  Enter the instructional year and any days students are off. You can review before
                  saving.
                </p>
              </div>
              <button
                className="secondary"
                type="button"
                aria-expanded={showManualCalendar}
                onClick={() => setShowManualCalendar((shown) => !shown)}
              >
                {showManualCalendar ? 'Hide manual entry' : 'Enter calendar manually'}
              </button>
            </div>
            {showManualCalendar ? (
              <div className="stack">
                <div className="profile-form-grid">
                  <label>
                    First instructional day
                    <input
                      className="input"
                      type="date"
                      value={manualStartDate}
                      onChange={(event) => setManualStartDate(event.target.value)}
                    />
                  </label>
                  <label>
                    Last instructional day
                    <input
                      className="input"
                      type="date"
                      value={manualEndDate}
                      onChange={(event) => setManualEndDate(event.target.value)}
                    />
                  </label>
                </div>
                <div className="manual-days-off-list">
                  <div>
                    <p className="eyebrow">Days off</p>
                    <p className="muted">
                      Add a single day or a break date range. This is optional.
                    </p>
                  </div>
                  {manualDaysOff.map((event, index) => (
                    <div
                      className="profile-form-grid manual-day-off-row"
                      key={`manual-day-off-${index}`}
                    >
                      <label>
                        Day off or break name
                        <input
                          className="input"
                          value={event.title}
                          placeholder="Winter Break"
                          onChange={(input) =>
                            updateManualDayOff(index, { title: input.target.value })
                          }
                        />
                      </label>
                      <label>
                        Starts
                        <input
                          className="input"
                          type="date"
                          value={event.startDate}
                          onChange={(input) =>
                            updateManualDayOff(index, { startDate: input.target.value })
                          }
                        />
                      </label>
                      <label>
                        Ends
                        <input
                          className="input"
                          type="date"
                          value={event.endDate}
                          onChange={(input) =>
                            updateManualDayOff(index, { endDate: input.target.value })
                          }
                        />
                      </label>
                      {manualDaysOff.length > 1 ? (
                        <button
                          className="secondary"
                          type="button"
                          onClick={() =>
                            setManualDaysOff((current) =>
                              current.filter((_, eventIndex) => eventIndex !== index)
                            )
                          }
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
                <div className="profile-actions">
                  <button
                    className="secondary"
                    type="button"
                    onClick={() =>
                      setManualDaysOff((current) => [
                        ...current,
                        { title: '', startDate: '', endDate: '' }
                      ])
                    }
                  >
                    Add a day off
                  </button>
                  <button type="button" onClick={reviewManualCalendar}>
                    Review manual calendar
                  </button>
                </div>
              </div>
            ) : null}
          </section>
          {calendar?.schoolYear ? (
            <section className="school-grid">
              <article className="card stack calendar-saved-year">
                <div>
                  <p className="eyebrow">School Year</p>
                  {editingSchoolYear ? (
                    <div className="profile-form-grid">
                      <label>
                        First day
                        <input
                          className="input"
                          type="date"
                          value={startDate}
                          onChange={(event) => setStartDate(event.target.value)}
                        />
                      </label>
                      <label>
                        Last day
                        <input
                          className="input"
                          type="date"
                          value={endDate}
                          onChange={(event) => setEndDate(event.target.value)}
                        />
                      </label>
                    </div>
                  ) : (
                    <h2>
                      {shortDate(calendar.schoolYear.startDate)} <span>→</span>{' '}
                      {shortDate(calendar.schoolYear.endDate)}
                    </h2>
                  )}
                </div>
                <div className="profile-actions">
                  {editingSchoolYear ? (
                    <>
                      <button type="button" disabled={busy} onClick={() => void saveDates()}>
                        Save
                      </button>
                      <button
                        className="secondary"
                        type="button"
                        onClick={() => setEditingSchoolYear(false)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => setEditingSchoolYear(true)}
                    >
                      Edit
                    </button>
                  )}
                </div>
              </article>
              <article className="card stack">
                <div>
                  <p className="eyebrow">Breaks & special days</p>
                  <h2>
                    {savedDaysOff.length} Days Off <span>·</span> {savedSpecialDays.length} Special
                    Schedule Days
                  </h2>
                </div>
                <div className="saved-calendar-event-groups">
                  {[...savedDaysOff, ...savedSpecialDays].map((event) => {
                    const key = `${event.type}:${event.title}:${event.startDate}:${event.endDate}`;
                    const editing = editingCalendarEventKey === key ? savedEventDraft : null;
                    return (
                      <div className="saved-calendar-event" key={key}>
                        {editing ? (
                          <div className="saved-calendar-event-form">
                            <label>
                              Name
                              <input
                                className="input"
                                value={editing.title}
                                onChange={(input) =>
                                  setSavedEventDraft({
                                    ...editing,
                                    title: input.target.value
                                  })
                                }
                              />
                            </label>
                            <label>
                              Starts
                              <input
                                className="input"
                                type="date"
                                value={editing.startDate}
                                onChange={(input) =>
                                  setSavedEventDraft({
                                    ...editing,
                                    startDate: input.target.value
                                  })
                                }
                              />
                            </label>
                            <label>
                              Ends
                              <input
                                className="input"
                                type="date"
                                value={editing.endDate}
                                onChange={(input) =>
                                  setSavedEventDraft({
                                    ...editing,
                                    endDate: input.target.value
                                  })
                                }
                              />
                            </label>
                            <div className="profile-actions">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void saveEditedEvent()}
                              >
                                Save
                              </button>
                              <button
                                className="secondary"
                                type="button"
                                onClick={() => {
                                  setEditingCalendarEventKey(null);
                                  setSavedEventDraft(null);
                                }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div>
                              <strong>{event.title}</strong>
                              <span>{dateRange(event.startDate, event.endDate)}</span>
                              <small>
                                {event.type === 'no_school'
                                  ? 'No school'
                                  : event.type.replaceAll('_', ' ')}
                              </small>
                            </div>
                            <button
                              className="secondary"
                              type="button"
                              onClick={() => beginEditingSavedEvent(event)}
                            >
                              Edit
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })}
                  {!savedGroups.length ? (
                    <span className="muted">No breaks or special days have been added.</span>
                  ) : null}
                </div>
              </article>
            </section>
          ) : null}
        </>
      ) : (
        <section className="calendar-review stack" aria-live="polite">
          <header className="calendar-ready-heading">
            <div>
              <p className="eyebrow">Calendar Ready</p>
              <h2>Review the instructional calendar</h2>
              <p>Only dates that cancel or change normal student instruction are included.</p>
            </div>
          </header>
          <article className="card calendar-year-review">
            <div>
              <div>
                <p className="eyebrow">School Year</p>
                <strong>First Day</strong>
                <input
                  className="input"
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </div>
              <span className="calendar-arrow">→</span>
              <div>
                <strong>Last Day</strong>
                <input
                  className="input"
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </div>
            </div>
          </article>
          {daysOff.length ? (
            <CalendarSection
              title="Days Off"
              events={daysOff}
              selected={selected}
              onToggle={toggle}
            />
          ) : null}
          {specialDays.length ? (
            <CalendarSection
              title="Special Days"
              events={specialDays}
              selected={selected}
              onToggle={toggle}
            />
          ) : null}
          {preview.events
            .filter((event) => event.needsReview)
            .map((event) => (
              <article className="card calendar-needs-review" key={exceptionKey(event)}>
                <p className="eyebrow">Needs review</p>
                <h3>{event.title}</h3>
                <p>{dateRange(event.startDate, event.endDate)} · Do students have class?</p>
                <div className="profile-actions">
                  <button
                    type="button"
                    className={selected.has(exceptionKey(event)) ? '' : 'secondary'}
                    onClick={() =>
                      setSelected((current) => new Set(current).add(exceptionKey(event)))
                    }
                  >
                    No School
                  </button>
                  <button
                    type="button"
                    className={!selected.has(exceptionKey(event)) ? '' : 'secondary'}
                    onClick={() =>
                      setSelected((current) => {
                        const next = new Set(current);
                        next.delete(exceptionKey(event));
                        return next;
                      })
                    }
                  >
                    Normal School
                  </button>
                </div>
              </article>
            ))}
          {preview.ignoredEvents.length ? (
            <details
              className="calendar-ignored"
              open={showIgnored}
              onToggle={(event) => setShowIgnored((event.target as HTMLDetailsElement).open)}
            >
              <summary>
                {preview.ignoredEvents.length} ignored{' '}
                {preview.ignoredEvents.length === 1 ? 'event' : 'events'}
              </summary>
              <div>
                {preview.ignoredEvents.map((event, index) => (
                  <p key={`${event.title}-${index}`}>
                    <strong>{event.title}</strong>
                    {event.date ? ` · ${shortDate(event.date)}` : ''}
                    <span>{event.reason}</span>
                  </p>
                ))}
              </div>
            </details>
          ) : null}
          <div className="profile-actions calendar-review-actions">
            <button
              type="button"
              disabled={busy || !startDate || !endDate}
              onClick={() => void commit('merge')}
            >
              {hasExistingCalendar ? 'Update Calendar' : 'Save Calendar'}
            </button>
            {hasExistingCalendar ? (
              <button
                className="secondary"
                type="button"
                disabled={busy || !startDate || !endDate}
                onClick={() => void commit('replace')}
              >
                Replace Calendar
              </button>
            ) : null}
            <button className="button-link" type="button" onClick={() => setPreview(null)}>
              Cancel
            </button>
          </div>
        </section>
      )}
      <section className="card timezone-card">
        <div>
          <h2>School timezone</h2>
        </div>
        <div className="profile-actions">
          <select
            className="input"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            aria-label="School timezone"
          >
            {schoolTimezones.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !timezone.trim()}
            onClick={() => void saveTimezone()}
          >
            Save timezone
          </button>
        </div>
      </section>
    </div>
  );
}
function CalendarSection({
  title,
  events,
  selected,
  onToggle
}: {
  title: string;
  events: CalendarImportResponse['events'];
  selected: Set<string>;
  onToggle: (event: CalendarImportResponse['events'][number]) => void;
}) {
  return (
    <article className="card calendar-event-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{title}</p>
          <h2>
            {events.length} {events.length === 1 ? 'date' : 'dates found'}
          </h2>
        </div>
      </div>
      <div className="calendar-event-rows">
        {events.map((event) => (
          <label key={exceptionKey(event)} className="calendar-event-row">
            <input
              type="checkbox"
              checked={selected.has(exceptionKey(event))}
              onChange={() => onToggle(event)}
            />
            <div>
              <strong>{event.title}</strong>
              <span>{dateRange(event.startDate, event.endDate)}</span>
            </div>
            <em>{event.type === 'no_school' ? 'No School' : event.type.replaceAll('_', ' ')}</em>
          </label>
        ))}
      </div>
    </article>
  );
}
