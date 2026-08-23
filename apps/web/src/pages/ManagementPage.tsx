import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { courseNameKey, normalizeImportedCourseVariants } from '../lib/scheduleImport.js';
import { CurriculumTimeline } from '../components/CurriculumTimeline.js';

type ManagementTab =
  | 'start'
  | 'courses'
  | 'periods'
  | 'weekly'
  | 'curriculum'
  | 'progress'
  | 'import';
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
  endTime: string;
  room: string;
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
  endTime: string;
  room: string;
};
type ImportedClassGroupReview = {
  name: string;
  classes: ParsedScheduleClass[];
};
type ImportedCourseGroupReview = {
  name: string;
  classGroups: ImportedClassGroupReview[];
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
  endTime: string;
  room: string;
};
type GenerationProgress = {
  completed: number;
  total: number;
  status: 'creating' | 'complete';
};
type PendingCourseDeletion = {
  course: CourseDetail;
  confirmationText: string;
};
type CorrectionProgress = {
  status: 'sending' | 'processing' | 'complete';
  percent: number;
};
type ImportProgress = {
  status: 'ready' | 'uploading' | 'processing' | 'complete';
  percent: number;
};
type ImportCompletion = {
  classGroupCount: number;
  meetingTimeCount: number;
};

type ManagementState = {
  courses: CourseSummary[];
  courseDetails: CourseDetail[];
  schedule: GetScheduleResponse | null;
  resumesBySectionId: Record<string, ClassroomResumeResponse>;
};

const tabs: Array<{ id: ManagementTab; label: string }> = [
  { id: 'import', label: 'Import' },
  { id: 'start', label: 'Guide' },
  { id: 'courses', label: 'Courses' },
  { id: 'periods', label: 'Class groups' },
  { id: 'curriculum', label: 'Year Plan' },
  { id: 'progress', label: 'Progress' }
];

const meetingDays = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'A-Day',
  'B-Day'
] as const;
const maxScheduleUploadBytes = 10 * 1024 * 1024;
const maxScheduleImageDimension = 1800;
const scheduleImageQuality = 0.88;
const schoolYearStorageKey = 'teacheros_school_year_settings';
const walkthroughStorageKey = 'teacheros_management_walkthrough_v1';
const newCourseDraftStorageKey = 'teacheros_management_new_course_draft_v1';
const addPeriodDraftStorageKey = 'teacheros_management_add_period_draft_v1';
const activeTabStorageKey = 'teacheros_management_active_tab_v1';
const scheduleConfirmationStorageKey = 'teacheros_management_confirmed_schedule_v1';
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
function isTerminalStatus(status: AiJobStatusResponse['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

function readManagementActiveTab(): ManagementTab {
  try {
    const saved = window.localStorage.getItem(activeTabStorageKey);
    if (saved === 'weekly') return 'periods';
    const matchingTab = tabs.find((tab) => tab.id === saved);
    // Migrate the former default Guide tab into the new import-first experience.
    // Explicitly saved work tabs still open where the teacher left off.
    return matchingTab?.id === 'start' ? 'import' : (matchingTab?.id ?? 'import');
  } catch {
    return 'import';
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
    const parsed = JSON.parse(
      window.localStorage.getItem(newCourseDraftStorageKey) ?? '{}'
    ) as Partial<NewCourseDraft>;
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
    const parsed = JSON.parse(
      window.localStorage.getItem(addPeriodDraftStorageKey) ?? '{}'
    ) as Partial<AddPeriodDraft>;
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
      endTime: parsed.endTime ?? '',
      room: parsed.room ?? ''
    };
  } catch {
    return {
      courseId: '',
      sectionName: '',
      meetingDays: ['Monday'],
      time: '',
      endTime: '',
      room: ''
    };
  }
}

function readFileAsDataUrl(file: Blob): Promise<string> {
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

async function prepareScheduleUpload(
  file: File
): Promise<{ dataUrl: string; mimeType: string; compressed: boolean }> {
  const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
  if (!isImage || typeof createImageBitmap !== 'function') {
    return {
      dataUrl: await readFileAsDataUrl(file),
      mimeType: file.type || 'application/pdf',
      compressed: false
    };
  }

  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxScheduleImageDimension / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare schedule image');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', scheduleImageQuality)
    );
    if (!blob) throw new Error('Could not compress schedule image');
    return {
      dataUrl: await readFileAsDataUrl(blob),
      mimeType: 'image/jpeg',
      compressed: scale < 1 || blob.size < file.size
    };
  } finally {
    image.close();
  }
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
    endTime: parsedClass.endTime ?? '',
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
    endTime: draft.endTime.trim() || null,
    room: draft.room.trim() || null
  };
}

function meetingsFromParsedClasses(classes: ParsedScheduleClass[]) {
  const meetings = classes.flatMap((parsedClass) =>
    parsedClass.days.map((day) => ({
      day,
      time: parsedClass.time,
      endTime: parsedClass.endTime,
      room: parsedClass.room
    }))
  );
  return meetings.filter(
    (meeting, index) =>
      meetings.findIndex(
        (candidate) =>
          candidate.day === meeting.day &&
          candidate.time === meeting.time &&
          candidate.endTime === meeting.endTime &&
          candidate.room === meeting.room
      ) === index
  );
}

function correctionReferenceMatches(reference: string, parsedClass: ParsedScheduleClass): boolean {
  const referenceTokens = courseNameKey(reference).split(' ').filter(Boolean);
  if (!referenceTokens.length) return false;
  return [parsedClass.name, parsedClass.period, `${parsedClass.name} ${parsedClass.period}`].some(
    (candidate) => {
      const candidateTokens = courseNameKey(candidate).split(' ').filter(Boolean);
      return (
        candidateTokens.join(' ') === referenceTokens.join(' ') ||
        referenceTokens.every((referenceToken) => candidateTokens.includes(referenceToken))
      );
    }
  );
}

function applyInlineScheduleCorrection(
  schedule: ParseScheduleResponse,
  instruction: string
): ParseScheduleResponse | null {
  const normalizedInstruction = instruction.trim().replace(/\s+/g, ' ');
  const groupingMatch = normalizedInstruction.match(
    /^(.+?)\s+(?:(?:are|is)\s+)?(?:just\s+)?(?:different\s+)?(?:class(?:\s+groups?)?|groups?|periods?|part\s+of|under|in)\s+(?:of|under|in|for)?\s*(.+?)[.!]?$/i
  );
  const mergeMatch = normalizedInstruction.match(
    /(?:merge|combine|treat)\s+(.+?)\s+(?:into|as|called)\s+(.+?)[.!]?$/i
  );
  const renameMatch = normalizedInstruction.match(/rename\s+(.+?)\s+to\s+(.+?)[.!]?$/i);
  const match = groupingMatch ?? mergeMatch ?? renameMatch;
  if (!match?.[1] || !match[2]) return null;

  const sourceNames = match[1]
    .replace(/\b(the|classes?|class\s+groups?|groups?|sections?)\b/gi, '')
    .split(/,|\band\b/i)
    .map((name) => name.trim())
    .filter(Boolean);
  const target = match[2]
    .split(/[.!?]/, 1)[0]
    ?.replace(/^(?:one|the same)\s+course\s+(?:called\s+)?/i, '')
    .replace(/^called\s+/i, '')
    .replace(/\s+curriculum$/i, '')
    .trim();
  if (!sourceNames.length || !target) return null;

  const correctedClasses = schedule.classes.map((parsedClass) =>
    sourceNames.some((source) => correctionReferenceMatches(source, parsedClass))
      ? { ...parsedClass, name: target, subject: parsedClass.subject || target }
      : parsedClass
  );
  const changed = correctedClasses.some(
    (parsedClass, index) => parsedClass.name !== schedule.classes[index]?.name
  );
  return changed ? { ...schedule, classes: correctedClasses } : null;
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

type MeetingDayPickerProps = {
  value: string;
  onChange: (value: string) => void;
  label?: string;
};

function MeetingDayPicker({ value, onChange, label = 'Meeting days' }: MeetingDayPickerProps) {
  const selectedDays = parseMeetingDaysInput(value);

  return (
    <fieldset className="meeting-day-picker">
      <legend>{label}</legend>
      <div className="day-picker" role="group" aria-label={label}>
        {meetingDays.map((day) => {
          const isSelected = selectedDays.includes(day);
          return (
            <button
              key={day}
              className={isSelected ? 'active' : ''}
              type="button"
              aria-pressed={isSelected}
              onClick={() => {
                const nextDays = isSelected
                  ? selectedDays.length === 1
                    ? selectedDays
                    : selectedDays.filter((selectedDay) => selectedDay !== day)
                  : [...selectedDays, day];
                onChange(
                  meetingDays.filter((candidate) => nextDays.includes(candidate)).join(', ')
                );
              }}
            >
              {day}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function sectionToDraft(section: ScheduleSection): SectionEditDraft {
  const firstMeeting = section.meetings[0];
  const days = section.meetings.length
    ? section.meetings.map((meeting) => meeting.day).join(', ')
    : 'Monday';

  return {
    courseId: section.courseId,
    sectionName: section.sectionName,
    days,
    time: firstMeeting?.time ?? '',
    endTime: firstMeeting?.endTime ?? '',
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

function courseDepth(course: CourseDetail) {
  const lessons = course.units.reduce((count, unit) => count + unit.lessons.length, 0);
  const segments = course.units.reduce(
    (count, unit) =>
      count + unit.lessons.reduce((lessonCount, lesson) => lessonCount + lesson.segments.length, 0),
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
      const time = formatTimeRange(meeting.time, meeting.endTime);
      const room = meeting.room ? `, ${meeting.room}` : '';
      return `${meeting.day} ${time}${room}`;
    })
    .join(' | ');
}

function formatTimeRange(
  startTime: string | null | undefined,
  endTime: string | null | undefined
): string {
  if (!startTime && !endTime) return 'Time TBD';
  if (!startTime) return `Ends ${endTime}`;
  if (!endTime) return `${startTime} – end TBD`;
  return `${startTime} – ${endTime}`;
}

function sectionProgressLabel(
  section: ScheduleSection,
  resume: ClassroomResumeResponse | undefined
) {
  if (!resume?.lesson) return `${section.sectionName}: no lesson started`;
  const segmentCount = resume.lesson.segments.length;
  const completed = resume.state?.completedSegmentIds.length ?? 0;
  const status = completed >= segmentCount && segmentCount > 0 ? 'completed' : 'in progress';
  return `${section.sectionName}: ${resume.lesson.title}, ${status}`;
}

function sectionPercent(resume: ClassroomResumeResponse | undefined): number {
  if (!resume?.lesson?.segments.length) return 0;
  return Math.round(
    ((resume.state?.completedSegmentIds.length ?? 0) / resume.lesson.segments.length) * 100
  );
}

function resumeStopLabel(resume: ClassroomResumeResponse | undefined): string {
  if (!resume?.lesson) return 'No lesson started';
  const stoppedSegment = resume.lesson.segments.find(
    (segment) => segment.id === resume.state?.stoppedAtSegmentId
  );
  const nextSegment = resume.lesson.segments.find(
    (segment) => !resume.state?.completedSegmentIds.includes(segment.id)
  );
  if (stoppedSegment) return `Stopped at ${stoppedSegment.title}`;
  if (nextSegment) return `Next: ${nextSegment.title}`;
  return 'Lesson complete';
}

function segmentStatusLabel(
  resume: ClassroomResumeResponse | undefined,
  segmentId: string
): string {
  if (resume?.state?.completedSegmentIds.includes(segmentId)) return 'Completed';
  if (
    resume?.state?.currentSegmentId === segmentId ||
    resume?.state?.stoppedAtSegmentId === segmentId
  ) {
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
      id: 'import-schedule',
      title: 'Import your schedule first',
      body: 'Upload a schedule screenshot, PDF, or pasted text to draft courses, class groups, and meeting times for review.',
      tab: 'import' as ManagementTab
    };
  }
  if (!selectedSections.length) {
    return {
      id: 'add-periods',
      title: 'Add class groups for this course',
      body: 'A course uses one curriculum. Add groups such as A, B, and C—or Period 1, 2, and 3—to track them separately.',
      tab: 'periods' as ManagementTab
    };
  }
  if (!hasMeetingTimes) {
    return {
      id: 'add-times',
      title: 'Add meeting times',
      body: 'Give each group its own days, time, and room so the dashboard knows what class is current and what comes next.',
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
  const [yearPlanViewByCourseId, setYearPlanViewByCourseId] = useState<
    Record<string, YearPlanView>
  >({});
  const [schoolYearSettings, setSchoolYearSettings] = useState<SchoolYearSettings | null>(null);
  const [dismissedPromptIds, setDismissedPromptIds] = useState<string[]>([]);
  const [walkthroughDismissed, setWalkthroughDismissed] = useState(false);
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
  const [courseEditorNotice, setCourseEditorNotice] = useState<string | null>(null);
  const courseEditorRef = useRef<HTMLElement>(null);
  const [pendingCourseDeletion, setPendingCourseDeletion] = useState<PendingCourseDeletion | null>(
    null
  );
  const [quickCourseName, setQuickCourseName] = useState('');
  const [quickCourseSubject, setQuickCourseSubject] = useState('');

  const [selectedCourseForSchedule, setSelectedCourseForSchedule] = useState(
    savedAddPeriodDraft.courseId
  );
  const [sectionName, setSectionName] = useState(savedAddPeriodDraft.sectionName);
  const [selectedMeetingDays, setSelectedMeetingDays] = useState<
    Array<(typeof meetingDays)[number]>
  >(savedAddPeriodDraft.meetingDays);
  const [meetingTime, setMeetingTime] = useState(savedAddPeriodDraft.time);
  const [meetingEndTime, setMeetingEndTime] = useState(savedAddPeriodDraft.endTime);
  const [meetingRoom, setMeetingRoom] = useState(savedAddPeriodDraft.room);
  const [isAddGroupOpen, setIsAddGroupOpen] = useState(false);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [sectionEditDrafts, setSectionEditDrafts] = useState<Record<string, SectionEditDraft>>({});
  const [scheduleImportText, setScheduleImportText] = useState('');
  const [scheduleImportFileName, setScheduleImportFileName] = useState('');
  const [scheduleImportFileMimeType, setScheduleImportFileMimeType] = useState('');
  const [scheduleImportFileDataUrl, setScheduleImportFileDataUrl] = useState('');
  const [scheduleImportJobId, setScheduleImportJobId] = useState<string | null>(null);
  const [scheduleImportJob, setScheduleImportJob] = useState<AiJobStatusResponse | null>(null);
  const [scheduleImportOutput, setScheduleImportOutput] = useState<ParseScheduleResponse | null>(
    null
  );
  const [scheduleImportChanges, setScheduleImportChanges] = useState('');
  const [parsedClassEditDrafts, setParsedClassEditDrafts] = useState<
    Record<string, ParsedClassEditDraft>
  >({});
  const [addedParsedClassKeys, setAddedParsedClassKeys] = useState<string[]>([]);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);
  const [correctionProgress, setCorrectionProgress] = useState<CorrectionProgress | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [importCompletion, setImportCompletion] = useState<ImportCompletion | null>(null);
  const [completedWalkthroughIds, setCompletedWalkthroughIds] = useState<string[]>(() =>
    readStringList(walkthroughStorageKey)
  );
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [confirmedScheduleSignature, setConfirmedScheduleSignature] = useState(
    () => window.localStorage.getItem(scheduleConfirmationStorageKey) ?? ''
  );

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
        const detailResults = await Promise.allSettled(
          courses.map((course) => api.getCourseDetail(course.id))
        );
        const courseDetails = detailResults
          .filter(
            (result): result is PromiseFulfilledResult<CourseDetailResponse> =>
              result.status === 'fulfilled'
          )
          .map((result) => result.value.course);
        const sectionIds = schedule?.sections.map((section) => section.sectionId) ?? [];
        const resumeResults = await Promise.allSettled(
          sectionIds.map(
            async (sectionId) => [sectionId, await api.getClassroomResume(sectionId)] as const
          )
        );
        const resumesBySectionId = Object.fromEntries(
          resumeResults
            .filter(
              (
                result
              ): result is PromiseFulfilledResult<readonly [string, ClassroomResumeResponse]> =>
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

        const primaryResults = [coursesResult, scheduleResult];
        const onboardingRequired =
          (coursesResult.status === 'fulfilled' && scheduleResult.status === 'rejected') ||
          primaryResults.some(
            (result) =>
              result.status === 'rejected' &&
              typeof result.reason === 'object' &&
              result.reason !== null &&
              'message' in result.reason &&
              typeof result.reason.message === 'string' &&
              result.reason.message.includes('Complete onboarding first')
          );
        if (onboardingRequired) {
          navigate('/onboarding', { replace: true });
          return;
        }
        if (coursesResult.status === 'rejected' || scheduleResult.status === 'rejected') {
          setError('Some management data could not load.');
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load management page');
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [api, navigate]
  );

  useEffect(() => {
    void loadManagement(true);
    void api
      .getSchoolCalendar()
      .then((calendar) => {
        setSchoolYearSettings(
          calendar.schoolYear
            ? {
                startDate: calendar.schoolYear.startDate,
                endDate: calendar.schoolYear.endDate,
                meetingDays: [],
                bellScheduleType: 'weekly'
              }
            : null
        );
      })
      .catch(() => setSchoolYearSettings(null));
    void api
      .getPreferences()
      .then((preferences) => setWalkthroughDismissed(preferences.walkthroughDismissed))
      .catch(() => undefined);
  }, [api, loadManagement]);

  useEffect(() => {
    window.localStorage.setItem(activeTabStorageKey, activeTab);
  }, [activeTab]);

  useEffect(() => {
    const hasClasses = Boolean(state.schedule?.sections.length);
    const hasMeetingTimes = Boolean(
      state.schedule?.sections.some((section) => section.meetings.length > 0)
    );
    const allowedTabs = !state.courses.length
      ? ['import', 'courses']
      : !hasClasses
        ? ['import', 'courses', 'periods']
        : !hasMeetingTimes
          ? ['import', 'courses', 'periods', 'weekly']
          : tabs.map((tab) => tab.id);
    if (!allowedTabs.includes(activeTab)) setActiveTab('import');
  }, [activeTab, state.courses.length, state.schedule?.sections]);

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
        endTime: meetingEndTime,
        room: meetingRoom
      })
    );
  }, [
    meetingEndTime,
    meetingRoom,
    meetingTime,
    sectionName,
    selectedCourseForSchedule,
    selectedMeetingDays
  ]);

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
          setImportProgress(
            status.status === 'succeeded' ? { status: 'complete', percent: 100 } : null
          );
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
  const orderedCourseDetails = useMemo(
    () =>
      [...state.courseDetails].sort(
        (left, right) =>
          left.sortIndex - right.sortIndex ||
          left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
      ),
    [state.courseDetails]
  );
  const orderedSections = useMemo(
    () =>
      [...sections].sort((left, right) => {
        const leftCourse = orderedCourseDetails.findIndex((course) => course.id === left.courseId);
        const rightCourse = orderedCourseDetails.findIndex(
          (course) => course.id === right.courseId
        );
        return (
          leftCourse - rightCourse ||
          left.courseName.localeCompare(right.courseName, undefined, {
            numeric: true,
            sensitivity: 'base'
          }) ||
          left.sectionName.localeCompare(right.sectionName, undefined, {
            numeric: true,
            sensitivity: 'base'
          })
        );
      }),
    [orderedCourseDetails, sections]
  );
  const selectedCourse = useMemo(
    () =>
      orderedCourseDetails.find((course) => course.id === selectedCourseId) ??
      orderedCourseDetails[0] ??
      null,
    [orderedCourseDetails, selectedCourseId]
  );
  const selectedSections = useMemo(
    () => (selectedCourse ? courseSections(selectedCourse, sections) : []),
    [selectedCourse, sections]
  );
  const selectedSection = useMemo(
    () =>
      selectedSections.find((section) => section.sectionId === selectedSectionId) ??
      selectedSections[0] ??
      null,
    [selectedSectionId, selectedSections]
  );
  const selectedYearPlanView = selectedCourse
    ? (yearPlanViewByCourseId[selectedCourse.id] ?? 'timeline')
    : 'timeline';
  const editingCourse = useMemo(
    () => state.courseDetails.find((course) => course.id === editingCourseId) ?? null,
    [editingCourseId, state.courseDetails]
  );
  const editingCourseDraft = editingCourse
    ? (courseEditDrafts[editingCourse.id] ?? {
        name: editingCourse.name,
        subject: editingCourse.subject ?? '',
        gradeLevel: editingCourse.gradeLevel ?? ''
      })
    : null;

  useEffect(() => {
    if (!editingCourseId) return;

    const priorFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.classList.add('course-editor-open');
    const focusFrame = window.requestAnimationFrame(() => courseEditorRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        setEditingCourseId(null);
        setEditingSectionId(null);
        setCourseEditorNotice(null);
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.classList.remove('course-editor-open');
      document.removeEventListener('keydown', onKeyDown);
      priorFocus?.focus();
    };
  }, [busy, editingCourseId]);

  useEffect(() => {
    const firstCourse = state.courseDetails[0];
    if (!firstCourse) {
      setSelectedCourseId('');
      return;
    }
    if (
      !selectedCourseId ||
      !state.courseDetails.some((course) => course.id === selectedCourseId)
    ) {
      setSelectedCourseId(firstCourse.id);
    }
  }, [selectedCourseId, state.courseDetails]);

  useEffect(() => {
    const firstCourse = state.courses[0];
    if (!firstCourse) {
      setSelectedCourseForSchedule('');
      return;
    }
    if (
      !selectedCourseForSchedule ||
      !state.courses.some((course) => course.id === selectedCourseForSchedule)
    ) {
      setSelectedCourseForSchedule(selectedCourse?.id ?? firstCourse.id);
    }
  }, [selectedCourse?.id, selectedCourseForSchedule, state.courses]);

  useEffect(() => {
    const firstSection = selectedSections[0];
    if (!firstSection) {
      setSelectedSectionId(null);
      return;
    }
    if (
      !selectedSectionId ||
      !selectedSections.some((section) => section.sectionId === selectedSectionId)
    ) {
      setSelectedSectionId(firstSection.sectionId);
    }
  }, [selectedSectionId, selectedSections]);

  const prompt = promptForState(state, selectedCourse);
  const showPrompt =
    activeTab !== 'import' &&
    prompt &&
    !walkthroughDismissed &&
    !dismissedPromptIds.includes(prompt.id);
  const selectedDepth = selectedCourse
    ? courseDepth(selectedCourse)
    : { units: 0, lessons: 0, segments: 0 };
  const selectedCourseLessonIds = selectedCourse ? courseLessonIds(selectedCourse) : [];
  const plannedPercent =
    selectedDepth.lessons > 0
      ? Math.min(100, Math.round((selectedDepth.segments / selectedDepth.lessons) * 20))
      : 0;
  const meetingsRemaining = selectedSections.reduce(
    (count, section) => count + section.meetings.length,
    0
  );
  const setupSnapshot = [
    { label: 'Courses', value: state.courseDetails.length },
    { label: 'Classes', value: sections.length },
    {
      label: 'Units',
      value: state.courseDetails.reduce((count, course) => count + course.units.length, 0)
    },
    {
      label: 'Lessons',
      value: state.courseDetails.reduce((count, course) => count + courseDepth(course).lessons, 0)
    }
  ];
  const weeklySchedule = meetingDays.map((day) => ({
    day,
    sections: sections.filter((section) => section.meetings.some((meeting) => meeting.day === day))
  }));
  const hasMeetingGaps = sections.some(
    (section) =>
      !section.meetings.length ||
      section.meetings.some((meeting) => !meeting.time || !meeting.endTime || !meeting.room)
  );
  const visibleTabs = !state.courses.length
    ? tabs.filter((tab) => tab.id === 'import' || tab.id === 'courses')
    : !sections.length
      ? tabs.filter((tab) => tab.id === 'import' || tab.id === 'courses' || tab.id === 'periods')
      : !sections.some((section) => section.meetings.length > 0)
        ? tabs.filter((tab) => ['import', 'courses', 'periods', 'weekly'].includes(tab.id))
        : tabs;
  const scheduleSignature = sections
    .flatMap((section) =>
      section.meetings.map((meeting) =>
        [
          section.courseId,
          section.sectionId,
          section.sectionName,
          meeting.day,
          meeting.time ?? '',
          meeting.endTime ?? '',
          meeting.room ?? ''
        ].join(':')
      )
    )
    .sort()
    .join('|');
  const scheduleConfirmed =
    Boolean(scheduleSignature) && confirmedScheduleSignature === scheduleSignature;
  const scheduleGapItems = sections.flatMap((section) => {
    if (!section.meetings.length) {
      return [
        {
          id: `${section.sectionId}-no-meetings`,
          section,
          title: `${section.sectionName} has no meeting days`,
          detail: `${section.courseName} needs days, start time, end time, and room.`
        }
      ];
    }

    return section.meetings.flatMap((meeting) => {
      const missing = [
        meeting.time ? null : 'time',
        meeting.endTime ? null : 'end time',
        meeting.room ? null : 'room'
      ].filter((item): item is string => Boolean(item));
      if (!missing.length) return [];
      return [
        {
          id: `${section.sectionId}-${meeting.day}-${missing.join('-')}`,
          section,
          title: `${section.sectionName} is missing ${missing.join(' and ')}`,
          detail: `${meeting.day} / ${section.courseName}`
        }
      ];
    });
  });
  const walkthroughSteps = [
    {
      id: 'course',
      title: 'Create your first course',
      body: 'Create the course curriculum once. Class groups can share it.',
      tab: 'courses' as ManagementTab,
      done: state.courseDetails.length > 0
    },
    {
      id: 'periods',
      title: 'Add classes',
      body: 'Add each class group or period that uses a course.',
      tab: 'periods' as ManagementTab,
      done: sections.length > 0
    },
    {
      id: 'schedule',
      title: 'Add meeting times',
      body: 'Set when each class group meets so the dashboard knows what is happening today.',
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
      sortIndex: nextCourse.sortIndex,
      createdAt: nextCourse.createdAt
    };

    setState((previous) => ({
      ...previous,
      courses: previous.courses.some((course) => course.id === nextCourse.id)
        ? previous.courses.map((course) => (course.id === nextCourse.id ? nextSummary : course))
        : [nextSummary, ...previous.courses],
      courseDetails: previous.courseDetails.some((course) => course.id === nextCourse.id)
        ? previous.courseDetails.map((course) =>
            course.id === nextCourse.id ? nextCourse : course
          )
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

  const moveCourse = async (courseId: string, direction: -1 | 1) => {
    const ordered = [...state.courseDetails].sort(
      (left, right) =>
        left.sortIndex - right.sortIndex ||
        left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
    );
    const currentIndex = ordered.findIndex((course) => course.id === courseId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= ordered.length) return;

    const next = [...ordered];
    const currentCourse = next[currentIndex]!;
    const targetCourse = next[targetIndex]!;
    next[currentIndex] = targetCourse;
    next[targetIndex] = currentCourse;
    try {
      setBusy(true);
      // Persist the complete ordering atomically so every course gets one
      // stable position, even if another edit is saved at the same time.
      await api.updateCourseOrder({ courseIds: next.map((course) => course.id) });
      setState((previous) => ({
        ...previous,
        courses: next.map((course, sortIndex) => ({
          id: course.id,
          name: course.name,
          subject: course.subject,
          gradeLevel: course.gradeLevel,
          sortIndex,
          createdAt: course.createdAt
        })),
        courseDetails: next.map((course, sortIndex) => ({ ...course, sortIndex }))
      }));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the course order');
    } finally {
      setBusy(false);
    }
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
      `Class groups: ${newCoursePeriods.trim() || 'Not set'}`
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
    const selectedCourseName =
      state.courses.find((course) => course.id === selectedCourseForSchedule)?.name ??
      'Not selected';
    const summary = [
      'Class period draft',
      `Course: ${selectedCourseName}`,
      `Period: ${sectionName.trim() || 'Untitled'}`,
      `Days: ${selectedMeetingDays.join(', ')}`,
      `Start: ${meetingTime || 'Not set'}`,
      `End: ${meetingEndTime || 'Not set'}`,
      `Room: ${meetingRoom.trim() || 'Not set'}`
    ].join('\n');
    await navigator.clipboard?.writeText(summary).catch(() => undefined);
    flashCopyStatus('Period draft copied.');
  };

  const clearAddPeriodDraft = () => {
    setSectionName('');
    setSelectedMeetingDays(['Monday']);
    setMeetingTime('');
    setMeetingEndTime('');
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
        return `${editedClass.period}: ${editedClass.name} / ${editedClass.days.join(', ')} / ${formatTimeRange(editedClass.time, editedClass.endTime)} / ${editedClass.room ?? 'Room TBD'}`;
      })
    ].join('\n');
    await navigator.clipboard?.writeText(summary).catch(() => undefined);
    flashCopyStatus('Import summary copied.');
  };

  const copyProgressSummary = async () => {
    const lines = [
      'Section progress summary',
      '',
      ...state.courseDetails.flatMap((course) => {
        const attachedSections = courseSections(course, sections);
        return [
          course.name,
          ...(attachedSections.length
            ? attachedSections.map((section) => {
                const resume = state.resumesBySectionId[section.sectionId];
                return `- ${section.sectionName}: ${resume?.lesson?.title ?? 'No lesson'} / ${sectionPercent(resume)}% / ${resumeStopLabel(resume)} / last taught ${resume?.state?.lastTaughtDate ?? 'not saved'}`;
              })
            : ['- No periods'])
        ];
      })
    ].join('\n');
    await navigator.clipboard?.writeText(lines).catch(() => undefined);
    flashCopyStatus('Progress summary copied.');
  };

  const copyWeeklyScheduleSummary = async () => {
    const lines = [
      'Weekly schedule',
      '',
      ...weeklySchedule.flatMap(({ day, sections: daySections }) => [
        day,
        ...(daySections.length
          ? daySections.map((section) => {
              const meeting = section.meetings.find((item) => item.day === day);
              return `- ${formatTimeRange(meeting?.time, meeting?.endTime)} / ${section.sectionName} / ${section.courseName} / ${meeting?.room ?? 'Room TBD'}`;
            })
          : ['- No periods'])
      ]),
      '',
      'Setup gaps',
      ...(scheduleGapItems.length
        ? scheduleGapItems.map((gap) => `- ${gap.title}: ${gap.detail}`)
        : ['- No missing times or rooms'])
    ].join('\n');
    await navigator.clipboard?.writeText(lines).catch(() => undefined);
    flashCopyStatus('Weekly schedule copied.');
  };

  const selectCourse = (courseId: string, nextTab?: ManagementTab) => {
    setSelectedCourseId(courseId);
    setSelectedCourseForSchedule(courseId);
    if (nextTab) setActiveTab(nextTab);
  };

  const beginCourseEdit = (course: CourseDetail) => {
    setSelectedCourseId(course.id);
    setEditingCourseId(course.id);
    setEditingSectionId(null);
    setCourseEditorNotice(null);
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
          endTime: '',
          room: ''
        }),
        ...patch
      }
    }));
  };

  const saveSectionEdit = async (sectionId: string) => {
    const draft = sectionEditDrafts[sectionId];
    if (!draft?.sectionName.trim()) {
      setError('Class group name is required.');
      return;
    }
    if (!draft.time || !draft.endTime) {
      setError('Every class meeting needs both a start time and an end time.');
      return;
    }
    if (draft.endTime <= draft.time) {
      setError('End time must be after start time.');
      return;
    }

    try {
      setBusy(true);
      const schedule = await api.updateSection(sectionId, {
        sectionName: draft.sectionName.trim(),
        meetings: parseMeetingDaysInput(draft.days).map((day) => ({
          day,
          time: draft.time.trim() || null,
          endTime: draft.endTime.trim() || null,
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
    const template =
      yearPlanTemplates.find((item) => item.id === selectedTemplateId) ?? yearPlanTemplates[0];
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
          const createdLesson = latestUnit?.lessons.find(
            (lesson) => lesson.title === templateLesson.title
          );
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

  const beginSegmentEdit = (
    segment: CourseDetail['units'][number]['lessons'][number]['segments'][number]
  ) => {
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
      setCourseEditorNotice('Course details saved. Choose Done editing when you are finished.');
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update course');
    } finally {
      setBusy(false);
    }
  };

  const requestCourseDeletion = (course: CourseDetail) => {
    setPendingCourseDeletion({ course, confirmationText: '' });
  };

  const deleteCourse = async () => {
    const pendingDeletion = pendingCourseDeletion;
    if (
      !pendingDeletion ||
      pendingDeletion.confirmationText.trim().toUpperCase() !== 'DELETE COURSE'
    )
      return;

    const { course } = pendingDeletion;

    try {
      setBusy(true);
      await api.deleteCourse(course.id);
      const schedule = await api.getSchedule();
      const remainingSectionIds = new Set(schedule.sections.map((section) => section.sectionId));
      setState((previous) => ({
        ...previous,
        courses: previous.courses.filter((item) => item.id !== course.id),
        courseDetails: previous.courseDetails.filter((item) => item.id !== course.id),
        schedule,
        resumesBySectionId: Object.fromEntries(
          Object.entries(previous.resumesBySectionId).filter(([sectionId]) =>
            remainingSectionIds.has(sectionId)
          )
        )
      }));
      if (selectedCourseId === course.id) setSelectedCourseId('');
      if (selectedCourseForSchedule === course.id) setSelectedCourseForSchedule('');
      setEditingCourseId(null);
      setCourseEditorNotice(null);
      setPendingCourseDeletion(null);
      setError(null);
      flashCopyStatus(`Deleted ${course.name}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete course');
    } finally {
      setBusy(false);
    }
  };

  const findCourseForParsedClass = (parsedClass: ParsedScheduleClass) => {
    const nameKey = courseNameKey(parsedClass.name);
    return state.courses.find((course) => courseNameKey(course.name) === nameKey) ?? null;
  };

  const parsedCourseKey = (parsedClass: ParsedScheduleClass) => courseNameKey(parsedClass.name);

  const parsedClassKey = (parsedClass: ParsedScheduleClass) =>
    `${parsedClass.name}-${parsedClass.period}-${parsedClass.time ?? 'start'}-${parsedClass.endTime ?? 'end'}-${parsedClass.room ?? 'room'}`;

  const parsedClassFromDraft = (parsedClass: ParsedScheduleClass) => {
    const key = parsedClassKey(parsedClass);
    return draftToParsedClass(parsedClassEditDrafts[key] ?? parsedClassToDraft(parsedClass));
  };

  const updateParsedClassDraft = (
    parsedClass: ParsedScheduleClass,
    patch: Partial<ParsedClassEditDraft>
  ) => {
    const key = parsedClassKey(parsedClass);
    setParsedClassEditDrafts((previous) => ({
      ...previous,
      [key]: {
        ...(previous[key] ?? parsedClassToDraft(parsedClass)),
        ...patch
      }
    }));
  };

  const applyScheduleImportChanges = async () => {
    if (!scheduleImportOutput) return;
    if (addedParsedClassKeys.length) {
      setError(
        'Some classes from this review have already been saved. To avoid duplicates, edit those classes in Meeting times or start a new import. Corrections replace only an unsaved review.'
      );
      return;
    }
    const instruction = scheduleImportChanges.trim().replace(/\s+/g, ' ');
    if (!instruction) return;
    const currentSchedule = {
      classes: scheduleImportOutput.classes.map((parsedClass) => parsedClassFromDraft(parsedClass)),
      assignments: scheduleImportOutput.assignments
    };

    try {
      setBusy(true);
      setCorrectionProgress({ status: 'sending', percent: 20 });
      setCorrectionProgress({ status: 'processing', percent: 55 });
      const correctedSchedule = await api.correctScheduleImport({
        ...currentSchedule,
        instruction
      });
      // A correction returns the authoritative, complete replacement review.
      // Never merge the original draft back in: doing so makes a renamed or
      // rescheduled class appear twice when the teacher saves the review.
      applyScheduleParseResult(correctedSchedule);
      setScheduleImportChanges('');
      setCorrectionProgress({ status: 'complete', percent: 100 });
      setError(null);
      flashCopyStatus('Correction processed. Rebuilt the complete schedule review.');
    } catch (err) {
      const fallbackSchedule =
        err instanceof ApiError && err.status === 404
          ? applyInlineScheduleCorrection(currentSchedule, instruction)
          : null;
      if (fallbackSchedule) {
        applyScheduleParseResult(fallbackSchedule);
        setScheduleImportChanges('');
        setCorrectionProgress({ status: 'complete', percent: 100 });
        setError(null);
        flashCopyStatus('Correction processed. Rebuilt the complete schedule review.');
        return;
      }
      setCorrectionProgress(null);
      setError(err instanceof ApiError ? err.message : 'Failed to process the schedule correction');
    } finally {
      setBusy(false);
    }
  };

  const applyScheduleParseResult = (parsed: ParseScheduleResponse) => {
    const normalized = normalizeImportedCourseVariants(parsed);
    setScheduleImportOutput(normalized);
    setParsedClassEditDrafts(
      Object.fromEntries(
        normalized.classes.map((parsedClass) => [
          parsedClassKey(parsedClass),
          parsedClassToDraft(parsedClass)
        ])
      )
    );
    setAddedParsedClassKeys([]);
    setGenerationProgress(null);
    setImportCompletion(null);
  };

  const startScheduleUpload = async () => {
    if (!scheduleImportText.trim() && !scheduleImportFileDataUrl) {
      setError('Paste schedule text or upload an image/PDF first.');
      return;
    }

    try {
      setBusy(true);
      setImportProgress({ status: 'uploading', percent: 25 });
      setScheduleImportJobId(null);
      setScheduleImportJob(null);
      setScheduleImportOutput(null);
      setGenerationProgress(null);
      setCorrectionProgress(null);
      setImportCompletion(null);
      const queued = await api.enqueueParseSchedule({
        text: scheduleImportText.trim() || undefined,
        imageBase64: scheduleImportFileDataUrl || undefined,
        fileName: scheduleImportFileName || undefined,
        fileMimeType: scheduleImportFileMimeType || undefined
      });
      setScheduleImportJobId(queued.jobId);
      setImportProgress({ status: 'processing', percent: 35 });
      setError(null);
    } catch (err) {
      setImportProgress(null);
      setError(err instanceof ApiError ? err.message : 'Failed to read schedule');
    } finally {
      setBusy(false);
    }
  };

  const addParsedClassGroupToSchedule = async (classGroup: ImportedClassGroupReview) => {
    const editedClasses = classGroup.classes.map((parsedClass) =>
      parsedClassFromDraft(parsedClass)
    );
    const firstClass = editedClasses[0];
    if (!firstClass?.name || !firstClass.period) return;

    try {
      setBusy(true);
      setGenerationProgress({ completed: 0, total: 1, status: 'creating' });
      const existingCourse = findCourseForParsedClass(firstClass);
      const course =
        existingCourse ??
        (await createCourse(firstClass.name, firstClass.subject, firstClass.grade ?? ''));

      const existingSection = state.schedule?.sections.find(
        (section) =>
          section.courseId === course.id &&
          courseNameKey(section.sectionName) === courseNameKey(firstClass.period)
      );
      const schedule = existingSection
        ? await api.updateSection(existingSection.sectionId, {
            sectionName: existingSection.sectionName,
            meetings: meetingsFromParsedClasses(editedClasses)
          })
        : await api.createSection({
            courseId: course.id,
            sectionName: firstClass.period,
            meetings: meetingsFromParsedClasses(editedClasses)
          });

      setState((previous) => ({ ...previous, schedule }));
      setSelectedCourseId(course.id);
      setSelectedCourseForSchedule(course.id);
      setAddedParsedClassKeys((previous) => [
        ...new Set([
          ...previous,
          ...classGroup.classes.map((parsedClass) => parsedClassKey(parsedClass))
        ])
      ]);
      setError(null);
      setGenerationProgress({ completed: 1, total: 1, status: 'complete' });
    } catch (err) {
      setGenerationProgress(null);
      setError(err instanceof ApiError ? err.message : 'Failed to add parsed class group');
    } finally {
      setBusy(false);
    }
  };

  const addAllParsedClassesToSchedule = async () => {
    if (!scheduleImportOutput) return;

    const pendingClassGroups = importedCourseGroups
      .flatMap((courseGroup) =>
        courseGroup.classGroups.map((classGroup) => ({
          classGroup,
          editedClasses: classGroup.classes.map((parsedClass) => parsedClassFromDraft(parsedClass))
        }))
      )
      .filter(
        ({ classGroup, editedClasses }) =>
          editedClasses[0]?.name &&
          editedClasses[0]?.period &&
          classGroup.classes.some(
            (parsedClass) => !addedParsedClassKeys.includes(parsedClassKey(parsedClass))
          )
      );

    if (!pendingClassGroups.length) {
      flashCopyStatus('No reviewed classes left to add.');
      return;
    }

    try {
      setBusy(true);
      setGenerationProgress({ completed: 0, total: pendingClassGroups.length, status: 'creating' });
      // Create through the same durable course and class-group endpoints used by
      // the manual setup flow. The previous batch endpoint was returning an
      // opaque 400 in production, which meant a reviewed schedule could never
      // be saved even though each reviewed class was valid.
      const coursesByImportedName = new Map(
        state.courses.map((course) => [courseNameKey(course.name), course])
      );
      let schedule: GetScheduleResponse | null = null;

      for (const [index, { editedClasses }] of pendingClassGroups.entries()) {
        const firstClass = editedClasses[0];
        if (!firstClass) continue;

        const courseKey = parsedCourseKey(firstClass);
        let course = coursesByImportedName.get(courseKey);
        if (!course) {
          course = await createCourse(firstClass.name, firstClass.subject, firstClass.grade ?? '');
          coursesByImportedName.set(courseKey, course);
        }

        const existingSection: GetScheduleResponse['sections'][number] | undefined = (schedule ?? state.schedule)?.sections.find(
          (section) =>
            section.courseId === course!.id &&
            courseNameKey(section.sectionName) === courseNameKey(firstClass.period)
        );
        schedule = existingSection
          ? await api.updateSection(existingSection.sectionId, {
              sectionName: existingSection.sectionName,
              meetings: meetingsFromParsedClasses(editedClasses)
            })
          : await api.createSection({
              courseId: course.id,
              sectionName: firstClass.period,
              meetings: meetingsFromParsedClasses(editedClasses)
            });
        setGenerationProgress({
          completed: index + 1,
          total: pendingClassGroups.length,
          status: 'creating'
        });
      }

      if (!schedule) throw new Error('No reviewed class groups were created.');
      const addedKeys = pendingClassGroups.flatMap(({ classGroup }) =>
        classGroup.classes.map((parsedClass) => parsedClassKey(parsedClass))
      );
      setState((previous) => ({ ...previous, schedule }));
      const firstCourse = pendingClassGroups[0]?.editedClasses[0];
      const firstCreatedCourse = firstCourse
        ? state.courses.find(
            (course) => courseNameKey(course.name) === parsedCourseKey(firstCourse)
          )
        : null;
      if (firstCreatedCourse) {
        setSelectedCourseId(firstCreatedCourse.id);
        setSelectedCourseForSchedule(firstCreatedCourse.id);
      }
      setAddedParsedClassKeys((previous) => [...new Set([...previous, ...addedKeys])]);
      setError(null);
      setGenerationProgress({
        completed: pendingClassGroups.length,
        total: pendingClassGroups.length,
        status: 'complete'
      });
      setImportCompletion({
        classGroupCount: pendingClassGroups.length,
        meetingTimeCount: pendingClassGroups.reduce(
          (count, { editedClasses }) => count + meetingsFromParsedClasses(editedClasses).length,
          0
        )
      });
      void api
        .updatePreferences({ setupStep: 'calendar', walkthroughDismissed: false })
        .catch(() => undefined);
      setCompletedWalkthroughIds((previous) => [
        ...new Set([...previous, 'course', 'periods', 'schedule'])
      ]);
      flashCopyStatus(
        `Created ${pendingClassGroups.length} reviewed ${pendingClassGroups.length === 1 ? 'class group' : 'class groups'}.`
      );
    } catch (err) {
      setGenerationProgress(null);
      setError(err instanceof ApiError ? err.message : 'Failed to create reviewed class groups');
    } finally {
      setBusy(false);
    }
  };

  const importedCourseGroups = scheduleImportOutput
    ? Array.from(
        scheduleImportOutput.classes
          .reduce((groups, parsedClass) => {
            const editedClass = parsedClassFromDraft(parsedClass);
            const key = courseNameKey(editedClass.name) || parsedClassKey(parsedClass);
            const group = groups.get(key) ?? {
              name: editedClass.name,
              classes: [] as ParsedScheduleClass[]
            };
            group.classes.push(parsedClass);
            groups.set(key, group);
            return groups;
          }, new Map<string, { name: string; classes: ParsedScheduleClass[] }>())
          .values()
      ).map<ImportedCourseGroupReview>((courseGroup) => ({
        name: courseGroup.name,
        classGroups: Array.from(
          courseGroup.classes
            .reduce((groups, parsedClass) => {
              const editedClass = parsedClassFromDraft(parsedClass);
              const key = courseNameKey(editedClass.period) || parsedClassKey(parsedClass);
              const group = groups.get(key) ?? {
                name: editedClass.period,
                classes: [] as ParsedScheduleClass[]
              };
              group.classes.push(parsedClass);
              groups.set(key, group);
              return groups;
            }, new Map<string, ImportedClassGroupReview>())
            .values()
        )
      }))
    : [];

  const importedClassGroupCount = importedCourseGroups.reduce(
    (count, courseGroup) => count + courseGroup.classGroups.length,
    0
  );
  const hasStartedScheduleRead =
    Boolean(scheduleImportJobId) ||
    Boolean(scheduleImportOutput) ||
    (importProgress !== null && importProgress.status !== 'ready');
  const resetScheduleImport = () => {
    setScheduleImportText('');
    setScheduleImportFileName('');
    setScheduleImportFileMimeType('');
    setScheduleImportFileDataUrl('');
    setScheduleImportJobId(null);
    setScheduleImportJob(null);
    setScheduleImportOutput(null);
    setParsedClassEditDrafts({});
    setAddedParsedClassKeys([]);
    setGenerationProgress(null);
    setCorrectionProgress(null);
    setImportProgress(null);
    setImportCompletion(null);
    setError(null);
  };

  return (
    <div className="management-page stack">
      <nav className="management-tabs" aria-label="Management sections">
        {visibleTabs.map((tab) => (
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

      {state.courses.length ? (
        <section className="management-snapshot" aria-label="Management setup snapshot">
          {setupSnapshot.map((item) => (
            <div key={item.label}>
              <strong>{item.value}</strong>
              <span>{item.label}</span>
            </div>
          ))}
        </section>
      ) : null}

      {error ? <p className="notice warning">{error}</p> : null}
      {copyStatus ? <p className="notice success">{copyStatus}</p> : null}
      {loading ? <p className="muted">Loading...</p> : null}
      {showPrompt && state.courses.length ? (
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
              onClick={() => {
                setDismissedPromptIds((previous) => [...new Set([...previous, prompt.id])]);
                setWalkthroughDismissed(true);
                void api.updatePreferences({ walkthroughDismissed: true }).catch(() => undefined);
              }}
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
              <p className="eyebrow">Guide</p>
              <h2>Build the year in small steps.</h2>
              <p className="muted">
                Use one step at a time. Nothing here blocks the rest of the app.
              </p>
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
                <article
                  key={step.id}
                  className={done ? 'walkthrough-step-card done' : 'walkthrough-step-card'}
                >
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
                      <button
                        className="secondary"
                        type="button"
                        onClick={() => markWalkthroughStep(step.id)}
                      >
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
              {tabs
                .filter((tab) => tab.id !== 'start')
                .map((tab) => (
                  <button
                    key={tab.id}
                    className="secondary"
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                  >
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
            <button
              className="secondary"
              type="button"
              onClick={() => setIsNewCourseOpen((current) => !current)}
            >
              {isNewCourseOpen ? 'Close' : 'New Course'}
            </button>
          </div>

          <article className="card terminology-card">
            <div>
              <p className="eyebrow">Quick definitions</p>
              <h3>One course, many class groups, separate meeting times.</h3>
            </div>
            <div className="terminology-grid">
              <p>
                <strong>Course</strong> — one shared curriculum, such as Spanish 5.
              </p>
              <p>
                <strong>Class group</strong> — the students taking that course, such as Group A, B,
                or C. You can also name groups Period 1, Period 2, and Period 3.
              </p>
              <p>
                <strong>Meeting times</strong> — the days, start time, end time, and room for each
                class group. Every group can meet at a different time.
              </p>
            </div>
          </article>

          {isNewCourseOpen ? (
            <article className="card stack compact-create-card">
              <div className="section-heading">
                <div>
                  <h3>Create course</h3>
                  <p className="muted">Draft saves on this device while you decide what to add.</p>
                </div>
                <div className="profile-actions">
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => void copyNewCourseDraft()}
                  >
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
              </div>
              <div className="profile-actions">
                <button
                  type="button"
                  disabled={busy || !newCourseName.trim()}
                  onClick={async () => {
                    try {
                      setBusy(true);
                      await createCourse(newCourseName, newCourseSubject, newCourseGrade);
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
                  Create course and add class groups
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setIsNewCourseOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </article>
          ) : null}

          {orderedCourseDetails.length > 1 ? (
            <article className="card course-order-panel" aria-label="Course order">
              <div>
                <strong>Course order</strong>
                <p className="muted">
                  Use the arrows to keep your courses in the order you want. This order is saved.
                </p>
              </div>
              <div className="course-order-list">
                {orderedCourseDetails.map((course, courseIndex) => (
                  <div key={course.id}>
                    <span>{course.name}</span>
                    <button
                      className="secondary compact-icon-button"
                      type="button"
                      aria-label={`Move ${course.name} up`}
                      disabled={busy || courseIndex === 0}
                      onClick={() => void moveCourse(course.id, -1)}
                    >
                      ↑
                    </button>
                    <button
                      className="secondary compact-icon-button"
                      type="button"
                      aria-label={`Move ${course.name} down`}
                      disabled={busy || courseIndex === orderedCourseDetails.length - 1}
                      onClick={() => void moveCourse(course.id, 1)}
                    >
                      ↓
                    </button>
                  </div>
                ))}
              </div>
            </article>
          ) : null}

          <div className="course-card-grid">
            {orderedCourseDetails.length ? (
              orderedCourseDetails.map((course) => {
                const depth = courseDepth(course);
                const attachedSections = courseSections(course, sections);
                const isSelected = selectedCourse?.id === course.id;
                return (
                  <article
                    key={course.id}
                    className={isSelected ? 'course-summary-card selected' : 'course-summary-card'}
                  >
                    <div className="section-heading">
                      <div>
                        <p className="eyebrow">{course.subject ?? course.gradeLevel ?? 'Course'}</p>
                        <h3>{course.name}</h3>
                      </div>
                      <span className="status-pill upcoming">
                        {isSelected ? 'Selected' : 'Course'}
                      </span>
                    </div>
                    <div className="mini-stats">
                      <span>{depth.units} units</span>
                      <span>{depth.lessons} lessons</span>
                      <span>{depth.segments} segments</span>
                    </div>
                    <div className="tag-list">
                      {attachedSections.length ? (
                        attachedSections.map((section) => (
                          <span key={section.sectionId}>{section.sectionName}</span>
                        ))
                      ) : (
                        <span>No class groups yet</span>
                      )}
                    </div>
                    <div className="section-progress-list">
                      {attachedSections.length ? (
                        attachedSections.map((section) => (
                          <div key={section.sectionId}>
                            <strong>
                              {sectionProgressLabel(
                                section,
                                state.resumesBySectionId[section.sectionId]
                              )}
                            </strong>
                            <progress
                              max={100}
                              value={sectionPercent(state.resumesBySectionId[section.sectionId])}
                            />
                          </div>
                        ))
                      ) : (
                        <p className="muted">
                          Add class groups so the app can track each group separately.
                        </p>
                      )}
                    </div>
                    <div className="profile-actions">
                      <button
                        className="secondary"
                        type="button"
                        onClick={() => selectCourse(course.id, 'curriculum')}
                      >
                        Open Year Plan
                      </button>
                      <button type="button" onClick={() => beginCourseEdit(course)}>
                        Edit Course
                      </button>
                    </div>
                  </article>
                );
              })
            ) : (
              <article className="card stack">
                <h3>No courses yet</h3>
                <p className="muted">
                  Create one course to begin setting up class groups and the year plan.
                </p>
              </article>
            )}
          </div>
        </section>
      ) : null}

      {activeTab === 'import' ? (
        <section className="management-panel stack">
          {!hasStartedScheduleRead ? (
            <>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Start here</p>
                  <h2>Import your schedule</h2>
                  <p className="muted">
                    We will organize one shared curriculum into course, class groups, and meeting
                    times for your review.
                  </p>
                </div>
              </div>

              <article className="card terminology-card">
                <div>
                  <p className="eyebrow">How your schedule is organized</p>
                  <h3>Course → class group → meeting times</h3>
                </div>
                <div className="terminology-grid">
                  <p>
                    <strong>Course:</strong> one shared curriculum, such as Spanish 5.
                  </p>
                  <p>
                    <strong>Class group:</strong> a group taking that course, such as A, B, C—or
                    Period 1, 2, 3.
                  </p>
                  <p>
                    <strong>Meeting times:</strong> the days, start time, end time, and room for
                    each class group.
                  </p>
                </div>
              </article>
            </>
          ) : importCompletion ? null : (
            <section className="import-focus-header" aria-live="polite">
              <div>
                <p className="eyebrow">
                  {scheduleImportOutput
                    ? 'Step 3 of 3 · Review your schedule'
                    : 'Step 2 of 3 · Reading your schedule'}
                </p>
                <h2>
                  {scheduleImportOutput ? 'Your schedule draft is ready' : 'Reading your schedule'}
                </h2>
                {scheduleImportOutput ? (
                  <p className="muted">Review or correct this draft before you save anything.</p>
                ) : null}
              </div>
              <div className="profile-actions">
                {scheduleImportFileName ? (
                  <span className="status-pill upcoming">{scheduleImportFileName}</span>
                ) : null}
                <button
                  className="secondary"
                  type="button"
                  disabled={busy}
                  onClick={resetScheduleImport}
                >
                  Start over
                </button>
              </div>
            </section>
          )}

          {!hasStartedScheduleRead ? (
            <article className="card stack schedule-upload-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Step 1 of 3 · Add your schedule</p>
                  <h3>Upload a schedule image or PDF</h3>
                  <p className="muted">
                    Use a screenshot, PDF, or pasted text. We will not add any classes until you
                    review them.
                  </p>
                </div>
                {scheduleImportFileName ? (
                  <span className="status-pill upcoming">{scheduleImportFileName}</span>
                ) : null}
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
                      const supportedTypes = [
                        'image/png',
                        'image/jpeg',
                        'image/webp',
                        'image/gif',
                        'application/pdf'
                      ];
                      if (file.type && !supportedTypes.includes(file.type)) {
                        setError('Upload a PNG, JPG, WEBP, GIF, or PDF schedule file.');
                        event.currentTarget.value = '';
                        return;
                      }
                      try {
                        const preparedUpload = await prepareScheduleUpload(file);
                        setScheduleImportFileName(file.name);
                        setScheduleImportFileMimeType(preparedUpload.mimeType);
                        setScheduleImportFileDataUrl(preparedUpload.dataUrl);
                        setImportProgress({ status: 'ready', percent: 10 });
                        setError(null);
                        if (preparedUpload.compressed) {
                          flashCopyStatus('Image optimized for a faster schedule read.');
                        }
                      } catch (err) {
                        setError(
                          err instanceof Error ? err.message : 'Could not read schedule file'
                        );
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

              {scheduleImportFileDataUrl || scheduleImportText.trim() ? (
                <div className="schedule-import-action">
                  <button type="button" disabled={busy} onClick={startScheduleUpload}>
                    {busy ? 'Starting schedule reader...' : 'Step 2: Read my schedule'}
                  </button>
                </div>
              ) : null}
              <div className="profile-actions">
                <button className="secondary" type="button" onClick={resetScheduleImport}>
                  Clear
                </button>
              </div>
            </article>
          ) : null}

          {importProgress && !importCompletion ? (
            <section className="import-status-panel schedule-processing-panel" aria-live="polite">
              <div>
                <strong>
                  {importProgress.status === 'ready'
                    ? 'Step 1 complete: schedule ready'
                    : importProgress.status === 'uploading'
                      ? 'Uploading schedule...'
                      : importProgress.status === 'processing'
                        ? 'Step 2: reading your schedule...'
                        : 'Step 3: schedule review ready'}
                </strong>
                {importProgress.status === 'complete' ? (
                  <span>
                    Check the draft below, make any corrections, and then choose which classes to
                    add.
                  </span>
                ) : importProgress.status === 'ready' ? (
                  <span>When you are ready, select “Step 2: Read my schedule.”</span>
                ) : null}
              </div>
              <div
                className="import-progress-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={importProgress.percent}
              >
                <span style={{ width: `${importProgress.percent}%` }} />
              </div>
              {scheduleImportJobId ? (
                <div className="import-job-detail">
                  <div>
                    <strong>
                      {scheduleImportJob
                        ? `Reader status: ${scheduleImportJob.status}`
                        : 'Connecting to the schedule reader...'}
                    </strong>
                    <span>
                      {scheduleImportJob
                        ? `${scheduleImportJob.progressPercent}% complete`
                        : 'Preparing the file for review'}
                    </span>
                  </div>
                  {scheduleImportJob ? (
                    <progress max={100} value={scheduleImportJob.progressPercent} />
                  ) : null}
                  {scheduleImportJob?.error ? (
                    <p className="notice warning">{scheduleImportJob.error}</p>
                  ) : null}
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
                          setError(
                            err instanceof ApiError ? err.message : 'Failed to cancel schedule read'
                          );
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
                          setError(
                            err instanceof ApiError ? err.message : 'Failed to retry schedule read'
                          );
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
            </section>
          ) : null}

          {importCompletion ? (
            <section className="import-success-card" aria-live="polite">
              <div className="import-success-mark" aria-hidden="true">
                ✓
              </div>
              <div>
                <p className="eyebrow">Schedule imported</p>
                <h3>Your teaching week is ready.</h3>
                <p className="muted">
                  {importCompletion.classGroupCount}{' '}
                  {importCompletion.classGroupCount === 1 ? 'class group' : 'class groups'} and{' '}
                  {importCompletion.meetingTimeCount}{' '}
                  {importCompletion.meetingTimeCount === 1
                    ? 'meeting time is'
                    : 'meeting times are'}{' '}
                  now in TeacherDesk.
                </p>
              </div>
              <div className="import-next-steps">
                <div>
                  <p className="eyebrow">Next step</p>
                  <strong>Import your school calendar.</strong>
                  <span>Breaks and special days make your plan accurate.</span>
                </div>
                <button type="button" onClick={() => navigate('/school')}>
                  Import calendar
                </button>
              </div>
              <div className="profile-actions">
                <button className="secondary" type="button" onClick={() => setActiveTab('periods')}>
                  Review class groups
                </button>
                <button className="secondary" type="button" onClick={() => navigate('/dashboard')}>
                  Open dashboard
                </button>
                <button className="secondary" type="button" onClick={resetScheduleImport}>
                  Import another schedule
                </button>
              </div>
            </section>
          ) : scheduleImportOutput ? (
            <div className="parsed-schedule-review">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Step 3 of 3 · Review before saving</p>
                  <h3>
                    {importedClassGroupCount} class groups and {scheduleImportOutput.classes.length}{' '}
                    meeting times found
                  </h3>
                </div>
                <div className="profile-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void addAllParsedClassesToSchedule()}
                  >
                    Add all reviewed classes
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => void copyImportSummary()}
                  >
                    Copy import summary
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy}
                    onClick={resetScheduleImport}
                  >
                    Import a different schedule
                  </button>
                </div>
              </div>
              <div className="local-parse-summary good import-changes-panel">
                <strong>AI schedule correction</strong>
                <span>
                  Tell us what to change. This replaces the entire unsaved draft with the corrected
                  course, class-group, and meeting-time review—nothing from the old draft will be
                  added.
                </span>
                <div className="profile-actions">
                  <textarea
                    rows={2}
                    value={scheduleImportChanges}
                    onChange={(event) => setScheduleImportChanges(event.target.value)}
                    placeholder="Type a correction in plain language..."
                  />
                  <button
                    type="button"
                    disabled={busy || !scheduleImportChanges.trim()}
                    onClick={() => void applyScheduleImportChanges()}
                  >
                    {correctionProgress?.status === 'processing' ||
                    correctionProgress?.status === 'sending'
                      ? 'Processing correction...'
                      : 'Process correction'}
                  </button>
                </div>
              </div>
              {correctionProgress ? (
                <div className="import-status-panel" aria-live="polite">
                  <div>
                    <strong>
                      {correctionProgress.status === 'sending'
                        ? 'Sending correction...'
                        : correctionProgress.status === 'processing'
                          ? 'Rebuilding schedule review...'
                          : 'Schedule review rebuilt'}
                    </strong>
                    <span>
                      {correctionProgress.status === 'complete'
                        ? 'The updated course, class-group, and meeting-time review is ready. Nothing has been saved yet.'
                        : 'Your correction is being processed by the schedule reader.'}
                    </span>
                  </div>
                  <div
                    className="import-progress-track"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={correctionProgress.percent}
                  >
                    <span style={{ width: `${correctionProgress.percent}%` }} />
                  </div>
                </div>
              ) : null}
              {generationProgress ? (
                <div className="import-status-panel" aria-live="polite">
                  <div>
                    <strong>
                      {generationProgress.status === 'complete'
                        ? 'Course structure created'
                        : 'Creating course structure...'}
                    </strong>
                    <span>
                      {generationProgress.status === 'complete'
                        ? `${generationProgress.total} class groups are ready for review in Classes and Meeting times.`
                        : `Creating ${generationProgress.completed + 1} of ${generationProgress.total} class groups...`}
                    </span>
                  </div>
                  <div
                    className="import-progress-track"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={generationProgress.total}
                    aria-valuenow={generationProgress.completed}
                  >
                    <span
                      style={{
                        width: `${Math.round((generationProgress.completed / generationProgress.total) * 100)}%`
                      }}
                    />
                  </div>
                </div>
              ) : null}
              <div className="parsed-class-list">
                {importedCourseGroups.map((group) => {
                  const firstClass = group.classGroups[0]?.classes[0];
                  const matchingCourse = firstClass
                    ? findCourseForParsedClass(parsedClassFromDraft(firstClass))
                    : null;
                  return (
                    <article key={group.name} className="card stack">
                      <div className="section-heading">
                        <div>
                          <p className="eyebrow">Shared curriculum</p>
                          <h4>Course</h4>
                        </div>
                        <span className="status-pill upcoming">
                          {group.classGroups.length} class{' '}
                          {group.classGroups.length === 1 ? 'group' : 'groups'}
                        </span>
                      </div>
                      <label>
                        Course name
                        <input
                          className="input"
                          value={group.name}
                          onChange={(event) => {
                            const name = event.target.value;
                            setParsedClassEditDrafts((previous) => ({
                              ...previous,
                              ...Object.fromEntries(
                                group.classGroups
                                  .flatMap((classGroup) => classGroup.classes)
                                  .map((parsedClass) => {
                                    const key = parsedClassKey(parsedClass);
                                    return [
                                      key,
                                      {
                                        ...(previous[key] ?? parsedClassToDraft(parsedClass)),
                                        name
                                      }
                                    ];
                                  })
                              )
                            }));
                          }}
                        />
                      </label>
                      <p className="muted">
                        {matchingCourse
                          ? `Will use the existing ${matchingCourse.name} curriculum.`
                          : `Will create one ${group.name} curriculum for these class groups.`}
                      </p>
                      <div className="parsed-class-list">
                        {group.classGroups.map((classGroup) => {
                          const firstClass = classGroup.classes[0];
                          if (!firstClass) return null;
                          const firstKey = parsedClassKey(firstClass);
                          const firstDraft =
                            parsedClassEditDrafts[firstKey] ?? parsedClassToDraft(firstClass);
                          const isAdded = classGroup.classes.every((parsedClass) =>
                            addedParsedClassKeys.includes(parsedClassKey(parsedClass))
                          );
                          return (
                            <article
                              key={`${group.name}-${classGroup.name}`}
                              className="parsed-class-card"
                            >
                              <div className="section-heading">
                                <div>
                                  <p className="eyebrow">Class group</p>
                                  <h4>{firstDraft.period || 'Unnamed class group'}</h4>
                                </div>
                                <span className="status-pill upcoming">
                                  {classGroup.classes.length} meeting{' '}
                                  {classGroup.classes.length === 1 ? 'time' : 'times'}
                                </span>
                              </div>
                              <div className="parsed-class-fields">
                                <label>
                                  Class group
                                  <input
                                    className="input"
                                    value={firstDraft.period}
                                    onChange={(event) => {
                                      const period = event.target.value;
                                      setParsedClassEditDrafts((previous) => ({
                                        ...previous,
                                        ...Object.fromEntries(
                                          classGroup.classes.map((parsedClass) => {
                                            const key = parsedClassKey(parsedClass);
                                            return [
                                              key,
                                              {
                                                ...(previous[key] ??
                                                  parsedClassToDraft(parsedClass)),
                                                period
                                              }
                                            ];
                                          })
                                        )
                                      }));
                                    }}
                                    placeholder="A, B, C, or Block 1"
                                  />
                                </label>
                              </div>
                              <div className="parsed-class-list">
                                {classGroup.classes.map((parsedClass) => {
                                  const key = parsedClassKey(parsedClass);
                                  const draft =
                                    parsedClassEditDrafts[key] ?? parsedClassToDraft(parsedClass);
                                  return (
                                    <div key={key} className="parsed-class-fields">
                                      <MeetingDayPicker
                                        value={draft.days}
                                        onChange={(days) =>
                                          updateParsedClassDraft(parsedClass, { days })
                                        }
                                      />
                                      <div className="meeting-time-fields">
                                        <label>
                                          Start time
                                          <input
                                            className="input"
                                            type="time"
                                            value={draft.time}
                                            onChange={(event) =>
                                              updateParsedClassDraft(parsedClass, {
                                                time: event.target.value
                                              })
                                            }
                                          />
                                        </label>
                                        <label>
                                          End time
                                          <input
                                            className="input"
                                            type="time"
                                            value={draft.endTime}
                                            onChange={(event) =>
                                              updateParsedClassDraft(parsedClass, {
                                                endTime: event.target.value
                                              })
                                            }
                                          />
                                        </label>
                                      </div>
                                      <label>
                                        Room
                                        <input
                                          className="input"
                                          value={draft.room}
                                          onChange={(event) =>
                                            updateParsedClassDraft(parsedClass, {
                                              room: event.target.value
                                            })
                                          }
                                        />
                                      </label>
                                    </div>
                                  );
                                })}
                              </div>
                              <button
                                type="button"
                                disabled={busy || isAdded || !firstDraft.name || !firstDraft.period}
                                onClick={() => void addParsedClassGroupToSchedule(classGroup)}
                              >
                                {isAdded ? 'Added' : 'Make class'}
                              </button>
                            </article>
                          );
                        })}
                      </div>
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
        </section>
      ) : null}

      {activeTab === 'periods' ? (
        <section className="management-panel stack">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Class groups</p>
              <h2>Groups and meeting times</h2>
              <p className="muted">
                Each course has one shared plan. Add A, B, C—or periods—and set when each group
                meets here.
              </p>
            </div>
          </div>
          {state.courses.length === 0 ? (
            <article className="card stack compact-create-card">
              <h3>Create a course first</h3>
              <p className="muted">A class group needs a shared course curriculum to follow.</p>
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
              <article className="card stack compact-add-group-card">
                <div className="section-heading">
                  <div>
                    <h3>Add class group</h3>
                    <p className="muted">
                      Choose a course, name the group, then add its meeting rhythm.
                    </p>
                  </div>
                  <div className="profile-actions">
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => setIsAddGroupOpen((current) => !current)}
                    >
                      {isAddGroupOpen ? 'Close' : 'Add class group'}
                    </button>
                  </div>
                </div>
                {isAddGroupOpen ? (
                  <>
                    <div className="profile-actions">
                      <button
                        className="secondary"
                        type="button"
                        onClick={() => void copyAddPeriodDraft()}
                      >
                        Copy draft
                      </button>
                      <button className="secondary" type="button" onClick={clearAddPeriodDraft}>
                        Clear
                      </button>
                    </div>
                    <select
                      className="input"
                      value={selectedCourseForSchedule}
                      onChange={(event) => setSelectedCourseForSchedule(event.target.value)}
                    >
                      <option value="">Choose a course</option>
                      {state.courses.map((course) => (
                        <option key={course.id} value={course.id}>
                          {course.name}
                        </option>
                      ))}
                      <option value="__new_course__">＋ Add a new course</option>
                    </select>
                    {selectedCourseForSchedule === '__new_course__' ? (
                      <div className="inline-editor add-course-inline">
                        <input
                          className="input"
                          value={quickCourseName}
                          onChange={(event) => setQuickCourseName(event.target.value)}
                          placeholder="New course name"
                        />
                        <input
                          className="input"
                          value={quickCourseSubject}
                          onChange={(event) => setQuickCourseSubject(event.target.value)}
                          placeholder="Subject (optional)"
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
                              setError(
                                err instanceof ApiError ? err.message : 'Failed to create course'
                              );
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          Create and select course
                        </button>
                      </div>
                    ) : null}
                    <input
                      className="input"
                      value={sectionName}
                      onChange={(event) => setSectionName(event.target.value)}
                      placeholder="Class group, like A or Period 3"
                    />
                    <MeetingDayPicker
                      value={selectedMeetingDays.join(', ')}
                      onChange={(days) => setSelectedMeetingDays(parseMeetingDaysInput(days))}
                    />
                    <p className="muted compact-form-note">
                      A newly selected day starts with the meeting time below; adjust it before you
                      save the group.
                    </p>
                    <div className="meeting-time-fields">
                      <label>
                        Start time
                        <input
                          className="input"
                          type="time"
                          value={meetingTime}
                          onChange={(event) => setMeetingTime(event.target.value)}
                        />
                      </label>
                      <label>
                        End time
                        <input
                          className="input"
                          type="time"
                          value={meetingEndTime}
                          onChange={(event) => setMeetingEndTime(event.target.value)}
                        />
                      </label>
                    </div>
                    <input
                      className="input"
                      value={meetingRoom}
                      onChange={(event) => setMeetingRoom(event.target.value)}
                      placeholder="Room"
                    />
                    <button
                      type="button"
                      disabled={
                        busy ||
                        !selectedCourseForSchedule ||
                        !sectionName.trim() ||
                        !meetingTime ||
                        !meetingEndTime ||
                        meetingEndTime <= meetingTime
                      }
                      onClick={async () => {
                        try {
                          setBusy(true);
                          const schedule = await api.createSection({
                            courseId: selectedCourseForSchedule,
                            sectionName: sectionName.trim(),
                            meetings: selectedMeetingDays.map((day) => ({
                              day,
                              time: meetingTime,
                              endTime: meetingEndTime,
                              room: toNullable(meetingRoom)
                            }))
                          });
                          setState((previous) => ({ ...previous, schedule }));
                          setSectionName('');
                          setMeetingTime('');
                          setMeetingEndTime('');
                          setMeetingRoom('');
                          setIsAddGroupOpen(false);
                          window.localStorage.removeItem(addPeriodDraftStorageKey);
                          setError(null);
                        } catch (err) {
                          setError(
                            err instanceof ApiError ? err.message : 'Failed to create section'
                          );
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Create class group
                    </button>
                  </>
                ) : (
                  <p className="muted">
                    Your groups stay organized beneath their course. Open this form only when you
                    need another one.
                  </p>
                )}
              </article>

              <article className="card stack">
                <h3>Current class groups</h3>
                <div className="section-roster single-column">
                  {orderedSections.length ? (
                    orderedSections.map((section, sectionIndex) => {
                      const resume = state.resumesBySectionId[section.sectionId];
                      const resumeLessonId = resume?.lesson?.id;
                      const isEditing = editingSectionId === section.sectionId;
                      const draft = sectionEditDrafts[section.sectionId] ?? sectionToDraft(section);
                      const isFirstForCourse =
                        sectionIndex === 0 ||
                        orderedSections[sectionIndex - 1]?.courseId !== section.courseId;
                      return (
                        <div key={section.sectionId} className="course-group-container">
                          {isFirstForCourse ? (
                            <div className="course-group-heading">
                              <strong>{section.courseName}</strong>
                              <span>Shared curriculum</span>
                            </div>
                          ) : null}
                          <details
                            className="section-roster-card compact-group-card"
                            open={isEditing}
                          >
                            <summary>
                              <span>
                                <strong>{section.courseName}</strong>
                                <span>{section.sectionName}</span>
                              </span>
                              <span>
                                {section.meetings.length
                                  ? formatMeeting(section)
                                  : 'Meeting time needed'}
                              </span>
                            </summary>
                            <div className="compact-group-card-content">
                              {isEditing ? (
                                <div className="section-inline-edit">
                                  <label>
                                    Class group / period
                                    <input
                                      className="input"
                                      value={draft.sectionName}
                                      onChange={(event) =>
                                        updateSectionDraft(section.sectionId, {
                                          sectionName: event.target.value
                                        })
                                      }
                                    />
                                  </label>
                                  <label>
                                    Course
                                    <select
                                      className="input"
                                      value={draft.courseId}
                                      disabled
                                      onChange={(event) =>
                                        updateSectionDraft(section.sectionId, {
                                          courseId: event.target.value
                                        })
                                      }
                                    >
                                      {state.courses.map((course) => (
                                        <option key={course.id} value={course.id}>
                                          {course.name}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <MeetingDayPicker
                                    value={draft.days}
                                    onChange={(days) =>
                                      updateSectionDraft(section.sectionId, { days })
                                    }
                                  />
                                  <div className="meeting-time-fields">
                                    <label>
                                      Start time
                                      <input
                                        className="input"
                                        type="time"
                                        value={draft.time}
                                        onChange={(event) =>
                                          updateSectionDraft(section.sectionId, {
                                            time: event.target.value
                                          })
                                        }
                                      />
                                    </label>
                                    <label>
                                      End time
                                      <input
                                        className="input"
                                        type="time"
                                        value={draft.endTime}
                                        onChange={(event) =>
                                          updateSectionDraft(section.sectionId, {
                                            endTime: event.target.value
                                          })
                                        }
                                      />
                                    </label>
                                  </div>
                                  <label>
                                    Room
                                    <input
                                      className="input"
                                      value={draft.room}
                                      onChange={(event) =>
                                        updateSectionDraft(section.sectionId, {
                                          room: event.target.value
                                        })
                                      }
                                    />
                                  </label>
                                  <p className="muted">
                                    Course changes are kept separate for now so progress history
                                    stays safe.
                                  </p>
                                </div>
                              ) : (
                                <>
                                  <div>
                                    <strong>{section.sectionName}</strong>
                                    <span>Course: {section.courseName}</span>
                                  </div>
                                  <p>
                                    Meeting times:{' '}
                                    {section.meetings.length
                                      ? formatMeeting(section)
                                      : 'Not set yet'}
                                  </p>
                                  <p>Current: {resume?.lesson?.title ?? 'No lesson started'}</p>
                                  <p>
                                    Stopped at:{' '}
                                    {resume?.state?.carryOverNote ??
                                      resume?.lastNote?.content ??
                                      'None'}
                                  </p>
                                  <p>
                                    Status:{' '}
                                    {sectionPercent(resume) >= 100
                                      ? 'Ahead'
                                      : sectionPercent(resume) > 0
                                        ? 'On pace'
                                        : 'Not started'}
                                  </p>
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
                                    <button
                                      className="secondary"
                                      type="button"
                                      onClick={() => setEditingSectionId(null)}
                                    >
                                      Cancel
                                    </button>
                                  </>
                                ) : resumeLessonId ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      navigate(
                                        `/sections/${section.sectionId}/lessons/${resumeLessonId}`
                                      );
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
                            </div>
                          </details>
                        </div>
                      );
                    })
                  ) : (
                    <p className="muted">No class groups yet.</p>
                  )}
                </div>
              </article>
            </div>
          )}
        </section>
      ) : null}

      {activeTab === 'periods' || activeTab === 'weekly' ? (
        <section className="management-panel stack">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Meeting times</p>
              <h2>Review the week</h2>
              <p className="muted">
                Adjust a group’s days, start time, end time, or room without leaving this page.
              </p>
            </div>
            <div className="profile-actions">
              <button
                className="secondary"
                type="button"
                onClick={() => void copyWeeklyScheduleSummary()}
              >
                Copy meeting times
              </button>
            </div>
          </div>

          <article className="schedule-gap-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Schedule confirmation</p>
                <h3>{scheduleConfirmed ? 'Meeting times confirmed' : 'Confirm your schedule'}</h3>
                <p className="muted">
                  {scheduleConfirmed
                    ? 'Your current course, class group, and meeting-time setup is confirmed.'
                    : hasMeetingGaps
                      ? 'Add the missing meeting times before confirming this schedule.'
                      : 'Check that every course, class group, day, start time, end time, and room is correct.'}
                </p>
              </div>
              <button
                type="button"
                disabled={!scheduleSignature || hasMeetingGaps || scheduleConfirmed}
                onClick={() => {
                  window.localStorage.setItem(scheduleConfirmationStorageKey, scheduleSignature);
                  setConfirmedScheduleSignature(scheduleSignature);
                  flashCopyStatus('Schedule confirmed.');
                }}
              >
                {scheduleConfirmed ? 'Confirmed' : 'Confirm schedule'}
              </button>
            </div>
            {sections.length ? (
              <p className="muted">
                {sections.length} {sections.length === 1 ? 'class group' : 'class groups'} across{' '}
                {state.courses.length} {state.courses.length === 1 ? 'course' : 'courses'}.
              </p>
            ) : null}
          </article>

          <section className="management-editor-grid meeting-times-editor">
            {sections.map((section) => {
              const draft = sectionEditDrafts[section.sectionId] ?? sectionToDraft(section);
              return (
                <article key={section.sectionId} className="card stack">
                  <div>
                    <p className="eyebrow">{section.courseName} curriculum</p>
                    <h3>{section.sectionName}</h3>
                    <p className="muted">Set the meeting times for this class group or period.</p>
                  </div>
                  <div className="section-inline-edit">
                    <MeetingDayPicker
                      value={draft.days}
                      onChange={(days) => updateSectionDraft(section.sectionId, { days })}
                    />
                    <div className="meeting-time-fields">
                      <label>
                        Start time
                        <input
                          className="input"
                          type="time"
                          value={draft.time}
                          onChange={(event) =>
                            updateSectionDraft(section.sectionId, { time: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        End time
                        <input
                          className="input"
                          type="time"
                          value={draft.endTime}
                          onChange={(event) =>
                            updateSectionDraft(section.sectionId, { endTime: event.target.value })
                          }
                        />
                      </label>
                    </div>
                    <label>
                      Room
                      <input
                        className="input"
                        value={draft.room}
                        onChange={(event) =>
                          updateSectionDraft(section.sectionId, { room: event.target.value })
                        }
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    disabled={busy || !draft.days.trim()}
                    onClick={() => void saveSectionEdit(section.sectionId)}
                  >
                    Save meeting times
                  </button>
                </article>
              );
            })}
          </section>

          {hasMeetingGaps ? (
            <article className="schedule-gap-panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Needs setup</p>
                  <h3>
                    {scheduleGapItems.length} schedule{' '}
                    {scheduleGapItems.length === 1 ? 'gap' : 'gaps'}
                  </h3>
                </div>
                <button className="secondary" type="button" onClick={() => setActiveTab('periods')}>
                  Fix class details
                </button>
              </div>
              <div className="schedule-gap-list">
                {scheduleGapItems.map((gap) => (
                  <button
                    key={gap.id}
                    type="button"
                    className="schedule-gap-row"
                    onClick={() => {
                      setSelectedCourseId(gap.section.courseId);
                      setSelectedSectionId(gap.section.sectionId);
                      setActiveTab('periods');
                    }}
                  >
                    <strong>{gap.title}</strong>
                    <span>{gap.detail}</span>
                  </button>
                ))}
              </div>
            </article>
          ) : null}

          <div className="weekly-schedule-grid">
            {weeklySchedule.map(({ day, sections: daySections }) => (
              <article key={day} className="weekly-day-card">
                <div className="section-heading">
                  <h3>{day}</h3>
                  <span className="status-pill upcoming">{daySections.length} classes</span>
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
                        <strong>{formatTimeRange(meeting?.time, meeting?.endTime)}</strong>
                        <span>{section.sectionName}</span>
                        <small>
                          {section.courseName} / {meeting?.room ?? 'Room missing'}
                        </small>
                      </button>
                    );
                  })
                ) : (
                  <p className="muted">No classes on this day.</p>
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
                <button
                  className="secondary"
                  type="button"
                  disabled={!selectedCourse}
                  onClick={() => void copyYearPlanSummary()}
                >
                  Copy summary
                </button>
                <div className="management-tabs small-tabs" aria-label="Year plan view">
                  <button
                    className={selectedYearPlanView === 'outline' ? 'active' : ''}
                    type="button"
                    disabled={!selectedCourse}
                    onClick={() => {
                      if (!selectedCourse) return;
                      setYearPlanViewByCourseId((previous) => ({
                        ...previous,
                        [selectedCourse.id]: 'outline'
                      }));
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
                      setYearPlanViewByCourseId((previous) => ({
                        ...previous,
                        [selectedCourse.id]: 'timeline'
                      }));
                    }}
                  >
                    Timeline
                  </button>
                </div>
              </div>
            </div>

            {state.courseDetails.length ? (
              <select
                className="input"
                value={selectedCourse?.id ?? ''}
                onChange={(event) => selectCourse(event.target.value)}
              >
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
                          className={
                            selectedSection?.sectionId === section.sectionId ? 'selected' : ''
                          }
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
                  <p className="muted">
                    Templates create real units, lessons, and segments. You can edit everything
                    after it lands.
                  </p>
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
                  <button
                    type="button"
                    disabled={busy || !selectedCourse}
                    onClick={() => void applyYearPlanTemplate()}
                  >
                    Add starter plan
                  </button>
                </div>
                <div className="template-preview-list">
                  {(
                    yearPlanTemplates.find((template) => template.id === selectedTemplateId) ??
                    yearPlanTemplates[0]
                  )?.units.map((unit) => (
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
                  <input
                    className="input"
                    value={unitTitle}
                    onChange={(event) => setUnitTitle(event.target.value)}
                    placeholder="Unit title"
                  />
                  <input
                    className="input"
                    value={unitDescription}
                    onChange={(event) => setUnitDescription(event.target.value)}
                    placeholder="Unit description"
                  />
                  <input
                    className="input"
                    value={unitOrder}
                    onChange={(event) => setUnitOrder(event.target.value)}
                    placeholder="Order"
                  />
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
                      const lessonDraft = lessonDrafts[unit.id] ?? {
                        title: '',
                        description: '',
                        duration: ''
                      };
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
                                  <button
                                    type="button"
                                    disabled={busy || !unitDraft.title.trim()}
                                    onClick={() => void saveUnitEdit(unit.id)}
                                  >
                                    Save unit
                                  </button>
                                  <button
                                    className="secondary"
                                    type="button"
                                    onClick={() => setEditingUnitId(null)}
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    className="secondary"
                                    type="button"
                                    onClick={() => beginUnitEdit(unit)}
                                  >
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
                                      estimatedDurationMinutes: parseNullablePositiveInt(
                                        lessonDraft.duration
                                      ),
                                      orderIndex: undefined
                                    })
                                  );
                                  setLessonDrafts((previous) => ({
                                    ...previous,
                                    [unit.id]: { title: '', description: '', duration: '' }
                                  }));
                                  setError(null);
                                } catch (err) {
                                  setError(
                                    err instanceof ApiError ? err.message : 'Failed to add lesson'
                                  );
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
                              const segmentDraft = segmentDrafts[lesson.id] ?? {
                                title: '',
                                description: '',
                                duration: ''
                              };
                              const isLessonEditing = editingLessonId === lesson.id;
                              const lessonEditDraft =
                                lessonEditDrafts[lesson.id] ?? lessonToDraft(lesson);
                              const lessonCompleteForSelected =
                                selectedSection &&
                                state.resumesBySectionId[selectedSection.sectionId]?.lesson?.id ===
                                  lesson.id
                                  ? sectionPercent(
                                      state.resumesBySectionId[selectedSection.sectionId]
                                    )
                                  : selectedCourseLessonIds.indexOf(lesson.id) <
                                      selectedCourseLessonIds.length / 3
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
                                                [lesson.id]: {
                                                  ...lessonEditDraft,
                                                  title: event.target.value
                                                }
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
                                                [lesson.id]: {
                                                  ...lessonEditDraft,
                                                  duration: event.target.value
                                                }
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
                                                [lesson.id]: {
                                                  ...lessonEditDraft,
                                                  order: event.target.value
                                                }
                                              }))
                                            }
                                            placeholder="Order"
                                          />
                                        </div>
                                      ) : (
                                        <strong>{lesson.title}</strong>
                                      )}
                                      <p className="muted">
                                        {unit.title} | {lesson.estimatedDurationMinutes ?? 'TBD'}{' '}
                                        min |{' '}
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
                                        <button
                                          className="secondary"
                                          type="button"
                                          onClick={() => setEditingLessonId(null)}
                                        >
                                          Cancel
                                        </button>
                                      </>
                                    ) : (
                                      <>
                                        <button
                                          className="secondary"
                                          type="button"
                                          onClick={() => beginLessonEdit(lesson)}
                                        >
                                          Edit lesson
                                        </button>
                                        <button
                                          className="secondary danger"
                                          type="button"
                                          disabled={busy}
                                          onClick={() =>
                                            void removeYearPlanItem('lesson', lesson.id)
                                          }
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
                                      return (
                                        <span key={section.sectionId}>
                                          {section.sectionName}: {active ? 'here' : 'planned'}
                                        </span>
                                      );
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
                                            [lesson.id]: {
                                              ...segmentDraft,
                                              title: event.target.value
                                            }
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
                                            [lesson.id]: {
                                              ...segmentDraft,
                                              duration: event.target.value
                                            }
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
                                                durationMinutes: parseNullablePositiveInt(
                                                  segmentDraft.duration
                                                ),
                                                orderIndex: undefined
                                              })
                                            );
                                            setSegmentDrafts((previous) => ({
                                              ...previous,
                                              [lesson.id]: {
                                                title: '',
                                                description: '',
                                                duration: ''
                                              }
                                            }));
                                            setError(null);
                                          } catch (err) {
                                            setError(
                                              err instanceof ApiError
                                                ? err.message
                                                : 'Failed to add segment'
                                            );
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
                                          selectedSection &&
                                          state.resumesBySectionId[selectedSection.sectionId]
                                            ?.lesson?.id === lesson.id
                                            ? state.resumesBySectionId[selectedSection.sectionId]
                                            : undefined;
                                        const status = segmentStatusLabel(resume, segment.id);
                                        const isSegmentEditing = editingSegmentId === segment.id;
                                        const segmentEditDraft =
                                          segmentEditDrafts[segment.id] ?? segmentToDraft(segment);
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
                                                      [segment.id]: {
                                                        ...segmentEditDraft,
                                                        title: event.target.value
                                                      }
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
                                                      [segment.id]: {
                                                        ...segmentEditDraft,
                                                        duration: event.target.value
                                                      }
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
                                                      [segment.id]: {
                                                        ...segmentEditDraft,
                                                        order: event.target.value
                                                      }
                                                    }))
                                                  }
                                                  placeholder="Order"
                                                />
                                              </div>
                                            ) : (
                                              <>
                                                <span>{segment.title}</span>
                                                <span>
                                                  {segment.durationMinutes
                                                    ? `${segment.durationMinutes} min`
                                                    : 'No time'}
                                                </span>
                                                <span
                                                  className={`segment-status ${status.toLowerCase().replaceAll(' ', '-')}`}
                                                >
                                                  {status}
                                                </span>
                                              </>
                                            )}
                                            <span className="segment-actions">
                                              {isSegmentEditing ? (
                                                <>
                                                  <button
                                                    type="button"
                                                    disabled={
                                                      busy || !segmentEditDraft.title.trim()
                                                    }
                                                    onClick={() => void saveSegmentEdit(segment.id)}
                                                  >
                                                    Save
                                                  </button>
                                                  <button
                                                    className="secondary"
                                                    type="button"
                                                    onClick={() => setEditingSegmentId(null)}
                                                  >
                                                    Cancel
                                                  </button>
                                                </>
                                              ) : (
                                                <>
                                                  <button
                                                    className="secondary"
                                                    type="button"
                                                    onClick={() => beginSegmentEdit(segment)}
                                                  >
                                                    Edit
                                                  </button>
                                                  <button
                                                    className="secondary danger"
                                                    type="button"
                                                    disabled={busy}
                                                    onClick={() =>
                                                      void removeYearPlanItem('segment', segment.id)
                                                    }
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
                    <p className="muted">
                      No units yet. Add the first unit to start the year plan.
                    </p>
                  )}
                </div>
              </div>
            </article>
          ) : null}

          {selectedCourse && !schoolYearSettings ? (
            <section className="curriculum-setup-callout">
              <span>Add your school dates first.</span>
              <button className="secondary" type="button" onClick={() => navigate('/school')}>
                Add Dates
              </button>
            </section>
          ) : null}
          {selectedCourse && selectedYearPlanView === 'timeline' && schoolYearSettings ? (
            <CurriculumTimeline
              course={selectedCourse}
              selectedSection={selectedSection}
              holidays={(state.schedule?.holidays ?? []).map((holiday) => holiday.date)}
              schoolYearSettings={schoolYearSettings}
              currentLessonId={
                selectedSection
                  ? (state.resumesBySectionId[selectedSection.sectionId]?.lesson?.id ?? null)
                  : null
              }
              onCourseChange={updateFromDetail}
              onOpenSchool={() => navigate('/school')}
            />
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
            <button className="secondary" type="button" onClick={() => void copyProgressSummary()}>
              Copy progress
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
                                <small>{resumeStopLabel(resume)}</small>
                                <small>
                                  Last taught: {resume?.state?.lastTaughtDate ?? 'Not saved yet'}
                                </small>
                              </div>
                              <progress max={100} value={percent} />
                              <span
                                className={
                                  status === 'Missing lesson'
                                    ? 'status-pill needs-work'
                                    : 'status-pill upcoming'
                                }
                              >
                                {status}
                              </span>
                              {resume?.lesson ? (
                                <button
                                  className="secondary"
                                  type="button"
                                  onClick={() => {
                                    navigate(
                                      `/sections/${section.sectionId}/lessons/${resume.lesson?.id}`
                                    );
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

      {editingCourse && editingCourseDraft ? (
        <div className="course-edit-overlay" role="presentation">
          <section
            ref={courseEditorRef}
            className="course-edit-workspace"
            role="dialog"
            aria-modal="true"
            aria-labelledby="course-edit-title"
            tabIndex={-1}
          >
            <header className="course-edit-topbar">
              <div>
                <p className="eyebrow">Editing Course</p>
                <h2 id="course-edit-title">{editingCourse.name}</h2>
                <p className="muted">
                  Edit shared curriculum, then review each nested Class Group and its meeting times
                  without compressing the rest of your Courses.
                </p>
              </div>
              <button
                className="secondary"
                type="button"
                disabled={busy}
                onClick={() => {
                  setEditingCourseId(null);
                  setEditingSectionId(null);
                  setCourseEditorNotice(null);
                }}
              >
                Done editing
              </button>
            </header>

            <div className="course-edit-scroll">
              <div className="course-edit-content stack">
                <section className="course-edit-intro" aria-label="Course hierarchy">
                  <div>
                    <p className="eyebrow">Course → Class Groups → meeting times</p>
                    <h3>One shared curriculum, separate teaching groups</h3>
                    <p className="muted">
                      Units and Lessons belong to this Course. Each Class Group below keeps its own
                      schedule, progress, and classroom history.
                    </p>
                  </div>
                  <span className="course-edit-status">Focused editing</span>
                </section>

                {courseEditorNotice ? (
                  <p className="course-edit-notice" role="status">
                    {courseEditorNotice}
                  </p>
                ) : null}

                <section
                  className="course-edit-card stack"
                  aria-labelledby="course-edit-details-heading"
                >
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">Shared curriculum</p>
                      <h3 id="course-edit-details-heading">Course details</h3>
                    </div>
                    <span className="status-pill upcoming">
                      {courseDepth(editingCourse).units} units
                    </span>
                  </div>
                  <div className="course-edit-fields">
                    <label>
                      Course name
                      <input
                        className="input"
                        value={editingCourseDraft.name}
                        onChange={(event) =>
                          updateCourseDraft(editingCourse.id, { name: event.target.value })
                        }
                        placeholder="Course name"
                      />
                    </label>
                    <label>
                      Subject
                      <input
                        className="input"
                        value={editingCourseDraft.subject}
                        onChange={(event) =>
                          updateCourseDraft(editingCourse.id, { subject: event.target.value })
                        }
                        placeholder="Optional"
                      />
                    </label>
                    <label>
                      Grade level
                      <input
                        className="input"
                        value={editingCourseDraft.gradeLevel}
                        onChange={(event) =>
                          updateCourseDraft(editingCourse.id, { gradeLevel: event.target.value })
                        }
                        placeholder="Optional"
                      />
                    </label>
                  </div>
                  <div className="profile-actions">
                    <button
                      type="button"
                      disabled={busy || !editingCourseDraft.name.trim()}
                      onClick={() => void saveCourseEdit(editingCourse.id)}
                    >
                      {busy ? 'Saving…' : 'Save Course details'}
                    </button>
                    <button
                      className="secondary danger"
                      type="button"
                      disabled={busy}
                      onClick={() => requestCourseDeletion(editingCourse)}
                    >
                      Delete course
                    </button>
                  </div>
                </section>

                <section
                  className="course-edit-card stack"
                  aria-labelledby="course-edit-groups-heading"
                >
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">Nested teaching groups</p>
                      <h3 id="course-edit-groups-heading">Class Groups & meeting times</h3>
                      <p className="muted">
                        Each card is a separate group sharing this Course curriculum. Meeting days
                        are shown as boxes so every schedule is readable at a glance.
                      </p>
                    </div>
                    <button
                      className="secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setSelectedCourseId(editingCourse.id);
                        setSelectedCourseForSchedule(editingCourse.id);
                        setEditingCourseId(null);
                        setActiveTab('periods');
                      }}
                    >
                      Add Class Group
                    </button>
                  </div>

                  {courseSections(editingCourse, sections).length ? (
                    <div className="course-edit-group-grid">
                      {courseSections(editingCourse, sections).map((section) => (
                        <article className="course-edit-group-card" key={section.sectionId}>
                          <div className="section-heading">
                            <div>
                              <p className="eyebrow">Class Group</p>
                              <h4>{section.sectionName}</h4>
                            </div>
                            <span className="status-pill upcoming">
                              {section.meetings.length}{' '}
                              {section.meetings.length === 1
                                ? 'meeting pattern'
                                : 'meeting patterns'}
                            </span>
                          </div>
                          <div
                            className="course-edit-meeting-list"
                            aria-label={`${section.sectionName} meeting times`}
                          >
                            {section.meetings.length ? (
                              section.meetings.map((meeting) => (
                                <div
                                  className="course-edit-meeting-row"
                                  key={`${meeting.day}-${meeting.time ?? 'time'}-${meeting.room ?? 'room'}`}
                                >
                                  <span className="course-edit-day">{meeting.day}</span>
                                  <strong>{formatTimeRange(meeting.time, meeting.endTime)}</strong>
                                  <span>{meeting.room ?? 'Room not set'}</span>
                                </div>
                              ))
                            ) : (
                              <p className="muted">No meeting times set yet.</p>
                            )}
                          </div>
                          <div className="profile-actions">
                            <button
                              className="secondary"
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setSelectedCourseId(editingCourse.id);
                                setSelectedSectionId(section.sectionId);
                                beginSectionEdit(section);
                                setEditingCourseId(null);
                                setActiveTab('periods');
                              }}
                            >
                              Edit Class Group
                            </button>
                            <button
                              className="secondary"
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setSelectedCourseId(editingCourse.id);
                                setSelectedSectionId(section.sectionId);
                                beginSectionEdit(section);
                                setEditingCourseId(null);
                                setActiveTab('weekly');
                              }}
                            >
                              Edit meeting times
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="course-edit-empty">
                      <strong>No Class Groups yet.</strong>
                      <span className="muted">
                        Add a Class Group to give this shared Course its own meetings and progress.
                      </span>
                    </div>
                  )}
                </section>

                <section className="course-edit-card course-edit-next-step">
                  <div>
                    <p className="eyebrow">Next</p>
                    <h3>Build the shared Year Plan</h3>
                    <p className="muted">
                      Units and Lessons are edited once for this Course, then each Class Group
                      follows its own pace.
                    </p>
                  </div>
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setSelectedCourseId(editingCourse.id);
                      setEditingCourseId(null);
                      setActiveTab('curriculum');
                    }}
                  >
                    Open Year Plan
                  </button>
                </section>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {pendingCourseDeletion ? (
        <div className="confirmation-dialog-backdrop" role="presentation">
          <section
            className="confirmation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-course-title"
            aria-describedby="delete-course-description"
          >
            <p className="eyebrow">Permanent action</p>
            <h2 id="delete-course-title">Delete {pendingCourseDeletion.course.name}?</h2>
            <p id="delete-course-description">
              This permanently removes the course, its curriculum, lessons, class groups, and
              meeting times. This cannot be undone.
            </p>
            <label htmlFor="delete-course-confirmation">
              Type <strong>DELETE COURSE</strong> to continue
            </label>
            <input
              id="delete-course-confirmation"
              className="input"
              autoFocus
              value={pendingCourseDeletion.confirmationText}
              onChange={(event) =>
                setPendingCourseDeletion((current) =>
                  current ? { ...current, confirmationText: event.target.value } : current
                )
              }
              placeholder="DELETE COURSE"
            />
            <div className="profile-actions">
              <button
                className="secondary"
                type="button"
                disabled={busy}
                onClick={() => setPendingCourseDeletion(null)}
              >
                Cancel
              </button>
              <button
                className="danger-button"
                type="button"
                disabled={
                  busy ||
                  pendingCourseDeletion.confirmationText.trim().toUpperCase() !== 'DELETE COURSE'
                }
                onClick={() => void deleteCourse()}
              >
                {busy ? 'Deleting…' : 'Permanently delete course'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
