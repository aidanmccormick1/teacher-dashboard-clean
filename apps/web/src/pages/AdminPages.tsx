import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type {
  AdminCalendarResponse,
  AdminCourseDetailResponse,
  AdminScheduleResponse,
  AdminTeacherDetailResponse,
  CalendarCommitRequest,
  ProfileResponse
} from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';
import { useAdminAccessOverview } from '../components/AdminShell.js';

const scheduleDays = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'A-Day',
  'B-Day'
] as const;
const calendarEventTypes = [
  ['no_school', 'No school'],
  ['minimum_day', 'Minimum day'],
  ['half_day', 'Half day'],
  ['early_release', 'Early release'],
  ['late_start', 'Late start'],
  ['testing', 'Testing'],
  ['testing_schedule', 'Testing schedule'],
  ['special_schedule', 'Special schedule'],
  ['other_abnormal', 'Other abnormal schedule'],
  ['other', 'Other']
] as const;

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(`${value}T12:00:00`));
}

function formatTime(value: string | null) {
  if (!value) return 'Time not set';
  const [hourText, minute] = value.slice(0, 5).split(':');
  const hour = Number(hourText);
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function isoDateForLocalDay(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addLocalDays(value: Date, days: number) {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
}

function displayName(fullName: string | null, email: string) {
  return fullName?.trim() || email;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="card admin-state" role="alert">
      <p className="eyebrow">Something went wrong</p>
      <p>{message}</p>
      <button type="button" onClick={onRetry}>
        Try again
      </button>
    </section>
  );
}

function LoadingState({ label = 'Loading school information' }: { label?: string }) {
  return (
    <section className="card admin-state" aria-busy="true">
      <p className="eyebrow">School operations</p>
      <p>{label}…</p>
    </section>
  );
}

function AdminPageHeader({
  eyebrow,
  title,
  description,
  action
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="admin-page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      {action ? <div className="admin-header-action">{action}</div> : null}
    </header>
  );
}

function CountCard({
  label,
  value,
  href,
  detail
}: {
  label: string;
  value: number;
  href: string;
  detail: string;
}) {
  return (
    <Link className="card admin-count-card" to={href}>
      <span className="eyebrow">{label}</span>
      <strong>{value}</strong>
      <span className="muted">{detail}</span>
    </Link>
  );
}

export function AdminOverviewPage() {
  const overview = useAdminAccessOverview();
  return (
    <div className="admin-page stack page-entry">
      <AdminPageHeader
        eyebrow="Administrator overview"
        title={overview.school.name}
        description="A school-scoped view of planning infrastructure, schedules, and shared curriculum."
        action={
          <Link className="button-link secondary" to="/admin/school">
            School settings
          </Link>
        }
      />
      <section className="admin-count-grid" aria-label="School status">
        <CountCard
          label="Teachers"
          value={overview.counts.teachers}
          href="/admin/teachers"
          detail="Active teaching members"
        />
        <CountCard
          label="Courses"
          value={overview.counts.courses}
          href="/admin/courses"
          detail="Active school courses"
        />
        <CountCard
          label="Sections"
          value={overview.counts.sections}
          href="/admin/schedule"
          detail="Class groups with school context"
        />
        <CountCard
          label="Curriculum connected"
          value={overview.counts.coursesWithCurriculum}
          href="/admin/curriculum"
          detail="Courses with units"
        />
        <CountCard
          label="Schedule setup"
          value={overview.counts.teachersWithSchedule}
          href="/admin/schedule"
          detail={`of ${overview.counts.teachers} teachers`}
        />
        <CountCard
          label="Shared curricula"
          value={overview.counts.schoolSharedCurricula}
          href="/admin/curriculum"
          detail="Visible to the school"
        />
      </section>
      <section className="admin-overview-grid">
        <article className="card admin-status-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">School calendar</p>
              <h2>{overview.calendar.configured ? 'Configured' : 'Needs setup'}</h2>
            </div>
            <Link to="/admin/calendar">Open calendar</Link>
          </div>
          <p className="muted">
            {overview.calendar.schoolYear
              ? `${formatDate(overview.calendar.schoolYear.startDate)} – ${formatDate(overview.calendar.schoolYear.endDate)}`
              : 'Set the instructional year and shared exceptions.'}
          </p>
        </article>
        <article className="card admin-status-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Invite policy</p>
              <h2>
                {overview.school.invitePolicy === 'admin_only'
                  ? 'Administrators only'
                  : overview.school.invitePolicy === 'code'
                    ? 'Invite code'
                    : 'Members and administrators'}
              </h2>
            </div>
            <Link to="/admin/school">Manage</Link>
          </div>
          <p className="muted">
            Claim status: {overview.school.claimStatus === 'claimed' ? 'Claimed' : 'Unclaimed'}.
          </p>
        </article>
      </section>
      <section className="card admin-boundary-note">
        <p className="eyebrow">Visibility boundary</p>
        <p>
          Administrator views include school-level setup and shared curriculum only. Teacher notes,
          private planning, classroom history, and private AI data remain outside this workspace.
        </p>
      </section>
    </div>
  );
}

export function AdminTeachersPage() {
  const api = useApiClient();
  const [teachers, setTeachers] = useState<
    Awaited<ReturnType<typeof api.getAdminTeachers>>['teachers']
  >([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const load = () => {
    setState('loading');
    void api
      .getAdminTeachers()
      .then((result) => {
        setTeachers(result.teachers);
        setState('ready');
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Could not load teachers.');
        setState('error');
      });
  };
  useEffect(load, [api]);
  if (state === 'loading')
    return (
      <div className="admin-page stack">
        <AdminPageHeader
          eyebrow="People"
          title="Teachers"
          description="See school members and high-level setup status."
        />
        <LoadingState label="Loading the teacher roster" />
      </div>
    );
  if (state === 'error')
    return (
      <div className="admin-page stack">
        <AdminPageHeader
          eyebrow="People"
          title="Teachers"
          description="See school members and high-level setup status."
        />
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  return (
    <div className="admin-page stack page-entry">
      <AdminPageHeader
        eyebrow="People"
        title="Teachers"
        description="Courses, sections, schedule setup, and shared curriculum connections—without private classroom details."
      />
      {teachers.length ? (
        <div className="admin-record-list">
          {teachers.map((teacher) => (
            <Link
              className="card admin-record"
              to={`/admin/teachers/${teacher.userId}`}
              key={teacher.userId}
            >
              <div className="admin-record-main">
                <span className="admin-avatar" aria-hidden="true">
                  {(teacher.fullName ?? teacher.email).slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <strong>{displayName(teacher.fullName, teacher.email)}</strong>
                  <small>{teacher.email}</small>
                  <small>
                    {teacher.membershipStatus === 'active' ? 'Active member' : 'Inactive member'}
                  </small>
                </span>
              </div>
              <div className="admin-record-stats">
                <span>
                  <strong>{teacher.courseCount}</strong>
                  <small>Courses</small>
                </span>
                <span>
                  <strong>{teacher.sectionCount}</strong>
                  <small>Sections</small>
                </span>
                <span>
                  <strong>{teacher.scheduledSectionCount}</strong>
                  <small>Scheduled</small>
                </span>
                <span>
                  <strong>{teacher.curriculumCount}</strong>
                  <small>Curriculum</small>
                </span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <section className="card admin-empty">
          <h2>No teachers yet</h2>
          <p className="muted">Teachers will appear here after they join this school.</p>
        </section>
      )}
    </div>
  );
}

export function AdminTeacherDetailPage() {
  const api = useApiClient();
  const { teacherId = '' } = useParams();
  const [detail, setDetail] = useState<AdminTeacherDetailResponse | null>(null);
  const [error, setError] = useState('');
  const [statusSaving, setStatusSaving] = useState(false);
  const load = () => {
    setError('');
    void api
      .getAdminTeacher(teacherId)
      .then(setDetail)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not load this teacher.')
      );
  };
  useEffect(load, [api, teacherId]);
  const updateMembershipStatus = async () => {
    if (!detail) return;
    setStatusSaving(true);
    setError('');
    try {
      await api.updateAdminMemberStatus(teacherId, {
        status: detail.teacher.membershipStatus === 'active' ? 'inactive' : 'active'
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update membership status.');
    } finally {
      setStatusSaving(false);
    }
  };
  if (error)
    return (
      <div className="admin-page stack">
        <Link to="/admin/teachers">← Teachers</Link>
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  if (!detail)
    return (
      <div className="admin-page stack">
        <LoadingState label="Loading teacher details" />
      </div>
    );
  const teacher = detail.teacher;
  return (
    <div className="admin-page stack page-entry">
      <Link to="/admin/teachers">← Teachers</Link>
      <AdminPageHeader
        eyebrow="Teacher detail"
        title={displayName(teacher.fullName, teacher.email)}
        description={`${teacher.email} · ${teacher.membershipStatus === 'active' ? 'Active member' : 'Inactive member'}`}
      />
      <section className="card admin-action-strip">
        <div>
          <strong>School membership</strong>
          <p className="muted">
            Deactivating removes school access without deleting the teacher’s account or history.
          </p>
        </div>
        <button
          className="secondary"
          type="button"
          disabled={statusSaving}
          onClick={() => void updateMembershipStatus()}
        >
          {statusSaving
            ? 'Saving…'
            : teacher.membershipStatus === 'active'
              ? 'Deactivate membership'
              : 'Restore membership'}
        </button>
      </section>
      <section className="admin-count-grid admin-count-grid-small">
        <div className="card admin-stat">
          <strong>{teacher.courseCount}</strong>
          <span>Courses</span>
        </div>
        <div className="card admin-stat">
          <strong>{teacher.sectionCount}</strong>
          <span>Sections</span>
        </div>
        <div className="card admin-stat">
          <strong>{teacher.scheduledSectionCount}</strong>
          <span>Scheduled sections</span>
        </div>
        <div className="card admin-stat">
          <strong>{teacher.curriculumCount}</strong>
          <span>Curriculum links</span>
        </div>
      </section>
      <section className="admin-detail-grid">
        <article className="card">
          <p className="eyebrow">Courses</p>
          <h2>Courses taught</h2>
          {teacher.courses.length ? (
            <ul className="admin-simple-list">
              {teacher.courses.map((course) => (
                <li key={course.id}>
                  <span>
                    <strong>{course.name}</strong>
                    <small>
                      {[course.subject, course.gradeLevel].filter(Boolean).join(' · ') ||
                        'Course details not listed'}
                    </small>
                  </span>
                  <small>{course.archivedAt ? 'Archived' : 'Active'}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No courses are attached to this teacher.</p>
          )}
        </article>
        <article className="card">
          <p className="eyebrow">Sections</p>
          <h2>Teaching schedule</h2>
          {teacher.sections.length ? (
            <ul className="admin-simple-list">
              {teacher.sections.map((section) => (
                <li key={section.id}>
                  <span>
                    <strong>
                      {section.courseName} · {section.name}
                    </strong>
                    <small>
                      {section.meetings.length
                        ? section.meetings
                            .map(
                              (meeting) =>
                                `${meeting.day} ${formatTime(meeting.time)}${meeting.room ? ` · ${meeting.room}` : ''}`
                            )
                            .join(' · ')
                        : 'Schedule not set'}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No sections are attached to this teacher.</p>
          )}
        </article>
      </section>
    </div>
  );
}

export function AdminCoursesPage() {
  const api = useApiClient();
  const [courses, setCourses] = useState<
    Awaited<ReturnType<typeof api.getAdminCourses>>['courses']
  >([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const load = () => {
    setState('loading');
    void api
      .getAdminCourses()
      .then((result) => {
        setCourses(result.courses);
        setState('ready');
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Could not load courses.');
        setState('error');
      });
  };
  useEffect(load, [api]);
  if (state === 'loading')
    return (
      <div className="admin-page stack">
        <AdminPageHeader
          eyebrow="Instruction"
          title="Courses"
          description="See active and archived course records without merging teachers by name."
        />
        <LoadingState label="Loading courses" />
      </div>
    );
  if (state === 'error')
    return (
      <div className="admin-page stack">
        <AdminPageHeader
          eyebrow="Instruction"
          title="Courses"
          description="See active and archived course records without merging teachers by name."
        />
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  return (
    <div className="admin-page stack page-entry">
      <AdminPageHeader
        eyebrow="Instruction"
        title="Courses"
        description="Course records, teachers, sections, and high-level curriculum structure."
      />
      {courses.length ? (
        <div className="admin-record-list">
          {courses.map((course) => (
            <Link
              className="card admin-record admin-course-record"
              to={`/admin/courses/${course.id}`}
              key={course.id}
            >
              <div>
                <strong>{course.name}</strong>
                <small>
                  {[course.subject, course.gradeLevel].filter(Boolean).join(' · ') ||
                    'Subject and grade not listed'}
                </small>
                <small>
                  {course.teachers
                    .map((teacher) => displayName(teacher.fullName, teacher.email))
                    .join(', ') || 'No teacher listed'}
                </small>
              </div>
              <div className="admin-record-stats">
                <span>
                  <strong>{course.teacherCount}</strong>
                  <small>Teachers</small>
                </span>
                <span>
                  <strong>{course.sectionCount}</strong>
                  <small>Sections</small>
                </span>
                <span>
                  <strong>{course.unitCount}</strong>
                  <small>Units</small>
                </span>
                <span>
                  <strong>{course.archivedAt ? 'Archived' : 'Active'}</strong>
                  <small>Status</small>
                </span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <section className="card admin-empty">
          <h2>No courses yet</h2>
          <p className="muted">
            Course records will appear when teachers build their teaching workspace.
          </p>
        </section>
      )}
    </div>
  );
}

export function AdminCourseDetailPage() {
  const api = useApiClient();
  const { courseId = '' } = useParams();
  const [detail, setDetail] = useState<AdminCourseDetailResponse | null>(null);
  const [error, setError] = useState('');
  const load = () => {
    setError('');
    void api
      .getAdminCourse(courseId)
      .then(setDetail)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not load this course.')
      );
  };
  useEffect(load, [api, courseId]);
  if (error)
    return (
      <div className="admin-page stack">
        <Link to="/admin/courses">← Courses</Link>
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  if (!detail)
    return (
      <div className="admin-page stack">
        <LoadingState label="Loading course detail" />
      </div>
    );
  const course = detail.course;
  return (
    <div className="admin-page stack page-entry">
      <Link to="/admin/courses">← Courses</Link>
      <AdminPageHeader
        eyebrow="Course detail"
        title={course.name}
        description={
          [course.subject, course.gradeLevel].filter(Boolean).join(' · ') || 'School course'
        }
      />
      <section className="admin-count-grid admin-count-grid-small">
        <div className="card admin-stat">
          <strong>{course.teacherCount}</strong>
          <span>Teachers</span>
        </div>
        <div className="card admin-stat">
          <strong>{course.sectionCount}</strong>
          <span>Sections</span>
        </div>
        <div className="card admin-stat">
          <strong>{course.unitCount}</strong>
          <span>Units</span>
        </div>
        <div className="card admin-stat">
          <strong>{course.lessonCount}</strong>
          <span>Lessons</span>
        </div>
      </section>
      <section className="admin-detail-grid">
        <article className="card">
          <p className="eyebrow">Year plan visibility</p>
          <h2>Units and planned ranges</h2>
          {course.units.length ? (
            <ul className="admin-simple-list">
              {course.units.map((unit) => (
                <li key={unit.id}>
                  <span>
                    <strong>
                      {unit.orderIndex + 1}. {unit.title}
                    </strong>
                    <small>
                      {unit.lessonCount} {unit.lessonCount === 1 ? 'lesson' : 'lessons'} ·{' '}
                      {unit.plannedMeetingCount
                        ? `${unit.plannedMeetingCount} planned meetings`
                        : 'No meeting range set'}
                    </small>
                    <small>
                      {unit.projectedStartDate && unit.projectedEndDate
                        ? `Projected ${formatDate(unit.projectedStartDate)} – ${formatDate(unit.projectedEndDate)}`
                        : 'No projected dates'}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No shared curriculum structure is attached.</p>
          )}
          <p className="field-help">
            This is visibility into the shared curriculum plan. It does not edit a teacher’s
            personal Year Plan.
          </p>
        </article>
        <article className="card">
          <p className="eyebrow">Sections</p>
          <h2>Class groups</h2>
          {course.sections.length ? (
            <ul className="admin-simple-list">
              {course.sections.map((section) => (
                <li key={section.id}>
                  <span>
                    <strong>{section.name}</strong>
                    <small>
                      {displayName(section.teacherName, 'Teacher')} ·{' '}
                      {section.meetings.length
                        ? section.meetings
                            .map((meeting) => `${meeting.day} ${formatTime(meeting.time)}`)
                            .join(' · ')
                        : 'Schedule not set'}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No class groups are attached.</p>
          )}
        </article>
      </section>
    </div>
  );
}

export function AdminSchedulePage() {
  const api = useApiClient();
  const [teachers, setTeachers] = useState<
    Awaited<ReturnType<typeof api.getAdminTeachers>>['teachers']
  >([]);
  const [courses, setCourses] = useState<
    Awaited<ReturnType<typeof api.getAdminCourses>>['courses']
  >([]);
  const [result, setResult] = useState<AdminScheduleResponse | null>(null);
  const [day, setDay] = useState<AdminScheduleResponse['entries'][number]['day'] | ''>('');
  const [teacherId, setTeacherId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [range, setRange] = useState<'today' | 'week' | 'year'>('week');
  const [error, setError] = useState('');
  useEffect(() => {
    void Promise.all([api.getAdminTeachers(), api.getAdminCourses()])
      .then(([teacherResult, courseResult]) => {
        setTeachers(teacherResult.teachers);
        setCourses(courseResult.courses);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not load schedule filters.')
      );
  }, [api]);
  useEffect(() => {
    const today = new Date();
    const startDate = isoDateForLocalDay(today);
    const endDate = range === 'today' ? startDate : isoDateForLocalDay(addLocalDays(today, 6));
    void api
      .getAdminSchedule({
        ...(day ? { day } : {}),
        ...(teacherId ? { teacherId } : {}),
        ...(courseId ? { courseId } : {}),
        ...(range === 'year' ? {} : { startDate, endDate })
      })
      .then(setResult)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not load the schedule.')
      );
  }, [api, day, teacherId, courseId, range]);
  const grouped = new Map<string, AdminScheduleResponse['entries']>();
  for (const entry of result?.entries ?? [])
    grouped.set(entry.day, [...(grouped.get(entry.day) ?? []), entry]);
  return (
    <div className="admin-page stack page-entry">
      <AdminPageHeader
        eyebrow="Operations"
        title="Schedule"
        description="Who is teaching what, and when? This view uses the existing course → section → meeting model."
      />
      <section className="card admin-filter-bar">
        <label>
          Date window
          <select
            className="input"
            value={range}
            onChange={(event) => setRange(event.target.value as typeof range)}
          >
            <option value="today">Today</option>
            <option value="week">Next 7 days</option>
            <option value="year">Academic year</option>
          </select>
        </label>
        <label>
          Day
          <select
            className="input"
            value={day}
            onChange={(event) => setDay(event.target.value as typeof day)}
          >
            <option value="">All days</option>
            {scheduleDays.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          Teacher
          <select
            className="input"
            value={teacherId}
            onChange={(event) => setTeacherId(event.target.value)}
          >
            <option value="">All teachers</option>
            {teachers.map((teacher) => (
              <option key={teacher.userId} value={teacher.userId}>
                {displayName(teacher.fullName, teacher.email)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Course
          <select
            className="input"
            value={courseId}
            onChange={(event) => setCourseId(event.target.value)}
          >
            <option value="">All courses</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.name}
              </option>
            ))}
          </select>
        </label>
      </section>
      {error ? (
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      ) : result ? (
        result.entries.length ? (
          <div className="admin-schedule-grid">
            {[...grouped.entries()].map(([groupDay, entries]) => (
              <section className="card admin-day-card" key={groupDay}>
                <div className="section-heading">
                  <h2>{groupDay}</h2>
                  <span className="muted">
                    {entries.length} {entries.length === 1 ? 'meeting' : 'meetings'}
                  </span>
                </div>
                <ul className="admin-schedule-list">
                  {entries.map((entry) => (
                    <li
                      key={`${entry.sectionId}-${entry.date ?? entry.day}-${entry.startTime}-${entry.endTime}`}
                    >
                      <time>
                        {formatTime(entry.startTime)}
                        {entry.endTime ? ` – ${formatTime(entry.endTime)}` : ''}
                      </time>
                      <span>
                        <strong>
                          <Link to={`/admin/courses/${entry.courseId}`}>{entry.courseName}</Link> ·{' '}
                          {entry.sectionName}
                        </strong>
                        <small>
                          {entry.date ? `${entry.date} · ` : ''}
                          <Link to={`/admin/teachers/${entry.teacherId}`}>
                            {displayName(entry.teacherName, entry.teacherEmail)}
                          </Link>
                          {entry.room ? ` · ${entry.room}` : ''}
                        </small>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <section className="card admin-empty">
            <h2>No meetings match these filters</h2>
            <p className="muted">
              Classes with incomplete schedule setup remain visible in their course and teacher
              details.
            </p>
          </section>
        )
      ) : (
        <LoadingState label="Loading the school schedule" />
      )}
    </div>
  );
}

export function AdminCurriculumPage() {
  const api = useApiClient();
  const [curricula, setCurricula] = useState<
    Awaited<ReturnType<typeof api.getAdminCurriculum>>['curricula']
  >([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const load = () => {
    setState('loading');
    void api
      .getAdminCurriculum()
      .then((result) => {
        setCurricula(result.curricula);
        setState('ready');
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Could not load shared curriculum.');
        setState('error');
      });
  };
  useEffect(load, [api]);
  if (state === 'loading')
    return (
      <div className="admin-page stack">
        <AdminPageHeader
          eyebrow="Planning"
          title="Curriculum"
          description="School-shared curriculum from the existing TeacherDesk sharing system."
        />
        <LoadingState label="Loading shared curriculum" />
      </div>
    );
  if (state === 'error')
    return (
      <div className="admin-page stack">
        <AdminPageHeader
          eyebrow="Planning"
          title="Curriculum"
          description="School-shared curriculum from the existing TeacherDesk sharing system."
        />
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  return (
    <div className="admin-page stack page-entry">
      <AdminPageHeader
        eyebrow="Planning"
        title="Curriculum"
        description="Teacher-shared source records remain attributed to their owners; this page does not silently take ownership."
      />
      {curricula.length ? (
        <div className="admin-record-list">
          {curricula.map((curriculum) => (
            <article
              className="card admin-record admin-curriculum-record"
              key={curriculum.courseId}
            >
              <div>
                <span className="admin-badge">
                  {curriculum.source === 'school-owned' ? 'School-owned' : 'Teacher-shared'}
                </span>
                <strong>{curriculum.name}</strong>
                <small>
                  {[curriculum.subject, curriculum.gradeLevel].filter(Boolean).join(' · ') ||
                    'Subject and grade not listed'}
                </small>
                <small>
                  Source: {displayName(curriculum.owner.fullName, curriculum.owner.email)}
                </small>
              </div>
              <div className="admin-record-stats">
                <span>
                  <strong>{curriculum.unitCount}</strong>
                  <small>Units</small>
                </span>
                <span>
                  <strong>{curriculum.lessonCount}</strong>
                  <small>Lessons</small>
                </span>
                <span>
                  <strong>{curriculum.adoptedByCount}</strong>
                  <small>Adoptions</small>
                </span>
                <Link
                  className="button-link secondary"
                  to={`/admin/courses/${curriculum.courseId}`}
                >
                  Open detail
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="card admin-empty">
          <h2>No school-shared curriculum</h2>
          <p className="muted">
            Teachers can share curriculum from their existing course workspace. Shared source
            records will appear here.
          </p>
        </section>
      )}
    </div>
  );
}

export function AdminCalendarPage() {
  const api = useApiClient();
  const [calendar, setCalendar] = useState<AdminCalendarResponse | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [timezone, setTimezone] = useState('');
  const [eventTitle, setEventTitle] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventEndDate, setEventEndDate] = useState('');
  const [eventType, setEventType] =
    useState<CalendarCommitRequest['events'][number]['type']>('no_school');
  const [overrideSectionId, setOverrideSectionId] = useState('');
  const [overrideDate, setOverrideDate] = useState('');
  const [overrideScheduledStartTime, setOverrideScheduledStartTime] = useState('');
  const [overrideStartTime, setOverrideStartTime] = useState('');
  const [overrideEndTime, setOverrideEndTime] = useState('');
  const [overrideRoom, setOverrideRoom] = useState('');
  const [overrideCancelled, setOverrideCancelled] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const load = () => {
    setError('');
    void api
      .getAdminCalendar()
      .then((result) => {
        setCalendar(result);
        setTimezone(result.timezone);
        setStartDate(result.schoolYear?.startDate ?? '');
        setEndDate(result.schoolYear?.endDate ?? '');
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not load the school calendar.')
      );
  };
  useEffect(load, [api]);
  const saveYear = async () => {
    if (!startDate || !endDate || endDate < startDate) {
      setError('Add a valid first and last instructional day.');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      if (timezone && timezone !== calendar?.timezone) await api.updateSchoolTimezone(timezone);
      await api.saveSchoolYear({ startDate, endDate });
      setCalendar(await api.getAdminCalendar());
      setMessage('School calendar settings saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the school calendar.');
    } finally {
      setSaving(false);
    }
  };
  const addEvent = async () => {
    if (!calendar?.schoolYear || !eventDate || !eventEndDate || !eventTitle.trim()) {
      setError('Set the school year, event date, and event name first.');
      return;
    }
    if (eventEndDate < eventDate) {
      setError('The event end date must be on or after its start date.');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await api.commitSchoolCalendar({
        mode: 'merge',
        schoolYear: {
          startDate: calendar.schoolYear.startDate,
          endDate: calendar.schoolYear.endDate
        },
        events: [
          {
            title: eventTitle.trim(),
            startDate: eventDate,
            endDate: eventEndDate,
            type: eventType,
            affectsInstruction: true,
            scheduleKnown: false,
            confidence: 100,
            sourceText: 'Added by administrator',
            needsReview: false
          }
        ],
        overrides: []
      });
      setCalendar(await api.getAdminCalendar());
      setEventTitle('');
      setEventDate('');
      setEventEndDate('');
      setMessage('Calendar event added.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the calendar event.');
    } finally {
      setSaving(false);
    }
  };
  const deleteEvent = async (eventId: string) => {
    if (!calendar?.schoolYear || !window.confirm('Delete this shared calendar date?')) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const events = calendar.events
        .filter((event) => !event.legacy && event.id !== eventId)
        .map((event) => ({
          title: event.label,
          startDate: event.date,
          endDate: event.date,
          type: event.type,
          affectsInstruction: true as const,
          scheduleKnown: event.type !== 'no_school',
          confidence: event.confidence ?? 100,
          sourceText: event.sourceText ?? 'Edited by administrator',
          needsReview: false
        }));
      await api.commitSchoolCalendar({
        mode: 'replace',
        schoolYear: {
          startDate: calendar.schoolYear.startDate,
          endDate: calendar.schoolYear.endDate
        },
        events,
        overrides: []
      });
      setCalendar(await api.getAdminCalendar());
      setMessage('Shared date deleted.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the calendar date.');
    } finally {
      setSaving(false);
    }
  };
  const saveOverride = async () => {
    if (!overrideSectionId || !overrideDate) {
      setError('Choose a class group and override date first.');
      return;
    }
    if (
      !overrideCancelled &&
      overrideStartTime &&
      overrideEndTime &&
      overrideEndTime <= overrideStartTime
    ) {
      setError('The override end time must be after its start time.');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await api.saveAdminCalendarOverride({
        sectionId: overrideSectionId,
        date: overrideDate,
        scheduledStartTime: overrideScheduledStartTime || undefined,
        startTime: overrideStartTime || null,
        endTime: overrideEndTime || null,
        room: overrideRoom || null,
        cancelled: overrideCancelled
      });
      setCalendar(result);
      setOverrideDate('');
      setOverrideScheduledStartTime('');
      setOverrideStartTime('');
      setOverrideEndTime('');
      setOverrideRoom('');
      setOverrideCancelled(false);
      setMessage('Class-group override saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the class-group override.');
    } finally {
      setSaving(false);
    }
  };
  const deleteOverride = async (overrideId: string) => {
    if (!window.confirm('Remove this class-group override?')) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await api.deleteAdminCalendarOverride(overrideId);
      setCalendar(result);
      setMessage('Class-group override removed.');
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not remove the class-group override.'
      );
    } finally {
      setSaving(false);
    }
  };
  if (!calendar)
    return (
      <div className="admin-page stack">
        <AdminPageHeader
          eyebrow="Operations"
          title="School calendar"
          description="Manage the shared instructional calendar used by schedule projections."
        />
        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : (
          <LoadingState label="Loading the school calendar" />
        )}
      </div>
    );
  return (
    <div className="admin-page stack page-entry">
      <AdminPageHeader
        eyebrow="Operations"
        title="School calendar"
        description="Changes flow through the existing centralized meeting and Year Plan logic."
      />
      <section className="admin-detail-grid">
        <article className="card stack">
          <div>
            <p className="eyebrow">Instructional year</p>
            <h2>School-wide dates</h2>
          </div>
          <div className="profile-form-grid">
            <label>
              First instructional day
              <input
                className="input"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </label>
            <label>
              Last instructional day
              <input
                className="input"
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </label>
            <label>
              Timezone
              <select
                className="input"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
              >
                <option value="America/Los_Angeles">Pacific Time</option>
                <option value="America/Denver">Mountain Time</option>
                <option value="America/Chicago">Central Time</option>
                <option value="America/New_York">Eastern Time</option>
                <option value="UTC">UTC</option>
              </select>
            </label>
          </div>
          <button type="button" onClick={() => void saveYear()} disabled={saving}>
            {saving ? 'Saving…' : 'Save calendar settings'}
          </button>
        </article>
        <article className="card stack">
          <div>
            <p className="eyebrow">Shared exception</p>
            <h2>Add a day or special date</h2>
          </div>
          <label>
            Name
            <input
              className="input"
              value={eventTitle}
              onChange={(event) => setEventTitle(event.target.value)}
              placeholder="Fall break"
            />
          </label>
          <div className="profile-form-grid">
            <label>
              Start date
              <input
                className="input"
                type="date"
                value={eventDate}
                onChange={(event) => setEventDate(event.target.value)}
              />
            </label>
            <label>
              End date
              <input
                className="input"
                type="date"
                value={eventEndDate}
                onChange={(event) => setEventEndDate(event.target.value)}
              />
            </label>
            <label>
              Type
              <select
                className="input"
                value={eventType}
                onChange={(event) => setEventType(event.target.value as typeof eventType)}
              >
                {calendarEventTypes.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            onClick={() => void addEvent()}
            disabled={saving || !calendar.schoolYear}
          >
            {saving ? 'Saving…' : 'Add shared date'}
          </button>
        </article>
      </section>
      <section className="card stack">
        <div>
          <p className="eyebrow">Class-group override</p>
          <h2>Change one class on one date</h2>
          <p className="muted">
            Use this for testing days, assemblies, late starts, or a room change. A blank new time
            preserves the regular time; cancellation removes that occurrence.
          </p>
        </div>
        {calendar.sections.length ? (
          <>
            <div className="profile-form-grid">
              <label>
                Class group
                <select
                  className="input"
                  value={overrideSectionId}
                  onChange={(event) => setOverrideSectionId(event.target.value)}
                >
                  <option value="">Choose a class group</option>
                  {calendar.sections.map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.courseName} · {section.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Date
                <input
                  className="input"
                  type="date"
                  value={overrideDate}
                  onChange={(event) => setOverrideDate(event.target.value)}
                />
              </label>
              <label>
                Scheduled block start (optional)
                <input
                  className="input"
                  type="time"
                  value={overrideScheduledStartTime}
                  onChange={(event) => setOverrideScheduledStartTime(event.target.value)}
                />
              </label>
              <label>
                New start time
                <input
                  className="input"
                  type="time"
                  value={overrideStartTime}
                  onChange={(event) => setOverrideStartTime(event.target.value)}
                />
              </label>
              <label>
                New end time
                <input
                  className="input"
                  type="time"
                  value={overrideEndTime}
                  onChange={(event) => setOverrideEndTime(event.target.value)}
                />
              </label>
              <label>
                Room
                <input
                  className="input"
                  value={overrideRoom}
                  onChange={(event) => setOverrideRoom(event.target.value)}
                  placeholder="Room or blank"
                />
              </label>
            </div>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={overrideCancelled}
                onChange={(event) => setOverrideCancelled(event.target.checked)}
              />
              Cancel this occurrence
            </label>
            <button type="button" onClick={() => void saveOverride()} disabled={saving}>
              {saving ? 'Saving…' : 'Save class-group override'}
            </button>
          </>
        ) : (
          <p className="muted">Add a class group before creating an override.</p>
        )}
      </section>
      {error ? (
        <p className="notice warning" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="notice success" role="status">
          {message}
        </p>
      ) : null}
      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Saved exceptions</p>
            <h2>
              {calendar.events.length
                ? `${calendar.events.length} shared dates`
                : 'No exceptions yet'}
            </h2>
          </div>
        </div>
        {calendar.events.length ? (
          <ul className="admin-simple-list">
            {calendar.events.map((event) => (
              <li key={event.id}>
                <span>
                  <strong>{event.label}</strong>
                  <small>
                    {formatDate(event.date)} · {event.type.replaceAll('_', ' ')}
                  </small>
                </span>
                {event.legacy ? (
                  <small title="Managed by the existing teacher calendar">Existing holiday</small>
                ) : (
                  <button
                    type="button"
                    className="secondary"
                    disabled={saving}
                    onClick={() => void deleteEvent(event.id)}
                  >
                    Delete
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Add holidays, closures, testing days, or special schedules above.</p>
        )}
      </section>
      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Saved class changes</p>
            <h2>
              {calendar.overrides.length
                ? `${calendar.overrides.length} class-group overrides`
                : 'No class-group overrides'}
            </h2>
          </div>
        </div>
        {calendar.overrides.length ? (
          <ul className="admin-simple-list">
            {calendar.overrides.map((override) => (
              <li key={override.id}>
                <span>
                  <strong>
                    {override.courseName} · {override.sectionName}
                  </strong>
                  <small>
                    {formatDate(override.date)} ·{' '}
                    {override.cancelled
                      ? 'Cancelled'
                      : `${override.startTime ? formatTime(override.startTime) : 'Regular time'}${
                          override.endTime ? ` – ${formatTime(override.endTime)}` : ''
                        }`}
                  </small>
                </span>
                <button
                  type="button"
                  className="secondary"
                  disabled={saving}
                  onClick={() => void deleteOverride(override.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No one-date class schedule changes are saved.</p>
        )}
      </section>
      <p className="field-help">
        This calendar is shared school infrastructure. Teacher calendar edits remain protected after
        a school is claimed.
      </p>
    </div>
  );
}

export function AdminSchoolPage() {
  const api = useApiClient();
  const [school, setSchool] = useState<Awaited<ReturnType<typeof api.getAdminSchool>> | null>(null);
  const [policy, setPolicy] = useState<'admin_only' | 'members' | 'code'>('members');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const load = () => {
    setError('');
    void api
      .getAdminSchool()
      .then((result) => {
        setSchool(result);
        setPolicy(result.school.invitePolicy);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not load school settings.')
      );
  };
  useEffect(load, [api]);
  const savePolicy = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await api.updateAdminInvitePolicy({ policy });
      setSchool(result);
      setMessage('Invite policy saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save invite policy.');
    } finally {
      setSaving(false);
    }
  };
  const inviteTeacher = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!inviteEmail.trim()) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await api.inviteAdminTeacher({ email: inviteEmail.trim() });
      setInviteEmail('');
      setMessage('Teacher invitation sent. They can accept it from Notifications.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send teacher invitation.');
    } finally {
      setSaving(false);
    }
  };
  const revokeInvitation = async (invitationId: string) => {
    if (!window.confirm('Revoke this pending school invitation?')) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await api.revokeAdminSchoolInvitation(invitationId);
      const result = await api.getAdminSchool();
      setSchool(result);
      setMessage('School invitation revoked.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not revoke school invitation.');
    } finally {
      setSaving(false);
    }
  };
  const rotateInviteCode = async () => {
    if (!window.confirm('Rotate the school invite code? Existing shared copies will stop working.'))
      return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await api.rotateAdminInviteCode();
      setSchool(result);
      setMessage('School invite code rotated.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not rotate invite code.');
    } finally {
      setSaving(false);
    }
  };
  if (!school)
    return (
      <div className="admin-page stack">
        <AdminPageHeader
          eyebrow="School"
          title="School settings"
          description="Manage school-scoped membership policy and claim status."
        />
        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : (
          <LoadingState label="Loading school settings" />
        )}
      </div>
    );
  return (
    <div className="admin-page stack page-entry">
      <AdminPageHeader
        eyebrow="School"
        title={school.school.name}
        description={
          [school.school.district, school.school.state].filter(Boolean).join(' · ') ||
          'School settings'
        }
      />
      <section className="admin-detail-grid">
        <article className="card stack">
          <div>
            <p className="eyebrow">Teacher invitations</p>
            <h2>Who can invite teachers?</h2>
            <p className="muted">
              Existing claimed schools default to the current teacher-led behavior. Change this
              intentionally when your school is ready.
            </p>
          </div>
          <label>
            Invite policy
            <select
              className="input"
              value={policy}
              onChange={(event) => setPolicy(event.target.value as typeof policy)}
            >
              <option value="members">Administrators and teachers</option>
              <option value="code">Anyone with the school code</option>
              <option value="admin_only">Administrators only</option>
            </select>
          </label>
          <button type="button" onClick={() => void savePolicy()} disabled={saving}>
            {saving ? 'Saving…' : 'Save invite policy'}
          </button>
          <form className="stack admin-inline-form" onSubmit={(event) => void inviteTeacher(event)}>
            <label>
              Invite a teacher by account email
              <input
                className="input"
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="teacher@school.edu"
                required
              />
            </label>
            <button type="submit" className="secondary" disabled={saving}>
              {saving ? 'Sending…' : 'Send invitation'}
            </button>
          </form>
          <div className="admin-code-control">
            <span className="field-help">School invite code</span>
            <code>{school.school.inviteCode}</code>
            <button
              type="button"
              className="secondary"
              onClick={() => void rotateInviteCode()}
              disabled={saving}
            >
              Rotate code
            </button>
          </div>
          {message ? (
            <p className="notice success" role="status">
              {message}
            </p>
          ) : null}
          {error ? (
            <p className="notice warning" role="alert">
              {error}
            </p>
          ) : null}
        </article>
        <article className="card">
          <p className="eyebrow">Claim status</p>
          <h2>{school.school.claimStatus === 'claimed' ? 'Claimed' : 'Unclaimed'}</h2>
          <p className="muted">
            {school.school.claimedAt
              ? `Claimed ${formatDate(school.school.claimedAt.slice(0, 10))}.`
              : 'This school remains usable without an administrator.'}
          </p>
          <p className="field-help">
            Existing school IDs, teachers, courses, curriculum, schedules, and history remain in
            place through a claim.
          </p>
        </article>
      </section>
      <section className="card">
        <p className="eyebrow">Pending invitations</p>
        <h2>
          {school.invitations.length}{' '}
          {school.invitations.length === 1 ? 'invitation' : 'invitations'}
        </h2>
        {school.invitations.length ? (
          <ul className="admin-simple-list">
            {school.invitations.map((invitation) => {
              const expired = new Date(invitation.expiresAt) <= new Date();
              return (
                <li key={invitation.id}>
                  <span>
                    <strong>{invitation.inviteeEmail}</strong>
                    <small>
                      {expired
                        ? 'Expired'
                        : `Expires ${formatDate(invitation.expiresAt.slice(0, 10))}`}
                    </small>
                  </span>
                  <button
                    type="button"
                    className="secondary"
                    disabled={saving}
                    onClick={() => void revokeInvitation(invitation.id)}
                  >
                    Revoke
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">No pending school invitations.</p>
        )}
      </section>
      <section className="card">
        <p className="eyebrow">Administrators</p>
        <h2>
          {school.administrators.length}{' '}
          {school.administrators.length === 1 ? 'administrator' : 'administrators'}
        </h2>
        {school.administrators.length ? (
          <ul className="admin-simple-list">
            {school.administrators.map((administrator) => (
              <li key={administrator.userId}>
                <span>
                  <strong>{displayName(administrator.fullName, administrator.email)}</strong>
                  <small>{administrator.email}</small>
                </span>
                <small>{administrator.status}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No administrator membership is recorded.</p>
        )}
      </section>
      {school.pendingClaims.length ? (
        <section className="card">
          <p className="eyebrow">Claim history</p>
          <h2>Requests</h2>
          <ul className="admin-simple-list">
            {school.pendingClaims.map((claim) => (
              <li key={claim.id}>
                <span>
                  <strong>{claim.requesterName ?? claim.schoolEmail}</strong>
                  <small>
                    {claim.position} · {claim.schoolEmail}
                  </small>
                </span>
                <small>{claim.status}</small>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function AdminClaimRequestPage() {
  const api = useApiClient();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [schoolEmail, setSchoolEmail] = useState('');
  const [position, setPosition] = useState('');
  const [verificationNotes, setVerificationNotes] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'sent'>('idle');
  const [error, setError] = useState('');
  useEffect(() => {
    void api
      .getProfile()
      .then(setProfile)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not load your profile.')
      );
  }, [api]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!profile?.school?.id) return;
    setStatus('saving');
    setError('');
    try {
      await api.requestAdminClaim({
        schoolId: profile.school.id,
        schoolEmail: schoolEmail.trim(),
        position: position.trim(),
        verificationNotes: verificationNotes.trim() || null
      });
      setStatus('sent');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit the request.');
      setStatus('idle');
    }
  };
  if (status === 'sent')
    return (
      <main className="admin-route-gate page-entry">
        <section className="card admin-route-gate-card">
          <p className="eyebrow">Request received</p>
          <h1>We’ll review your school access</h1>
          <p className="muted">
            Your request is pending manual verification. No administrator permissions were changed
            yet.
          </p>
          <div className="admin-actions">
            <Link className="button-link secondary" to="/guide">
              Return to setup
            </Link>
            <button type="button" onClick={() => navigate('/today')}>
              Teaching workspace
            </button>
          </div>
        </section>
      </main>
    );
  return (
    <main className="admin-route-gate page-entry">
      <form className="card admin-claim-form stack" onSubmit={(event) => void submit(event)}>
        <p className="eyebrow">Administrator access</p>
        <h1>Request access to {profile?.school?.name ?? 'your school'}</h1>
        <p className="muted">
          You can request access to the existing school without creating a duplicate. A reviewer
          must approve the request before administrator tools appear.
        </p>
        {error ? (
          <p className="notice warning" role="alert">
            {error}
          </p>
        ) : null}
        <label>
          School email
          <input
            className="input"
            type="email"
            value={schoolEmail}
            onChange={(event) => setSchoolEmail(event.target.value)}
            placeholder="administrator@school.edu"
            required
          />
        </label>
        <label>
          Position or title
          <input
            className="input"
            value={position}
            onChange={(event) => setPosition(event.target.value)}
            placeholder="Principal, assistant principal, department administrator"
            minLength={2}
            required
          />
        </label>
        <label>
          Verification detail <span className="field-optional">Optional</span>
          <textarea
            value={verificationNotes}
            onChange={(event) => setVerificationNotes(event.target.value)}
            maxLength={2000}
            rows={5}
            placeholder="Anything that will help a reviewer verify this request."
          />
        </label>
        <div className="admin-actions">
          <button type="submit" disabled={status === 'saving' || !profile?.school?.id}>
            {status === 'saving' ? 'Sending…' : 'Request administrator access'}
          </button>
          <Link className="button-link secondary" to="/today?workspace=teaching">
            Return to teaching
          </Link>
        </div>
      </form>
    </main>
  );
}
