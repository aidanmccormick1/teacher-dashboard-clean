import { positionCurriculumUnits } from '@teacheros/contracts';
import { recordFeedbackEvent } from '../lib/feedbackDiagnostics.js';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
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
  planningRangesOverlap,
  type PlanningRange
} from '../lib/year-plan-range.js';
import { isGoogleSlidesUrl } from '../lib/googleSlides.js';
import { projectMeetingsForSection } from '../lib/year-plan-projection.js';
import {
  editClipRange,
  reflowLessonRanges,
  snapClipDelta,
  type ClipRange,
  type TrimMode
} from '../lib/timeline-editing.js';
import { TimelineIcon } from './TimelineIcon.js';
import { useTimelineViewport } from './useTimelineViewport.js';
import { UnitPlanningWorkspace } from './UnitPlanningWorkspace.js';
import './CurriculumTimeline.css';
import './TimelineEditor.css';

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
type TimelineSlot = {
  startMeeting: number;
  endMeeting: number;
  label: string;
};
type Selection = { type: 'unit' | 'lesson'; id: string } | null;
type ContextMenu = { type: 'unit' | 'lesson'; id: string; x: number; y: number } | null;
type PositionedUnit = { unit: Unit; start: number; span: number };
type PendingChange =
  | { kind: 'move'; unit: PositionedUnit; start: number; delta: number }
  | { kind: 'resize'; unit: PositionedUnit; start?: number; span: number; delta: number };
type Drag = { unit: PositionedUnit; mode: TrimMode; originX: number; scrollLeft: number };
type LessonDrag = {
  lesson: Lesson;
  mode: TrimMode;
  originX: number;
  scrollLeft: number;
  start: number;
  span: number;
  unitStart: number;
  unitEnd: number;
};
type OutlineDropPosition = { unitId: string; index: number } | null;
type OutlineUnitDropPosition = number | null;
type RangeDrag = {
  originSlotIndex: number;
  originX: number;
  unitId: string | null;
  laneTop: number;
};
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function overlaps(a: PositionedUnit, b: PositionedUnit) {
  return planningRangesOverlap(
    { start: a.start, meetingCount: a.span },
    { start: b.start, meetingCount: b.span }
  );
}

function nextOrder(items: Array<{ orderIndex: number }>) {
  return items.reduce((largest, item) => Math.max(largest, item.orderIndex), -1) + 1;
}

function distributeMeetingSpans(start: number, meetingCount: number, lessonCount: number) {
  if (lessonCount < 1) return [];
  if (lessonCount > meetingCount) {
    return Array.from({ length: lessonCount }, (_, index) => ({
      start: start + Math.floor((index * meetingCount) / lessonCount),
      span: 1
    }));
  }
  const base = Math.floor(meetingCount / lessonCount);
  const remainder = meetingCount % lessonCount;
  let cursor = start;
  return Array.from({ length: lessonCount }, (_, index) => {
    const span = Math.max(1, base + (index < remainder ? 1 : 0));
    const range = { start: cursor, span };
    cursor += span;
    return range;
  });
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
  const [selection, setSelection] = useState<Selection>(null);
  const [openLessonPlanId, setOpenLessonPlanId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu>(null);
  const [expandedUnitIds, setExpandedUnitIds] = useState<string[]>(() =>
    course.units.map((unit) => unit.id)
  );
  const [showUnitComposer, setShowUnitComposer] = useState(false);
  const [planningOpen, setPlanningOpen] = useState(false);
  const planEntry = useRef<HTMLButtonElement>(null);
  const [planningError, setPlanningError] = useState<string | null>(null);
  const [addingPlan, setAddingPlan] = useState(false);
  const [planSaveFailed, setPlanSaveFailed] = useState(false);
  const [addedUnitId, setAddedUnitId] = useState<string | null>(null);
  const [quickLessonUnitId, setQuickLessonUnitId] = useState<string | null>(null);
  const [quickLessonTitle, setQuickLessonTitle] = useState('');
  const [manualUnitTitle, setManualUnitTitle] = useState('');
  const [draftPrompt, setDraftPrompt] = useState('');
  const [draftMeetingCount, setDraftMeetingCount] = useState('');
  const [draftMinutesPerMeeting, setDraftMinutesPerMeeting] = useState('');
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
  const [dragPreview, setDragPreview] = useState<ClipRange | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [timingStart, setTimingStart] = useState('');
  const [timingSpan, setTimingSpan] = useState('');
  const [lessonDrag, setLessonDrag] = useState<LessonDrag | null>(null);
  const [lessonDragPreview, setLessonDragPreview] = useState<{
    start: number;
    span: number;
  } | null>(null);
  const [outlineDraggedLessonId, setOutlineDraggedLessonId] = useState<string | null>(null);
  const [outlineDropPosition, setOutlineDropPosition] = useState<OutlineDropPosition>(null);
  const [outlineDraggedUnitId, setOutlineDraggedUnitId] = useState<string | null>(null);
  const [outlineUnitDropPosition, setOutlineUnitDropPosition] =
    useState<OutlineUnitDropPosition>(null);
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null);
  const [meetingData, setMeetingData] = useState<MeetingInstancesResponse | null>(null);
  const [lessonPlanDraft, setLessonPlanDraft] = useState<LessonPlanDraft>(emptyLessonPlan);
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [newSegmentTitle, setNewSegmentTitle] = useState('');
  const [newSegmentMinutes, setNewSegmentMinutes] = useState('');
  const [newSegmentDescription, setNewSegmentDescription] = useState('');
  const [sectionPlans, setSectionPlans] = useState<SectionLessonPlanResponse['plans']>([]);
  type LocalTimingAction = { operationId: string; lessonId: string; start: number; count: number };
  const [localUndo, setLocalUndo] = useState<LocalTimingAction[]>([]);
  const [localRedo, setLocalRedo] = useState<LocalTimingAction[]>([]);
  const localHead = useRef<string | null | undefined>(undefined);
  const lastSectionPlanOperation = localUndo.at(-1)?.operationId;

  const [editingSharedPlan, setEditingSharedPlan] = useState(false);
  const [rangeDrag, setRangeDrag] = useState<RangeDrag | null>(null);
  const [rangePreview, setRangePreview] = useState<RangeDraft | null>(null);
  const [rangeDraft, setRangeDraft] = useState<RangeDraft | null>(null);
  const [rangeKind, setRangeKind] = useState<'unit' | 'lessons'>('unit');
  const [rangeTitle, setRangeTitle] = useState('');
  const [rangeLessonCount, setRangeLessonCount] = useState('');
  const [rangeUnitId, setRangeUnitId] = useState('');
  const [todayDate, setTodayDate] = useState<string | null>(null);
  const [selectedUnitSlidesUrl, setSelectedUnitSlidesUrl] = useState('');
  const [selectedUnitStartSlide, setSelectedUnitStartSlide] = useState('1');
  const [selectedLessonSlidesUrl, setSelectedLessonSlidesUrl] = useState('');
  const [selectedLessonStartSlide, setSelectedLessonStartSlide] = useState('1');
  const workspaceRef = useRef<HTMLElement>(null);
  const pointerRef = useRef<{ clientX: number; altKey: boolean } | null>(null);
  const suppressClick = useRef(false);
  const busyRef = useRef(false);
  type TimingPatch = {
    type: 'unit' | 'lesson';
    id: string;
    before: { plannedStartMeeting: number | null; plannedMeetingCount: number | null };
    after: { plannedStartMeeting: number | null; plannedMeetingCount: number | null };
  };
  type LessonOrderAction = {
    unitId: string;
    before: Array<{ id: string; orderIndex: number }>;
    after: Array<{ id: string; orderIndex: number }>;
  };
  const [orderUndo, setOrderUndo] = useState<LessonOrderAction[]>([]);
  const [orderRedo, setOrderRedo] = useState<LessonOrderAction[]>([]);
  const orderRevisions = useRef<Record<string, number>>({});
  const timingRevisions = useRef<Record<string, number>>({});
  const [undoStack, setUndoStack] = useState<TimingPatch[][]>([]);
  const [redoStack, setRedoStack] = useState<TimingPatch[][]>([]);
  const lessonPlanSaveTimer = useRef<number | null>(null);
  const lessonPlanSaveChain = useRef<Promise<void>>(Promise.resolve());
  const lessonPlanDraftRef = useRef<LessonPlanDraft>(emptyLessonPlan());
  const hydratedLessonId = useRef<string | null>(null);
  const lessonDraftRevisions = useRef<Record<string, number>>({});
  const selectedLessonIdRef = useRef<string | null>(null);
  const selectedLessonRef = useRef<Lesson | null>(null);
  const saveLessonPlanRef = useRef<
    ((draftToSave?: LessonPlanDraft, lessonId?: string | null) => Promise<void>) | null
  >(null);
  const scrollStorageKey = `teacheros_year_plan_scroll_${course.id}_${selectedSection?.sectionId ?? 'none'}_${displayMode}`;
  const selectedSectionId = selectedSection?.sectionId;
  const knownUnitIds = useRef(course.units.map((unit) => unit.id));
  const structureKey = course.units
    .map((unit) => `${unit.id}:${unit.lessons.map((lesson) => lesson.id).join(',')}`)
    .join('|');

  useEffect(() => {
    const ids = course.units.map((unit) => unit.id);
    const added = ids.filter((id) => !knownUnitIds.current.includes(id));
    setExpandedUnitIds((previous) => [...previous.filter((id) => ids.includes(id)), ...added]);
    knownUnitIds.current = ids;
  }, [course.units]);
  useEffect(() => {
    setUndoStack([]);
    setRedoStack([]);
  }, [structureKey]);

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
    if (!selectedSectionId) {
      setSectionPlans([]);
      setLocalUndo([]);
      setLocalRedo([]);
      localHead.current = undefined;
      setEditingSharedPlan(false);
      return;
    }
    // Section-specific timing is the safe default whenever the planning
    // context changes. Shared curriculum edits require an explicit choice.
    setEditingSharedPlan(false);
    setLocalUndo([]);
    setLocalRedo([]);
    localHead.current = undefined;
    let active = true;
    void api
      .getSectionLessonPlans(selectedSectionId)
      .then((value) => {
        if (active) setSectionPlans(value.plans);
      })
      .catch(() => {
        if (active) setSectionPlans([]);
      });
    return () => {
      active = false;
    };
  }, [api, selectedSectionId]);

  useEffect(() => {
    if (!initialLessonId) return;
    setSelection({ type: 'lesson', id: initialLessonId });
  }, [initialLessonId]);

  const positions = useMemo(() => positionCurriculumUnits(course.units), [course.units]);
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
  const selectedLessonId = selectedLesson?.id;
  selectedLessonRef.current = selectedLesson;

  useEffect(() => {
    setSelectedUnitSlidesUrl(selectedUnit?.googleSlidesUrl ?? '');
    setSelectedUnitStartSlide(String(selectedUnit?.googleSlidesStartSlide ?? 1));
  }, [selectedUnit?.googleSlidesStartSlide, selectedUnit?.googleSlidesUrl, selectedUnit?.id]);
  useEffect(() => {
    setSelectedLessonSlidesUrl(selectedLesson?.googleSlidesUrl ?? '');
    setSelectedLessonStartSlide(String(selectedLesson?.googleSlidesStartSlide ?? 1));
  }, [selectedLesson?.googleSlidesStartSlide, selectedLesson?.googleSlidesUrl, selectedLesson?.id]);
  const sectionMeetings = useMemo(
    () => projectMeetingsForSection(meetingData, selectedSection?.sectionId ?? null),
    [meetingData, selectedSection]
  );
  const meetings = useMemo(
    () =>
      editingSharedPlan
        ? []
        : sectionMeetings.map((meeting) => new Date(`${meeting.date}T12:00:00`)),
    [editingSharedPlan, sectionMeetings]
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
  // Zoom changes density, never scope. Every view represents the complete
  // instructional year so moving between Meeting, Week, Month, and Year cannot
  // hide later meetings or change the meeting index beneath a lesson.
  const visibleMeetings = Math.max(
    furthestMeeting,
    selectedSection ? sectionMeetings.length : schoolYearWeeks
  );
  const {
    canvasRef: canvasWrapRef,
    scale: slotWidth,
    zoomTo,
    minScale,
    viewport,
    handTool,
    setHandTool,
    spaceHeld,
    setSpaceHeld,
    panning,
    panHandlers
  } = useTimelineViewport(
    visibleMeetings,
    scrollStorageKey,
    Boolean(drag || lessonDrag || rangeDrag)
  );
  const courseMeetingSlots = useMemo(
    () =>
      Array.from(
        { length: Math.max(80, visibleMeetings, furthestMeeting) },
        (): { date?: string } => ({})
      ),
    [furthestMeeting, visibleMeetings]
  );
  const timelineSlots = useMemo<TimelineSlot[]>(
    () =>
      Array.from({ length: visibleMeetings }, (_, index) => ({
        startMeeting: index,
        endMeeting: index + 1,
        label:
          meetings[index]?.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) ??
          `Meeting ${index + 1}`
      })),
    [meetings, visibleMeetings]
  );
  const displaySlotForMeeting = (meetingIndex: number) =>
    Math.max(
      0,
      timelineSlots.findIndex(
        (slot) => meetingIndex >= slot.startMeeting && meetingIndex < slot.endMeeting
      )
    );
  const displayRangeForMeetings = (start: number, span: number) => {
    const startSlot = displaySlotForMeeting(start);
    const endSlot = displaySlotForMeeting(Math.max(start, start + span - 1));
    return { start: startSlot, span: Math.max(1, endSlot - startSlot + 1) };
  };
  const conflicts = positions.flatMap((position, index) =>
    positions
      .slice(index + 1)
      .filter((other) => overlaps(position, other))
      .map((other) => `${position.unit.title} overlaps ${other.unit.title}`)
  );
  const pendingPosition: PositionedUnit | null = pendingChange
    ? {
        unit: pendingChange.unit.unit,
        start:
          pendingChange.kind === 'move'
            ? pendingChange.start
            : (pendingChange.start ?? pendingChange.unit.start),
        span: pendingChange.kind === 'resize' ? pendingChange.span : pendingChange.unit.span
      }
    : null;
  const pendingConflicts = pendingPosition
    ? positions.filter(
        (other) => other.unit.id !== pendingPosition.unit.id && overlaps(pendingPosition, other)
      )
    : [];
  const plannedMeetings = positions.reduce((count, item) => count + item.span, 0);
  const planningBase = meetings.length || visibleMeetings;
  const plannedPercent = planningBase
    ? Math.min(100, Math.round((plannedMeetings / planningBase) * 100))
    : 0;
  const unplannedMeetings = Math.max(0, planningBase - plannedMeetings);
  const canEditSharedPlan = !selectedSection || editingSharedPlan;
  const canEditLessonTiming = canEditSharedPlan || sectionMeetings.length > 0;
  const rangeOverlapsExistingPlan = (range: RangeDraft) =>
    !range.unitId &&
    planningRangeIntersects(
      range,
      positions.map((position) => ({ start: position.start, meetingCount: position.span }))
    );

  const effectiveLessonStart = (lesson: Lesson, fallback: number) =>
    (editingSharedPlan ? undefined : sectionPlanByLesson.get(lesson.id)?.plannedStartMeeting) ??
    lesson.plannedStartMeeting ??
    fallback;
  const effectiveLessonSpan = (lesson: Lesson, fallback: number) =>
    (editingSharedPlan ? undefined : sectionPlanByLesson.get(lesson.id)?.plannedMeetingCount) ??
    lesson.plannedMeetingCount ??
    fallback;

  // Course planning is expressed as a shared sequence of meeting numbers.
  // A selected section contributes real dates, but is never required to plan.
  const rangeMeetings =
    sectionMeetings.length && !editingSharedPlan ? sectionMeetings : courseMeetingSlots;
  const slotFromPointer = (clientX: number) => {
    const canvas = canvasWrapRef.current;
    if (!canvas || !rangeMeetings.length) return null;
    const bounds = canvas.getBoundingClientRect();
    const index = Math.floor((clientX - bounds.left + canvas.scrollLeft) / slotWidth);
    return clamp(index, 0, timelineSlots.length - 1);
  };
  const beginRangeDrag = (event: ReactPointerEvent<HTMLDivElement>, unitId: string | null) => {
    if (!rangeMeetings.length || saving || !canEditSharedPlan || event.button !== 0) return;
    const slotIndex = slotFromPointer(event.clientX);
    if (slotIndex === null) return;
    const slot = timelineSlots[slotIndex];
    if (!slot) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const canvas = event.currentTarget.closest('.curriculum-canvas');
    setRangeDrag({
      originSlotIndex: slotIndex,
      originX: event.clientX,
      unitId,
      laneTop: canvas
        ? event.currentTarget.getBoundingClientRect().top - canvas.getBoundingClientRect().top
        : event.currentTarget.offsetTop
    });
    setRangePreview(null);
  };
  const updateRangeDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!rangeDrag) return;
    const slotIndex = slotFromPointer(event.clientX);
    if (slotIndex === null || Math.abs(event.clientX - rangeDrag.originX) < 6) return;
    const slot = timelineSlots[slotIndex];
    if (!slot) return;
    const originSlot = timelineSlots[rangeDrag.originSlotIndex];
    if (!originSlot) return;
    const range = normalizePlanningRange(
      Math.min(originSlot.startMeeting, slot.startMeeting),
      Math.max(originSlot.endMeeting, slot.endMeeting) - 1,
      rangeMeetings
    );
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
    const index = displaySlotForMeeting(
      targetIndex === -1 ? rangeMeetings.length - 1 : targetIndex
    );
    canvas.scrollTo({
      left: Math.max(0, index * slotWidth - Math.max(slotWidth, canvas.clientWidth * 0.28)),
      behavior: 'smooth'
    });
  };

  const saveSelectedUnitSlides = async () => {
    if (!selectedUnit) return;
    const url = selectedUnitSlidesUrl.trim();
    if (!isGoogleSlidesUrl(url)) {
      setStatus('Paste a Google Slides presentation link to add Unit Slides.');
      return;
    }
    const startSlide = Number(selectedUnitStartSlide || '1');
    if (!Number.isInteger(startSlide) || startSlide < 1) {
      setStatus('The starting slide must be a whole number of 1 or greater.');
      return;
    }
    try {
      setSaving(true);
      onCourseChange(
        await api.updateUnit(selectedUnit.id, {
          googleSlidesUrl: url,
          googleSlidesStartSlide: startSlide
        })
      );
      setStatus(`Unit Slides saved for ${selectedUnit.title}.`);
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Could not save Unit Slides.');
    } finally {
      setSaving(false);
    }
  };

  const removeSelectedUnitSlides = async () => {
    if (!selectedUnit) return;
    try {
      setSaving(true);
      onCourseChange(
        await api.updateUnit(selectedUnit.id, {
          googleSlidesUrl: null,
          googleSlidesStartSlide: 1
        })
      );
      setSelectedUnitSlidesUrl('');
      setSelectedUnitStartSlide('1');
      setStatus(`Unit Slides removed from ${selectedUnit.title}.`);
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Could not remove Unit Slides.');
    } finally {
      setSaving(false);
    }
  };

  const saveSelectedLessonSlides = async () => {
    if (!selectedLesson) return;
    const url = selectedLessonSlidesUrl.trim();
    if (!isGoogleSlidesUrl(url)) {
      setStatus('Paste a Google Slides presentation link to add Lesson Slides.');
      return;
    }
    const startSlide = Number(selectedLessonStartSlide || '1');
    if (!Number.isInteger(startSlide) || startSlide < 1) {
      setStatus('The starting slide must be a whole number of 1 or greater.');
      return;
    }
    try {
      setSaving(true);
      onCourseChange(
        await api.updateLesson(selectedLesson.id, {
          expectedRevision: selectedLesson.editRevision,
          googleSlidesUrl: url,
          googleSlidesStartSlide: startSlide
        })
      );
      setStatus(`Lesson Slides saved for ${selectedLesson.title}.`);
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Could not save Lesson Slides.');
    } finally {
      setSaving(false);
    }
  };

  const removeSelectedLessonSlides = async () => {
    if (!selectedLesson) return;
    try {
      setSaving(true);
      onCourseChange(
        await api.updateLesson(selectedLesson.id, {
          expectedRevision: selectedLesson.editRevision,
          googleSlidesUrl: null,
          googleSlidesStartSlide: 1
        })
      );
      setSelectedLessonSlidesUrl('');
      setSelectedLessonStartSlide('1');
      setStatus(`Lesson Slides removed from ${selectedLesson.title}.`);
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Could not remove Lesson Slides.');
    } finally {
      setSaving(false);
    }
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

  const travelLocalTiming = async (direction: 'undo' | 'redo') => {
    const action = (direction === 'undo' ? localUndo : localRedo).at(-1);
    if (!selectedSection || !action || saving || busyRef.current) return;
    busyRef.current = true;
    setSaving(true);
    try {
      const response =
        direction === 'undo'
          ? await api.undoSectionLessonPlanShift(selectedSection.sectionId, action.operationId)
          : await api.setSectionLessonTiming(
              selectedSection.sectionId,
              action.lessonId,
              action.start,
              action.count,
              localHead.current
            );
      setSectionPlans(response.plans);
      if (direction === 'undo') {
        localHead.current = response.previousOperationId ?? null;
        setLocalUndo((items) => items.slice(0, -1));
        setLocalRedo((items) => [...items, action]);
      } else if (response.operationId) {
        localHead.current = response.operationId;
        setLocalRedo((items) => items.slice(0, -1));
        setLocalUndo((items) => [...items, { ...action, operationId: response.operationId! }]);
      }
      setStatus(
        `${direction === 'undo' ? 'Undid' : 'Redid'} timing for ${selectedSection.sectionName}.`
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setLocalRedo([]);
      setStatus(err instanceof ApiError ? err.message : 'Could not change class timing.');
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  };

  const toggleExpanded = (unitId: string) => {
    setExpandedUnitIds((previous) =>
      previous.includes(unitId) ? previous.filter((id) => id !== unitId) : [...previous, unitId]
    );
  };

  useEffect(() => {
    const lesson = selectedLessonRef.current;
    if (!selectedLessonId || !lesson) {
      hydratedLessonId.current = null;
      selectedLessonIdRef.current = null;
      return;
    }
    selectedLessonIdRef.current = selectedLessonId;
    if (hydratedLessonId.current === selectedLessonId) return;
    hydratedLessonId.current = selectedLessonId;
    lessonDraftRevisions.current[selectedLessonId] = lesson.editRevision ?? 0;
    const plan = lesson.lessonPlan;
    setLessonPlanDraft({
      title: lesson.title,
      duration: lesson.estimatedDurationMinutes?.toString() ?? '',
      overview: lesson.description ?? '',
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
  }, [selectedLessonId]);

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

  const renameUnit = async (unitId: string) => {
    const unit = course.units.find((candidate) => candidate.id === unitId);
    if (!unit || saving) return;
    const title = window.prompt('Edit unit name', unit.title)?.trim();
    setContextMenu(null);
    if (!title || title === unit.title) return;
    try {
      setSaving(true);
      onCourseChange(await api.updateUnit(unit.id, { title }));
      setStatus('Unit name updated');
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Could not update the unit name');
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

  const persistTiming = async (
    patches: TimingPatch[],
    direction: 'before' | 'after' = 'after',
    record = true
  ) => {
    if (busyRef.current || saving || !patches.length) return false;
    if (!canEditSharedPlan) {
      const patch = patches[0]!;
      const timing = patch[direction];
      if (
        !selectedSection ||
        !sectionMeetings.length ||
        patches.length !== 1 ||
        patch.type !== 'lesson' ||
        timing.plannedStartMeeting === null ||
        timing.plannedMeetingCount === null
      )
        return false;
      busyRef.current = true;
      setSaving(true);
      try {
        const result = await api.setSectionLessonTiming(
          selectedSection.sectionId,
          patch.id,
          timing.plannedStartMeeting,
          timing.plannedMeetingCount
        );
        setSectionPlans(result.plans);
        if (result.operationId) {
          localHead.current = result.operationId;
          setLocalUndo((items) => [
            ...items,
            {
              operationId: result.operationId!,
              lessonId: patch.id,
              start: timing.plannedStartMeeting!,
              count: timing.plannedMeetingCount!
            }
          ]);
          setLocalRedo([]);
        }
        setStatus(`Timing saved for ${selectedSection.sectionName}`);
        return true;
      } catch (error) {
        setStatus(error instanceof ApiError ? error.message : 'Could not save class timing.');
        return false;
      } finally {
        busyRef.current = false;
        setSaving(false);
      }
    }
    busyRef.current = true;
    setSaving(true);
    let detail: CourseDetailResponse | null = null;
    const applied: TimingPatch[] = [];
    const saveTimingPatch = async (patch: TimingPatch, side: 'before' | 'after') => {
      if (patch.type === 'unit') return api.updateUnit(patch.id, patch[side]);
      const lesson = course.units
        .flatMap((unit) => unit.lessons)
        .find((item) => item.id === patch.id);
      const response = await api.updateLesson(patch.id, {
        ...patch[side],
        expectedRevision: timingRevisions.current[patch.id] ?? lesson?.editRevision ?? 0
      });
      if (response.savedLessonRevision !== undefined)
        timingRevisions.current[patch.id] = response.savedLessonRevision;
      return response;
    };
    try {
      for (const patch of patches) {
        detail = await saveTimingPatch(patch, direction);
        applied.push(patch);
      }
      if (detail) onCourseChange(detail);
      if (record) {
        setUndoStack((stack) => [...stack.slice(-29), patches]);
        setRedoStack([]);
      }
      setStatus('Timing saved');
      return true;
    } catch (err) {
      // The API updates one item at a time. Restore applied writes if a later
      // write fails, then reload so the canvas reflects persisted timing.
      let restored = true;
      for (const patch of applied.reverse()) {
        try {
          await saveTimingPatch(patch, direction === 'after' ? 'before' : 'after');
        } catch {
          restored = false;
        }
      }
      try {
        onCourseChange(await api.getCourseDetail(course.id));
      } catch {
        restored = false;
      }
      setStatus(
        restored
          ? err instanceof ApiError
            ? err.message
            : 'Could not save timing. Previous timing restored.'
          : 'Some timing changes could not be restored. Reload the plan before editing again.'
      );
      return false;
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  };

  const timingPatch = (
    type: 'unit' | 'lesson',
    item: Unit | Lesson,
    start: number,
    span: number
  ): TimingPatch => ({
    type,
    id: item.id,
    before: {
      plannedStartMeeting: item.plannedStartMeeting,
      plannedMeetingCount: item.plannedMeetingCount
    },
    after: { plannedStartMeeting: start, plannedMeetingCount: span }
  });

  const travelHistory = async (direction: 'undo' | 'redo') => {
    const stack = direction === 'undo' ? undoStack : redoStack;
    const patches = stack[stack.length - 1];
    if (!patches) return;
    if (await persistTiming(patches, direction === 'undo' ? 'before' : 'after', false)) {
      if (direction === 'undo') {
        setUndoStack((value) => value.slice(0, -1));
        setRedoStack((value) => [...value, patches]);
      } else {
        setRedoStack((value) => value.slice(0, -1));
        setUndoStack((value) => [...value, patches]);
      }
      setStatus(direction === 'undo' ? 'Timing change undone' : 'Timing change redone');
    }
  };

  const applyPendingChange = async (
    mode: 'only' | 'shift' | 'fixed',
    change: PendingChange | null = pendingChange
  ) => {
    if (!change) return;
    const { unit } = change;
    const start = change.kind === 'move' ? change.start : (change.start ?? unit.start);
    const span = change.kind === 'resize' ? change.span : unit.span;
    const patches = [timingPatch('unit', unit.unit, start, span)];
    const orderedLessons = [...unit.unit.lessons].sort((a, b) => a.orderIndex - b.orderIndex);
    const ranges = reflowLessonRanges(start, span, orderedLessons.length);
    orderedLessons.forEach((lesson, index) => {
      const range = ranges[index]!;
      patches.push(
        timingPatch(
          'lesson',
          lesson,
          change.kind === 'move' && lesson.plannedStartMeeting !== null
            ? Math.max(start, lesson.plannedStartMeeting + change.delta)
            : range.start,
          change.kind === 'move' ? (lesson.plannedMeetingCount ?? range.span) : range.span
        )
      );
    });
    if (mode === 'shift') {
      const following = positions.filter(
        (item) => item.unit.id !== unit.unit.id && item.start >= unit.start + unit.span
      );
      const first = Math.min(...following.map((item) => item.start));
      const delta = Math.max(0, start + span - first);
      if (delta)
        for (const later of following) {
          patches.push(timingPatch('unit', later.unit, later.start + delta, later.span));
          for (const lesson of later.unit.lessons) {
            if (lesson.plannedStartMeeting !== null)
              patches.push(
                timingPatch(
                  'lesson',
                  lesson,
                  lesson.plannedStartMeeting + delta,
                  lesson.plannedMeetingCount ?? 1
                )
              );
          }
        }
    }
    if (await persistTiming(patches)) setPendingChange(null);
  };

  const beginUnitDrag = (
    event: ReactPointerEvent<HTMLElement>,
    unit: PositionedUnit,
    mode: Drag['mode']
  ) => {
    if (!canEditSharedPlan || saving || pendingChange || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    suppressClick.current = false;
    pointerRef.current = { clientX: event.clientX, altKey: event.altKey };
    setDrag({
      unit,
      mode,
      originX: event.clientX,
      scrollLeft: canvasWrapRef.current?.scrollLeft ?? 0
    });
    setDragPreview({ start: unit.start, span: unit.span });
  };

  const updateUnitDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag) return;
    pointerRef.current = { clientX: event.clientX, altKey: event.altKey };
    updateDragAt(event.clientX, event.altKey);
  };

  const finishUnitDrag = () => {
    if (!drag || dragPreview === null) return false;
    const finalRange = { start: Math.round(dragPreview.start), span: Math.round(dragPreview.span) };
    const delta =
      drag.mode === 'move' ? finalRange.start - drag.unit.start : finalRange.span - drag.unit.span;
    suppressClick.current = Boolean(delta);
    pointerRef.current = null;
    if (delta) {
      const change: PendingChange =
        drag.mode === 'move'
          ? { kind: 'move', unit: drag.unit, start: finalRange.start, delta }
          : {
              kind: 'resize',
              unit: drag.unit,
              start: finalRange.start,
              span: finalRange.span,
              delta
            };
      const proposed: PositionedUnit = {
        unit: drag.unit.unit,
        start: finalRange.start,
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
    return Boolean(delta);
  };

  const requestUnitResize = (unit: PositionedUnit, nextSpan: number, start = unit.start) => {
    const span = Math.max(1, nextSpan);
    if (!canEditSharedPlan || saving || (span === unit.span && start === unit.start)) return;
    const change: PendingChange = {
      kind: 'resize',
      unit,
      span,
      start,
      delta: span - unit.span
    };
    const proposed: PositionedUnit = { unit: unit.unit, start, span };
    const hasCollision = positions.some(
      (other) => other.unit.id !== unit.unit.id && overlaps(proposed, other)
    );
    if (hasCollision) setPendingChange(change);
    else void applyPendingChange('only', change);
  };

  const adjustUnitResize = (event: ReactKeyboardEvent<HTMLElement>, unit: PositionedUnit) => {
    if (!canEditSharedPlan || saving) return;
    const maxSpan = Math.max(unit.span, visibleMeetings - unit.start);
    const nextSpan =
      event.key === 'Home'
        ? 1
        : event.key === 'End'
          ? maxSpan
          : event.key === 'ArrowRight' || event.key === 'ArrowUp'
            ? unit.span + 1
            : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
              ? unit.span - 1
              : null;
    if (nextSpan === null) return;
    event.preventDefault();
    event.stopPropagation();
    requestUnitResize(unit, nextSpan);
  };

  const beginLessonDrag = (
    event: ReactPointerEvent<HTMLElement>,
    lesson: Lesson,
    mode: LessonDrag['mode'],
    start: number,
    span: number,
    unitStart: number,
    unitSpan: number
  ) => {
    if (!canEditLessonTiming || saving || pendingChange || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    suppressClick.current = false;
    pointerRef.current = { clientX: event.clientX, altKey: event.altKey };
    recordFeedbackEvent('lesson_drag_started', {
      lessonId: lesson.id,
      mode,
      component: 'curriculum_timeline'
    });
    setLessonDrag({
      lesson,
      mode,
      originX: event.clientX,
      scrollLeft: canvasWrapRef.current?.scrollLeft ?? 0,
      start,
      span,
      unitStart: canEditSharedPlan ? unitStart : 0,
      unitEnd: canEditSharedPlan ? unitStart + unitSpan : sectionMeetings.length
    });
    setLessonDragPreview({ start, span });
  };

  const updateLessonDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!lessonDrag) return;
    event.preventDefault();
    pointerRef.current = { clientX: event.clientX, altKey: event.altKey };
    updateDragAt(event.clientX, event.altKey);
  };

  const finishLessonDrag = async () => {
    if (!lessonDrag || !lessonDragPreview) return false;
    const start = Math.round(lessonDragPreview.start);
    const span = Math.round(lessonDragPreview.span);
    const changed = start !== lessonDrag.start || span !== lessonDrag.span;
    recordFeedbackEvent('lesson_drag_ended', {
      lessonId: lessonDrag.lesson.id,
      changed,
      component: 'curriculum_timeline'
    });
    suppressClick.current = changed;
    pointerRef.current = null;
    setLessonDrag(null);
    setLessonDragPreview(null);
    if (!changed) return false;
    await persistTiming([timingPatch('lesson', lessonDrag.lesson, start, span)]);
    return true;
  };

  const adjustLessonResize = async (
    event: ReactKeyboardEvent<HTMLElement>,
    lesson: Lesson,
    start: number,
    span: number,
    unitStart: number,
    unitSpan: number
  ) => {
    if (!canEditLessonTiming || saving) return;
    const maxSpan = Math.max(
      span,
      (canEditSharedPlan ? unitStart + unitSpan : sectionMeetings.length) - start
    );
    const nextSpan =
      event.key === 'Home'
        ? 1
        : event.key === 'End'
          ? maxSpan
          : event.key === 'ArrowRight' || event.key === 'ArrowUp'
            ? span + 1
            : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
              ? span - 1
              : null;
    if (nextSpan === null) return;
    event.preventDefault();
    event.stopPropagation();
    const next = clamp(nextSpan, 1, maxSpan);
    if (next === span) return;
    await persistTiming([timingPatch('lesson', lesson, start, next)]);
  };

  const updateDragAt = (clientX: number, altKey: boolean) => {
    const active = drag ?? lessonDrag;
    if (!active) return;
    const range = drag
      ? { start: drag.unit.start, span: drag.unit.span }
      : { start: lessonDrag!.start, span: lessonDrag!.span };
    let delta =
      (clientX - active.originX + (canvasWrapRef.current?.scrollLeft ?? 0) - active.scrollLeft) /
      slotWidth;
    if (Math.abs(delta * slotWidth) < 4) delta = 0;
    if (snapEnabled && !altKey) {
      const anchors = positions
        .filter((item) => item.unit.id !== drag?.unit.unit.id)
        .flatMap((item) => [item.start, item.start + item.span]);
      delta = snapClipDelta(range, active.mode, delta, anchors, slotWidth);
    }
    const preview = editClipRange(
      range,
      active.mode,
      delta,
      drag ? 0 : lessonDrag!.unitStart,
      drag ? visibleMeetings : lessonDrag!.unitEnd
    );
    if (drag) setDragPreview(preview);
    else setLessonDragPreview(preview);
  };
  const dragUpdateRef = useRef(updateDragAt);
  dragUpdateRef.current = updateDragAt;
  useEffect(() => {
    if (!drag && !lessonDrag) return;
    let frame = 0;
    const tick = () => {
      const pointer = pointerRef.current;
      const canvas = canvasWrapRef.current;
      if (pointer && canvas) {
        const bounds = canvas.getBoundingClientRect();
        const edge = 48;
        const velocity =
          pointer.clientX < bounds.left + edge
            ? -Math.min(18, (bounds.left + edge - pointer.clientX) / 4)
            : pointer.clientX > bounds.right - edge
              ? Math.min(18, (pointer.clientX - bounds.right + edge) / 4)
              : 0;
        if (velocity) {
          canvas.scrollLeft += velocity;
          dragUpdateRef.current(pointer.clientX, pointer.altKey);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [drag, lessonDrag, canvasWrapRef]);

  const selectedPosition = positions.find(
    (item) =>
      item.unit.id === selection?.id ||
      item.unit.lessons.some((lesson) => lesson.id === selection?.id)
  );
  const selectedRange = (() => {
    if (!selectedPosition) return null;
    if (selection?.type === 'unit')
      return { start: selectedPosition.start, span: selectedPosition.span };
    if (!selectedLesson) return null;
    const lessons = [...selectedPosition.unit.lessons].sort((a, b) => a.orderIndex - b.orderIndex);
    const fallback = reflowLessonRanges(
      selectedPosition.start,
      selectedPosition.span,
      lessons.length
    )[lessons.findIndex((lesson) => lesson.id === selectedLesson.id)]!;
    const effectiveSpan = effectiveLessonSpan(selectedLesson, fallback.span);
    const start = effectiveLessonStart(selectedLesson, fallback.start);
    if (!canEditSharedPlan) return { start, span: effectiveSpan };
    const span = Math.min(selectedPosition.span, effectiveSpan);
    return {
      start: clamp(
        start,
        selectedPosition.start,
        selectedPosition.start + selectedPosition.span - span
      ),
      span
    };
  })();
  const canEditSelectedTiming =
    selection?.type === 'lesson' ? canEditLessonTiming : canEditSharedPlan;
  const timingMin =
    selection?.type === 'unit' || !canEditSharedPlan ? 0 : (selectedPosition?.start ?? 0);
  const timingMax = !canEditSharedPlan
    ? sectionMeetings.length
    : selection?.type === 'unit'
      ? visibleMeetings
      : (selectedPosition?.start ?? 0) + (selectedPosition?.span ?? 0);
  const selectedStart = selectedRange?.start;
  const selectedSpan = selectedRange?.span;
  useEffect(() => {
    setTimingStart(selectedStart === undefined ? '' : String(selectedStart + 1));
    setTimingSpan(selectedSpan === undefined ? '' : String(selectedSpan));
  }, [selection?.id, selectedStart, selectedSpan]);

  const changeSelectedRange = (range: ClipRange) => {
    if (
      !selectedPosition ||
      !selectedRange ||
      !(selection?.type === 'lesson' ? canEditLessonTiming : canEditSharedPlan) ||
      saving ||
      pendingChange
    )
      return;
    if (selection?.type === 'unit') {
      if (range.span !== selectedRange.span)
        requestUnitResize(selectedPosition, range.span, range.start);
      else if (range.start !== selectedRange.start) {
        const change: PendingChange = {
          kind: 'move',
          unit: selectedPosition,
          start: range.start,
          delta: range.start - selectedRange.start
        };
        if (
          positions.some(
            (other) =>
              other.unit.id !== selectedPosition.unit.id &&
              overlaps({ unit: selectedPosition.unit, ...range }, other)
          )
        )
          setPendingChange(change);
        else void applyPendingChange('only', change);
      }
    } else if (
      selectedLesson &&
      (range.start !== selectedRange.start || range.span !== selectedRange.span)
    )
      void persistTiming([timingPatch('lesson', selectedLesson, range.start, range.span)]);
  };
  const fitSelection = () => {
    if (!selectedRange) return;
    zoomTo(Math.min(200, viewport.width / (selectedRange.span + 2)));
    requestAnimationFrame(() =>
      canvasWrapRef.current?.scrollTo({
        left:
          Math.max(0, selectedRange.start - 1) *
          Math.min(200, viewport.width / (selectedRange.span + 2))
      })
    );
  };
  const cancelTimelineGesture = () => {
    pointerRef.current = null;
    suppressClick.current = true;
    setDrag(null);
    setDragPreview(null);
    setLessonDrag(null);
    setLessonDragPreview(null);
    setRangeDrag(null);
    setRangePreview(null);
    setPendingChange(null);
    setShowShortcuts(false);
  };
  useEffect(() => {
    const cancel = () => {
      pointerRef.current = null;
      setDrag(null);
      setDragPreview(null);
      setLessonDrag(null);
      setLessonDragPreview(null);
      setRangeDrag(null);
      setRangePreview(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', escape);
    };
  }, []);
  const handleTimelineKeys = (event: ReactKeyboardEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]'))
      return;
    const key = event.key.toLowerCase();
    if (key === 'escape') {
      cancelTimelineGesture();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && key === 'z') {
      event.preventDefault();
      const direction = event.shiftKey ? 'redo' : 'undo';
      if (displayMode === 'outline' && (direction === 'undo' ? orderUndo : orderRedo).length)
        void travelLessonOrder(direction);
      else if (!canEditSharedPlan) void travelLocalTiming(direction);
      else void travelHistory(direction);
      return;
    }
    if (event.metaKey || event.ctrlKey || displayMode !== 'timeline') return;
    if (key === 'v') setHandTool(false);
    else if (key === 'h') setHandTool(true);
    else if (key === 's') setSnapEnabled((value) => !value);
    else if (key === '+' || key === '=') zoomTo(slotWidth * 1.25);
    else if (key === '-') zoomTo(slotWidth / 1.25);
    else if (key === '0') {
      zoomTo(viewport.width / visibleMeetings, 0);
      canvasWrapRef.current?.scrollTo({ left: 0 });
    } else if (key === 'f') fitSelection();
    else if (event.code === 'Space') setSpaceHeld(true);
    else if ((key === 'arrowleft' || key === 'arrowright') && selectedRange && selectedPosition) {
      if ((event.target as HTMLElement).closest('[role="slider"]')) return;
      const delta = (key === 'arrowleft' ? -1 : 1) * (event.shiftKey ? 5 : 1);
      changeSelectedRange(
        editClipRange(
          selectedRange,
          event.altKey ? 'resize' : 'move',
          delta,
          selection?.type === 'unit' ? 0 : selectedPosition.start,
          selection?.type === 'unit'
            ? visibleMeetings
            : selectedPosition.start + selectedPosition.span
        )
      );
    } else return;
    event.preventDefault();
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

  const reorderLessonTo = async (unit: Unit, draggedId: string, insertionIndex: number) => {
    if (saving) return;
    const ordered = [...unit.lessons].sort((a, b) => a.orderIndex - b.orderIndex);
    const from = ordered.findIndex((lesson) => lesson.id === draggedId);
    if (from < 0) return;
    const [moving] = ordered.splice(from, 1);
    if (!moving) return;
    const adjustedIndex = clamp(
      insertionIndex > from ? insertionIndex - 1 : insertionIndex,
      0,
      ordered.length
    );
    ordered.splice(adjustedIndex, 0, moving);
    if (adjustedIndex === from) {
      setOutlineDraggedLessonId(null);
      setOutlineDropPosition(null);
      return;
    }
    const action = {
      unitId: unit.id,
      before: [...unit.lessons]
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map(({ id }, orderIndex) => ({ id, orderIndex })),
      after: ordered.map(({ id }, orderIndex) => ({ id, orderIndex }))
    };
    if (await saveLessonOrder(action, 'after')) {
      setOrderUndo((items) => [...items, action]);
      setOrderRedo([]);
    }
    setOutlineDraggedLessonId(null);
    setOutlineDropPosition(null);
  };

  const saveLessonOrder = async (action: LessonOrderAction, direction: 'before' | 'after') => {
    if (saving || busyRef.current) return false;
    busyRef.current = true;
    setSaving(true);
    try {
      const unit = course.units.find((item) => item.id === action.unitId);
      const result = await api.reorderUnitLessons(
        action.unitId,
        action[direction].map((item) => ({
          ...item,
          expectedRevision:
            orderRevisions.current[item.id] ??
            unit?.lessons.find((lesson) => lesson.id === item.id)?.editRevision ??
            0
        }))
      );
      Object.assign(orderRevisions.current, result.revisions);
      onCourseChange(await api.getCourseDetail(course.id));
      setStatus('Shared lesson order saved');
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) setOrderRedo([]);
      setStatus(error instanceof ApiError ? error.message : 'Could not save shared lesson order.');
      return false;
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  };

  const travelLessonOrder = async (direction: 'undo' | 'redo') => {
    const action = (direction === 'undo' ? orderUndo : orderRedo).at(-1);
    if (!action || !(await saveLessonOrder(action, direction === 'undo' ? 'before' : 'after')))
      return;
    if (direction === 'undo') {
      setOrderUndo((items) => items.slice(0, -1));
      setOrderRedo((items) => [...items, action]);
    } else {
      setOrderRedo((items) => items.slice(0, -1));
      setOrderUndo((items) => [...items, action]);
    }
  };

  const reorderUnitTo = async (draggedId: string, insertionIndex: number) => {
    if (saving || !canEditSharedPlan) return;
    const ordered = [...course.units].sort((left, right) => left.orderIndex - right.orderIndex);
    const from = ordered.findIndex((unit) => unit.id === draggedId);
    if (from < 0) return;
    const [moving] = ordered.splice(from, 1);
    if (!moving) return;
    const adjustedIndex = clamp(
      insertionIndex > from ? insertionIndex - 1 : insertionIndex,
      0,
      ordered.length
    );
    ordered.splice(adjustedIndex, 0, moving);
    if (adjustedIndex === from) {
      setOutlineDraggedUnitId(null);
      setOutlineUnitDropPosition(null);
      return;
    }
    try {
      setSaving(true);
      let detail: CourseDetailResponse | null = null;
      for (const [index, unit] of ordered.entries()) {
        if (unit.orderIndex !== index) {
          detail = await api.updateUnit(unit.id, { orderIndex: index });
        }
      }
      if (detail) onCourseChange(detail);
      setStatus(`${moving.title} reordered`);
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Could not reorder units');
    } finally {
      setSaving(false);
      setOutlineDraggedUnitId(null);
      setOutlineUnitDropPosition(null);
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
      setStatus(err instanceof ApiError ? err.message : 'Could not create a lesson draft');
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
      setStatus('Lesson drafts added to the unit');
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Could not add the lesson drafts');
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
      const detail = await api.updateLesson(lessonId, {
        expectedRevision: lessonDraftRevisions.current[lessonId] ?? 0,
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
      });
      if (detail.savedLessonRevision !== undefined)
        lessonDraftRevisions.current[lessonId] = detail.savedLessonRevision;
      onCourseChange(detail);
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Could not save the lesson plan');
    } finally {
      setSaving(false);
    }
  };
  saveLessonPlanRef.current = saveLessonPlan;

  const queueLessonPlanSave = (next: LessonPlanDraft, delay = 550) => {
    const lessonId = selectedLessonIdRef.current;
    lessonPlanDraftRef.current = next;
    setLessonPlanDraft(next);
    if (lessonPlanSaveTimer.current) clearTimeout(lessonPlanSaveTimer.current);
    lessonPlanSaveTimer.current = window.setTimeout(() => {
      lessonPlanSaveTimer.current = null;
      lessonPlanSaveChain.current = lessonPlanSaveChain.current.then(() =>
        saveLessonPlan(next, lessonId)
      );
    }, delay);
  };

  const updateLessonPlanDraft = (patch: Partial<LessonPlanDraft>) =>
    queueLessonPlanSave({ ...lessonPlanDraftRef.current, ...patch });

  const flushLessonPlanSave = () => {
    if (!lessonPlanSaveTimer.current) return;
    if (lessonPlanSaveTimer.current) {
      clearTimeout(lessonPlanSaveTimer.current);
      lessonPlanSaveTimer.current = null;
    }
    const snapshot = lessonPlanDraftRef.current;
    const lessonId = selectedLessonIdRef.current;
    lessonPlanSaveChain.current = lessonPlanSaveChain.current.then(() =>
      saveLessonPlan(snapshot, lessonId)
    );
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
      if (lessonId && saveLessonPlanRef.current) {
        lessonPlanSaveChain.current = lessonPlanSaveChain.current.then(() =>
          saveLessonPlanRef.current!(snapshot, lessonId)
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
    const minutesPerMeeting = Number(draftMinutesPerMeeting);
    setPlanningError(null);
    if (draftPrompt.trim().length < 8) {
      setPlanningError('Describe what students should learn before generating the unit plan.');
      return false;
    }
    if (!Number.isInteger(meetingCount) || meetingCount < 2 || meetingCount > 30) {
      setPlanningError('Add the number of class meetings for this unit (2–30).');
      return false;
    }
    if (!Number.isInteger(minutesPerMeeting) || minutesPerMeeting < 10 || minutesPerMeeting > 240) {
      setPlanningError('Add the number of minutes in each class meeting (10–240).');
      return false;
    }
    try {
      setSaving(true);
      setIsGeneratingUnit(true);
      setDraft(
        await api.generateUnitDraft({
          courseName: course.name,
          gradeLevel: course.gradeLevel,
          prompt: `${draftPrompt.trim()} Each class meeting is ${minutesPerMeeting} minutes.`,
          meetingCount: clamp(meetingCount, 2, 30)
        })
      );
      setPlanSaveFailed(false);
      return true;
    } catch (err) {
      setPlanningError(
        err instanceof ApiError ? err.message : 'Could not create a plan right now. Try again.'
      );
      return false;
    } finally {
      setIsGeneratingUnit(false);
      setSaving(false);
    }
  };

  const acceptDraft = async () => {
    if (!draft || saving || planSaveFailed) return;
    setPlanningError(null);
    setAddingPlan(true);
    let latestDetail: CourseDetailResponse | null = null;
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
      latestDetail = detail;
      const existingIds = new Set(course.units.map((unit) => unit.id));
      const unit = detail.course.units.find(
        (item) => !existingIds.has(item.id) && item.title === draft.unit.title
      );
      if (!unit) throw new Error('Draft unit was not created');
      const lessonRanges = distributeMeetingSpans(
        unit.plannedStartMeeting ?? 0,
        draft.unit.meetingCount,
        draft.unit.lessons.length
      );
      for (const [index, lesson] of draft.unit.lessons.entries()) {
        const range = lessonRanges[index];
        detail = await api.createLesson(unit.id, {
          title: lesson.title,
          description: lesson.description,
          estimatedDurationMinutes: lesson.estimatedDurationMinutes,
          orderIndex: index,
          plannedStartMeeting: range?.start ?? unit.plannedStartMeeting ?? 0,
          plannedMeetingCount: range?.span ?? 1,
          lessonPlan: {
            objective: lesson.objective ?? null,
            teacherNotes: null,
            studentDirections: null,
            materials: lesson.materials ?? null,
            links: []
          }
        });
        latestDetail = detail;
        const createdUnit = detail.course.units.find((item) => item.id === unit.id);
        const createdLesson = createdUnit?.lessons.find((item) => item.orderIndex === index);
        if (!createdLesson) throw new Error(`Draft lesson "${lesson.title}" was not created`);
        for (const [stepIndex, step] of lesson.steps.entries()) {
          detail = await api.createSegment(createdLesson.id, {
            title: step.title,
            description: step.description,
            durationMinutes: step.durationMinutes,
            stepType: step.stepType ?? null,
            orderIndex: stepIndex
          });
          latestDetail = detail;
        }
      }
      onCourseChange(detail);
      setDraft(null);
      setDraftPrompt('');
      setDraftMeetingCount('');
      setDraftMinutesPerMeeting('');
      setPlanningOpen(false);
      setAddedUnitId(unit.id);
      setStatus(`${unit.title} was added to ${course.name}.`);
    } catch (err) {
      setPlanSaveFailed(true);
      const refreshed = await api.getCourseDetail(course.id).catch(() => latestDetail);
      if (refreshed) onCourseChange(refreshed);
      setPlanningError(
        `${err instanceof ApiError ? err.message : 'Could not finish adding the unit.'} Check Year Plan for any items already added before trying again. Your draft is still here.`
      );
    } finally {
      setAddingPlan(false);
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!addedUnitId) return;
    workspaceRef.current
      ?.querySelector(`[data-planned-unit="${addedUnitId}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [addedUnitId]);

  const selectUnit = (unit: Unit) => {
    flushLessonPlanSave();
    setSelection({ type: 'unit', id: unit.id });
    onLessonSelectionChange?.(null);
  };
  const selectLesson = (lesson: Lesson) => {
    if (lesson.id !== selectedLessonIdRef.current) flushLessonPlanSave();
    setSelection({ type: 'lesson', id: lesson.id });
    onLessonSelectionChange?.(lesson.id);
  };

  return (
    <section
      ref={workspaceRef}
      className={`curriculum-workspace ${displayMode === 'outline' ? 'curriculum-outline-mode' : 'curriculum-editor-mode'}`}
      aria-label={`${course.name} curriculum timeline`}
      onKeyDown={handleTimelineKeys}
    >
      <div className="curriculum-workspace-topbar">
        <div className="curriculum-add-unit-control">
          <div className="curriculum-unit-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setShowUnitComposer((open) => !open);
              }}
            >
              {showUnitComposer ? 'Close add unit' : '+ Add unit'}
            </button>
            {allowAutoGeneration ? (
              <button
                ref={planEntry}
                type="button"
                disabled={saving}
                onClick={() => {
                  if (!draftMinutesPerMeeting) {
                    const meeting = selectedSection?.meetings.find(
                      (item) => item.time && item.endTime
                    );
                    if (meeting?.time && meeting.endTime) {
                      const minutes = (time: string) => {
                        const [hours, mins] = time.split(':').map(Number);
                        return (hours ?? 0) * 60 + (mins ?? 0);
                      };
                      const duration = minutes(meeting.endTime) - minutes(meeting.time);
                      if (duration >= 10 && duration <= 240)
                        setDraftMinutesPerMeeting(String(duration));
                    }
                  }
                  setPlanningOpen(true);
                }}
              >
                Plan a unit
              </button>
            ) : null}
          </div>
          {showUnitComposer ? (
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
          ) : null}
        </div>
        {selectedSection ? (
          <div className="curriculum-scope-control">
            <span>
              {editingSharedPlan
                ? 'Editing shared meeting sequence'
                : `Planning ${selectedSection.sectionName}`}
            </span>
            <button
              className="secondary"
              type="button"
              disabled={saving}
              onClick={() => setEditingSharedPlan((value) => !value)}
            >
              {editingSharedPlan ? 'Return to class dates' : 'Edit shared meeting sequence'}
            </button>
          </div>
        ) : null}
      </div>

      {displayMode === 'outline' && (orderUndo.length || orderRedo.length) ? (
        <div className="curriculum-scope-control">
          <button
            className="secondary"
            type="button"
            disabled={saving || !orderUndo.length}
            onClick={() => void travelLessonOrder('undo')}
          >
            Undo shared lesson reorder
          </button>
          <button
            className="secondary"
            type="button"
            disabled={saving || !orderRedo.length}
            onClick={() => void travelLessonOrder('redo')}
          >
            Redo shared lesson reorder
          </button>
        </div>
      ) : null}

      {schoolYearSettings ? (
        <div className="curriculum-year-range" aria-label="Instructional year range">
          <span>
            <strong>Start</strong>{' '}
            {new Date(`${schoolYearSettings.startDate}T12:00:00`).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            })}
          </span>
          <span aria-hidden="true">→</span>
          <span>
            <strong>End</strong>{' '}
            {new Date(`${schoolYearSettings.endDate}T12:00:00`).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            })}
          </span>
          {selectedSection ? <small>{sectionMeetings.length} class meetings</small> : null}
        </div>
      ) : null}

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

      {planningOpen ? (
        <UnitPlanningWorkspace
          courseName={course.name}
          groupName={selectedSection?.sectionName}
          goal={draftPrompt}
          meetings={draftMeetingCount}
          minutes={draftMinutesPerMeeting}
          setGoal={setDraftPrompt}
          setMeetings={setDraftMeetingCount}
          setMinutes={setDraftMinutesPerMeeting}
          draft={draft}
          setDraft={setDraft}
          generating={isGeneratingUnit}
          adding={addingPlan}
          error={planningError}
          saveFailed={planSaveFailed}
          onGenerate={createDraft}
          onAdd={() => void acceptDraft()}
          onClose={() => {
            setPlanningOpen(false);
            requestAnimationFrame(() => planEntry.current?.focus());
          }}
        />
      ) : null}
      {addedUnitId ? (
        <button
          type="button"
          className="secondary"
          onClick={() => {
            const unit = course.units.find((item) => item.id === addedUnitId);
            if (!unit) return;
            selectUnit(unit);
            workspaceRef.current
              ?.querySelector(`[data-planned-unit="${unit.id}"]`)
              ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          }}
        >
          Open added unit
        </button>
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
          <div className="curriculum-selection-heading">
            <span>{selection.type === 'unit' ? selectedUnit?.title : selectedLesson?.title}</span>
            <small>{selection.type === 'unit' ? 'Unit selected' : 'Lesson selected'}</small>
          </div>
          {selection.type === 'unit' && selectedUnit ? (
            <details className="timeline-source-details">
              <summary>Unit slides</summary>
              <section
                className="curriculum-unit-source"
                aria-label={`Source material for ${selectedUnit.title}`}
              >
                <div>
                  <strong>Unit Slides</strong>
                  <small>One shared deck, available in every lesson in this unit.</small>
                </div>
                <label>
                  <span>Google Slides link</span>
                  <input
                    className="input"
                    type="url"
                    value={selectedUnitSlidesUrl}
                    onChange={(event) => setSelectedUnitSlidesUrl(event.target.value)}
                    placeholder="https://docs.google.com/presentation/d/…"
                  />
                </label>
                <label className="curriculum-unit-source-start">
                  <span>Start slide</span>
                  <input
                    className="input"
                    type="number"
                    min="1"
                    value={selectedUnitStartSlide}
                    onChange={(event) => setSelectedUnitStartSlide(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  disabled={saving || !isGoogleSlidesUrl(selectedUnitSlidesUrl)}
                  onClick={() => void saveSelectedUnitSlides()}
                >
                  {selectedUnit.googleSlidesUrl ? 'Update slides' : 'Add slides'}
                </button>
                {selectedUnit.googleSlidesUrl ? (
                  <button
                    className="button-link danger"
                    type="button"
                    disabled={saving}
                    onClick={() => void removeSelectedUnitSlides()}
                  >
                    Remove
                  </button>
                ) : null}
                {selectedUnitSlidesUrl && !isGoogleSlidesUrl(selectedUnitSlidesUrl) ? (
                  <p className="curriculum-unit-source-error">
                    Paste a Google Slides presentation link.
                  </p>
                ) : null}
              </section>
            </details>
          ) : null}
          {selection.type === 'lesson' && selectedLesson ? (
            <details className="timeline-source-details">
              <summary>Lesson slides</summary>
              <section
                className="curriculum-unit-source"
                aria-label={`Source material for ${selectedLesson.title}`}
              >
                <div>
                  <strong>Lesson Slides</strong>
                  <small>A lesson-specific deck, separate from the unit deck.</small>
                </div>
                <label>
                  <span>Google Slides link</span>
                  <input
                    className="input"
                    type="url"
                    value={selectedLessonSlidesUrl}
                    onChange={(event) => setSelectedLessonSlidesUrl(event.target.value)}
                    placeholder="https://docs.google.com/presentation/d/…"
                  />
                </label>
                <label className="curriculum-unit-source-start">
                  <span>Start slide</span>
                  <input
                    className="input"
                    type="number"
                    min="1"
                    value={selectedLessonStartSlide}
                    onChange={(event) => setSelectedLessonStartSlide(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  disabled={saving || !isGoogleSlidesUrl(selectedLessonSlidesUrl)}
                  onClick={() => void saveSelectedLessonSlides()}
                >
                  {selectedLesson.googleSlidesUrl ? 'Update slides' : 'Add slides'}
                </button>
                {selectedLesson.googleSlidesUrl ? (
                  <button
                    className="button-link danger"
                    type="button"
                    disabled={saving}
                    onClick={() => void removeSelectedLessonSlides()}
                  >
                    Remove
                  </button>
                ) : null}
                {selectedLessonSlidesUrl && !isGoogleSlidesUrl(selectedLessonSlidesUrl) ? (
                  <p className="curriculum-unit-source-error">
                    Paste a Google Slides presentation link.
                  </p>
                ) : null}
              </section>
            </details>
          ) : null}
          <details className="curriculum-selection-menu">
            <summary aria-label={`Actions for selected ${selection.type}`}>•••</summary>
            <div>
              {selection.type === 'lesson' && selectedLesson ? (
                <button
                  type="button"
                  onClick={() =>
                    onOpenLesson
                      ? onOpenLesson(selectedLesson.id)
                      : setOpenLessonPlanId(selectedLesson.id)
                  }
                >
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
          ) : (
            <button
              type="button"
              role="menuitem"
              disabled={saving}
              onClick={() => void renameUnit(contextMenu.id)}
            >
              Edit unit name
            </button>
          )}
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

      {selectedLesson && (displayMode === 'outline' || openLessonPlanId === selectedLesson.id) ? (
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
                {selectedSection && !editingSharedPlan
                  ? (() => {
                      const unit = course.units.find((item) =>
                        item.lessons.some((lesson) => lesson.id === selectedLesson.id)
                      );
                      const index =
                        unit?.lessons.findIndex((lesson) => lesson.id === selectedLesson.id) ?? 0;
                      const position = positions.find((item) => item.unit.id === unit?.id);
                      const fallback =
                        position && unit
                          ? (reflowLessonRanges(position.start, position.span, unit.lessons.length)[
                              index
                            ]?.start ?? 0)
                          : 0;
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
              {selectedSection && !editingSharedPlan && selectedRange && sectionMeetings.length ? (
                <div className="lesson-plan-context-actions">
                  <label>
                    Move lesson to meeting
                    <select
                      className="input"
                      disabled={saving}
                      value={
                        selectedRange.start < sectionMeetings.length ? selectedRange.start : ''
                      }
                      onChange={(event) => {
                        if (event.target.value === '') return;
                        void persistTiming([
                          timingPatch(
                            'lesson',
                            selectedLesson,
                            Number(event.target.value),
                            selectedRange.span
                          )
                        ]);
                      }}
                    >
                      <option value="" disabled>
                        Select a meeting
                      </option>
                      {sectionMeetings.map((meeting, index) => (
                        <option key={index} value={index}>
                          {meeting.date}
                          {meeting.startTime ? ` · ${meeting.startTime}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  {lastSectionPlanOperation ? (
                    <button
                      className="button-link"
                      type="button"
                      disabled={saving}
                      onClick={() => void travelLocalTiming('undo')}
                    >
                      Undo move for {selectedSection.sectionName}
                    </button>
                  ) : null}
                  {localRedo.length ? (
                    <button
                      className="button-link"
                      type="button"
                      disabled={saving}
                      onClick={() => void travelLocalTiming('redo')}
                    >
                      Redo move for {selectedSection.sectionName}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="lesson-plan-fields lesson-plan-top-fields">
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
                        <strong>{link.title}</strong>
                        <small>{link.url}</small>
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
            <div className="lesson-plan-fields lesson-plan-bottom-fields">
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
          </section>
        </>
      ) : null}

      {displayMode === 'timeline' ? (
        <>
          <div className="timeline-toolbar" aria-label="Timeline tools">
            <div className="timeline-tool-group">
              <button
                type="button"
                aria-label="Selection tool"
                title="Select and move (V)"
                aria-pressed={!handTool}
                onClick={() => setHandTool(false)}
              >
                <TimelineIcon name="select" />
                <span>Select</span>
              </button>
              <button
                type="button"
                aria-label="Hand tool"
                title="Pan (H), or hold Space and drag"
                aria-pressed={handTool}
                onClick={() => setHandTool(true)}
              >
                <TimelineIcon name="hand" />
                <span>Hand</span>
              </button>
              <button
                type="button"
                aria-label="Snap to nearby edges"
                title="Snap to nearby edges (S). Hold Alt to bypass."
                aria-pressed={snapEnabled}
                onClick={() => setSnapEnabled((value) => !value)}
              >
                <TimelineIcon name="snap" />
                <span>Snap</span>
              </button>
            </div>
            <div className="timeline-tool-group">
              <button
                type="button"
                aria-label="Undo timing change"
                title="Undo timing change (⌘/Ctrl Z)"
                disabled={saving || !!pendingChange || !undoStack.length || !canEditSharedPlan}
                onClick={() => void travelHistory('undo')}
              >
                <TimelineIcon name="undo" />
              </button>
              <button
                type="button"
                aria-label="Redo timing change"
                title="Redo timing change (⌘/Ctrl Shift Z)"
                disabled={saving || !!pendingChange || !redoStack.length || !canEditSharedPlan}
                onClick={() => void travelHistory('redo')}
              >
                <TimelineIcon name="redo" />
              </button>
            </div>
            <div className="timeline-zoom-control">
              <button
                type="button"
                aria-label="Zoom out"
                disabled={slotWidth <= minScale || !!drag || !!lessonDrag}
                onClick={() => zoomTo(slotWidth / 1.25)}
              >
                <TimelineIcon name="minus" />
              </button>
              <input
                aria-label="Timeline zoom"
                title="Timeline zoom"
                type="range"
                min="0"
                max="100"
                step="0.1"
                value={(100 * Math.log(slotWidth / minScale)) / Math.log(200 / minScale)}
                disabled={!!drag || !!lessonDrag}
                onChange={(event) =>
                  zoomTo(minScale * Math.pow(200 / minScale, Number(event.target.value) / 100))
                }
              />
              <button
                type="button"
                aria-label="Zoom in"
                disabled={slotWidth >= 200 || !!drag || !!lessonDrag}
                onClick={() => zoomTo(slotWidth * 1.25)}
              >
                <TimelineIcon name="plus" />
              </button>
              <output>{Math.round((slotWidth / 72) * 100)}%</output>
            </div>
            <div className="timeline-tool-group timeline-zoom-presets">
              <button
                type="button"
                title="Fit the whole year (0)"
                onClick={() => {
                  zoomTo(viewport.width / visibleMeetings, 0);
                  canvasWrapRef.current?.scrollTo({ left: 0 });
                }}
              >
                <TimelineIcon name="fit" />
                Year
              </button>
              <button type="button" onClick={() => zoomTo(viewport.width / 20)}>
                Month
              </button>
              <button type="button" onClick={() => zoomTo(viewport.width / 5)}>
                Week
              </button>
              <button
                type="button"
                title="Fit selected item (F)"
                disabled={!selectedRange}
                onClick={fitSelection}
              >
                Selection
              </button>
            </div>
            <div className="timeline-tool-group timeline-navigation">
              <button
                type="button"
                aria-label="Show previous dates"
                onClick={() => scrollCanvasBy(-1)}
              >
                <TimelineIcon name="left" />
              </button>
              <button
                type="button"
                disabled={!todayDate || !selectedSection || !rangeMeetings.length}
                onClick={scrollToToday}
              >
                Today
              </button>
              <button type="button" aria-label="Show next dates" onClick={() => scrollCanvasBy(1)}>
                <TimelineIcon name="right" />
              </button>
              <button
                type="button"
                aria-label="Timeline shortcuts"
                aria-expanded={showShortcuts}
                onClick={() => setShowShortcuts((value) => !value)}
              >
                <TimelineIcon name="help" />
              </button>
            </div>
          </div>
          {showShortcuts ? (
            <div className="timeline-shortcuts">
              <span>
                <kbd>V</kbd> Select
              </span>
              <span>
                <kbd>H</kbd> Hand
              </span>
              <span>
                <kbd>Space</kbd> + drag to pan
              </span>
              <span>
                Pinch or <kbd>Alt</kbd> + scroll to zoom
              </span>
              <span>
                <kbd>← →</kbd> Move 1 meeting · <kbd>Shift</kbd> for 5
              </span>
              <span>
                <kbd>Alt ← →</kbd> Resize
              </span>
              <span>
                <kbd>Esc</kbd> Cancel drag
              </span>
              <span>Double-click a lesson to open it</span>
            </div>
          ) : null}
          <div className="timeline-inspector">
            {selectedRange && selectedPosition ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const start = Number(timingStart) - 1,
                    span = Number(timingSpan);
                  const min = timingMin;
                  const max = timingMax;
                  if (
                    !Number.isInteger(start) ||
                    !Number.isInteger(span) ||
                    start < min ||
                    span < 1 ||
                    start + span > max
                  ) {
                    setStatus(`Choose whole meetings between ${min + 1} and ${max}.`);
                    return;
                  }
                  changeSelectedRange({ start, span });
                }}
              >
                <span className="timeline-inspector-title">
                  {selectedUnit?.title ?? selectedLesson?.title}
                </span>
                <label>
                  Start{' '}
                  <input
                    aria-label="Start meeting"
                    type="number"
                    min={timingMin + 1}
                    max={visibleMeetings}
                    required
                    value={timingStart}
                    onChange={(event) => setTimingStart(event.target.value)}
                  />
                </label>
                <label>
                  Length{' '}
                  <input
                    aria-label="Length in meetings"
                    type="number"
                    min="1"
                    max={visibleMeetings}
                    required
                    value={timingSpan}
                    onChange={(event) => setTimingSpan(event.target.value)}
                  />
                </label>
                <span className="timeline-inspector-unit">meetings</span>
                <button
                  type="submit"
                  disabled={saving || !canEditSelectedTiming || !!pendingChange}
                >
                  Apply timing
                </button>
                {selectedLesson ? (
                  <button
                    type="button"
                    onClick={() =>
                      onOpenLesson
                        ? onOpenLesson(selectedLesson.id)
                        : setOpenLessonPlanId(selectedLesson.id)
                    }
                  >
                    Open lesson
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label="Move selected item earlier"
                  disabled={saving || !canEditSelectedTiming || !!pendingChange}
                  onClick={() =>
                    changeSelectedRange(
                      editClipRange(selectedRange, 'move', -1, timingMin, timingMax)
                    )
                  }
                >
                  <TimelineIcon name="left" />
                </button>
                <button
                  type="button"
                  aria-label="Move selected item later"
                  disabled={saving || !canEditSelectedTiming || !!pendingChange}
                  onClick={() =>
                    changeSelectedRange(
                      editClipRange(selectedRange, 'move', 1, timingMin, timingMax)
                    )
                  }
                >
                  <TimelineIcon name="right" />
                </button>
              </form>
            ) : (
              <span>
                Select a unit or lesson to edit its timing. Drag either edge to extend or shorten
                it.
              </span>
            )}
            <span className="timeline-save-state" role="status">
              {saving ? 'Saving…' : `${visibleMeetings} meetings`}
            </span>
          </div>
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
              const unitIndex = positions.findIndex((item) => item.unit.id === position.unit.id);
              const expanded = expandedUnitIds.includes(position.unit.id);
              const unitSelected = selection?.type === 'unit' && selection.id === position.unit.id;
              const unitDragging = outlineDraggedUnitId === position.unit.id;
              const unitDropBefore =
                outlineUnitDropPosition === unitIndex && outlineDraggedUnitId !== position.unit.id;
              const unitDropAfter =
                outlineUnitDropPosition === unitIndex + 1 &&
                outlineDraggedUnitId !== position.unit.id;
              const orderedLessons = [...position.unit.lessons].sort(
                (left, right) => left.orderIndex - right.orderIndex
              );
              const draggedLessonBelongsToUnit = orderedLessons.some(
                (lesson) => lesson.id === outlineDraggedLessonId
              );
              return (
                <div
                  key={position.unit.id}
                  data-planned-unit={position.unit.id}
                  className={[
                    'curriculum-tree-unit',
                    addedUnitId === position.unit.id ? 'unit-planning-added' : '',
                    unitSelected ? 'selected' : '',
                    unitDragging ? 'dragging' : '',
                    unitDropBefore ? 'drop-before' : '',
                    unitDropAfter ? 'drop-after' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <div
                    className="curriculum-tree-row"
                    draggable={canEditSharedPlan && !saving}
                    onContextMenu={(event) => openContextMenu(event, 'unit', position.unit.id)}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', position.unit.id);
                      setOutlineDraggedUnitId(position.unit.id);
                    }}
                    onDragEnd={() => {
                      setOutlineDraggedUnitId(null);
                      setOutlineUnitDropPosition(null);
                    }}
                    onDragOver={(event) => {
                      if (!outlineDraggedUnitId || outlineDraggedUnitId === position.unit.id)
                        return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                      const bounds = event.currentTarget.getBoundingClientRect();
                      setOutlineUnitDropPosition(
                        unitIndex + (event.clientY >= bounds.top + bounds.height / 2 ? 1 : 0)
                      );
                    }}
                    onDrop={(event) => {
                      if (!outlineDraggedUnitId || outlineDraggedUnitId === position.unit.id)
                        return;
                      event.preventDefault();
                      event.stopPropagation();
                      const bounds = event.currentTarget.getBoundingClientRect();
                      void reorderUnitTo(
                        outlineDraggedUnitId,
                        unitIndex + (event.clientY >= bounds.top + bounds.height / 2 ? 1 : 0)
                      );
                    }}
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
                      {orderedLessons.map((lesson, lessonIndex) => {
                        const fallback = reflowLessonRanges(
                          position.start,
                          position.span,
                          orderedLessons.length
                        )[lessonIndex]!;
                        const date = !editingSharedPlan
                          ? sectionMeetings[effectiveLessonStart(lesson, fallback.start)]?.date
                          : null;
                        const selected = selection?.type === 'lesson' && selection.id === lesson.id;
                        const dropBefore =
                          outlineDropPosition?.unitId === position.unit.id &&
                          outlineDropPosition.index === lessonIndex;
                        const dropAfter =
                          lessonIndex === orderedLessons.length - 1 &&
                          outlineDropPosition?.unitId === position.unit.id &&
                          outlineDropPosition.index === orderedLessons.length;
                        return (
                          <div
                            key={lesson.id}
                            className={[
                              'curriculum-lesson-row',
                              selected ? 'selected' : '',
                              outlineDraggedLessonId === lesson.id ? 'dragging' : '',
                              dropBefore ? 'drop-before' : '',
                              dropAfter ? 'drop-after' : ''
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            draggable={!saving}
                            onContextMenu={(event) => openContextMenu(event, 'lesson', lesson.id)}
                            onDragStart={(event) => {
                              event.dataTransfer.effectAllowed = 'move';
                              event.dataTransfer.setData('text/plain', lesson.id);
                              setOutlineDraggedLessonId(lesson.id);
                            }}
                            onDragEnd={() => {
                              setOutlineDraggedLessonId(null);
                              setOutlineDropPosition(null);
                            }}
                            onDragOver={(event) => {
                              if (!draggedLessonBelongsToUnit) return;
                              event.preventDefault();
                              event.dataTransfer.dropEffect = 'move';
                              const bounds = event.currentTarget.getBoundingClientRect();
                              const after = event.clientY >= bounds.top + bounds.height / 2;
                              setOutlineDropPosition({
                                unitId: position.unit.id,
                                index: lessonIndex + (after ? 1 : 0)
                              });
                            }}
                            onDrop={(event) => {
                              if (!draggedLessonBelongsToUnit) return;
                              event.preventDefault();
                              event.stopPropagation();
                              if (outlineDraggedLessonId)
                                void reorderLessonTo(
                                  position.unit,
                                  outlineDraggedLessonId,
                                  lessonIndex +
                                    (event.clientY >=
                                    event.currentTarget.getBoundingClientRect().top +
                                      event.currentTarget.getBoundingClientRect().height / 2
                                      ? 1
                                      : 0)
                                );
                            }}
                          >
                            <button type="button" onClick={() => selectLesson(lesson)}>
                              {lesson.title}
                            </button>
                            <small>
                              {date
                                ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
                                    month: 'short',
                                    day: 'numeric'
                                  })
                                : `${effectiveLessonSpan(lesson, fallback.span)} mtg`}
                            </small>
                          </div>
                        );
                      })}
                      <div
                        className={`curriculum-lesson-end-drop-zone${
                          draggedLessonBelongsToUnit ? ' is-dragging' : ''
                        }${
                          outlineDropPosition?.unitId === position.unit.id &&
                          outlineDropPosition.index === orderedLessons.length
                            ? ' active'
                            : ''
                        }`}
                        aria-hidden="true"
                        onDragOver={(event) => {
                          if (!draggedLessonBelongsToUnit) return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = 'move';
                          setOutlineDropPosition({
                            unitId: position.unit.id,
                            index: orderedLessons.length
                          });
                        }}
                        onDrop={(event) => {
                          if (!draggedLessonBelongsToUnit) return;
                          event.preventDefault();
                          event.stopPropagation();
                          if (outlineDraggedLessonId)
                            void reorderLessonTo(
                              position.unit,
                              outlineDraggedLessonId,
                              orderedLessons.length
                            );
                        }}
                      />
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
                          Hobie can draft lessons
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
                              <span>Hobie’s draft · not added yet</span>
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
                                  Add drafted lessons
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
                              {isGeneratingUnit ? 'Hobie is drafting…' : 'Draft lesson plan'}
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

        <div
          className={`curriculum-canvas-wrap${handTool || spaceHeld ? ' is-hand' : ''}${panning ? ' is-panning' : ''}`}
          ref={canvasWrapRef}
          tabIndex={0}
          aria-label="Interactive meeting timeline"
          {...panHandlers}
        >
          <div className="curriculum-scale" style={{ minWidth: timelineSlots.length * slotWidth }}>
            {timelineSlots
              .filter((_, index) => index % Math.max(1, Math.ceil(82 / slotWidth)) === 0)
              .map((slot) => (
                <span
                  key={slot.startMeeting}
                  style={{ width: Math.max(1, Math.ceil(82 / slotWidth)) * slotWidth }}
                >
                  <strong>{slot.label}</strong>
                  <small>
                    {meetings.length ? `M${slot.startMeeting + 1}` : 'Meeting sequence'}
                  </small>
                </span>
              ))}
          </div>
          <div
            className="curriculum-canvas"
            style={
              {
                minWidth: timelineSlots.length * slotWidth,
                '--slot-width': `${slotWidth}px`,
                '--grid-width': `${slotWidth * Math.max(1, Math.ceil(16 / slotWidth))}px`
              } as CSSProperties
            }
          >
            {positions.map((position) => {
              const selected = selection?.type === 'unit' && selection.id === position.unit.id;
              const isDragging = drag?.unit.unit.id === position.unit.id;
              const start = isDragging && dragPreview !== null ? dragPreview.start : position.start;
              const span = isDragging && dragPreview !== null ? dragPreview.span : position.span;
              const hasConflict = positions.some(
                (other) =>
                  other.unit.id !== position.unit.id &&
                  start < other.start + other.span &&
                  other.start < start + span
              );
              const expanded = expandedUnitIds.includes(position.unit.id);
              const orderedLessons = [...position.unit.lessons].sort(
                (left, right) => left.orderIndex - right.orderIndex
              );
              return (
                <div
                  key={position.unit.id}
                  className={`curriculum-track-group${expanded ? ' expanded' : ''}`}
                >
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
                        addedUnitId === position.unit.id ? 'unit-planning-added' : '',
                        selected ? 'selected' : '',
                        isDragging ? 'dragging' : '',
                        hasConflict ? 'conflict' : ''
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      style={{
                        left: start * slotWidth,
                        width: span * slotWidth
                      }}
                      data-compact={span * slotWidth < 90 || undefined}
                      aria-label={`Unit ${position.unit.title}, meetings ${Math.round(start) + 1} through ${Math.round(start + span)}`}
                      data-planned-unit={position.unit.id}
                      title={`${position.unit.title} · Meetings ${Math.round(start) + 1}–${Math.round(start + span)}. Drag to move; drag either edge to trim.`}
                      onContextMenu={(event) => openContextMenu(event, 'unit', position.unit.id)}
                      onPointerDown={(event) => beginUnitDrag(event, position, 'move')}
                      onPointerMove={updateUnitDrag}
                      onPointerUp={() => {
                        const moved = finishUnitDrag();
                        if (!moved) {
                          selectUnit(position.unit);
                        }
                      }}
                      onPointerCancel={() => {
                        pointerRef.current = null;
                        setDrag(null);
                        setDragPreview(null);
                      }}
                    >
                      <button
                        className="curriculum-unit-resize timeline-trim-start"
                        type="button"
                        role="slider"
                        aria-label={`Adjust ${position.unit.title} start`}
                        aria-valuemin={1}
                        aria-valuemax={Math.round(start + span)}
                        aria-valuenow={Math.round(start) + 1}
                        aria-valuetext={`Meeting ${Math.round(start) + 1}`}
                        aria-orientation="horizontal"
                        disabled={!canEditSharedPlan || saving}
                        title="Drag to trim the start; arrow keys adjust one meeting"
                        onPointerDown={(event) => beginUnitDrag(event, position, 'trim-start')}
                        onPointerMove={updateUnitDrag}
                        onPointerUp={(event) => {
                          event.stopPropagation();
                          finishUnitDrag();
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                          event.preventDefault();
                          event.stopPropagation();
                          const range = editClipRange(
                            position,
                            'trim-start',
                            event.key === 'ArrowLeft' ? -1 : 1,
                            0,
                            visibleMeetings
                          );
                          requestUnitResize(position, range.span, range.start);
                        }}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <TimelineIcon name="trim-start" />
                      </button>
                      <button
                        className="curriculum-unit-content"
                        type="button"
                        onClick={() => {
                          if (!suppressClick.current) selectUnit(position.unit);
                          suppressClick.current = false;
                        }}
                      >
                        <TimelineIcon name="grip" />
                        <strong>{position.unit.title}</strong>
                        <span>
                          {position.unit.lessons.length} lessons · {Math.round(span)} meetings
                        </span>
                      </button>
                      <button
                        className="curriculum-unit-resize"
                        type="button"
                        role="slider"
                        aria-label={`Adjust ${position.unit.title} length`}
                        aria-orientation="horizontal"
                        aria-valuemin={1}
                        aria-valuemax={Math.max(span, visibleMeetings - start)}
                        aria-valuenow={Math.round(span)}
                        aria-valuetext={`${span} ${span === 1 ? 'meeting' : 'meetings'}`}
                        disabled={!canEditSharedPlan || saving}
                        title="Drag to resize, or use the arrow keys"
                        onPointerDown={(event) => beginUnitDrag(event, position, 'resize')}
                        onPointerMove={updateUnitDrag}
                        onPointerUp={(event) => {
                          event.stopPropagation();
                          finishUnitDrag();
                        }}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => adjustUnitResize(event, position)}
                        onPointerCancel={() => {
                          setDrag(null);
                          setDragPreview(null);
                        }}
                      >
                        <TimelineIcon name="trim-end" />
                      </button>
                    </article>
                  </div>
                  {expanded
                    ? orderedLessons.map((lesson, index) => {
                        const fallback = reflowLessonRanges(
                          position.start,
                          position.span,
                          orderedLessons.length
                        )[index]!;
                        const defaultLessonSpan = fallback.span;
                        const defaultLessonStart = fallback.start;
                        const lessonSpan = canEditSharedPlan
                          ? Math.min(position.span, effectiveLessonSpan(lesson, defaultLessonSpan))
                          : effectiveLessonSpan(lesson, defaultLessonSpan);
                        const start = effectiveLessonStart(lesson, defaultLessonStart);
                        const lessonStart = canEditSharedPlan
                          ? clamp(
                              start,
                              position.start,
                              Math.max(position.start, position.start + position.span - lessonSpan)
                            )
                          : start;
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
                            data-selected={selectedLesson ? 'true' : undefined}
                          >
                            <article
                              data-feedback-component="curriculum-lesson"
                              className={[
                                'curriculum-lesson-bar',
                                active ? 'current' : '',
                                selectedLesson ? 'selected' : '',
                                isLessonDragging ? 'dragging' : ''
                              ]
                                .filter(Boolean)
                                .join(' ')}
                              style={{
                                left: displayStart * slotWidth,
                                width: displaySpan * slotWidth
                              }}
                              data-compact={displaySpan * slotWidth < 70 || undefined}
                              title={`${lesson.title} · Meetings ${Math.round(displayStart) + 1}–${Math.round(displayStart + displaySpan)}. Double-click to open.`}
                              aria-label={`${lesson.title}, ${Math.round(displaySpan)} ${Math.round(displaySpan) === 1 ? 'meeting' : 'meetings'}`}
                              onContextMenu={(event) => openContextMenu(event, 'lesson', lesson.id)}
                              onPointerDown={(event) =>
                                beginLessonDrag(
                                  event,
                                  lesson,
                                  'move',
                                  lessonStart,
                                  lessonSpan,
                                  start,
                                  span
                                )
                              }
                              onPointerMove={updateLessonDrag}
                              onPointerUp={() => {
                                void finishLessonDrag().then((moved) => {
                                  if (!moved) selectLesson(lesson);
                                });
                              }}
                              onPointerCancel={() => {
                                pointerRef.current = null;
                                setLessonDrag(null);
                                setLessonDragPreview(null);
                              }}
                            >
                              <button
                                className="curriculum-lesson-resize timeline-trim-start"
                                type="button"
                                role="slider"
                                aria-label={`Adjust ${lesson.title} start`}
                                aria-valuemin={position.start + 1}
                                aria-valuemax={lessonStart + lessonSpan}
                                aria-valuenow={Math.round(displayStart) + 1}
                                aria-valuetext={`Meeting ${Math.round(displayStart) + 1}`}
                                aria-orientation="horizontal"
                                disabled={!canEditLessonTiming || saving}
                                title="Drag to trim the start; arrow keys adjust one meeting"
                                onPointerDown={(event) =>
                                  beginLessonDrag(
                                    event,
                                    lesson,
                                    'trim-start',
                                    lessonStart,
                                    lessonSpan,
                                    position.start,
                                    position.span
                                  )
                                }
                                onPointerMove={updateLessonDrag}
                                onPointerUp={(event) => {
                                  event.stopPropagation();
                                  void finishLessonDrag();
                                }}
                                onClick={(event) => event.stopPropagation()}
                                onKeyDown={(event) => {
                                  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
                                    return;
                                  event.preventDefault();
                                  event.stopPropagation();
                                  const range = editClipRange(
                                    { start: lessonStart, span: lessonSpan },
                                    'trim-start',
                                    event.key === 'ArrowLeft' ? -1 : 1,
                                    position.start,
                                    position.start + position.span
                                  );
                                  void persistTiming([
                                    timingPatch('lesson', lesson, range.start, range.span)
                                  ]);
                                }}
                              >
                                <TimelineIcon name="trim-start" />
                              </button>
                              <button
                                className="curriculum-lesson-content"
                                type="button"
                                onClick={() => {
                                  if (!suppressClick.current) selectLesson(lesson);
                                  suppressClick.current = false;
                                }}
                                onDoubleClick={() => {
                                  if (onOpenLesson) onOpenLesson(lesson.id);
                                  else {
                                    selectLesson(lesson);
                                    setOpenLessonPlanId(lesson.id);
                                  }
                                }}
                              >
                                <span>{lesson.title}</span>
                                <small>{Math.round(displaySpan)} mtg</small>
                              </button>
                              <button
                                className="curriculum-lesson-resize"
                                type="button"
                                role="slider"
                                aria-label={`Adjust ${lesson.title} length`}
                                aria-orientation="horizontal"
                                aria-valuemin={1}
                                aria-valuemax={Math.max(lessonSpan, start + span - lessonStart)}
                                aria-valuenow={Math.round(displaySpan)}
                                aria-valuetext={`${displaySpan} ${displaySpan === 1 ? 'meeting' : 'meetings'}`}
                                disabled={!canEditLessonTiming || saving}
                                title="Drag to resize, or use the arrow keys"
                                onPointerDown={(event) =>
                                  beginLessonDrag(
                                    event,
                                    lesson,
                                    'resize',
                                    lessonStart,
                                    lessonSpan,
                                    start,
                                    span
                                  )
                                }
                                onPointerMove={updateLessonDrag}
                                onPointerUp={(event) => {
                                  event.stopPropagation();
                                  void finishLessonDrag();
                                }}
                                onClick={(event) => event.stopPropagation()}
                                onKeyDown={(event) =>
                                  void adjustLessonResize(
                                    event,
                                    lesson,
                                    lessonStart,
                                    lessonSpan,
                                    start,
                                    span
                                  )
                                }
                                onPointerCancel={() => {
                                  setLessonDrag(null);
                                  setLessonDragPreview(null);
                                }}
                              >
                                <TimelineIcon name="trim-end" />
                              </button>
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
              <span>Drag across meetings to add a unit</span>
            </div>
            {rangePreview ? (
              <div
                className={`curriculum-range-preview${rangeOverlapsExistingPlan(rangePreview) ? ' conflict' : ''}`}
                style={(() => {
                  const displayRange = displayRangeForMeetings(
                    rangePreview.start,
                    rangePreview.meetingCount
                  );
                  return {
                    left: displayRange.start * slotWidth,
                    width: displayRange.span * slotWidth,
                    top: rangeDrag ? rangeDrag.laneTop : 0
                  };
                })()}
              >
                <span>{planningRangeLabel(rangePreview, rangeMeetings)}</span>
                {rangeOverlapsExistingPlan(rangePreview) ? <small>Existing plan</small> : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {displayMode === 'timeline' ? (
        <div className="timeline-footer">
          <span className="timeline-overview-label">Year overview</span>
          <div
            className="timeline-overview"
            role="slider"
            tabIndex={0}
            aria-label="Timeline position in year"
            aria-valuemin={1}
            aria-valuemax={visibleMeetings}
            aria-valuenow={Math.floor(viewport.left / slotWidth) + 1}
            aria-valuetext={`Viewing meeting ${Math.floor(viewport.left / slotWidth) + 1} onward`}
            aria-orientation="horizontal"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.focus();
              event.currentTarget.setPointerCapture(event.pointerId);
              const rect = event.currentTarget.getBoundingClientRect();
              canvasWrapRef.current?.scrollTo({
                left:
                  ((event.clientX - rect.left) / rect.width) * visibleMeetings * slotWidth -
                  viewport.width / 2
              });
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
              const rect = event.currentTarget.getBoundingClientRect();
              canvasWrapRef.current?.scrollTo({
                left:
                  ((event.clientX - rect.left) / rect.width) * visibleMeetings * slotWidth -
                  viewport.width / 2
              });
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.stopPropagation();
                event.preventDefault();
                scrollCanvasBy(event.key === 'ArrowLeft' ? -1 : 1);
              } else if (event.key === 'Home' || event.key === 'End') {
                event.stopPropagation();
                event.preventDefault();
                canvasWrapRef.current?.scrollTo({
                  left: event.key === 'Home' ? 0 : visibleMeetings * slotWidth
                });
              }
            }}
          >
            {positions.map((position, index) => (
              <span
                key={position.unit.id}
                className="timeline-overview-unit"
                style={{
                  left: `${(position.start / visibleMeetings) * 100}%`,
                  width: `${(position.span / visibleMeetings) * 100}%`,
                  top: 8 + (index % 3) * 6
                }}
              />
            ))}
            <span
              className="timeline-overview-window"
              style={{
                left: `${(viewport.left / (visibleMeetings * slotWidth)) * 100}%`,
                width: `${Math.min(100, (viewport.width / (visibleMeetings * slotWidth)) * 100)}%`
              }}
            />
          </div>
          <span className="timeline-visible-range">
            M{Math.floor(viewport.left / slotWidth) + 1}–
            {Math.min(visibleMeetings, Math.ceil((viewport.left + viewport.width) / slotWidth))}
          </span>
        </div>
      ) : null}
      {(dragPreview && drag) || (lessonDragPreview && lessonDrag) ? (
        <div className="timeline-drag-readout" role="status">
          {(() => {
            const range = dragPreview ?? lessonDragPreview!;
            const mode = drag?.mode ?? lessonDrag?.mode;
            return `${mode === 'move' ? 'Move' : mode === 'trim-start' ? 'Trim start' : 'Trim end'} · M${Math.round(range.start) + 1}–${Math.round(range.start + range.span)} · ${Math.round(range.span)} meetings`;
          })()}
          <small>Release to save · Esc to cancel</small>
        </div>
      ) : null}

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
          {pendingConflicts.length ? (
            <p className="curriculum-change-conflict" role="alert">
              This change overlaps {pendingConflicts.map((item) => item.unit.title).join(', ')}. A
              unit may end where the next one begins, but these plans use the same instructional
              meeting(s).
            </p>
          ) : null}
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
              Keep Both Plans
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
