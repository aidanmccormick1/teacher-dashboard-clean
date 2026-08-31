import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type {
  ClassroomResumeResponse,
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
  const [resumes, setResumes] = useState<Record<string, ClassroomResumeResponse>>({});
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
        const resumeEntries = await Promise.all(
          scheduleResult.sections.map(
            async (section) =>
              [section.sectionId, await api.getClassroomResume(section.sectionId)] as const
          )
        );
        if (!cancelled) {
          setCourses(details.map((detail) => detail.course));
          setSchedule(scheduleResult);
          setCalendar(calendarResult);
          setResumes(Object.fromEntries(resumeEntries));
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
    () =>
      resolveYearPlanContext(
        params,
        courses,
        (schedule?.sections ?? []).map((section) => ({
          id: section.sectionId,
          courseId: section.courseId
        })),
        remembered
      ),
    [courses, params, remembered, schedule?.sections]
  );
  const selectedCourse = courses.find((course) => course.id === context.courseId) ?? null;
  const selectedSection =
    schedule?.sections.find((section) => section.sectionId === context.sectionId) ?? null;

  useEffect(() => {
    if (loading) return;
    const next = yearPlanSearch(context);
    if (params.toString() !== next) setParams(next, { replace: true });
    if (context.courseId)
      window.localStorage.setItem(yearPlanContextStorageKey, JSON.stringify(context));
  }, [context, loading, params, setParams]);

  const updateContext = (patch: Partial<YearPlanContext>) => {
    const next = { ...context, ...patch };
    if (patch.courseId !== undefined) next.sectionId = null;
    setParams(yearPlanSearch(next));
  };
  const updateCourse = (detail: CourseDetailResponse) => {
    setCourses((previous) =>
      previous.map((course) => (course.id === detail.course.id ? detail.course : course))
    );
  };
  const returnTo = `/year-plan?${yearPlanSearch(context)}`;

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
  const courseSections =
    schedule?.sections.filter((section) => section.courseId === selectedCourse.id) ?? [];
  if (!selectedSection && courseSections.length > 1)
    return (
      <main className="year-plan-selection-state">
        <p className="eyebrow">{selectedCourse.name} · Year Plan</p>
        <h1>Choose the section whose meeting dates you are planning against</h1>
        <div className="year-plan-choice-list">
          {courseSections.map((section) => (
            <button
              key={section.sectionId}
              type="button"
              onClick={() => updateContext({ sectionId: section.sectionId })}
            >
              {section.sectionName}
            </button>
          ))}
        </div>
      </main>
    );

  const plannedMeetingCount = selectedCourse.units.reduce(
    (total, unit) => total + (unit.plannedMeetingCount ?? 0),
    0
  );
  return (
    <main className="year-plan-page">
      <header className="year-plan-page-header">
        <div>
          <p className="eyebrow">Year Plan</p>
          <h1>{selectedCourse.name}</h1>
        </div>
        <div className="year-plan-header-controls">
          <label>
            <span>Course</span>
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
          <label>
            <span>Planning against</span>
            <select
              className="input"
              value={selectedSection?.sectionId ?? ''}
              onChange={(event) => updateContext({ sectionId: event.target.value || null })}
            >
              <option value="">No section selected</option>
              {courseSections.map((section) => (
                <option key={section.sectionId} value={section.sectionId}>
                  {section.sectionName}
                </option>
              ))}
            </select>
          </label>
          <div className="year-plan-summary">
            <span>{plannedMeetingCount} planned</span>
            <span>
              {selectedSection
                ? `${selectedSection.sectionName} meeting dates`
                : 'Choose section for dates'}
            </span>
          </div>
          <div className="management-tabs small-tabs" aria-label="Year plan view">
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
        selectedSection={selectedSection}
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
        currentLessonId={
          selectedSection ? (resumes[selectedSection.sectionId]?.lesson?.id ?? null) : null
        }
        onCourseChange={updateCourse}
        onOpenSchool={() => navigate('/school')}
        displayMode={context.view}
        allowAiDrafts={false}
        onOpenLesson={(lessonId) =>
          navigate(`/lessons/${lessonId}?returnTo=${encodeURIComponent(returnTo)}`)
        }
      />
    </main>
  );
}
