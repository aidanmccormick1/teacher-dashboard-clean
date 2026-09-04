import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { CSSProperties } from 'react';
import type {
  CourseDetailResponse,
  CoursePacingResponse,
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
  const [pacing, setPacing] = useState<CoursePacingResponse | null>(null);
  const [pacingUpdating, setPacingUpdating] = useState(false);
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
  const courseSections =
    schedule?.sections.filter((section) => section.courseId === selectedCourse?.id) ?? [];
  const selectedSection =
    courseSections.find((section) => section.sectionId === context.sectionId) ?? null;

  useEffect(() => {
    if (!selectedCourse) {
      setPacing(null);
      return;
    }
    let cancelled = false;
    void api
      .getCoursePacing(selectedCourse.id)
      .then((response) => {
        if (!cancelled) setPacing(response);
      })
      .catch(() => {
        if (!cancelled) setPacing(null);
      });
    return () => {
      cancelled = true;
    };
  }, [api, selectedCourse?.id]);

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
    if (patch.courseId && patch.courseId !== context.courseId) next.sectionId = null;
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
            {courses.map((course, index) => (
              <button
                key={course.id}
                type="button"
                style={{ '--year-plan-choice-index': index } as CSSProperties}
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
          {courseSections.length > 1 ? (
            <label>
              <span className="visually-hidden">View a specific class group</span>
              <select
                className="input"
                value={selectedSection?.sectionId ?? ''}
                onChange={(event) => updateContext({ sectionId: event.target.value || null })}
              >
                <option value="">View a specific class group…</option>
                {courseSections.map((section) => (
                  <option key={section.sectionId} value={section.sectionId}>
                    {section.sectionName}
                  </option>
                ))}
              </select>
            </label>
          ) : courseSections.length === 1 && selectedSection ? (
            <span className="year-plan-section-context">{selectedSection.sectionName}</span>
          ) : null}
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
      {!courseSections.length ? (
        <p className="year-plan-schedule-status">
          No Class Group schedule is attached. You can plan the shared curriculum by meeting
          sequence until a schedule is added.
        </p>
      ) : null}
      {pacing ? (
        <section className="card stack" aria-label="Shared pacing reference">
          <div className="section-heading">
            <div>
              <h2>Shared pacing reference</h2>
              <p className="muted">
                This only compares each teacher’s current curriculum position. It never changes
                schedules, progress, or classroom history.
              </p>
            </div>
          </div>
          <label className="row">
            <input
              type="checkbox"
              checked={pacing.sharingEnabled}
              disabled={pacingUpdating}
              onChange={async (event) => {
                try {
                  setPacingUpdating(true);
                  setPacing(
                    await api.updateCoursePacingSharing(selectedCourse.id, {
                      enabled: event.target.checked
                    })
                  );
                } catch (err) {
                  setError(
                    err instanceof ApiError ? err.message : 'Could not update pacing sharing.'
                  );
                } finally {
                  setPacingUpdating(false);
                }
              }}
            />
            Share my class-group progress with course collaborators
          </label>
          {pacing.participants.map((participant) => (
            <div className="course-edit-meeting-row" key={participant.userId}>
              <div>
                <strong>
                  {participant.fullName ?? participant.email}
                  {participant.isCurrentUser ? ' (you)' : ''}
                </strong>
                {participant.classGroups.length ? (
                  participant.classGroups.map((group) => (
                    <span key={group.sectionId}>
                      {group.sectionName} ·{' '}
                      {group.lessonTitle
                        ? `Lesson ${typeof group.lessonOrderIndex === 'number' ? group.lessonOrderIndex + 1 : '—'}: ${group.lessonTitle}`
                        : 'No lesson position yet'}
                    </span>
                  ))
                ) : (
                  <span>No linked class groups</span>
                )}
              </div>
            </div>
          ))}
          {pacing.participants.length === 1 && !pacing.sharingEnabled ? (
            <p className="muted">
              Opt in to let collaborators compare their own current positions with yours.
            </p>
          ) : null}
        </section>
      ) : null}
      <CurriculumTimeline
        course={selectedCourse}
        selectedSection={selectedSection}
        dateProjectionOnly
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
        allowAutoGeneration
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
