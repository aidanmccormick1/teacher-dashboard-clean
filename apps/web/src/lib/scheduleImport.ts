import type { ParseScheduleResponse } from '@teacheros/contracts';

export function courseNameKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

function sourceVariantKey(value: string): string {
  return courseNameKey(value).replace(/\s+/g, '');
}

type CourseVariant = {
  courseName: string;
  groupLabel: string;
};

function inferCourseVariant(name: string): CourseVariant | null {
  const trimmed = name.trim().replace(/\s+/g, ' ');

  // "Spanish 5A", "Spanish 5 B", and "Spanish 5 - C" are sections of a
  // numbered course, rather than independent curricula.
  const letterSuffix = trimmed.match(/^(.+?\d(?:[\d\s./-]*\d)?)\s*(?:[-–—,:]?\s*|\(\s*)([A-Za-z])\)?$/);
  if (letterSuffix?.[1] && letterSuffix[2]) {
    return {
      courseName: letterSuffix[1].trim().replace(/[\s,;:.-]+$/, ''),
      groupLabel: `Group ${letterSuffix[2].toUpperCase()}`
    };
  }

  // These labels explicitly describe scheduling groups. They can be safely
  // removed from any course title, including a title with no number.
  const namedGroup = trimmed.match(
    /^(.+?)\s*[-–—,:]?\s*\b(block|period|section|group|class)\s*([A-Za-z0-9]+)\.?$/i
  );
  if (namedGroup?.[1] && namedGroup[2] && namedGroup[3]) {
    const groupKind = namedGroup[2];
    const label = `${groupKind.charAt(0).toUpperCase()}${groupKind.slice(1).toLowerCase()} ${namedGroup[3].toUpperCase()}`;
    return {
      courseName: namedGroup[1].trim().replace(/[\s,;:.-]+$/, ''),
      groupLabel: label
    };
  }

  return null;
}

function groupLabelWithBellPeriod(groupLabel: string, sourcePeriod: string): string {
  const period = sourcePeriod.trim();
  if (!period || courseNameKey(period) === courseNameKey(groupLabel)) return groupLabel;
  const bellPeriod = /^\d+$/.test(period) ? `Period ${period}` : period;
  return `${groupLabel} / ${bellPeriod}`;
}

export function normalizeImportedCourseVariants(schedule: ParseScheduleResponse): ParseScheduleResponse {
  const courseNameBySource = new Map<string, string>();
  const classes = schedule.classes.map((parsedClass) => {
    const variant = inferCourseVariant(parsedClass.name);
    if (!variant) return parsedClass;

    courseNameBySource.set(sourceVariantKey(parsedClass.name), variant.courseName);
    return {
      ...parsedClass,
      name: variant.courseName,
      period: groupLabelWithBellPeriod(variant.groupLabel, parsedClass.period),
      subject: parsedClass.subject || variant.courseName
    };
  });

  return {
    ...schedule,
    classes,
    assignments: schedule.assignments.map((assignment) => ({
      ...assignment,
      courseName: courseNameBySource.get(sourceVariantKey(assignment.courseName)) ?? assignment.courseName
    }))
  };
}
