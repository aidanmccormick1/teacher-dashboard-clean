export type YearPlanView = 'timeline' | 'outline';

export type YearPlanOption = { id: string; courseId?: string };

export type YearPlanContext = {
  courseId: string | null;
  sectionId: string | null;
  view: YearPlanView;
};

export const yearPlanContextStorageKey = 'teacheros_year_plan_context_v1';

export function resolveYearPlanContext(
  search: URLSearchParams,
  courses: YearPlanOption[],
  _sections: YearPlanOption[],
  remembered: YearPlanContext | null
): YearPlanContext {
  const requestedCourse = search.get('course');
  const requestedView = search.get('view');
  const courseId = courses.some((course) => course.id === requestedCourse)
    ? requestedCourse
    : remembered && courses.some((course) => course.id === remembered.courseId)
      ? remembered.courseId
      : courses.length === 1
        ? courses[0]!.id
        : null;
  // Year Plan owns one shared curriculum per course. Section schedules and
  // actual pacing remain execution data and never enter the planning URL.
  return { courseId, sectionId: null, view: requestedView === 'outline' ? 'outline' : 'timeline' };
}

export function yearPlanSearch(context: YearPlanContext): string {
  const params = new URLSearchParams({ view: context.view });
  if (context.courseId) params.set('course', context.courseId);
  return params.toString();
}
