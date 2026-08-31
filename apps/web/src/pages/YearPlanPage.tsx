import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type {
  CourseDetailResponse,
  GetScheduleResponse,
  SchoolCalendarResponse
} from '@teacheros/contracts';

import { CurriculumTimeline } from '../components/CurriculumTimeline.js';
import { ApiError, useApiClient } from '../lib/api.js';
import {
  resolveYearPlanContext,
  yearPlanContextStorageKey,
  yearPlanSearch,
  type YearPlanContext
} from '../lib/year-plan-context.js';

type Course = CourseDetailResponse['course'];

function readRememberedContext(): YearPlanContext | null {
  try {
    const raw = window.localStorage.getItem(yearPlanContextStorageKey);
    return raw ? (JSON.parse(raw) as YearPlanContext) : null;
  } catch {
    return null;
  }
}

export function YearPlanPage() {
  const api = useApiClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [courses, setCourses] = useState<Course[]>([]);
  const [schedule, setSchedule] = useState<GetScheduleResponse | null>(null);
  const [calendar, setCalendar] = useState<SchoolCalendarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const remembered = useMemo(readRememberedContext, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [courseList, scheduleResult, calendarResult] = await Promise.all([
          api.listCourses(),
          api.getSchedule(),
          api.getSchoolCalendar()
        ]);
        const details = await Promise.all(
          courseList.courses.map((course) => api.getCourseDetail(course.id))
        );
        if (!cancelled) {
          setCourses(details.map((detail) => detail.course));
          setSchedule(scheduleResult);
          setCalendar(calendarResult);
        }
      } catch (err) {
        if (!cancelled)
          setError(err instanceof ApiError ? err.message : 'Could not load Year Plan.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const context = useMemo(
    () => resolveYearPlanContext(params, courses, [], remembered),
    [courses, params, remembered]
  );
  const selectedCourse = courses.find((course) => course.id === context.courseId) ?? null;

  useEffect(() => {
    if (loading) return;
    const nextParams = new URLSearchParams(yearPlanSearch(context));
    const selectedLesson = params.get('lesson');
    if (selectedLesson) nextParams.set('lesson', selectedLesson);
    const next = nextParams.toString();
    if (params.toString() !== next) setParams(next, { replace: true });
    if (context.courseId)
      window.localStorage.setItem(yearPlanContextStorageKey, JSON.stringify(context));
  }, [context, loading, params, setParams]);

  const updateContext = (patch: Partial<YearPlanContext>) => {
    const next = { ...context, ...patch };
    next.sectionId = null;
    setParams(yearPlanSearch(next));
  };
  const updateCourse = (detail: CourseDetailResponse) => {
    setCourses((previous) =>
      previous.map((course) => (course.id === detail.course.id ? detail.course : course))
    );
  };
  const selectedLessonId = params.get('lesson');
  const yearPlanReturnTo = (lessonId: string | null) => {
    const search = new URLSearchParams(yearPlanSearch(context));
    if (lessonId) search.set('lesson', lessonId);
    return `/year-plan?${search.toString()}`;
  };

  if (loading) return <p className="muted">Loading Year Plan…</p>;
  if (error) return <p className="notice warning">{error}</p>;
  if (!selectedCourse)
    return (
      <main className="year-plan-selection-state">
        <p className="eyebrow">Year Plan</p>
        <h1>Choose a course to begin planning</h1>
        {courses.length ? (
          <div className="year-plan-choice-list">
            {courses.map((course) => (
              <button
                key={course.id}
                type="button"
                onClick={() => updateContext({ courseId: course.id })}
              >
                {course.name}
              </button>
            ))}
          </div>
        ) : (
          <Link className="button-link" to="/courses">
            Create a course
          </Link>
        )}
      </main>
    );
  return (
    <main className="year-plan-page year-plan-canvas-page">
      <header className="year-plan-page-header">
        <div className="year-plan-title">
          <h1>Year Plan</h1>
          <span>{selectedCourse.name} curriculum</span>
        </div>
        <div className="year-plan-header-controls">
          <label>
            <span className="visually-hidden">Course</span>
            <select
              className="input"
              value={selectedCourse.id}
              onChange={(event) => updateContext({ courseId: event.target.value })}
            >
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
            </select>
          </label>
          <div className="year-plan-view-toggle small-tabs" aria-label="Year plan view">
            <button
              className={context.view === 'outline' ? 'active' : ''}
              type="button"
              onClick={() => updateContext({ view: 'outline' })}
            >
              Outline
            </button>
            <button
              className={context.view === 'timeline' ? 'active' : ''}
              type="button"
              onClick={() => updateContext({ view: 'timeline' })}
            >
              Timeline
            </button>
          </div>
        </div>
      </header>
      <CurriculumTimeline
        course={selectedCourse}
        selectedSection={null}
        holidays={(schedule?.holidays ?? []).map((holiday) => holiday.date)}
        schoolYearSettings={
          calendar?.schoolYear
            ? {
                startDate: calendar.schoolYear.startDate,
                endDate: calendar.schoolYear.endDate,
                meetingDays: [],
                bellScheduleType: 'weekly'
              }
            : null
        }
        currentLessonId={null}
        onCourseChange={updateCourse}
        onOpenSchool={() => navigate('/school')}
        displayMode={context.view}
        allowAiDrafts
        onOpenLesson={(lessonId) =>
          navigate(
            `/lessons/${lessonId}?returnTo=${encodeURIComponent(yearPlanReturnTo(lessonId))}`
          )
        }
        initialLessonId={selectedLessonId}
        onLessonSelectionChange={(lessonId) => {
          const next = new URLSearchParams(params);
          if (lessonId) next.set('lesson', lessonId);
          else next.delete('lesson');
          setParams(next, { replace: true });
        }}
      />
    </main>
  );
}
