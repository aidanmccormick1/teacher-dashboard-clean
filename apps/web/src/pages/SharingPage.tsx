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

const previewCourseId = '00000000-0000-4000-8000-000000000001';
const previewCourseTwoId = '00000000-0000-4000-8000-000000000002';
const previewCourseThreeId = '00000000-0000-4000-8000-000000000003';

const previewCourses = [
  {
    id: previewCourseId,
    curriculumId: previewCourseId,
    curriculumName: 'Spanish 6',
    relationshipType: 'independent' as const,
    name: 'Spanish 6',
    subject: 'Spanish',
    gradeLevel: 'Grade 6',
    sortIndex: 0,
    archivedAt: null,
    createdAt: '2026-08-12T15:00:00.000Z',
    updatedAt: '2026-09-04T18:30:00.000Z',
    accessRole: 'owner',
    lifecycle: 'active',
    linkedClassGroupCount: 2,
    units: [
      {
        id: '00000000-0000-4000-8000-000000000011',
        title: 'Getting to know each other',
        description: 'Build classroom language and confidence.',
        orderIndex: 0,
        plannedStartMeeting: 0,
        plannedMeetingCount: 8,
        lessons: [
          {
            id: '00000000-0000-4000-8000-000000000101',
            title: 'Welcome to Spanish 6',
            description: 'Introductions, routines, and useful classroom phrases.',
            lessonPlan: {
              objective: 'Introduce yourself and follow core classroom routines.',
              teacherNotes: null,
              studentDirections: null,
              materials: 'Name cards, mini whiteboards',
              links: []
            },
            orderIndex: 0,
            estimatedDurationMinutes: 45,
            plannedStartMeeting: 0,
            plannedMeetingCount: 1,
            segments: [
              {
                id: '00000000-0000-4000-8000-000000001101',
                title: 'Greeting circle',
                description: null,
                durationMinutes: 10,
                stepType: null,
                orderIndex: 0
              },
              {
                id: '00000000-0000-4000-8000-000000001102',
                title: 'Classroom language practice',
                description: null,
                durationMinutes: 25,
                stepType: null,
                orderIndex: 1
              }
            ]
          },
          {
            id: '00000000-0000-4000-8000-000000000102',
            title: 'Names and introductions',
            description: 'Ask and answer simple personal questions.',
            lessonPlan: {
              objective: 'Exchange names and one personal detail.',
              teacherNotes: null,
              studentDirections: null,
              materials: 'Conversation cards',
              links: []
            },
            orderIndex: 1,
            estimatedDurationMinutes: 45,
            plannedStartMeeting: 1,
            plannedMeetingCount: 2,
            segments: [
              {
                id: '00000000-0000-4000-8000-000000001103',
                title: 'Model dialogue',
                description: null,
                durationMinutes: 12,
                stepType: null,
                orderIndex: 0
              },
              {
                id: '00000000-0000-4000-8000-000000001104',
                title: 'Partner rotations',
                description: null,
                durationMinutes: 25,
                stepType: null,
                orderIndex: 1
              },
              {
                id: '00000000-0000-4000-8000-000000001105',
                title: 'Exit reflection',
                description: null,
                durationMinutes: 8,
                stepType: null,
                orderIndex: 2
              }
            ]
          }
        ]
      },
      {
        id: '00000000-0000-4000-8000-000000000012',
        title: 'Animals and habitats',
        description: 'High-frequency vocabulary through familiar animals.',
        orderIndex: 1,
        plannedStartMeeting: 8,
        plannedMeetingCount: 10,
        lessons: [
          {
            id: '00000000-0000-4000-8000-000000000103',
            title: 'Zoo vocabulary: common animals',
            description: 'Recognize and describe familiar zoo animals.',
            lessonPlan: {
              objective: 'Name and describe ten common animals.',
              teacherNotes: null,
              studentDirections: null,
              materials: 'Animal image cards',
              links: []
            },
            orderIndex: 0,
            estimatedDurationMinutes: 50,
            plannedStartMeeting: 8,
            plannedMeetingCount: 2,
            segments: [
              {
                id: '00000000-0000-4000-8000-000000001106',
                title: 'Image sort',
                description: null,
                durationMinutes: 12,
                stepType: null,
                orderIndex: 0
              },
              {
                id: '00000000-0000-4000-8000-000000001107',
                title: 'Describe and guess',
                description: null,
                durationMinutes: 25,
                stepType: null,
                orderIndex: 1
              },
              {
                id: '00000000-0000-4000-8000-000000001108',
                title: 'Quick check',
                description: null,
                durationMinutes: 8,
                stepType: null,
                orderIndex: 2
              }
            ]
          },
          {
            id: '00000000-0000-4000-8000-000000000104',
            title: 'Where animals live',
            description: 'Connect animals with habitats and regions.',
            lessonPlan: {
              objective: 'Say where an animal lives using a complete sentence.',
              teacherNotes: null,
              studentDirections: null,
              materials: 'Habitat map',
              links: []
            },
            orderIndex: 1,
            estimatedDurationMinutes: 45,
            plannedStartMeeting: 10,
            plannedMeetingCount: 2,
            segments: []
          },
          {
            id: '00000000-0000-4000-8000-000000000105',
            title: 'Design a mini zoo',
            description: 'Apply animal and habitat language in a small-group task.',
            lessonPlan: {
              objective: 'Present a habitat plan using target vocabulary.',
              teacherNotes: null,
              studentDirections: null,
              materials: 'Poster paper, markers',
              links: []
            },
            orderIndex: 2,
            estimatedDurationMinutes: 60,
            plannedStartMeeting: 12,
            plannedMeetingCount: 2,
            segments: []
          }
        ]
      }
    ]
  },
  {
    id: previewCourseTwoId,
    curriculumId: previewCourseId,
    curriculumName: 'Spanish 6',
    relationshipType: 'shared' as const,
    name: 'Spanish 5',
    subject: 'Spanish',
    gradeLevel: 'Grade 5',
    sortIndex: 1,
    archivedAt: null,
    createdAt: '2026-08-10T15:00:00.000Z',
    updatedAt: '2026-09-03T18:30:00.000Z',
    accessRole: 'editor',
    lifecycle: 'active',
    linkedClassGroupCount: 1,
    units: []
  },
  {
    id: previewCourseThreeId,
    curriculumId: previewCourseThreeId,
    curriculumName: 'Advisory',
    relationshipType: 'independent' as const,
    name: 'Advisory',
    subject: 'Student life',
    gradeLevel: 'Grade 6',
    sortIndex: 2,
    archivedAt: null,
    createdAt: '2026-08-18T15:00:00.000Z',
    updatedAt: '2026-09-01T18:30:00.000Z',
    accessRole: 'owner',
    lifecycle: 'unlinked',
    linkedClassGroupCount: 0,
    units: []
  }
] satisfies Course[];

const previewSchedule = {
  sections: [
    {
      sectionId: '00000000-0000-4000-8000-000000000201',
      courseId: previewCourseId,
      courseName: 'Spanish 6',
      sectionName: 'Group A',
      meetings: [
        { day: 'Monday', time: '09:10', endTime: '09:55', room: 'Room 204' },
        { day: 'Wednesday', time: '09:10', endTime: '09:55', room: 'Room 204' }
      ]
    },
    {
      sectionId: '00000000-0000-4000-8000-000000000202',
      courseId: previewCourseId,
      courseName: 'Spanish 6',
      sectionName: 'Group C',
      meetings: [
        { day: 'Tuesday', time: '13:20', endTime: '14:05', room: 'Room 204' },
        { day: 'Thursday', time: '13:20', endTime: '14:05', room: 'Room 204' }
      ]
    },
    {
      sectionId: '00000000-0000-4000-8000-000000000203',
      courseId: previewCourseTwoId,
      courseName: 'Spanish 5',
      sectionName: 'Period 3',
      meetings: [{ day: 'Friday', time: '10:10', endTime: '10:55', room: 'Room 204' }]
    }
  ],
  holidays: []
} satisfies GetScheduleResponse;

const previewCollaborators = [
  {
    userId: '00000000-0000-4000-8000-000000000301',
    email: 'aidan@calico.edu',
    fullName: 'Aidan McCormick',
    role: 'owner',
    status: 'accepted',
    invitedByUserId: null,
    joinedAt: '2026-08-12T15:00:00.000Z'
  },
  {
    userId: '00000000-0000-4000-8000-000000000302',
    email: 'maria.santos@calico.edu',
    fullName: 'Maria Santos',
    role: 'editor',
    status: 'accepted',
    invitedByUserId: '00000000-0000-4000-8000-000000000301',
    joinedAt: '2026-08-20T15:00:00.000Z'
  },
  {
    userId: '00000000-0000-4000-8000-000000000303',
    email: 'jlee@calico.edu',
    fullName: 'Jordan Lee',
    role: 'editor',
    status: 'invited',
    invitedByUserId: '00000000-0000-4000-8000-000000000301',
    joinedAt: null
  }
] satisfies CourseCollaboratorsResponse['collaborators'];

const previewPacing = {
  sharingEnabled: true,
  participants: [
    {
      userId: '00000000-0000-4000-8000-000000000301',
      fullName: 'Aidan McCormick',
      email: 'aidan@calico.edu',
      isCurrentUser: true,
      classGroups: [
        {
          sectionId: '00000000-0000-4000-8000-000000000201',
          sectionName: 'Group A',
          lessonId: '00000000-0000-4000-8000-000000000103',
          lessonTitle: 'Zoo vocabulary: common animals',
          lessonOrderIndex: 0,
          status: 'in_progress',
          lastTaughtDate: '2026-09-03'
        },
        {
          sectionId: '00000000-0000-4000-8000-000000000202',
          sectionName: 'Group C',
          lessonId: '00000000-0000-4000-8000-000000000102',
          lessonTitle: 'Names and introductions',
          lessonOrderIndex: 1,
          status: 'in_progress',
          lastTaughtDate: '2026-09-02'
        }
      ]
    },
    {
      userId: '00000000-0000-4000-8000-000000000302',
      fullName: 'Maria Santos',
      email: 'maria.santos@calico.edu',
      isCurrentUser: false,
      classGroups: [
        {
          sectionId: '00000000-0000-4000-8000-000000000204',
          sectionName: '6B Spanish',
          lessonId: '00000000-0000-4000-8000-000000000103',
          lessonTitle: 'Zoo vocabulary: common animals',
          lessonOrderIndex: 0,
          status: 'in_progress',
          lastTaughtDate: '2026-09-03'
        }
      ]
    }
  ]
} satisfies CoursePacingResponse;

const previewActivity = [
  {
    id: '00000000-0000-4000-8000-000000000401',
    action: 'lesson_updated',
    summary: 'updated Zoo vocabulary: common animals',
    subjectType: 'lesson',
    subjectId: '00000000-0000-4000-8000-000000000103',
    actor: {
      userId: '00000000-0000-4000-8000-000000000302',
      fullName: 'Maria Santos',
      email: 'maria.santos@calico.edu'
    },
    createdAt: '2026-09-04T18:22:00.000Z'
  },
  {
    id: '00000000-0000-4000-8000-000000000402',
    action: 'lesson_comment_added',
    summary: 'commented on Names and introductions',
    subjectType: 'lesson',
    subjectId: '00000000-0000-4000-8000-000000000102',
    actor: {
      userId: '00000000-0000-4000-8000-000000000301',
      fullName: 'Aidan McCormick',
      email: 'aidan@calico.edu'
    },
    createdAt: '2026-09-04T17:08:00.000Z'
  }
] satisfies CourseActivityResponse['activity'];

const previewLessonShares: Record<string, LessonShareResponse> = {
  '00000000-0000-4000-8000-000000000101': {
    enabled: true,
    token: '00000000-0000-4000-8000-000000000501'
  },
  '00000000-0000-4000-8000-000000000102': { enabled: false, token: null },
  '00000000-0000-4000-8000-000000000103': {
    enabled: true,
    token: '00000000-0000-4000-8000-000000000503'
  },
  '00000000-0000-4000-8000-000000000104': { enabled: false, token: null },
  '00000000-0000-4000-8000-000000000105': { enabled: false, token: null }
};

export function SharingPage() {
  const api = useApiClient();
  const [params, setParams] = useSearchParams();
  const isDesignPreview = import.meta.env.DEV && params.get('preview') === 'design';
  const [courses, setCourses] = useState<Course[]>([]);
  const [schedule, setSchedule] = useState<GetScheduleResponse | null>(null);
  const [invitations, setInvitations] = useState<CourseInvitationsResponse['invitations']>([]);
  const [collaborators, setCollaborators] = useState<CourseCollaboratorsResponse['collaborators']>(
    []
  );
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
  const selectedCourse =
    courses.find((course) => course.id === selectedCourseId) ?? courses[0] ?? null;

  const updateLocation = useCallback(
    (courseId: string, nextView: SharingView = view) => {
      setParams({
        course: courseId,
        view: nextView,
        ...(isDesignPreview ? { preview: 'design' } : {})
      });
    },
    [isDesignPreview, setParams, view]
  );

  const loadPage = useCallback(async () => {
    try {
      setLoading(true);
      if (isDesignPreview) {
        setCourses(previewCourses);
        setSchedule(previewSchedule);
        setInvitations([]);
        setError(null);
        return;
      }
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
  }, [api, isDesignPreview]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  useEffect(() => {
    if (!selectedCourse || selectedCourseId === selectedCourse.id) return;
    updateLocation(selectedCourse.id);
  }, [selectedCourse, selectedCourseId, updateLocation]);

  useEffect(() => {
    if (!selectedCourse) return;
    if (isDesignPreview) {
      setCollaborators(previewCollaborators);
      setActivity(previewActivity);
      setPacing(previewPacing);
      setCourseShare({
        enabled: true,
        token: '00000000-0000-4000-8000-000000000500'
      });
      setLessonShares(previewLessonShares);
      setCourseLoading(false);
      return;
    }
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
  }, [api, isDesignPreview, selectedCourse]);

  useEffect(() => {
    if (!selectedCourse || view !== 'lessons') return;
    if (isDesignPreview) {
      setLessonShares(previewLessonShares);
      setLessonSharesLoading(false);
      return;
    }
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
  }, [api, isDesignPreview, selectedCourse, view]);

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
    if (isDesignPreview) {
      const email = inviteEmail.trim();
      setCollaborators((current) => [
        ...current,
        {
          userId: crypto.randomUUID(),
          email,
          fullName: null,
          role: 'editor',
          status: 'invited',
          invitedByUserId: '00000000-0000-4000-8000-000000000301',
          joinedAt: null
        }
      ]);
      setInviteEmail('');
      setNotice(`Invitation preview created for ${email}.`);
      return;
    }
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
    if (isDesignPreview) {
      setSchedule((current) =>
        current
          ? {
              ...current,
              sections: current.sections.map((section) =>
                section.sectionId === classGroup.sectionId
                  ? {
                      ...section,
                      courseId: selectedCourse.id,
                      courseName: selectedCourse.name
                    }
                  : section
              )
            }
          : current
      );
      setClassToLink('');
      setNotice(`${selectedCourse.name} is now ready to use with ${classGroup.sectionName}.`);
      return;
    }
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
    if (isDesignPreview) {
      setCourseShare({
        enabled,
        token: enabled ? '00000000-0000-4000-8000-000000000500' : null
      });
      setNotice(enabled ? 'View-only course link is ready.' : 'View-only course link turned off.');
      return;
    }
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
    if (isDesignPreview) {
      setLessonShares((current) => ({
        ...current,
        [lessonId]: {
          enabled,
          token: enabled ? (current[lessonId]?.token ?? crypto.randomUUID()) : null
        }
      }));
      setNotice(enabled ? 'Lesson link is ready.' : 'Lesson link turned off.');
      return;
    }
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
    if (isDesignPreview) {
      setInvitations((current) =>
        current.filter((invitation) => invitation.course.id !== courseId)
      );
      setNotice(
        response === 'accept' ? 'Course added to your sharing workspace.' : 'Invitation declined.'
      );
      return;
    }
    try {
      setSavingKey(`invitation-${courseId}`);
      if (response === 'accept') {
        const invitation = invitations.find((item) => item.course.id === courseId);
        await api.acceptCourseInvitation(courseId, {
          mode: 'collaborate',
          name: invitation?.course.curriculumName ?? 'My course'
        });
      }
      else await api.declineCourseInvitation(courseId);
      await loadPage();
      if (response === 'accept') updateLocation(courseId);
      setNotice(
        response === 'accept' ? 'Course added to your sharing workspace.' : 'Invitation declined.'
      );
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
        <p className="eyebrow">Sharing</p>
        <h1>{error ? 'Sharing could not load' : 'Start with a course'}</h1>
        <p>
          {error
            ? error
            : 'Create or import a course before inviting collaborators or sharing individual lessons.'}
        </p>
        {error ? (
          <button className="button-link" type="button" onClick={() => void loadPage()}>
            Try again
          </button>
        ) : (
          <Link className="button-link" to="/courses">
            Go to Courses
          </Link>
        )}
      </main>
    );
  }

  return (
    <main className="sharing-page page-entry">
      <header className="sharing-page-header">
        <div>
          <p className="eyebrow">Sharing</p>
          <h1>Share {selectedCourse.name}</h1>
          <p>Collaborate on the curriculum or share individual lessons.</p>
        </div>
        <div className="sharing-boundary" aria-label="What stays private">
          {isDesignPreview ? (
            <span className="sharing-preview-label">Design preview data</span>
          ) : null}
            <span>Shared curriculum</span>
            <span>Private schedules</span>
            <span>Private notes</span>
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
                <span>{selectedCourse.relationshipType === 'shared' ? `Using curriculum: ${selectedCourse.curriculumName}` : 'My curriculum'}</span>
                {courseLoading ? <span>Refreshing…</span> : null}
              </div>
              <h2>{selectedCourse.name}</h2>
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
              <strong>Share course</strong>
              <small>Collaborators, classes, and optional progress</small>
            </button>
            <button
              className={view === 'lessons' ? 'active' : ''}
              type="button"
              onClick={() => updateLocation(selectedCourse.id, 'lessons')}
            >
              <strong>Share lessons</strong>
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
                      <p className="eyebrow">Collaborators</p>
                      <h3>Everyone here can edit this curriculum.</h3>
                      <p>Classes, schedules, progress, and notes stay private.</p>
                    </div>
                    <span className="sharing-count-badge">{collaborators.length}</span>
                  </div>

                  <div className="sharing-people-list">
                    {collaborators.map((collaborator) => (
                      <article key={collaborator.userId}>
                        <span className="sharing-avatar" aria-hidden="true">
                          {initials(collaborator.fullName ?? collaborator.email)}
                        </span>
                        <div>
                          <strong>{collaborator.fullName ?? collaborator.email}</strong>
                          <span>
                            {collaborator.fullName ? collaborator.email : 'Teacher account'}
                          </span>
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
                              if (isDesignPreview) {
                                setCollaborators((current) =>
                                  current.filter((person) => person.userId !== collaborator.userId)
                                );
                                setNotice('Collaborator removed from the preview.');
                                return;
                              }
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
                        <span>Invite collaborator</span>
                        <input
                          className="input"
                          type="email"
                          required
                          value={inviteEmail}
                          onChange={(event) => setInviteEmail(event.target.value)}
                          placeholder="colleague@school.edu"
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={savingKey === 'invite' || !inviteEmail.trim()}
                      >
                        {savingKey === 'invite' ? 'Sending…' : 'Send invite'}
                      </button>
                    </form>
                  ) : null}
                </section>

                <section className="sharing-panel sharing-class-panel">
                  <div className="sharing-panel-heading">
                    <div>
                      <p className="eyebrow">My classes</p>
                      <h3>Classes using this curriculum</h3>
                    </div>
                  </div>
                  <div className="sharing-linked-classes">
                    {linkedClasses.length ? (
                      linkedClasses.map((classGroup) => (
                        <article key={classGroup.sectionId}>
                          <div>
                            <strong>{classGroup.sectionName}</strong>
                            <span>
                              {classGroup.meetings.length
                                ? classGroup.meetings.map((meeting) => meeting.day).join(', ')
                                : 'Schedule not added yet'}
                            </span>
                          </div>
                          <span className="sharing-connected-status">Connected</span>
                        </article>
                      ))
                    ) : (
                      <div className="sharing-inline-empty">
                        <strong>No class is connected yet</strong>
                        <span>Connect a scheduled class when you are ready.</span>
                      </div>
                    )}
                  </div>
                  {availableClasses.length ? (
                    <div className="sharing-class-linker">
                      <label>
                        <span>Connect another class</span>
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
                        {savingKey === 'class' ? 'Connecting…' : 'Connect'}
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
                      <p className="eyebrow">Course link</p>
                      <h3>Share a view-only copy</h3>
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
                    <small className="sharing-owner-note">
                      Only the course owner can manage this link.
                    </small>
                  ) : null}
                </section>

                <section className="sharing-panel sharing-pacing-panel">
                  <div className="sharing-panel-heading compact">
                    <div>
                      <p className="eyebrow">Pace sharing</p>
                      <h3>Share my class progress</h3>
                    </div>
                  </div>
                  <p>Let collaborators see where my classes are in the curriculum.</p>
                  <label className="sharing-toggle-row">
                    <span>
                      <strong>{pacing?.sharingEnabled ? 'Share progress' : 'Share progress'}</strong>
                      <small>Progress stays private unless you turn this on.</small>
                    </span>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={pacing?.sharingEnabled ?? false}
                      disabled={!pacing || savingKey === 'pacing'}
                      onChange={async (event) => {
                        if (isDesignPreview) {
                          setPacing((current) =>
                            current ? { ...current, sharingEnabled: event.target.checked } : current
                          );
                          setNotice(
                            event.target.checked
                              ? 'Your class positions are now visible to collaborators.'
                              : 'Your class positions are private.'
                          );
                          return;
                        }
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
                      <p className="eyebrow">Activity</p>
                      <h3>Recent curriculum changes</h3>
                    </div>
                  </div>
                  {activity.length ? (
                    <ol>
                      {activity.slice(0, 5).map((event) => (
                        <li key={event.id}>
                          <span className="sharing-activity-dot" aria-hidden="true" />
                          <div>
                            <strong>
                              {event.actor?.fullName ?? event.actor?.email ?? 'A collaborator'}
                            </strong>
                            <p>{event.summary}</p>
                            <time dateTime={event.createdAt}>
                              {formatActivityDate(event.createdAt)}
                            </time>
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
                  <strong>
                    {lessonSearch ? 'No lessons match that search' : 'No lessons yet'}
                  </strong>
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
