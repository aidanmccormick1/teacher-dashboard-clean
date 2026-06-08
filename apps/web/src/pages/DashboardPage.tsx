import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import type {
  ClassroomResumeResponse,
  CourseDetailResponse,
  CourseListResponse,
  DashboardTodayResponse,
  GetScheduleResponse
} from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';
import { rememberManagementTab, type ManagementTabTarget } from '../lib/management-tabs.js';

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

function buildDailyBriefing(
  todayLabel: string,
  state: DashboardLoadState,
  focusNote: string,
  checkedItems: string[]
): string {
  const lines = [`Daily Teaching Desk`, todayLabel, ''];

  if (state.today?.holiday) {
    lines.push(`No school: ${state.today.holiday.name}`, '');
  }

  if (state.today?.currentClass) {
    const resume = state.resumesBySectionId[state.today.currentClass.sectionId];
    lines.push('Current class');
    lines.push(`- ${state.today.currentClass.courseName} / ${state.today.currentClass.sectionName}`);
    lines.push(`- Time: ${state.today.currentClass.meetingTime ?? 'TBD'}`);
    if (state.today.currentClass.room) lines.push(`- Room: ${state.today.currentClass.room}`);
    lines.push(`- Lesson: ${resume?.lesson?.title ?? 'No lesson attached yet'}`);
    if (resume?.state?.carryOverNote) lines.push(`- Carry-over: ${resume.state.carryOverNote}`);
    lines.push('');
  }

  if (state.today?.nextClass) {
    const resume = state.resumesBySectionId[state.today.nextClass.sectionId];
    lines.push('Next class');
    lines.push(`- ${state.today.nextClass.courseName} / ${state.today.nextClass.sectionName}`);
    lines.push(`- Time: ${state.today.nextClass.meetingTime ?? 'TBD'}`);
    lines.push(`- Prep: ${resume?.lesson?.title ?? 'No lesson attached yet'}`);
    lines.push('');
  }

  lines.push('Today schedule');
  if (state.today?.todaySchedule.length) {
    state.today.todaySchedule.forEach((item) => {
      const resume = state.resumesBySectionId[item.sectionId];
      lines.push(
        `- ${item.meetingTime ?? 'TBD'} ${item.courseName} / ${item.sectionName}${
          item.room ? ` / Room ${item.room}` : ''
        } / ${resume?.lesson?.title ?? 'No lesson attached'}`
      );
    });
  } else {
    lines.push('- No classes scheduled today.');
  }

  lines.push('', 'Focus note');
  lines.push(focusNote.trim() || '- None yet');
  lines.push('', 'Desk checklist');
  CHECKLIST_ITEMS.forEach((item) => {
    lines.push(`- ${checkedItems.includes(item) ? '[x]' : '[ ]'} ${item}`);
  });

  return lines.join('\n');
}

function buildSetupSnapshot(
  readinessScore: number,
  summary: { courseCount: number; unitCount: number; lessonCount: number; segmentCount: number },
  schedule: GetScheduleResponse | null,
  scheduleGaps: string[]
): string {
  const sections = schedule?.sections ?? [];
  return [
    'TeacherOS setup snapshot',
    `Readiness: ${readinessScore}`,
    `Courses: ${summary.courseCount}`,
    `Periods: ${sections.length}`,
    `Units: ${summary.unitCount}`,
    `Lessons: ${summary.lessonCount}`,
    `Segments: ${summary.segmentCount}`,
    '',
    'Schedule gaps',
    ...(scheduleGaps.length ? scheduleGaps.map((gap) => `- ${gap}`) : ['- None']),
    '',
    'Periods',
    ...(sections.length
      ? sections.map((section) => `- ${section.courseName} / ${section.sectionName}: ${section.meetings.length} meetings`)
      : ['- None yet'])
  ].join('\n');
}

export function DashboardPage() {
  const api = useApiClient();
  const navigate = useNavigate();
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
  const [briefingStatus, setBriefingStatus] = useState<string | null>(null);

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
  const teachingResume = currentResume ?? nextResume;
  const activeLessonProgress = lessonProgress(currentResume);
  const nextLessonProgress = lessonProgress(nextResume);
  const nextOpenSegment = nextResume?.lesson?.segments.find(
    (segment) => !nextResume.state?.completedSegmentIds.includes(segment.id)
  );
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

  const readinessScore = buildReadinessScore(state, teachingResume, scheduleGaps);
  const hasCourses = state.courses.length > 0;
  const hasSections = Boolean(state.schedule?.sections.length);
  const hasMeetingTimes = Boolean(state.schedule?.sections.some((section) => section.meetings.some((meeting) => meeting.time)));
  const hasLessons = summary.lessonCount > 0;
  const hasSegments = summary.segmentCount > 0;
  const hasClassroomResume = Object.values(state.resumesBySectionId).some((resume) => resume.lesson);
  const setupSteps = [
    {
      title: 'Create a course',
      body: 'Name what you teach.',
      done: hasCourses,
      to: '/management',
      managementTab: 'courses' as ManagementTabTarget,
      action: hasCourses ? 'Review courses' : 'Start here'
    },
    {
      title: 'Add periods',
      body: 'Attach real class periods to a course.',
      done: hasSections,
      to: '/management',
      managementTab: 'periods' as ManagementTabTarget,
      action: hasSections ? 'Review periods' : 'Add periods'
    },
    {
      title: 'Add meeting times',
      body: 'Tell the app when each period meets.',
      done: hasMeetingTimes,
      to: '/management',
      managementTab: 'weekly' as ManagementTabTarget,
      action: hasMeetingTimes ? 'Check schedule' : 'Set times'
    },
    {
      title: 'Build Year Plan',
      body: 'Add lessons or apply a starter plan.',
      done: hasLessons,
      to: '/management',
      managementTab: 'curriculum' as ManagementTabTarget,
      action: hasLessons ? 'Review plan' : 'Add starter plan'
    },
    {
      title: 'Add segments',
      body: 'Break lessons into teachable chunks.',
      done: hasSegments,
      to: '/management',
      managementTab: 'curriculum' as ManagementTabTarget,
      action: hasSegments ? 'Review segments' : 'Add segments'
    },
    {
      title: 'Try Classroom',
      body: 'Resume from the right stopping point.',
      done: hasClassroomResume,
      to: '/classroom',
      managementTab: null,
      action: 'Open classroom'
    }
  ];
  const completedSetupSteps = setupSteps.filter((step) => step.done).length;
  const setupCompletionPercent = Math.round((completedSetupSteps / setupSteps.length) * 100);

  const smartPrompts = useMemo(() => {
    const prompts = [];

    if (!state.courses.length) {
      prompts.push({
        title: 'Create your first course',
        body: 'Start with one course so schedule sections and lesson tracking have somewhere to attach.',
        to: '/management',
        managementTab: 'courses' as ManagementTabTarget,
        action: 'Open Courses'
      });
    }

    if (!state.schedule?.sections.length) {
      prompts.push({
        title: 'Build your schedule',
        body: 'Add periods manually or import a schedule, then the dashboard can reason about today.',
        to: '/management',
        managementTab: 'periods' as ManagementTabTarget,
        action: 'Open Periods'
      });
    }

    if (state.today?.currentClass && currentResume?.lesson) {
      prompts.push({
        title: 'Resume the active lesson',
        body: `${currentResume.lesson.title} is ready with ${activeLessonProgress.completed}/${activeLessonProgress.total} segments complete.`,
        to: `/sections/${state.today.currentClass.sectionId}/lessons/${currentResume.lesson.id}`,
        managementTab: null,
        action: 'Resume class'
      });
    }

    if (!state.today?.currentClass && state.today?.nextClass && nextResume?.lesson) {
      prompts.push({
        title: 'Prep the next class',
        body: `${state.today.nextClass.sectionName} is ready for ${nextResume.lesson.title}.`,
        to: `/sections/${state.today.nextClass.sectionId}/lessons/${nextResume.lesson.id}`,
        managementTab: null,
        action: 'Open tracker'
      });
    }

    if (currentResume?.state?.carryOverNote) {
      prompts.push({
        title: 'Carry-over needs attention',
        body: currentResume.state.carryOverNote,
        to: '/classroom',
        managementTab: null,
        action: 'Open Classroom'
      });
    }

    if (summary.lessonCount > 0 && summary.segmentCount === 0) {
      prompts.push({
        title: 'Add lesson segments',
        body: 'Lessons need timed segments for stopped-at tracking.',
        to: '/management',
        managementTab: 'curriculum' as ManagementTabTarget,
        action: 'Open Year Plan'
      });
    }

    if (scheduleGaps.length > 0) {
      prompts.push({
        title: 'Clean up schedule gaps',
        body: scheduleGaps[0],
        to: '/management',
        managementTab: 'weekly' as ManagementTabTarget,
        action: 'Fix schedule'
      });
    }

    prompts.push({
      title: 'Use optional tools only where they help',
      body: 'Import a messy schedule or review helper output before saving anything.',
      to: '/management',
      managementTab: 'import' as ManagementTabTarget,
      action: 'Open Import'
    });

    return prompts.slice(0, 4);
  }, [
    activeLessonProgress.completed,
    activeLessonProgress.total,
    currentResume,
    nextResume,
    scheduleGaps,
    state.courses.length,
    state.schedule?.sections.length,
    state.today?.currentClass,
    state.today?.nextClass,
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

  const copyDailyBriefing = async () => {
    const briefing = buildDailyBriefing(todayLabel, state, focusNote, checkedItems);
    await navigator.clipboard?.writeText(briefing).catch(() => undefined);
    setBriefingStatus('Daily briefing copied.');
    window.setTimeout(() => setBriefingStatus(null), 1800);
  };

  const openManagementTab = (tab: ManagementTabTarget) => {
    rememberManagementTab(tab);
    navigate('/management');
  };

  const copySetupSnapshot = async () => {
    await navigator.clipboard
      ?.writeText(buildSetupSnapshot(readinessScore, summary, state.schedule, scheduleGaps))
      .catch(() => undefined);
    setBriefingStatus('Setup snapshot copied.');
    window.setTimeout(() => setBriefingStatus(null), 1800);
  };

  const printDailyBriefing = () => {
    window.print();
  };

  return (
    <div className="dashboard-page">
      <section className="dashboard-hero">
        <div className="hero-copy">
          <p className="eyebrow">{todayLabel}</p>
          <h1>Daily Desk</h1>
          <p className="hero-subtitle">
            One calm place for today&apos;s class, next prep, schedule gaps, and course planning.
          </p>
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
            <button className="button-link secondary" type="button" onClick={() => openManagementTab('weekly')}>
              Adjust schedule
            </button>
            <button className="button-link secondary" type="button" onClick={() => void copyDailyBriefing()}>
              Copy daily brief
            </button>
            <button className="button-link secondary" type="button" onClick={() => void copySetupSnapshot()}>
              Copy setup
            </button>
            <button className="button-link secondary print-only-control" type="button" onClick={printDailyBriefing}>
              Print
            </button>
          </div>
          {briefingStatus ? <p className="inline-status">{briefingStatus}</p> : null}
        </div>

        <div className="readiness-card" aria-label={`Readiness score ${readinessScore} percent`}>
          <div className="score-ring" style={{ '--score': readinessScore } as CSSProperties}>
            <span>{readinessScore}</span>
          </div>
          <div>
            <p className="eyebrow">Readiness</p>
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

      <section className="card stack setup-readiness-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Setup</p>
            <h2>{completedSetupSteps} of {setupSteps.length} ready</h2>
            <p className="muted">Finish only the missing pieces. Everything else stays out of the way.</p>
          </div>
          <div className="setup-actions">
            <Link className="button-link secondary" to="/welcome">
              Welcome
            </Link>
            <button className="secondary" type="button" onClick={() => openManagementTab('start')}>Manage setup</button>
          </div>
        </div>
        <progress className="setup-progress" max={100} value={setupCompletionPercent} />
        <div className="setup-readiness-grid">
          {setupSteps.map((step, index) => (
            <button
              key={step.title}
              type="button"
              className={step.done ? 'setup-readiness-step done' : 'setup-readiness-step'}
              onClick={() => {
                if (step.managementTab) openManagementTab(step.managementTab);
                else navigate(step.to);
              }}
            >
              <span>{step.done ? 'Done' : `Step ${index + 1}`}</span>
              <strong>{step.title}</strong>
              <p>{step.body}</p>
              <em>{step.action}</em>
            </button>
          ))}
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
            <button className="secondary" type="button" onClick={() => openManagementTab('weekly')}>Schedule</button>
          </div>
          {state.today?.nextClass ? (
            <div className="next-class-card">
              <span>{formatRelativeClass(state.today.nextClass.meetingTime)}</span>
              <h3>{state.today.nextClass.courseName}</h3>
              <p className="muted">
                {state.today.nextClass.sectionName} / {state.today.nextClass.meetingTime ?? 'Time TBD'}
              </p>
              {nextResume?.lesson ? (
                <>
                  <p>
                    Prep: <strong>{nextResume.lesson.title}</strong>
                  </p>
                  <div className="classroom-context-grid">
                    <div>
                      <span>Progress</span>
                      <strong>{nextLessonProgress.completed}/{nextLessonProgress.total || 0} segments</strong>
                    </div>
                    <div>
                      <span>Next up</span>
                      <strong>{nextOpenSegment?.title ?? 'Lesson complete'}</strong>
                    </div>
                    <div>
                      <span>Carry-over</span>
                      <strong>{nextResume.state?.carryOverNote ?? nextResume.lastNote?.content ?? 'None'}</strong>
                    </div>
                  </div>
                  <div className="profile-actions">
                    <Link
                      className="button-link"
                      to={`/sections/${state.today.nextClass.sectionId}/lessons/${nextResume.lesson.id}`}
                    >
                      Prep next class
                    </Link>
                    <button className="secondary" type="button" onClick={() => openManagementTab('progress')}>
                      Compare progress
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="muted">No lesson found yet. Year Plan is the next stop.</p>
                  <button className="secondary" type="button" onClick={() => openManagementTab('curriculum')}>
                    Open Year Plan
                  </button>
                </>
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
            <button className="secondary" type="button" onClick={() => openManagementTab('weekly')}>Edit day</button>
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
              <button
                key={prompt.title}
                type="button"
                className="action-card"
                onClick={() => {
                  if (prompt.managementTab) openManagementTab(prompt.managementTab);
                  else navigate(prompt.to);
                }}
              >
                <strong>{prompt.title}</strong>
                <span>{prompt.body}</span>
                <em>{prompt.action}</em>
              </button>
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
            <button className="secondary" type="button" onClick={() => openManagementTab('curriculum')}>Open Year Plan</button>
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
