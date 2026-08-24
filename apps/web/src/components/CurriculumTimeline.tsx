import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from 'react';

import type {
  CourseDetailResponse,
  GetScheduleResponse,
  MeetingInstancesResponse
} from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';
import './CurriculumTimeline.css';

type Course = CourseDetailResponse['course'];
type Unit = Course['units'][number];
type Lesson = Unit['lessons'][number];
type Section = GetScheduleResponse['sections'][number];
type SchoolYearSettings = {
  startDate: string;
  endDate: string;
  meetingDays: string[];
  bellScheduleType: 'weekly' | 'block' | 'ab' | 'rotating';
};
type Zoom = 'year' | 'quarter' | 'month' | 'week';
type Selection = { type: 'unit' | 'lesson'; id: string } | null;
type PositionedUnit = { unit: Unit; start: number; span: number };
type PendingChange =
  | { kind: 'move'; unit: PositionedUnit; start: number; delta: number }
  | { kind: 'resize'; unit: PositionedUnit; span: number; delta: number };
type Drag = { unit: PositionedUnit; mode: 'move' | 'resize'; originX: number };
type LessonPlanDraft = {
  title: string;
  duration: string;
  overview: string;
  objective: string;
  teacherNotes: string;
  studentDirections: string;
  materials: string;
  links: Array<{ title: string; url: string }>;
};

const emptyLessonPlan = (): LessonPlanDraft => ({
  title: '',
  duration: '',
  overview: '',
  objective: '',
  teacherNotes: '',
  studentDirections: '',
  materials: '',
  links: []
});

const nullable = (value: string) => value.trim() || null;

const zoomLabels: Array<{ id: Zoom; label: string }> = [
  { id: 'year', label: 'Year' },
  { id: 'quarter', label: 'Quarter' },
  { id: 'month', label: 'Month' },
  { id: 'week', label: 'Week' }
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function unitMeetingCount(unit: Unit) {
  if (unit.plannedMeetingCount) return unit.plannedMeetingCount;
  if (!unit.lessons.length) return 2;
  return Math.max(
    2,
    unit.lessons.reduce(
      (count, lesson) =>
        count + Math.max(1, Math.ceil((lesson.estimatedDurationMinutes ?? 50) / 50)),
      0
    )
  );
}

function positionUnits(units: Unit[]): PositionedUnit[] {
  let cursor = 0;
  return units.map((unit) => {
    const span = unitMeetingCount(unit);
    const start = unit.plannedStartMeeting ?? cursor;
    cursor = Math.max(cursor, start + span);
    return { unit, start, span };
  });
}

function overlaps(a: PositionedUnit, b: PositionedUnit) {
  return a.start < b.start + b.span && b.start < a.start + a.span;
}

function weekdayName(date: Date) {
  return (
    ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getDay()] ??
    ''
  );
}

function meetingInstances(
  settings: SchoolYearSettings | null,
  section: Section | null,
  holidays: string[]
) {
  if (!settings?.startDate || !settings.endDate || !section?.meetings.length) return [];
  const meetingDays = section.meetings
    .map((meeting) => meeting.day)
    .filter((day) => /day$/i.test(day) === false);
  if (!meetingDays.length) return [];
  const start = new Date(`${settings.startDate}T12:00:00`);
  const end = new Date(`${settings.endDate}T12:00:00`);
  const holidaySet = new Set(holidays);
  const instances: Date[] = [];
  for (
    const day = new Date(start);
    day <= end && instances.length < 240;
    day.setDate(day.getDate() + 1)
  ) {
    const iso = day.toISOString().slice(0, 10);
    if (meetingDays.some((meetingDay) => meetingDay === weekdayName(day)) && !holidaySet.has(iso))
      instances.push(new Date(day));
  }
  return instances;
}

function dateLabel(date: Date | undefined, zoom: Zoom, index: number) {
  if (!date) return `M${index + 1}`;
  if (zoom === 'week')
    return `${date.toLocaleDateString(undefined, { weekday: 'short' })} ${date.getDate()}`;
  if (zoom === 'month')
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return date.toLocaleDateString(undefined, { month: 'short' });
}

function nextOrder(items: Array<{ orderIndex: number }>) {
  return items.reduce((largest, item) => Math.max(largest, item.orderIndex), -1) + 1;
}

export function CurriculumTimeline({
  course,
  selectedSection,
  holidays,
  schoolYearSettings,
  currentLessonId,
  onCourseChange,
  onOpenSchool
}: {
  course: Course;
  selectedSection: Section | null;
  holidays: string[];
  schoolYearSettings: SchoolYearSettings | null;
  currentLessonId: string | null;
  onCourseChange: (detail: CourseDetailResponse) => void;
  onOpenSchool: () => void;
}) {
  const api = useApiClient();
  const [zoom, setZoom] = useState<Zoom>('year');
  const [selection, setSelection] = useState<Selection>(null);
  const [expandedUnitIds, setExpandedUnitIds] = useState<string[]>([]);
  const [showUnitComposer, setShowUnitComposer] = useState(false);
  const [quickLessonUnitId, setQuickLessonUnitId] = useState<string | null>(null);
  const [quickLessonTitle, setQuickLessonTitle] = useState('');
  const [draftPrompt, setDraftPrompt] = useState('');
  const [draftMeetingCount, setDraftMeetingCount] = useState('6');
  const [draft, setDraft] = useState<Awaited<ReturnType<typeof api.generateUnitDraft>> | null>(
    null
  );
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dragPreview, setDragPreview] = useState<number | null>(null);
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null);
  const [meetingData, setMeetingData] = useState<MeetingInstancesResponse | null>(null);
  const [lessonPlanDraft, setLessonPlanDraft] = useState<LessonPlanDraft>(emptyLessonPlan);
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [newSegmentTitle, setNewSegmentTitle] = useState('');
  const [newSegmentMinutes, setNewSegmentMinutes] = useState('');
  const [newSegmentDescription, setNewSegmentDescription] = useState('');

  useEffect(() => {
    let active = true;
    void api
      .getMeetingInstances()
      .then((value) => {
        if (active) setMeetingData(value);
      })
      .catch(() => {
        if (active) setMeetingData(null);
      });
    return () => {
      active = false;
    };
  }, [api]);

  const positions = useMemo(() => positionUnits(course.units), [course.units]);
  const selectedUnit = useMemo(
    () => course.units.find((unit) => unit.id === selection?.id) ?? null,
    [course.units, selection]
  );
  const selectedLesson = useMemo(
    () =>
      course.units.flatMap((unit) => unit.lessons).find((lesson) => lesson.id === selection?.id) ??
      null,
    [course.units, selection]
  );
  const meetings = useMemo(() => {
    if (meetingData && selectedSection) {
      return meetingData.meetings
        .filter((meeting) => meeting.sectionId === selectedSection.sectionId)
        .map((meeting) => new Date(`${meeting.date}T12:00:00`));
    }
    return meetingInstances(schoolYearSettings, selectedSection, holidays);
  }, [holidays, meetingData, schoolYearSettings, selectedSection]);
  const furthestMeeting = Math.max(
    24,
    ...positions.map((item) => item.start + item.span),
    meetings.length || 0
  );
  const visibleMeetings =
    zoom === 'year'
      ? Math.max(36, Math.min(furthestMeeting, 80))
      : zoom === 'quarter'
        ? Math.max(28, Math.min(furthestMeeting, 52))
        : zoom === 'month'
          ? Math.max(18, Math.min(furthestMeeting, 32))
          : Math.max(8, Math.min(furthestMeeting, 16));
  const slotWidth = zoom === 'year' ? 34 : zoom === 'quarter' ? 48 : zoom === 'month' ? 78 : 108;
  const conflicts = positions.flatMap((position, index) =>
    positions
      .slice(index + 1)
      .filter((other) => overlaps(position, other))
      .map((other) => `${position.unit.title} overlaps ${other.unit.title}`)
  );
  const plannedMeetings = positions.reduce((count, item) => count + item.span, 0);
  const planningBase = meetings.length || visibleMeetings;
  const plannedPercent = planningBase
    ? Math.min(100, Math.round((plannedMeetings / planningBase) * 100))
    : 0;
  const unplannedMeetings = Math.max(0, planningBase - plannedMeetings);

  const toggleExpanded = (unitId: string) => {
    setExpandedUnitIds((previous) =>
      previous.includes(unitId) ? previous.filter((id) => id !== unitId) : [...previous, unitId]
    );
  };

  useEffect(() => {
    if (!selectedLesson) return;
    const plan = selectedLesson.lessonPlan;
    setLessonPlanDraft({
      title: selectedLesson.title,
      duration: selectedLesson.estimatedDurationMinutes?.toString() ?? '',
      overview: selectedLesson.description ?? '',
      objective: plan.objective ?? '',
      teacherNotes: plan.teacherNotes ?? '',
      studentDirections: plan.studentDirections ?? '',
      materials: plan.materials ?? '',
      links: plan.links
    });
    setLinkTitle('');
    setLinkUrl('');
    setNewSegmentTitle('');
    setNewSegmentMinutes('');
    setNewSegmentDescription('');
  }, [selectedLesson]);

  const deleteSelected = useCallback(async () => {
    if (!selection || saving) return;
    const target = selection.type === 'unit' ? selectedUnit : selectedLesson;
    if (!target) return;
    const noun =
      selection.type === 'unit' ? 'unit and all of its lessons' : 'lesson and all of its steps';
    if (!window.confirm(`Delete "${target.title}"? This removes the ${noun}.`)) return;
    try {
      setSaving(true);
      if (selection.type === 'unit') await api.deleteUnit(target.id);
      else await api.deleteLesson(target.id);
      onCourseChange(await api.getCourseDetail(course.id));
      setSelection(null);
      setStatus(`${selection.type === 'unit' ? 'Unit' : 'Lesson'} deleted`);
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Could not delete the selected item');
    } finally {
      setSaving(false);
    }
  }, [api, course.id, onCourseChange, saving, selectedLesson, selectedUnit, selection]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' || !selection) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      void deleteSelected();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleteSelected, selection]);

  const applyPendingChange = async (
    mode: 'only' | 'shift' | 'fixed',
    change: PendingChange | null = pendingChange
  ) => {
    if (!change) return;
    const { unit } = change;
    try {
      setSaving(true);
      let detail: CourseDetailResponse | null = null;
      if (change.kind === 'move') {
        detail = await api.updateUnit(unit.unit.id, { plannedStartMeeting: change.start });
        const movedUnit = detail.course.units.find((item) => item.id === unit.unit.id);
        for (const lesson of movedUnit?.lessons ?? []) {
          if (lesson.plannedStartMeeting !== null) {
            detail = await api.updateLesson(lesson.id, {
              plannedStartMeeting: Math.max(0, lesson.plannedStartMeeting + change.delta)
            });
          }
        }
        if (mode === 'shift' && change.delta) {
          for (const later of positions.filter((item) => item.start > unit.start)) {
            detail = await api.updateUnit(later.unit.id, {
              plannedStartMeeting: Math.max(0, later.start + change.delta)
            });
          }
        }
      } else {
        detail = await api.updateUnit(unit.unit.id, { plannedMeetingCount: change.span });
        // Lesson bars belong to their unit, not to fixed meeting IDs. Reflow
        // them over the resized unit while preserving their order.
        const refreshedUnit = detail.course.units.find((item) => item.id === unit.unit.id);
        if (refreshedUnit?.lessons.length) {
          const lessonSpan = Math.max(1, Math.floor(change.span / refreshedUnit.lessons.length));
          for (const [index, lesson] of refreshedUnit.lessons.entries()) {
            detail = await api.updateLesson(lesson.id, {
              plannedStartMeeting: unit.start + Math.min(change.span - 1, index * lessonSpan),
              plannedMeetingCount:
                index === refreshedUnit.lessons.length - 1
                  ? Math.max(1, change.span - lessonSpan * index)
                  : lessonSpan
            });
          }
        }
        if (mode === 'shift' && change.delta) {
          for (const later of positions.filter(
            (item) => item.start >= unit.start + unit.span && item.unit.id !== unit.unit.id
          )) {
            detail = await api.updateUnit(later.unit.id, {
              plannedStartMeeting: Math.max(0, later.start + change.delta)
            });
          }
        }
      }
      if (detail) onCourseChange(detail);
      setStatus(
        mode === 'shift' ? 'Timeline updated and following units shifted' : 'Timeline updated'
      );
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Could not update the timeline');
    } finally {
      setSaving(false);
      setPendingChange(null);
    }
  };

  const beginUnitDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    unit: PositionedUnit,
    mode: Drag['mode']
  ) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ unit, mode, originX: event.clientX });
    setDragPreview(mode === 'move' ? unit.start : unit.span);
  };

  const updateUnitDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    const delta = Math.round((event.clientX - drag.originX) / slotWidth);
    setDragPreview(
      drag.mode === 'move'
        ? clamp(drag.unit.start + delta, 0, visibleMeetings - 1)
        : Math.max(1, drag.unit.span + delta)
    );
  };

  const finishUnitDrag = () => {
    if (!drag || dragPreview === null) return;
    const delta = dragPreview - (drag.mode === 'move' ? drag.unit.start : drag.unit.span);
    if (delta) {
      const change: PendingChange =
        drag.mode === 'move'
          ? { kind: 'move', unit: drag.unit, start: dragPreview, delta }
          : { kind: 'resize', unit: drag.unit, span: dragPreview, delta };
      const proposed: PositionedUnit = {
        unit: drag.unit.unit,
        start: change.kind === 'move' ? change.start : drag.unit.start,
        span: change.kind === 'resize' ? change.span : drag.unit.span
      };
      const hasCollision = positions.some(
        (other) => other.unit.id !== drag.unit.unit.id && overlaps(proposed, other)
      );

      // A clear spot is a simple move. Ask only when another planned unit would
      // be displaced, so routine adjustments do not interrupt planning.
      if (hasCollision) {
        setPendingChange(change);
      } else {
        void applyPendingChange('only', change);
      }
    }
    setDrag(null);
    setDragPreview(null);
  };

  const createQuickLesson = async (unit: Unit) => {
    if (!quickLessonTitle.trim()) return;
    try {
      setSaving(true);
      onCourseChange(
        await api.createLesson(unit.id, {
          title: quickLessonTitle.trim(),
          description: null,
          estimatedDurationMinutes: 50,
          orderIndex: nextOrder(unit.lessons)
        })
      );
      setQuickLessonTitle('');
      setQuickLessonUnitId(null);
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Could not add lesson');
    } finally {
      setSaving(false);
    }
  };

  const saveLessonPlan = async () => {
    if (!selectedLesson || !lessonPlanDraft.title.trim()) return;
    try {
      setSaving(true);
      onCourseChange(
        await api.updateLesson(selectedLesson.id, {
          title: lessonPlanDraft.title.trim(),
          description: nullable(lessonPlanDraft.overview),
          estimatedDurationMinutes: lessonPlanDraft.duration.trim()
            ? Math.max(1, Number(lessonPlanDraft.duration) || 1)
            : null,
          lessonPlan: {
            objective: nullable(lessonPlanDraft.objective),
            teacherNotes: nullable(lessonPlanDraft.teacherNotes),
            studentDirections: nullable(lessonPlanDraft.studentDirections),
            materials: nullable(lessonPlanDraft.materials),
            links: lessonPlanDraft.links
          }
        })
      );
      setStatus('Lesson plan saved');
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Could not save the lesson plan');
    } finally {
      setSaving(false);
    }
  };

  const addLessonLink = () => {
    const title = linkTitle.trim();
    const url = linkUrl.trim();
    if (!title || !url) return;
    try {
      new URL(url);
    } catch {
      setStatus('Enter a complete resource URL, including https://');
      return;
    }
    setLessonPlanDraft((previous) => ({ ...previous, links: [...previous.links, { title, url }] }));
    setLinkTitle('');
    setLinkUrl('');
  };

  const addSegment = async () => {
    if (!selectedLesson || !newSegmentTitle.trim()) return;
    try {
      setSaving(true);
      onCourseChange(
        await api.createSegment(selectedLesson.id, {
          title: newSegmentTitle.trim(),
          description: nullable(newSegmentDescription),
          durationMinutes: newSegmentMinutes.trim()
            ? Math.max(1, Number(newSegmentMinutes) || 1)
            : null,
          orderIndex: nextOrder(selectedLesson.segments)
        })
      );
      setNewSegmentTitle('');
      setNewSegmentMinutes('');
      setNewSegmentDescription('');
      setStatus('Lesson step added');
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Could not add the lesson step');
    } finally {
      setSaving(false);
    }
  };

  const deleteSegment = async (segmentId: string, title: string) => {
    if (!window.confirm(`Delete the lesson step "${title}"?`)) return;
    try {
      setSaving(true);
      await api.deleteSegment(segmentId);
      onCourseChange(await api.getCourseDetail(course.id));
      setStatus('Lesson step deleted');
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Could not delete the lesson step');
    } finally {
      setSaving(false);
    }
  };

  const createDraft = async () => {
    if (draftPrompt.trim().length < 8) return;
    try {
      setSaving(true);
      setDraft(
        await api.generateUnitDraft({
          courseName: course.name,
          gradeLevel: course.gradeLevel,
          prompt: draftPrompt.trim(),
          meetingCount: clamp(Number(draftMeetingCount) || 6, 2, 30)
        })
      );
      setStatus(null);
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Could not make a draft right now');
    } finally {
      setSaving(false);
    }
  };

  const acceptDraft = async () => {
    if (!draft) return;
    try {
      setSaving(true);
      let detail = await api.createUnit(course.id, {
        title: draft.unit.title,
        description: draft.unit.description,
        orderIndex: nextOrder(course.units),
        plannedStartMeeting: positions.length
          ? Math.max(...positions.map((item) => item.start + item.span))
          : 0,
        plannedMeetingCount: draft.unit.meetingCount
      });
      const unit = detail.course.units.find((item) => item.title === draft.unit.title);
      if (!unit) throw new Error('Draft unit was not created');
      for (const [index, lesson] of draft.unit.lessons.entries()) {
        detail = await api.createLesson(unit.id, {
          title: lesson.title,
          description: lesson.description,
          estimatedDurationMinutes: lesson.estimatedDurationMinutes,
          orderIndex: index
        });
      }
      onCourseChange(detail);
      setDraft(null);
      setDraftPrompt('');
      setStatus('Draft added to the timeline');
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Could not add the draft');
    } finally {
      setSaving(false);
    }
  };

  const moveLesson = async (lesson: Lesson, unit: Unit, direction: -1 | 1) => {
    const next = unit.lessons.find((item) => item.orderIndex === lesson.orderIndex + direction);
    if (!next) return;
    try {
      setSaving(true);
      let detail = await api.updateLesson(lesson.id, { orderIndex: next.orderIndex });
      detail = await api.updateLesson(next.id, { orderIndex: lesson.orderIndex });
      onCourseChange(detail);
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Could not reorder lesson');
    } finally {
      setSaving(false);
    }
  };

  const selectUnit = (unit: Unit) => setSelection({ type: 'unit', id: unit.id });
  const selectLesson = (lesson: Lesson) => setSelection({ type: 'lesson', id: lesson.id });

  return (
    <section className="curriculum-workspace" aria-label={`${course.name} curriculum timeline`}>
      <div className="curriculum-workspace-topbar">
        <div className="curriculum-add-unit-control">
          <button
            type="button"
            className="secondary"
            onClick={() => setShowUnitComposer((open) => !open)}
          >
            {showUnitComposer ? 'Close add unit' : '+ Add unit'}
          </button>
          {showUnitComposer ? (
            <div className="curriculum-unit-composer">
              <input
                className="input"
                value={draftPrompt}
                onChange={(event) => setDraftPrompt(event.target.value)}
                placeholder="What should students learn?"
                aria-label="Describe the unit you want to plan"
              />
              <input
                className="curriculum-meeting-input"
                type="number"
                min="2"
                max="30"
                value={draftMeetingCount}
                onChange={(event) => setDraftMeetingCount(event.target.value)}
                aria-label="Estimated instructional meetings"
              />
              <button
                type="button"
                disabled={saving || draftPrompt.trim().length < 8}
                onClick={() => void createDraft()}
              >
                Build unit
              </button>
            </div>
          ) : null}
        </div>
        <div className="curriculum-zoom" aria-label="Timeline zoom">
          {zoomLabels.map((option) => (
            <button
              key={option.id}
              className={zoom === option.id ? 'active' : ''}
              type="button"
              onClick={() => setZoom(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {!meetings.length ? (
        <div className="curriculum-setup-callout">
          <span>Dates appear after you add the school year and class meetings.</span>
          <button className="secondary" type="button" onClick={onOpenSchool}>
            Add school year
          </button>
        </div>
      ) : null}

      <div className="curriculum-pacing">
        <span>
          <strong>{plannedPercent}%</strong> planned
        </span>
        <span>
          <strong>{unplannedMeetings}</strong> open meetings
        </span>
        <span>
          <strong>{conflicts.length}</strong> conflicts
        </span>
        {selectedSection ? (
          <span>{selectedSection.sectionName} rhythm</span>
        ) : (
          <span>Choose a class group for dated pacing</span>
        )}
      </div>

      {draft ? (
        <aside className="curriculum-draft-card" aria-label="Draft unit">
          <div>
            <span className="curriculum-draft-label">Draft</span>
            <strong>{draft.unit.title}</strong>
            <p>{draft.unit.description}</p>
            <small>
              {draft.unit.lessons.length} lessons · {draft.unit.meetingCount} meetings
            </small>
          </div>
          <div className="profile-actions">
            <button type="button" disabled={saving} onClick={() => void acceptDraft()}>
              Add to timeline
            </button>
            <button className="secondary" type="button" onClick={() => setDraft(null)}>
              Discard
            </button>
          </div>
        </aside>
      ) : null}

      {status ? (
        <p className="curriculum-live-status" role="status">
          {status}
        </p>
      ) : null}
      {conflicts.length ? (
        <p className="curriculum-conflict-summary">
          {conflicts[0]}. Adjust a bar or keep both plans.
        </p>
      ) : null}

      {selection ? (
        <div className="curriculum-selection-actions">
          <span>{selection.type === 'unit' ? selectedUnit?.title : selectedLesson?.title}</span>
          <button
            className="secondary danger"
            type="button"
            disabled={saving}
            onClick={() => void deleteSelected()}
          >
            Delete selected
          </button>
          <small>Press Delete to remove the selected {selection.type}.</small>
        </div>
      ) : null}

      {selectedLesson ? (
        <section
          className="lesson-plan-workspace"
          aria-label={`Lesson plan for ${selectedLesson.title}`}
        >
          <div className="lesson-plan-heading">
            <div>
              <p className="eyebrow">Lesson plan</p>
              <h3>{selectedLesson.title}</h3>
              <p className="muted">
                Build the teacher-facing plan and the student-facing directions here. Everything
                saves to this lesson.
              </p>
            </div>
            <button className="secondary" type="button" onClick={() => setSelection(null)}>
              Close
            </button>
          </div>
          <div className="lesson-plan-fields">
            <label>
              Lesson title
              <input
                className="input"
                value={lessonPlanDraft.title}
                onChange={(event) =>
                  setLessonPlanDraft((previous) => ({ ...previous, title: event.target.value }))
                }
              />
            </label>
            <label>
              Minutes
              <input
                className="input"
                type="number"
                min="1"
                value={lessonPlanDraft.duration}
                onChange={(event) =>
                  setLessonPlanDraft((previous) => ({ ...previous, duration: event.target.value }))
                }
              />
            </label>
            <label className="lesson-plan-wide">
              Overview
              <textarea
                className="input"
                value={lessonPlanDraft.overview}
                onChange={(event) =>
                  setLessonPlanDraft((previous) => ({ ...previous, overview: event.target.value }))
                }
                placeholder="A short description of this lesson."
              />
            </label>
            <label className="lesson-plan-wide">
              Learning objective
              <textarea
                className="input"
                value={lessonPlanDraft.objective}
                onChange={(event) =>
                  setLessonPlanDraft((previous) => ({ ...previous, objective: event.target.value }))
                }
                placeholder="Students will be able to…"
              />
            </label>
            <label>
              Materials
              <textarea
                className="input"
                value={lessonPlanDraft.materials}
                onChange={(event) =>
                  setLessonPlanDraft((previous) => ({ ...previous, materials: event.target.value }))
                }
                placeholder="Handouts, supplies, technology…"
              />
            </label>
            <label>
              Student directions
              <textarea
                className="input"
                value={lessonPlanDraft.studentDirections}
                onChange={(event) =>
                  setLessonPlanDraft((previous) => ({
                    ...previous,
                    studentDirections: event.target.value
                  }))
                }
                placeholder="What students should do, see, or submit."
              />
            </label>
            <label className="lesson-plan-wide">
              Teacher notes
              <textarea
                className="input"
                value={lessonPlanDraft.teacherNotes}
                onChange={(event) =>
                  setLessonPlanDraft((previous) => ({
                    ...previous,
                    teacherNotes: event.target.value
                  }))
                }
                placeholder="Prompts, differentiation, checks for understanding, and reminders."
              />
            </label>
          </div>
          <div className="lesson-plan-resources">
            <div>
              <strong>Resources</strong>
              <span>Links are saved with this lesson.</span>
            </div>
            <div className="lesson-plan-link-form">
              <input
                className="input"
                value={linkTitle}
                onChange={(event) => setLinkTitle(event.target.value)}
                placeholder="Link label"
              />
              <input
                className="input"
                type="url"
                value={linkUrl}
                onChange={(event) => setLinkUrl(event.target.value)}
                placeholder="https://…"
              />
              <button className="secondary" type="button" onClick={addLessonLink}>
                Add link
              </button>
            </div>
            {lessonPlanDraft.links.length ? (
              <ul>
                {lessonPlanDraft.links.map((link, index) => (
                  <li key={`${link.url}-${index}`}>
                    <a href={link.url} target="_blank" rel="noreferrer">
                      {link.title}
                    </a>
                    <button
                      className="button-link"
                      type="button"
                      onClick={() =>
                        setLessonPlanDraft((previous) => ({
                          ...previous,
                          links: previous.links.filter((_, linkIndex) => linkIndex !== index)
                        }))
                      }
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No resources yet.</p>
            )}
          </div>
          <div className="lesson-plan-save">
            <button
              type="button"
              disabled={saving || !lessonPlanDraft.title.trim()}
              onClick={() => void saveLessonPlan()}
            >
              Save lesson plan
            </button>
          </div>
          <div className="lesson-plan-steps">
            <div>
              <strong>Lesson steps</strong>
              <span>
                Use steps for mini-lessons, practice, discussion, or checks for understanding.
              </span>
            </div>
            <div className="lesson-step-form">
              <input
                className="input"
                value={newSegmentTitle}
                onChange={(event) => setNewSegmentTitle(event.target.value)}
                placeholder="Step title"
              />
              <input
                className="input"
                type="number"
                min="1"
                value={newSegmentMinutes}
                onChange={(event) => setNewSegmentMinutes(event.target.value)}
                placeholder="Minutes"
              />
              <textarea
                className="input"
                value={newSegmentDescription}
                onChange={(event) => setNewSegmentDescription(event.target.value)}
                placeholder="What happens in this step?"
              />
              <button
                type="button"
                disabled={saving || !newSegmentTitle.trim()}
                onClick={() => void addSegment()}
              >
                Add step
              </button>
            </div>
            <div className="lesson-step-list">
              {selectedLesson.segments.map((segment) => (
                <article key={segment.id}>
                  <div>
                    <strong>{segment.title}</strong>
                    <span>
                      {segment.durationMinutes ? `${segment.durationMinutes} min` : 'Time not set'}
                    </span>
                    {segment.description ? <p>{segment.description}</p> : null}
                  </div>
                  <button
                    className="secondary danger"
                    type="button"
                    disabled={saving}
                    onClick={() => void deleteSegment(segment.id, segment.title)}
                  >
                    Delete
                  </button>
                </article>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <div className="curriculum-split-view">
        <aside className="curriculum-tree" aria-label="Curriculum hierarchy">
          <div className="curriculum-tree-heading">
            <span>Course</span>
            <strong>{course.name}</strong>
          </div>
          <div className="curriculum-tree-scroll">
            {positions.map((position) => {
              const expanded = expandedUnitIds.includes(position.unit.id);
              const unitSelected = selection?.type === 'unit' && selection.id === position.unit.id;
              return (
                <div
                  key={position.unit.id}
                  className={
                    unitSelected ? 'curriculum-tree-unit selected' : 'curriculum-tree-unit'
                  }
                >
                  <div className="curriculum-tree-row">
                    <button
                      className="curriculum-disclosure"
                      type="button"
                      aria-expanded={expanded}
                      aria-label={`${expanded ? 'Collapse' : 'Expand'} ${position.unit.title}`}
                      onClick={() => toggleExpanded(position.unit.id)}
                    >
                      {expanded ? '⌄' : '›'}
                    </button>
                    <button
                      className="curriculum-tree-select"
                      type="button"
                      aria-pressed={unitSelected}
                      onClick={() => selectUnit(position.unit)}
                    >
                      <span>{position.unit.title}</span>
                      <small>{position.unit.lessons.length} lessons</small>
                    </button>
                  </div>
                  {expanded ? (
                    <div className="curriculum-lesson-tree">
                      {position.unit.lessons.map((lesson) => {
                        const selected = selection?.type === 'lesson' && selection.id === lesson.id;
                        return (
                          <div
                            key={lesson.id}
                            className={
                              selected ? 'curriculum-lesson-row selected' : 'curriculum-lesson-row'
                            }
                          >
                            <button type="button" onClick={() => selectLesson(lesson)}>
                              {lesson.title}
                            </button>
                            <span>
                              <button
                                aria-label={`Move ${lesson.title} earlier`}
                                disabled={saving}
                                type="button"
                                onClick={() => void moveLesson(lesson, position.unit, -1)}
                              >
                                ←
                              </button>
                              <button
                                aria-label={`Move ${lesson.title} later`}
                                disabled={saving}
                                type="button"
                                onClick={() => void moveLesson(lesson, position.unit, 1)}
                              >
                                →
                              </button>
                            </span>
                          </div>
                        );
                      })}
                      {quickLessonUnitId === position.unit.id ? (
                        <input
                          className="curriculum-inline-input"
                          autoFocus
                          value={quickLessonTitle}
                          onChange={(event) => setQuickLessonTitle(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') void createQuickLesson(position.unit);
                            if (event.key === 'Escape') setQuickLessonUnitId(null);
                          }}
                          onBlur={() => {
                            if (!quickLessonTitle.trim()) setQuickLessonUnitId(null);
                          }}
                          placeholder="Lesson title"
                        />
                      ) : (
                        <button
                          className="curriculum-add-lesson"
                          type="button"
                          onClick={() => {
                            setQuickLessonUnitId(position.unit.id);
                            setQuickLessonTitle('');
                          }}
                        >
                          + Lesson
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </aside>

        <div className="curriculum-canvas-wrap">
          <div className="curriculum-scale" style={{ minWidth: visibleMeetings * slotWidth }}>
            {Array.from({ length: visibleMeetings }, (_, index) => (
              <span key={index} style={{ width: slotWidth }}>
                {index % (zoom === 'year' ? 5 : zoom === 'quarter' ? 3 : 1) === 0
                  ? dateLabel(meetings[index], zoom, index)
                  : ''}
              </span>
            ))}
          </div>
          <div
            className="curriculum-canvas"
            style={
              {
                minWidth: visibleMeetings * slotWidth,
                '--slot-width': `${slotWidth}px`
              } as CSSProperties
            }
          >
            {positions.map((position) => {
              const selected = selection?.type === 'unit' && selection.id === position.unit.id;
              const isDragging = drag?.unit.unit.id === position.unit.id;
              const start =
                isDragging && drag?.mode === 'move' && dragPreview !== null
                  ? dragPreview
                  : position.start;
              const span =
                isDragging && drag?.mode === 'resize' && dragPreview !== null
                  ? dragPreview
                  : position.span;
              const hasConflict = positions.some(
                (other) =>
                  other.unit.id !== position.unit.id &&
                  start < other.start + other.span &&
                  other.start < start + span
              );
              const expanded = expandedUnitIds.includes(position.unit.id);
              return (
                <div key={position.unit.id} className="curriculum-track-row">
                  <article
                    className={[
                      'curriculum-unit-bar',
                      selected ? 'selected' : '',
                      isDragging ? 'dragging' : '',
                      hasConflict ? 'conflict' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{
                      gridColumn: `${start + 1} / span ${Math.min(span, visibleMeetings - start)}`
                    }}
                    aria-label={`Unit ${position.unit.title}, meetings ${start + 1} through ${start + span}`}
                  >
                    <button
                      className="curriculum-unit-grab"
                      type="button"
                      aria-label={`Move ${position.unit.title}`}
                      onPointerDown={(event) => beginUnitDrag(event, position, 'move')}
                      onPointerMove={updateUnitDrag}
                      onPointerUp={finishUnitDrag}
                      onPointerCancel={() => {
                        setDrag(null);
                        setDragPreview(null);
                      }}
                    >
                      ⠿
                    </button>
                    <button
                      className="curriculum-unit-content"
                      type="button"
                      onClick={() => {
                        selectUnit(position.unit);
                        toggleExpanded(position.unit.id);
                      }}
                    >
                      <strong>{position.unit.title}</strong>
                      <span>
                        {position.unit.lessons.length} lessons · {span} meetings
                      </span>
                    </button>
                    <button
                      className="curriculum-unit-resize"
                      type="button"
                      aria-label={`Resize ${position.unit.title}`}
                      onPointerDown={(event) => beginUnitDrag(event, position, 'resize')}
                      onPointerMove={updateUnitDrag}
                      onPointerUp={finishUnitDrag}
                      onPointerCancel={() => {
                        setDrag(null);
                        setDragPreview(null);
                      }}
                    />
                  </article>
                  {expanded && zoom !== 'year'
                    ? position.unit.lessons.map((lesson, index) => {
                        const defaultLessonSpan = Math.max(
                          1,
                          Math.floor(span / Math.max(1, position.unit.lessons.length))
                        );
                        const lessonSpan = lesson.plannedMeetingCount ?? defaultLessonSpan;
                        const lessonStart =
                          lesson.plannedStartMeeting ??
                          start + Math.min(span - 1, index * defaultLessonSpan);
                        const active = currentLessonId === lesson.id;
                        const selectedLesson =
                          selection?.type === 'lesson' && selection.id === lesson.id;
                        return (
                          <button
                            key={lesson.id}
                            className={[
                              'curriculum-lesson-bar',
                              active ? 'current' : '',
                              selectedLesson ? 'selected' : ''
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            style={{
                              gridColumn: `${lessonStart + 1} / span ${Math.max(1, Math.min(lessonSpan, visibleMeetings - lessonStart))}`
                            }}
                            type="button"
                            onClick={() => selectLesson(lesson)}
                          >
                            {lesson.title}
                          </button>
                        );
                      })
                    : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {pendingChange ? (
        <div
          className="curriculum-change-popover"
          role="dialog"
          aria-label="Confirm timeline adjustment"
        >
          <strong>
            {pendingChange.kind === 'move' ? 'Move this unit' : 'Change this unit length'}
          </strong>
          <span>
            {pendingChange.kind === 'move'
              ? `Meeting ${pendingChange.start + 1}`
              : `${pendingChange.span} instructional meetings`}
          </span>
          <div>
            <button
              type="button"
              disabled={saving}
              onClick={() => void applyPendingChange('shift')}
            >
              Shift Other Lessons
            </button>
            <button
              className="secondary"
              type="button"
              disabled={saving}
              onClick={() => void applyPendingChange('only')}
            >
              Don’t Move Other Lessons
            </button>
            <button className="button-link" type="button" onClick={() => setPendingChange(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
