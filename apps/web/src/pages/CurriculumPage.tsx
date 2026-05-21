import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import type { CourseListResponse } from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';

type CourseRow = CourseListResponse['courses'][number];

function toNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function CurriculumPage() {
  const api = useApiClient();
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [gradeLevel, setGradeLevel] = useState('');
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

  return (
    <div className="stack">
      <div className="editor-topbar">
        <div>
          <p className="eyebrow">Editor</p>
          <h1>Curriculum</h1>
        </div>
        <Link className="button-link secondary" to="/management">
          Back to Management
        </Link>
      </div>
      {error ? <p style={{ color: '#b02020' }}>{error}</p> : null}

      <div className="card stack">
        <h3>Create course</h3>
        <div className="stack">
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Course name (required)"
          />
          <input
            className="input"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Subject (optional)"
          />
          <input
            className="input"
            value={gradeLevel}
            onChange={(event) => setGradeLevel(event.target.value)}
            placeholder="Grade level (optional)"
          />
          <button
            type="button"
            disabled={saving || !name.trim()}
            onClick={async () => {
              try {
                setSaving(true);
                await api.createCourse({
                  name: name.trim(),
                  subject: toNullable(subject),
                  gradeLevel: toNullable(gradeLevel)
                });
                setName('');
                setSubject('');
                setGradeLevel('');
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
