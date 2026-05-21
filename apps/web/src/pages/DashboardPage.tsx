import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';

import type {
  ClassroomResumeResponse,
  CourseDetailResponse,
  CourseListResponse,
  DashboardTodayResponse,
  GetScheduleResponse
} from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';

type CourseSummary = CourseListResponse['courses'][number];
type CourseDetail = CourseDetailResponse['course'];
type ScheduleSection = GetScheduleResponse['sections'][number];
type TodayClass = DashboardTodayResponse['todaySchedule'][number];

type DashboardLoadState = {
  today: DashboardTodayResponse | null;
  schedule: GetScheduleResponse | null;
  courses: CourseSummary[];
  courseDetails: CourseDetail[];
  resumesBySectionId: Record<string, ClassroomResumeResponse>;
};

const CHECKLIST_ITEMS = [
  'Review carry-over notes',
  'Open the active lesson',
  'Check next class materials',
  'Capture end-of-class note'
];

function minutesFromTime(time: string | null): number | null {
  if (!time) return null;
  const parts = time.split(':').map(Number);
  const hours = parts[0];
  const minutes = parts[1];
  if (
    typeof hours !== 'number' ||
    typeof minutes !== 'number' ||
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes)
  ) {
    return null;
  }
  return hours * 60 + minutes;
}

function formatDateLabel(isoDate: string | null): string {
  const date = isoDate ? new Date(`${isoDate}T12:00:00`) : new Date();
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  }).format(date);
}

function formatRelativeClass(time: string | null): string {
  const startMinutes = minutesFromTime(time);
  if (startMinutes === null) return 'Time TBD';

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const delta = startMinutes - currentMinutes;

  if (delta > 90) return `Starts in ${Math.round(delta / 60)} hr`;
  if (delta > 0) return `Starts in ${delta} min`;
  if (delta >= -55) return 'In session now';
  return 'Finished';
}

function classStatus(item: TodayClass): 'now' | 'upcoming' | 'done' | 'unscheduled' {
  if (item.isInSession) return 'now';
  const startMinutes = minutesFromTime(item.meetingTime);
  if (startMinutes === null) return 'unscheduled';
  const now = new Date();
  return startMinutes > now.getHours() * 60 + now.getMinutes() ? 'upcoming' : 'done';
}

function lessonProgress(resume: ClassroomResumeResponse | undefined): {
  completed: number;
  total: number;
  percent: number;
} {
  const total = resume?.lesson?.segments.length ?? 0;
  const completed = resume?.state?.completedSegmentIds.length ?? 0;
  return {
    completed,
    total,
    percent: total > 0 ? Math.round((completed / total) * 100) : 0
  };
}

function uniqueSections(today: DashboardTodayResponse | null, schedule: GetScheduleResponse | null): string[] {
  const sectionIds = new Set<string>();
  today?.todaySchedule.forEach((item) => sectionIds.add(item.sectionId));
  if (today?.currentClass) sectionIds.add(today.currentClass.sectionId);
  if (today?.nextClass) sectionIds.add(today.nextClass.sectionId);
  schedule?.sections.slice(0, 4).forEach((item) => sectionIds.add(item.sectionId));
  return [...sectionIds];
}

function buildReadinessScore(
  state: DashboardLoadState,
  currentResume: ClassroomResumeResponse | undefined,
  scheduleGaps: string[]
): number {
  if (state.today?.holiday) return 100;

  const hasScheduleToday = Boolean(state.today?.todaySchedule.length);
  const hasCurriculum = state.courseDetails.some((course) =>
    course.units.some((unit) => unit.lessons.length > 0)
  );
  const hasActiveLesson = Boolean(currentResume?.lesson);
  const hasCarryOver = Boolean(currentResume?.state?.carryOverNote || currentResume?.lastNote?.content);
  const hasSegments = Boolean(currentResume?.lesson?.segments.length);

  return Math.min(
    100,
    (hasScheduleToday ? 25 : 0) +
      (hasCurriculum ? 25 : 0) +
      (hasActiveLesson ? 20 : 0) +
      (hasCarryOver ? 15 : 0) +
      (hasSegments ? 10 : 0) +
      (scheduleGaps.length === 0 ? 5 : 0)
  );
}

function courseDepth(course: CourseDetail) {
  const lessons = course.units.reduce((count, unit) => count + unit.lessons.length, 0);
  const segments = course.units.reduce(
    (count, unit) =>
      count +
      unit.lessons.reduce((lessonCount, lesson) => lessonCount + lesson.segments.length, 0),
    0
  );

  return {
    units: course.units.length,
    lessons,
    segments
  };
}

function toApiErrorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

function dashboardStorageKey(name: string, date: string | null): string {
  return `teacheros_dashboard_${date ?? 'today'}_${name}`;
}

export function DashboardPage() {
  const api = useApiClient();
  const [state, setState] = useState<DashboardLoadState>({
    today: null,
    schedule: null,
    courses: [],
    courseDetails: [],
    resumesBySectionId: {}
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [focusNote, setFocusNote] = useState('');
  const [checkedItems, setCheckedItems] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);

      try {
        const [todayResult, scheduleResult, coursesResult] = await Promise.allSettled([
          api.dashboardToday(),
          api.getSchedule(),
          api.listCourses()
        ]);

        if (cancelled) return;

        const today = todayResult.status === 'fulfilled' ? todayResult.value : null;
        const schedule = scheduleResult.status === 'fulfilled' ? scheduleResult.value : null;
        const courses = coursesResult.status === 'fulfilled' ? coursesResult.value.courses : [];

        const courseDetails = (
          await Promise.allSettled(courses.map((course) => api.getCourseDetail(course.id)))
        )
          .filter((result): result is PromiseFulfilledResult<CourseDetailResponse> => result.status === 'fulfilled')
          .map((result) => result.value.course);

        const sectionIds = uniqueSections(today, schedule);
        const resumeEntries = await Promise.allSettled(
          sectionIds.map(async (sectionId) => [sectionId, await api.getClassroomResume(sectionId)] as const)
        );
        const resumesBySectionId = Object.fromEntries(
          resumeEntries
            .filter(
              (result): result is PromiseFulfilledResult<readonly [string, ClassroomResumeResponse]> =>
                result.status === 'fulfilled'
            )
            .map((result) => result.value)
        );

        if (cancelled) return;

        setState({
          today,
          schedule,
          courses,
          courseDetails,
          resumesBySectionId
        });

        const failedPrimaryLoads = [todayResult, scheduleResult, coursesResult].filter(
          (result) => result.status === 'rejected'
        );
        if (failedPrimaryLoads.length > 0) {
          setError('Some dashboard data could not load.');
        }
      } catch (err) {
        if (!cancelled) {
          setError(toApiErrorMessage(err, 'Failed to load dashboard'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api]);

  const currentResume = state.today?.currentClass
    ? state.resumesBySectionId[state.today.currentClass.sectionId]
    : undefined;
  const nextResume = state.today?.nextClass ? state.resumesBySectionId[state.today.nextClass.sectionId] : undefined;
  const activeLessonProgress = lessonProgress(currentResume);
  const todayLabel = formatDateLabel(state.today?.date ?? null);

  const summary = useMemo(() => {
    const courseCount = state.courses.length;
    const unitCount = state.courseDetails.reduce((count, course) => count + course.units.length, 0);
    const lessonCount = state.courseDetails.reduce(
      (count, course) => count + course.units.reduce((unitCount, unit) => unitCount + unit.lessons.length, 0),
      0
    );
    const segmentCount = state.courseDetails.reduce(
      (count, course) =>
        count +
        course.units.reduce(
          (unitCount, unit) =>
            unitCount +
            unit.lessons.reduce((lessonCount, lesson) => lessonCount + lesson.segments.length, 0),
          0
        ),
      0
    );

    return { courseCount, unitCount, lessonCount, segmentCount };
  }, [state.courseDetails, state.courses.length]);

  const scheduleGaps = useMemo(() => {
    const gaps: string[] = [];
    state.schedule?.sections.forEach((section: ScheduleSection) => {
      const missingTime = section.meetings.some((meeting) => !meeting.time);
      const missingRoom = section.meetings.some((meeting) => !meeting.room);
      if (missingTime) gaps.push(`${section.courseName} / ${section.sectionName} needs a meeting time`);
      if (missingRoom) gaps.push(`${section.courseName} / ${section.sectionName} needs a room`);
    });
    return gaps.slice(0, 4);
  }, [state.schedule]);

  const readinessScore = buildReadinessScore(state, currentResume, scheduleGaps);

  const smartPrompts = useMemo(() => {
    const prompts = [];

    if (!state.courses.length) {
      prompts.push({
        title: 'Create your first course',
        body: 'Start with one course so schedule sections and lesson tracking have somewhere to attach.',
        to: '/curriculum',
        action: 'Open Curriculum'
      });
    }

    if (!state.schedule?.sections.length) {
      prompts.push({
        title: 'Build your schedule',
        body: 'Add sections manually or paste a schedule into the AI parser, then the dashboard can reason about today.',
        to: '/schedule',
        action: 'Open Schedule'
      });
    }

    if (state.today?.currentClass && currentResume?.lesson) {
      prompts.push({
        title: 'Resume the active lesson',
        body: `${currentResume.lesson.title} is ready with ${activeLessonProgress.completed}/${activeLessonProgress.total} segments complete.`,
        to: `/sections/${state.today.currentClass.sectionId}/lessons/${currentResume.lesson.id}`,
        action: 'Resume class'
      });
    }

    if (currentResume?.state?.carryOverNote) {
      prompts.push({
        title: 'Carry-over needs attention',
        body: currentResume.state.carryOverNote,
        to: '/classroom',
        action: 'Open Classroom'
      });
    }

    if (summary.lessonCount > 0 && summary.segmentCount === 0) {
      prompts.push({
        title: 'Add lesson segments',
        body: 'Lessons need timed segments for stopped-at tracking.',
        to: '/schedule',
        action: 'Generate segments'
      });
    }

    if (scheduleGaps.length > 0) {
      prompts.push({
        title: 'Clean up schedule gaps',
        body: scheduleGaps[0],
        to: '/schedule',
        action: 'Fix schedule'
      });
    }

    prompts.push({
      title: 'Use optional tools only where they help',
      body: 'Parse a messy schedule, draft lesson segments, or create continuity after a class stops mid-lesson.',
      to: '/schedule',
      action: 'Open tools'
    });

    return prompts.slice(0, 4);
  }, [
    activeLessonProgress.completed,
    activeLessonProgress.total,
    currentResume,
    scheduleGaps,
    state.courses.length,
    state.schedule?.sections.length,
    state.today?.currentClass,
    summary.lessonCount,
    summary.segmentCount
  ]);

  useEffect(() => {
    const noteKey = dashboardStorageKey('focus_note', state.today?.date ?? null);
    const checklistKey = dashboardStorageKey('checklist', state.today?.date ?? null);
    setFocusNote(window.localStorage.getItem(noteKey) ?? '');
    try {
      const raw = window.localStorage.getItem(checklistKey);
      setCheckedItems(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      setCheckedItems([]);
    }
  }, [state.today?.date]);

  useEffect(() => {
    window.localStorage.setItem(dashboardStorageKey('focus_note', state.today?.date ?? null), focusNote);
  }, [focusNote, state.today?.date]);

  useEffect(() => {
    window.localStorage.setItem(
      dashboardStorageKey('checklist', state.today?.date ?? null),
      JSON.stringify(checkedItems)
    );
  }, [checkedItems, state.today?.date]);

  return (
    <div className="dashboard-page">
      <section className="dashboard-hero">
        <div className="hero-copy">
          <p className="eyebrow">{todayLabel}</p>
          <h1>Daily Teaching Desk</h1>
          <div className="hero-actions">
            {state.today?.currentClass && currentResume?.lesson ? (
              <Link
                className="button-link"
                to={`/sections/${state.today.currentClass.sectionId}/lessons/${currentResume.lesson.id}`}
              >
                Resume current class
              </Link>
            ) : (
              <Link className="button-link" to="/classroom">
                Open classroom
              </Link>
            )}
            <Link className="button-link secondary" to="/schedule">
              Adjust schedule
            </Link>
          </div>
        </div>

        <div className="readiness-card" aria-label={`Readiness score ${readinessScore} percent`}>
          <div className="score-ring" style={{ '--score': readinessScore } as CSSProperties}>
            <span>{readinessScore}</span>
          </div>
          <div>
            <h2>Readiness</h2>
            <p className="muted">
              {readinessScore >= 85
                ? 'Ready.'
                : readinessScore >= 55
                  ? 'Needs a few updates.'
                  : 'Setup needed.'}
            </p>
          </div>
        </div>
      </section>

      {error ? <p className="notice warning">{error}</p> : null}
      {loading ? <p className="muted">Loading...</p> : null}

      <section className="walkthrough-callout">
        <div>
          <p className="eyebrow">First time</p>
          <h2>Welcome setup</h2>
        </div>
        <div className="callout-actions">
          <Link className="button-link" to="/welcome">
            Open welcome
          </Link>
          <Link className="button-link secondary" to="/management">
            Manage classes
          </Link>
        </div>
      </section>

      <section className="metric-grid">
        <div className="metric-card">
          <span>{state.today?.todaySchedule.length ?? 0}</span>
          <p>classes today</p>
        </div>
        <div className="metric-card">
          <span>{summary.courseCount}</span>
          <p>courses</p>
        </div>
        <div className="metric-card">
          <span>{summary.lessonCount}</span>
          <p>lessons planned</p>
        </div>
        <div className="metric-card">
          <span>{summary.segmentCount}</span>
          <p>lesson segments</p>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="card stack feature-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Current Period</p>
              <h2>Active class brief</h2>
            </div>
            <Link to="/classroom">Classroom</Link>
          </div>

          {state.today?.holiday ? (
            <div className="soft-panel">
              <strong>{state.today.holiday.name}</strong>
              <p className="muted">No pressure today. Use this as planning time if you are working.</p>
            </div>
          ) : state.today?.currentClass ? (
            <>
              <div className="class-brief">
                <div>
                  <h3>{state.today.currentClass.courseName}</h3>
                  <p className="muted">
                    {state.today.currentClass.sectionName} / {state.today.currentClass.meetingTime ?? 'Time TBD'}
                    {state.today.currentClass.room ? ` / Room ${state.today.currentClass.room}` : ''}
                  </p>
                </div>
                <span className="status-pill now">In session</span>
              </div>

              {currentResume?.lesson ? (
                <div className="lesson-now">
                  <div>
                    <p className="eyebrow">Resume lesson</p>
                    <h3>{currentResume.lesson.title}</h3>
                    {currentResume.lesson.description ? (
                      <p className="muted">{currentResume.lesson.description}</p>
                    ) : null}
                  </div>
                  <div className="progress-stack">
                    <span>{activeLessonProgress.percent}%</span>
                    <progress max={100} value={activeLessonProgress.percent} />
                    <small>
                      {activeLessonProgress.completed}/{activeLessonProgress.total || 0} segments complete
                    </small>
                  </div>
                </div>
              ) : (
                <div className="soft-panel">
                  <strong>No lesson attached yet</strong>
                  <p className="muted">Create a unit and lesson in Curriculum to enable precise class resume.</p>
                </div>
              )}

              {currentResume?.state?.carryOverNote || currentResume?.lastNote?.content ? (
                <blockquote className="carry-note">
                  {currentResume.state?.carryOverNote ?? currentResume.lastNote?.content}
                </blockquote>
              ) : null}
            </>
          ) : (
            <div className="soft-panel">
              <strong>No class detected right now</strong>
              <p className="muted">Use the schedule timeline to see what is coming next.</p>
            </div>
          )}
        </div>

        <div className="card stack">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Next Period</p>
              <h2>Next class prep</h2>
            </div>
            <Link to="/schedule">Schedule</Link>
          </div>
          {state.today?.nextClass ? (
            <div className="next-class-card">
              <span>{formatRelativeClass(state.today.nextClass.meetingTime)}</span>
              <h3>{state.today.nextClass.courseName}</h3>
              <p className="muted">
                {state.today.nextClass.sectionName} / {state.today.nextClass.meetingTime ?? 'Time TBD'}
              </p>
              {nextResume?.lesson ? (
                <p>
                  Prep: <strong>{nextResume.lesson.title}</strong>
                </p>
              ) : (
                <p className="muted">No lesson found yet. Curriculum is the next stop.</p>
              )}
            </div>
          ) : (
            <p className="muted">No additional classes scheduled today.</p>
          )}
        </div>

        <div className="card stack wide-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Timeline</p>
              <h2>Teaching arc</h2>
            </div>
            <Link to="/schedule">Edit day</Link>
          </div>
          {state.today?.todaySchedule.length ? (
            <div className="timeline">
              {state.today.todaySchedule.map((item) => {
                const status = classStatus(item);
                const resume = state.resumesBySectionId[item.sectionId];
                return (
                  <div key={`${item.sectionId}-${item.meetingTime ?? 'tbd'}`} className={`timeline-item ${status}`}>
                    <div className="timeline-time">{item.meetingTime ?? '--:--'}</div>
                    <div>
                      <strong>{item.courseName}</strong>
                      <p className="muted">
                        {item.sectionName}
                        {item.room ? ` / Room ${item.room}` : ' / Room TBD'}
                      </p>
                      {resume?.lesson ? <small>Lesson: {resume.lesson.title}</small> : <small>No lesson attached</small>}
                    </div>
                    <span className={`status-pill ${status}`}>
                      {status === 'now'
                        ? 'Now'
                        : status === 'upcoming'
                          ? 'Upcoming'
                          : status === 'done'
                            ? 'Done'
                            : 'Needs time'}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="muted">No schedule entries for today. Add sections or import a schedule to unlock this.</p>
          )}
        </div>

        <div className="card stack">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Desk List</p>
              <h2>Next useful actions</h2>
            </div>
          </div>
          <div className="action-list">
            {smartPrompts.map((prompt) => (
              <Link key={prompt.title} to={prompt.to} className="action-card">
                <strong>{prompt.title}</strong>
                <span>{prompt.body}</span>
                <em>{prompt.action}</em>
              </Link>
            ))}
          </div>
        </div>

        <div className="card stack">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Notes</p>
              <h2>Today focus pad</h2>
            </div>
          </div>
          <textarea
            rows={5}
            value={focusNote}
            onChange={(event) => setFocusNote(event.target.value)}
            placeholder="What needs your attention today? Parent follow-up, reteach plan, copies, lab setup..."
          />
          <div className="checklist">
            {CHECKLIST_ITEMS.map((item) => {
              const checked = checkedItems.includes(item);
              return (
                <label key={item} className={checked ? 'checked' : ''}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      setCheckedItems((previous) =>
                        event.target.checked ? [...previous, item] : previous.filter((value) => value !== item)
                      );
                    }}
                  />
                  <span>{item}</span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="card stack wide-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Curriculum Health</p>
              <h2>Course depth</h2>
            </div>
            <Link to="/curriculum">Open Curriculum</Link>
          </div>
          {state.courseDetails.length ? (
            <div className="course-health-grid">
              {state.courseDetails.slice(0, 4).map((course) => {
                const depth = courseDepth(course);
                return (
                  <Link key={course.id} to={`/courses/${course.id}`} className="course-health-card">
                    <div>
                      <strong>{course.name}</strong>
                      <p className="muted">
                        {course.subject ?? 'No subject'} / {course.gradeLevel ?? 'No grade'}
                      </p>
                    </div>
                    <div className="mini-stats">
                      <span>{depth.units} units</span>
                      <span>{depth.lessons} lessons</span>
                      <span>{depth.segments} segments</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className="muted">No curriculum yet. Create the first course to begin tracking lessons.</p>
          )}
        </div>

        <div className="card stack">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Watchlist</p>
              <h2>Setup gaps</h2>
            </div>
          </div>
          {scheduleGaps.length || summary.lessonCount === 0 || summary.segmentCount === 0 ? (
            <ul className="signal-list">
              {summary.lessonCount === 0 ? <li>Add at least one lesson to make classroom resume useful.</li> : null}
              {summary.lessonCount > 0 && summary.segmentCount === 0 ? (
                <li>Break lessons into segments so stopped-at tracking has real detail.</li>
              ) : null}
              {scheduleGaps.map((gap) => (
                <li key={gap}>{gap}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">Ready.</p>
          )}
        </div>
      </section>
    </div>
  );
}
