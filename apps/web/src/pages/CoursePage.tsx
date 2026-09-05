import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import type {
  CourseActivityResponse,
  CourseCollaboratorsResponse,
  CourseDetailResponse,
  GetScheduleResponse
} from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';
import { isGoogleSlidesUrl } from '../lib/googleSlides.js';
import { timeRange } from '../lib/today.js';

type MeetingDraft = { day: string; time: string; endTime: string; room: string };
type UnitSlidesDraft = { url: string; startSlide: string };
const meetingDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'A-Day', 'B-Day'];

function toNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
  const [schedule, setSchedule] = useState<GetScheduleResponse | null>(null);
  const [collaborators, setCollaborators] = useState<CourseCollaboratorsResponse['collaborators']>(
    []
  );
  const [collaboratorEmail, setCollaboratorEmail] = useState('');
  const [activity, setActivity] = useState<CourseActivityResponse['activity']>([]);

  const [courseName, setCourseName] = useState('');
  const [courseSubject, setCourseSubject] = useState('');
  const [courseGradeLevel, setCourseGradeLevel] = useState('');

  const [unitTitle, setUnitTitle] = useState('');
  const [unitDescription, setUnitDescription] = useState('');
  const [unitOrder, setUnitOrder] = useState('');

  const [unitSlidesDrafts, setUnitSlidesDrafts] = useState<Record<string, UnitSlidesDraft>>({});
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

  useEffect(() => {
    if (!courseId) return;
    void api
      .getCourseCollaborators(courseId)
      .then((response) => setCollaborators(response.collaborators))
      .catch(() => undefined);
  }, [api, courseId]);

  useEffect(() => {
    if (!courseId) return;
    void api
      .getCourseActivity(courseId)
      .then((response) => setActivity(response.activity))
      .catch(() => undefined);
  }, [api, courseId, course?.updatedAt]);

  const updateFromDetail = (detail: CourseDetailResponse) => {
    setCourse(detail.course);
    setCourseName(detail.course.name);
    setCourseSubject(detail.course.subject ?? '');
    setCourseGradeLevel(detail.course.gradeLevel ?? '');
    void api
      .getCourseActivity(detail.course.id)
      .then((response) => setActivity(response.activity))
      .catch(() => undefined);
  };

  const courseAction = async (action: 'duplicate' | 'end' | 'leave' | 'delete') => {
    if (!course) return;
    try {
      setSaving(true);
      if (action === 'duplicate') {
        const name = window.prompt('New course name', `${course.name} copy`)?.trim();
        if (!name) return;
        const duplicate = await api.duplicateCourse(course.id, name);
        navigate(`/courses/${duplicate.course.id}`);
      } else if (action === 'end') {
        await api.archiveCourse(course.id);
        navigate('/courses');
      } else if (action === 'leave') {
        if (!window.confirm(`Leave ${course.name}? Unlink any class groups first.`)) return;
        await api.leaveCourse(course.id);
        navigate('/courses');
      } else {
        if (
          !window.confirm(
            `Delete ${course.name} for everyone? This permanently deletes all linked class groups and curriculum.`
          )
        )
          return;
        await api.deleteCourse(course.id);
        navigate('/courses');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update this course.');
    } finally {
      setSaving(false);
    }
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
            {course?.accessRole === 'editor'
              ? 'Shared curriculum you can edit. Your class groups, schedules, progress, and classroom history stay private to you.'
              : 'Shared curriculum for collaborators. Each teacher keeps their own class groups, schedules, progress, and classroom history.'}
          </p>
        </div>
        <div className="profile-actions">
          <Link className="button-link secondary" to="/courses">
            ← Courses
          </Link>
          <Link className="button-link done-editing" to="/courses">
            Done Editing
          </Link>
          <Link className="button-link" to={`/year-plan?course=${courseId}`}>
            Open Year Plan
          </Link>
          <Link className="button-link secondary" to={`/sharing?course=${courseId}`}>
            Manage sharing
          </Link>
          <details className="course-actions-menu">
            <summary aria-label="Course actions">•••</summary>
            <div>
              <button type="button" onClick={() => void courseAction('duplicate')}>
                Duplicate as independent copy
              </button>
              {course?.accessRole === 'editor' ? (
                <button className="danger" type="button" onClick={() => void courseAction('leave')}>
                  Leave course
                </button>
              ) : (
                <>
                  <button className="danger" type="button" onClick={() => void courseAction('end')}>
                    End course for me
                  </button>
                  <button
                    className="danger"
                    type="button"
                    onClick={() => void courseAction('delete')}
                  >
                    Delete permanently
                  </button>
                </>
              )}
            </div>
          </details>
        </div>
      </div>
      {error ? <p className="notice warning">{error}</p> : null}
      {loading && !course ? <p className="muted">Loading course...</p> : null}

      {course ? (
        <>
          <div className="course-settings card stack">
            <p className="eyebrow">My course</p>
            <h3>Course settings</h3>
            <p className="muted">
              {course.relationshipType === 'shared'
                ? `Using shared curriculum: ${course.curriculumName}. Renaming this course only changes your workspace.`
                : course.curriculumName !== course.name
                  ? `Independent copy based on ${course.curriculumName}.`
                  : 'This is your independent curriculum.'}
            </p>
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
            </div>
          </div>

          <div className="course-activity card stack">
            <div className="section-heading">
              <div>
                <h3>Activity</h3>
                <p className="muted">Recent shared-curriculum changes and discussion.</p>
              </div>
            </div>
            {activity.length ? (
              activity.map((event) => (
                <div className="course-edit-meeting-row" key={event.id}>
                  <div>
                    <strong>
                      {event.actor?.fullName ?? event.actor?.email ?? 'A collaborator'}
                    </strong>
                    <span>{event.summary}</span>
                  </div>
                  <time className="muted" dateTime={event.createdAt}>
                    {new Intl.DateTimeFormat(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit'
                    }).format(new Date(event.createdAt))}
                  </time>
                </div>
              ))
            ) : (
              <p className="muted">Shared curriculum activity will appear here.</p>
            )}
          </div>

          <div className="course-collaborators card stack">
            <div className="section-heading">
              <div>
                <h3>Collaborators</h3>
                <p className="muted">
                  Curriculum changes are shared. Scheduled class groups remain private to each
                  teacher.
                </p>
              </div>
            </div>
            {collaborators.map((collaborator) => (
              <div className="course-edit-meeting-row" key={collaborator.userId}>
                <div>
                  <strong>{collaborator.fullName ?? collaborator.email}</strong>
                  <span>
                    {collaborator.role === 'owner'
                      ? 'Owner'
                      : collaborator.status === 'invited'
                        ? 'Invitation pending'
                        : 'Can edit curriculum'}
                  </span>
                </div>
                {course.accessRole === 'owner' && collaborator.role === 'editor' ? (
                  <button
                    className="button-link"
                    type="button"
                    disabled={saving}
                    onClick={async () => {
                      if (!window.confirm(`Remove ${collaborator.fullName ?? collaborator.email}?`))
                        return;
                      try {
                        setSaving(true);
                        const response = await api.removeCourseCollaborator(
                          course.id,
                          collaborator.userId
                        );
                        void response;
                        setCollaborators((items) =>
                          items.filter((item) => item.userId !== collaborator.userId)
                        );
                      } catch (err) {
                        setError(
                          err instanceof ApiError ? err.message : 'Could not remove collaborator.'
                        );
                      } finally {
                        setSaving(false);
                      }
                    }}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            ))}
            {course.accessRole === 'owner' ? (
              <div className="profile-actions">
                <input
                  className="input"
                  type="email"
                  value={collaboratorEmail}
                  onChange={(event) => setCollaboratorEmail(event.target.value)}
                  placeholder="teacher@school.edu"
                  aria-label="Collaborator email"
                />
                <button
                  type="button"
                  disabled={saving || !collaboratorEmail.trim()}
                  onClick={async () => {
                    try {
                      setSaving(true);
                      const response = await api.inviteCourseCollaborator(course.id, {
                        email: collaboratorEmail.trim()
                      });
                      setCollaborators(response.collaborators);
                      setCollaboratorEmail('');
                    } catch (err) {
                      setError(
                        err instanceof ApiError ? err.message : 'Could not invite collaborator.'
                      );
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  Invite collaborator
                </button>
              </div>
            ) : null}
          </div>

          <div className="course-class-groups card stack">
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
                                `${meeting.day} ${timeRange(meeting.time, meeting.endTime)}`
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

          <div className="course-unit-slides card stack">
            <div className="section-heading">
              <div>
                <h3>Unit Slides</h3>
                <p className="muted">
                  Add one Google Slides deck to each unit. Lessons are edited in the Year Plan.
                </p>
              </div>
              <Link className="button-link secondary" to={`/year-plan?course=${courseId}`}>
                Edit lessons in Year Plan
              </Link>
            </div>
            <details>
              <summary>Add unit</summary>
              <div className="stack course-add-unit-form">
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
            </details>
          </div>

          <div className="course-unit-slides stack">
            {course.units.map((unit) => {
              const unitSlidesDraft = unitSlidesDrafts[unit.id] ?? {
                url: unit.googleSlidesUrl ?? '',
                startSlide: String(unit.googleSlidesStartSlide)
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
                        if (!window.confirm(`Delete unit "${unit.title}" and its lessons?`)) return;
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

                  <section className="unit-slides-settings" aria-label={`Slides for ${unit.title}`}>
                    <div>
                      <p className="eyebrow">Unit Slides</p>
                      <span>One deck follows this unit through every lesson and class group.</span>
                    </div>
                    <div className="unit-slides-settings-form">
                      <label>
                        <span>Google Slides link</span>
                        <input
                          className="input"
                          type="url"
                          value={unitSlidesDraft.url}
                          onChange={(event) =>
                            setUnitSlidesDrafts((previous) => ({
                              ...previous,
                              [unit.id]: { ...unitSlidesDraft, url: event.target.value }
                            }))
                          }
                          placeholder="https://docs.google.com/presentation/d/…"
                        />
                      </label>
                      <label>
                        <span>Start on slide</span>
                        <input
                          className="input"
                          type="number"
                          min="1"
                          value={unitSlidesDraft.startSlide}
                          onChange={(event) =>
                            setUnitSlidesDrafts((previous) => ({
                              ...previous,
                              [unit.id]: { ...unitSlidesDraft, startSlide: event.target.value }
                            }))
                          }
                          placeholder="1"
                        />
                      </label>
                      <button
                        type="button"
                        disabled={saving || !isGoogleSlidesUrl(unitSlidesDraft.url)}
                        onClick={async () => {
                          const parsedStart = Number(unitSlidesDraft.startSlide || '1');
                          if (!Number.isInteger(parsedStart) || parsedStart < 1) {
                            setError('The starting slide must be a whole number of 1 or greater.');
                            return;
                          }
                          try {
                            setSaving(true);
                            const detail = await api.updateUnit(unit.id, {
                              googleSlidesUrl: unitSlidesDraft.url.trim(),
                              googleSlidesStartSlide: parsedStart
                            });
                            updateFromDetail(detail);
                            setUnitSlidesDrafts((previous) => ({
                              ...previous,
                              [unit.id]: {
                                url: unitSlidesDraft.url.trim(),
                                startSlide: String(parsedStart)
                              }
                            }));
                            setError(null);
                          } catch (err) {
                            setError(
                              err instanceof ApiError ? err.message : 'Failed to save Unit Slides'
                            );
                          } finally {
                            setSaving(false);
                          }
                        }}
                      >
                        {unit.googleSlidesUrl ? 'Update slides' : 'Add slides'}
                      </button>
                      {unit.googleSlidesUrl ? (
                        <button
                          className="button-link danger"
                          type="button"
                          onClick={async () => {
                            try {
                              setSaving(true);
                              const detail = await api.updateUnit(unit.id, {
                                googleSlidesUrl: null,
                                googleSlidesStartSlide: 1
                              });
                              updateFromDetail(detail);
                              setUnitSlidesDrafts((previous) => ({
                                ...previous,
                                [unit.id]: { url: '', startSlide: '1' }
                              }));
                            } catch (err) {
                              setError(
                                err instanceof ApiError
                                  ? err.message
                                  : 'Failed to remove Unit Slides'
                              );
                            } finally {
                              setSaving(false);
                            }
                          }}
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                    {unitSlidesDraft.url && !isGoogleSlidesUrl(unitSlidesDraft.url) ? (
                      <p className="unit-slides-detection is-error">
                        Paste a Google Slides presentation link.
                      </p>
                    ) : unitSlidesDraft.url ? (
                      <p className="unit-slides-detection">Google Slides detected</p>
                    ) : null}
                  </section>

                  <section className="unit-lesson-summary" aria-label={`Lessons in ${unit.title}`}>
                    <div className="section-heading">
                      <div>
                        <h4>Lessons</h4>
                        <p className="muted">Lesson editing happens in the Year Plan.</p>
                      </div>
                      <Link className="button-link secondary" to={`/year-plan?course=${courseId}`}>
                        Edit lessons
                      </Link>
                    </div>
                    {unit.lessons.length ? (
                      <ol>
                        {unit.lessons.map((lesson) => (
                          <li key={lesson.id}>
                            {lesson.orderIndex}. {lesson.title}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="muted">No lessons yet.</p>
                    )}
                  </section>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </main>
  );
}
