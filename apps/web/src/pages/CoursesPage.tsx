import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type {
  CourseDetailResponse,
  CourseInvitationsResponse,
  GetScheduleResponse,
  ScheduleImportResponse
} from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';
import { normalizeImportedCourseVariants } from '../lib/scheduleImport.js';
import { timeRange } from '../lib/today.js';

type Course = CourseDetailResponse['course'];

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsDataURL(file);
  });
}

function importKey(courseName: string, sectionName: string) {
  return `${courseName.trim().toLocaleLowerCase()}|${sectionName.trim().toLocaleLowerCase()}`;
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const existingSectionKeys = new Set(
    existingSections.map((section) => importKey(section.courseName, section.sectionName))
  );

  const parse = async () => {
    if (!text.trim() && !file) {
      setError('Paste a schedule or choose an image/PDF first.');
      return;
    }
    try {
      setBusy(true);
      setError(null);
      setDraft(
        normalizeImportedCourseVariants(
          await api.importSchedule({
            text: text.trim() || undefined,
            imageBase64: file?.dataUrl,
            fileName: file?.name,
            fileMimeType: file?.type
          })
        )
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not read this schedule.');
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!draft) return;
    try {
      setBusy(true);
      setError(null);
      await api.applyScheduleImport({ classes: draft.classes });
      await onApplied();
      setDraft(null);
      setText('');
      setFile(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not apply this reviewed schedule.');
    } finally {
      setBusy(false);
    }
  };

  const correct = async () => {
    if (!draft || !correction.trim()) return;
    try {
      setBusy(true);
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
      setBusy(false);
    }
  };

  return (
    <section className="courses-import-panel" aria-label="Import class schedule">
      <div>
        <p className="eyebrow">Import</p>
        <h2>Import course and class schedule</h2>
        <p className="muted">
          Import creates courses and class groups, not curriculum. Existing groups are updated in
          place so their curriculum, progress, and history stay intact.
        </p>
      </div>
      <textarea
        className="input"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Paste a weekly schedule…"
      />
      <label className="file-input-label">
        <span>Or choose schedule image/PDF</span>
        <input
          type="file"
          accept="image/*,application/pdf"
          onChange={(event) => {
            const next = event.target.files?.[0];
            if (!next) return;
            void readFileAsDataUrl(next)
              .then((dataUrl) => setFile({ name: next.name, type: next.type, dataUrl }))
              .catch((err) =>
                setError(err instanceof Error ? err.message : 'Could not read that file.')
              );
          }}
        />
      </label>
      {file ? <span className="status-pill upcoming">{file.name}</span> : null}
      {error ? <p className="notice warning">{error}</p> : null}
      {!draft ? (
        <button type="button" disabled={busy} onClick={() => void parse()}>
          {busy ? 'Reading…' : 'Review schedule'}
        </button>
      ) : (
        <div className="schedule-import-review">
          <div className="schedule-import-review-heading">
            <strong>{draft.classes.length} meeting records found</strong>
            <span>Review before applying</span>
          </div>
          <div className="schedule-import-review-list">
            {draft.classes.map((item, index) => {
              const updatesExisting = existingSectionKeys.has(importKey(item.name, item.period));
              return (
                <article key={`${item.name}-${item.period}-${index}`}>
                  <strong>{item.name}</strong>
                  <span>{item.period}</span>
                  <small>
                    {item.days.join(', ')} · {timeRange(item.time, item.endTime)}
                  </small>
                  <em className={updatesExisting ? 'schedule-import-match' : 'schedule-import-new'}>
                    {updatesExisting
                      ? 'Updates class group · curriculum preserved'
                      : 'New class group · curriculum stays separate'}
                  </em>
                </article>
              );
            })}
          </div>
          <div className="courses-import-correction">
            <input
              className="input"
              value={correction}
              onChange={(event) => setCorrection(event.target.value)}
              placeholder="Optional correction, e.g. Group B meets Thu at 1:35"
            />
            <button
              className="secondary"
              type="button"
              disabled={busy || !correction.trim()}
              onClick={() => void correct()}
            >
              Correct
            </button>
          </div>
          <div className="profile-actions">
            <button type="button" disabled={busy} onClick={() => void apply()}>
              Apply reviewed schedule
            </button>
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
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
    action: 'duplicate' | 'end' | 'restore'
  ) => {
    try {
      setSaving(true);
      if (action === 'duplicate') {
        const nextName = window.prompt('New course name', `${course.name} copy`)?.trim();
        if (!nextName) return;
        await api.duplicateCourse(course.id, nextName);
      } else if (action === 'end') {
        await api.archiveCourse(course.id);
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
      if (response === 'accept') await api.acceptCourseInvitation(courseId);
      else await api.declineCourseInvitation(courseId);
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
                <button type="button" onClick={() => void runCourseAction(course, 'restore')}>
                  Restore to workspace
                </button>
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
              <strong>Link to a class</strong>
              <span>Choose one of your scheduled class groups. Names do not need to match.</span>
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
                    {section.sectionName} · currently using {section.courseName}
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
        <ScheduleImportPanel existingSections={schedule?.sections ?? []} onApplied={load} />
      ) : null}
      {invitations.length ? (
        <section className="courses-create-panel" aria-labelledby="course-invitations-heading">
          <div className="courses-create-heading">
            <div>
              <p className="eyebrow">Shared with you</p>
              <h2 id="course-invitations-heading">Course invitations</h2>
            </div>
            <p className="muted">
              Accept now and link the curriculum to a class whenever you are ready.
            </p>
          </div>
          <div className="course-hub-list">
            {invitations.map((invitation) => (
              <article className="course-hub-row" key={invitation.course.id}>
                <div>
                  <h2>{invitation.course.name}</h2>
                  <p>
                    {invitation.invitedBy.fullName ?? invitation.invitedBy.email} invited you to
                    collaborate.
                  </p>
                </div>
                <div className="course-row-actions">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void respondToInvitation(invitation.course.id, 'accept')}
                  >
                    Accept collaboration
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
          <h2>Ended courses</h2>
          <div className="course-hub-list">
            {courses.filter((course) => course.lifecycle === 'ended').map(renderCourse)}
          </div>
        </section>
      ) : null}
    </main>
  );
}
