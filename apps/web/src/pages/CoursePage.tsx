import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import type { CourseDetailResponse } from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';

type LessonDraft = { title: string; description: string; duration: string };
type SegmentDraft = { title: string; description: string; duration: string };

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

export function CoursePage() {
  const api = useApiClient();
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const courseId = params.id ?? '';
  const [course, setCourse] = useState<CourseDetailResponse['course'] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [courseName, setCourseName] = useState('');
  const [courseSubject, setCourseSubject] = useState('');
  const [courseGradeLevel, setCourseGradeLevel] = useState('');

  const [unitTitle, setUnitTitle] = useState('');
  const [unitDescription, setUnitDescription] = useState('');
  const [unitOrder, setUnitOrder] = useState('');

  const [lessonDrafts, setLessonDrafts] = useState<Record<string, LessonDraft>>({});
  const [segmentDrafts, setSegmentDrafts] = useState<Record<string, SegmentDraft>>({});

  const loadCourse = useCallback(async () => {
    if (!courseId) return;

    try {
      setLoading(true);
      const data = await api.getCourseDetail(courseId);
      setCourse(data.course);
      setCourseName(data.course.name);
      setCourseSubject(data.course.subject ?? '');
      setCourseGradeLevel(data.course.gradeLevel ?? '');
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load course');
    } finally {
      setLoading(false);
    }
  }, [api, courseId]);

  useEffect(() => {
    void loadCourse();
  }, [loadCourse]);

  const updateFromDetail = (detail: CourseDetailResponse) => {
    setCourse(detail.course);
    setCourseName(detail.course.name);
    setCourseSubject(detail.course.subject ?? '');
    setCourseGradeLevel(detail.course.gradeLevel ?? '');
  };

  if (!courseId) {
    return (
      <div className="stack">
        <p style={{ color: '#b02020' }}>Course id is missing.</p>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="editor-topbar">
        <div>
          <p className="eyebrow">Course editor</p>
          <h1>Course Detail</h1>
        </div>
        <div className="profile-actions">
          <Link className="button-link secondary" to="/curriculum">
            Back to Curriculum
          </Link>
          <Link className="button-link secondary" to="/management">
            Back to Management
          </Link>
        </div>
      </div>
      {error ? <p style={{ color: '#b02020' }}>{error}</p> : null}
      {loading && !course ? <p className="muted">Loading course...</p> : null}

      {course ? (
        <>
          <div className="card stack">
            <h3>Course settings</h3>
            <input
              className="input"
              value={courseName}
              onChange={(event) => setCourseName(event.target.value)}
              placeholder="Course name"
            />
            <input
              className="input"
              value={courseSubject}
              onChange={(event) => setCourseSubject(event.target.value)}
              placeholder="Subject"
            />
            <input
              className="input"
              value={courseGradeLevel}
              onChange={(event) => setCourseGradeLevel(event.target.value)}
              placeholder="Grade level"
            />
            <div className="row">
              <button
                type="button"
                disabled={saving || !courseName.trim()}
                onClick={async () => {
                  try {
                    setSaving(true);
                    const detail = await api.updateCourse(course.id, {
                      name: courseName.trim(),
                      subject: toNullable(courseSubject),
                      gradeLevel: toNullable(courseGradeLevel)
                    });
                    updateFromDetail(detail);
                    setError(null);
                  } catch (err) {
                    setError(err instanceof ApiError ? err.message : 'Failed to update course');
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                Save course
              </button>
              <button
                type="button"
                onClick={async () => {
                  const confirmDelete = window.confirm(
                    'Delete this course and all nested curriculum items?'
                  );
                  if (!confirmDelete) return;
                  try {
                    setSaving(true);
                    await api.deleteCourse(course.id);
                    navigate('/curriculum');
                  } catch (err) {
                    setError(err instanceof ApiError ? err.message : 'Failed to delete course');
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                Delete course
              </button>
            </div>
          </div>

          <div className="card stack">
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
              placeholder="Unit description (optional)"
            />
            <input
              className="input"
              value={unitOrder}
              onChange={(event) => setUnitOrder(event.target.value)}
              placeholder="Order index (optional)"
            />
            <button
              type="button"
              disabled={saving || !unitTitle.trim()}
              onClick={async () => {
                try {
                  setSaving(true);
                  const detail = await api.createUnit(course.id, {
                    title: unitTitle.trim(),
                    description: toNullable(unitDescription),
                    orderIndex: parseOptionalOrder(unitOrder)
                  });
                  updateFromDetail(detail);
                  setUnitTitle('');
                  setUnitDescription('');
                  setUnitOrder('');
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : 'Failed to add unit');
                } finally {
                  setSaving(false);
                }
              }}
            >
              Add unit
            </button>
          </div>

          <div className="stack">
            {course.units.map((unit) => {
              const lessonDraft = lessonDrafts[unit.id] ?? {
                title: '',
                description: '',
                duration: ''
              };

              return (
                <div key={unit.id} className="card stack">
                  <div className="row">
                    <strong>
                      Unit {unit.orderIndex}: {unit.title}
                    </strong>
                    <button
                      className="secondary"
                      type="button"
                      onClick={async () => {
                        const nextTitle = window.prompt('Unit title', unit.title);
                        if (nextTitle === null || !nextTitle.trim()) return;
                        const nextDescription = window.prompt(
                          'Unit description (optional)',
                          unit.description ?? ''
                        );
                        const nextOrder = window.prompt('Unit order index', String(unit.orderIndex));
                        try {
                          setSaving(true);
                          const detail = await api.updateUnit(unit.id, {
                            title: nextTitle.trim(),
                            description: toNullable(nextDescription ?? ''),
                            orderIndex: parseOptionalOrder(nextOrder ?? '')
                          });
                          updateFromDetail(detail);
                        } catch (err) {
                          setError(err instanceof ApiError ? err.message : 'Failed to update unit');
                        } finally {
                          setSaving(false);
                        }
                      }}
                    >
                      Edit unit
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const confirmDelete = window.confirm(
                          `Delete unit "${unit.title}" and all lessons inside it?`
                        );
                        if (!confirmDelete) return;
                        try {
                          setSaving(true);
                          await api.deleteUnit(unit.id);
                          await loadCourse();
                        } catch (err) {
                          setError(err instanceof ApiError ? err.message : 'Failed to delete unit');
                        } finally {
                          setSaving(false);
                        }
                      }}
                    >
                      Delete unit
                    </button>
                  </div>
                  {unit.description ? <p className="muted">{unit.description}</p> : null}

                  <div className="card stack">
                    <h4>Add lesson</h4>
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
                      value={lessonDraft.description}
                      onChange={(event) =>
                        setLessonDrafts((previous) => ({
                          ...previous,
                          [unit.id]: { ...lessonDraft, description: event.target.value }
                        }))
                      }
                      placeholder="Lesson description (optional)"
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
                      placeholder="Estimated minutes (optional)"
                    />
                    <button
                      type="button"
                      disabled={saving || !lessonDraft.title.trim()}
                      onClick={async () => {
                        try {
                          setSaving(true);
                          const detail = await api.createLesson(unit.id, {
                            title: lessonDraft.title.trim(),
                            description: toNullable(lessonDraft.description),
                            estimatedDurationMinutes: parseNullablePositiveInt(lessonDraft.duration),
                            orderIndex: undefined
                          });
                          updateFromDetail(detail);
                          setLessonDrafts((previous) => ({
                            ...previous,
                            [unit.id]: { title: '', description: '', duration: '' }
                          }));
                        } catch (err) {
                          setError(err instanceof ApiError ? err.message : 'Failed to add lesson');
                        } finally {
                          setSaving(false);
                        }
                      }}
                    >
                      Add lesson
                    </button>
                  </div>

                  {unit.lessons.map((lesson) => {
                    const segmentDraft = segmentDrafts[lesson.id] ?? {
                      title: '',
                      description: '',
                      duration: ''
                    };

                    return (
                      <div key={lesson.id} className="card stack">
                        <div className="row">
                          <strong>
                            Lesson {lesson.orderIndex}: {lesson.title}
                          </strong>
                          <button
                            className="secondary"
                            type="button"
                            onClick={async () => {
                              const nextTitle = window.prompt('Lesson title', lesson.title);
                              if (nextTitle === null || !nextTitle.trim()) return;
                              const nextDescription = window.prompt(
                                'Lesson description (optional)',
                                lesson.description ?? ''
                              );
                              const nextDuration = window.prompt(
                                'Estimated duration minutes (optional)',
                                lesson.estimatedDurationMinutes?.toString() ?? ''
                              );
                              const nextOrder = window.prompt(
                                'Lesson order index',
                                String(lesson.orderIndex)
                              );

                              try {
                                setSaving(true);
                                const detail = await api.updateLesson(lesson.id, {
                                  title: nextTitle.trim(),
                                  description: toNullable(nextDescription ?? ''),
                                  estimatedDurationMinutes: parseNullablePositiveInt(
                                    nextDuration ?? ''
                                  ),
                                  orderIndex: parseOptionalOrder(nextOrder ?? '')
                                });
                                updateFromDetail(detail);
                              } catch (err) {
                                setError(
                                  err instanceof ApiError ? err.message : 'Failed to update lesson'
                                );
                              } finally {
                                setSaving(false);
                              }
                            }}
                          >
                            Edit lesson
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const confirmDelete = window.confirm(
                                `Delete lesson "${lesson.title}" and all segments?`
                              );
                              if (!confirmDelete) return;
                              try {
                                setSaving(true);
                                await api.deleteLesson(lesson.id);
                                await loadCourse();
                              } catch (err) {
                                setError(
                                  err instanceof ApiError ? err.message : 'Failed to delete lesson'
                                );
                              } finally {
                                setSaving(false);
                              }
                            }}
                          >
                            Delete lesson
                          </button>
                        </div>
                        {lesson.description ? <p className="muted">{lesson.description}</p> : null}

                        <div className="card stack">
                          <h5>Add segment</h5>
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
                            value={segmentDraft.description}
                            onChange={(event) =>
                              setSegmentDrafts((previous) => ({
                                ...previous,
                                [lesson.id]: { ...segmentDraft, description: event.target.value }
                              }))
                            }
                            placeholder="Segment description (optional)"
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
                            placeholder="Duration minutes (optional)"
                          />
                          <button
                            type="button"
                            disabled={saving || !segmentDraft.title.trim()}
                            onClick={async () => {
                              try {
                                setSaving(true);
                                const detail = await api.createSegment(lesson.id, {
                                  title: segmentDraft.title.trim(),
                                  description: toNullable(segmentDraft.description),
                                  durationMinutes: parseNullablePositiveInt(segmentDraft.duration),
                                  orderIndex: undefined
                                });
                                updateFromDetail(detail);
                                setSegmentDrafts((previous) => ({
                                  ...previous,
                                  [lesson.id]: { title: '', description: '', duration: '' }
                                }));
                              } catch (err) {
                                setError(
                                  err instanceof ApiError ? err.message : 'Failed to add segment'
                                );
                              } finally {
                                setSaving(false);
                              }
                            }}
                          >
                            Add segment
                          </button>
                        </div>

                        {lesson.segments.map((segment) => (
                          <div key={segment.id} className="row">
                            <span>
                              {segment.orderIndex}. {segment.title}
                              {segment.durationMinutes ? ` (${segment.durationMinutes} min)` : ''}
                            </span>
                            <button
                              className="secondary"
                              type="button"
                              onClick={async () => {
                                const nextTitle = window.prompt('Segment title', segment.title);
                                if (nextTitle === null || !nextTitle.trim()) return;
                                const nextDescription = window.prompt(
                                  'Segment description (optional)',
                                  segment.description ?? ''
                                );
                                const nextDuration = window.prompt(
                                  'Duration minutes (optional)',
                                  segment.durationMinutes?.toString() ?? ''
                                );
                                const nextOrder = window.prompt(
                                  'Segment order index',
                                  String(segment.orderIndex)
                                );

                                try {
                                  setSaving(true);
                                  const detail = await api.updateSegment(segment.id, {
                                    title: nextTitle.trim(),
                                    description: toNullable(nextDescription ?? ''),
                                    durationMinutes: parseNullablePositiveInt(nextDuration ?? ''),
                                    orderIndex: parseOptionalOrder(nextOrder ?? '')
                                  });
                                  updateFromDetail(detail);
                                } catch (err) {
                                  setError(
                                    err instanceof ApiError ? err.message : 'Failed to update segment'
                                  );
                                } finally {
                                  setSaving(false);
                                }
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                const confirmDelete = window.confirm(
                                  `Delete segment "${segment.title}"?`
                                );
                                if (!confirmDelete) return;
                                try {
                                  setSaving(true);
                                  await api.deleteSegment(segment.id);
                                  await loadCourse();
                                } catch (err) {
                                  setError(
                                    err instanceof ApiError ? err.message : 'Failed to delete segment'
                                  );
                                } finally {
                                  setSaving(false);
                                }
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
