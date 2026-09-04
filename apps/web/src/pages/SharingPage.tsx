import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type {
  CourseActivityResponse,
  CourseCollaboratorsResponse,
  CourseDetailResponse,
  CourseInvitationsResponse,
  CoursePacingResponse,
  CourseShareResponse,
  GetScheduleResponse,
  LessonShareResponse
} from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';

type Course = CourseDetailResponse['course'];
type SharingView = 'course' | 'lessons';

function lessonCount(course: Course): number {
  return course.units.reduce((count, unit) => count + unit.lessons.length, 0);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function formatActivityDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value));
}

export function SharingPage() {
  const api = useApiClient();
  const [params, setParams] = useSearchParams();
  const [courses, setCourses] = useState<Course[]>([]);
  const [schedule, setSchedule] = useState<GetScheduleResponse | null>(null);
  const [invitations, setInvitations] = useState<CourseInvitationsResponse['invitations']>([]);
  const [collaborators, setCollaborators] = useState<
    CourseCollaboratorsResponse['collaborators']
  >([]);
  const [activity, setActivity] = useState<CourseActivityResponse['activity']>([]);
  const [pacing, setPacing] = useState<CoursePacingResponse | null>(null);
  const [courseShare, setCourseShare] = useState<CourseShareResponse | null>(null);
  const [lessonShares, setLessonShares] = useState<Record<string, LessonShareResponse>>({});
  const [lessonSharesLoading, setLessonSharesLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [classToLink, setClassToLink] = useState('');
  const [lessonSearch, setLessonSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [courseLoading, setCourseLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedCourseId = params.get('course') ?? '';
  const view: SharingView = params.get('view') === 'lessons' ? 'lessons' : 'course';
  const selectedCourse = courses.find((course) => course.id === selectedCourseId) ?? courses[0] ?? null;

  const updateLocation = (courseId: string, nextView: SharingView = view) => {
    setParams({ course: courseId, view: nextView });
  };

  const loadPage = useCallback(async () => {
    try {
      setLoading(true);
      const [courseList, scheduleResult, invitationResult] = await Promise.all([
        api.listCourses(),
        api.getSchedule(),
        api.listCourseInvitations()
      ]);
      const details = await Promise.all(
        courseList.courses.map((course) => api.getCourseDetail(course.id))
      );
      setCourses(details.map((detail) => detail.course));
      setSchedule(scheduleResult);
      setInvitations(invitationResult.invitations);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load curriculum sharing.');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  useEffect(() => {
    if (!selectedCourse || selectedCourseId === selectedCourse.id) return;
    updateLocation(selectedCourse.id);
  }, [selectedCourse?.id, selectedCourseId]);

  useEffect(() => {
    if (!selectedCourse) return;
    let cancelled = false;
    setCourseLoading(true);
    setLessonShares({});
    setNotice(null);

    void Promise.all([
      api.getCourseCollaborators(selectedCourse.id),
      api.getCourseActivity(selectedCourse.id),
      api.getCoursePacing(selectedCourse.id),
      api.getCourseShare(selectedCourse.id)
    ])
      .then(([collaboratorResult, activityResult, pacingResult, shareResult]) => {
        if (cancelled) return;
        setCollaborators(collaboratorResult.collaborators);
        setActivity(activityResult.activity);
        setPacing(pacingResult);
        setCourseShare(shareResult);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof ApiError ? err.message : 'Could not load sharing settings.');
      })
      .finally(() => {
        if (!cancelled) {
          setCourseLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api, selectedCourse?.id, selectedCourse?.updatedAt]);

  useEffect(() => {
    if (!selectedCourse || view !== 'lessons') return;
    let cancelled = false;
    const lessons = selectedCourse.units.flatMap((unit) => unit.lessons);
    setLessonSharesLoading(true);
    void Promise.allSettled(
      lessons.map(async (lesson) => {
        const workspace = await api.getLessonWorkspace(lesson.id);
        return [lesson.id, workspace.share] as const;
      })
    )
      .then((results) => {
        if (cancelled) return;
        const loaded = results.flatMap((result) =>
          result.status === 'fulfilled' ? [result.value] : []
        );
        setLessonShares(Object.fromEntries(loaded));
        if (loaded.length !== lessons.length)
          setError('Some lesson links could not be loaded. Refresh to try again.');
      })
      .finally(() => {
        if (!cancelled) setLessonSharesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, selectedCourse?.id, selectedCourse?.updatedAt, view]);

  const linkedClasses = useMemo(
    () => schedule?.sections.filter((section) => section.courseId === selectedCourse?.id) ?? [],
    [schedule?.sections, selectedCourse?.id]
  );
  const availableClasses = useMemo(
    () => schedule?.sections.filter((section) => section.courseId !== selectedCourse?.id) ?? [],
    [schedule?.sections, selectedCourse?.id]
  );
  const sharedLessonCount = Object.values(lessonShares).filter((share) => share.enabled).length;
  const filteredUnits = useMemo(() => {
    if (!selectedCourse) return [];
    const query = lessonSearch.trim().toLocaleLowerCase();
    if (!query) return selectedCourse.units;
    return selectedCourse.units
      .map((unit) => ({
        ...unit,
        lessons: unit.lessons.filter((lesson) =>
          `${lesson.title} ${lesson.description ?? ''}`.toLocaleLowerCase().includes(query)
        )
      }))
      .filter((unit) => unit.lessons.length);
  }, [lessonSearch, selectedCourse]);

  const inviteCollaborator = async () => {
    if (!selectedCourse || !inviteEmail.trim()) return;
    try {
      setSavingKey('invite');
      setCollaborators(
        (await api.inviteCourseCollaborator(selectedCourse.id, { email: inviteEmail.trim() }))
          .collaborators
      );
      setNotice(`Invitation sent to ${inviteEmail.trim()}.`);
      setInviteEmail('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the invitation.');
    } finally {
      setSavingKey(null);
    }
  };

  const linkClass = async () => {
    if (!selectedCourse || !classToLink) return;
    const classGroup = schedule?.sections.find((section) => section.sectionId === classToLink);
    if (!classGroup) return;
    if (
      classGroup.courseId !== selectedCourse.id &&
      !window.confirm(
        `${classGroup.sectionName} currently uses ${classGroup.courseName}. Switch it to ${selectedCourse.name}? Its schedule and classroom history will stay with the class.`
      )
    )
      return;
    try {
      setSavingKey('class');
      setSchedule(await api.updateSection(classGroup.sectionId, { courseId: selectedCourse.id }));
      setClassToLink('');
      setNotice(`${selectedCourse.name} is now ready to use with ${classGroup.sectionName}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not connect that class.');
    } finally {
      setSavingKey(null);
    }
  };

  const setPublicCourseShare = async (enabled: boolean) => {
    if (!selectedCourse) return;
    try {
      setSavingKey('course-share');
      const share = await api.updateCourseShare(selectedCourse.id, enabled);
      setCourseShare(share);
      setNotice(enabled ? 'View-only course link is ready.' : 'View-only course link turned off.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the course link.');
    } finally {
      setSavingKey(null);
    }
  };

  const setLessonShare = async (lessonId: string, enabled: boolean) => {
    try {
      setSavingKey(`lesson-${lessonId}`);
      const share = await api.updateLessonShare(lessonId, enabled);
      setLessonShares((current) => ({ ...current, [lessonId]: share }));
      setNotice(enabled ? 'Lesson link is ready.' : 'Lesson link turned off.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the lesson link.');
    } finally {
      setSavingKey(null);
    }
  };

  const copyLink = async (path: string, message: string) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      setNotice(message);
    } catch {
      setError('Could not copy the link. You can open it and copy it from your browser.');
    }
  };

  const respondToInvitation = async (courseId: string, response: 'accept' | 'decline') => {
    try {
      setSavingKey(`invitation-${courseId}`);
      if (response === 'accept') await api.acceptCourseInvitation(courseId);
      else await api.declineCourseInvitation(courseId);
      await loadPage();
      if (response === 'accept') updateLocation(courseId);
      setNotice(response === 'accept' ? 'Course added to your sharing workspace.' : 'Invitation declined.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the invitation.');
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) {
    return (
      <main className="sharing-page sharing-loading-state">
        <div className="sharing-skeleton-title" />
        <div className="sharing-skeleton-grid" />
      </main>
    );
  }

  if (!selectedCourse) {
    return (
      <main className="sharing-empty-page page-entry">
        <span className="sharing-empty-mark" aria-hidden="true">
          ↗
        </span>
        <p className="eyebrow">Sharing</p>
        <h1>Start with a course</h1>
        <p>Create or import a course before inviting collaborators or sharing individual lessons.</p>
        <Link className="button-link" to="/courses">
          Go to Courses
        </Link>
      </main>
    );
  }

  return (
    <main className="sharing-page page-entry">
      <header className="sharing-page-header">
        <div>
          <p className="eyebrow">Curriculum collaboration</p>
          <h1>Sharing</h1>
          <p>Share the curriculum. Keep every teacher’s classes, pace, and history their own.</p>
        </div>
        <div className="sharing-boundary" aria-label="What stays private">
          <span>✓ Shared curriculum</span>
          <span>• Private schedules</span>
          <span>• Private class notes</span>
        </div>
      </header>

      {error ? (
        <div className="notice warning sharing-page-notice" role="alert">
          <span>{error}</span>
          <button className="button-link" type="button" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="notice success sharing-page-notice" role="status">
          <span>{notice}</span>
          <button className="button-link" type="button" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {invitations.length ? (
        <section className="sharing-invitations" aria-labelledby="sharing-invitations-title">
          <div className="sharing-invitation-intro">
            <span className="sharing-invitation-icon" aria-hidden="true">
              ✉
            </span>
            <div>
              <p className="eyebrow">Waiting for you</p>
              <h2 id="sharing-invitations-title">
                {invitations.length} course invitation{invitations.length === 1 ? '' : 's'}
              </h2>
            </div>
          </div>
          <div className="sharing-invitation-list">
            {invitations.map((invitation) => (
              <article key={invitation.course.id}>
                <div>
                  <strong>{invitation.course.name}</strong>
                  <span>from {invitation.invitedBy.fullName ?? invitation.invitedBy.email}</span>
                </div>
                <div>
                  <button
                    type="button"
                    disabled={savingKey === `invitation-${invitation.course.id}`}
                    onClick={() => void respondToInvitation(invitation.course.id, 'accept')}
                  >
                    Accept
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    disabled={savingKey === `invitation-${invitation.course.id}`}
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

      <div className="sharing-workspace">
        <aside className="sharing-course-rail" aria-label="Courses to share">
          <div className="sharing-rail-heading">
            <div>
              <p className="eyebrow">Your library</p>
              <h2>Courses</h2>
            </div>
            <span>{courses.length}</span>
          </div>
          <div className="sharing-course-list">
            {courses.map((course) => {
              const count = lessonCount(course);
              const isSelected = course.id === selectedCourse.id;
              return (
                <button
                  key={course.id}
                  className={isSelected ? 'active' : ''}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => updateLocation(course.id)}
                >
                  <span className="sharing-course-spine" aria-hidden="true" />
                  <span className="sharing-course-copy">
                    <strong>{course.name}</strong>
                    <small>
                      {course.units.length} unit{course.units.length === 1 ? '' : 's'} · {count}{' '}
                      lesson{count === 1 ? '' : 's'}
                    </small>
                  </span>
                  <span className={`sharing-role ${course.accessRole}`}>
                    {course.accessRole === 'owner' ? 'Mine' : 'Shared'}
                  </span>
                </button>
              );
            })}
          </div>
          <Link className="sharing-rail-link" to="/courses">
            + Add or import a course
          </Link>
        </aside>

        <section className="sharing-detail" aria-busy={courseLoading}>
          <div className="sharing-course-header">
            <div>
              <div className="sharing-course-kicker">
                <span>{selectedCourse.accessRole === 'owner' ? 'Course owner' : 'Course collaborator'}</span>
                {courseLoading ? <span>Refreshing…</span> : null}
              </div>
              <h2>{selectedCourse.name}</h2>
              <p>
                {[selectedCourse.subject, selectedCourse.gradeLevel].filter(Boolean).join(' · ') ||
                  'Shared curriculum'}
              </p>
            </div>
            <Link className="button-link secondary" to={`/courses/${selectedCourse.id}`}>
              Edit curriculum ↗
            </Link>
          </div>

          <nav className="sharing-view-tabs" aria-label="Sharing options">
            <button
              className={view === 'course' ? 'active' : ''}
              type="button"
              onClick={() => updateLocation(selectedCourse.id, 'course')}
            >
              <span>01</span>
              <strong>Course collaboration</strong>
              <small>Teachers, classes &amp; pacing</small>
            </button>
            <button
              className={view === 'lessons' ? 'active' : ''}
              type="button"
              onClick={() => updateLocation(selectedCourse.id, 'lessons')}
            >
              <span>02</span>
              <strong>Individual lessons</strong>
              <small>
                {view === 'lessons' && !lessonSharesLoading
                  ? `${sharedLessonCount} view-only links active`
                  : 'Choose view-only links'}
              </small>
            </button>
          </nav>

          {view === 'course' ? (
            <div className="sharing-course-view">
              <div className="sharing-primary-column">
                <section className="sharing-panel sharing-collaborator-panel">
                  <div className="sharing-panel-heading">
                    <div>
                      <p className="eyebrow">People</p>
                      <h3>Collaborate on this course</h3>
                      <p>Everyone here edits the same units and lessons.</p>
                    </div>
                    <span className="sharing-count-badge">{collaborators.length}</span>
                  </div>

                  <div className="sharing-privacy-rule">
                    <span aria-hidden="true">◇</span>
                    <p>
                      <strong>The boundary is simple:</strong> curriculum edits are shared; class
                      groups, schedules, progress, and classroom notes are not.
                    </p>
                  </div>

                  <div className="sharing-people-list">
                    {collaborators.map((collaborator) => (
                      <article key={collaborator.userId}>
                        <span className="sharing-avatar" aria-hidden="true">
                          {initials(collaborator.fullName ?? collaborator.email)}
                        </span>
                        <div>
                          <strong>{collaborator.fullName ?? collaborator.email}</strong>
                          <span>{collaborator.fullName ? collaborator.email : 'Teacher account'}</span>
                        </div>
                        <div className="sharing-person-role">
                          <strong>{collaborator.role === 'owner' ? 'Owner' : 'Can edit'}</strong>
                          <span>
                            {collaborator.status === 'invited' ? 'Invitation pending' : 'Active'}
                          </span>
                        </div>
                        {selectedCourse.accessRole === 'owner' && collaborator.role === 'editor' ? (
                          <button
                            className="sharing-remove-person"
                            type="button"
                            aria-label={`Remove ${collaborator.fullName ?? collaborator.email}`}
                            disabled={savingKey === `remove-${collaborator.userId}`}
                            onClick={async () => {
                              if (
                                !window.confirm(
                                  `Remove ${collaborator.fullName ?? collaborator.email} from ${selectedCourse.name}?`
                                )
                              )
                                return;
                              try {
                                setSavingKey(`remove-${collaborator.userId}`);
                                await api.removeCourseCollaborator(
                                  selectedCourse.id,
                                  collaborator.userId
                                );
                                setCollaborators((current) =>
                                  current.filter((person) => person.userId !== collaborator.userId)
                                );
                                setNotice('Collaborator removed.');
                              } catch (err) {
                                setError(
                                  err instanceof ApiError
                                    ? err.message
                                    : 'Could not remove the collaborator.'
                                );
                              } finally {
                                setSavingKey(null);
                              }
                            }}
                          >
                            ×
                          </button>
                        ) : null}
                      </article>
                    ))}
                  </div>

                  {selectedCourse.accessRole === 'owner' ? (
                    <form
                      className="sharing-invite-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void inviteCollaborator();
                      }}
                    >
                      <label>
                        <span>Invite a teacher by email</span>
                        <input
                          className="input"
                          type="email"
                          required
                          value={inviteEmail}
                          onChange={(event) => setInviteEmail(event.target.value)}
                          placeholder="colleague@school.edu"
                        />
                      </label>
                      <button type="submit" disabled={savingKey === 'invite' || !inviteEmail.trim()}>
                        {savingKey === 'invite' ? 'Sending…' : 'Send invite'}
                      </button>
                    </form>
                  ) : null}
                </section>

                <section className="sharing-panel sharing-class-panel">
                  <div className="sharing-panel-heading">
                    <div>
                      <p className="eyebrow">Your classroom</p>
                      <h3>Use this curriculum with my classes</h3>
                      <p>A class connects to the shared course but keeps its own teaching record.</p>
                    </div>
                  </div>
                  <div className="sharing-linked-classes">
                    {linkedClasses.length ? (
                      linkedClasses.map((classGroup) => (
                        <article key={classGroup.sectionId}>
                          <span className="sharing-class-icon" aria-hidden="true">
                            ⌂
                          </span>
                          <div>
                            <strong>{classGroup.sectionName}</strong>
                            <span>
                              {classGroup.meetings.length
                                ? classGroup.meetings.map((meeting) => meeting.day).join(', ')
                                : 'Schedule not added yet'}
                            </span>
                          </div>
                          <span className="sharing-connected-status">✓ Connected</span>
                        </article>
                      ))
                    ) : (
                      <div className="sharing-inline-empty">
                        <strong>No class is using this curriculum yet</strong>
                        <span>Connect one below when you are ready to teach it.</span>
                      </div>
                    )}
                  </div>
                  {availableClasses.length ? (
                    <div className="sharing-class-linker">
                      <label>
                        <span>Add this curriculum to another class</span>
                        <select
                          className="input"
                          value={classToLink}
                          onChange={(event) => setClassToLink(event.target.value)}
                        >
                          <option value="">Choose one of my classes…</option>
                          {availableClasses.map((section) => (
                            <option key={section.sectionId} value={section.sectionId}>
                              {section.sectionName} · currently using {section.courseName}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        disabled={!classToLink || savingKey === 'class'}
                        onClick={() => void linkClass()}
                      >
                        {savingKey === 'class' ? 'Connecting…' : 'Connect class'}
                      </button>
                    </div>
                  ) : (
                    <Link className="sharing-text-link" to="/courses?import=schedule">
                      Import or create another class →
                    </Link>
                  )}
                </section>
              </div>

              <aside className="sharing-secondary-column">
                <section className="sharing-panel sharing-public-panel">
                  <div className="sharing-panel-heading compact">
                    <div>
                      <p className="eyebrow">Outside TeacherDesk</p>
                      <h3>View-only course link</h3>
                    </div>
                  </div>
                  <p>For a substitute, department lead, or anyone who should not edit.</p>
                  <label className="sharing-toggle-row">
                    <span>
                      <strong>{courseShare?.enabled ? 'Link is on' : 'Link is off'}</strong>
                      <small>Anyone with the link can view</small>
                    </span>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={courseShare?.enabled ?? false}
                      disabled={
                        selectedCourse.accessRole !== 'owner' || savingKey === 'course-share'
                      }
                      onChange={(event) => void setPublicCourseShare(event.target.checked)}
                    />
                  </label>
                  {courseShare?.enabled && courseShare.token ? (
                    <div className="sharing-link-actions">
                      <button
                        type="button"
                        onClick={() =>
                          void copyLink(
                            `/shared/curriculum/${courseShare.token}`,
                            'Course link copied.'
                          )
                        }
                      >
                        Copy course link
                      </button>
                      <a
                        href={`/shared/curriculum/${courseShare.token}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Preview ↗
                      </a>
                    </div>
                  ) : null}
                  {selectedCourse.accessRole !== 'owner' ? (
                    <small className="sharing-owner-note">Only the course owner can manage this link.</small>
                  ) : null}
                </section>

                <section className="sharing-panel sharing-pacing-panel">
                  <div className="sharing-panel-heading compact">
                    <div>
                      <p className="eyebrow">Optional</p>
                      <h3>Compare pacing</h3>
                    </div>
                  </div>
                  <p>Let collaborators see which lesson each of your connected classes is on.</p>
                  <label className="sharing-toggle-row">
                    <span>
                      <strong>Share my class positions</strong>
                      <small>Never changes anyone’s plan</small>
                    </span>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={pacing?.sharingEnabled ?? false}
                      disabled={!pacing || savingKey === 'pacing'}
                      onChange={async (event) => {
                        try {
                          setSavingKey('pacing');
                          setPacing(
                            await api.updateCoursePacingSharing(selectedCourse.id, {
                              enabled: event.target.checked
                            })
                          );
                          setNotice(
                            event.target.checked
                              ? 'Your class positions are now visible to collaborators.'
                              : 'Your class positions are private.'
                          );
                        } catch (err) {
                          setError(
                            err instanceof ApiError ? err.message : 'Could not update pacing.'
                          );
                        } finally {
                          setSavingKey(null);
                        }
                      }}
                    />
                  </label>
                  {pacing?.participants.some((participant) => participant.classGroups.length) ? (
                    <div className="sharing-pacing-list">
                      {pacing.participants
                        .filter((participant) => participant.classGroups.length)
                        .map((participant) => (
                          <div key={participant.userId}>
                            <strong>
                              {participant.fullName ?? participant.email}
                              {participant.isCurrentUser ? ' (you)' : ''}
                            </strong>
                            {participant.classGroups.map((classGroup) => (
                              <span key={classGroup.sectionId}>
                                {classGroup.sectionName}: {classGroup.lessonTitle ?? 'Not started'}
                              </span>
                            ))}
                          </div>
                        ))}
                    </div>
                  ) : null}
                </section>

                <section className="sharing-panel sharing-activity-panel">
                  <div className="sharing-panel-heading compact">
                    <div>
                      <p className="eyebrow">Live history</p>
                      <h3>Recent changes</h3>
                    </div>
                  </div>
                  {activity.length ? (
                    <ol>
                      {activity.slice(0, 5).map((event) => (
                        <li key={event.id}>
                          <span className="sharing-activity-dot" aria-hidden="true" />
                          <div>
                            <strong>{event.actor?.fullName ?? event.actor?.email ?? 'A collaborator'}</strong>
                            <p>{event.summary}</p>
                            <time dateTime={event.createdAt}>{formatActivityDate(event.createdAt)}</time>
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p>No shared changes yet.</p>
                  )}
                </section>
              </aside>
            </div>
          ) : (
            <div className="sharing-lessons-view">
              <div className="sharing-lessons-toolbar">
                <div>
                  <p className="eyebrow">View-only sharing</p>
                  <h3>Choose exactly what to send</h3>
                  <p>Each lesson gets its own link. The rest of the course stays private.</p>
                </div>
                <label className="sharing-lesson-search">
                  <span className="visually-hidden">Search lessons</span>
                  <span aria-hidden="true">⌕</span>
                  <input
                    type="search"
                    value={lessonSearch}
                    onChange={(event) => setLessonSearch(event.target.value)}
                    placeholder="Find a lesson…"
                  />
                </label>
              </div>

              {lessonSharesLoading ? (
                <div className="sharing-lesson-loading">Loading lesson links…</div>
              ) : filteredUnits.length ? (
                <div className="sharing-unit-list">
                  {filteredUnits.map((unit, unitIndex) => (
                    <section key={unit.id} className="sharing-unit-group">
                      <header>
                        <span>{String(unitIndex + 1).padStart(2, '0')}</span>
                        <div>
                          <h4>{unit.title}</h4>
                          <p>
                            {unit.lessons.length} lesson{unit.lessons.length === 1 ? '' : 's'}
                          </p>
                        </div>
                      </header>
                      <div className="sharing-lesson-list">
                        {unit.lessons.map((lesson) => {
                          const share = lessonShares[lesson.id];
                          const isSaving = savingKey === `lesson-${lesson.id}`;
                          return (
                            <article key={lesson.id}>
                              <span className="sharing-lesson-number">{lesson.orderIndex + 1}</span>
                              <div className="sharing-lesson-copy">
                                <strong>{lesson.title}</strong>
                                <span>
                                  {lesson.estimatedDurationMinutes
                                    ? `${lesson.estimatedDurationMinutes} min · `
                                    : ''}
                                  {lesson.segments.length} step
                                  {lesson.segments.length === 1 ? '' : 's'}
                                </span>
                              </div>
                              <label className="sharing-lesson-toggle">
                                <input
                                  type="checkbox"
                                  role="switch"
                                  checked={share?.enabled ?? false}
                                  disabled={!share || isSaving}
                                  onChange={(event) =>
                                    void setLessonShare(lesson.id, event.target.checked)
                                  }
                                />
                                <span>{share?.enabled ? 'Link on' : 'Private'}</span>
                              </label>
                              <div className="sharing-lesson-actions">
                                {share?.enabled && share.token ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void copyLink(
                                          `/shared/lessons/${share.token}`,
                                          `${lesson.title} link copied.`
                                        )
                                      }
                                    >
                                      Copy link
                                    </button>
                                    <a
                                      href={`/shared/lessons/${share.token}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      aria-label={`Preview ${lesson.title}`}
                                    >
                                      ↗
                                    </a>
                                  </>
                                ) : (
                                  <Link to={`/lessons/${lesson.id}`}>Open lesson</Link>
                                )}
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="sharing-inline-empty sharing-lesson-empty">
                  <strong>{lessonSearch ? 'No lessons match that search' : 'No lessons yet'}</strong>
                  <span>
                    {lessonSearch
                      ? 'Try a different title or keyword.'
                      : 'Add lessons to this course before creating individual links.'}
                  </span>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
