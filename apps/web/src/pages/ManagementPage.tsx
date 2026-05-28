import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type {
  AiJobStatusResponse,
  ClassroomResumeResponse,
  CourseDetailResponse,
  CourseListResponse,
  GetScheduleResponse,
  ParseScheduleResponse
} from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';

type ManagementTab = 'start' | 'courses' | 'periods' | 'weekly' | 'curriculum' | 'progress' | 'import';
type YearPlanView = 'outline' | 'timeline';
type CourseDetail = CourseDetailResponse['course'];
type CourseSummary = CourseListResponse['courses'][number];
type ScheduleSection = GetScheduleResponse['sections'][number];
type ParsedScheduleClass = ParseScheduleResponse['classes'][number];
type LessonDraft = { title: string; description: string; duration: string };
type SegmentDraft = { title: string; description: string; duration: string };
type CourseEditDraft = { name: string; subject: string; gradeLevel: string };
type UnitEditDraft = { title: string; description: string; order: string };
type LessonEditDraft = { title: string; description: string; duration: string; order: string };
type SegmentEditDraft = { title: string; description: string; duration: string; order: string };
type SchoolYearSettings = {
  startDate: string;
  endDate: string;
  meetingDays: string[];
  bellScheduleType: 'weekly' | 'block' | 'ab' | 'rotating';
};
type SectionEditDraft = {
  courseId: string;
  sectionName: string;
  days: string;
  time: string;
  room: string;
};
type LocalScheduleParseResult = ParseScheduleResponse & {
  confidence: number;
  warnings: string[];
};
type YearPlanTemplate = {
  id: string;
  name: string;
  description: string;
  units: Array<{
    title: string;
    description: string;
    lessons: Array<{
      title: string;
      minutes: number;
      segments: Array<{ title: string; minutes: number }>;
    }>;
  }>;
};
type ParsedClassEditDraft = {
  name: string;
  period: string;
  subject: string;
  grade: string;
  days: string;
  time: string;
  room: string;
};
type NewCourseDraft = {
  name: string;
  subject: string;
  grade: string;
  periods: string;
};
type AddPeriodDraft = {
  courseId: string;
  sectionName: string;
  meetingDays: Array<(typeof meetingDays)[number]>;
  time: string;
  room: string;
};

type ManagementState = {
  courses: CourseSummary[];
  courseDetails: CourseDetail[];
  schedule: GetScheduleResponse | null;
  resumesBySectionId: Record<string, ClassroomResumeResponse>;
};

const tabs: Array<{ id: ManagementTab; label: string }> = [
  { id: 'start', label: 'Start' },
  { id: 'courses', label: 'Courses' },
  { id: 'periods', label: 'Periods' },
  { id: 'weekly', label: 'Weekly Schedule' },
  { id: 'curriculum', label: 'Year Plan' },
  { id: 'progress', label: 'Progress' },
  { id: 'import', label: 'Import' }
];

const meetingDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'A-Day', 'B-Day'] as const;
const maxScheduleUploadBytes = 10 * 1024 * 1024;
const schoolYearStorageKey = 'teacheros_school_year_settings';
const walkthroughStorageKey = 'teacheros_management_walkthrough_v1';
const newCourseDraftStorageKey = 'teacheros_management_new_course_draft_v1';
const addPeriodDraftStorageKey = 'teacheros_management_add_period_draft_v1';
const activeTabStorageKey = 'teacheros_management_active_tab_v1';
const yearPlanTemplates: YearPlanTemplate[] = [
  {
    id: 'starter-4-week',
    name: '4-week starter',
    description: 'A simple first unit with reusable lesson rhythm.',
    units: [
      {
        title: 'Unit 1: Foundations',
        description: 'Introduce core routines, vocabulary, and baseline skills.',
        lessons: [
          {
            title: 'Course launch and expectations',
            minutes: 45,
            segments: [
              { title: 'Welcome and routine setup', minutes: 10 },
              { title: 'Course map walkthrough', minutes: 15 },
              { title: 'Student reflection', minutes: 15 },
              { title: 'Exit ticket', minutes: 5 }
            ]
          },
          {
            title: 'Core vocabulary and prior knowledge',
            minutes: 45,
            segments: [
              { title: 'Warm-up', minutes: 5 },
              { title: 'Vocabulary preview', minutes: 15 },
              { title: 'Partner practice', minutes: 20 },
              { title: 'Check for understanding', minutes: 5 }
            ]
          },
          {
            title: 'First skill practice',
            minutes: 45,
            segments: [
              { title: 'Model', minutes: 10 },
              { title: 'Guided practice', minutes: 15 },
              { title: 'Independent attempt', minutes: 15 },
              { title: 'Wrap-up', minutes: 5 }
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'unit-project',
    name: 'Project unit',
    description: 'A flexible unit with launch, work days, feedback, and presentation.',
    units: [
      {
        title: 'Project Unit',
        description: 'Build toward a student-created product or performance task.',
        lessons: [
          {
            title: 'Project launch',
            minutes: 50,
            segments: [
              { title: 'Essential question', minutes: 10 },
              { title: 'Rubric walkthrough', minutes: 15 },
              { title: 'Planning time', minutes: 20 },
              { title: 'Next-step check', minutes: 5 }
            ]
          },
          {
            title: 'Research and build day',
            minutes: 50,
            segments: [
              { title: 'Goal setting', minutes: 5 },
              { title: 'Work block', minutes: 35 },
              { title: 'Teacher conferences', minutes: 5 },
              { title: 'Progress log', minutes: 5 }
            ]
          },
          {
            title: 'Peer feedback',
            minutes: 50,
            segments: [
              { title: 'Feedback norms', minutes: 8 },
              { title: 'Peer review rounds', minutes: 30 },
              { title: 'Revision plan', minutes: 10 },
              { title: 'Exit ticket', minutes: 2 }
            ]
          },
          {
            title: 'Present and reflect',
            minutes: 50,
            segments: [
              { title: 'Presentation setup', minutes: 5 },
              { title: 'Presentations', minutes: 35 },
              { title: 'Reflection', minutes: 10 }
            ]
          }
        ]
      }
    ]
  }
];
const dayAliases: Record<string, (typeof meetingDays)[number]> = {
  m: 'Monday',
  mon: 'Monday',
  monday: 'Monday',
  t: 'Tuesday',
  tue: 'Tuesday',
  tues: 'Tuesday',
  tuesday: 'Tuesday',
  w: 'Wednesday',
  wed: 'Wednesday',
  wednesday: 'Wednesday',
  th: 'Thursday',
  thu: 'Thursday',
  thur: 'Thursday',
  thurs: 'Thursday',
  thursday: 'Thursday',
  f: 'Friday',
  fri: 'Friday',
  friday: 'Friday',
  a: 'A-Day',
  'a-day': 'A-Day',
  b: 'B-Day',
  'b-day': 'B-Day'
};

function isTerminalStatus(status: AiJobStatusResponse['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

function readManagementActiveTab(): ManagementTab {
  try {
    const saved = window.localStorage.getItem(activeTabStorageKey);
    const matchingTab = tabs.find((tab) => tab.id === saved);
    return matchingTab?.id ?? 'start';
  } catch {
    return 'start';
  }
}

function readStringList(key: string): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? '[]') as string[];
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function writeStringList(key: string, value: string[]) {
  window.localStorage.setItem(key, JSON.stringify([...new Set(value)]));
}

function readNewCourseDraft(): NewCourseDraft {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(newCourseDraftStorageKey) ?? '{}') as Partial<NewCourseDraft>;
    return {
      name: parsed.name ?? '',
      subject: parsed.subject ?? '',
      grade: parsed.grade ?? '',
      periods: parsed.periods ?? ''
    };
  } catch {
    return { name: '', subject: '', grade: '', periods: '' };
  }
}

function readAddPeriodDraft(): AddPeriodDraft {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(addPeriodDraftStorageKey) ?? '{}') as Partial<AddPeriodDraft>;
    const savedDays = Array.isArray(parsed.meetingDays)
      ? parsed.meetingDays.filter((day): day is (typeof meetingDays)[number] =>
          meetingDays.includes(day)
        )
      : [];
    return {
      courseId: parsed.courseId ?? '',
      sectionName: parsed.sectionName ?? '',
      meetingDays: savedDays.length ? savedDays : ['Monday'],
      time: parsed.time ?? '',
      room: parsed.room ?? ''
    };
  } catch {
    return { courseId: '', sectionName: '', meetingDays: ['Monday'], time: '', room: '' };
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Could not read file'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function toNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseNullablePositiveInt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseOptionalOrder(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) return undefined;
  return parsed;
}

function parsedClassToDraft(parsedClass: ParsedScheduleClass): ParsedClassEditDraft {
  return {
    name: parsedClass.name,
    period: parsedClass.period,
    subject: parsedClass.subject,
    grade: parsedClass.grade ?? '',
    days: parsedClass.days.join(', '),
    time: parsedClass.time ?? '',
    room: parsedClass.room ?? ''
  };
}

function draftToParsedClass(draft: ParsedClassEditDraft): ParsedScheduleClass {
  const days = draft.days
    .split(',')
    .map((day) => day.trim())
    .filter((day): day is (typeof meetingDays)[number] =>
      meetingDays.includes(day as (typeof meetingDays)[number])
    );

  return {
    name: draft.name.trim(),
    period: draft.period.trim(),
    subject: draft.subject.trim() || draft.name.trim(),
    grade: draft.grade.trim(),
    days: days.length ? days : ['Monday'],
    time: draft.time.trim() || null,
    room: draft.room.trim() || null
  };
}

function parseMeetingDaysInput(value: string): Array<(typeof meetingDays)[number]> {
  const days = value
    .split(',')
    .map((day) => day.trim())
    .filter((day): day is (typeof meetingDays)[number] =>
      meetingDays.includes(day as (typeof meetingDays)[number])
    );

  return days.length ? days : ['Monday'];
}

function normalizeTime(value: string): string | null {
  const match = value.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = match[2] ?? '00';
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (hour > 23) return null;
  return `${String(hour).padStart(2, '0')}:${minute}`;
}

function parseDaysFromText(value: string): Array<(typeof meetingDays)[number]> {
  const found = new Set<(typeof meetingDays)[number]>();
  const compact = value.match(/\b[MTWFS]{2,5}\b/g);
  compact?.forEach((token) => {
    token.split('').forEach((letter) => {
      const day = dayAliases[letter.toLowerCase()];
      if (day) found.add(day);
    });
  });

  value
    .split(/[\s,;/|]+/)
    .map((token) => token.trim().toLowerCase())
    .forEach((token) => {
      const day = dayAliases[token];
      if (day) found.add(day);
    });

  return [...found];
}

function parseLocalScheduleText(text: string): LocalScheduleParseResult {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const classes: ParsedScheduleClass[] = [];
  const warnings: string[] = [];

  lines.forEach((line) => {
    const periodMatch = line.match(/\b(?:period|per\.?|block|class)\s*([A-Za-z0-9-]+)\b/i);
    const loosePeriodMatch = line.match(/^\s*([A-Za-z]?\d+[A-Za-z]?|[AB]-?Day|Block\s+[A-Za-z0-9-]+)/i);
    const period = periodMatch?.[1] ?? loosePeriodMatch?.[1] ?? '';
    const days = parseDaysFromText(line);
    const time = normalizeTime(line);
    const roomMatch = line.match(/\b(?:room|rm\.?)\s*([A-Za-z0-9-]+)\b/i);
    const courseCandidate = line
      .replace(/\b(?:period|per\.?|block|class)\s*[A-Za-z0-9-]+\b/gi, '')
      .replace(/\b(?:room|rm\.?)\s*[A-Za-z0-9-]+\b/gi, '')
      .replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, '')
      .replace(/\b[MTWFS]{2,5}\b/g, '')
      .replace(/\b(?:mon|tue|tues|wed|thu|thur|thurs|fri|monday|tuesday|wednesday|thursday|friday|a-day|b-day)\b/gi, '')
      .replace(/[-–—|,;]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (period && courseCandidate && days.length) {
      classes.push({
        name: courseCandidate,
        period: period.toLowerCase().startsWith('period') ? period : `Period ${period}`,
        days,
        time,
        room: roomMatch?.[1] ?? null,
        subject: courseCandidate,
        grade: ''
      });
    } else {
      warnings.push(`Skipped: ${line}`);
    }
  });

  const confidence = lines.length ? Math.round((classes.length / lines.length) * 100) : 0;
  return {
    classes,
    assignments: [],
    confidence,
    warnings
  };
}

function sectionToDraft(section: ScheduleSection): SectionEditDraft {
  const firstMeeting = section.meetings[0];
  const days = section.meetings.length ? section.meetings.map((meeting) => meeting.day).join(', ') : 'Monday';

  return {
    courseId: section.courseId,
    sectionName: section.sectionName,
    days,
    time: firstMeeting?.time ?? '',
    room: firstMeeting?.room ?? ''
  };
}

function unitToDraft(unit: CourseDetail['units'][number]): UnitEditDraft {
  return {
    title: unit.title,
    description: unit.description ?? '',
    order: String(unit.orderIndex)
  };
}

function lessonToDraft(lesson: CourseDetail['units'][number]['lessons'][number]): LessonEditDraft {
  return {
    title: lesson.title,
    description: lesson.description ?? '',
    duration: lesson.estimatedDurationMinutes ? String(lesson.estimatedDurationMinutes) : '',
    order: String(lesson.orderIndex)
  };
}

function segmentToDraft(
  segment: CourseDetail['units'][number]['lessons'][number]['segments'][number]
): SegmentEditDraft {
  return {
    title: segment.title,
    description: segment.description ?? '',
    duration: segment.durationMinutes ? String(segment.durationMinutes) : '',
    order: String(segment.orderIndex)
  };
}

function readSchoolYearSettings(): SchoolYearSettings | null {
  const raw = window.localStorage.getItem(schoolYearStorageKey);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SchoolYearSettings>;
    if (!parsed.startDate || !parsed.endDate) return null;
    return {
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      meetingDays: parsed.meetingDays ?? [],
      bellScheduleType: parsed.bellScheduleType ?? 'weekly'
    };
  } catch {
    return null;
  }
}

function schoolYearProgress(settings: SchoolYearSettings | null) {
  if (!settings) return null;
  const start = new Date(`${settings.startDate}T12:00:00`);
  const end = new Date(`${settings.endDate}T12:00:00`);
  const today = new Date();
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;
  const total = end.getTime() - start.getTime();
  const elapsed = Math.min(Math.max(today.getTime() - start.getTime(), 0), total);
  const percent = Math.round((elapsed / total) * 100);
  const remainingDays = Math.max(0, Math.ceil((end.getTime() - today.getTime()) / 86_400_000));
  return { percent, remainingDays };
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

function courseSections(course: CourseDetail, sections: ScheduleSection[]) {
  return sections.filter((section) => section.courseId === course.id);
}

function courseLessonIds(course: CourseDetail) {
  return course.units.flatMap((unit) => unit.lessons.map((lesson) => lesson.id));
}

function formatMeeting(section: ScheduleSection): string {
  if (!section.meetings.length) return 'No meeting times';
  return section.meetings
    .map((meeting) => {
      const time = meeting.time ?? 'TBD';
      const room = meeting.room ? `, ${meeting.room}` : '';
      return `${meeting.day} ${time}${room}`;
    })
    .join(' | ');
}

function sectionProgressLabel(section: ScheduleSection, resume: ClassroomResumeResponse | undefined) {
  if (!resume?.lesson) return `${section.sectionName}: no lesson started`;
  const segmentCount = resume.lesson.segments.length;
  const completed = resume.state?.completedSegmentIds.length ?? 0;
  const status = completed >= segmentCount && segmentCount > 0 ? 'completed' : 'in progress';
  return `${section.sectionName}: ${resume.lesson.title}, ${status}`;
}

function sectionPercent(resume: ClassroomResumeResponse | undefined): number {
  if (!resume?.lesson?.segments.length) return 0;
  return Math.round(((resume.state?.completedSegmentIds.length ?? 0) / resume.lesson.segments.length) * 100);
}

function segmentStatusLabel(resume: ClassroomResumeResponse | undefined, segmentId: string): string {
  if (resume?.state?.completedSegmentIds.includes(segmentId)) return 'Completed';
  if (resume?.state?.currentSegmentId === segmentId || resume?.state?.stoppedAtSegmentId === segmentId) {
    return 'In progress';
  }
  return 'Not started';
}

function promptForState(state: ManagementState, selectedCourse: CourseDetail | null) {
  const sections = state.schedule?.sections ?? [];
  const selectedSections = selectedCourse ? courseSections(selectedCourse, sections) : [];
  const hasMeetingTimes = selectedSections.some((section) => section.meetings.length > 0);
  const hasLessons = Boolean(selectedCourse?.units.some((unit) => unit.lessons.length > 0));

  if (!state.courses.length) {
    return {
      id: 'create-course',
      title: 'Create your first course',
      body: 'Start with what you teach. The course becomes the shared year plan.',
      tab: 'courses' as ManagementTab
    };
  }
  if (!selectedSections.length) {
    return {
      id: 'add-periods',
      title: 'Add the periods that teach this course',
      body: 'Periods share the same course plan, but each period tracks progress separately.',
      tab: 'periods' as ManagementTab
    };
  }
  if (!hasMeetingTimes) {
    return {
      id: 'add-times',
      title: 'Add meeting days and times',
      body: 'Schedule data lets the app know what class is current and what comes next.',
      tab: 'weekly' as ManagementTab
    };
  }
  if (!hasLessons) {
    return {
      id: 'build-year-plan',
      title: 'Build your year plan',
      body: 'Add units and lessons so each period has a course path to follow.',
      tab: 'curriculum' as ManagementTab
    };
  }
  return {
    id: 'open-teaching-plan',
    title: "Open today's teaching plan",
    body: 'Use Classroom when class starts so progress stays tied to the right period.',
    tab: 'curriculum' as ManagementTab
  };
}

export function ManagementPage() {
  const api = useApiClient();
  const navigate = useNavigate();
  const [savedNewCourseDraft] = useState(readNewCourseDraft);
  const [savedAddPeriodDraft] = useState(readAddPeriodDraft);
  const [activeTab, setActiveTab] = useState<ManagementTab>(readManagementActiveTab);
  const [state, setState] = useState<ManagementState>({
    courses: [],
    courseDetails: [],
    schedule: null,
    resumesBySectionId: {}
  });
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [yearPlanViewByCourseId, setYearPlanViewByCourseId] = useState<Record<string, YearPlanView>>({});
  const [schoolYearSettings, setSchoolYearSettings] = useState<SchoolYearSettings | null>(null);
  const [dismissedPromptIds, setDismissedPromptIds] = useState<string[]>([]);
  const [isNewCourseOpen, setIsNewCourseOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newCourseName, setNewCourseName] = useState(savedNewCourseDraft.name);
  const [newCourseSubject, setNewCourseSubject] = useState(savedNewCourseDraft.subject);
  const [newCourseGrade, setNewCourseGrade] = useState(savedNewCourseDraft.grade);
  const [newCoursePeriods, setNewCoursePeriods] = useState(savedNewCourseDraft.periods);
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null);
  const [courseEditDrafts, setCourseEditDrafts] = useState<Record<string, CourseEditDraft>>({});
  const [quickCourseName, setQuickCourseName] = useState('');
  const [quickCourseSubject, setQuickCourseSubject] = useState('');

  const [selectedCourseForSchedule, setSelectedCourseForSchedule] = useState(savedAddPeriodDraft.courseId);
  const [sectionName, setSectionName] = useState(savedAddPeriodDraft.sectionName);
  const [selectedMeetingDays, setSelectedMeetingDays] = useState<Array<(typeof meetingDays)[number]>>(savedAddPeriodDraft.meetingDays);
  const [meetingTime, setMeetingTime] = useState(savedAddPeriodDraft.time);
  const [meetingRoom, setMeetingRoom] = useState(savedAddPeriodDraft.room);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [sectionEditDrafts, setSectionEditDrafts] = useState<Record<string, SectionEditDraft>>({});
  const [scheduleImportText, setScheduleImportText] = useState('');
  const [scheduleImportFileName, setScheduleImportFileName] = useState('');
  const [scheduleImportFileMimeType, setScheduleImportFileMimeType] = useState('');
  const [scheduleImportFileDataUrl, setScheduleImportFileDataUrl] = useState('');
  const [scheduleImportJobId, setScheduleImportJobId] = useState<string | null>(null);
  const [scheduleImportJob, setScheduleImportJob] = useState<AiJobStatusResponse | null>(null);
  const [scheduleImportOutput, setScheduleImportOutput] = useState<ParseScheduleResponse | null>(null);
  const [localScheduleParse, setLocalScheduleParse] = useState<LocalScheduleParseResult | null>(null);
  const [parsedClassEditDrafts, setParsedClassEditDrafts] = useState<Record<string, ParsedClassEditDraft>>({});
  const [addedParsedClassKeys, setAddedParsedClassKeys] = useState<string[]>([]);
  const [completedWalkthroughIds, setCompletedWalkthroughIds] = useState<string[]>(() => readStringList(walkthroughStorageKey));
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const [unitTitle, setUnitTitle] = useState('');
  const [unitDescription, setUnitDescription] = useState('');
  const [unitOrder, setUnitOrder] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState(yearPlanTemplates[0]?.id ?? '');
  const [lessonDrafts, setLessonDrafts] = useState<Record<string, LessonDraft>>({});
  const [segmentDrafts, setSegmentDrafts] = useState<Record<string, SegmentDraft>>({});
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [editingLessonId, setEditingLessonId] = useState<string | null>(null);
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [unitEditDrafts, setUnitEditDrafts] = useState<Record<string, UnitEditDraft>>({});
  const [lessonEditDrafts, setLessonEditDrafts] = useState<Record<string, LessonEditDraft>>({});
  const [segmentEditDrafts, setSegmentEditDrafts] = useState<Record<string, SegmentEditDraft>>({});

  const loadManagement = useCallback(
    async (showLoading = true) => {
      if (showLoading) setLoading(true);
      setError(null);

      try {
        const [coursesResult, scheduleResult] = await Promise.allSettled([
          api.listCourses(),
          api.getSchedule()
        ]);

        const courses = coursesResult.status === 'fulfilled' ? coursesResult.value.courses : [];
        const schedule = scheduleResult.status === 'fulfilled' ? scheduleResult.value : null;
        const detailResults = await Promise.allSettled(courses.map((course) => api.getCourseDetail(course.id)));
        const courseDetails = detailResults
          .filter((result): result is PromiseFulfilledResult<CourseDetailResponse> => result.status === 'fulfilled')
          .map((result) => result.value.course);
        const sectionIds = schedule?.sections.map((section) => section.sectionId) ?? [];
        const resumeResults = await Promise.allSettled(
          sectionIds.map(async (sectionId) => [sectionId, await api.getClassroomResume(sectionId)] as const)
        );
        const resumesBySectionId = Object.fromEntries(
          resumeResults
            .filter(
              (result): result is PromiseFulfilledResult<readonly [string, ClassroomResumeResponse]> =>
                result.status === 'fulfilled'
            )
            .map((result) => result.value)
        );

        setState({
          courses,
          courseDetails,
          schedule,
          resumesBySectionId
        });

        if (coursesResult.status === 'rejected' || scheduleResult.status === 'rejected') {
          setError('Some management data could not load.');
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load management page');
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [api]
  );

  useEffect(() => {
    void loadManagement(true);
    setSchoolYearSettings(readSchoolYearSettings());
  }, [loadManagement]);

  useEffect(() => {
    window.localStorage.setItem(activeTabStorageKey, activeTab);
  }, [activeTab]);

  useEffect(() => {
    window.localStorage.setItem(
      newCourseDraftStorageKey,
      JSON.stringify({
        name: newCourseName,
        subject: newCourseSubject,
        grade: newCourseGrade,
        periods: newCoursePeriods
      })
    );
  }, [newCourseGrade, newCourseName, newCoursePeriods, newCourseSubject]);

  useEffect(() => {
    window.localStorage.setItem(
      addPeriodDraftStorageKey,
      JSON.stringify({
        courseId: selectedCourseForSchedule,
        sectionName,
        meetingDays: selectedMeetingDays,
        time: meetingTime,
        room: meetingRoom
      })
    );
  }, [meetingRoom, meetingTime, sectionName, selectedCourseForSchedule, selectedMeetingDays]);

  useEffect(() => {
    writeStringList(walkthroughStorageKey, completedWalkthroughIds);
  }, [completedWalkthroughIds]);

  useEffect(() => {
    if (!scheduleImportJobId) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const status = await api.getAiJobStatus(scheduleImportJobId);
        if (cancelled) return;

        setScheduleImportJob(status);
        if (status.output) {
          setScheduleImportOutput(status.output as ParseScheduleResponse);
        }
        if (status.status === 'failed' && status.error) {
          setError(status.error);
        }
        if (isTerminalStatus(status.status)) {
          window.clearInterval(timer);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to read schedule upload status');
        }
      }
    };

    const timer = window.setInterval(() => {
      void poll();
    }, 1200);
    void poll();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [api, scheduleImportJobId]);

  const sections = useMemo(() => state.schedule?.sections ?? [], [state.schedule]);
  const selectedCourse = useMemo(
    () => state.courseDetails.find((course) => course.id === selectedCourseId) ?? state.courseDetails[0] ?? null,
    [selectedCourseId, state.courseDetails]
  );
  const selectedSections = useMemo(
    () => (selectedCourse ? courseSections(selectedCourse, sections) : []),
    [selectedCourse, sections]
  );
  const selectedSection = useMemo(
    () => selectedSections.find((section) => section.sectionId === selectedSectionId) ?? selectedSections[0] ?? null,
    [selectedSectionId, selectedSections]
  );
  const selectedYearPlanView = selectedCourse ? yearPlanViewByCourseId[selectedCourse.id] ?? 'outline' : 'outline';
  const schoolProgress = schoolYearProgress(schoolYearSettings);

  useEffect(() => {
    const firstCourse = state.courseDetails[0];
    if (!firstCourse) {
      setSelectedCourseId('');
      return;
    }
    if (!selectedCourseId || !state.courseDetails.some((course) => course.id === selectedCourseId)) {
      setSelectedCourseId(firstCourse.id);
    }
  }, [selectedCourseId, state.courseDetails]);

  useEffect(() => {
    const firstCourse = state.courses[0];
    if (!firstCourse) {
      setSelectedCourseForSchedule('');
      return;
    }
    if (!selectedCourseForSchedule || !state.courses.some((course) => course.id === selectedCourseForSchedule)) {
      setSelectedCourseForSchedule(selectedCourse?.id ?? firstCourse.id);
    }
  }, [selectedCourse?.id, selectedCourseForSchedule, state.courses]);

  useEffect(() => {
    const firstSection = selectedSections[0];
    if (!firstSection) {
      setSelectedSectionId(null);
      return;
    }
    if (!selectedSectionId || !selectedSections.some((section) => section.sectionId === selectedSectionId)) {
      setSelectedSectionId(firstSection.sectionId);
    }
  }, [selectedSectionId, selectedSections]);

  const prompt = promptForState(state, selectedCourse);
  const showPrompt = prompt && !dismissedPromptIds.includes(prompt.id);
  const selectedDepth = selectedCourse ? courseDepth(selectedCourse) : { units: 0, lessons: 0, segments: 0 };
  const selectedCourseLessonIds = selectedCourse ? courseLessonIds(selectedCourse) : [];
  const plannedPercent = selectedDepth.lessons > 0 ? Math.min(100, Math.round((selectedDepth.segments / selectedDepth.lessons) * 20)) : 0;
  const meetingsRemaining = selectedSections.reduce((count, section) => count + section.meetings.length, 0);
  const setupSnapshot = [
    { label: 'Courses', value: state.courseDetails.length },
    { label: 'Periods', value: sections.length },
    { label: 'Units', value: state.courseDetails.reduce((count, course) => count + course.units.length, 0) },
    {
      label: 'Lessons',
      value: state.courseDetails.reduce((count, course) => count + courseDepth(course).lessons, 0)
    }
  ];
  const weeklySchedule = meetingDays.map((day) => ({
    day,
    sections: sections.filter((section) => section.meetings.some((meeting) => meeting.day === day))
  }));
  const hasMeetingGaps = sections.some((section) =>
    !section.meetings.length || section.meetings.some((meeting) => !meeting.time || !meeting.room)
  );
  const walkthroughSteps = [
    {
      id: 'course',
      title: 'Create your first course',
      body: 'Name what you teach once. Periods can share it.',
      tab: 'courses' as ManagementTab,
      done: state.courseDetails.length > 0
    },
    {
      id: 'periods',
      title: 'Add class periods',
      body: 'Add the real groups of students you see each day.',
      tab: 'periods' as ManagementTab,
      done: sections.length > 0
    },
    {
      id: 'schedule',
      title: 'Add meeting days and times',
      body: 'This lets the dashboard know what is happening today.',
      tab: 'weekly' as ManagementTab,
      done: sections.some((section) => section.meetings.length > 0)
    },
    {
      id: 'year-plan',
      title: 'Build a starter year plan',
      body: 'Add units, lessons, and segments so Classroom has a path.',
      tab: 'curriculum' as ManagementTab,
      done: state.courseDetails.some((course) => courseDepth(course).lessons > 0)
    },
    {
      id: 'classroom',
      title: 'Open Classroom',
      body: 'Use it during class to keep each period in the right place.',
      tab: 'progress' as ManagementTab,
      done: Object.values(state.resumesBySectionId).some((resume) => Boolean(resume.lesson))
    }
  ];

  const updateFromDetail = (detail: CourseDetailResponse) => {
    const nextCourse = detail.course;
    const nextSummary: CourseSummary = {
      id: nextCourse.id,
      name: nextCourse.name,
      subject: nextCourse.subject,
      gradeLevel: nextCourse.gradeLevel,
      createdAt: nextCourse.createdAt
    };

    setState((previous) => ({
      ...previous,
      courses: previous.courses.some((course) => course.id === nextCourse.id)
        ? previous.courses.map((course) => (course.id === nextCourse.id ? nextSummary : course))
        : [nextSummary, ...previous.courses],
      courseDetails: previous.courseDetails.some((course) => course.id === nextCourse.id)
        ? previous.courseDetails.map((course) => (course.id === nextCourse.id ? nextCourse : course))
        : [nextCourse, ...previous.courseDetails]
    }));
  };

  const createCourse = async (name: string, subject: string, gradeLevel: string) => {
    const detail = await api.createCourse({
      name: name.trim(),
      subject: toNullable(subject),
      gradeLevel: toNullable(gradeLevel)
    });
    updateFromDetail(detail);
    setSelectedCourseId(detail.course.id);
    setSelectedCourseForSchedule(detail.course.id);
    return detail.course;
  };

  const flashCopyStatus = (message: string) => {
    setCopyStatus(message);
    window.setTimeout(() => setCopyStatus(null), 1800);
  };

  const markWalkthroughStep = (stepId: string) => {
    setCompletedWalkthroughIds((previous) => [...new Set([...previous, stepId])]);
  };

  const copyNewCourseDraft = async () => {
    const summary = [
      'New course draft',
      `Course: ${newCourseName.trim() || 'Untitled'}`,
      `Subject: ${newCourseSubject.trim() || 'Not set'}`,
      `Grade: ${newCourseGrade.trim() || 'Not set'}`,
      `Periods: ${newCoursePeriods.trim() || 'Not set'}`
    ].join('\n');
    await navigator.clipboard?.writeText(summary).catch(() => undefined);
    flashCopyStatus('Course draft copied.');
  };

  const clearNewCourseDraft = () => {
    setNewCourseName('');
    setNewCourseSubject('');
    setNewCourseGrade('');
    setNewCoursePeriods('');
    window.localStorage.removeItem(newCourseDraftStorageKey);
    flashCopyStatus('Course draft cleared.');
  };

  const copyAddPeriodDraft = async () => {
    const selectedCourseName = state.courses.find((course) => course.id === selectedCourseForSchedule)?.name ?? 'Not selected';
    const summary = [
      'Class period draft',
      `Course: ${selectedCourseName}`,
      `Period: ${sectionName.trim() || 'Untitled'}`,
      `Days: ${selectedMeetingDays.join(', ')}`,
      `Time: ${meetingTime || 'Not set'}`,
      `Room: ${meetingRoom.trim() || 'Not set'}`
    ].join('\n');
    await navigator.clipboard?.writeText(summary).catch(() => undefined);
    flashCopyStatus('Period draft copied.');
  };

  const clearAddPeriodDraft = () => {
    setSectionName('');
    setSelectedMeetingDays(['Monday']);
    setMeetingTime('');
    setMeetingRoom('');
    window.localStorage.removeItem(addPeriodDraftStorageKey);
    flashCopyStatus('Period draft cleared.');
  };

  const copyYearPlanSummary = async () => {
    if (!selectedCourse) return;
    const depth = courseDepth(selectedCourse);
    const summary = [
      `${selectedCourse.name} Year Plan`,
      `${depth.units} units / ${depth.lessons} lessons / ${depth.segments} segments`,
      '',
      ...selectedCourse.units.flatMap((unit) => [
        `Unit ${unit.orderIndex}: ${unit.title}`,
        ...unit.lessons.map((lesson) => `- ${lesson.title} (${lesson.segments.length} segments)`)
      ])
    ].join('\n');
    await navigator.clipboard?.writeText(summary).catch(() => undefined);
    flashCopyStatus('Year plan copied.');
  };

  const copyImportSummary = async () => {
    if (!scheduleImportOutput) return;
    const summary = [
      'Schedule import review',
      `${scheduleImportOutput.classes.length} classes found`,
      '',
      ...scheduleImportOutput.classes.map((parsedClass) => {
        const editedClass = parsedClassFromDraft(parsedClass);
        return `${editedClass.period}: ${editedClass.name} / ${editedClass.days.join(', ')} / ${editedClass.time ?? 'Time TBD'} / ${editedClass.room ?? 'Room TBD'}`;
      })
    ].join('\n');
    await navigator.clipboard?.writeText(summary).catch(() => undefined);
    flashCopyStatus('Import summary copied.');
  };

  const selectCourse = (courseId: string, nextTab?: ManagementTab) => {
    setSelectedCourseId(courseId);
    setSelectedCourseForSchedule(courseId);
    if (nextTab) setActiveTab(nextTab);
  };

  const beginCourseEdit = (course: CourseDetail) => {
    setEditingCourseId(course.id);
    setCourseEditDrafts((previous) => ({
      ...previous,
      [course.id]: {
        name: course.name,
        subject: course.subject ?? '',
        gradeLevel: course.gradeLevel ?? ''
      }
    }));
  };

  const updateCourseDraft = (courseId: string, patch: Partial<CourseEditDraft>) => {
    setCourseEditDrafts((previous) => ({
      ...previous,
      [courseId]: {
        ...(previous[courseId] ?? { name: '', subject: '', gradeLevel: '' }),
        ...patch
      }
    }));
  };

  const beginSectionEdit = (section: ScheduleSection) => {
    setEditingSectionId(section.sectionId);
    setSectionEditDrafts((previous) => ({
      ...previous,
      [section.sectionId]: sectionToDraft(section)
    }));
  };

  const updateSectionDraft = (sectionId: string, patch: Partial<SectionEditDraft>) => {
    setSectionEditDrafts((previous) => ({
      ...previous,
      [sectionId]: {
        ...(previous[sectionId] ?? {
          courseId: selectedCourseForSchedule,
          sectionName: '',
          days: 'Monday',
          time: '',
          room: ''
        }),
        ...patch
      }
    }));
  };

  const saveSectionEdit = async (sectionId: string) => {
    const draft = sectionEditDrafts[sectionId];
    if (!draft?.sectionName.trim()) {
      setError('Period name is required.');
      return;
    }

    try {
      setBusy(true);
      const schedule = await api.updateSection(sectionId, {
        sectionName: draft.sectionName.trim(),
        meetings: parseMeetingDaysInput(draft.days).map((day) => ({
          day,
          time: draft.time.trim() || null,
          room: draft.room.trim() || null
        }))
      });
      setState((previous) => ({ ...previous, schedule }));
      setEditingSectionId(null);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update period');
    } finally {
      setBusy(false);
    }
  };

  const deleteSection = async (sectionId: string) => {
    if (!window.confirm('Remove this period from your schedule?')) return;

    try {
      setBusy(true);
      await api.deleteSection(sectionId);
      const schedule = await api.getSchedule();
      setState((previous) => ({
        ...previous,
        schedule,
        resumesBySectionId: Object.fromEntries(
          Object.entries(previous.resumesBySectionId).filter(([id]) => id !== sectionId)
        )
      }));
      if (selectedSectionId === sectionId) setSelectedSectionId(null);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove period');
    } finally {
      setBusy(false);
    }
  };

  const applyYearPlanTemplate = async () => {
    if (!selectedCourse) return;
    const template = yearPlanTemplates.find((item) => item.id === selectedTemplateId) ?? yearPlanTemplates[0];
    if (!template) return;

    try {
      setBusy(true);
      let detail: CourseDetailResponse | null = null;
      for (const [unitIndex, templateUnit] of template.units.entries()) {
        detail = await api.createUnit(selectedCourse.id, {
          title: templateUnit.title,
          description: templateUnit.description,
          orderIndex: selectedCourse.units.length + unitIndex + 1
        });
        const createdUnit = detail.course.units.find((unit) => unit.title === templateUnit.title);
        if (!createdUnit) continue;

        for (const [lessonIndex, templateLesson] of templateUnit.lessons.entries()) {
          detail = await api.createLesson(createdUnit.id, {
            title: templateLesson.title,
            description: null,
            estimatedDurationMinutes: templateLesson.minutes,
            orderIndex: lessonIndex + 1
          });
          const latestUnit = detail.course.units.find((unit) => unit.id === createdUnit.id);
          const createdLesson = latestUnit?.lessons.find((lesson) => lesson.title === templateLesson.title);
          if (!createdLesson) continue;

          for (const [segmentIndex, templateSegment] of templateLesson.segments.entries()) {
            detail = await api.createSegment(createdLesson.id, {
              title: templateSegment.title,
              description: null,
              durationMinutes: templateSegment.minutes,
              orderIndex: segmentIndex + 1
            });
          }
        }
      }

      if (detail) updateFromDetail(detail);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to apply starter year plan');
    } finally {
      setBusy(false);
    }
  };

  const refreshSelectedCourse = async () => {
    if (!selectedCourse) return;
    updateFromDetail(await api.getCourseDetail(selectedCourse.id));
  };

  const beginUnitEdit = (unit: CourseDetail['units'][number]) => {
    setEditingUnitId(unit.id);
    setUnitEditDrafts((previous) => ({ ...previous, [unit.id]: unitToDraft(unit) }));
  };

  const beginLessonEdit = (lesson: CourseDetail['units'][number]['lessons'][number]) => {
    setEditingLessonId(lesson.id);
    setLessonEditDrafts((previous) => ({ ...previous, [lesson.id]: lessonToDraft(lesson) }));
  };

  const beginSegmentEdit = (segment: CourseDetail['units'][number]['lessons'][number]['segments'][number]) => {
    setEditingSegmentId(segment.id);
    setSegmentEditDrafts((previous) => ({ ...previous, [segment.id]: segmentToDraft(segment) }));
  };

  const saveUnitEdit = async (unitId: string) => {
    const draft = unitEditDrafts[unitId];
    if (!draft?.title.trim()) {
      setError('Unit title is required.');
      return;
    }
    try {
      setBusy(true);
      updateFromDetail(
        await api.updateUnit(unitId, {
          title: draft.title.trim(),
          description: toNullable(draft.description),
          orderIndex: parseOptionalOrder(draft.order)
        })
      );
      setEditingUnitId(null);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update unit');
    } finally {
      setBusy(false);
    }
  };

  const saveLessonEdit = async (lessonId: string) => {
    const draft = lessonEditDrafts[lessonId];
    if (!draft?.title.trim()) {
      setError('Lesson title is required.');
      return;
    }
    try {
      setBusy(true);
      updateFromDetail(
        await api.updateLesson(lessonId, {
          title: draft.title.trim(),
          description: toNullable(draft.description),
          estimatedDurationMinutes: parseNullablePositiveInt(draft.duration),
          orderIndex: parseOptionalOrder(draft.order)
        })
      );
      setEditingLessonId(null);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update lesson');
    } finally {
      setBusy(false);
    }
  };

  const saveSegmentEdit = async (segmentId: string) => {
    const draft = segmentEditDrafts[segmentId];
    if (!draft?.title.trim()) {
      setError('Segment title is required.');
      return;
    }
    try {
      setBusy(true);
      updateFromDetail(
        await api.updateSegment(segmentId, {
          title: draft.title.trim(),
          description: toNullable(draft.description),
          durationMinutes: parseNullablePositiveInt(draft.duration),
          orderIndex: parseOptionalOrder(draft.order)
        })
      );
      setEditingSegmentId(null);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update segment');
    } finally {
      setBusy(false);
    }
  };

  const removeYearPlanItem = async (type: 'unit' | 'lesson' | 'segment', id: string) => {
    if (!window.confirm(`Remove this ${type}?`)) return;
    try {
      setBusy(true);
      if (type === 'unit') await api.deleteUnit(id);
      if (type === 'lesson') await api.deleteLesson(id);
      if (type === 'segment') await api.deleteSegment(id);
      await refreshSelectedCourse();
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Failed to remove ${type}`);
    } finally {
      setBusy(false);
    }
  };

  const saveCourseEdit = async (courseId: string) => {
    const draft = courseEditDrafts[courseId];
    if (!draft?.name.trim()) {
      setError('Course name is required.');
      return;
    }

    try {
      setBusy(true);
      updateFromDetail(
        await api.updateCourse(courseId, {
          name: draft.name.trim(),
          subject: toNullable(draft.subject),
          gradeLevel: toNullable(draft.gradeLevel)
        })
      );
      setEditingCourseId(null);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update course');
    } finally {
      setBusy(false);
    }
  };

  const toggleMeetingDay = (day: (typeof meetingDays)[number]) => {
    setSelectedMeetingDays((previous) => {
      if (previous.includes(day)) {
        const next = previous.filter((selectedDay) => selectedDay !== day);
        return next.length ? next : previous;
      }
      return [...previous, day];
    });
  };

  const findCourseForParsedClass = (parsedClass: ParsedScheduleClass) => {
    const normalizedCandidates = [parsedClass.name, parsedClass.subject]
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);

    return (
      state.courses.find((course) => normalizedCandidates.includes(course.name.trim().toLowerCase())) ??
      state.courses.find((course) =>
        course.subject ? normalizedCandidates.includes(course.subject.trim().toLowerCase()) : false
      ) ??
      null
    );
  };

  const parsedClassKey = (parsedClass: ParsedScheduleClass) =>
    `${parsedClass.name}-${parsedClass.period}-${parsedClass.time ?? 'time'}-${parsedClass.room ?? 'room'}`;

  const parsedClassFromDraft = (parsedClass: ParsedScheduleClass) => {
    const key = parsedClassKey(parsedClass);
    return draftToParsedClass(parsedClassEditDrafts[key] ?? parsedClassToDraft(parsedClass));
  };

  const updateParsedClassDraft = (parsedClass: ParsedScheduleClass, patch: Partial<ParsedClassEditDraft>) => {
    const key = parsedClassKey(parsedClass);
    setParsedClassEditDrafts((previous) => ({
      ...previous,
      [key]: {
        ...(previous[key] ?? parsedClassToDraft(parsedClass)),
        ...patch
      }
    }));
  };

  const applyScheduleParseResult = (parsed: ParseScheduleResponse) => {
    setScheduleImportOutput(parsed);
    setParsedClassEditDrafts(
      Object.fromEntries(parsed.classes.map((parsedClass) => [parsedClassKey(parsedClass), parsedClassToDraft(parsedClass)]))
    );
    setAddedParsedClassKeys([]);
  };

  const startLocalScheduleParse = () => {
    if (!scheduleImportText.trim()) {
      setError('Paste schedule text first.');
      return;
    }

    const parsed = parseLocalScheduleText(scheduleImportText);
    setLocalScheduleParse(parsed);
    applyScheduleParseResult(parsed);
    setScheduleImportJobId(null);
    setScheduleImportJob(null);
    setError(parsed.classes.length ? null : 'Local import could not find classes. Try the enhanced reader.');
  };

  const startScheduleUpload = async () => {
    if (!scheduleImportText.trim() && !scheduleImportFileDataUrl) {
      setError('Paste schedule text or upload an image/PDF first.');
      return;
    }

    try {
      setBusy(true);
      setScheduleImportJobId(null);
      setScheduleImportJob(null);
      setScheduleImportOutput(null);
      const job = await api.enqueueParseSchedule({
        text: scheduleImportText.trim() || undefined,
        fileBase64: scheduleImportFileDataUrl || undefined,
        fileName: scheduleImportFileName || undefined,
        fileMimeType: scheduleImportFileMimeType || undefined
      });
      setScheduleImportJobId(job.jobId);
      setScheduleImportJob(null);
      setLocalScheduleParse(null);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to read schedule');
    } finally {
      setBusy(false);
    }
  };

  const addParsedClassToSchedule = async (parsedClass: ParsedScheduleClass) => {
    try {
      setBusy(true);
      const existingCourse = findCourseForParsedClass(parsedClass);
      const course =
        existingCourse ??
        (await createCourse(parsedClass.name, parsedClass.subject, parsedClass.grade ?? ''));

      const schedule = await api.createSection({
        courseId: course.id,
        sectionName: parsedClass.period,
        meetings: parsedClass.days.map((day) => ({
          day,
          time: parsedClass.time,
          room: parsedClass.room
        }))
      });

      setState((previous) => ({ ...previous, schedule }));
      setSelectedCourseId(course.id);
      setSelectedCourseForSchedule(course.id);
      setAddedParsedClassKeys((previous) => [...new Set([...previous, parsedClassKey(parsedClass)])]);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add parsed period');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="management-page stack">
      <nav className="management-tabs" aria-label="Management sections">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={activeTab === tab.id ? 'active' : ''}
            type="button"
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <section className="management-snapshot" aria-label="Management setup snapshot">
        {setupSnapshot.map((item) => (
          <div key={item.label}>
            <strong>{item.value}</strong>
            <span>{item.label}</span>
          </div>
        ))}
      </section>

      {error ? <p className="notice warning">{error}</p> : null}
      {copyStatus ? <p className="notice success">{copyStatus}</p> : null}
      {loading ? <p className="muted">Loading...</p> : null}
      {showPrompt ? (
        <section className="smart-prompt">
          <div>
            <p className="eyebrow">Next step</p>
            <h2>{prompt.title}</h2>
            <p>{prompt.body}</p>
          </div>
          <div className="profile-actions">
            <button type="button" onClick={() => setActiveTab(prompt.tab)}>
              Go there
            </button>
            <button
              className="secondary"
              type="button"
              onClick={() => setDismissedPromptIds((previous) => [...new Set([...previous, prompt.id])])}
            >
              Dismiss
            </button>
          </div>
        </section>
      ) : null}

      {activeTab === 'start' ? (
        <section className="management-panel stack">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Start</p>
              <h2>Set up the year in small steps.</h2>
              <p className="muted">Use one step at a time. Nothing here blocks the rest of the app.</p>
            </div>
            <button
              className="secondary"
              type="button"
              onClick={() => {
                setCompletedWalkthroughIds(walkthroughSteps.map((step) => step.id));
                flashCopyStatus('Walkthrough marked complete.');
              }}
            >
              Mark complete
            </button>
          </div>

          <div className="walkthrough-step-grid">
            {walkthroughSteps.map((step, index) => {
              const done = step.done || completedWalkthroughIds.includes(step.id);
              return (
                <article key={step.id} className={done ? 'walkthrough-step-card done' : 'walkthrough-step-card'}>
                  <span>{done ? 'Done' : `Step ${index + 1}`}</span>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                  <div className="profile-actions">
                    <button
                      type="button"
                      onClick={() => {
                        markWalkthroughStep(step.id);
                        setActiveTab(step.tab);
                      }}
                    >
                      Go
                    </button>
                    {!done ? (
                      <button className="secondary" type="button" onClick={() => markWalkthroughStep(step.id)}>
                        Mark done
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>

          <article className="card stack">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Simple menu</p>
                <h3>Where things live</h3>
              </div>
            </div>
            <div className="management-menu-grid">
              {tabs.filter((tab) => tab.id !== 'start').map((tab) => (
                <button key={tab.id} className="secondary" type="button" onClick={() => setActiveTab(tab.id)}>
                  {tab.label}
                </button>
              ))}
            </div>
          </article>
        </section>
      ) : null}

      {activeTab === 'courses' ? (
        <section className="management-panel stack">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Courses</p>
              <h2>What do I teach?</h2>
            </div>
            <button className="secondary" type="button" onClick={() => setIsNewCourseOpen((current) => !current)}>
              {isNewCourseOpen ? 'Close' : 'New Course'}
            </button>
          </div>

          {isNewCourseOpen ? (
            <article className="card stack compact-create-card">
              <div className="section-heading">
                <div>
                  <h3>Create course</h3>
                  <p className="muted">Draft saves on this device while you decide what to add.</p>
                </div>
                <div className="profile-actions">
                  <button className="secondary" type="button" onClick={() => void copyNewCourseDraft()}>
                    Copy draft
                  </button>
                  <button className="secondary" type="button" onClick={clearNewCourseDraft}>
                    Clear
                  </button>
                </div>
              </div>
              <div className="inline-editor">
                <input
                  className="input"
                  value={newCourseName}
                  onChange={(event) => setNewCourseName(event.target.value)}
                  placeholder="Course name"
                />
                <input
                  className="input"
                  value={newCourseSubject}
                  onChange={(event) => setNewCourseSubject(event.target.value)}
                  placeholder="Subject"
                />
                <input
                  className="input"
                  value={newCourseGrade}
                  onChange={(event) => setNewCourseGrade(event.target.value)}
                  placeholder="Grade level"
                />
                <input
                  className="input"
                  value={newCoursePeriods}
                  onChange={(event) => setNewCoursePeriods(event.target.value)}
                  placeholder="Periods"
                />
              </div>
              <div className="profile-actions">
                <button
                  type="button"
                  disabled={busy || !newCourseName.trim()}
                  onClick={async () => {
                    try {
                      setBusy(true);
                      const course = await createCourse(newCourseName, newCourseSubject, newCourseGrade);
                      const periodCount = parseNullablePositiveInt(newCoursePeriods);
                      if (periodCount) {
                        let latestSchedule = state.schedule;
                        for (let index = 1; index <= periodCount; index += 1) {
                          latestSchedule = await api.createSection({
                            courseId: course.id,
                            sectionName: `Period ${index}`,
                            meetings: []
                          });
                        }
                        if (latestSchedule) setState((previous) => ({ ...previous, schedule: latestSchedule }));
                      }
                      setNewCourseName('');
                      setNewCourseSubject('');
                      setNewCourseGrade('');
                      setNewCoursePeriods('');
                      window.localStorage.removeItem(newCourseDraftStorageKey);
                      setIsNewCourseOpen(false);
                      setActiveTab('periods');
                      setError(null);
                    } catch (err) {
                      setError(err instanceof ApiError ? err.message : 'Failed to create course');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Create and add periods
                </button>
                <button className="secondary" type="button" onClick={() => setIsNewCourseOpen(false)}>
                  Cancel
                </button>
              </div>
            </article>
          ) : null}

          <div className="course-card-grid">
            {state.courseDetails.length ? (
              state.courseDetails.map((course) => {
                const depth = courseDepth(course);
                const attachedSections = courseSections(course, sections);
                const isSelected = selectedCourse?.id === course.id;
                const isEditing = editingCourseId === course.id;
                const editDraft = courseEditDrafts[course.id] ?? {
                  name: course.name,
                  subject: course.subject ?? '',
                  gradeLevel: course.gradeLevel ?? ''
                };
                return (
                  <article key={course.id} className={isSelected ? 'course-summary-card selected' : 'course-summary-card'}>
                    <div className="section-heading">
                      <div>
                        <p className="eyebrow">{course.subject ?? course.gradeLevel ?? 'Course'}</p>
                        <h3>{course.name}</h3>
                      </div>
                      <span className="status-pill upcoming">{isSelected ? 'Selected' : 'Course'}</span>
                    </div>
                    {isEditing ? (
                      <div className="course-inline-edit">
                        <input
                          className="input"
                          value={editDraft.name}
                          onChange={(event) => updateCourseDraft(course.id, { name: event.target.value })}
                          placeholder="Course name"
                        />
                        <input
                          className="input"
                          value={editDraft.subject}
                          onChange={(event) => updateCourseDraft(course.id, { subject: event.target.value })}
                          placeholder="Subject"
                        />
                        <input
                          className="input"
                          value={editDraft.gradeLevel}
                          onChange={(event) => updateCourseDraft(course.id, { gradeLevel: event.target.value })}
                          placeholder="Grade level"
                        />
                      </div>
                    ) : null}
                    <div className="mini-stats">
                      <span>{depth.units} units</span>
                      <span>{depth.lessons} lessons</span>
                      <span>{depth.segments} segments</span>
                    </div>
                    <div className="tag-list">
                      {attachedSections.length ? (
                        attachedSections.map((section) => <span key={section.sectionId}>{section.sectionName}</span>)
                      ) : (
                        <span>No periods yet</span>
                      )}
                    </div>
                    <div className="section-progress-list">
                      {attachedSections.length ? (
                        attachedSections.map((section) => (
                          <div key={section.sectionId}>
                            <strong>{sectionProgressLabel(section, state.resumesBySectionId[section.sectionId])}</strong>
                            <progress max={100} value={sectionPercent(state.resumesBySectionId[section.sectionId])} />
                          </div>
                        ))
                      ) : (
                        <p className="muted">Add periods so the app can track each class separately.</p>
                      )}
                    </div>
                    <div className="profile-actions">
                      <button className="secondary" type="button" onClick={() => selectCourse(course.id, 'curriculum')}>
                        Open Year Plan
                      </button>
                      <button className="secondary" type="button" onClick={() => selectCourse(course.id, 'periods')}>
                        Add Period
                      </button>
                      {isEditing ? (
                        <>
                          <button type="button" disabled={busy || !editDraft.name.trim()} onClick={() => void saveCourseEdit(course.id)}>
                            Save
                          </button>
                          <button className="secondary" type="button" onClick={() => setEditingCourseId(null)}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button type="button" onClick={() => beginCourseEdit(course)}>
                          Edit Course
                        </button>
                      )}
                    </div>
                  </article>
                );
              })
            ) : (
              <article className="card stack">
                <h3>No courses yet</h3>
                <p className="muted">Create one course to begin setting up periods and the year plan.</p>
              </article>
            )}
          </div>
        </section>
      ) : null}

      {activeTab === 'import' ? (
        <section className="management-panel stack">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Import</p>
              <h2>Import Schedule</h2>
              <p className="muted">Use local import first, or use the enhanced reader when a file is messy.</p>
            </div>
          </div>

          <article className="card stack schedule-upload-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Schedule reader</p>
                <h3>Upload a schedule image or PDF</h3>
                <p className="muted">
                  Use a screenshot, PDF, or pasted text. You review the classes before anything is saved.
                </p>
              </div>
              {scheduleImportFileName ? <span className="status-pill upcoming">{scheduleImportFileName}</span> : null}
            </div>

            <div className="schedule-upload-grid">
              <label className="upload-dropzone">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.pdf"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    if (file.size > maxScheduleUploadBytes) {
                      setError('Schedule files must be smaller than 10 MB.');
                      event.currentTarget.value = '';
                      return;
                    }
                    const supportedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'];
                    if (file.type && !supportedTypes.includes(file.type)) {
                      setError('Upload a PNG, JPG, WEBP, GIF, or PDF schedule file.');
                      event.currentTarget.value = '';
                      return;
                    }
                    try {
                      const dataUrl = await readFileAsDataUrl(file);
                      setScheduleImportFileName(file.name);
                      setScheduleImportFileMimeType(file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/png'));
                      setScheduleImportFileDataUrl(dataUrl);
                      setError(null);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Could not read schedule file');
                    }
                  }}
                />
                <strong>Choose image or PDF</strong>
                <span>Screenshot, scanned schedule, or exported PDF</span>
              </label>
              <textarea
                rows={5}
                value={scheduleImportText}
                onChange={(event) => setScheduleImportText(event.target.value)}
                placeholder="Or paste schedule text here..."
              />
            </div>

            <div className="profile-actions">
              <button type="button" disabled={busy || !scheduleImportText.trim()} onClick={startLocalScheduleParse}>
                Try local import
              </button>
              <button type="button" disabled={busy || (!scheduleImportText.trim() && !scheduleImportFileDataUrl)} onClick={startScheduleUpload}>
                {busy ? 'Reading...' : 'Use enhanced reader'}
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() => {
                  setScheduleImportText('');
                  setScheduleImportFileName('');
                  setScheduleImportFileMimeType('');
                  setScheduleImportFileDataUrl('');
                  setScheduleImportJobId(null);
                  setScheduleImportJob(null);
                  setScheduleImportOutput(null);
                  setLocalScheduleParse(null);
                  setParsedClassEditDrafts({});
                  setAddedParsedClassKeys([]);
                }}
              >
                Clear
              </button>
            </div>

            {scheduleImportJobId ? (
              <div className="import-status-panel">
                <div>
                  <strong>{scheduleImportJob ? `Status: ${scheduleImportJob.status}` : 'Reading schedule...'}</strong>
                  <span>
                    {scheduleImportJob
                      ? `${scheduleImportJob.progressPercent}% complete`
                      : 'Preparing the file for review'}
                  </span>
                </div>
                {scheduleImportJob ? <progress max={100} value={scheduleImportJob.progressPercent} /> : null}
                {scheduleImportJob?.error ? <p className="notice warning">{scheduleImportJob.error}</p> : null}
                {scheduleImportJob && !isTerminalStatus(scheduleImportJob.status) ? (
                  <button
                    className="secondary"
                    type="button"
                    disabled={!scheduleImportJob.canCancel || busy}
                    onClick={async () => {
                      try {
                        setBusy(true);
                        await api.cancelAiJob(scheduleImportJob.jobId);
                        setScheduleImportJob(await api.getAiJobStatus(scheduleImportJob.jobId));
                      } catch (err) {
                        setError(err instanceof ApiError ? err.message : 'Failed to cancel schedule read');
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Cancel
                  </button>
                ) : null}
                {scheduleImportJob?.canRetry ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      try {
                        setBusy(true);
                        await api.retryAiJob(scheduleImportJob.jobId);
                        setScheduleImportJob(await api.getAiJobStatus(scheduleImportJob.jobId));
                        setError(null);
                      } catch (err) {
                        setError(err instanceof ApiError ? err.message : 'Failed to retry schedule read');
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Try again
                  </button>
                ) : null}
              </div>
            ) : null}

            {localScheduleParse ? (
              <div className={localScheduleParse.confidence >= 70 ? 'local-parse-summary good' : 'local-parse-summary cautious'}>
                <strong>Local import confidence: {localScheduleParse.confidence}%</strong>
                <span>
                  {localScheduleParse.confidence >= 70
                    ? 'This looks usable. Review before saving.'
                    : 'Review carefully or use the enhanced reader for a second pass.'}
                </span>
                {localScheduleParse.warnings.length ? (
                  <details>
                    <summary>{localScheduleParse.warnings.length} lines need review</summary>
                    {localScheduleParse.warnings.slice(0, 5).map((warning) => (
                      <p key={warning}>{warning}</p>
                    ))}
                  </details>
                ) : null}
              </div>
            ) : null}

            {scheduleImportOutput ? (
              <div className="parsed-schedule-review">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Review before saving</p>
                    <h3>{scheduleImportOutput.classes.length} classes found</h3>
                  </div>
                  <button className="secondary" type="button" onClick={() => void copyImportSummary()}>
                    Copy import summary
                  </button>
                </div>
                <div className="parsed-class-list">
                  {scheduleImportOutput.classes.map((parsedClass) => {
                    const key = parsedClassKey(parsedClass);
                    const editedClass = parsedClassFromDraft(parsedClass);
                    const draft = parsedClassEditDrafts[key] ?? parsedClassToDraft(parsedClass);
                    const matchingCourse = findCourseForParsedClass(editedClass);
                    const isAdded = addedParsedClassKeys.includes(key);
                    return (
                      <article key={key} className="parsed-class-card">
                        <div className="parsed-class-fields">
                          <label>
                            Period
                            <input
                              className="input"
                              value={draft.period}
                              onChange={(event) => updateParsedClassDraft(parsedClass, { period: event.target.value })}
                            />
                          </label>
                          <label>
                            Course
                            <input
                              className="input"
                              value={draft.name}
                              onChange={(event) => updateParsedClassDraft(parsedClass, { name: event.target.value })}
                            />
                          </label>
                          <label>
                            Subject
                            <input
                              className="input"
                              value={draft.subject}
                              onChange={(event) => updateParsedClassDraft(parsedClass, { subject: event.target.value })}
                            />
                          </label>
                          <label>
                            Days
                            <input
                              className="input"
                              value={draft.days}
                              onChange={(event) => updateParsedClassDraft(parsedClass, { days: event.target.value })}
                              placeholder="Monday, Wednesday, Friday"
                            />
                          </label>
                          <label>
                            Time
                            <input
                              className="input"
                              type="time"
                              value={draft.time}
                              onChange={(event) => updateParsedClassDraft(parsedClass, { time: event.target.value })}
                            />
                          </label>
                          <label>
                            Room
                            <input
                              className="input"
                              value={draft.room}
                              onChange={(event) => updateParsedClassDraft(parsedClass, { room: event.target.value })}
                            />
                          </label>
                        </div>
                        <p>
                          {editedClass.days.join(', ')} at {editedClass.time ?? 'TBD'}
                          {editedClass.room ? `, ${editedClass.room}` : ''}
                        </p>
                        <p className="muted">
                          {matchingCourse
                            ? `Will attach to ${matchingCourse.name}.`
                            : `Will create ${editedClass.name} first.`}
                        </p>
                        <button
                          type="button"
                          disabled={busy || isAdded || !editedClass.name || !editedClass.period}
                          onClick={() => void addParsedClassToSchedule(editedClass)}
                        >
                          {isAdded ? 'Added' : matchingCourse ? 'Add period' : 'Create course + period'}
                        </button>
                      </article>
                    );
                  })}
                </div>
                {scheduleImportOutput.assignments.length ? (
                  <div className="assignment-preview">
                    <strong>Assignments noticed</strong>
                    {scheduleImportOutput.assignments.map((assignment) => (
                      <span key={`${assignment.courseName}-${assignment.name}`}>
                        {assignment.courseName}: {assignment.name}
                        {assignment.dueDate ? ` due ${assignment.dueDate}` : ''}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </article>
        </section>
      ) : null}

      {activeTab === 'periods' ? (
        <section className="management-panel stack">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Periods</p>
              <h2>Which class periods do I teach?</h2>
              <p className="muted">Periods share a course plan, but each one keeps its own progress.</p>
            </div>
          </div>
          {state.courses.length === 0 ? (
            <article className="card stack compact-create-card">
              <h3>Create a course first</h3>
              <p className="muted">This period needs a course plan to follow.</p>
              <div className="inline-editor">
                <input
                  className="input"
                  value={quickCourseName}
                  onChange={(event) => setQuickCourseName(event.target.value)}
                  placeholder="Course name"
                />
                <input
                  className="input"
                  value={quickCourseSubject}
                  onChange={(event) => setQuickCourseSubject(event.target.value)}
                  placeholder="Subject"
                />
                <button
                  type="button"
                  disabled={busy || !quickCourseName.trim()}
                  onClick={async () => {
                    try {
                      setBusy(true);
                      await createCourse(quickCourseName, quickCourseSubject, '');
                      setQuickCourseName('');
                      setQuickCourseSubject('');
                      setError(null);
                    } catch (err) {
                      setError(err instanceof ApiError ? err.message : 'Failed to create course');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Create course
                </button>
              </div>
            </article>
          ) : (
            <div className="management-editor-grid">
              <article className="card stack">
                <div className="section-heading">
                  <div>
                    <h3>Add class period</h3>
                    <p className="muted">Draft saves on this device until the period is added.</p>
                  </div>
                  <div className="profile-actions">
                    <button className="secondary" type="button" onClick={() => void copyAddPeriodDraft()}>
                      Copy draft
                    </button>
                    <button className="secondary" type="button" onClick={clearAddPeriodDraft}>
                      Clear
                    </button>
                  </div>
                </div>
                <select
                  className="input"
                  value={selectedCourseForSchedule}
                  onChange={(event) => setSelectedCourseForSchedule(event.target.value)}
                >
                  {state.courses.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.name}
                    </option>
                  ))}
                </select>
                <input
                  className="input"
                  value={sectionName}
                  onChange={(event) => setSectionName(event.target.value)}
                  placeholder="Period name, like Period 3"
                />
                <div className="day-picker" aria-label="Meeting days">
                  {meetingDays.map((day) => (
                    <button
                      key={day}
                      className={selectedMeetingDays.includes(day) ? 'active' : ''}
                      type="button"
                      onClick={() => toggleMeetingDay(day)}
                    >
                      {day}
                    </button>
                  ))}
                </div>
                <div className="inline-editor">
                  <input
                    className="input"
                    type="time"
                    value={meetingTime}
                    onChange={(event) => setMeetingTime(event.target.value)}
                  />
                  <input
                    className="input"
                    value={meetingRoom}
                    onChange={(event) => setMeetingRoom(event.target.value)}
                    placeholder="Room"
                  />
                </div>
                <button
                  type="button"
                  disabled={busy || !selectedCourseForSchedule || !sectionName.trim()}
                  onClick={async () => {
                    try {
                      setBusy(true);
                      const schedule = await api.createSection({
                        courseId: selectedCourseForSchedule,
                        sectionName: sectionName.trim(),
                        meetings: selectedMeetingDays.map((day) => ({
                          day,
                          time: meetingTime || null,
                          room: meetingRoom.trim() || null
                        }))
                      });
                      setState((previous) => ({ ...previous, schedule }));
                      setSectionName('');
                      setMeetingTime('');
                      setMeetingRoom('');
                      window.localStorage.removeItem(addPeriodDraftStorageKey);
                      setError(null);
                    } catch (err) {
                      setError(err instanceof ApiError ? err.message : 'Failed to create section');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Add period
                </button>
              </article>

              <article className="card stack">
                <h3>Current periods</h3>
                <div className="section-roster single-column">
                  {sections.length ? (
                    sections.map((section) => {
                      const resume = state.resumesBySectionId[section.sectionId];
                      const resumeLessonId = resume?.lesson?.id;
                      const isEditing = editingSectionId === section.sectionId;
                      const draft = sectionEditDrafts[section.sectionId] ?? sectionToDraft(section);
                      return (
                        <article key={section.sectionId} className="section-roster-card">
                          {isEditing ? (
                            <div className="section-inline-edit">
                              <label>
                                Period
                                <input
                                  className="input"
                                  value={draft.sectionName}
                                  onChange={(event) => updateSectionDraft(section.sectionId, { sectionName: event.target.value })}
                                />
                              </label>
                              <label>
                                Course
                                <select
                                  className="input"
                                  value={draft.courseId}
                                  disabled
                                  onChange={(event) => updateSectionDraft(section.sectionId, { courseId: event.target.value })}
                                >
                                  {state.courses.map((course) => (
                                    <option key={course.id} value={course.id}>
                                      {course.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                Days
                                <input
                                  className="input"
                                  value={draft.days}
                                  onChange={(event) => updateSectionDraft(section.sectionId, { days: event.target.value })}
                                  placeholder="Monday, Wednesday, Friday"
                                />
                              </label>
                              <label>
                                Time
                                <input
                                  className="input"
                                  type="time"
                                  value={draft.time}
                                  onChange={(event) => updateSectionDraft(section.sectionId, { time: event.target.value })}
                                />
                              </label>
                              <label>
                                Room
                                <input
                                  className="input"
                                  value={draft.room}
                                  onChange={(event) => updateSectionDraft(section.sectionId, { room: event.target.value })}
                                />
                              </label>
                              <p className="muted">Course changes are kept separate for now so progress history stays safe.</p>
                            </div>
                          ) : (
                            <>
                              <div>
                                <strong>{section.sectionName}</strong>
                                <span>Course: {section.courseName}</span>
                              </div>
                              <p>Meets: {formatMeeting(section)}</p>
                              <p>Time: {section.meetings[0]?.time ?? 'TBD'} to TBD</p>
                              <p>Room: {section.meetings[0]?.room ?? 'TBD'}</p>
                              <p>Current: {resume?.lesson?.title ?? 'No lesson started'}</p>
                              <p>Stopped at: {resume?.state?.carryOverNote ?? resume?.lastNote?.content ?? 'None'}</p>
                              <p>Status: {sectionPercent(resume) >= 100 ? 'Ahead' : sectionPercent(resume) > 0 ? 'On pace' : 'Not started'}</p>
                            </>
                          )}
                          <div className="profile-actions">
                            {isEditing ? (
                              <>
                                <button
                                  type="button"
                                  disabled={busy || !draft.sectionName.trim()}
                                  onClick={() => void saveSectionEdit(section.sectionId)}
                                >
                                  Save
                                </button>
                                <button className="secondary" type="button" onClick={() => setEditingSectionId(null)}>
                                  Cancel
                                </button>
                              </>
                            ) : resumeLessonId ? (
                              <button
                                type="button"
                                onClick={() => {
                                  navigate(`/sections/${section.sectionId}/lessons/${resumeLessonId}`);
                                }}
                              >
                                Open class
                              </button>
                            ) : null}
                            {!isEditing ? (
                              <>
                                <button
                                  className="secondary"
                                  type="button"
                                  onClick={() => {
                                    setSelectedCourseId(section.courseId);
                                    setSelectedSectionId(section.sectionId);
                                    setActiveTab('curriculum');
                                  }}
                                >
                                  View in Year Plan
                                </button>
                                <button type="button" onClick={() => beginSectionEdit(section)}>
                                  Edit
                                </button>
                                <button
                                  className="secondary danger"
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void deleteSection(section.sectionId)}
                                >
                                  Remove
                                </button>
                              </>
                            ) : null}
                          </div>
                        </article>
                      );
                    })
                  ) : (
                    <p className="muted">No periods yet.</p>
                  )}
                </div>
              </article>
            </div>
          )}
        </section>
      ) : null}

      {activeTab === 'weekly' ? (
        <section className="management-panel stack">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Weekly Schedule</p>
              <h2>When do my periods meet?</h2>
              <p className="muted">Grouped by day so missing times and rooms are easy to spot.</p>
            </div>
            <button className="secondary" type="button" onClick={() => setActiveTab('periods')}>
              Add or edit periods
            </button>
          </div>

          {hasMeetingGaps ? (
            <p className="notice warning">Some periods are missing days, times, or rooms. Open Periods to fill them in.</p>
          ) : null}

          <div className="weekly-schedule-grid">
            {weeklySchedule.map(({ day, sections: daySections }) => (
              <article key={day} className="weekly-day-card">
                <div className="section-heading">
                  <h3>{day}</h3>
                  <span className="status-pill upcoming">{daySections.length} periods</span>
                </div>
                {daySections.length ? (
                  daySections.map((section) => {
                    const meeting = section.meetings.find((item) => item.day === day);
                    return (
                      <button
                        key={`${section.sectionId}-${day}`}
                        type="button"
                        className="weekly-period-row"
                        onClick={() => {
                          setSelectedCourseId(section.courseId);
                          setSelectedSectionId(section.sectionId);
                          setActiveTab('periods');
                        }}
                      >
                        <strong>{meeting?.time ?? 'Time missing'}</strong>
                        <span>{section.sectionName}</span>
                        <small>{section.courseName} / {meeting?.room ?? 'Room missing'}</small>
                      </button>
                    );
                  })
                ) : (
                  <p className="muted">No periods on this day.</p>
                )}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === 'curriculum' ? (
        <section className="management-panel stack">
          <div className="year-plan-header card stack">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Year Plan</p>
                <h2>{selectedCourse ? `${selectedCourse.name} Year Plan` : 'Select a course'}</h2>
              </div>
              <div className="profile-actions">
                <button className="secondary" type="button" disabled={!selectedCourse} onClick={() => void copyYearPlanSummary()}>
                  Copy summary
                </button>
                <div className="management-tabs small-tabs" aria-label="Year plan view">
                  <button
                    className={selectedYearPlanView === 'outline' ? 'active' : ''}
                    type="button"
                    disabled={!selectedCourse}
                    onClick={() => {
                      if (!selectedCourse) return;
                      setYearPlanViewByCourseId((previous) => ({ ...previous, [selectedCourse.id]: 'outline' }));
                    }}
                  >
                    Outline
                  </button>
                  <button
                    className={selectedYearPlanView === 'timeline' ? 'active' : ''}
                    type="button"
                    disabled={!selectedCourse}
                    onClick={() => {
                      if (!selectedCourse) return;
                      setYearPlanViewByCourseId((previous) => ({ ...previous, [selectedCourse.id]: 'timeline' }));
                    }}
                  >
                    Year Timeline
                  </button>
                </div>
              </div>
            </div>

            {state.courseDetails.length ? (
              <select className="input" value={selectedCourse?.id ?? ''} onChange={(event) => selectCourse(event.target.value)}>
                {state.courseDetails.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="muted">Create a course first.</p>
            )}

            {selectedCourse ? (
              <>
                <div className="mini-stats">
                  <span>{selectedDepth.units} units</span>
                  <span>{selectedDepth.lessons} lessons</span>
                  <span>{selectedDepth.segments} segments</span>
                  <span>{meetingsRemaining} meetings on schedule</span>
                  <span>{plannedPercent}% planned</span>
                </div>
                <div className="section-progress-comparison">
                  {selectedSections.length ? (
                    selectedSections.map((section) => {
                      const resume = state.resumesBySectionId[section.sectionId];
                      return (
                        <button
                          key={section.sectionId}
                          className={selectedSection?.sectionId === section.sectionId ? 'selected' : ''}
                          type="button"
                          onClick={() => setSelectedSectionId(section.sectionId)}
                        >
                          <strong>{section.sectionName}</strong>
                          <span>{resume?.lesson?.title ?? 'No lesson started'}</span>
                          <progress max={100} value={sectionPercent(resume)} />
                        </button>
                      );
                    })
                  ) : (
                    <p className="muted">Add periods to compare progress by class.</p>
                  )}
                </div>
              </>
            ) : null}
          </div>

          {selectedCourse && selectedYearPlanView === 'outline' ? (
            <article className="card stack curriculum-builder">
              <section className="template-picker">
                <div>
                  <p className="eyebrow">Starter plans</p>
                  <h3>Build a first outline quickly</h3>
                  <p className="muted">Templates create real units, lessons, and segments. You can edit everything after it lands.</p>
                </div>
                <div className="template-picker-controls">
                  <select
                    className="input"
                    value={selectedTemplateId}
                    onChange={(event) => setSelectedTemplateId(event.target.value)}
                  >
                    {yearPlanTemplates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                  <button type="button" disabled={busy || !selectedCourse} onClick={() => void applyYearPlanTemplate()}>
                    Add starter plan
                  </button>
                </div>
                <div className="template-preview-list">
                  {(yearPlanTemplates.find((template) => template.id === selectedTemplateId) ?? yearPlanTemplates[0])?.units.map((unit) => (
                    <div key={unit.title}>
                      <strong>{unit.title}</strong>
                      <span>{unit.lessons.length} lessons</span>
                    </div>
                  ))}
                </div>
              </section>
              <div className="management-editor-grid">
                <div className="soft-panel stack">
                  <h3>Add unit</h3>
                  <input className="input" value={unitTitle} onChange={(event) => setUnitTitle(event.target.value)} placeholder="Unit title" />
                  <input className="input" value={unitDescription} onChange={(event) => setUnitDescription(event.target.value)} placeholder="Unit description" />
                  <input className="input" value={unitOrder} onChange={(event) => setUnitOrder(event.target.value)} placeholder="Order" />
                  <button
                    type="button"
                    disabled={busy || !unitTitle.trim()}
                    onClick={async () => {
                      try {
                        setBusy(true);
                        updateFromDetail(
                          await api.createUnit(selectedCourse.id, {
                            title: unitTitle.trim(),
                            description: toNullable(unitDescription),
                            orderIndex: parseOptionalOrder(unitOrder)
                          })
                        );
                        setUnitTitle('');
                        setUnitDescription('');
                        setUnitOrder('');
                        setError(null);
                      } catch (err) {
                        setError(err instanceof ApiError ? err.message : 'Failed to add unit');
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Add unit
                  </button>
                </div>

                <div className="course-outline-list">
                  {selectedCourse.units.length ? (
                    selectedCourse.units.map((unit) => {
                      const lessonDraft = lessonDrafts[unit.id] ?? { title: '', description: '', duration: '' };
                      const isUnitEditing = editingUnitId === unit.id;
                      const unitDraft = unitEditDrafts[unit.id] ?? unitToDraft(unit);
                      return (
                        <section key={unit.id} className="unit-editor-card">
                          <div className="section-heading">
                            <div>
                              <p className="eyebrow">Unit {unit.orderIndex}</p>
                              {isUnitEditing ? (
                                <div className="year-plan-inline-edit">
                                  <input
                                    className="input"
                                    value={unitDraft.title}
                                    onChange={(event) =>
                                      setUnitEditDrafts((previous) => ({
                                        ...previous,
                                        [unit.id]: { ...unitDraft, title: event.target.value }
                                      }))
                                    }
                                    placeholder="Unit title"
                                  />
                                  <input
                                    className="input"
                                    value={unitDraft.description}
                                    onChange={(event) =>
                                      setUnitEditDrafts((previous) => ({
                                        ...previous,
                                        [unit.id]: { ...unitDraft, description: event.target.value }
                                      }))
                                    }
                                    placeholder="Description"
                                  />
                                  <input
                                    className="input"
                                    value={unitDraft.order}
                                    onChange={(event) =>
                                      setUnitEditDrafts((previous) => ({
                                        ...previous,
                                        [unit.id]: { ...unitDraft, order: event.target.value }
                                      }))
                                    }
                                    placeholder="Order"
                                  />
                                </div>
                              ) : (
                                <h3>{unit.title}</h3>
                              )}
                            </div>
                            <div className="profile-actions">
                              {isUnitEditing ? (
                                <>
                                  <button type="button" disabled={busy || !unitDraft.title.trim()} onClick={() => void saveUnitEdit(unit.id)}>
                                    Save unit
                                  </button>
                                  <button className="secondary" type="button" onClick={() => setEditingUnitId(null)}>
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button className="secondary" type="button" onClick={() => beginUnitEdit(unit)}>
                                    Edit unit
                                  </button>
                                  <button
                                    className="secondary danger"
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void removeYearPlanItem('unit', unit.id)}
                                  >
                                    Remove
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="inline-editor">
                            <input
                              className="input"
                              value={lessonDraft.title}
                              onChange={(event) =>
                                setLessonDrafts((previous) => ({
                                  ...previous,
                                  [unit.id]: { ...lessonDraft, title: event.target.value }
                                }))
                              }
                              placeholder="Lesson title"
                            />
                            <input
                              className="input"
                              value={lessonDraft.duration}
                              onChange={(event) =>
                                setLessonDrafts((previous) => ({
                                  ...previous,
                                  [unit.id]: { ...lessonDraft, duration: event.target.value }
                                }))
                              }
                              placeholder="Minutes"
                            />
                            <button
                              type="button"
                              disabled={busy || !lessonDraft.title.trim()}
                              onClick={async () => {
                                try {
                                  setBusy(true);
                                  updateFromDetail(
                                    await api.createLesson(unit.id, {
                                      title: lessonDraft.title.trim(),
                                      description: toNullable(lessonDraft.description),
                                      estimatedDurationMinutes: parseNullablePositiveInt(lessonDraft.duration),
                                      orderIndex: undefined
                                    })
                                  );
                                  setLessonDrafts((previous) => ({
                                    ...previous,
                                    [unit.id]: { title: '', description: '', duration: '' }
                                  }));
                                  setError(null);
                                } catch (err) {
                                  setError(err instanceof ApiError ? err.message : 'Failed to add lesson');
                                } finally {
                                  setBusy(false);
                                }
                              }}
                            >
                              Add lesson
                            </button>
                          </div>

                          <div className="lesson-editor-list">
                            {unit.lessons.map((lesson) => {
                              const segmentDraft = segmentDrafts[lesson.id] ?? { title: '', description: '', duration: '' };
                              const isLessonEditing = editingLessonId === lesson.id;
                              const lessonEditDraft = lessonEditDrafts[lesson.id] ?? lessonToDraft(lesson);
                              const lessonCompleteForSelected =
                                selectedSection &&
                                state.resumesBySectionId[selectedSection.sectionId]?.lesson?.id === lesson.id
                                  ? sectionPercent(state.resumesBySectionId[selectedSection.sectionId])
                                  : selectedCourseLessonIds.indexOf(lesson.id) < selectedCourseLessonIds.length / 3
                                    ? 100
                                    : 0;
                              return (
                                <article key={lesson.id} className="lesson-editor-card">
                                  <div className="section-heading">
                                    <div>
                                      {isLessonEditing ? (
                                        <div className="year-plan-inline-edit">
                                          <input
                                            className="input"
                                            value={lessonEditDraft.title}
                                            onChange={(event) =>
                                              setLessonEditDrafts((previous) => ({
                                                ...previous,
                                                [lesson.id]: { ...lessonEditDraft, title: event.target.value }
                                              }))
                                            }
                                            placeholder="Lesson title"
                                          />
                                          <input
                                            className="input"
                                            value={lessonEditDraft.duration}
                                            onChange={(event) =>
                                              setLessonEditDrafts((previous) => ({
                                                ...previous,
                                                [lesson.id]: { ...lessonEditDraft, duration: event.target.value }
                                              }))
                                            }
                                            placeholder="Minutes"
                                          />
                                          <input
                                            className="input"
                                            value={lessonEditDraft.order}
                                            onChange={(event) =>
                                              setLessonEditDrafts((previous) => ({
                                                ...previous,
                                                [lesson.id]: { ...lessonEditDraft, order: event.target.value }
                                              }))
                                            }
                                            placeholder="Order"
                                          />
                                        </div>
                                      ) : (
                                        <strong>{lesson.title}</strong>
                                      )}
                                      <p className="muted">
                                        {unit.title} | {lesson.estimatedDurationMinutes ?? 'TBD'} min |{' '}
                                        {lessonCompleteForSelected >= 100
                                          ? 'Completed'
                                          : lessonCompleteForSelected > 0
                                            ? 'In progress'
                                            : 'Planned'}
                                      </p>
                                    </div>
                                    <progress max={100} value={lessonCompleteForSelected} />
                                  </div>
                                  <div className="profile-actions">
                                    {isLessonEditing ? (
                                      <>
                                        <button
                                          type="button"
                                          disabled={busy || !lessonEditDraft.title.trim()}
                                          onClick={() => void saveLessonEdit(lesson.id)}
                                        >
                                          Save lesson
                                        </button>
                                        <button className="secondary" type="button" onClick={() => setEditingLessonId(null)}>
                                          Cancel
                                        </button>
                                      </>
                                    ) : (
                                      <>
                                        <button className="secondary" type="button" onClick={() => beginLessonEdit(lesson)}>
                                          Edit lesson
                                        </button>
                                        <button
                                          className="secondary danger"
                                          type="button"
                                          disabled={busy}
                                          onClick={() => void removeYearPlanItem('lesson', lesson.id)}
                                        >
                                          Remove
                                        </button>
                                      </>
                                    )}
                                  </div>
                                  <div className="section-indicators">
                                    {selectedSections.map((section) => {
                                      const resume = state.resumesBySectionId[section.sectionId];
                                      const active = resume?.lesson?.id === lesson.id;
                                      return <span key={section.sectionId}>{section.sectionName}: {active ? 'here' : 'planned'}</span>;
                                    })}
                                  </div>
                                  <details>
                                    <summary>Segments</summary>
                                    <div className="inline-editor">
                                      <input
                                        className="input"
                                        value={segmentDraft.title}
                                        onChange={(event) =>
                                          setSegmentDrafts((previous) => ({
                                            ...previous,
                                            [lesson.id]: { ...segmentDraft, title: event.target.value }
                                          }))
                                        }
                                        placeholder="Segment title"
                                      />
                                      <input
                                        className="input"
                                        value={segmentDraft.duration}
                                        onChange={(event) =>
                                          setSegmentDrafts((previous) => ({
                                            ...previous,
                                            [lesson.id]: { ...segmentDraft, duration: event.target.value }
                                          }))
                                        }
                                        placeholder="Minutes"
                                      />
                                      <button
                                        type="button"
                                        disabled={busy || !segmentDraft.title.trim()}
                                        onClick={async () => {
                                          try {
                                            setBusy(true);
                                            updateFromDetail(
                                              await api.createSegment(lesson.id, {
                                                title: segmentDraft.title.trim(),
                                                description: null,
                                                durationMinutes: parseNullablePositiveInt(segmentDraft.duration),
                                                orderIndex: undefined
                                              })
                                            );
                                            setSegmentDrafts((previous) => ({
                                              ...previous,
                                              [lesson.id]: { title: '', description: '', duration: '' }
                                            }));
                                            setError(null);
                                          } catch (err) {
                                            setError(err instanceof ApiError ? err.message : 'Failed to add segment');
                                          } finally {
                                            setBusy(false);
                                          }
                                        }}
                                      >
                                        Add segment
                                      </button>
                                    </div>
                                    <div className="segment-list">
                                      {lesson.segments.map((segment) => {
                                        const resume =
                                          selectedSection && state.resumesBySectionId[selectedSection.sectionId]?.lesson?.id === lesson.id
                                            ? state.resumesBySectionId[selectedSection.sectionId]
                                            : undefined;
                                        const status = segmentStatusLabel(resume, segment.id);
                                        const isSegmentEditing = editingSegmentId === segment.id;
                                        const segmentEditDraft = segmentEditDrafts[segment.id] ?? segmentToDraft(segment);
                                        return (
                                          <div key={segment.id}>
                                            {isSegmentEditing ? (
                                              <div className="year-plan-inline-edit">
                                                <input
                                                  className="input"
                                                  value={segmentEditDraft.title}
                                                  onChange={(event) =>
                                                    setSegmentEditDrafts((previous) => ({
                                                      ...previous,
                                                      [segment.id]: { ...segmentEditDraft, title: event.target.value }
                                                    }))
                                                  }
                                                  placeholder="Segment title"
                                                />
                                                <input
                                                  className="input"
                                                  value={segmentEditDraft.duration}
                                                  onChange={(event) =>
                                                    setSegmentEditDrafts((previous) => ({
                                                      ...previous,
                                                      [segment.id]: { ...segmentEditDraft, duration: event.target.value }
                                                    }))
                                                  }
                                                  placeholder="Minutes"
                                                />
                                                <input
                                                  className="input"
                                                  value={segmentEditDraft.order}
                                                  onChange={(event) =>
                                                    setSegmentEditDrafts((previous) => ({
                                                      ...previous,
                                                      [segment.id]: { ...segmentEditDraft, order: event.target.value }
                                                    }))
                                                  }
                                                  placeholder="Order"
                                                />
                                              </div>
                                            ) : (
                                              <>
                                                <span>{segment.title}</span>
                                                <span>{segment.durationMinutes ? `${segment.durationMinutes} min` : 'No time'}</span>
                                                <span className={`segment-status ${status.toLowerCase().replaceAll(' ', '-')}`}>
                                                  {status}
                                                </span>
                                              </>
                                            )}
                                            <span className="segment-actions">
                                              {isSegmentEditing ? (
                                                <>
                                                  <button
                                                    type="button"
                                                    disabled={busy || !segmentEditDraft.title.trim()}
                                                    onClick={() => void saveSegmentEdit(segment.id)}
                                                  >
                                                    Save
                                                  </button>
                                                  <button className="secondary" type="button" onClick={() => setEditingSegmentId(null)}>
                                                    Cancel
                                                  </button>
                                                </>
                                              ) : (
                                                <>
                                                  <button className="secondary" type="button" onClick={() => beginSegmentEdit(segment)}>
                                                    Edit
                                                  </button>
                                                  <button
                                                    className="secondary danger"
                                                    type="button"
                                                    disabled={busy}
                                                    onClick={() => void removeYearPlanItem('segment', segment.id)}
                                                  >
                                                    Remove
                                                  </button>
                                                </>
                                              )}
                                            </span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </details>
                                </article>
                              );
                            })}
                          </div>
                        </section>
                      );
                    })
                  ) : (
                    <p className="muted">No units yet. Add the first unit to start the year plan.</p>
                  )}
                </div>
              </div>
            </article>
          ) : null}

          {selectedCourse && selectedYearPlanView === 'timeline' ? (
            <article className="card stack">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Year Timeline</p>
                  <h2>{selectedCourse.name}</h2>
                </div>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setSchoolYearSettings(readSchoolYearSettings())}
                >
                  Refresh school dates
                </button>
              </div>
              {schoolYearSettings && schoolProgress ? (
                <div className="timeline-pacing-summary">
                  <div>
                    <strong>{schoolYearSettings.startDate}</strong>
                    <span>Start</span>
                  </div>
                  <div>
                    <strong>{schoolProgress.percent}%</strong>
                    <span>Year elapsed</span>
                  </div>
                  <div>
                    <strong>{schoolProgress.remainingDays}</strong>
                    <span>Days remaining</span>
                  </div>
                  <div>
                    <strong>{schoolYearSettings.bellScheduleType.toUpperCase()}</strong>
                    <span>{schoolYearSettings.meetingDays.join(', ') || 'No rhythm set'}</span>
                  </div>
                </div>
              ) : (
                <p className="notice warning">Add school-year dates on the School page to unlock exact pacing. Showing unit timeline for now.</p>
              )}
              <div className="year-timeline">
                <div className="today-marker">
                  Today{schoolProgress ? ` / ${schoolProgress.percent}% through year` : ''}
                </div>
                {selectedCourse.units.map((unit) => (
                  <section key={unit.id} className="timeline-unit">
                    <strong>{unit.title}</strong>
                    <div className="timeline-lessons">
                      {unit.lessons.map((lesson) => (
                        <div key={lesson.id} className="timeline-lesson">
                          <span>{lesson.title}</span>
                          <div className="section-indicators">
                            {selectedSections.map((section) => {
                              const active = state.resumesBySectionId[section.sectionId]?.lesson?.id === lesson.id;
                              return <small key={section.sectionId}>{section.sectionName}{active ? ' is here' : ''}</small>;
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </article>
          ) : null}
        </section>
      ) : null}

      {activeTab === 'progress' ? (
        <section className="management-panel stack">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Progress</p>
              <h2>Where is each period right now?</h2>
              <p className="muted">Compare periods that share the same course plan.</p>
            </div>
            <button className="secondary" type="button" onClick={() => navigate('/classroom')}>
              Open Classroom
            </button>
          </div>

          <div className="progress-course-grid">
            {state.courseDetails.length ? (
              state.courseDetails.map((course) => {
                const attachedSections = courseSections(course, sections);
                const depth = courseDepth(course);
                return (
                  <article key={course.id} className="card stack">
                    <div className="section-heading">
                      <div>
                        <p className="eyebrow">{course.subject ?? 'Course'}</p>
                        <h3>{course.name}</h3>
                      </div>
                      <span className="status-pill upcoming">{depth.lessons} lessons</span>
                    </div>
                    {attachedSections.length ? (
                      <div className="progress-section-list">
                        {attachedSections.map((section) => {
                          const resume = state.resumesBySectionId[section.sectionId];
                          const percent = sectionPercent(resume);
                          const status = !resume?.lesson
                            ? 'Missing lesson'
                            : percent >= 100
                              ? 'Complete'
                              : percent > 0
                                ? 'In progress'
                                : 'Not started';
                          return (
                            <div key={section.sectionId} className="progress-section-row">
                              <div>
                                <strong>{section.sectionName}</strong>
                                <span>{resume?.lesson?.title ?? 'No lesson started'}</span>
                              </div>
                              <progress max={100} value={percent} />
                              <span className={status === 'Missing lesson' ? 'status-pill needs-work' : 'status-pill upcoming'}>
                                {status}
                              </span>
                              {resume?.lesson ? (
                                <button
                                  className="secondary"
                                  type="button"
                                  onClick={() => {
                                    navigate(`/sections/${section.sectionId}/lessons/${resume.lesson?.id}`);
                                  }}
                                >
                                  Open tracker
                                </button>
                              ) : (
                                <button
                                  className="secondary"
                                  type="button"
                                  onClick={() => {
                                    setSelectedCourseId(course.id);
                                    setSelectedSectionId(section.sectionId);
                                    setActiveTab('curriculum');
                                  }}
                                >
                                  Add lesson
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="muted">No periods use this course yet.</p>
                    )}
                  </article>
                );
              })
            ) : (
              <article className="card stack">
                <h3>No courses yet</h3>
                <p className="muted">Create a course and period before comparing progress.</p>
              </article>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
