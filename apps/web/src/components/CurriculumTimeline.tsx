import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from 'react';
import { useNavigate } from 'react-router-dom';

import type {
  CourseDetailResponse,
  GetScheduleResponse,
  MeetingInstancesResponse,
  SectionLessonPlanResponse
} from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';
import {
  normalizePlanningRange,
  planningRangeIntersects,
  planningRangeLabel,
  type PlanningRange
} from '../lib/year-plan-range.js';
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
type ContextMenu = { type: 'unit' | 'lesson'; id: string; x: number; y: number } | null;
type PositionedUnit = { unit: Unit; start: number; span: number };
type PendingChange =
  | { kind: 'move'; unit: PositionedUnit; start: number; delta: number }
  | { kind: 'resize'; unit: PositionedUnit; span: number; delta: number };
type Drag = { unit: PositionedUnit; mode: 'move' | 'resize'; originX: number };
type LessonDrag = {
  lesson: Lesson;
  mode: 'move' | 'resize';
  originX: number;
  start: number;
  span: number;
};
type RangeDrag = { originIndex: number; originX: number; unitId: string | null; laneTop: number };
type RangeDraft = PlanningRange & { unitId: string | null };
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
  if (!unit.lessons.length) return 1;
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

function dateLabel(date: Date | undefined, zoom: Zoom, index: number) {
  if (!date) return zoom === 'week' ? `Week ${index + 1}` : `M${index + 1}`;
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
  schoolYearSettings,
  currentLessonId,
  onCourseChange,
  onOpenSchool,
  displayMode = 'timeline',
  allowAutoGeneration = true,
  onOpenLesson,
  initialLessonId,
  onLessonSelectionChange
}: {
  course: Course;
  selectedSection: Section | null;
  holidays: string[];
  schoolYearSettings: SchoolYearSettings | null;
  currentLessonId: string | null;
  onCourseChange: (detail: CourseDetailResponse) => void;
  onOpenSchool: () => void;
  displayMode?: 'timeline' | 'outline';
  allowAutoGeneration?: boolean;
  onOpenLesson?: (lessonId: string) => void;
  initialLessonId?: string | null;
  onLessonSelectionChange?: (lessonId: string | null) => void;
}) {
  const api = useApiClient();
  const navigate = useNavigate();
  const [zoom, setZoom] = useState<Zoom>('year');
  const [selection, setSelection] = useState<Selection>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu>(null);
  const [expandedUnitIds, setExpandedUnitIds] = useState<string[]>(() =>
    course.units.map((unit) => unit.id)
  );
  const [showUnitComposer, setShowUnitComposer] = useState(false);
  const [unitComposerMode, setUnitComposerMode] = useState<'manual' | 'generate'>('manual');
  const [quickLessonUnitId, setQuickLessonUnitId] = useState<string | null>(null);
  const [quickLessonTitle, setQuickLessonTitle] = useState('');
  const [manualUnitTitle, setManualUnitTitle] = useState('');
  const [draftPrompt, setDraftPrompt] = useState('');
  const [draftMeetingCount, setDraftMeetingCount] = useState('');
  const [lessonGeneratorUnitId, setLessonGeneratorUnitId] = useState<string | null>(null);
  const [lessonGeneratorPrompt, setLessonGeneratorPrompt] = useState('');
  const [lessonGeneratorCount, setLessonGeneratorCount] = useState('5');
  const [generatedLessonDraft, setGeneratedLessonDraft] = useState<{
    unitId: string;
    draft: Awaited<ReturnType<typeof api.generateUnitDraft>>;
  } | null>(null);
  const [draft, setDraft] = useState<Awaited<ReturnType<typeof api.generateUnitDraft>> | null>(
    null
  );
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isGeneratingUnit, setIsGeneratingUnit] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dragPreview, setDragPreview] = useState<number | null>(null);
  const [lessonDrag, setLessonDrag] = useState<LessonDrag | null>(null);
  const [lessonDragPreview, setLessonDragPreview] = useState<{
    start: number;
    span: number;
  } | null>(null);
  const [outlineDraggedLessonId, setOutlineDraggedLessonId] = useState<string | null>(null);
  const [outlineDropLessonId, setOutlineDropLessonId] = useState<string | null>(null);
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null);
  const [meetingData, setMeetingData] = useState<MeetingInstancesResponse | null>(null);
  const [lessonPlanDraft, setLessonPlanDraft] = useState<LessonPlanDraft>(emptyLessonPlan);
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [newSegmentTitle, setNewSegmentTitle] = useState('');
  const [newSegmentMinutes, setNewSegmentMinutes] = useState('');
  const [newSegmentDescription, setNewSegmentDescription] = useState('');
  const [sectionPlans, setSectionPlans] = useState<SectionLessonPlanResponse['plans']>([]);
  const [lastSectionPlanOperation, setLastSectionPlanOperation] = useState<string | null>(null);
  const [editingSharedPlan, setEditingSharedPlan] = useState(false);
  const [rangeDrag, setRangeDrag] = useState<RangeDrag | null>(null);
  const [rangePreview, setRangePreview] = useState<RangeDraft | null>(null);
  const [rangeDraft, setRangeDraft] = useState<RangeDraft | null>(null);
  const [rangeKind, setRangeKind] = useState<'unit' | 'lessons'>('unit');
  const [rangeTitle, setRangeTitle] = useState('');
  const [rangeLessonCount, setRangeLessonCount] = useState('');
  const [rangeUnitId, setRangeUnitId] = useState('');
  const [todayDate, setTodayDate] = useState<string | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const lessonPlanSaveTimer = useRef<number | null>(null);
  const lessonPlanSaveChain = useRef<Promise<void>>(Promise.resolve());
  const lessonPlanDraftRef = useRef<LessonPlanDraft>(emptyLessonPlan());
  const hydratedLessonId = useRef<string | null>(null);
  const selectedLessonIdRef = useRef<string | null>(null);
  const scrollStorageKey = `teacheros_year_plan_scroll_${course.id}_${selectedSection?.sectionId ?? 'none'}_${displayMode}`;

  useEffect(() => {
    setExpandedUnitIds(course.units.map((unit) => unit.id));
  }, [course.id]);

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

  // School-local "today" is resolved by the API. The timeline only consumes
  // that date to move its viewport and never infers a class from browser time.
  useEffect(() => {
    let active = true;
    void api
      .dashboardToday()
      .then((value) => {
        if (active) setTodayDate(value.date);
      })
      .catch(() => {
        if (active) setTodayDate(null);
      });
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    if (!selectedSection) {
      setSectionPlans([]);
      setLastSectionPlanOperation(null);
      setEditingSharedPlan(false);
      return;
    }
    // Section-specific timing is the safe default whenever the planning
    // context changes. Shared curriculum edits require an explicit choice.
    setEditingSharedPlan(false);
    setLastSectionPlanOperation(null);
    let active = true;
    void api
      .getSectionLessonPlans(selectedSection.sectionId)
      .then((value) => {
        if (active) setSectionPlans(value.plans);
      })
      .catch(() => {
        if (active) setSectionPlans([]);
      });
    return () => {
      active = false;
    };
  }, [api, selectedSection?.sectionId]);

  useEffect(() => {
    if (!initialLessonId) return;
    setSelection({ type: 'lesson', id: initialLessonId });
  }, [initialLessonId]);

  useEffect(() => {
    const canvas = canvasWrapRef.current;
    if (!canvas) return;
    const stored = window.sessionStorage.getItem(scrollStorageKey);
    if (stored) canvas.scrollLeft = Number(stored) || 0;
    const persistScroll = () =>
      window.sessionStorage.setItem(scrollStorageKey, String(canvas.scrollLeft));
    canvas.addEventListener('scroll', persistScroll, { passive: true });
    return () => canvas.removeEventListener('scroll', persistScroll);
  }, [scrollStorageKey]);

  const positions = useMemo(() => positionUnits(course.units), [course.units]);
  const sectionPlanByLesson = useMemo(
    () => new Map(sectionPlans.map((plan) => [plan.lessonId, plan])),
    [sectionPlans]
  );
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
  const sectionMeetings = useMemo(
    () =>
      meetingData && selectedSection
        ? meetingData.meetings.filter((meeting) => meeting.sectionId === selectedSection.sectionId)
        : [],
    [meetingData, selectedSection]
  );
  const meetings = useMemo(
    () => sectionMeetings.map((meeting) => new Date(`${meeting.date}T12:00:00`)),
    [sectionMeetings]
  );
  const furthestMeeting = Math.max(
    24,
    ...positions.map((item) => item.start + item.span),
    meetings.length || 0
  );
  const schoolYearWeeks = schoolYearSettings
    ? Math.max(
        1,
        Math.ceil(
          (new Date(`${schoolYearSettings.endDate}T12:00:00`).getTime() -
            new Date(`${schoolYearSettings.startDate}T12:00:00`).getTime()) /
            (7 * 24 * 60 * 60 * 1000)
        ) + 1
      )
    : 52;
  const visibleMeetings =
    zoom === 'year'
      ? Math.max(36, Math.min(furthestMeeting, 80))
      : zoom === 'quarter'
        ? Math.max(28, Math.min(furthestMeeting, 52))
        : zoom === 'month'
          ? Math.max(18, Math.min(furthestMeeting, 32))
          : Math.max(schoolYearWeeks, furthestMeeting);
  const slotWidth = zoom === 'year' ? 34 : zoom === 'quarter' ? 48 : zoom === 'month' ? 78 : 108;
  const courseMeetingSlots = useMemo(
    () =>
      Array.from(
        { length: Math.max(80, visibleMeetings, furthestMeeting) },
        () =>
          ({}) as {
            date?: string;
          }
      ),
    [furthestMeeting, visibleMeetings]
  );
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
  const canEditSharedPlan = !selectedSection || editingSharedPlan;
  const rangeOverlapsExistingPlan = (range: RangeDraft) =>
    !range.unitId &&
    planningRangeIntersects(
      range,
      positions.map((position) => ({ start: position.start, meetingCount: position.span }))
    );

  const effectiveLessonStart = (lesson: Lesson, fallback: number) =>
    sectionPlanByLesson.get(lesson.id)?.plannedStartMeeting ??
    lesson.plannedStartMeeting ??
    fallback;
  const effectiveLessonSpan = (lesson: Lesson, fallback: number) =>
    sectionPlanByLesson.get(lesson.id)?.plannedMeetingCount ??
    lesson.plannedMeetingCount ??
    fallback;

  // Course planning is expressed as a shared sequence of meeting numbers.
  // A selected section contributes real dates, but is never required to plan.
  const rangeMeetings = selectedSection ? sectionMeetings : courseMeetingSlots;
  const rangeFromPointer = (clientX: number) => {
    const canvas = canvasWrapRef.current;
    if (!canvas || !rangeMeetings.length) return null;
    const bounds = canvas.getBoundingClientRect();
    const index = Math.floor((clientX - bounds.left + canvas.scrollLeft) / slotWidth);
    return clamp(index, 0, Math.min(visibleMeetings, rangeMeetings.length) - 1);
  };
  const beginRangeDrag = (event: ReactPointerEvent<HTMLDivElement>, unitId: string | null) => {
    if (!rangeMeetings.length || saving) return;
    const index = rangeFromPointer(event.clientX);
    if (index === null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setRangeDrag({
      originIndex: index,
      originX: event.clientX,
      unitId,
      laneTop: event.currentTarget.offsetTop
    });
    setRangePreview(null);
  };
  const updateRangeDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!rangeDrag) return;
    const index = rangeFromPointer(event.clientX);
    if (index === null || Math.abs(event.clientX - rangeDrag.originX) < 6) return;
    const range = normalizePlanningRange(rangeDrag.originIndex, index, rangeMeetings);
    if (range) setRangePreview({ ...range, unitId: rangeDrag.unitId });
  };
  const finishRangeDrag = () => {
    if (rangePreview) {
      setRangeDraft(rangePreview);
      setRangeKind(rangePreview.unitId ? 'lessons' : 'unit');
      setRangeUnitId(rangePreview.unitId ?? course.units[0]?.id ?? '');
      setRangeLessonCount(String(Math.max(1, Math.min(8, rangePreview.meetingCount))));
      setRangeTitle('');
    }
    setRangeDrag(null);
    setRangePreview(null);
  };

  const scrollCanvasBy = (direction: -1 | 1) => {
    const canvas = canvasWrapRef.current;
    if (!canvas) return;
    canvas.scrollBy({
      left: direction * Math.max(240, canvas.clientWidth * 0.72),
      behavior: 'smooth'
    });
  };

  const scrollToToday = () => {
    const canvas = canvasWrapRef.current;
    if (!canvas || !todayDate || !rangeMeetings.length) return;
    const targetIndex = rangeMeetings.findIndex(
      (meeting) => Boolean(meeting.date) && meeting.date! >= todayDate
    );
    const index = targetIndex === -1 ? rangeMeetings.length - 1 : targetIndex;
    canvas.scrollTo({
      left: Math.max(0, index * slotWidth - Math.max(slotWidth, canvas.clientWidth * 0.28)),
      behavior: 'smooth'
    });
  };

  const confirmRangeCreation = async () => {
    if (!rangeDraft) return;
    const count = clamp(Number(rangeLessonCount) || 1, 1, Math.min(30, rangeDraft.meetingCount));
    const lessonTitles = Array.from(
      { length: count },
      (_, index) => `${rangeTitle.trim() || 'Lesson'} ${index + 1}`
    );
    try {
      setSaving(true);
      const detail =
        rangeKind === 'unit'
          ? await api.createCurriculumRange(course.id, {
              kind: 'unit',
              title: rangeTitle.trim() || 'New unit',
              description: null,
              plannedStartMeeting: rangeDraft.start,
              plannedMeetingCount: rangeDraft.meetingCount,
              lessonTitles: rangeTitle.trim() ? lessonTitles : []
            })
          : await api.createCurriculumRange(course.id, {
              kind: 'lessons',
              unitId: rangeUnitId,
              plannedStartMeeting: rangeDraft.start,
              plannedMeetingCount: rangeDraft.meetingCount,
              lessonTitles
            });
      onCourseChange(detail);
      setRangeDraft(null);
      setStatus(
        rangeKind === 'unit'
          ? 'Unit added to the selected range'
          : 'Lessons added to the selected range'
      );
    } catch (err) {
      setStatus(
        err instanceof ApiError ? err.message : 'Could not create curriculum in this range'
      );
    } finally {
      setSaving(false);
    }
  };

  const shiftSelectedSectionLesson = async (meetingDelta: -1 | 1) => {
    if (!selectedSection || !selectedLesson) return;
    const fallback = selectedLesson.plannedStartMeeting;
    const start = sectionPlanByLesson.get(selectedLesson.id)?.plannedStartMeeting ?? fallback;
    if (start === null || start === undefined) {
      setStatus('Place this lesson on the course timeline before shifting it for a section.');
      return;
    }
    try {
      setSaving(true);
      const response = await api.shiftSectionLessonPlans(
        selectedSection.sectionId,
        selectedLesson.id,
        meetingDelta
      );
      setSectionPlans(response.plans);
      setLastSectionPlanOperation(response.operationId);
      setStatus(
        `${selectedLesson.title} and following lessons shifted ${
          meetingDelta > 0 ? 'later' : 'earlier'
        } for ${selectedSection.sectionName}.`
      );
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Could not shift this section plan');
    } finally {
      setSaving(false);
    }
  };

  const undoSectionShift = async () => {
    if (!selectedSection || !lastSectionPlanOperation) return;
    try {
      setSaving(true);
      const response = await api.undoSectionLessonPlanShift(
        selectedSection.sectionId,
        lastSectionPlanOperation
      );
      setSectionPlans(response.plans);
      setLastSectionPlanOperation(null);
      setStatus(`Restored ${selectedSection.sectionName}'s prior lesson timing.`);
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Could not undo the section shift');
    } finally {
      setSaving(false);
    }
  };

  const toggleExpanded = (unitId: string) => {
    setExpandedUnitIds((previous) =>
      previous.includes(unitId) ? previous.filter((id) => id !== unitId) : [...previous, unitId]
    );
  };

  useEffect(() => {
    if (!selectedLesson) {
      hydratedLessonId.current = null;
      selectedLessonIdRef.current = null;
      return;
    }
    selectedLessonIdRef.current = selectedLesson.id;
    if (hydratedLessonId.current === selectedLesson.id) return;
    hydratedLessonId.current = selectedLesson.id;
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
  }, [selectedLesson?.id]);

  useEffect(() => {
    lessonPlanDraftRef.current = lessonPlanDraft;
  }, [lessonPlanDraft]);

  const deleteSelected = useCallback(
    async (requestedSelection: Exclude<Selection, null> | null = selection) => {
      if (!requestedSelection || saving) return;
      const target =
        requestedSelection.type === 'unit'
          ? course.units.find((unit) => unit.id === requestedSelection.id)
          : course.units
              .flatMap((unit) => unit.lessons)
              .find((lesson) => lesson.id === requestedSelection.id);
      if (!target) return;
      const noun =
        requestedSelection.type === 'unit'
          ? 'unit and all of its lessons'
          : 'lesson and all of its steps';
      if (!window.confirm(`Delete "${target.title}"? This removes the ${noun}.`)) return;
      try {
        setSaving(true);
        if (requestedSelection.type === 'unit') await api.deleteUnit(target.id);
        else await api.deleteLesson(target.id);
        onCourseChange(await api.getCourseDetail(course.id));
        setSelection(null);
        setContextMenu(null);
        setStatus(`${requestedSelection.type === 'unit' ? 'Unit' : 'Lesson'} deleted`);
      } catch (err) {
        setStatus(err instanceof ApiError ? err.message : 'Could not delete the selected item');
      } finally {
        setSaving(false);
      }
    },
    [api, course.id, course.units, onCourseChange, saving, selection]
  );

  const duplicateItem = async (requestedSelection: Exclude<Selection, null>) => {
    if (saving) return;
    try {
      setSaving(true);
      const detail =
        requestedSelection.type === 'unit'
          ? await api.duplicateUnit(requestedSelection.id)
          : await api.duplicateLesson(requestedSelection.id);
      onCourseChange(detail);
      setStatus(`${requestedSelection.type === 'unit' ? 'Unit' : 'Lesson'} duplicated`);
      setContextMenu(null);
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Could not duplicate this item');
    } finally {
      setSaving(false);
    }
  };

  const openContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    type: 'unit' | 'lesson',
    id: string
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      type,
      id,
      x: Math.min(event.clientX, window.innerWidth - 190),
      y: Math.min(event.clientY, window.innerHeight - 170)
    });
  };

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [contextMenu]);

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

  useEffect(() => {
    const cancelRange = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setRangeDrag(null);
        setRangePreview(null);
        setRangeDraft(null);
      }
    };
    window.addEventListener('keydown', cancelRange);
    return () => window.removeEventListener('keydown', cancelRange);
  }, []);

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

  const beginLessonDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    lesson: Lesson,
    mode: LessonDrag['mode'],
    start: number,
    span: number
  ) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setLessonDrag({ lesson, mode, originX: event.clientX, start, span });
    setLessonDragPreview({ start, span });
  };

  const updateLessonDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!lessonDrag) return;
    const delta = Math.round((event.clientX - lessonDrag.originX) / slotWidth);
    setLessonDragPreview({
      start:
        lessonDrag.mode === 'move'
          ? clamp(lessonDrag.start + delta, 0, visibleMeetings - 1)
          : lessonDrag.start,
      span: lessonDrag.mode === 'resize' ? Math.max(1, lessonDrag.span + delta) : lessonDrag.span
    });
  };

  const finishLessonDrag = async () => {
    if (!lessonDrag || !lessonDragPreview) return;
    const patch =
      lessonDrag.mode === 'move'
        ? { plannedStartMeeting: lessonDragPreview.start }
        : { plannedMeetingCount: lessonDragPreview.span };
    const changed =
      lessonDrag.mode === 'move'
        ? lessonDragPreview.start !== lessonDrag.start
        : lessonDragPreview.span !== lessonDrag.span;
    setLessonDrag(null);
    setLessonDragPreview(null);
    if (!changed) return;
    try {
      setSaving(true);
      onCourseChange(await api.updateLesson(lessonDrag.lesson.id, patch));
      setStatus(
        lessonDrag.mode === 'move'
          ? `${lessonDrag.lesson.title} moved`
          : `${lessonDrag.lesson.title} duration updated`
      );
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Could not update lesson timing');
    } finally {
      setSaving(false);
    }
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

  const reorderLessonTo = async (unit: Unit, draggedId: string, targetId: string) => {
    if (draggedId === targetId || saving) return;
    const ordered = [...unit.lessons].sort((a, b) => a.orderIndex - b.orderIndex);
    const from = ordered.findIndex((lesson) => lesson.id === draggedId);
    const to = ordered.findIndex((lesson) => lesson.id === targetId);
    if (from < 0 || to < 0) return;
    const [moving] = ordered.splice(from, 1);
    if (!moving) return;
    ordered.splice(to, 0, moving);
    try {
      setSaving(true);
      let detail: CourseDetailResponse | null = null;
      for (const [index, lesson] of ordered.entries()) {
        if (lesson.orderIndex !== index) {
          detail = await api.updateLesson(lesson.id, { orderIndex: index });
        }
      }
      if (detail) onCourseChange(detail);
      setStatus(`${moving.title} reordered`);
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Could not reorder lessons');
    } finally {
      setSaving(false);
      setOutlineDraggedLessonId(null);
      setOutlineDropLessonId(null);
    }
  };

  const createGeneratedLessonDraft = async (unit: Unit) => {
    const meetingCount = clamp(Number(lessonGeneratorCount) || 1, 1, 30);
    if (lessonGeneratorPrompt.trim().length < 8) return;
    try {
      setIsGeneratingUnit(true);
      setGeneratedLessonDraft({
        unitId: unit.id,
        draft: await api.generateUnitDraft({
          courseName: course.name,
          gradeLevel: course.gradeLevel,
          prompt: `${unit.title}: ${lessonGeneratorPrompt.trim()}`,
          meetingCount: Math.max(2, meetingCount)
        })
      });
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Could not generate lesson ideas');
    } finally {
      setIsGeneratingUnit(false);
    }
  };

  const acceptGeneratedLessons = async (unit: Unit) => {
    if (!generatedLessonDraft || generatedLessonDraft.unitId !== unit.id) return;
    try {
      setSaving(true);
      let detail: CourseDetailResponse | null = null;
      for (const [offset, lesson] of generatedLessonDraft.draft.unit.lessons.entries()) {
        detail = await api.createLesson(unit.id, {
          title: lesson.title,
          description: lesson.description,
          estimatedDurationMinutes: lesson.estimatedDurationMinutes,
          orderIndex: nextOrder(unit.lessons) + offset,
          plannedMeetingCount: 1,
          lessonPlan: {
            objective: lesson.objective ?? null,
            teacherNotes: null,
            studentDirections: null,
            materials: lesson.materials ?? null,
            links: []
          }
        });
        const refreshedUnit = detail.course.units.find((item) => item.id === unit.id);
        const createdLesson = refreshedUnit?.lessons.find(
          (item) => item.orderIndex === nextOrder(unit.lessons) + offset
        );
        if (!createdLesson) continue;
        for (const [stepIndex, step] of lesson.steps.entries()) {
          detail = await api.createSegment(createdLesson.id, {
            title: step.title,
            description: step.description,
            durationMinutes: step.durationMinutes,
            stepType: step.stepType ?? null,
            orderIndex: stepIndex
          });
        }
      }
      if (detail) onCourseChange(detail);
      setGeneratedLessonDraft(null);
      setLessonGeneratorUnitId(null);
      setLessonGeneratorPrompt('');
      setStatus('Generated lessons added to the unit');
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Could not add generated lessons');
    } finally {
      setSaving(false);
    }
  };

  const createUnit = async () => {
    if (!manualUnitTitle.trim()) return;
    try {
      setSaving(true);
      onCourseChange(
        await api.createUnit(course.id, {
          title: manualUnitTitle.trim(),
          description: null,
          orderIndex: nextOrder(course.units),
          plannedStartMeeting: positions.length
            ? Math.max(...positions.map((item) => item.start + item.span))
            : 0,
          // A manually added unit starts as one visible meeting slot. Its
          // actual span grows from its lessons or the teacher's timeline drag;
          // it must never inherit an unexplained generator default.
          plannedMeetingCount: 1
        })
      );
      setManualUnitTitle('');
      setShowUnitComposer(false);
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Could not add the unit');
    } finally {
      setSaving(false);
    }
  };

  const saveLessonPlan = async (
    draftToSave = lessonPlanDraftRef.current,
    lessonId = selectedLessonIdRef.current
  ) => {
    if (!lessonId || !draftToSave.title.trim()) return;
    try {
      setSaving(true);
      onCourseChange(
        await api.updateLesson(lessonId, {
          title: draftToSave.title.trim(),
          description: nullable(draftToSave.overview),
          estimatedDurationMinutes: draftToSave.duration.trim()
            ? Math.max(1, Number(draftToSave.duration) || 1)
            : null,
          lessonPlan: {
            objective: nullable(draftToSave.objective),
            teacherNotes: nullable(draftToSave.teacherNotes),
            studentDirections: nullable(draftToSave.studentDirections),
            materials: nullable(draftToSave.materials),
            links: draftToSave.links
          }
        })
      );
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Could not save the lesson plan');
    } finally {
      setSaving(false);
    }
  };

  const queueLessonPlanSave = (next: LessonPlanDraft, delay = 550) => {
    lessonPlanDraftRef.current = next;
    setLessonPlanDraft(next);
    if (lessonPlanSaveTimer.current) clearTimeout(lessonPlanSaveTimer.current);
    lessonPlanSaveTimer.current = window.setTimeout(() => {
      lessonPlanSaveTimer.current = null;
      lessonPlanSaveChain.current = lessonPlanSaveChain.current.then(() => saveLessonPlan(next));
    }, delay);
  };

  const updateLessonPlanDraft = (patch: Partial<LessonPlanDraft>) =>
    queueLessonPlanSave({ ...lessonPlanDraftRef.current, ...patch });

  const flushLessonPlanSave = () => {
    if (lessonPlanSaveTimer.current) {
      clearTimeout(lessonPlanSaveTimer.current);
      lessonPlanSaveTimer.current = null;
    }
    const snapshot = lessonPlanDraftRef.current;
    lessonPlanSaveChain.current = lessonPlanSaveChain.current.then(() => saveLessonPlan(snapshot));
  };

  const closeLessonPanel = () => {
    flushLessonPlanSave();
    setSelection(null);
    onLessonSelectionChange?.(null);
  };

  useEffect(
    () => () => {
      if (!lessonPlanSaveTimer.current) return;
      clearTimeout(lessonPlanSaveTimer.current);
      lessonPlanSaveTimer.current = null;
      const snapshot = lessonPlanDraftRef.current;
      const lessonId = selectedLessonIdRef.current;
      if (lessonId) {
        lessonPlanSaveChain.current = lessonPlanSaveChain.current.then(() =>
          saveLessonPlan(snapshot, lessonId)
        );
      }
    },
    []
  );

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
    updateLessonPlanDraft({
      links: [...lessonPlanDraftRef.current.links, { title, url }]
    });
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

  const moveSegment = async (segmentId: string, direction: -1 | 1) => {
    if (!selectedLesson) return;
    const ordered = [...selectedLesson.segments].sort((a, b) => a.orderIndex - b.orderIndex);
    const index = ordered.findIndex((item) => item.id === segmentId);
    const neighborIndex = index + direction;
    if (index < 0 || neighborIndex < 0 || neighborIndex >= ordered.length) return;
    const segment = ordered[index];
    const neighbor = ordered[neighborIndex];
    if (!segment || !neighbor) return;
    ordered[index] = neighbor;
    ordered[neighborIndex] = segment;
    try {
      setSaving(true);
      onCourseChange(
        await api.reorderSegments(selectedLesson.id, { segmentIds: ordered.map((item) => item.id) })
      );
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Could not reorder the lesson steps');
    } finally {
      setSaving(false);
    }
  };

  const createDraft = async () => {
    const meetingCount = Number(draftMeetingCount);
    if (draftPrompt.trim().length < 8 || !Number.isInteger(meetingCount)) return;
    try {
      setSaving(true);
      setIsGeneratingUnit(true);
      setDraft(
        await api.generateUnitDraft({
          courseName: course.name,
          gradeLevel: course.gradeLevel,
          prompt: draftPrompt.trim(),
          meetingCount: clamp(meetingCount, 2, 30)
        })
      );
      setStatus(null);
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Could not make a draft right now');
    } finally {
      setIsGeneratingUnit(false);
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
          orderIndex: index,
          lessonPlan: {
            objective: lesson.objective ?? null,
            teacherNotes: null,
            studentDirections: null,
            materials: lesson.materials ?? null,
            links: []
          }
        });
        const createdUnit = detail.course.units.find((item) => item.id === unit.id);
        const createdLesson = createdUnit?.lessons.find((item) => item.orderIndex === index);
        if (!createdLesson) throw new Error(`Draft lesson \"${lesson.title}\" was not created`);
        for (const [stepIndex, step] of lesson.steps.entries()) {
          detail = await api.createSegment(createdLesson.id, {
            title: step.title,
            description: step.description,
            durationMinutes: step.durationMinutes,
            stepType: step.stepType ?? null,
            orderIndex: stepIndex
          });
        }
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

  const selectUnit = (unit: Unit) => {
    setSelection({ type: 'unit', id: unit.id });
    onLessonSelectionChange?.(null);
  };
  const selectLesson = (lesson: Lesson) => {
    setSelection({ type: 'lesson', id: lesson.id });
    onLessonSelectionChange?.(lesson.id);
  };

  return (
    <section
      className={`curriculum-workspace ${displayMode === 'outline' ? 'curriculum-outline-mode' : ''}`}
      aria-label={`${course.name} curriculum timeline`}
    >
      <div className="curriculum-workspace-topbar">
        <div className="curriculum-add-unit-control">
          <div className="curriculum-unit-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setUnitComposerMode('manual');
                setShowUnitComposer((open) => !open);
              }}
            >
              {showUnitComposer && unitComposerMode === 'manual' ? 'Close add unit' : '+ Add unit'}
            </button>
            {allowAutoGeneration ? (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  if (showUnitComposer && unitComposerMode === 'generate') {
                    setShowUnitComposer(false);
                  } else {
                    setUnitComposerMode('generate');
                    setShowUnitComposer(true);
                  }
                }}
              >
                {showUnitComposer && unitComposerMode === 'generate'
                  ? 'Close auto generator'
                  : '✦ Auto generator'}
              </button>
            ) : null}
          </div>
          {showUnitComposer ? (
            unitComposerMode === 'manual' ? (
              <div className="curriculum-unit-composer" aria-label="Manually add a unit">
                <input
                  className="input"
                  autoFocus
                  value={manualUnitTitle}
                  onChange={(event) => setManualUnitTitle(event.target.value)}
                  placeholder="Unit title"
                  aria-label="Unit title"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void createUnit();
                  }}
                />
                <button
                  type="button"
                  disabled={saving || !manualUnitTitle.trim()}
                  onClick={() => void createUnit()}
                >
                  Add unit
                </button>
              </div>
            ) : (
              <div
                className="curriculum-unit-generator"
                aria-label="Auto-generate a full unit plan"
              >
                <div>
                  <strong>Auto-generate a full unit plan</strong>
                  <span>Drafts a unit, lesson sequence, and lesson steps for your review.</span>
                </div>
                <div className="curriculum-unit-composer">
                  <input
                    className="input"
                    autoFocus
                    value={draftPrompt}
                    onChange={(event) => setDraftPrompt(event.target.value)}
                    placeholder="What should students learn?"
                    aria-label="What students should learn"
                  />
                  <label className="curriculum-meeting-count">
                    <span>Class meetings</span>
                    <input
                      className="curriculum-meeting-input"
                      type="number"
                      min="2"
                      max="30"
                      value={draftMeetingCount}
                      onChange={(event) => setDraftMeetingCount(event.target.value)}
                      placeholder="e.g. 6"
                      aria-label="How many class meetings this unit should cover"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={
                      saving ||
                      isGeneratingUnit ||
                      draftPrompt.trim().length < 8 ||
                      !Number.isInteger(Number(draftMeetingCount)) ||
                      Number(draftMeetingCount) < 2 ||
                      Number(draftMeetingCount) > 30
                    }
                    onClick={() => void createDraft()}
                  >
                    {isGeneratingUnit ? 'Generating plan…' : 'Generate plan'}
                  </button>
                </div>
                <small>Choose the number of times this course will meet for the unit.</small>
              </div>
            )
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
        <div className="curriculum-timeline-navigation" aria-label="Timeline navigation">
          <button
            className="secondary"
            type="button"
            aria-label="Show previous dates"
            onClick={() => scrollCanvasBy(-1)}
          >
            ←
          </button>
          <button
            className="secondary"
            type="button"
            disabled={!todayDate || !selectedSection || !rangeMeetings.length}
            onClick={scrollToToday}
          >
            Today
          </button>
          <button
            className="secondary"
            type="button"
            aria-label="Show next dates"
            onClick={() => scrollCanvasBy(1)}
          >
            →
          </button>
        </div>
        {selectedSection ? (
          <div className="curriculum-scope-control">
            <span>
              {editingSharedPlan
                ? 'Editing shared course timing'
                : `Planning ${selectedSection.sectionName}`}
            </span>
            <button
              className="secondary"
              type="button"
              onClick={() => setEditingSharedPlan((value) => !value)}
            >
              {editingSharedPlan ? 'Return to section planning' : 'Edit shared course plan'}
            </button>
          </div>
        ) : null}
      </div>

      {!meetings.length && selectedSection ? (
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
      </div>

      {draft && allowAutoGeneration ? (
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
          <small>{selection.type === 'unit' ? 'Unit selected' : 'Lesson selected'}</small>
          <details className="curriculum-selection-menu">
            <summary aria-label={`Actions for selected ${selection.type}`}>•••</summary>
            <div>
              {selection.type === 'lesson' && selectedLesson ? (
                <button type="button" onClick={() => onOpenLesson?.(selectedLesson.id)}>
                  Open lesson
                </button>
              ) : null}
              <button type="button" disabled={saving} onClick={() => void duplicateItem(selection)}>
                Duplicate {selection.type}
              </button>
              <button
                className="danger"
                type="button"
                disabled={saving}
                onClick={() => void deleteSelected()}
              >
                Delete {selection.type}
              </button>
            </div>
          </details>
        </div>
      ) : null}

      {contextMenu ? (
        <div
          className="curriculum-context-menu"
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {contextMenu.type === 'lesson' ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setContextMenu(null);
                if (onOpenLesson) onOpenLesson(contextMenu.id);
                else navigate(`/lessons/${contextMenu.id}`);
              }}
            >
              Open lesson
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            disabled={saving}
            onClick={() => void duplicateItem(contextMenu)}
          >
            Duplicate {contextMenu.type}
          </button>
          <button
            className="danger"
            type="button"
            role="menuitem"
            disabled={saving}
            onClick={() => void deleteSelected(contextMenu)}
          >
            Delete {contextMenu.type}
          </button>
        </div>
      ) : null}

      {selectedLesson ? (
        <>
          <button
            className="lesson-panel-backdrop"
            type="button"
            aria-label="Close lesson plan"
            onClick={closeLessonPanel}
          />
          <section
            className="lesson-plan-workspace lesson-plan-side-panel"
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
              <button className="secondary" type="button" onClick={closeLessonPanel}>
                Done
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() =>
                  onOpenLesson?.(selectedLesson.id) ?? navigate(`/lessons/${selectedLesson.id}`)
                }
              >
                Open Lesson
              </button>
            </div>
            <div className="lesson-plan-context">
              <strong>{selectedSection ? selectedSection.sectionName : 'Course curriculum'}</strong>
              <span>
                {selectedSection
                  ? (() => {
                      const unit = course.units.find((item) =>
                        item.lessons.some((lesson) => lesson.id === selectedLesson.id)
                      );
                      const index =
                        unit?.lessons.findIndex((lesson) => lesson.id === selectedLesson.id) ?? 0;
                      const fallback =
                        (positions.find((item) => item.unit.id === unit?.id)?.start ?? 0) + index;
                      const start = effectiveLessonStart(selectedLesson, fallback);
                      const date = sectionMeetings[start]?.date;
                      return date
                        ? `Planned for ${new Date(`${date}T12:00:00`).toLocaleDateString(
                            undefined,
                            {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric'
                            }
                          )} · meeting ${start + 1}`
                        : `Planned at meeting ${start + 1}`;
                    })()
                  : 'Shared lesson content'}
              </span>
              {selectedSection ? (
                <div className="lesson-plan-context-actions">
                  <button
                    className="secondary"
                    type="button"
                    disabled={saving}
                    onClick={() => void shiftSelectedSectionLesson(-1)}
                  >
                    Shift earlier
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    disabled={saving}
                    onClick={() => void shiftSelectedSectionLesson(1)}
                  >
                    Shift later
                  </button>
                  {lastSectionPlanOperation ? (
                    <button
                      className="button-link"
                      type="button"
                      disabled={saving}
                      onClick={() => void undoSectionShift()}
                    >
                      Undo section shift
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="lesson-plan-fields">
              <label>
                Lesson title
                <input
                  className="input"
                  value={lessonPlanDraft.title}
                  onChange={(event) => updateLessonPlanDraft({ title: event.target.value })}
                />
              </label>
              <label>
                Minutes
                <input
                  className="input"
                  type="number"
                  min="1"
                  value={lessonPlanDraft.duration}
                  onChange={(event) => updateLessonPlanDraft({ duration: event.target.value })}
                />
              </label>
              <label className="lesson-plan-wide">
                Overview
                <textarea
                  className="input"
                  value={lessonPlanDraft.overview}
                  onChange={(event) => updateLessonPlanDraft({ overview: event.target.value })}
                  placeholder="A short description of this lesson."
                />
              </label>
              <label className="lesson-plan-wide">
                Learning objective
                <textarea
                  className="input"
                  value={lessonPlanDraft.objective}
                  onChange={(event) => updateLessonPlanDraft({ objective: event.target.value })}
                  placeholder="Students will be able to…"
                />
              </label>
              <label>
                Materials
                <textarea
                  className="input"
                  value={lessonPlanDraft.materials}
                  onChange={(event) => updateLessonPlanDraft({ materials: event.target.value })}
                  placeholder="Handouts, supplies, technology…"
                />
              </label>
              <label>
                Student directions
                <textarea
                  className="input"
                  value={lessonPlanDraft.studentDirections}
                  onChange={(event) =>
                    updateLessonPlanDraft({ studentDirections: event.target.value })
                  }
                  placeholder="What students should do, see, or submit."
                />
              </label>
              <label className="lesson-plan-wide">
                Teacher notes
                <textarea
                  className="input"
                  value={lessonPlanDraft.teacherNotes}
                  onChange={(event) => updateLessonPlanDraft({ teacherNotes: event.target.value })}
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
                          updateLessonPlanDraft({
                            links: lessonPlanDraftRef.current.links.filter(
                              (_, linkIndex) => linkIndex !== index
                            )
                          })
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
                        {segment.durationMinutes
                          ? `${segment.durationMinutes} min`
                          : 'Time not set'}
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
                    <span className="segment-actions">
                      <button
                        className="secondary"
                        type="button"
                        disabled={
                          saving ||
                          [...selectedLesson.segments]
                            .sort((a, b) => a.orderIndex - b.orderIndex)
                            .findIndex((item) => item.id === segment.id) === 0
                        }
                        onClick={() => void moveSegment(segment.id, -1)}
                      >
                        ↑
                      </button>
                      <button
                        className="secondary"
                        type="button"
                        disabled={
                          saving ||
                          [...selectedLesson.segments]
                            .sort((a, b) => a.orderIndex - b.orderIndex)
                            .findIndex((item) => item.id === segment.id) ===
                            selectedLesson.segments.length - 1
                        }
                        onClick={() => void moveSegment(segment.id, 1)}
                      >
                        ↓
                      </button>
                    </span>
                  </article>
                ))}
              </div>
            </div>
          </section>
        </>
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
                  <div
                    className="curriculum-tree-row"
                    onContextMenu={(event) => openContextMenu(event, 'unit', position.unit.id)}
                  >
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
                            className={[
                              'curriculum-lesson-row',
                              selected ? 'selected' : '',
                              outlineDraggedLessonId === lesson.id ? 'dragging' : '',
                              outlineDropLessonId === lesson.id ? 'drop-target' : ''
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            onContextMenu={(event) => openContextMenu(event, 'lesson', lesson.id)}
                            onDragOver={(event) => {
                              event.preventDefault();
                              if (outlineDraggedLessonId !== lesson.id)
                                setOutlineDropLessonId(lesson.id);
                            }}
                            onDragLeave={() => {
                              if (outlineDropLessonId === lesson.id) setOutlineDropLessonId(null);
                            }}
                            onDrop={() => {
                              if (outlineDraggedLessonId)
                                void reorderLessonTo(
                                  position.unit,
                                  outlineDraggedLessonId,
                                  lesson.id
                                );
                            }}
                          >
                            <button
                              className="curriculum-lesson-reorder"
                              type="button"
                              draggable
                              aria-label={`Drag to reorder ${lesson.title}`}
                              onDragStart={(event) => {
                                event.dataTransfer.effectAllowed = 'move';
                                setOutlineDraggedLessonId(lesson.id);
                              }}
                              onDragEnd={() => {
                                setOutlineDraggedLessonId(null);
                                setOutlineDropLessonId(null);
                              }}
                            >
                              ⠿
                            </button>
                            <button type="button" onClick={() => selectLesson(lesson)}>
                              {lesson.title}
                            </button>
                            <small>{lesson.plannedMeetingCount ?? 1} mtg</small>
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
                      ) : null}
                      <div className="curriculum-lesson-create-actions">
                        <button
                          className="curriculum-add-lesson"
                          type="button"
                          onClick={() => {
                            setQuickLessonUnitId(position.unit.id);
                            setLessonGeneratorUnitId(null);
                            setQuickLessonTitle('');
                          }}
                        >
                          + Add lesson
                        </button>
                        <button
                          className="curriculum-generate-lessons"
                          type="button"
                          onClick={() => {
                            setLessonGeneratorUnitId((id) =>
                              id === position.unit.id ? null : position.unit.id
                            );
                            setQuickLessonUnitId(null);
                            setGeneratedLessonDraft(null);
                          }}
                        >
                          ✦ Auto-generate lessons
                        </button>
                      </div>
                      {lessonGeneratorUnitId === position.unit.id ? (
                        <div className="curriculum-lesson-generator">
                          <input
                            className="curriculum-inline-input"
                            value={lessonGeneratorPrompt}
                            onChange={(event) => setLessonGeneratorPrompt(event.target.value)}
                            placeholder="Topic or learning goal"
                            aria-label={`Lesson generation topic for ${position.unit.title}`}
                          />
                          <label>
                            <span>Meetings</span>
                            <input
                              className="curriculum-inline-input"
                              type="number"
                              min="2"
                              max="30"
                              value={lessonGeneratorCount}
                              onChange={(event) => setLessonGeneratorCount(event.target.value)}
                            />
                          </label>
                          {generatedLessonDraft?.unitId === position.unit.id ? (
                            <div className="curriculum-generated-lessons">
                              <span>Auto-generated draft · not added yet</span>
                              <ol>
                                {generatedLessonDraft.draft.unit.lessons.map((lesson) => (
                                  <li key={lesson.title}>{lesson.title}</li>
                                ))}
                              </ol>
                              <div>
                                <button
                                  type="button"
                                  disabled={saving}
                                  onClick={() => void acceptGeneratedLessons(position.unit)}
                                >
                                  Add generated lessons
                                </button>
                                <button
                                  className="secondary"
                                  type="button"
                                  onClick={() => setGeneratedLessonDraft(null)}
                                >
                                  Discard
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={isGeneratingUnit || lessonGeneratorPrompt.trim().length < 8}
                              onClick={() => void createGeneratedLessonDraft(position.unit)}
                            >
                              {isGeneratingUnit ? 'Generating…' : 'Generate lesson draft'}
                            </button>
                          )}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </aside>

        <div className="curriculum-canvas-wrap" ref={canvasWrapRef}>
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
                <div key={position.unit.id} className="curriculum-track-group">
                  <div
                    className="curriculum-track-row"
                    onPointerDown={(event) => {
                      if ((event.target as HTMLElement).closest('button, article')) return;
                      beginRangeDrag(event, position.unit.id);
                    }}
                    onPointerMove={updateRangeDrag}
                    onPointerUp={finishRangeDrag}
                    onPointerCancel={() => {
                      setRangeDrag(null);
                      setRangePreview(null);
                    }}
                  >
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
                      onContextMenu={(event) => openContextMenu(event, 'unit', position.unit.id)}
                    >
                      <button
                        className="curriculum-unit-grab"
                        type="button"
                        aria-label={`Move ${position.unit.title}`}
                        disabled={!canEditSharedPlan}
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
                        disabled={!canEditSharedPlan}
                        onPointerDown={(event) => beginUnitDrag(event, position, 'resize')}
                        onPointerMove={updateUnitDrag}
                        onPointerUp={finishUnitDrag}
                        onPointerCancel={() => {
                          setDrag(null);
                          setDragPreview(null);
                        }}
                      />
                    </article>
                  </div>
                  {expanded
                    ? position.unit.lessons.map((lesson, index) => {
                        const defaultLessonSpan = Math.max(
                          1,
                          Math.floor(span / Math.max(1, position.unit.lessons.length))
                        );
                        const defaultLessonStart =
                          start + Math.min(span - 1, index * defaultLessonSpan);
                        const lessonSpan = effectiveLessonSpan(lesson, defaultLessonSpan);
                        const lessonStart = effectiveLessonStart(lesson, defaultLessonStart);
                        const active = currentLessonId === lesson.id;
                        const selectedLesson =
                          selection?.type === 'lesson' && selection.id === lesson.id;
                        const isLessonDragging = lessonDrag?.lesson.id === lesson.id;
                        const displayStart =
                          isLessonDragging && lessonDragPreview
                            ? lessonDragPreview.start
                            : lessonStart;
                        const displaySpan =
                          isLessonDragging && lessonDragPreview
                            ? lessonDragPreview.span
                            : lessonSpan;
                        return (
                          <div
                            key={lesson.id}
                            className="curriculum-track-row curriculum-lesson-track-row"
                          >
                            <article
                              className={[
                                'curriculum-lesson-bar',
                                active ? 'current' : '',
                                selectedLesson ? 'selected' : '',
                                isLessonDragging ? 'dragging' : ''
                              ]
                                .filter(Boolean)
                                .join(' ')}
                              style={{
                                gridColumn: `${displayStart + 1} / span ${Math.max(1, Math.min(displaySpan, visibleMeetings - displayStart))}`
                              }}
                              aria-label={`${lesson.title}, ${displaySpan} ${displaySpan === 1 ? 'meeting' : 'meetings'}`}
                              onContextMenu={(event) => openContextMenu(event, 'lesson', lesson.id)}
                            >
                              <button
                                className="curriculum-lesson-grab"
                                type="button"
                                aria-label={`Move ${lesson.title} on timeline`}
                                onPointerDown={(event) =>
                                  beginLessonDrag(event, lesson, 'move', lessonStart, lessonSpan)
                                }
                                onPointerMove={updateLessonDrag}
                                onPointerUp={() => void finishLessonDrag()}
                                onPointerCancel={() => {
                                  setLessonDrag(null);
                                  setLessonDragPreview(null);
                                }}
                              >
                                ⠿
                              </button>
                              <button
                                className="curriculum-lesson-content"
                                type="button"
                                onClick={() => selectLesson(lesson)}
                              >
                                <span>{lesson.title}</span>
                                <small>{displaySpan} mtg</small>
                              </button>
                              <button
                                className="curriculum-lesson-resize"
                                type="button"
                                aria-label={`Resize ${lesson.title}`}
                                onPointerDown={(event) =>
                                  beginLessonDrag(event, lesson, 'resize', lessonStart, lessonSpan)
                                }
                                onPointerMove={updateLessonDrag}
                                onPointerUp={() => void finishLessonDrag()}
                                onPointerCancel={() => {
                                  setLessonDrag(null);
                                  setLessonDragPreview(null);
                                }}
                              />
                            </article>
                          </div>
                        );
                      })
                    : null}
                  {expanded ? (
                    <div
                      className={`curriculum-lesson-action-track ${
                        lessonGeneratorUnitId === position.unit.id ? 'is-generator-open' : ''
                      } ${quickLessonUnitId === position.unit.id ? 'is-add-open' : ''}`}
                    />
                  ) : null}
                </div>
              );
            })}
            <div
              className="curriculum-track-row curriculum-create-lane"
              aria-label="Create curriculum in an empty planning range"
              onPointerDown={(event) => beginRangeDrag(event, null)}
              onPointerMove={updateRangeDrag}
              onPointerUp={finishRangeDrag}
              onPointerCancel={() => {
                setRangeDrag(null);
                setRangePreview(null);
              }}
            >
              <span>Drag across dates to plan</span>
            </div>
            {rangePreview ? (
              <div
                className={`curriculum-range-preview${rangeOverlapsExistingPlan(rangePreview) ? ' conflict' : ''}`}
                style={{
                  left: rangePreview.start * slotWidth,
                  width: rangePreview.meetingCount * slotWidth,
                  top: rangeDrag ? rangeDrag.laneTop : 0
                }}
              >
                <span>{planningRangeLabel(rangePreview, rangeMeetings)}</span>
                {rangeOverlapsExistingPlan(rangePreview) ? <small>Existing plan</small> : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {rangeDraft ? (
        <div
          className="curriculum-range-popover"
          role="dialog"
          aria-label="Create curriculum range"
        >
          <div>
            <p className="eyebrow">Create in selected range</p>
            <strong>{planningRangeLabel(rangeDraft, rangeMeetings)}</strong>
            <span>{rangeDraft.meetingCount} course meetings selected.</span>
            {rangeOverlapsExistingPlan(rangeDraft) && rangeKind === 'unit' ? (
              <p className="curriculum-range-conflict" role="status">
                An existing unit is planned here. It will not be overwritten; choose another range
                or add lessons to a selected unit instead.
              </p>
            ) : null}
          </div>
          <div className="curriculum-range-kind" role="group" aria-label="What to create">
            <button
              type="button"
              className={rangeKind === 'unit' ? 'active' : ''}
              onClick={() => setRangeKind('unit')}
            >
              New unit
            </button>
            <button
              type="button"
              className={rangeKind === 'lessons' ? 'active' : ''}
              onClick={() => setRangeKind('lessons')}
            >
              Create lessons
            </button>
          </div>
          {rangeKind === 'lessons' ? (
            <label>
              Unit
              <select
                className="input"
                value={rangeUnitId}
                onChange={(event) => setRangeUnitId(event.target.value)}
              >
                {course.units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.title}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            {rangeKind === 'unit' ? 'Unit title' : 'Lesson title prefix'}
            <input
              className="input"
              value={rangeTitle}
              onChange={(event) => setRangeTitle(event.target.value)}
              placeholder={rangeKind === 'unit' ? 'Ancient Civilizations' : 'Lesson'}
            />
          </label>
          <label>
            {rangeKind === 'unit' ? 'Optional starter lessons' : 'Lessons'}
            <input
              className="input"
              type="number"
              min="1"
              max={Math.min(30, rangeDraft.meetingCount)}
              value={rangeLessonCount}
              onChange={(event) => setRangeLessonCount(event.target.value)}
            />
          </label>
          <div className="profile-actions">
            <button
              type="button"
              disabled={
                saving ||
                (rangeKind === 'lessons' && !rangeUnitId) ||
                (rangeKind === 'unit' && rangeOverlapsExistingPlan(rangeDraft))
              }
              onClick={() => void confirmRangeCreation()}
            >
              Create
            </button>
            <button className="secondary" type="button" onClick={() => setRangeDraft(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

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
