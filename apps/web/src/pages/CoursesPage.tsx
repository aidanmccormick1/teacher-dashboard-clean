import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type {
  CourseDetailResponse,
  GetScheduleResponse,
  ScheduleImportResponse
} from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';
import { normalizeImportedCourseVariants } from '../lib/scheduleImport.js';

type Course = CourseDetailResponse['course'];

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => resolve(String(reader.result));
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
          Read the schedule, review the result, then apply it. Existing class groups are updated in
          place so their progress and history stay intact.
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
                    {item.days.join(', ')} · {item.time ?? 'time TBD'}
                    {item.endTime ? `–${item.endTime}` : ''}
                  </small>
                  <em className={updatesExisting ? 'schedule-import-match' : 'schedule-import-new'}>
                    {updatesExisting ? 'Updates existing class group' : 'New class group'}
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
  const [params, setParams] = useSearchParams();
  const [courses, setCourses] = useState<Course[]>([]);
  const [schedule, setSchedule] = useState<GetScheduleResponse | null>(null);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [grade, setGrade] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const importOpen = params.get('import') === 'schedule';

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [courseResult, scheduleResult] = await Promise.all([
        api.listCourses(),
        api.getSchedule()
      ]);
      setCourses(
        (
          await Promise.all(courseResult.courses.map((course) => api.getCourseDetail(course.id)))
        ).map((detail) => detail.course)
      );
      setSchedule(scheduleResult);
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
        gradeLevel: grade.trim() || null
      });
      setName('');
      setSubject('');
      setGrade('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create course.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="courses-page">
      <header className="courses-page-header">
        <div>
          <p className="eyebrow">Courses</p>
          <h1>What you teach</h1>
          <p className="muted">
            Courses hold shared curriculum. Class groups hold meetings and progress.
          </p>
        </div>
        <button
          className="secondary"
          type="button"
          onClick={() => setParams(importOpen ? {} : { import: 'schedule' })}
        >
          {importOpen ? 'Close import' : 'Import schedule'}
        </button>
      </header>
      {error ? <p className="notice warning">{error}</p> : null}
      {importOpen ? (
        <ScheduleImportPanel existingSections={schedule?.sections ?? []} onApplied={load} />
      ) : null}
      <section className="courses-create-row">
        <input
          className="input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="New course name"
        />
        <input
          className="input"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          placeholder="Subject"
        />
        <input
          className="input"
          value={grade}
          onChange={(event) => setGrade(event.target.value)}
          placeholder="Grade"
        />
        <button type="button" disabled={saving || !name.trim()} onClick={() => void createCourse()}>
          Create course
        </button>
      </section>
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
      <section className="course-hub-list">
        {courses.map((course) => {
          const sections =
            schedule?.sections.filter((section) => section.courseId === course.id) ?? [];
          const lessonCount = course.units.reduce((count, unit) => count + unit.lessons.length, 0);
          return (
            <article key={course.id} className="course-hub-row">
              <div>
                <h2>{course.name}</h2>
                <p>{[course.subject, course.gradeLevel].filter(Boolean).join(' · ') || 'Course'}</p>
                <span>
                  {sections.length
                    ? sections.map((section) => section.sectionName).join(' · ')
                    : 'No class groups yet'}
                  {' · '}
                  {course.units.length} {course.units.length === 1 ? 'unit' : 'units'} ·{' '}
                  {lessonCount} {lessonCount === 1 ? 'lesson' : 'lessons'}
                </span>
              </div>
              <div className="profile-actions">
                <Link className="button-link secondary" to={`/courses/${course.id}`}>
                  Open course
                </Link>
                <Link className="button-link" to={`/year-plan?course=${course.id}`}>
                  Year Plan
                </Link>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
