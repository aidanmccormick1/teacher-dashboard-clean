import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ParseScheduleResponseSchema } from '@teacheros/contracts';
import type {
  CourseDetailResponse,
  CourseInvitationsResponse,
  GetScheduleResponse,
  ScheduleImportResponse
} from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';
import { groupImportedSchedule, normalizeImportedCourseVariants } from '../lib/scheduleImport.js';
import { timeRange } from '../lib/today.js';

type Course = CourseDetailResponse['course'];

function waitForScheduleJob(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsDataURL(file);
  });
}

const supportedScheduleImageTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif'
]);

function isHeicScheduleFile(file: File): boolean {
  return /image\/hei[cf](?:-sequence)?/i.test(file.type) || /\.(?:heic|heif)$/i.test(file.name);
}

async function convertHeicScheduleFile(file: File): Promise<File> {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const maxPixels = 10_000_000;
    const scale = Math.min(1, Math.sqrt(maxPixels / (bitmap.width * bitmap.height)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const jpeg = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('JPEG conversion failed.'))),
        'image/jpeg',
        0.92
      )
    );
    const jpegName = `${file.name.replace(/\.(?:heic|heif)$/i, '')}.jpg`;
    return new File([jpeg], jpegName, { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    throw new Error(
      'This browser could not convert the HEIC photo. Use a screenshot, JPEG, PNG, WebP, or PDF instead.'
    );
  } finally {
    bitmap?.close();
  }
}

async function prepareScheduleFile(file: File) {
  const preparedFile = isHeicScheduleFile(file) ? await convertHeicScheduleFile(file) : file;
  const isPdf =
    preparedFile.type === 'application/pdf' || preparedFile.name.toLowerCase().endsWith('.pdf');
  const imageType = supportedScheduleImageTypes.has(preparedFile.type.toLowerCase())
    ? preparedFile.type.toLowerCase() === 'image/jpg'
      ? 'image/jpeg'
      : preparedFile.type.toLowerCase()
    : preparedFile.name.toLowerCase().endsWith('.png')
      ? 'image/png'
      : /\.jpe?g$/i.test(preparedFile.name)
        ? 'image/jpeg'
        : preparedFile.name.toLowerCase().endsWith('.webp')
          ? 'image/webp'
          : preparedFile.name.toLowerCase().endsWith('.gif')
            ? 'image/gif'
            : null;
  if (!isPdf && !imageType) {
    throw new Error('Choose a PDF, PNG, JPEG, WebP, GIF, HEIC, or HEIF schedule file.');
  }

  const type = isPdf ? 'application/pdf' : (imageType ?? 'application/octet-stream');
  const dataUrl = (await readFileAsDataUrl(preparedFile)).replace(/^data:[^;]*;/, `data:${type};`);
  return {
    name: preparedFile.name,
    type,
    dataUrl
  };
}

function importKey(courseName: string, sectionName: string) {
  return `${courseName.trim().toLocaleLowerCase()}|${sectionName.trim().toLocaleLowerCase()}`;
}

function classPickerLabel(section: GetScheduleResponse['sections'][number]) {
  const meetingLabel = section.meetings.length
    ? section.meetings
        .map((meeting) => `${meeting.day} ${timeRange(meeting.time, meeting.endTime)}`)
        .join(', ')
    : 'No meeting time set';
  return `${section.sectionName} · ${meetingLabel} · currently using ${section.courseName}`;
}

function importedClassIssue(item: ScheduleImportResponse['classes'][number]): string | null {
  if (!item.name.trim()) return 'Course name is missing.';
  if (!item.period.trim()) return 'Class group name is missing.';
  if (!item.days.length) return 'Meeting day is missing.';
  if (!item.time && !item.endTime) return 'Start and end times are missing.';
  if (!item.time) return 'Start time is missing.';
  if (!item.endTime) return 'End time is missing.';
  if (item.endTime <= item.time) return 'End time must be later than start time.';
  return null;
}

function ScheduleImportPanel({
  existingSections,
  onApplied
}: {
  existingSections: GetScheduleResponse['sections'];
  onApplied: () => Promise<void>;
}) {
  const api = useApiClient();
  const [text, setText] = useState('');
  const [file, setFile] = useState<{ name: string; type: string; dataUrl: string } | null>(null);
  const [draft, setDraft] = useState<ScheduleImportResponse | null>(null);
  const [correction, setCorrection] = useState('');
  const [busyAction, setBusyAction] = useState<'file' | 'read' | 'correct' | 'apply' | null>(null);
  const [importProgress, setImportProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = busyAction !== null;
  const existingSectionKeys = new Set(
    existingSections.map((section) => importKey(section.courseName, section.sectionName))
  );
  const importedCourses = draft ? groupImportedSchedule(draft.classes) : [];
  const importedClassGroupCount = importedCourses.reduce(
    (count, course) => count + course.classGroups.length,
    0
  );
  const importedMeetingCount =
    draft?.classes.reduce((count, item) => count + item.days.length, 0) ?? 0;
  const reviewIssueCount = draft?.classes.filter((item) => importedClassIssue(item)).length ?? 0;

  const updateDraftClasses = (
    sourceIndexes: number[],
    patch: Partial<ScheduleImportResponse['classes'][number]>
  ) => {
    const selected = new Set(sourceIndexes);
    setDraft((current) =>
      current
        ? {
            ...current,
            classes: current.classes.map((item, index) =>
              selected.has(index) ? { ...item, ...patch } : item
            )
          }
        : current
    );
  };

  const removeDraftClass = (sourceIndex: number) => {
    setDraft((current) =>
      current
        ? { ...current, classes: current.classes.filter((_, index) => index !== sourceIndex) }
        : current
    );
    setError(null);
  };

  const parse = async () => {
    if (!text.trim() && !file) {
      setError('Paste a schedule or choose an image/PDF first.');
      return;
    }
    try {
      setBusyAction('read');
      setImportProgress(5);
      setError(null);
      const input = {
        text: text.trim() || undefined,
        imageBase64: file?.dataUrl,
        fileName: file?.name,
        fileMimeType: file?.type
      };
      let parsedSchedule: ScheduleImportResponse | null = null;
      let queuedJobId: string | null = null;
      try {
        queuedJobId = (await api.enqueueParseSchedule(input)).jobId;
      } catch (err) {
        // Local development can run without Redis. Keep the direct endpoint as
        // a scoped fallback only when enqueue itself reports no queue.
        if (err instanceof ApiError && err.status === 503) {
          setImportProgress(null);
          parsedSchedule = await api.importSchedule(input);
        } else {
          throw err;
        }
      }

      if (queuedJobId) {
        const deadline = Date.now() + 8 * 60_000;
        let complete = false;
        let consecutivePollFailures = 0;

        while (!complete && Date.now() < deadline) {
          let status: Awaited<ReturnType<typeof api.getAiJobStatus>>;
          try {
            status = await api.getAiJobStatus(queuedJobId);
            consecutivePollFailures = 0;
          } catch (err) {
            const retryable =
              err instanceof ApiError &&
              (err.status === 0 || err.status === 408 || err.status >= 500);
            consecutivePollFailures += 1;
            if (retryable && consecutivePollFailures <= 3) {
              await waitForScheduleJob(2_000);
              continue;
            }
            throw err;
          }
          setImportProgress(status.progressPercent);
          if (status.status === 'succeeded') {
            if (!status.output) throw new Error('The schedule reader finished without a result.');
            parsedSchedule = ParseScheduleResponseSchema.parse(status.output);
            complete = true;
          } else if (status.status === 'failed' || status.status === 'cancelled') {
            throw new Error(status.error ?? 'The schedule reader could not finish this import.');
          } else {
            await waitForScheduleJob(1_500);
          }
        }

        if (!complete) {
          await api.cancelAiJob(queuedJobId).catch(() => undefined);
          throw new Error('The schedule reader took too long. Try a clearer image or pasted text.');
        }
      }
      if (!parsedSchedule) throw new Error('The schedule reader finished without a result.');
      setDraft(normalizeImportedCourseVariants(parsedSchedule));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read this schedule.');
    } finally {
      setBusyAction(null);
      setImportProgress(null);
    }
  };

  const apply = async () => {
    if (!draft) return;
    if (!draft.classes.length || reviewIssueCount > 0) {
      setError('Finish the missing or invalid meeting details before applying this schedule.');
      return;
    }
    try {
      setBusyAction('apply');
      setError(null);
      await api.applyScheduleImport({ classes: draft.classes });
      await api
        .updatePreferences({ setupStep: 'calendar', walkthroughDismissed: false })
        .catch(() => undefined);
      await onApplied();
      setDraft(null);
      setText('');
      setFile(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not apply this reviewed schedule.');
    } finally {
      setBusyAction(null);
    }
  };

  const correct = async () => {
    if (!draft || !correction.trim()) return;
    try {
      setBusyAction('correct');
      setError(null);
      setDraft(
        normalizeImportedCourseVariants(
          await api.correctScheduleImport({
            classes: draft.classes,
            assignments: draft.assignments,
            instruction: correction.trim()
          })
        )
      );
      setCorrection('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not apply that correction.');
    } finally {
      setBusyAction(null);
    }
  };

  const startOver = () => {
    setDraft(null);
    setCorrection('');
    setError(null);
  };

  return (
    <section className="courses-import-panel" aria-busy={busy} aria-label="Import class schedule">
      <p className="visually-hidden" role="status" aria-live="polite">
        {busyAction === 'file'
          ? 'Preparing the schedule image.'
          : busyAction === 'read'
            ? `Reading the schedule${importProgress === null ? '.' : `, ${importProgress} percent complete.`}`
            : busyAction === 'correct'
              ? 'Updating the schedule review.'
              : busyAction === 'apply'
                ? 'Applying the reviewed schedule.'
                : ''}
      </p>
      <div className="courses-import-intro">
        <p className="eyebrow">Import</p>
        <h2>Import your teaching schedule</h2>
        <p className="muted">
          A course holds one shared plan. Each class group sits inside that course and keeps its own
          meeting times.
        </p>
      </div>
      <dl className="schedule-import-terms">
        <div>
          <dt>Course</dt>
          <dd>The shared subject and level, such as Spanish 5.</dd>
        </div>
        <div>
          <dt>Class group</dt>
          <dd>The students who meet together, such as Group A or Group B.</dd>
        </div>
      </dl>
      <div className="schedule-import-source">
        <label className="schedule-import-text-field">
          <span>Paste schedule text</span>
          <textarea
            className="input"
            value={text}
            disabled={busy || Boolean(draft)}
            onChange={(event) => setText(event.target.value)}
            placeholder="Spanish 5&#10;Group A: Monday 8:10–8:47&#10;Group B: Tuesday 9:12–10:03"
          />
        </label>
        <div className="schedule-import-file-field">
          <span>Or upload the original schedule</span>
          <label className="file-input-label">
            <span>Choose image or PDF</span>
            <input
              type="file"
              accept="image/*,application/pdf"
              disabled={busy || Boolean(draft)}
              onChange={(event) => {
                const next = event.target.files?.[0];
                if (!next) return;
                setBusyAction('file');
                setError(null);
                void prepareScheduleFile(next)
                  .then(setFile)
                  .catch((err) =>
                    setError(err instanceof Error ? err.message : 'Could not read that file.')
                  )
                  .finally(() => setBusyAction(null));
              }}
            />
          </label>
          {file ? (
            <span className="schedule-import-file-name" aria-live="polite">
              Selected: {file.name}
            </span>
          ) : (
            <small>Use a clear image where weekday headings and time boundaries are visible.</small>
          )}
          {draft ? <small>Start over below to change the source schedule.</small> : null}
        </div>
      </div>
      {error ? (
        <p className="notice warning" role="alert">
          {error}
        </p>
      ) : null}
      {!draft ? (
        <button
          className="schedule-import-read-button"
          type="button"
          disabled={busy}
          onClick={() => void parse()}
        >
          {busyAction === 'read'
            ? `Reading schedule…${importProgress === null ? '' : ` ${importProgress}%`}`
            : 'Review schedule'}
        </button>
      ) : (
        <div className="schedule-import-review">
          <div className="schedule-import-review-heading">
            <div>
              <span>Detected schedule</span>
              <strong>
                {importedCourses.length} {importedCourses.length === 1 ? 'course' : 'courses'},{' '}
                {importedClassGroupCount}{' '}
                {importedClassGroupCount === 1 ? 'class group' : 'class groups'},{' '}
                {importedMeetingCount} {importedMeetingCount === 1 ? 'meeting' : 'meetings'}
              </strong>
            </div>
            <span>
              {reviewIssueCount
                ? `${reviewIssueCount} ${reviewIssueCount === 1 ? 'meeting needs' : 'meetings need'} attention`
                : 'Ready to apply'}
            </span>
          </div>
          {importedCourses.length ? (
            <div className="schedule-import-course-list">
              {importedCourses.map((course, courseIndex) => {
                const courseSourceIndexes = course.classGroups.flatMap((classGroup) =>
                  classGroup.meetings.map((meeting) => meeting.sourceIndex)
                );
                return (
                  <article
                    className="schedule-import-course"
                    key={courseSourceIndexes[0] ?? courseIndex}
                    aria-label={`Course ${course.name || 'unnamed'}`}
                  >
                    <header className="schedule-import-course-heading">
                      <div>
                        <span>Course</span>
                        <h3>{course.name || 'Unnamed course'}</h3>
                      </div>
                      <small>
                        {course.classGroups.length}{' '}
                        {course.classGroups.length === 1 ? 'class group' : 'class groups'}
                      </small>
                    </header>
                    <label className="schedule-import-course-name">
                      <span>Course name</span>
                      <input
                        className={`input${course.name.trim() ? '' : ' schedule-import-invalid-field'}`}
                        value={course.name}
                        disabled={busy}
                        aria-invalid={!course.name.trim()}
                        onChange={(event) =>
                          updateDraftClasses(courseSourceIndexes, { name: event.target.value })
                        }
                      />
                    </label>
                    <div className="schedule-import-groups">
                      {course.classGroups.map((classGroup, groupIndex) => {
                        const groupSourceIndexes = classGroup.meetings.map(
                          (meeting) => meeting.sourceIndex
                        );
                        const updatesExisting = existingSectionKeys.has(
                          importKey(course.name, classGroup.name)
                        );
                        return (
                          <section
                            className="schedule-import-group"
                            key={groupSourceIndexes[0] ?? groupIndex}
                            aria-label={`Class group ${classGroup.name || 'unnamed'}`}
                          >
                            <header className="schedule-import-group-heading">
                              <div>
                                <span>Class group</span>
                                <h4>{classGroup.name || 'Unnamed class group'}</h4>
                              </div>
                              <em
                                className={
                                  updatesExisting ? 'schedule-import-match' : 'schedule-import-new'
                                }
                              >
                                {updatesExisting ? 'Updates existing group' : 'Creates new group'}
                              </em>
                            </header>
                            <label className="schedule-import-group-name">
                              <span>Class group name</span>
                              <input
                                className={`input${classGroup.name.trim() ? '' : ' schedule-import-invalid-field'}`}
                                value={classGroup.name}
                                disabled={busy}
                                aria-invalid={!classGroup.name.trim()}
                                onChange={(event) =>
                                  updateDraftClasses(groupSourceIndexes, {
                                    period: event.target.value
                                  })
                                }
                              />
                            </label>
                            <div className="schedule-import-meetings">
                              {classGroup.meetings.map(({ parsedClass, sourceIndex }) => {
                                const issue = importedClassIssue(parsedClass);
                                const startInvalid = !parsedClass.time;
                                const endInvalid =
                                  !parsedClass.endTime ||
                                  Boolean(
                                    parsedClass.time && parsedClass.endTime <= parsedClass.time
                                  );
                                return (
                                  <div className="schedule-import-meeting" key={sourceIndex}>
                                    <div className="schedule-import-meeting-days">
                                      <span>Meets</span>
                                      <strong>{parsedClass.days.join(', ')}</strong>
                                    </div>
                                    <label>
                                      <span>Start time</span>
                                      <input
                                        className={`input${startInvalid ? ' schedule-import-invalid-field' : ''}`}
                                        type="time"
                                        value={parsedClass.time ?? ''}
                                        disabled={busy}
                                        aria-invalid={startInvalid}
                                        onChange={(event) =>
                                          updateDraftClasses([sourceIndex], {
                                            time: event.target.value || null
                                          })
                                        }
                                      />
                                    </label>
                                    <label>
                                      <span>End time</span>
                                      <input
                                        className={`input${endInvalid ? ' schedule-import-invalid-field' : ''}`}
                                        type="time"
                                        value={parsedClass.endTime ?? ''}
                                        disabled={busy}
                                        aria-invalid={endInvalid}
                                        onChange={(event) =>
                                          updateDraftClasses([sourceIndex], {
                                            endTime: event.target.value || null
                                          })
                                        }
                                      />
                                    </label>
                                    <label>
                                      <span>Room</span>
                                      <input
                                        className="input"
                                        value={parsedClass.room ?? ''}
                                        disabled={busy}
                                        placeholder="Optional"
                                        onChange={(event) =>
                                          updateDraftClasses([sourceIndex], {
                                            room: event.target.value || null
                                          })
                                        }
                                      />
                                    </label>
                                    <button
                                      className="secondary schedule-import-remove-meeting"
                                      type="button"
                                      disabled={busy}
                                      aria-label={`Remove ${parsedClass.days.join(', ')} meeting from ${course.name}, ${classGroup.name}`}
                                      onClick={() => removeDraftClass(sourceIndex)}
                                    >
                                      Remove meeting
                                    </button>
                                    {issue ? (
                                      <p className="schedule-import-meeting-issue">{issue}</p>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          </section>
                        );
                      })}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="schedule-import-empty" role="status">
              <strong>No class meetings were found.</strong>
              <span>Start over with clearer text or a sharper image.</span>
            </div>
          )}
          <div className="courses-import-correction">
            <label>
              <span>Tell the schedule reader what to correct</span>
              <input
                className="input"
                value={correction}
                disabled={busy}
                onChange={(event) => setCorrection(event.target.value)}
                placeholder="Spanish 5 has Groups A and B. Group B ends at 2:22 PM."
              />
            </label>
            <button
              className="secondary"
              type="button"
              disabled={busy || !correction.trim() || !draft.classes.length}
              onClick={() => void correct()}
            >
              {busyAction === 'correct' ? 'Updating review…' : 'Update review'}
            </button>
          </div>
          {reviewIssueCount ? (
            <p className="schedule-import-review-warning" role="status">
              Add the missing times above or describe the correction before applying. TeacherDesk
              will not invent an end time.
            </p>
          ) : null}
          <div className="profile-actions">
            <button
              type="button"
              disabled={busy || !draft.classes.length || reviewIssueCount > 0}
              onClick={() => void apply()}
            >
              {busyAction === 'apply' ? 'Applying schedule…' : 'Apply reviewed schedule'}
            </button>
            <button className="secondary" type="button" disabled={busy} onClick={startOver}>
              Start over
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export function CoursesPage() {
  const api = useApiClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [courses, setCourses] = useState<Course[]>([]);
  const [schedule, setSchedule] = useState<GetScheduleResponse | null>(null);
  const [invitations, setInvitations] = useState<CourseInvitationsResponse['invitations']>([]);
  const [adoptingInvitation, setAdoptingInvitation] = useState<{
    courseId: string;
    name: string;
    mode: 'collaborate' | 'copy';
  } | null>(null);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [grade, setGrade] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState<'blank' | 'copy'>('blank');
  const [sourceCourseId, setSourceCourseId] = useState('');
  const [curriculumTargetId, setCurriculumTargetId] = useState<string | null>(null);
  const [targetSourceCourseId, setTargetSourceCourseId] = useState('');
  const [linkingCourseId, setLinkingCourseId] = useState<string | null>(null);
  const [linkingSectionId, setLinkingSectionId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const importOpen = params.get('import') === 'schedule';
  const setupFlow = params.get('setup') === '1';

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [courseResult, scheduleResult, invitationResult] = await Promise.all([
        api.listCourses('all'),
        api.getSchedule(),
        api.listCourseInvitations()
      ]);
      setCourses(
        (
          await Promise.all(courseResult.courses.map((course) => api.getCourseDetail(course.id)))
        ).map((detail) => detail.course)
      );
      setSchedule(scheduleResult);
      setInvitations(invitationResult.invitations);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load courses.');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const createCourse = async () => {
    if (!name.trim()) return;
    try {
      setSaving(true);
      await api.createCourse({
        name: name.trim(),
        subject: subject.trim() || null,
        gradeLevel: grade.trim() || null,
        sourceCourseId: createMode === 'copy' && sourceCourseId ? sourceCourseId : undefined
      });
      setName('');
      setSubject('');
      setGrade('');
      setSourceCourseId('');
      setCreateMode('blank');
      setCreateOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create course.');
    } finally {
      setSaving(false);
    }
  };

  const runCourseAction = async (
    course: Course,
    action: 'duplicate' | 'end' | 'restore' | 'delete'
  ) => {
    try {
      setSaving(true);
      if (action === 'duplicate') {
        const nextName = window.prompt('New course name', `${course.name} copy`)?.trim();
        if (!nextName) return;
        await api.duplicateCourse(course.id, nextName);
      } else if (action === 'end') {
        await api.archiveCourse(course.id);
      } else if (action === 'delete') {
        if (
          !window.confirm(
            `Delete ${course.name} permanently? This removes its curriculum and linked class groups.`
          )
        )
          return;
        await api.deleteCourse(course.id);
      } else {
        await api.restoreCourse(course.id);
      }
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update this course.');
    } finally {
      setSaving(false);
    }
  };

  const linkCourseToClass = async () => {
    if (!linkingCourseId || !linkingSectionId) return;
    try {
      setSaving(true);
      await api.updateSection(linkingSectionId, { courseId: linkingCourseId });
      setLinkingCourseId(null);
      setLinkingSectionId('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not link this class group.');
    } finally {
      setSaving(false);
    }
  };

  const respondToInvitation = async (courseId: string, response: 'accept' | 'decline') => {
    try {
      setSaving(true);
      if (response === 'accept') {
        if (!adoptingInvitation || !adoptingInvitation.name.trim()) return;
        await api.acceptCourseInvitation(courseId, {
          mode: adoptingInvitation.mode,
          name: adoptingInvitation.name.trim()
        });
        setAdoptingInvitation(null);
      } else await api.declineCourseInvitation(courseId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update this invitation.');
    } finally {
      setSaving(false);
    }
  };

  const copyIntoExistingCourse = async () => {
    if (!curriculumTargetId || !targetSourceCourseId) return;
    try {
      setSaving(true);
      setError(null);
      await api.copyCurriculumIntoCourse(curriculumTargetId, {
        sourceCourseId: targetSourceCourseId
      });
      setCurriculumTargetId(null);
      setTargetSourceCourseId('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not copy this curriculum.');
    } finally {
      setSaving(false);
    }
  };

  const renderCourse = (course: Course) => {
    const sections = schedule?.sections.filter((section) => section.courseId === course.id) ?? [];
    const lessonCount = course.units.reduce((count, unit) => count + unit.lessons.length, 0);
    return (
      <article
        key={course.id}
        className={`course-hub-row ${course.lifecycle === 'ended' ? 'is-archived' : ''}`}
      >
        <div>
          <h2>{course.name}</h2>
          <p>{[course.subject, course.gradeLevel].filter(Boolean).join(' · ') || 'Course'}</p>
          <span className="course-curriculum-status">
            {course.relationshipType === 'shared'
              ? `Using shared curriculum: ${course.curriculumName}`
              : course.curriculumName !== course.name
                ? `Based on: ${course.curriculumName} · Independent copy`
                : 'Independent curriculum'}
          </span>
          <span>
            {course.lifecycle === 'ended'
              ? 'Ended'
              : sections.length
                ? `${sections.length} ${sections.length === 1 ? 'class group' : 'class groups'} · ${sections
                    .map((section) => section.sectionName)
                    .join(' · ')}`
                : 'Unlinked · no class groups yet'}
          </span>
          <span
            className={
              course.units.length ? 'course-curriculum-status' : 'course-curriculum-status is-empty'
            }
          >
            {course.units.length
              ? `Curriculum · ${course.units.length} ${course.units.length === 1 ? 'unit' : 'units'} · ${lessonCount} ${lessonCount === 1 ? 'lesson' : 'lessons'}`
              : 'Curriculum not added'}
          </span>
        </div>
        <div className="course-row-actions">
          {course.lifecycle !== 'ended' ? (
            <>
              <Link className="button-link secondary" to={`/courses/${course.id}`}>
                Open course
              </Link>
              <Link className="button-link secondary" to={`/sharing?course=${course.id}`}>
                Sharing
              </Link>
              {course.units.length ? (
                <Link className="button-link" to={`/year-plan?course=${course.id}`}>
                  Year Plan
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setCurriculumTargetId(course.id);
                    setTargetSourceCourseId('');
                  }}
                >
                  Add curriculum
                </button>
              )}
              <button
                className="secondary"
                type="button"
                onClick={() => {
                  setLinkingCourseId(course.id);
                  setLinkingSectionId('');
                }}
              >
                Link to a class
              </button>
            </>
          ) : null}
          <details className="course-actions-menu">
            <summary aria-label={`Actions for ${course.name}`}>•••</summary>
            <div>
              {course.lifecycle === 'ended' ? (
                <>
                  <button type="button" onClick={() => void runCourseAction(course, 'restore')}>
                    Restore to workspace
                  </button>
                  <button
                    className="danger"
                    type="button"
                    onClick={() => void runCourseAction(course, 'delete')}
                  >
                    Delete permanently
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => void runCourseAction(course, 'duplicate')}>
                    Duplicate as independent copy
                  </button>
                  <button
                    className="danger"
                    type="button"
                    onClick={() => void runCourseAction(course, 'end')}
                  >
                    End course for me
                  </button>
                </>
              )}
            </div>
          </details>
        </div>
        {curriculumTargetId === course.id ? (
          <section
            className="course-add-curriculum"
            aria-label={`Add curriculum to ${course.name}`}
          >
            <div>
              <strong>Add curriculum</strong>
              <span>Keep this course and all of its existing Class Groups and schedules.</span>
            </div>
            <div className="course-add-curriculum-options">
              <button
                className="secondary"
                type="button"
                onClick={() => navigate(`/year-plan?course=${course.id}`)}
              >
                Start blank
              </button>
              <select
                className="input"
                aria-label="Curriculum to copy"
                value={targetSourceCourseId}
                onChange={(event) => setTargetSourceCourseId(event.target.value)}
              >
                <option value="">Copy existing curriculum…</option>
                {courses
                  .filter((source) => source.id !== course.id && source.units.length)
                  .map((source) => {
                    const sourceLessonCount = source.units.reduce(
                      (count, unit) => count + unit.lessons.length,
                      0
                    );
                    return (
                      <option key={source.id} value={source.id}>
                        {source.name} · {source.units.length} units · {sourceLessonCount} lessons
                      </option>
                    );
                  })}
              </select>
              <button
                type="button"
                disabled={saving || !targetSourceCourseId}
                onClick={() => void copyIntoExistingCourse()}
              >
                {saving ? 'Copying…' : 'Copy curriculum'}
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() => setCurriculumTargetId(null)}
              >
                Cancel
              </button>
            </div>
          </section>
        ) : null}
        {linkingCourseId === course.id ? (
          <section
            className="course-add-curriculum"
            aria-label={`Link ${course.name} to a class group`}
          >
            <div>
              <strong>Link {course.name} to a class</strong>
              <span>Choose one scheduled class. Its class name and schedule will not change.</span>
            </div>
            <div className="course-add-curriculum-options">
              <select
                className="input"
                aria-label="Class group to link"
                value={linkingSectionId}
                onChange={(event) => setLinkingSectionId(event.target.value)}
              >
                <option value="">Choose a class group…</option>
                {(schedule?.sections ?? []).map((section) => (
                  <option key={section.sectionId} value={section.sectionId}>
                    {classPickerLabel(section)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={saving || !linkingSectionId}
                onClick={() => void linkCourseToClass()}
              >
                {saving ? 'Linking…' : 'Link selected class'}
              </button>
              <button className="secondary" type="button" onClick={() => setLinkingCourseId(null)}>
                Cancel
              </button>
            </div>
          </section>
        ) : null}
      </article>
    );
  };

  return (
    <main className="courses-page page-entry">
      <header className="courses-page-header">
        <div>
          <p className="eyebrow">Courses</p>
          <h1>What you teach</h1>
        </div>
        <div className="courses-header-actions">
          <button
            className="secondary"
            type="button"
            onClick={() => setParams(importOpen ? {} : { import: 'schedule' })}
          >
            {importOpen ? 'Close import' : 'Import schedule'}
          </button>
          <button type="button" onClick={() => setCreateOpen((open) => !open)}>
            {createOpen ? 'Close' : '+ New course'}
          </button>
        </div>
      </header>
      {error ? <p className="notice warning">{error}</p> : null}
      {importOpen ? (
        <ScheduleImportPanel
          existingSections={schedule?.sections ?? []}
          onApplied={async () => {
            if (setupFlow) {
              navigate('/guide', { replace: true });
              return;
            }
            await load();
          }}
        />
      ) : null}
      {invitations.length ? (
        <section className="courses-create-panel" aria-labelledby="course-invitations-heading">
          <div className="courses-create-heading">
            <div>
              <p className="eyebrow">Shared with you</p>
              <h2 id="course-invitations-heading">Course invitations</h2>
            </div>
            <p className="muted">Choose whether to collaborate or make an independent course.</p>
          </div>
          <div className="course-hub-list">
            {invitations.map((invitation) => (
              <article className="course-hub-row" key={invitation.course.id}>
                <div>
                  <p className="eyebrow">Shared curriculum</p>
                  <h2>{invitation.course.curriculumName}</h2>
                  <p>
                    {invitation.invitedBy.fullName ?? invitation.invitedBy.email} invited you to
                    collaborate.
                  </p>
                </div>
                <div className="course-row-actions">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      setAdoptingInvitation({
                        courseId: invitation.course.id,
                        name: invitation.course.curriculumName,
                        mode: 'collaborate'
                      })
                    }
                  >
                    Choose how to use it
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    disabled={saving}
                    onClick={() => void respondToInvitation(invitation.course.id, 'decline')}
                  >
                    Decline
                  </button>
                </div>
              </article>
            ))}
          </div>
          {adoptingInvitation ? (
            <div className="course-adoption-panel">
              <div>
                <p className="eyebrow">Add to my courses</p>
                <h3>How do you want to use this curriculum?</h3>
              </div>
              <div className="course-curriculum-choice">
                <label className={adoptingInvitation.mode === 'collaborate' ? 'selected' : ''}>
                  <input
                    type="radio"
                    checked={adoptingInvitation.mode === 'collaborate'}
                    onChange={() =>
                      setAdoptingInvitation({ ...adoptingInvitation, mode: 'collaborate' })
                    }
                  />
                  <span>
                    <strong>Collaborate on curriculum</strong>
                    <small>Edit the same curriculum together.</small>
                  </span>
                </label>
                <label className={adoptingInvitation.mode === 'copy' ? 'selected' : ''}>
                  <input
                    type="radio"
                    checked={adoptingInvitation.mode === 'copy'}
                    onChange={() => setAdoptingInvitation({ ...adoptingInvitation, mode: 'copy' })}
                  />
                  <span>
                    <strong>Use as my own course</strong>
                    <small>Create an independent version you can modify.</small>
                  </span>
                </label>
              </div>
              <label>
                <span>What do you call this course?</span>
                <input
                  className="input"
                  value={adoptingInvitation.name}
                  onChange={(event) =>
                    setAdoptingInvitation({ ...adoptingInvitation, name: event.target.value })
                  }
                  autoFocus
                />
              </label>
              <div className="course-row-actions">
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setAdoptingInvitation(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving || !adoptingInvitation.name.trim()}
                  onClick={() => void respondToInvitation(adoptingInvitation.courseId, 'accept')}
                >
                  {adoptingInvitation.mode === 'copy' ? 'Create my course' : 'Join curriculum'}
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
      {createOpen ? (
        <section className="courses-create-panel" aria-labelledby="create-course-heading">
          <div className="courses-create-heading">
            <div>
              <p className="eyebrow">New course</p>
              <h2 id="create-course-heading">Create course</h2>
            </div>
            <p className="muted">Class groups and schedules can be added separately.</p>
          </div>
          <div className="courses-create-fields">
            <label>
              <span>Course name</span>
              <input
                className="input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Spanish 5"
                autoFocus
              />
            </label>
            <label>
              <span>Subject</span>
              <input
                className="input"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="Spanish"
              />
            </label>
            <label>
              <span>Grade</span>
              <input
                className="input"
                value={grade}
                onChange={(event) => setGrade(event.target.value)}
                placeholder="5"
              />
            </label>
          </div>
          <fieldset className="course-curriculum-choice">
            <legend>Curriculum</legend>
            <label className={createMode === 'blank' ? 'selected' : ''}>
              <input
                type="radio"
                name="curriculum-source"
                checked={createMode === 'blank'}
                onChange={() => setCreateMode('blank')}
              />
              <span>
                <strong>Start blank</strong>
                <small>Build a new curriculum for this course.</small>
              </span>
            </label>
            <label className={createMode === 'copy' ? 'selected' : ''}>
              <input
                type="radio"
                name="curriculum-source"
                checked={createMode === 'copy'}
                onChange={() => setCreateMode('copy')}
              />
              <span>
                <strong>Copy existing curriculum</strong>
                <small>Make an independent editable copy from My Curriculum.</small>
              </span>
            </label>
          </fieldset>
          {createMode === 'copy' ? (
            <label className="course-curriculum-source">
              <span>My Curriculum</span>
              <select
                className="input"
                value={sourceCourseId}
                onChange={(event) => setSourceCourseId(event.target.value)}
              >
                <option value="">Choose curriculum…</option>
                {!courses.some((course) => course.units.length) ? (
                  <option value="" disabled>
                    No existing curriculum yet
                  </option>
                ) : null}
                {courses
                  .filter((course) => course.units.length)
                  .map((course) => {
                    const lessons = course.units.reduce(
                      (sum, unit) => sum + unit.lessons.length,
                      0
                    );
                    return (
                      <option key={course.id} value={course.id}>
                        {course.name} · {course.units.length} units · {lessons} lessons
                      </option>
                    );
                  })}
              </select>
            </label>
          ) : null}
          <div className="courses-create-actions">
            <button className="secondary" type="button" onClick={() => setCreateOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              disabled={saving || !name.trim() || (createMode === 'copy' && !sourceCourseId)}
              onClick={() => void createCourse()}
            >
              {saving ? 'Creating…' : 'Create course'}
            </button>
          </div>
        </section>
      ) : null}
      {loading ? (
        <section className="courses-loading" aria-busy="true" aria-label="Loading courses">
          <div className="workspace-skeleton workspace-skeleton-row" />
          <div className="workspace-skeleton workspace-skeleton-row" />
          <div className="workspace-skeleton workspace-skeleton-row" />
        </section>
      ) : null}
      {!loading && !courses.length ? (
        <section className="courses-empty-state">
          <h2>Create or import your first course</h2>
          <p>Start with a course, then add its class groups and meeting times.</p>
        </section>
      ) : null}
      <section className="courses-archived">
        <h2>Active courses</h2>
        <div className="course-hub-list">
          {courses.filter((course) => course.lifecycle === 'active').map(renderCourse)}
        </div>
      </section>
      {courses.some((course) => course.lifecycle === 'unlinked') ? (
        <section className="courses-archived">
          <h2>Unlinked courses</h2>
          <div className="course-hub-list">
            {courses.filter((course) => course.lifecycle === 'unlinked').map(renderCourse)}
          </div>
        </section>
      ) : null}
      {courses.some((course) => course.lifecycle === 'ended') ? (
        <section className="courses-archived">
          <h2>Inactive courses</h2>
          <div className="course-hub-list">
            {courses.filter((course) => course.lifecycle === 'ended').map(renderCourse)}
          </div>
        </section>
      ) : null}
    </main>
  );
}
