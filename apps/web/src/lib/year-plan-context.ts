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
  sections: YearPlanOption[],
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
  const courseSections = courseId
    ? sections.filter((section) => section.courseId === courseId)
    : [];
  const requestedSection = search.get('section');
  const sectionId = courseSections.some((section) => section.id === requestedSection)
    ? requestedSection
    : remembered?.courseId === courseId &&
        courseSections.some((section) => section.id === remembered.sectionId)
      ? remembered.sectionId
      : courseSections.length === 1
        ? courseSections[0]!.id
        : null;
  return { courseId, sectionId, view: requestedView === 'outline' ? 'outline' : 'timeline' };
}

export function yearPlanSearch(context: YearPlanContext): string {
  const params = new URLSearchParams({ view: context.view });
  if (context.courseId) params.set('course', context.courseId);
  if (context.sectionId) params.set('section', context.sectionId);
  return params.toString();
}
