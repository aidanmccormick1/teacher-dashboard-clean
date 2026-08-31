import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import type { CourseDetailResponse, GetScheduleResponse } from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';

type LessonDraft = { title: string; description: string; duration: string };
type SegmentDraft = { title: string; description: string; duration: string };
type MeetingDraft = { day: string; time: string; endTime: string; room: string };
const meetingDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'A-Day', 'B-Day'];

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

function buildCourseOutline(course: CourseDetailResponse['course']): string {
  const lines = [
    course.name,
    [course.subject, course.gradeLevel].filter(Boolean).join(' / ') || 'Course outline',
    ''
  ];

  if (!course.units.length) {
    lines.push('No units yet.');
    return lines.join('\n');
  }

  course.units.forEach((unit) => {
    lines.push(`Unit ${unit.orderIndex}: ${unit.title}`);
    if (unit.description) lines.push(`  ${unit.description}`);

    if (!unit.lessons.length) {
      lines.push('  - No lessons yet');
    }

    unit.lessons.forEach((lesson) => {
      lines.push(
        `  Lesson ${lesson.orderIndex}: ${lesson.title}${
          lesson.estimatedDurationMinutes ? ` (${lesson.estimatedDurationMinutes} min)` : ''
        }`
      );
      if (lesson.description) lines.push(`    ${lesson.description}`);

      if (!lesson.segments.length) {
        lines.push('    - No segments yet');
      }

      lesson.segments.forEach((segment) => {
        lines.push(
          `    - ${segment.orderIndex}. ${segment.title}${
            segment.durationMinutes ? ` (${segment.durationMinutes} min)` : ''
          }`
        );
      });
    });

    lines.push('');
  });

  return lines.join('\n').trim();
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
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<GetScheduleResponse | null>(null);

  const [courseName, setCourseName] = useState('');
  const [courseSubject, setCourseSubject] = useState('');
  const [courseGradeLevel, setCourseGradeLevel] = useState('');

  const [unitTitle, setUnitTitle] = useState('');
  const [unitDescription, setUnitDescription] = useState('');
  const [unitOrder, setUnitOrder] = useState('');

  const [lessonDrafts, setLessonDrafts] = useState<Record<string, LessonDraft>>({});
  const [segmentDrafts, setSegmentDrafts] = useState<Record<string, SegmentDraft>>({});
  const [newSectionName, setNewSectionName] = useState('');
  const [newSectionMeetings, setNewSectionMeetings] = useState<MeetingDraft[]>([
    { day: 'Monday', time: '', endTime: '', room: '' }
  ]);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editingSectionName, setEditingSectionName] = useState('');
  const [editingMeetings, setEditingMeetings] = useState<MeetingDraft[]>([]);

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

  useEffect(() => {
    void api
      .getSchedule()
      .then(setSchedule)
      .catch(() => undefined);
  }, [api]);

  const updateFromDetail = (detail: CourseDetailResponse) => {
    setCourse(detail.course);
    setCourseName(detail.course.name);
    setCourseSubject(detail.course.subject ?? '');
    setCourseGradeLevel(detail.course.gradeLevel ?? '');
  };

  const copyCourseOutline = async () => {
    if (!course) return;
    await navigator.clipboard?.writeText(buildCourseOutline(course)).catch(() => undefined);
    setCopyStatus('Course outline copied.');
    window.setTimeout(() => setCopyStatus(null), 1800);
  };

  if (!courseId) {
    return (
      <div className="stack">
        <p className="notice warning">Course id is missing.</p>
      </div>
    );
  }
  const courseSections =
    schedule?.sections.filter((section) => section.courseId === course?.id) ?? [];

  return (
    <main className="course-detail-workspace stack">
      <div className="editor-topbar">
        <div>
          <p className="eyebrow">Shared curriculum</p>
          <h1>{course?.name ?? 'Course'}</h1>
          <p className="muted">
            Shared curriculum for all of your Class Groups. Each group keeps its own schedule,
            progress, and classroom history.
          </p>
        </div>
        <div className="profile-actions">
          <Link className="button-link secondary" to="/courses">
            ← Courses
          </Link>
          <button
            hidden
            className="button-link secondary"
            type="button"
            disabled={!course}
            onClick={() => void copyCourseOutline()}
          >
            Copy outline
          </button>
          <Link className="button-link done-editing" to="/courses">
            Done Editing
          </Link>
          <Link className="button-link" to={`/year-plan?course=${courseId}`}>
            Open Year Plan
          </Link>
        </div>
      </div>
      {error ? <p className="notice warning">{error}</p> : null}
      {copyStatus ? <p className="notice success">{copyStatus}</p> : null}
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
                    navigate('/courses');
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
            <div className="section-heading">
              <div>
                <h3>Class Groups</h3>
                <p className="muted">{courseSections.length} Class Groups share this Course</p>
              </div>
            </div>
            {courseSections.length ? (
              courseSections.map((section) => (
                <div className="course-edit-meeting-row" key={section.sectionId}>
                  {editingSectionId === section.sectionId ? (
                    <div className="section-meeting-editor">
                      <input
                        className="input"
                        value={editingSectionName}
                        onChange={(event) => setEditingSectionName(event.target.value)}
                      />
                      {editingMeetings.map((meeting, index) => (
                        <div
                          className="section-meeting-fields"
                          key={`${section.sectionId}-${index}`}
                        >
                          <select
                            className="input"
                            value={meeting.day}
                            onChange={(event) =>
                              setEditingMeetings((items) =>
                                items.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, day: event.target.value } : item
                                )
                              )
                            }
                          >
                            {meetingDays.map((day) => (
                              <option key={day}>{day}</option>
                            ))}
                          </select>
                          <input
                            className="input"
                            type="time"
                            value={meeting.time}
                            onChange={(event) =>
                              setEditingMeetings((items) =>
                                items.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, time: event.target.value } : item
                                )
                              )
                            }
                          />
                          <input
                            className="input"
                            type="time"
                            value={meeting.endTime}
                            onChange={(event) =>
                              setEditingMeetings((items) =>
                                items.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? { ...item, endTime: event.target.value }
                                    : item
                                )
                              )
                            }
                          />
                          <input
                            className="input"
                            value={meeting.room}
                            placeholder="Room"
                            onChange={(event) =>
                              setEditingMeetings((items) =>
                                items.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, room: event.target.value } : item
                                )
                              )
                            }
                          />
                          <button
                            className="button-link"
                            type="button"
                            onClick={() =>
                              setEditingMeetings((items) =>
                                items.filter((_, itemIndex) => itemIndex !== index)
                              )
                            }
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <div className="profile-actions">
                        <button
                          className="secondary"
                          type="button"
                          onClick={() =>
                            setEditingMeetings((items) => [
                              ...items,
                              { day: 'Monday', time: '', endTime: '', room: '' }
                            ])
                          }
                        >
                          + Meeting
                        </button>
                        <button
                          type="button"
                          disabled={saving || !editingSectionName.trim()}
                          onClick={async () => {
                            try {
                              setSaving(true);
                              setSchedule(
                                await api.updateSection(section.sectionId, {
                                  sectionName: editingSectionName.trim(),
                                  meetings: editingMeetings.map((meeting) => ({
                                    day: meeting.day as any,
                                    time: meeting.time || null,
                                    endTime: meeting.endTime || null,
                                    room: meeting.room || null
                                  }))
                                })
                              );
                              setEditingSectionId(null);
                            } catch (err) {
                              setError(
                                err instanceof ApiError
                                  ? err.message
                                  : 'Could not save class group.'
                              );
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
                          onClick={() => setEditingSectionId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div>
                        <strong>{section.sectionName}</strong>
                        <span>
                          {section.meetings
                            .map(
                              (meeting) =>
                                `${meeting.day} ${meeting.time ?? '—'}–${meeting.endTime ?? '—'}`
                            )
                            .join(' · ') || 'No meeting times yet'}
                        </span>
                      </div>
                      <div className="profile-actions">
                        <button
                          className="secondary"
                          type="button"
                          onClick={() => {
                            setEditingSectionId(section.sectionId);
                            setEditingSectionName(section.sectionName);
                            setEditingMeetings(
                              section.meetings.map((meeting) => ({
                                day: meeting.day,
                                time: meeting.time ?? '',
                                endTime: meeting.endTime ?? '',
                                room: meeting.room ?? ''
                              }))
                            );
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className="button-link"
                          type="button"
                          onClick={async () => {
                            if (!window.confirm(`Delete ${section.sectionName}?`)) return;
                            try {
                              setSaving(true);
                              await api.deleteSection(section.sectionId);
                              setSchedule(await api.getSchedule());
                            } catch (err) {
                              setError(
                                err instanceof ApiError
                                  ? err.message
                                  : 'Could not delete class group.'
                              );
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
              ))
            ) : (
              <p className="muted">No class groups yet. Add one below.</p>
            )}
            <div className="section-meeting-editor">
              <strong>Add class group</strong>
              <input
                className="input"
                value={newSectionName}
                onChange={(event) => setNewSectionName(event.target.value)}
                placeholder="Group A"
              />
              {newSectionMeetings.map((meeting, index) => (
                <div className="section-meeting-fields" key={`new-${index}`}>
                  <select
                    className="input"
                    value={meeting.day}
                    onChange={(event) =>
                      setNewSectionMeetings((items) =>
                        items.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, day: event.target.value } : item
                        )
                      )
                    }
                  >
                    {meetingDays.map((day) => (
                      <option key={day}>{day}</option>
                    ))}
                  </select>
                  <input
                    className="input"
                    type="time"
                    value={meeting.time}
                    onChange={(event) =>
                      setNewSectionMeetings((items) =>
                        items.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, time: event.target.value } : item
                        )
                      )
                    }
                  />
                  <input
                    className="input"
                    type="time"
                    value={meeting.endTime}
                    onChange={(event) =>
                      setNewSectionMeetings((items) =>
                        items.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, endTime: event.target.value } : item
                        )
                      )
                    }
                  />
                  <input
                    className="input"
                    value={meeting.room}
                    placeholder="Room"
                    onChange={(event) =>
                      setNewSectionMeetings((items) =>
                        items.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, room: event.target.value } : item
                        )
                      )
                    }
                  />
                  <button
                    className="button-link"
                    type="button"
                    disabled={newSectionMeetings.length === 1}
                    onClick={() =>
                      setNewSectionMeetings((items) =>
                        items.filter((_, itemIndex) => itemIndex !== index)
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              <div className="profile-actions">
                <button
                  className="secondary"
                  type="button"
                  onClick={() =>
                    setNewSectionMeetings((items) => [
                      ...items,
                      { day: 'Monday', time: '', endTime: '', room: '' }
                    ])
                  }
                >
                  + Meeting
                </button>
                <button
                  type="button"
                  disabled={saving || !newSectionName.trim()}
                  onClick={async () => {
                    try {
                      setSaving(true);
                      setSchedule(
                        await api.createSection({
                          courseId: course.id,
                          sectionName: newSectionName.trim(),
                          meetings: newSectionMeetings.map((meeting) => ({
                            day: meeting.day as any,
                            time: meeting.time || null,
                            endTime: meeting.endTime || null,
                            room: meeting.room || null
                          }))
                        })
                      );
                      setNewSectionName('');
                      setNewSectionMeetings([{ day: 'Monday', time: '', endTime: '', room: '' }]);
                    } catch (err) {
                      setError(
                        err instanceof ApiError ? err.message : 'Could not add class group.'
                      );
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  Add group
                </button>
              </div>
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
                        const nextOrder = window.prompt(
                          'Unit order index',
                          String(unit.orderIndex)
                        );
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
                            estimatedDurationMinutes: parseNullablePositiveInt(
                              lessonDraft.duration
                            ),
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
                                    err instanceof ApiError
                                      ? err.message
                                      : 'Failed to update segment'
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
                                    err instanceof ApiError
                                      ? err.message
                                      : 'Failed to delete segment'
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
    </main>
  );
}
