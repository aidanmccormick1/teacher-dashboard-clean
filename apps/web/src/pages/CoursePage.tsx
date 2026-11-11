import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type {
  CourseActivityResponse,
  CourseCollaboratorsResponse,
  CourseDetailResponse,
  GetScheduleResponse,
  UnitUpdateRequest
} from '@teacheros/contracts';
import { FeedbackErrorAction } from '../components/FeedbackErrorAction.js';
import { CourseUnits } from '../components/CourseUnits.js';
import {
  CourseMeetingEditor,
  blankMeeting,
  type MeetingDraft
} from '../components/CourseMeetingEditor.js';
import { useFeedbackContext } from '../lib/feedbackDiagnostics.js';
import { ApiError, useApiClient } from '../lib/api.js';
import { sortCourseMeetings } from '../lib/courseSchedule.js';
import { timeRange } from '../lib/today.js';
import './CourseWorkspace.css';

type Course = CourseDetailResponse['course'];
type Section = GetScheduleResponse['sections'][number];

export function CoursePage() {
  const api = useApiClient();
  const navigate = useNavigate();
  const { id: courseId = '' } = useParams<{ id: string }>();
  useFeedbackContext({ courseId: courseId || null });
  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [schedule, setSchedule] = useState<GetScheduleResponse | null>(null);
  const [scheduleError, setScheduleError] = useState(false);
  const [collaborators, setCollaborators] = useState<
    CourseCollaboratorsResponse['collaborators'] | null
  >(null);
  const [collaboratorsError, setCollaboratorsError] = useState(false);
  const [collaboratorEmail, setCollaboratorEmail] = useState('');
  const [activity, setActivity] = useState<CourseActivityResponse['activity'] | null>(null);
  const [activityError, setActivityError] = useState(false);
  const [courseName, setCourseName] = useState('');
  const [courseSubject, setCourseSubject] = useState('');
  const [courseGradeLevel, setCourseGradeLevel] = useState('');
  const [addingGroup, setAddingGroup] = useState(false);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [sectionName, setSectionName] = useState('');
  const [meetings, setMeetings] = useState<MeetingDraft[]>([blankMeeting()]);

  const updateFromDetail = useCallback((detail: CourseDetailResponse) => {
    setCourse(detail.course);
    setCourseName(detail.course.name);
    setCourseSubject(detail.course.subject ?? '');
    setCourseGradeLevel(detail.course.gradeLevel ?? '');
  }, []);

  const loadCourse = useCallback(async () => {
    if (!courseId) return;
    setLoading(true);
    try {
      updateFromDetail(await api.getCourseDetail(courseId));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this course. Try again.');
    } finally {
      setLoading(false);
    }
  }, [api, courseId, updateFromDetail]);

  const loadSchedule = useCallback(async () => {
    setScheduleError(false);
    try {
      setSchedule(await api.getSchedule());
    } catch {
      setScheduleError(true);
    }
  }, [api]);

  const loadCollaborators = useCallback(async () => {
    setCollaboratorsError(false);
    try {
      setCollaborators((await api.getCourseCollaborators(courseId)).collaborators);
    } catch {
      setCollaboratorsError(true);
    }
  }, [api, courseId]);

  const loadActivity = useCallback(async () => {
    setActivityError(false);
    try {
      setActivity((await api.getCourseActivity(courseId)).activity);
    } catch {
      setActivityError(true);
    }
  }, [api, courseId]);

  useEffect(() => {
    void loadCourse();
  }, [loadCourse]);
  useEffect(() => {
    void loadSchedule();
  }, [loadSchedule]);
  useEffect(() => {
    void loadCollaborators();
  }, [loadCollaborators]);
  useEffect(() => {
    void loadActivity();
  }, [loadActivity, course?.updatedAt]);

  const mutate = async (action: () => Promise<void>, message: string): Promise<boolean> => {
    if (saving) return false;
    setSaving(true);
    setError(null);
    setNotice('');
    try {
      await action();
      setNotice(message);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your changes. Try again.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveUnit = (id: string, patch: UnitUpdateRequest) =>
    mutate(async () => {
      updateFromDetail(await api.updateUnit(id, patch));
    }, 'Unit saved.');

  const courseAction = async (action: 'duplicate' | 'end' | 'leave' | 'delete') => {
    if (!course) return;
    if (action === 'duplicate') {
      const name = window.prompt('New course name', `${course.name} copy`)?.trim();
      if (!name) return;
      await mutate(
        async () => navigate(`/courses/${(await api.duplicateCourse(course.id, name)).course.id}`),
        ''
      );
    } else {
      if (
        action === 'delete' &&
        !window.confirm(
          `Delete ${course.name} for everyone? This permanently deletes all linked class groups and curriculum.`
        )
      )
        return;
      if (
        action === 'leave' &&
        !window.confirm(`Leave ${course.name}? Unlink any class groups first.`)
      )
        return;
      await mutate(async () => {
        if (action === 'end') await api.archiveCourse(course.id);
        else if (action === 'leave') await api.leaveCourse(course.id);
        else await api.deleteCourse(course.id);
        navigate('/courses');
      }, '');
    }
  };

  const editGroup = (section: Section) => {
    setAddingGroup(false);
    setEditingSectionId(section.sectionId);
    setSectionName(section.sectionName);
    setMeetings(
      sortCourseMeetings(section.meetings).map((meeting) => ({
        day: meeting.day,
        time: meeting.time ?? '',
        endTime: meeting.endTime ?? '',
        room: meeting.room ?? ''
      }))
    );
  };

  const meetingRangeInvalid = meetings.some(
    (meeting) => meeting.time && meeting.endTime && meeting.endTime <= meeting.time
  );
  const groupForm = (
    <form
      className="course-inline-form course-group-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!sectionName.trim() || meetingRangeInvalid) return;
        const body = {
          sectionName: sectionName.trim(),
          meetings: sortCourseMeetings(meetings).map((meeting) => ({
            day: meeting.day,
            time: meeting.time || null,
            endTime: meeting.endTime || null,
            room: meeting.room.trim() || null
          }))
        };
        if (
          await mutate(
            async () => {
              setSchedule(
                editingSectionId
                  ? await api.updateSection(editingSectionId, body)
                  : await api.createSection({ courseId, ...body })
              );
            },
            editingSectionId ? 'Class group saved.' : 'Class group added.'
          )
        ) {
          setEditingSectionId(null);
          setAddingGroup(false);
        }
      }}
    >
      <label>
        Class group name
        <input
          className="input"
          value={sectionName}
          onChange={(event) => setSectionName(event.target.value)}
          required
          autoFocus
        />
      </label>
      <CourseMeetingEditor meetings={meetings} onChange={setMeetings} disabled={saving} />
      {meetingRangeInvalid ? (
        <p className="course-field-error" role="alert">
          End time must be after start time.
        </p>
      ) : null}
      <div className="course-compact-actions">
        <button type="submit" disabled={saving || !sectionName.trim() || meetingRangeInvalid}>
          {saving ? 'Saving…' : editingSectionId ? 'Save group' : 'Add group'}
        </button>
        <button
          className="secondary"
          type="button"
          onClick={() => {
            setEditingSectionId(null);
            setAddingGroup(false);
          }}
        >
          Cancel
        </button>
        {editingSectionId ? (
          <button
            className="secondary danger"
            type="button"
            disabled={saving}
            onClick={async () => {
              if (!window.confirm(`Delete ${sectionName}?`)) return;
              if (
                await mutate(async () => {
                  await api.deleteSection(editingSectionId);
                  setSchedule(await api.getSchedule());
                }, 'Class group deleted.')
              )
                setEditingSectionId(null);
            }}
          >
            Delete group
          </button>
        ) : null}
      </div>
    </form>
  );

  const courseSections =
    schedule?.sections
      .filter((section) => section.courseId === course?.id)
      .sort((a, b) => a.sectionName.localeCompare(b.sectionName, undefined, { numeric: true })) ??
    [];

  return (
    <main className="course-workspace">
      <header className="course-workspace-header">
        <div className="course-workspace-title">
          <Link className="course-back-link" to="/courses">
            ← Courses
          </Link>
          <h1>{course?.name ?? 'Course'}</h1>
          {course ? (
            <p>
              {[
                course.subject,
                course.gradeLevel,
                course.relationshipType === 'shared'
                  ? 'Shared curriculum'
                  : 'Independent curriculum'
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          ) : null}
        </div>
        {course ? (
          <div className="course-compact-actions">
            <Link className="button-link secondary" to={`/year-plan?course=${courseId}`}>
              Year Plan
            </Link>
            <Link className="button-link" to={`/sharing?course=${courseId}`}>
              Share course
            </Link>
            <details
              className="course-actions-menu"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.currentTarget.open = false;
                  event.currentTarget.querySelector('summary')?.focus();
                }
              }}
            >
              <summary aria-label="Course actions">•••</summary>
              <div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void courseAction('duplicate')}
                >
                  Duplicate course
                </button>
                {course.accessRole === 'editor' ? (
                  <button
                    className="danger"
                    type="button"
                    disabled={saving}
                    onClick={() => void courseAction('leave')}
                  >
                    Leave course
                  </button>
                ) : (
                  <>
                    <button
                      className="danger"
                      type="button"
                      disabled={saving}
                      onClick={() => void courseAction('end')}
                    >
                      End course
                    </button>
                    <button
                      className="danger"
                      type="button"
                      disabled={saving}
                      onClick={() => void courseAction('delete')}
                    >
                      Delete permanently
                    </button>
                  </>
                )}
              </div>
            </details>
          </div>
        ) : null}
      </header>
      <p className="visually-hidden" role="status">
        {notice}
      </p>
      {error ? (
        <div className="notice warning" role="alert">
          <p>{error}</p>
          <button className="secondary" type="button" onClick={() => void loadCourse()}>
            Reload course
          </button>
          <FeedbackErrorAction />
        </div>
      ) : null}
      {!courseId ? <p role="alert">Course id is missing.</p> : null}
      {loading && !course ? <p role="status">Loading course…</p> : null}
      {course ? (
        <>
          <div className="course-workspace-grid">
            <CourseUnits
              key={course.id}
              course={course}
              saving={saving}
              onSave={saveUnit}
              onCreate={(title, description) =>
                mutate(async () => {
                  updateFromDetail(
                    await api.createUnit(course.id, { title, description: description || null })
                  );
                }, 'Unit added.')
              }
              onDelete={async (unit) => {
                if (!window.confirm(`Delete unit "${unit.title}" and its lessons?`)) return;
                await mutate(async () => {
                  await api.deleteUnit(unit.id);
                  updateFromDetail(await api.getCourseDetail(course.id));
                }, 'Unit deleted.');
              }}
            />
            <aside className="course-context-column" aria-label="Class groups and collaborators">
              <section className="course-groups-panel" aria-labelledby="course-groups-title">
                <header className="course-panel-heading">
                  <div className="course-heading-label">
                    <h2 id="course-groups-title">Class groups</h2>
                    {schedule ? <span>{courseSections.length}</span> : null}
                  </div>
                  <button
                    className="secondary"
                    type="button"
                    aria-expanded={addingGroup}
                    onClick={() => {
                      setAddingGroup(!addingGroup);
                      setEditingSectionId(null);
                      setSectionName('');
                      setMeetings([blankMeeting()]);
                    }}
                  >
                    {addingGroup ? 'Cancel' : '+ Group'}
                  </button>
                </header>
                {scheduleError ? (
                  <p className="course-empty" role="alert">
                    Could not load class groups.{' '}
                    <button className="secondary" type="button" onClick={() => void loadSchedule()}>
                      Retry
                    </button>
                  </p>
                ) : !schedule ? (
                  <p className="course-empty" role="status">
                    Loading class groups…
                  </p>
                ) : !courseSections.length ? (
                  <p className="course-empty">
                    No class groups yet. Add a group to set meeting times.
                  </p>
                ) : null}
                {courseSections.map((section) => (
                  <div className="course-group" key={section.sectionId}>
                    <div className="course-group-heading">
                      <h3>{section.sectionName}</h3>
                      <button
                        className="secondary"
                        type="button"
                        aria-label={`Edit ${section.sectionName}`}
                        aria-expanded={editingSectionId === section.sectionId}
                        onClick={() =>
                          editingSectionId === section.sectionId
                            ? setEditingSectionId(null)
                            : editGroup(section)
                        }
                      >
                        {editingSectionId === section.sectionId ? 'Cancel' : 'Edit'}
                      </button>
                    </div>
                    {editingSectionId === section.sectionId ? (
                      groupForm
                    ) : section.meetings.length ? (
                      <ul className="course-meeting-list">
                        {sortCourseMeetings(section.meetings).map((meeting, index) => (
                          <li key={`${meeting.day}-${index}`}>
                            <strong>{meeting.day}</strong>
                            <span>
                              {timeRange(meeting.time, meeting.endTime)}
                              {meeting.room ? <small>{meeting.room}</small> : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="course-empty">No meeting times set.</p>
                    )}
                  </div>
                ))}
                {addingGroup ? groupForm : null}
              </section>
              <section className="course-sharing-panel" aria-labelledby="course-sharing-title">
                <header className="course-panel-heading">
                  <h2 id="course-sharing-title">Collaborators</h2>
                </header>
                <p className="course-sharing-note">
                  Share curriculum. Class schedules and progress stay private.
                </p>
                {collaboratorsError ? (
                  <p className="course-empty" role="alert">
                    Could not load collaborators.{' '}
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => void loadCollaborators()}
                    >
                      Retry
                    </button>
                  </p>
                ) : collaborators === null ? (
                  <p className="course-empty" role="status">
                    Loading collaborators…
                  </p>
                ) : collaborators.length ? (
                  <ul className="course-collaborator-list">
                    {collaborators.map((collaborator) => (
                      <li key={collaborator.userId}>
                        <div>
                          <strong>{collaborator.fullName ?? collaborator.email}</strong>
                          <small>
                            {collaborator.role === 'owner'
                              ? 'Owner'
                              : collaborator.status === 'invited'
                                ? 'Invitation pending'
                                : 'Can edit'}
                          </small>
                        </div>
                        {course.accessRole === 'owner' && collaborator.role === 'editor' ? (
                          <button
                            className="secondary"
                            type="button"
                            disabled={saving}
                            aria-label={`Remove ${collaborator.fullName ?? collaborator.email}`}
                            onClick={async () => {
                              if (
                                !window.confirm(
                                  `Remove ${collaborator.fullName ?? collaborator.email}?`
                                )
                              )
                                return;
                              await mutate(async () => {
                                await api.removeCourseCollaborator(course.id, collaborator.userId);
                                setCollaborators(
                                  (items) =>
                                    items?.filter((item) => item.userId !== collaborator.userId) ??
                                    null
                                );
                              }, 'Collaborator removed.');
                            }}
                          >
                            Remove
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="course-empty">No collaborators yet.</p>
                )}
                {course.accessRole === 'owner' ? (
                  <form
                    className="course-invite-form"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      if (
                        await mutate(async () => {
                          setCollaborators(
                            (
                              await api.inviteCourseCollaborator(course.id, {
                                email: collaboratorEmail.trim()
                              })
                            ).collaborators
                          );
                        }, 'Invitation sent.')
                      )
                        setCollaboratorEmail('');
                    }}
                  >
                    <label>
                      Invite by email
                      <input
                        className="input"
                        type="email"
                        value={collaboratorEmail}
                        onChange={(event) => setCollaboratorEmail(event.target.value)}
                        placeholder="teacher@school.edu"
                        required
                      />
                    </label>
                    <button type="submit" disabled={saving || !collaboratorEmail.trim()}>
                      Invite
                    </button>
                  </form>
                ) : null}
              </section>
            </aside>
          </div>
          <div className="course-secondary-panels">
            <details className="course-disclosure">
              <summary>Course settings</summary>
              <form
                className="course-settings-form course-inline-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  await mutate(
                    async () =>
                      updateFromDetail(
                        await api.updateCourse(course.id, {
                          name: courseName.trim(),
                          subject: courseSubject.trim() || null,
                          gradeLevel: courseGradeLevel.trim() || null
                        })
                      ),
                    'Course saved.'
                  );
                }}
              >
                {course.relationshipType === 'shared' ? (
                  <p>Using {course.curriculumName}. Renaming only changes your workspace.</p>
                ) : course.curriculumName !== course.name ? (
                  <p>Independent copy of {course.curriculumName}.</p>
                ) : null}
                <label>
                  Course name
                  <input
                    className="input"
                    value={courseName}
                    onChange={(event) => setCourseName(event.target.value)}
                    required
                  />
                </label>
                <label>
                  Subject
                  <input
                    className="input"
                    value={courseSubject}
                    onChange={(event) => setCourseSubject(event.target.value)}
                  />
                </label>
                <label>
                  Grade
                  <input
                    className="input"
                    value={courseGradeLevel}
                    onChange={(event) => setCourseGradeLevel(event.target.value)}
                  />
                </label>
                <button type="submit" disabled={saving || !courseName.trim()}>
                  {saving ? 'Saving…' : 'Save course'}
                </button>
              </form>
            </details>
            <details className="course-disclosure">
              <summary>Recent activity</summary>
              {activityError ? (
                <p className="course-empty" role="alert">
                  Could not load activity.{' '}
                  <button className="secondary" type="button" onClick={() => void loadActivity()}>
                    Retry
                  </button>
                </p>
              ) : activity === null ? (
                <p className="course-empty" role="status">
                  Loading activity…
                </p>
              ) : activity.length ? (
                <ul className="course-activity-list">
                  {activity.map((event) => (
                    <li key={event.id}>
                      <div>
                        <strong>
                          {event.actor?.fullName ?? event.actor?.email ?? 'A collaborator'}
                        </strong>
                        <span>{event.summary}</span>
                      </div>
                      <time dateTime={event.createdAt}>
                        {new Intl.DateTimeFormat(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit'
                        }).format(new Date(event.createdAt))}
                      </time>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="course-empty">No curriculum changes yet.</p>
              )}
            </details>
          </div>
        </>
      ) : null}
    </main>
  );
}
