import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import type { CourseListResponse } from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';
import { rememberManagementTab } from '../lib/management-tabs.js';

type CourseRow = CourseListResponse['courses'][number];
type CourseDraft = {
  name: string;
  subject: string;
  gradeLevel: string;
};

const COURSE_DRAFT_KEY = 'teacheros_curriculum_course_draft_v1';

const emptyCourseDraft: CourseDraft = {
  name: '',
  subject: '',
  gradeLevel: ''
};

function toNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function loadCourseDraft(): CourseDraft {
  try {
    const raw = window.localStorage.getItem(COURSE_DRAFT_KEY);
    return raw ? { ...emptyCourseDraft, ...(JSON.parse(raw) as Partial<CourseDraft>) } : emptyCourseDraft;
  } catch {
    return emptyCourseDraft;
  }
}

function buildCourseListSummary(courses: CourseRow[]): string {
  return [
    'TeacherOS courses',
    '',
    courses.length
      ? courses
          .map(
            (course, index) =>
              `${index + 1}. ${course.name}\n   Subject: ${course.subject ?? 'Not set'}\n   Grade: ${course.gradeLevel ?? 'Not set'}`
          )
          .join('\n\n')
      : 'No courses yet.'
  ].join('\n');
}

export function CurriculumPage() {
  const api = useApiClient();
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [courseDraft, setCourseDraft] = useState<CourseDraft>(() => loadCourseDraft());
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editSubject, setEditSubject] = useState('');
  const [editGradeLevel, setEditGradeLevel] = useState('');

  const loadCourses = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.listCourses();
      setCourses(data.courses);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load curriculum');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadCourses();
  }, [loadCourses]);

  useEffect(() => {
    window.localStorage.setItem(COURSE_DRAFT_KEY, JSON.stringify(courseDraft));
  }, [courseDraft]);

  const updateCourseDraft = (patch: Partial<CourseDraft>) => {
    setCourseDraft((previous) => ({ ...previous, ...patch }));
  };

  const saveCourseDraft = () => {
    window.localStorage.setItem(COURSE_DRAFT_KEY, JSON.stringify(courseDraft));
    setSavedAt(new Date().toLocaleTimeString());
    setError(null);
  };

  const copyCourseSummary = async () => {
    await navigator.clipboard?.writeText(buildCourseListSummary(courses)).catch(() => undefined);
    setCopyStatus('Course list copied.');
    window.setTimeout(() => setCopyStatus(null), 1800);
  };

  return (
    <div className="stack">
      <div className="editor-topbar">
        <div>
          <p className="eyebrow">Year Plan</p>
          <h1>Courses and curriculum</h1>
        </div>
        <div className="profile-actions">
          <button className="button-link secondary" type="button" onClick={() => void copyCourseSummary()}>
            Copy course list
          </button>
          <Link className="button-link secondary" to="/management" onClick={() => rememberManagementTab('curriculum')}>
            Back to Management
          </Link>
        </div>
      </div>
      {error ? <p className="notice warning">{error}</p> : null}
      {savedAt ? <p className="notice success">Course draft saved at {savedAt}.</p> : null}
      {copyStatus ? <p className="notice success">{copyStatus}</p> : null}

      <div className="card stack">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Course</p>
            <h3>Create course</h3>
          </div>
          <button className="secondary" type="button" onClick={saveCourseDraft}>
            Save draft
          </button>
        </div>
        <div className="stack">
          <input
            className="input"
            value={courseDraft.name}
            onChange={(event) => updateCourseDraft({ name: event.target.value })}
            placeholder="Course name (required)"
          />
          <input
            className="input"
            value={courseDraft.subject}
            onChange={(event) => updateCourseDraft({ subject: event.target.value })}
            placeholder="Subject (optional)"
          />
          <input
            className="input"
            value={courseDraft.gradeLevel}
            onChange={(event) => updateCourseDraft({ gradeLevel: event.target.value })}
            placeholder="Grade level (optional)"
          />
          <button
            type="button"
            disabled={saving || !courseDraft.name.trim()}
            onClick={async () => {
              try {
                setSaving(true);
                await api.createCourse({
                  name: courseDraft.name.trim(),
                  subject: toNullable(courseDraft.subject),
                  gradeLevel: toNullable(courseDraft.gradeLevel)
                });
                setCourseDraft(emptyCourseDraft);
                window.localStorage.removeItem(COURSE_DRAFT_KEY);
                await loadCourses();
              } catch (err) {
                setError(err instanceof ApiError ? err.message : 'Failed to create course');
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? 'Creating...' : 'Create course'}
          </button>
        </div>
      </div>

      <div className="card stack">
        <h3>Courses</h3>
        {loading ? <p className="muted">Loading courses...</p> : null}
        {!loading && courses.length === 0 ? (
          <p className="muted">No courses yet. Create your first one above.</p>
        ) : null}
        {courses.map((course) => (
          <div key={course.id} className="card stack">
            {editId === course.id ? (
              <>
                <input
                  className="input"
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  placeholder="Course name"
                />
                <input
                  className="input"
                  value={editSubject}
                  onChange={(event) => setEditSubject(event.target.value)}
                  placeholder="Subject"
                />
                <input
                  className="input"
                  value={editGradeLevel}
                  onChange={(event) => setEditGradeLevel(event.target.value)}
                  placeholder="Grade level"
                />
                <div className="row">
                  <button
                    type="button"
                    disabled={saving || !editName.trim()}
                    onClick={async () => {
                      try {
                        setSaving(true);
                        await api.updateCourse(course.id, {
                          name: editName.trim(),
                          subject: toNullable(editSubject),
                          gradeLevel: toNullable(editGradeLevel)
                        });
                        setEditId(null);
                        await loadCourses();
                      } catch (err) {
                        setError(err instanceof ApiError ? err.message : 'Failed to update course');
                      } finally {
                        setSaving(false);
                      }
                    }}
                  >
                    Save
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => {
                      setEditId(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <div>
                  <strong>{course.name}</strong>
                  <p className="muted">
                    {course.subject ?? 'No subject'} | {course.gradeLevel ?? 'No grade level'}
                  </p>
                </div>
                <div className="row">
                  <Link to={`/courses/${course.id}`}>Open</Link>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => {
                      setEditId(course.id);
                      setEditName(course.name);
                      setEditSubject(course.subject ?? '');
                      setEditGradeLevel(course.gradeLevel ?? '');
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const confirmDelete = window.confirm(
                        `Delete course "${course.name}" and all nested units/lessons/segments?`
                      );
                      if (!confirmDelete) return;
                      try {
                        setSaving(true);
                        await api.deleteCourse(course.id);
                        await loadCourses();
                      } catch (err) {
                        setError(err instanceof ApiError ? err.message : 'Failed to delete course');
                      } finally {
                        setSaving(false);
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
