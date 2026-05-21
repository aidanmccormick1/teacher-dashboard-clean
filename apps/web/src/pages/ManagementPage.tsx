import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  AiJobStatusResponse,
  ClassroomResumeResponse,
  CourseDetailResponse,
  CourseListResponse,
  GetScheduleResponse,
  ParseScheduleResponse
} from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';

type ManagementTab = 'courses' | 'schedule' | 'curriculum';
type YearPlanView = 'outline' | 'timeline';
type CourseDetail = CourseDetailResponse['course'];
type CourseSummary = CourseListResponse['courses'][number];
type ScheduleSection = GetScheduleResponse['sections'][number];
type ParsedScheduleClass = ParseScheduleResponse['classes'][number];
type LessonDraft = { title: string; description: string; duration: string };
type SegmentDraft = { title: string; description: string; duration: string };

type ManagementState = {
  courses: CourseSummary[];
  courseDetails: CourseDetail[];
  schedule: GetScheduleResponse | null;
  resumesBySectionId: Record<string, ClassroomResumeResponse>;
};

const tabs: Array<{ id: ManagementTab; label: string }> = [
  { id: 'courses', label: 'Courses' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'curriculum', label: 'Year Plan' }
];

const meetingDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'A-Day', 'B-Day'] as const;

function isTerminalStatus(status: AiJobStatusResponse['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
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
  return sections.filter((section) => section.courseName === course.name);
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
      tab: 'schedule' as ManagementTab
    };
  }
  if (!hasMeetingTimes) {
    return {
      id: 'add-times',
      title: 'Add meeting days and times',
      body: 'Schedule data lets the app know what class is current and what comes next.',
      tab: 'schedule' as ManagementTab
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
  const [activeTab, setActiveTab] = useState<ManagementTab>('courses');
  const [state, setState] = useState<ManagementState>({
    courses: [],
    courseDetails: [],
    schedule: null,
    resumesBySectionId: {}
  });
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [yearPlanViewByCourseId, setYearPlanViewByCourseId] = useState<Record<string, YearPlanView>>({});
  const [dismissedPromptIds, setDismissedPromptIds] = useState<string[]>([]);
  const [isNewCourseOpen, setIsNewCourseOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newCourseName, setNewCourseName] = useState('');
  const [newCourseSubject, setNewCourseSubject] = useState('');
  const [newCourseGrade, setNewCourseGrade] = useState('');
  const [newCoursePeriods, setNewCoursePeriods] = useState('');
  const [quickCourseName, setQuickCourseName] = useState('');
  const [quickCourseSubject, setQuickCourseSubject] = useState('');

  const [selectedCourseForSchedule, setSelectedCourseForSchedule] = useState('');
  const [sectionName, setSectionName] = useState('');
  const [meetingDay, setMeetingDay] = useState<(typeof meetingDays)[number]>('Monday');
  const [meetingTime, setMeetingTime] = useState('');
  const [meetingRoom, setMeetingRoom] = useState('');
  const [scheduleImportText, setScheduleImportText] = useState('');
  const [scheduleImportFileName, setScheduleImportFileName] = useState('');
  const [scheduleImportFileMimeType, setScheduleImportFileMimeType] = useState('');
  const [scheduleImportFileDataUrl, setScheduleImportFileDataUrl] = useState('');
  const [scheduleImportJobId, setScheduleImportJobId] = useState<string | null>(null);
  const [scheduleImportJob, setScheduleImportJob] = useState<AiJobStatusResponse | null>(null);
  const [scheduleImportOutput, setScheduleImportOutput] = useState<ParseScheduleResponse | null>(null);
  const [addedParsedClassKeys, setAddedParsedClassKeys] = useState<string[]>([]);

  const [unitTitle, setUnitTitle] = useState('');
  const [unitDescription, setUnitDescription] = useState('');
  const [unitOrder, setUnitOrder] = useState('');
  const [lessonDrafts, setLessonDrafts] = useState<Record<string, LessonDraft>>({});
  const [segmentDrafts, setSegmentDrafts] = useState<Record<string, SegmentDraft>>({});

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
  }, [loadManagement]);

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
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to read schedule upload status');
        }
      }
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 1200);

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

  const selectCourse = (courseId: string, nextTab?: ManagementTab) => {
    setSelectedCourseId(courseId);
    setSelectedCourseForSchedule(courseId);
    if (nextTab) setActiveTab(nextTab);
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
      const parsed = await api.importSchedule({
        text: scheduleImportText.trim() || undefined,
        fileBase64: scheduleImportFileDataUrl || undefined,
        fileName: scheduleImportFileName || undefined,
        fileMimeType: scheduleImportFileMimeType || undefined
      });
      setScheduleImportOutput(parsed);
      setAddedParsedClassKeys([]);
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

      {error ? <p className="notice warning">{error}</p> : null}
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
              <h3>Create course</h3>
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
                      await createCourse(newCourseName, newCourseSubject, newCourseGrade);
                      setNewCourseName('');
                      setNewCourseSubject('');
                      setNewCourseGrade('');
                      setNewCoursePeriods('');
                      setIsNewCourseOpen(false);
                      setActiveTab('schedule');
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
                return (
                  <article key={course.id} className={isSelected ? 'course-summary-card selected' : 'course-summary-card'}>
                    <div className="section-heading">
                      <div>
                        <p className="eyebrow">{course.subject ?? course.gradeLevel ?? 'Course'}</p>
                        <h3>{course.name}</h3>
                      </div>
                      <span className="status-pill upcoming">{isSelected ? 'Selected' : 'Course'}</span>
                    </div>
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
                      <button className="secondary" type="button" onClick={() => selectCourse(course.id, 'schedule')}>
                        Add Period
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const nextName = window.prompt('Course name', course.name);
                          if (nextName === null || !nextName.trim()) return;
                          const nextSubject = window.prompt('Subject', course.subject ?? '');
                          const nextGrade = window.prompt('Grade level', course.gradeLevel ?? '');
                          try {
                            setBusy(true);
                            updateFromDetail(
                              await api.updateCourse(course.id, {
                                name: nextName.trim(),
                                subject: toNullable(nextSubject ?? ''),
                                gradeLevel: toNullable(nextGrade ?? '')
                              })
                            );
                            setError(null);
                          } catch (err) {
                            setError(err instanceof ApiError ? err.message : 'Failed to update course');
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Edit Course
                      </button>
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

      {activeTab === 'schedule' ? (
        <section className="management-panel stack">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Schedule</p>
              <h2>When do my periods meet?</h2>
              <p className="muted">Class periods share the same course plan, but each period tracks progress separately.</p>
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
              <button type="button" disabled={busy || (!scheduleImportText.trim() && !scheduleImportFileDataUrl)} onClick={startScheduleUpload}>
                {busy ? 'Reading...' : 'Read schedule'}
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

            {scheduleImportOutput ? (
              <div className="parsed-schedule-review">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Review before saving</p>
                    <h3>{scheduleImportOutput.classes.length} classes found</h3>
                  </div>
                </div>
                <div className="parsed-class-list">
                  {scheduleImportOutput.classes.map((parsedClass) => {
                    const key = parsedClassKey(parsedClass);
                    const matchingCourse = findCourseForParsedClass(parsedClass);
                    const isAdded = addedParsedClassKeys.includes(key);
                    return (
                      <article key={key} className="parsed-class-card">
                        <div>
                          <strong>{parsedClass.period}</strong>
                          <span>{parsedClass.name}</span>
                        </div>
                        <p>
                          {parsedClass.days.join(', ')} at {parsedClass.time ?? 'TBD'}
                          {parsedClass.room ? `, ${parsedClass.room}` : ''}
                        </p>
                        <p className="muted">
                          {matchingCourse
                            ? `Will attach to ${matchingCourse.name}.`
                            : `Will create ${parsedClass.name} first.`}
                        </p>
                        <button
                          type="button"
                          disabled={busy || isAdded}
                          onClick={() => void addParsedClassToSchedule(parsedClass)}
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
                <h3>Add class period</h3>
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
                <div className="inline-editor">
                  <select
                    className="input"
                    value={meetingDay}
                    onChange={(event) => setMeetingDay(event.target.value as (typeof meetingDays)[number])}
                  >
                    {meetingDays.map((day) => (
                      <option key={day} value={day}>
                        {day}
                      </option>
                    ))}
                  </select>
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
                        meetings: [{ day: meetingDay, time: meetingTime || null, room: meetingRoom.trim() || null }]
                      });
                      setState((previous) => ({ ...previous, schedule }));
                      setSectionName('');
                      setMeetingTime('');
                      setMeetingRoom('');
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
                      return (
                        <article key={section.sectionId} className="section-roster-card">
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
                          <div className="profile-actions">
                            <button
                              className="secondary"
                              type="button"
                              onClick={() => {
                                setSelectedCourseId(state.courseDetails.find((course) => course.name === section.courseName)?.id ?? selectedCourseId);
                                setSelectedSectionId(section.sectionId);
                                setActiveTab('curriculum');
                              }}
                            >
                              View in Year Plan
                            </button>
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

      {activeTab === 'curriculum' ? (
        <section className="management-panel stack">
          <div className="year-plan-header card stack">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Year Plan</p>
                <h2>{selectedCourse ? `${selectedCourse.name} Year Plan` : 'Select a course'}</h2>
              </div>
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
                      return (
                        <section key={unit.id} className="unit-editor-card">
                          <div className="section-heading">
                            <div>
                              <p className="eyebrow">Unit {unit.orderIndex}</p>
                              <h3>{unit.title}</h3>
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
                                      <strong>{lesson.title}</strong>
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
                                      {lesson.segments.map((segment) => (
                                        <div key={segment.id}>
                                          <span>{segment.title}</span>
                                          <span>{segment.durationMinutes ? `${segment.durationMinutes} min` : 'No time'}</span>
                                        </div>
                                      ))}
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
              </div>
              <p className="notice warning">Add school-year dates to unlock exact pacing. Showing unit timeline for now.</p>
              <div className="year-timeline">
                <div className="today-marker">Today</div>
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
    </div>
  );
}
