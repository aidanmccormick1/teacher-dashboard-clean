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
  const requestedSection = search.get('section');
  const requestedView = search.get('view');
  const courseId = courses.some((course) => course.id === requestedCourse)
    ? requestedCourse
    : remembered && courses.some((course) => course.id === remembered.courseId)
      ? remembered.courseId
      : courses.length === 1
        ? courses[0]!.id
        : null;
  const validSections = sections.filter((section) => !courseId || section.courseId === courseId);
  // Shared curriculum is always the default Year Plan mode. A section is an
  // explicit date-preview context, never a prerequisite to planning the
  // course's meeting sequence.
  const sectionId = validSections.some((section) => section.id === requestedSection)
    ? requestedSection
    : null;
  return { courseId, sectionId, view: requestedView === 'outline' ? 'outline' : 'timeline' };
}

export function yearPlanSearch(context: YearPlanContext): string {
  const params = new URLSearchParams({ view: context.view });
  if (context.courseId) params.set('course', context.courseId);
  if (context.sectionId) params.set('section', context.sectionId);
  return params.toString();
}
